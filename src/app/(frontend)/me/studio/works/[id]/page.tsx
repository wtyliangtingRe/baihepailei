import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getPayload } from 'payload'

import { syncWorkToPublicIndexes } from '@/lib/publicIndexSync'

import { canonicalContentUrl } from '../../../../_lib/content-identity'
import {
  aliasesFromText,
  aliasesToText,
  isMergedDuplicateWork,
  mergedWorkReference,
  normalizePublicationStatus,
  safeReviewReturnTo,
  sourceLinksFromText,
  sourceLinksToText,
} from '../../../review/content/review-utils'

export const dynamic = 'force-dynamic'

type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'trusted' | 'member'
type PageParams = Promise<{ id: string }>
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type LocalizedTitle = {
  title?: string
  language?: string
  kind?: string
  region?: string
  isPrimary?: boolean
  source?: string
  note?: string
}
type WorkDoc = {
  id: string | number
  title?: string
  slug?: string
  originalTitle?: string
  aliases?: Array<{ value?: string } | string>
  localizedTitles?: LocalizedTitle[]
  mediaGroup?: string
  mediaType?: string
  format?: string
  firstPublishedAt?: string
  firstPublishedPrecision?: string
  firstPublishedLabel?: string
  rank?: string
  reviewStatus?: string
  ratingNotice?: string
  evidenceStrength?: string
  humanReviewNote?: string
  humanReviewedAt?: string
  humanReviewedBy?: unknown
  reviewReasons?: string[] | string
  status?: string
  isLiteVisible?: boolean
  isFullVisible?: boolean
  hasEvidence?: boolean
  sourceLinks?: Array<{ label?: string; url?: string }>
  sourceConflictNotes?: string
  evidenceNote?: string
  searchText?: string
  externalIds?: {
    bangumiSubjectId?: string
    anilistMediaId?: string
    vndbId?: string
    wikidataQid?: string
    malId?: string
    officialUrl?: string
  }
  updatedAt?: string
  createdAt?: string
}

const staffRoles = new Set<Role>(['owner', 'admin', 'editor', 'reviewer'])
const rankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']
const mediaGroupOptions = ['anime', 'manga', 'novel', 'game', 'other', 'unknown']
const mediaTypeOptions = ['anime', 'manga', 'novel', 'light_novel', 'visual_novel', 'game', 'audio_drama', 'live_action', 'webtoon', 'doujin', 'anthology', 'other', 'unknown']
const formatOptions = ['tv_anime', 'anime_movie', 'ova', 'ona', 'manga_series', 'manga_oneshot', 'novel_series', 'light_novel_series', 'web_serial', 'visual_novel', 'pc_game', 'console_game', 'mobile_game', 'audio_drama', 'live_action', 'webtoon_series', 'doujin', 'anthology', 'other', 'unknown']
const reviewStatusOptions = ['pending', 'reviewed', 'disputed', 'deprecated']
const publicationStatusOptions = ['draft', 'published', 'archived']
const ratingNoticeOptions = ['ai_synthesized_pending_review', 'insufficient_information', 'manual_reviewed', 'none', 'other']
const evidenceStrengthOptions = ['unassessed', 'weak', 'medium', 'strong']
const languageOptions = new Set(['ja', 'zh-Hans', 'zh-Hant', 'en', 'ko', 'fr', 'de', 'es', 'und', 'other', 'unknown'])
const titleKindOptions = new Set(['original', 'official', 'localized', 'romanized', 'alias', 'fan', 'literal', 'search_only', 'other'])

