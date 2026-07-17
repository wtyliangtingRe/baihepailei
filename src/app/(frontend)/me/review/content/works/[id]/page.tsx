import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { canonicalContentUrl } from '../../../../../_lib/content-identity'
import {
  aliasesFromText,
  aliasesToText,
  isMergedDuplicateWork,
  mergedWorkReference,
  safeReviewReturnTo,
  sourceLinksFromText,
  sourceLinksToText,
} from '../../review-utils'

export const dynamic = 'force-dynamic'

type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'trusted'
type PageParams = Promise<{ id: string }>
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

type WorkDoc = {
  id: string | number
  title?: string
  originalTitle?: string
  aliases?: Array<{ value?: string } | string>
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
  riskMatrix?: {
    maleImpact?: string
    relationshipClarity?: string
    endingSafety?: string
    creatorSpeechRisk?: string
    note?: string
  }
}

const allowedRoles = new Set<Role>(['owner', 'admin', 'editor', 'reviewer'])
const rankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']
const mediaGroupOptions = ['anime', 'manga', 'novel', 'game', 'audio', 'live_action', 'other', 'unknown']
const mediaTypeOptions = ['anime', 'manga', 'novel', 'light_novel', 'visual_novel', 'game', 'audio_drama', 'live_action', 'webtoon', 'doujin', 'anthology', 'other', 'unknown']
const formatOptions = ['tv_anime', 'anime_movie', 'ova', 'ona', 'manga_series', 'manga_oneshot', 'novel_series', 'light_novel_series', 'web_serial', 'visual_novel', 'pc_game', 'console_game', 'mobile_game', 'audio_drama', 'live_action', 'webtoon_series', 'doujin', 'anthology', 'other', 'unknown']
const reviewStatusOptions = ['pending', 'reviewed', 'disputed', 'deprecated']
const publicationStatusOptions = ['draft', 'review', 'published', 'archived']
const ratingNoticeOptions = ['ai_synthesized_pending_review', 'insufficient_information', 'manual_reviewed', 'none', 'other']
const evidenceStrengthOptions = ['unassessed', 'weak', 'medium', 'strong']

