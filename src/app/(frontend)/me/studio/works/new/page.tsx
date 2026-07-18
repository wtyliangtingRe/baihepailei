import configPromise from '@payload-config'
import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import RadarRuleSelector from '../../../../_components/RadarRuleSelector'
import PendingSubmitButton from '../../_components/PendingSubmitButton'
import {
  RADAR_RATING_POLICY_ID,
  radarClassDefinitions,
  type RadarGrade,
  type RadarRatingClass,
} from '@/lib/radar/ratingPolicy'
import { plainTextToRichText } from '@/lib/richTextPlain'

import { aliasesFromText, safeReviewReturnTo, sourceLinksFromText } from '../../../review/content/review-utils'

export const dynamic = 'force-dynamic'

type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'trusted' | 'member'
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type FeedbackDoc = {
  id: string | number
  feedbackType?: string
  targetTitle?: string
  proposedGrade?: string
  matchedRuleCodes?: Array<{ code?: string }>
  claim?: string
  evidenceSummary?: string
  evidenceLinks?: Array<{ label?: string; url?: string }>
  reviewNote?: string
  workflowStatus?: string
  linkedWork?: unknown
}

type DuplicateCandidate = {
  id: string | number
  title?: string
  originalTitle?: string
  mediaGroup?: string
  mediaType?: string
  status?: string
}

const staffRoles = new Set<Role>(['owner', 'admin', 'editor', 'reviewer'])
const rankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown'] as const
const mediaGroupOptions = ['anime', 'manga', 'novel', 'game', 'other', 'unknown'] as const
const mediaTypeOptions = ['anime', 'manga', 'novel', 'light_novel', 'visual_novel', 'game', 'audio_drama', 'live_action', 'webtoon', 'doujin', 'anthology', 'other', 'unknown'] as const
const formatOptions = ['tv_anime', 'anime_movie', 'ova', 'ona', 'manga_series', 'manga_oneshot', 'novel_series', 'light_novel_series', 'web_serial', 'visual_novel', 'pc_game', 'console_game', 'mobile_game', 'audio_drama', 'live_action', 'webtoon_series', 'doujin', 'anthology', 'other', 'unknown'] as const
const datePrecisionOptions = ['day', 'month', 'year', 'unknown'] as const
const validRuleCodes = new Set(Object.keys(radarClassDefinitions))

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

function text(value: FormDataEntryValue | null, max = 12000) {
  return String(value || '').trim().slice(0, max)
}

function enumValue<const T extends readonly string[]>(options: T, value: string): T[number] | null {
  return (options as readonly string[]).includes(value) ? value as T[number] : null
}

function numericID(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function slugPart(value: string) {
  const normalized = value.normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
  return normalized || 'work'
}

function evidenceLinksToText(value: FeedbackDoc['evidenceLinks']) {
  if (!Array.isArray(value)) return ''
  return value.map((item) => item?.url ? `${item.label ? `${item.label} | ` : ''}${item.url}` : '').filter(Boolean).join('\n')
}

function feedbackRuleCodes(value: FeedbackDoc['matchedRuleCodes']) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item?.code || '').trim()).filter((code) => validRuleCodes.has(code)))]
}

function submittedRuleCodes(formData: FormData) {
  return [...new Set(formData.getAll('matchedRuleCodes').map(String).map((code) => code.trim()).filter((code) => validRuleCodes.has(code)))] as RadarRatingClass[]
}

function candidateWhere(title: string, originalTitle: string): Where {
  const or: Where[] = [
    { title: { like: title } },
    { originalTitle: { like: title } },
    { searchText: { like: title } },
  ]
  if (originalTitle) {
    or.push({ title: { like: originalTitle } }, { originalTitle: { like: originalTitle } }, { searchText: { like: originalTitle } })
  }
  return { or }
}

function withCreatedWork(returnTo: string, workID: number) {
  return `${returnTo}${returnTo.includes('?') ? '&' : '?'}createdWork=${encodeURIComponent(String(workID))}`
}