const labels: Record<string, string> = {
  S: 'S', AA: 'S（兼容 AA）', A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', X: 'X', trash: '垃圾', unknown: '未知',
  anime: '动画', manga: '漫画', novel: '小说', game: '游戏', live_action: '真人影视', other: '其他',
  light_novel: '轻小说', visual_novel: '视觉小说', audio_drama: '广播剧 / 音声', webtoon: 'Webtoon', doujin: '同人作品', anthology: '合集 / 选集',
  tv_anime: 'TV 动画', anime_movie: '动画电影', ova: 'OVA', ona: 'ONA / 网络动画', manga_series: '漫画连载', manga_oneshot: '漫画短篇', novel_series: '小说系列', light_novel_series: '轻小说系列', web_serial: 'Web 连载', pc_game: 'PC 游戏', console_game: '主机游戏', mobile_game: '手机游戏', webtoon_series: 'Webtoon 连载',
  pending: '待复核', reviewed: '已复核', disputed: '有争议', deprecated: '已合并 / 已废弃',
  draft: '草稿', published: '已发布', archived: '回收站 / 归档',
  ai_synthesized_pending_review: 'AI 综合，待复核', insufficient_information: '信息不足', manual_reviewed: '人工已确认', none: '无',
  unassessed: '未评估', weak: '弱', medium: '中', strong: '强',
  day: '精确到日', month: '精确到月', year: '精确到年',
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function roleOf(user: unknown): Role | undefined {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

function canEdit(user: unknown) {
  const role = roleOf(user)
  return Boolean(role && staffRoles.has(role))
}

function text(value: FormDataEntryValue | null, max = 10000) {
  return String(value || '').trim().slice(0, max)
}

function checked(formData: FormData, name: string) {
  return formData.get(name) === 'on'
}

function reviewReasons(value: WorkDoc['reviewReasons']) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[;|,]/u).map((item) => item.trim()).filter(Boolean)
  return []
}

function dateInputValue(value?: string) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10)
}

function editorHref(id: string | number, returnTo: string, values: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams({ returnTo })
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return `/me/studio/works/${id}?${params.toString()}`
}

function optionLabel(value: string) {
  return labels[value] || value
}

function localizedTitlesToText(value: WorkDoc['localizedTitles']) {
  if (!Array.isArray(value)) return ''
  return value.map((item) => {
    const title = String(item?.title || '').trim()
    if (!title) return ''
    return [item.language || 'unknown', item.kind || 'alias', title, item.region || '', item.isPrimary ? 'primary' : '', item.source || '', item.note || ''].join(' | ')
  }).filter(Boolean).join('\n')
}

function localizedTitlesFromText(value: FormDataEntryValue | null) {
  const output: LocalizedTitle[] = []
  for (const line of String(value || '').split(/\r?\n/u)) {
    const parts = line.split('|').map((part) => part.trim())
    const title = parts[2] || parts[0]
    if (!title) continue
    const language = languageOptions.has(parts[0]) ? parts[0] : 'unknown'
    const kind = titleKindOptions.has(parts[1]) ? parts[1] : 'alias'
    output.push({
      language,
      kind,
      title,
      region: parts[3] || '',
      isPrimary: parts[4] === 'primary',
      source: parts[5] || 'manual',
      note: parts[6] || '',
    })
  }
  return output
}