const labels: Record<string, string> = {
  S: 'S', AA: 'S（兼容 AA）', A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', X: 'X', trash: '垃圾', unknown: '未知',
  anime: '动画', manga: '漫画', novel: '小说', game: '游戏', audio: '音声', live_action: '真人影视', other: '其他',
  light_novel: '轻小说', visual_novel: '视觉小说', audio_drama: '广播剧 / 音声', webtoon: 'Webtoon', doujin: '同人作品', anthology: '合集 / 选集',
  tv_anime: 'TV 动画', anime_movie: '动画电影', ova: 'OVA', ona: 'ONA / 网络动画', manga_series: '漫画连载', manga_oneshot: '漫画短篇', novel_series: '小说系列', light_novel_series: '轻小说系列', web_serial: 'Web 连载', pc_game: 'PC 游戏', console_game: '主机游戏', mobile_game: '手机游戏', webtoon_series: 'Webtoon 连载',
  pending: '待复核', reviewed: '已复核', disputed: '有争议', deprecated: '已合并 / 已废弃',
  draft: '草稿', review: '待发布审核', published: '已发布', archived: '归档',
  ai_synthesized_pending_review: 'AI 综合，待复核', insufficient_information: '信息不足', manual_reviewed: '人工已确认', none: '无',
  unassessed: '未评估', weak: '弱', medium: '中', strong: '强',
  day: '精确到日', month: '精确到月', year: '精确到年',
  minor: '轻微', noticeable: '明显', severe: '严重', confirmed: '明确恋爱', developing: '发展中', subtext: '暧昧 / 亚文本', friendship: '友情向', unclear: '不明确', safe: '安全', open: '开放式', unfinished: '未完结', risky: '有风险', bad: '明确雷', disputed_risk: '有争议',
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function roleOf(user: unknown): Role | undefined {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

function canReview(user: unknown) {
  const role = roleOf(user)
  return Boolean(role && allowedRoles.has(role))
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
  return `/me/review/content/works/${id}?${params.toString()}`
}

function optionLabel(value: string) {
  return labels[value] || value
}

async function saveWorkEditorAction(formData: FormData) {
  'use server'

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canReview(auth.user)) throw new Error('没有作品编辑权限。')

  const id = text(formData.get('id'), 40)
  const returnTo = safeReviewReturnTo(formData.get('returnTo'))
  if (!id) redirect('/me/review/content?reviewError=invalid_action')

  const current = await payload.findByID({
    collection: 'works',
    id,
    depth: 0,
    draft: true,
    overrideAccess: true,
  }) as unknown as WorkDoc

  if (isMergedDuplicateWork(current)) {
    const merged = mergedWorkReference(current)
    if (merged?.id) redirect(editorHref(merged.id, returnTo, { editorError: 'merged_duplicate', sourceId: id }))
    redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}reviewError=merged_duplicate&reviewId=${encodeURIComponent(id)}`)
  }

  const title = text(formData.get('title'), 300)
  const rank = text(formData.get('rank'), 40)
  const reviewStatus = text(formData.get('reviewStatus'), 40)
  const status = text(formData.get('status'), 40)
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
  if (reviewStatus === 'disputed' && !humanReviewNote) {
    redirect(editorHref(id, returnTo, { editorError: 'note_required' }))
  }

  const data: Record<string, unknown> = {
    title,
    originalTitle: text(formData.get('originalTitle'), 300),
    aliases: aliasesFromText(formData.get('aliases')),
    mediaGroup,
    mediaType,
    format,
    firstPublishedAt: firstPublishedAt || null,
    firstPublishedPrecision,
    firstPublishedLabel: text(formData.get('firstPublishedLabel'), 120),
    rank,
    reviewStatus,
    status,
    ratingNotice,
    evidenceStrength,
    humanReviewNote,
    isLiteVisible: checked(formData, 'isLiteVisible'),
    isFullVisible: checked(formData, 'isFullVisible'),
    hasEvidence: checked(formData, 'hasEvidence'),
    sourceLinks: sourceLinksFromText(formData.get('sourceLinks')),
    sourceConflictNotes: text(formData.get('sourceConflictNotes'), 12000),
    evidenceNote: text(formData.get('evidenceNote'), 12000),
    searchText: text(formData.get('searchText'), 30000),
    riskMatrix: {
      maleImpact: text(formData.get('maleImpact'), 40),
      relationshipClarity: text(formData.get('relationshipClarity'), 40),
      endingSafety: text(formData.get('endingSafety'), 40),
      creatorSpeechRisk: text(formData.get('creatorSpeechRisk'), 40),
      note: text(formData.get('riskNote'), 4000),
    },
  }

  if (reviewStatus !== 'pending') {
    data.humanReviewedAt = new Date().toISOString()
    data.humanReviewedBy = (auth.user as { id?: string | number }).id
    data.reviewReasons = [...new Set([...reviewReasons(current.reviewReasons), 'manual_review'])]
  }
  if (reviewStatus === 'reviewed') data.ratingNotice = 'manual_reviewed'

  try {
    await payload.update({
      collection: 'works',
      id,
      depth: 0,
      draft: true,
      overrideAccess: true,
      context: { reviewWorkbench: true, firstPartyEditor: true },
      data: data as never,
    })
  } catch (error) {
    console.error('First-party work editor update failed', { id, error })
    redirect(editorHref(id, returnTo, { editorError: 'save_failed' }))
  }

  revalidatePath('/me/review/content')
  revalidatePath(canonicalContentUrl('works', id))
  revalidatePath(`/me/review/content/works/${id}`)
  redirect(editorHref(id, returnTo, { saved: 'true' }))
}

export default async function WorkEditorPage({ params, searchParams }: { params: PageParams; searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  const { id } = await params
  const rawSearch = await searchParams
  const returnTo = safeReviewReturnTo(first(rawSearch.returnTo))

  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent(editorHref(id, returnTo))}`)
  if (!canReview(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员、编辑和审核人员。</p></section></main>
  }

  let work: WorkDoc
  try {
    work = await payload.findByID({ collection: 'works', id, depth: 1, draft: true, overrideAccess: true }) as unknown as WorkDoc
  } catch {
    notFound()
  }

  const merged = mergedWorkReference(work)
  const editorError = first(rawSearch.editorError)
  const saved = first(rawSearch.saved)
  const sourceID = first(rawSearch.sourceId)

  if (merged) {
    return (
      <main className="page review-workbench review-editor-page">
        <section className="review-hero">
          <div className="review-hero-copy"><p className="eyebrow">站内作品编辑台</p><h1>旧条目已经合并</h1><p className="muted">作品 #{work.id} 只保留作历史追踪，不能继续编辑。</p></div>
        </section>
        <section className="review-merged-warning">
          <strong>请转到规范作品：{merged.title || `作品 #${merged.id}`}</strong>
          <div className="review-content-actions">
            <Link className="review-button review-button-primary" href={editorHref(merged.id, returnTo)}>打开规范作品编辑台</Link>
            <Link className="review-link" href={returnTo}>返回审核队列</Link>
            <Link className="review-link" href={`/admin/collections/works/${work.id}`}>Payload 查看旧记录</Link>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="page review-workbench review-editor-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">站内作品编辑台</p>
          <h1>{work.title || `作品 #${work.id}`}</h1>
          <p className="muted">这是面向日常审核和勘误的包装界面：常用资料、排雷矩阵、来源说明和发布状态都能在站内修改。关系数组、封面上传和富文本仍保留到 Payload 高级维护。</p>
          <div className="review-safety-note">保存使用 Payload 的草稿更新路径，并记录人工复核人和时间；不会直接执行 PostgreSQL 写入。</div>
        </div>
        <div className="review-stat-grid"><Stat label="作品 ID" value={String(work.id)} /><Stat label="当前分级" value={work.rank || 'unknown'} /></div>
      </section>

      {saved ? <div className="review-action-message review-action-message-success" role="status">作品 #{work.id} 已保存。列表索引需要在完成一批审核后重新导出才会全部同步。</div> : null}
      {editorError ? (
        <div className="review-action-message review-action-message-error" role="alert">
          {editorError === 'merged_duplicate'
            ? `已从合并旧条目 #${sourceID || ''} 转到规范作品；旧条目没有被修改。`
            : editorError === 'note_required'
              ? '标记为有争议时，必须填写人工复核记录。'
              : editorError === 'save_failed'
                ? '保存失败，数据库没有被直接改写。请查看开发服务器日志中的具体 Payload 错误。'
                : '表单中有无效字段，请检查必填项后重试。'}
        </div>
      ) : null}

      <div className="review-row-actions">
        <Link className="review-link" href={returnTo}>返回审核队列</Link>
        <Link className="review-link" href={canonicalContentUrl('works', work.id)}>查看前台</Link>
        <Link className="review-link" href={`/admin/collections/works/${work.id}`}>Payload 高级维护</Link>
      </div>

      <form action={saveWorkEditorAction} className="review-editor-form">
        <input name="id" type="hidden" value={String(work.id)} />
        <input name="returnTo" type="hidden" value={returnTo} />

        <EditorSection title="基础资料与勘误" description="处理标题、别名、类型和日期。别名每行一个。">
          <Field wide label="显示标题"><input defaultValue={work.title || ''} maxLength={300} name="title" required /></Field>
          <Field label="原始标题"><input defaultValue={work.originalTitle || ''} maxLength={300} name="originalTitle" /></Field>
          <Field label="作品大类"><Select name="mediaGroup" options={mediaGroupOptions} value={work.mediaGroup || 'unknown'} /></Field>
          <Field label="作品类型"><Select name="mediaType" options={mediaTypeOptions} value={work.mediaType || 'unknown'} /></Field>
          <Field label="作品形态"><Select name="format" options={formatOptions} value={work.format || 'unknown'} /></Field>
          <Field label="首次日期"><input defaultValue={dateInputValue(work.firstPublishedAt)} name="firstPublishedAt" type="date" /></Field>
          <Field label="日期精度"><Select name="firstPublishedPrecision" options={['day', 'month', 'year', 'unknown']} value={work.firstPublishedPrecision || 'unknown'} /></Field>
          <Field label="日期显示文本"><input defaultValue={work.firstPublishedLabel || ''} maxLength={120} name="firstPublishedLabel" placeholder="例如 2015、2015-04、待定" /></Field>
          <Field wide label="别名"><textarea defaultValue={aliasesToText(work.aliases)} name="aliases" placeholder={'每行一个别名\nENDRO!\nえんどろ〜！'} /></Field>
        </EditorSection>

        <EditorSection title="正式分级与审核" description="AI 建议只是参考；这里保存的是人工审核后的正式字段。">
          <Field label="正式分级"><Select name="rank" options={rankOptions} value={work.rank || 'unknown'} /></Field>
          <Field label="复核状态"><Select name="reviewStatus" options={reviewStatusOptions} value={work.reviewStatus || 'pending'} /></Field>
          <Field label="发布状态"><Select name="status" options={publicationStatusOptions} value={work.status || 'draft'} /></Field>
          <Field label="分级提示"><Select name="ratingNotice" options={ratingNoticeOptions} value={work.ratingNotice || 'none'} /></Field>
          <Field label="证据强度"><Select name="evidenceStrength" options={evidenceStrengthOptions} value={work.evidenceStrength || 'unassessed'} /></Field>
          <Field wide label="人工复核记录"><textarea defaultValue={work.humanReviewNote || ''} maxLength={4000} name="humanReviewNote" placeholder="记录核对过的来源、结论、勘误原因和仍待确认的问题。" /></Field>
          <div className="review-editor-checks">
            <Check defaultChecked={work.isLiteVisible !== false} label="进入 Lite 文字版" name="isLiteVisible" />
            <Check defaultChecked={work.isFullVisible !== false} label="保留旧 Full 可见标记" name="isFullVisible" />
            <Check defaultChecked={Boolean(work.hasEvidence)} label="有证据材料" name="hasEvidence" />
          </div>
        </EditorSection>

        <EditorSection title="排雷矩阵" description="没有把握时保留“未评估”，不要为了填满而猜测。">
          <Field label="男性角色影响"><Select name="maleImpact" options={['unassessed', 'none', 'minor', 'noticeable', 'severe']} value={work.riskMatrix?.maleImpact || 'unassessed'} /></Field>
          <Field label="恋爱关系明确度"><Select name="relationshipClarity" options={['unassessed', 'confirmed', 'developing', 'subtext', 'friendship', 'unclear']} value={work.riskMatrix?.relationshipClarity || 'unassessed'} /></Field>
          <Field label="结局安全性"><Select name="endingSafety" options={['unassessed', 'safe', 'open', 'unfinished', 'risky', 'bad']} value={work.riskMatrix?.endingSafety || 'unassessed'} /></Field>
          <Field label="创作者言论风险"><Select name="creatorSpeechRisk" options={['unassessed', 'none', 'minor', 'disputed', 'severe']} value={work.riskMatrix?.creatorSpeechRisk || 'unassessed'} /></Field>
          <Field wide label="矩阵备注"><textarea defaultValue={work.riskMatrix?.note || ''} maxLength={4000} name="riskNote" /></Field>
        </EditorSection>

        <EditorSection title="来源、证据与搜索" description="来源链接每行写成“名称 | https://...”或直接写 URL。这里适合日常勘误，不复制用户评论原文。">
          <Field wide label="来源链接"><textarea defaultValue={sourceLinksToText(work.sourceLinks)} name="sourceLinks" placeholder={'Bangumi | https://bgm.tv/subject/...\nhttps://anilist.co/anime/...'} /></Field>
          <Field wide label="来源冲突备注"><textarea defaultValue={work.sourceConflictNotes || ''} name="sourceConflictNotes" /></Field>
          <Field wide label="证据备注"><textarea defaultValue={work.evidenceNote || ''} name="evidenceNote" /></Field>
          <Field wide label="搜索补充文本"><textarea defaultValue={work.searchText || ''} name="searchText" placeholder="日文名、英文名、别名、作者名和检索关键词。" /></Field>
        </EditorSection>

        <div className="review-editor-submit">
          <button className="review-button review-button-primary" type="submit">保存到站内作品草稿</button>
          <Link className="review-link" href={returnTo}>取消并返回队列</Link>
          <small>封面、创作者关系、机构关系、标签、注意点和富文本分析暂时仍从 Payload 高级维护处理。</small>
        </div>
      </form>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="review-stat"><span>{label}</span><strong>{value}</strong></div>
}

function EditorSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="review-editor-section"><header><h2>{title}</h2><p>{description}</p></header><div className="review-editor-grid">{children}</div></section>
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'review-editor-field review-editor-field-wide' : 'review-editor-field'}><span>{label}</span>{children}</label>
}

function Select({ name, options, value }: { name: string; options: string[]; value: string }) {
  return <select defaultValue={value} name={name}>{options.map((option) => <option key={option} value={option}>{optionLabel(option)}</option>)}</select>
}

function Check({ defaultChecked, label, name }: { defaultChecked: boolean; label: string; name: string }) {
  return <label className="review-editor-check"><input defaultChecked={defaultChecked} name={name} type="checkbox" /><span>{label}</span></label>
}