async function createWorkAction(formData: FormData) {
  'use server'
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canEdit(auth.user)) throw new Error('没有直接创建作品的权限。')

  const title = text(formData.get('title'), 300)
  const originalTitle = text(formData.get('originalTitle'), 300)
  const requestedRank = enumValue(rankOptions, text(formData.get('rank'), 40) || 'unknown')
  const mediaGroup = enumValue(mediaGroupOptions, text(formData.get('mediaGroup'), 40) || 'unknown')
  const mediaType = enumValue(mediaTypeOptions, text(formData.get('mediaType'), 40) || 'unknown')
  const format = enumValue(formatOptions, text(formData.get('format'), 60) || 'unknown')
  const firstPublishedPrecision = enumValue(datePrecisionOptions, text(formData.get('firstPublishedPrecision'), 40) || 'unknown')
  const duplicateConfirmed = formData.get('duplicateConfirmed') === 'on'
  const feedbackIDText = text(formData.get('feedbackId'), 40)
  const feedbackID = feedbackIDText ? numericID(feedbackIDText) : null
  const defaultReturnTo = feedbackID ? `/me/review/feedback/${feedbackID}` : '/me/studio'
  const requestedReturnTo = text(formData.get('returnTo'), 1000)
  const returnTo = requestedReturnTo ? safeReviewReturnTo(requestedReturnTo) : defaultReturnTo
  const decisiveRuleCodeText = text(formData.get('decisiveRuleCode'), 80)
  const decisiveRuleCode = validRuleCodes.has(decisiveRuleCodeText) ? decisiveRuleCodeText as RadarRatingClass : null
  const matchedRuleCodes = submittedRuleCodes(formData)
  const resolvedDecisiveRuleCode = decisiveRuleCode || matchedRuleCodes[0] || null
  const orderedRuleCodes = [...new Set([resolvedDecisiveRuleCode, ...matchedRuleCodes].filter(Boolean))] as RadarRatingClass[]

  if (!title || !requestedRank || !mediaGroup || !mediaType || !format || !firstPublishedPrecision || (feedbackIDText && !feedbackID)) {
    redirect(`/me/studio/works/new?createError=invalid_fields${feedbackIDText ? `&feedbackId=${encodeURIComponent(feedbackIDText)}` : ''}`)
  }

  const candidates = await payload.find({
    collection: 'works',
    depth: 0,
    draft: true,
    limit: 8,
    page: 1,
    pagination: false,
    overrideAccess: true,
    where: candidateWhere(title, originalTitle),
  })
  if (candidates.docs.length && !duplicateConfirmed) {
    const params = new URLSearchParams({ duplicateWarning: 'true', q: title, returnTo })
    if (feedbackID) params.set('feedbackId', String(feedbackID))
    redirect(`/me/studio/works/new?${params.toString()}`)
  }

  const token = randomUUID()
  const slug = `manual-${slugPart(title)}-${token.slice(0, 8)}`
  const actorID = numericID((auth.user as { id?: string | number }).id)
  if (!actorID) throw new Error('当前账户缺少有效的数字用户 ID，未创建作品。')

  const summary = text(formData.get('summary'), 12000)
  const humanNote = text(formData.get('humanReviewNote'), 4000)
  const sourceLinks = sourceLinksFromText(formData.get('sourceLinks'))
  const evidenceNote = text(formData.get('evidenceNote'), 12000)
  const searchText = text(formData.get('searchText'), 30000)
  const suggestedRuleGrade: RadarGrade | null = resolvedDecisiveRuleCode
    ? radarClassDefinitions[resolvedDecisiveRuleCode].grade
    : null
  const derivedRank = suggestedRuleGrade || requestedRank

  const created = await payload.create({
    collection: 'works',
    depth: 0,
    draft: false,
    overrideAccess: true,
    context: { firstPartyStudio: true, manualCreate: true, feedbackID: feedbackID || undefined },
    data: {
      title,
      originalTitle,
      aliases: aliasesFromText(formData.get('aliases')),
      ...(summary ? { summary: plainTextToRichText(summary) } : {}),
      slug,
      siteId: `manual:${token}`,
      rank: derivedRank,
      reviewStatus: 'pending',
      ratingNotice: suggestedRuleGrade ? 'ai_synthesized_pending_review' : 'none',
      evidenceStrength: 'unassessed',
      mediaGroup,
      mediaType,
      format,
      firstPublishedAt: text(formData.get('firstPublishedAt'), 40) || null,
      firstPublishedPrecision,
      firstPublishedLabel: text(formData.get('firstPublishedLabel'), 120),
      status: 'draft',
      isLiteVisible: false,
      isFullVisible: false,
      hasEvidence: sourceLinks.length > 0 || Boolean(evidenceNote),
      sourceLinks,
      evidenceNote,
      searchText,
      humanReviewNote: humanNote || `[${new Date().toISOString()}] 由站内内容管理创建草稿；actor=${actorID}`,
      humanReviewedBy: actorID,
      ...(suggestedRuleGrade ? {
        radarAssessment: {
          policyVersion: RADAR_RATING_POLICY_ID,
          suggestedGrade: suggestedRuleGrade,
          decisiveRuleCode: resolvedDecisiveRuleCode || undefined,
          matchedRules: orderedRuleCodes.map((code) => ({
            code,
            grade: radarClassDefinitions[code].grade,
          })),
          requiresHumanReview: true,
        },
      } : {}),
    },
  })
  const createdID = numericID(created.id)
  if (!createdID) throw new Error('Payload 已创建记录，但返回了无效作品 ID；未继续关联反馈。')

  if (feedbackID) {
    try {
      const feedback = await payload.findByID({ collection: 'feedback-submissions', id: feedbackID, depth: 0, overrideAccess: true }) as unknown as FeedbackDoc
      const previousNote = String(feedback.reviewNote || '').trim()
      const note = `已创建待复核作品草稿 #${createdID}；尚未公开。`
      await payload.update({
        collection: 'feedback-submissions',
        id: feedbackID,
        depth: 0,
        overrideAccess: true,
        data: {
          linkedWork: createdID,
          workflowStatus: 'accepted',
          reviewer: actorID,
          reviewedAt: new Date().toISOString(),
          reviewNote: previousNote ? `${previousNote}\n${note}` : note,
        },
      })
    } catch (error) {
      console.error('Created work but could not link feedback', { feedbackID, workID: createdID, error })
    }
  }

  redirect(withCreatedWork(returnTo, createdID))
}