async function saveStudioWorkAction(formData: FormData) {
  'use server'
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canEdit(auth.user)) throw new Error('没有作品编辑权限。')

  const id = text(formData.get('id'), 40)
  const returnTo = safeReviewReturnTo(formData.get('returnTo'))
  if (!id) redirect('/me/studio?studioError=invalid_action')

  const current = await payload.findByID({ collection: 'works', id, depth: 0, draft: true, overrideAccess: true }) as unknown as WorkDoc
  if (isMergedDuplicateWork(current)) {
    const merged = mergedWorkReference(current)
    if (merged?.id) redirect(editorHref(merged.id, returnTo, { editorError: 'merged_duplicate', sourceId: id }))
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}studioError=merged_duplicate`)
  }

  const title = text(formData.get('title'), 300)
  const rank = text(formData.get('rank'), 40)
  const reviewStatus = text(formData.get('reviewStatus'), 40)
  const status = normalizePublicationStatus(formData.get('status'))
  const ratingNotice = text(formData.get('ratingNotice'), 80)
  const evidenceStrength = text(formData.get('evidenceStrength'), 40)
  const mediaGroup = text(formData.get('mediaGroup'), 80)
  const mediaType = text(formData.get('mediaType'), 80)
  const format = text(formData.get('format'), 80)
  const firstPublishedPrecision = text(formData.get('firstPublishedPrecision'), 40)
  const firstPublishedAt = text(formData.get('firstPublishedAt'), 40)

  const invalid = !title
    || !rankOptions.includes(rank)
    || !reviewStatusOptions.includes(reviewStatus)
    || !publicationStatusOptions.includes(status)
    || !ratingNoticeOptions.includes(ratingNotice)
    || !evidenceStrengthOptions.includes(evidenceStrength)
    || !mediaGroupOptions.includes(mediaGroup)
    || !mediaTypeOptions.includes(mediaType)
    || !formatOptions.includes(format)
    || !['day', 'month', 'year', 'unknown'].includes(firstPublishedPrecision)
  if (invalid) redirect(editorHref(id, returnTo, { editorError: 'invalid_fields' }))

  const humanReviewNote = text(formData.get('humanReviewNote'), 4000)
  if (reviewStatus === 'disputed' && !humanReviewNote) redirect(editorHref(id, returnTo, { editorError: 'note_required' }))

  const actorID = (auth.user as { id?: string | number }).id
  const archived = status === 'archived'
  const data: Record<string, unknown> = {
    title,
    originalTitle: text(formData.get('originalTitle'), 300),
    aliases: aliasesFromText(formData.get('aliases')),
    localizedTitles: localizedTitlesFromText(formData.get('localizedTitles')),
    mediaGroup,
    mediaType,
    format,
    firstPublishedAt: firstPublishedAt || null,
    firstPublishedPrecision,
    firstPublishedLabel: text(formData.get('firstPublishedLabel'), 120),
    rank,
    reviewStatus: archived ? 'deprecated' : reviewStatus,
    status,
    ratingNotice,
    evidenceStrength,
    humanReviewNote,
    isLiteVisible: archived ? false : checked(formData, 'isLiteVisible'),
    isFullVisible: archived ? false : checked(formData, 'isFullVisible'),
    hasEvidence: checked(formData, 'hasEvidence'),
    sourceLinks: sourceLinksFromText(formData.get('sourceLinks')),
    sourceConflictNotes: text(formData.get('sourceConflictNotes'), 12000),
    evidenceNote: text(formData.get('evidenceNote'), 12000),
    searchText: text(formData.get('searchText'), 30000),
    externalIds: {
      bangumiSubjectId: text(formData.get('bangumiSubjectId'), 120),
      anilistMediaId: text(formData.get('anilistMediaId'), 120),
      vndbId: text(formData.get('vndbId'), 120),
      wikidataQid: text(formData.get('wikidataQid'), 120),
      malId: text(formData.get('malId'), 120),
      officialUrl: text(formData.get('officialUrl'), 1000),
    },
  }
  if (!archived && reviewStatus !== 'pending') {
    data.humanReviewedAt = new Date().toISOString()
    data.humanReviewedBy = actorID
    data.reviewReasons = [...new Set([...reviewReasons(current.reviewReasons), 'manual_review'])]
  }
  if (!archived && reviewStatus === 'reviewed') data.ratingNotice = 'manual_reviewed'

  let updated: WorkDoc
  try {
    updated = await payload.update({
      collection: 'works',
      id,
      depth: 1,
      draft: false,
      overrideAccess: true,
      context: { firstPartyStudio: true },
      data: data as never,
    }) as unknown as WorkDoc
  } catch (error) {
    console.error('First-party studio work update failed', { id, error })
    redirect(editorHref(id, returnTo, { editorError: 'save_failed' }))
  }

  let syncStatus = 'ok'
  try {
    const result = syncWorkToPublicIndexes(updated)
    if (result.search === 'missing' || result.detail === 'missing') syncStatus = 'missing_index'
    if (result.search === 'skipped' || result.detail === 'skipped') syncStatus = 'draft_not_public'
  } catch (error) {
    console.error('Work saved but targeted public index sync failed', { id, error })
    syncStatus = 'failed'
  }

  revalidatePath('/me/studio')
  revalidatePath('/works')
  revalidatePath('/search')
  revalidatePath(canonicalContentUrl('works', id))
  revalidatePath(`/me/studio/works/${id}`)
  redirect(editorHref(id, returnTo, { saved: 'true', sync: syncStatus }))
}

export default async function StudioWorkEditorPage({ params, searchParams }: { params: PageParams; searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  const { id } = await params
  const rawSearch = await searchParams
  const returnTo = safeReviewReturnTo(first(rawSearch.returnTo) || '/me/studio')

  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent(editorHref(id, returnTo))}`)
  if (!canEdit(auth.user)) redirect('/feedback?type=new_work')

  let work: WorkDoc
  try {
    work = await payload.findByID({ collection: 'works', id, depth: 1, draft: true, overrideAccess: true }) as unknown as WorkDoc
  } catch {
    notFound()
  }

  const merged = mergedWorkReference(work)
  const editorError = first(rawSearch.editorError)
  const saved = first(rawSearch.saved)
  const sync = first(rawSearch.sync)
  const sourceID = first(rawSearch.sourceId)

  if (merged) {
    return (
      <main className="page review-workbench review-editor-page">
        <section className="review-hero"><div className="review-hero-copy"><p className="eyebrow">站内内容管理</p><h1>旧条目已经合并</h1><p className="muted">作品 #{work.id} 只保留作历史追踪，不能继续编辑。</p></div></section>
        <section className="review-merged-warning"><strong>请转到规范作品：{merged.title || `作品 #${merged.id}`}</strong><div className="review-content-actions"><Link className="review-button review-button-primary" href={editorHref(merged.id, returnTo)}>打开规范作品</Link><Link className="review-link" href={returnTo}>返回内容管理</Link></div></section>
      </main>
    )
  }

  return (
    <main className="page review-workbench review-editor-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">站内内容管理 · 作品编辑</p>
          <h1>{work.title || `作品 #${work.id}`}</h1>
          <p className="muted">这里直接修改作品正式字段。保存后会同步现有公开索引中的标题、等级、状态、类型、日期和来源摘要；草稿仍不会自动公开。</p>
          <div className="review-safety-note">写入通过 Payload 并保留版本历史。回收站只是 status=archived 与关闭可见性，不会永久删除数据。</div>
        </div>
        <div className="review-stat-grid"><Stat label="作品 ID" value={String(work.id)} /><Stat label="当前分级" value={work.rank || 'unknown'} /></div>
      </section>

      {saved ? <div className="review-action-message review-action-message-success" role="status">作品 #{work.id} 已保存。{sync === 'ok' ? '现有前台索引也已同步。' : sync === 'draft_not_public' ? '它仍是未进入索引的新草稿，发布时再进入前台。' : sync === 'missing_index' ? '本地缺少公开索引文件，需要先生成索引。' : sync === 'failed' ? '数据库已保存，但前台索引同步失败，请查看服务器日志。' : ''}</div> : null}
      {editorError ? <div className="review-action-message review-action-message-error" role="alert">{editorError === 'merged_duplicate' ? `已从合并旧条目 #${sourceID || ''} 转到规范作品。` : editorError === 'note_required' ? '标记为有争议时必须填写人工复核记录。' : editorError === 'save_failed' ? '保存失败，正式记录没有被改写。请查看 Payload 错误日志。' : '表单中有无效字段，请检查后重试。'}</div> : null}

      <div className="review-row-actions"><Link className="review-link" href={returnTo}>返回内容管理</Link><Link className="review-link" href={canonicalContentUrl('works', work.id)}>查看前台</Link></div>

      <form action={saveStudioWorkAction} className="review-editor-form">
        <input name="id" type="hidden" value={String(work.id)} /><input name="returnTo" type="hidden" value={returnTo} />

        <EditorSection title="基础身份与多语言标题" description="标题、别名和多语言名称会直接参与前台显示、搜索和跨来源去重。">
          <Field wide label="显示标题"><input defaultValue={work.title || ''} maxLength={300} name="title" required /></Field>
          <Field label="原始标题"><input defaultValue={work.originalTitle || ''} maxLength={300} name="originalTitle" /></Field>
          <Field wide label="别名（每行一个）"><textarea defaultValue={aliasesToText(work.aliases)} name="aliases" /></Field>
          <Field wide label="多语言标题"><textarea defaultValue={localizedTitlesToText(work.localizedTitles)} name="localizedTitles" placeholder={'zh-Hans | official | 中文标题 | CN | primary | manual\nja | original | 日本語タイトル | JP | primary | official\nen | romanized | English title'} /><small>格式：语言 | 类型 | 标题 | 地区 | primary（可选）| 来源 | 备注。</small></Field>
          <Field label="作品大类"><Select name="mediaGroup" options={mediaGroupOptions} value={work.mediaGroup || 'unknown'} /></Field>
          <Field label="作品类型"><Select name="mediaType" options={mediaTypeOptions} value={work.mediaType || 'unknown'} /></Field>
          <Field label="作品形态"><Select name="format" options={formatOptions} value={work.format || 'unknown'} /></Field>
          <Field label="首次日期"><input defaultValue={dateInputValue(work.firstPublishedAt)} name="firstPublishedAt" type="date" /></Field>
          <Field label="日期精度"><Select name="firstPublishedPrecision" options={['day', 'month', 'year', 'unknown']} value={work.firstPublishedPrecision || 'unknown'} /></Field>
          <Field label="日期显示文本"><input defaultValue={work.firstPublishedLabel || ''} maxLength={120} name="firstPublishedLabel" /></Field>
        </EditorSection>

        <EditorSection title="正式分级、发布与可见性" description="这里保存正式网站状态，不是 AI 建议。发布状态与人工复核状态分开。">
          <Field label="正式分级"><Select name="rank" options={rankOptions} value={work.rank || 'unknown'} /></Field>
          <Field label="复核状态"><Select name="reviewStatus" options={reviewStatusOptions} value={work.reviewStatus || 'pending'} /></Field>
          <Field label="发布状态"><Select name="status" options={publicationStatusOptions} value={normalizePublicationStatus(work.status)} /></Field>
          <Field label="分级提示"><Select name="ratingNotice" options={ratingNoticeOptions} value={work.ratingNotice || 'none'} /></Field>
          <Field label="证据强度"><Select name="evidenceStrength" options={evidenceStrengthOptions} value={work.evidenceStrength || 'unassessed'} /></Field>
          <Field wide label="人工复核 / 编辑记录"><textarea defaultValue={work.humanReviewNote || ''} maxLength={4000} name="humanReviewNote" /></Field>
          <div className="review-editor-checks"><Check defaultChecked={work.isLiteVisible !== false} label="进入 Lite 文字版" name="isLiteVisible" /><Check defaultChecked={work.isFullVisible !== false} label="完整版可见" name="isFullVisible" /><Check defaultChecked={Boolean(work.hasEvidence)} label="有证据材料" name="hasEvidence" /></div>
        </EditorSection>

        <EditorSection title="外部身份与来源" description="外部 ID 是跨语言重复判断与来源对齐的关键字段。">
          <Field label="Bangumi Subject ID"><input defaultValue={work.externalIds?.bangumiSubjectId || ''} name="bangumiSubjectId" /></Field>
          <Field label="AniList Media ID"><input defaultValue={work.externalIds?.anilistMediaId || ''} name="anilistMediaId" /></Field>
          <Field label="VNDB ID"><input defaultValue={work.externalIds?.vndbId || ''} name="vndbId" /></Field>
          <Field label="Wikidata QID"><input defaultValue={work.externalIds?.wikidataQid || ''} name="wikidataQid" /></Field>
          <Field label="MyAnimeList ID"><input defaultValue={work.externalIds?.malId || ''} name="malId" /></Field>
          <Field wide label="官方网站"><input defaultValue={work.externalIds?.officialUrl || ''} name="officialUrl" type="url" /></Field>
          <Field wide label="来源链接"><textarea defaultValue={sourceLinksToText(work.sourceLinks)} name="sourceLinks" placeholder={'Bangumi | https://bgm.tv/subject/...\nAniList | https://anilist.co/anime/...'} /></Field>
          <Field wide label="来源冲突备注"><textarea defaultValue={work.sourceConflictNotes || ''} name="sourceConflictNotes" /></Field>
          <Field wide label="证据备注"><textarea defaultValue={work.evidenceNote || ''} name="evidenceNote" /></Field>
          <Field wide label="搜索补充文本"><textarea defaultValue={work.searchText || ''} name="searchText" /></Field>
        </EditorSection>

        <section className="review-safety-note"><strong>关系、封面与富文本</strong><p>创作者、机构、标签、注意点、封面上传、摘要和分析需要做成可搜索的关系选择器与富文本编辑器，不能用容易误删数据的原始 ID 文本框冒充完成。它们会作为编辑台下一阶段继续补齐。</p></section>

        <div className="review-editor-submit"><button className="review-button review-button-primary" type="submit">保存并同步前台</button><Link className="review-link" href={returnTo}>取消</Link></div>
      </form>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="review-stat"><span>{label}</span><strong>{value}</strong></div>
}
function EditorSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="review-editor-section"><header><h2>{title}</h2><p>{description}</p></header><div className="review-editor-grid">{children}</div></section>
}
function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={wide ? 'review-editor-field review-editor-field-wide' : 'review-editor-field'}><span>{label}</span>{children}</label>
}
function Select({ name, options, value }: { name: string; options: string[]; value: string }) {
  return <select defaultValue={value} name={name}>{options.map((option) => <option key={option} value={option}>{optionLabel(option)}</option>)}</select>
}
function Check({ defaultChecked, label, name }: { defaultChecked: boolean; label: string; name: string }) {
  return <label className="review-editor-check"><input defaultChecked={defaultChecked} name={name} type="checkbox" /><span>{label}</span></label>
}