function optionLabel(value: string) {
  if (value === 'AA') return 'S（兼容 AA）'
  if (value === 'trash') return '垃圾'
  if (value === 'unknown') return '未知'
  return value
}

export default async function NewStudioWorkPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/studio/works/new')}`)
  if (!canEdit(auth.user)) redirect('/feedback?type=new_work')

  const raw = await searchParams
  const feedbackID = first(raw.feedbackId)
  const query = first(raw.q)
  const defaultReturnTo = feedbackID ? `/me/review/feedback/${feedbackID}` : '/me/studio'
  const returnTo = safeReviewReturnTo(first(raw.returnTo) || defaultReturnTo)
  let feedback: FeedbackDoc | null = null
  if (feedbackID) {
    const feedbackRecordID = numericID(feedbackID)
    if (!feedbackRecordID) notFound()
    try {
      feedback = await payload.findByID({ collection: 'feedback-submissions', id: feedbackRecordID, depth: 0, overrideAccess: true }) as unknown as FeedbackDoc
    } catch {
      notFound()
    }
  }

  const duplicateCandidates = query
    ? (await payload.find({ collection: 'works', depth: 0, draft: true, limit: 10, page: 1, pagination: false, overrideAccess: true, where: candidateWhere(query, '') })).docs as unknown as DuplicateCandidate[]
    : []
  const createError = first(raw.createError)
  const duplicateWarning = first(raw.duplicateWarning)
  const suggestedTitle = feedback?.targetTitle || query
  const suggestedRank = rankOptions.includes(String(feedback?.proposedGrade || '') as typeof rankOptions[number]) ? String(feedback?.proposedGrade) : 'unknown'
  const feedbackSources = evidenceLinksToText(feedback?.evidenceLinks)
  const initialRuleCodes = feedbackRuleCodes(feedback?.matchedRuleCodes)
  const initialDecisiveRuleCode = initialRuleCodes[0] || ''

  return (
    <main className="page review-workbench review-editor-page studio-create-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">站内内容管理</p>
          <h1>创建作品草稿</h1>
          <p className="muted">工作人员可以直接建档，但新作品默认不可见、待复核、未发布。先检查重复作品，再补齐资料和规则建议。</p>
          <div className="review-safety-note">提交后会返回上一级并显示新作品 ID。按钮在创建过程中会禁用，避免重复建档。</div>
        </div>
      </section>

      {feedback ? <div className="review-action-message" role="status">正在处理用户新作品申请 #{feedback.id}：{feedback.targetTitle || '未命名作品'}。创建成功后会自动关联该反馈并返回本页上一级。</div> : null}
      {createError ? <div className="review-action-message review-action-message-error" role="alert">必填字段无效，请检查标题、作品类型、规则和分级。</div> : null}
      {duplicateWarning ? <div className="review-action-message review-action-message-error" role="alert">发现可能重复的现有作品。请先核对下方候选；确认不是重复项后，再勾选“仍然创建”。</div> : null}

      {duplicateCandidates.length ? (
        <section className="review-row">
          <h2>可能重复的现有作品</h2>
          <div className="review-list">
            {duplicateCandidates.map((candidate) => <article className="review-row" key={candidate.id}><strong>{candidate.title || `作品 #${candidate.id}`}</strong><p className="muted">ID {candidate.id} · {candidate.originalTitle || '无原名'} · {candidate.mediaGroup || 'unknown'} / {candidate.mediaType || 'unknown'} · {candidate.status || 'draft'}</p><Link className="review-link" href={`/me/studio/works/${candidate.id}`}>打开现有条目</Link></article>)}
          </div>
        </section>
      ) : null}

      <form action={createWorkAction} className="review-editor-form">
        <input name="feedbackId" type="hidden" value={feedbackID} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <section className="review-editor-section">
          <header><h2>基础身份</h2><p>公开网址使用创建后的数据库 ID；Slug 只作为兼容字段自动生成。</p></header>
          <div className="review-editor-grid">
            <label className="review-editor-field review-editor-field-wide"><span>显示标题</span><input defaultValue={suggestedTitle} maxLength={300} name="title" required /></label>
            <label className="review-editor-field"><span>原始标题</span><input maxLength={300} name="originalTitle" /></label>
            <label className="review-editor-field"><span>建议分级初值</span><select defaultValue={suggestedRank} name="rank">{rankOptions.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}</select><small>尚未人工复核时只是建议；指定主规则后以主规则等级为准。</small></label>
            <label className="review-editor-field"><span>作品大类</span><select defaultValue="unknown" name="mediaGroup">{mediaGroupOptions.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}</select></label>
            <label className="review-editor-field"><span>作品类型</span><select defaultValue="unknown" name="mediaType">{mediaTypeOptions.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}</select></label>
            <label className="review-editor-field"><span>作品形态</span><select defaultValue="unknown" name="format">{formatOptions.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}</select></label>
            <label className="review-editor-field"><span>首次日期</span><input name="firstPublishedAt" type="date" /></label>
            <label className="review-editor-field"><span>日期精度</span><select defaultValue="unknown" name="firstPublishedPrecision"><option value="day">精确到日</option><option value="month">精确到月</option><option value="year">精确到年</option><option value="unknown">未知</option></select></label>
            <label className="review-editor-field"><span>日期显示文本</span><input maxLength={120} name="firstPublishedLabel" /></label>
            <label className="review-editor-field review-editor-field-wide"><span>别名（每行一个）</span><textarea defaultValue={feedback?.evidenceSummary || ''} name="aliases" placeholder={'中文译名\n日本語タイトル\nEnglish title'} /></label>
          </div>
        </section>

        <section className="review-editor-section">
          <header><h2>作品简介</h2><p>面向读者介绍题材、设定和故事前提；不要在这里写评级结论或证据判断。</p></header>
          <div className="review-editor-grid">
            <label className="review-editor-field review-editor-field-wide"><span>作品简介（面向读者）</span><textarea maxLength={12000} name="summary" placeholder="简要介绍作品的故事、主要角色和基本设定。创建后仍可在完整编辑页继续修改。" /></label>
          </div>
        </section>

        <section className="review-editor-section">
          <header><h2>主规则（单选）与全部命中规则（多选）</h2><p>主规则决定建议等级；全部命中规则可同时保留多个成立的注意点。从反馈创建时会自动继承用户建议。</p></header>
          <RadarRuleSelector initialDecisiveRuleCode={initialDecisiveRuleCode} initialMatchedRuleCodes={initialRuleCodes} />
        </section>

        <section className="review-editor-section">
          <header><h2>来源与建档说明</h2><p>新建草稿不会公开；编辑完成核验后再决定正式发布。</p></header>
          <div className="review-editor-grid">
            <label className="review-editor-field review-editor-field-wide"><span>人工建档记录</span><textarea defaultValue={feedback?.claim || ''} maxLength={4000} name="humanReviewNote" placeholder="说明为什么创建新条目、检查过哪些重复候选，以及仍待补充的资料。" /></label>
            <label className="review-editor-field review-editor-field-wide"><span>来源链接</span><textarea defaultValue={feedbackSources} name="sourceLinks" placeholder={'Bangumi | https://...\nAniList | https://...'} /></label>
            <label className="review-editor-field review-editor-field-wide"><span>证据 / 来源备注</span><textarea defaultValue={feedback?.evidenceSummary || ''} name="evidenceNote" /></label>
            <label className="review-editor-field review-editor-field-wide"><span>搜索补充文本</span><textarea name="searchText" placeholder="日文名、英文名、作者名、平台、关键词。" /></label>
          </div>
        </section>

        <label className="review-editor-check"><input defaultChecked={Boolean(duplicateWarning)} name="duplicateConfirmed" type="checkbox" /><span>我已核对可能重复的现有作品，确认仍应创建一个独立草稿。</span></label>
        <div className="review-editor-submit"><PendingSubmitButton idleLabel="创建待复核草稿" pendingLabel="正在创建，请勿重复点击……" /><Link className="review-link" href={returnTo}>取消并返回上一级</Link></div>
      </form>
    </main>
  )
}
