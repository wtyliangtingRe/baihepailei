import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { canonicalContentUrl } from '../../../../_lib/content-identity'
import {
  hasNewWorkProposalMetadata,
  newWorkOptionLabel,
  sanitizeNewWorkProposalMetadata,
  type NewWorkProposalMetadata,
} from '@/lib/newWorkProposal'

export const dynamic = 'force-dynamic'

type Role = 'owner' | 'admin' | 'editor' | 'member'
type Relation = { id?: string | number; title?: string; displayName?: string }
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type FeedbackDoc = {
  id: string | number
  feedbackType?: string
  targetTitle?: string
  newWorkMetadata?: NewWorkProposalMetadata
  proposedGrade?: string
  matchedRuleCodes?: Array<{ code?: string }>
  claim?: string
  evidenceSummary?: string
  evidenceLinks?: Array<{ label?: string; url?: string }>
  containsSpoilers?: boolean
  submitterName?: string
  submitter?: string | number | Relation
  workflowStatus?: string
  reviewNote?: string
  reviewer?: string | number | Relation
  linkedWork?: string | number | Relation
  reviewedAt?: string
  createdAt?: string
  updatedAt?: string
}

const allowedRoles = new Set<Role>(['owner', 'admin', 'editor'])
const workflowLabels: Record<string, string> = {
  pending: '待审核', triaging: '核查中', needs_information: '需要补充材料',
  accepted: '已采纳', rejected: '未采纳', archived: '已归档',
}
const feedbackTypeLabels: Record<string, string> = {
  radar_evidence: '人工排雷 / 新证据', rating_correction: '分级或规则纠错',
  new_work: '新增作品建议', content_correction: '资料错误', broken_link: '链接失效',
  display_problem: '页面问题', other: '其他',
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function roleOf(user: unknown) {
  return user && typeof user === 'object' ? (user as { role?: Role }).role : undefined
}

function relationID(value: FeedbackDoc['linkedWork']) {
  if (value && typeof value === 'object') return String(value.id || '')
  return value === undefined || value === null ? '' : String(value)
}

function relationLabel(value: FeedbackDoc['linkedWork'] | FeedbackDoc['reviewer']) {
  if (!value || typeof value !== 'object') return ''
  return String(value.title || value.displayName || '')
}

function formatDate(value?: string) {
  if (!value) return '未记录'
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'medium' }).format(new Date(value))
  } catch {
    return value
  }
}

function proposalDate(metadata: NewWorkProposalMetadata) {
  return metadata.firstPublishedLabel || metadata.firstPublishedAt || '未提供'
}

export default async function FeedbackDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: PageSearchParams }) {
  const { id } = await params
  const rawSearch = await searchParams
  const createdWork = first(rawSearch.createdWork)
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent(`/me/review/feedback/${id}`)}`)
  const role = roleOf(auth.user)
  if (!role || !allowedRoles.has(role)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员、编辑和审核人员。</p></section></main>
  }

  let doc: FeedbackDoc
  try {
    doc = await payload.findByID({ collection: 'feedback-submissions', id, depth: 2, overrideAccess: true }) as unknown as FeedbackDoc
  } catch {
    notFound()
  }

  const workID = relationID(doc.linkedWork)
  const links = (doc.evidenceLinks || []).filter((item) => item.url)
  const rules = [...new Set((doc.matchedRuleCodes || []).map((item) => String(item.code || '').trim()).filter(Boolean))]
  const decisiveRule = rules[0] || ''
  const isAccepted = doc.workflowStatus === 'accepted'
  const isNewWork = doc.feedbackType === 'new_work'
  const proposal = sanitizeNewWorkProposalMetadata(doc.newWorkMetadata)
  const hasProposal = isNewWork && hasNewWorkProposalMetadata(proposal)
  const mayUsePayload = role === 'owner' || role === 'admin'
  const returnTo = `/me/review/feedback/${doc.id}`

  return (
    <main className="page review-workbench feedback-detail-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">用户反馈完整详情</p>
          <h1>{doc.targetTitle || '未命名反馈'}</h1>
          <p className="muted">反馈 ID：{doc.id}</p>
          <div className="review-chip-list">
            <span>{feedbackTypeLabels[doc.feedbackType || 'other'] || doc.feedbackType}</span>
            <span>{workflowLabels[doc.workflowStatus || 'pending'] || doc.workflowStatus}</span>
            {!isNewWork && doc.proposedGrade ? <span>建议 {doc.proposedGrade} 级</span> : null}
            {doc.containsSpoilers ? <span className="review-row-chip-warning">含剧透</span> : null}
          </div>
        </div>
      </section>

      {createdWork ? (
        <div className="review-action-message review-action-message-success" role="status">
          已创建待复核作品草稿 #{createdWork}，并返回本反馈。草稿尚未公开。
          <Link href={`/me/studio/works/${createdWork}?returnTo=${encodeURIComponent(returnTo)}`}>打开草稿</Link>
        </div>
      ) : null}

      {isAccepted ? (
        <section className="review-safety-note" role="status">
          <strong>“已采纳”只表示材料成立，不会自动改作品。</strong>
          <p>{isNewWork && !workID ? '这是一份新作品申请。下一步由编辑在内容管理中检查重复候选并创建待复核草稿。' : '请进入关联作品的站内内容管理，把采纳结论落实到正式等级、标题、来源或可见性字段。'}</p>
          {workID ? <Link className="review-button review-button-primary" href={`/me/studio/works/${workID}?returnTo=${encodeURIComponent(returnTo)}`}>现在编辑关联作品</Link> : null}
          {isNewWork && !workID ? <Link className="review-button review-button-primary" href={`/me/studio/works/new?feedbackId=${encodeURIComponent(String(doc.id))}&returnTo=${encodeURIComponent(returnTo)}`}>检查重复并创建草稿</Link> : null}
        </section>
      ) : null}

      {hasProposal ? (
        <section className="review-row">
          <h2>用户提交的新作品建档资料</h2>
          <p className="muted">这些是事实资料提议，不包含评级、规则命中或 AI Radar 结论；创建草稿时会自动预填。</p>
          <dl className="feedback-review-facts">
            <div><dt>显示标题</dt><dd>{doc.targetTitle || '未填写'}</dd></div>
            <div><dt>原始标题</dt><dd>{proposal.originalTitle || '未填写'}</dd></div>
            <div><dt>作品大类</dt><dd>{newWorkOptionLabel(proposal.mediaGroup || 'unknown')}</dd></div>
            <div><dt>作品类型</dt><dd>{newWorkOptionLabel(proposal.mediaType || 'unknown')}</dd></div>
            <div><dt>作品形态</dt><dd>{newWorkOptionLabel(proposal.format || 'unknown')}</dd></div>
            <div><dt>首次发行</dt><dd>{proposalDate(proposal)} · {newWorkOptionLabel(proposal.firstPublishedPrecision || 'unknown')}</dd></div>
            <div className="feedback-review-wide"><dt>别名与译名</dt><dd>{proposal.aliases?.length ? proposal.aliases.join('、') : '未填写'}</dd></div>
            <div className="feedback-review-wide"><dt>作品简介</dt><dd>{proposal.summary || '未填写'}</dd></div>
            <div className="feedback-review-wide"><dt>搜索补充文本与外部身份</dt><dd>{proposal.searchText || '未填写'}</dd></div>
          </dl>
        </section>
      ) : null}

      <section className="review-row">
        <dl className="feedback-review-facts">
          <div><dt>提交者</dt><dd>{doc.submitterName || relationLabel(doc.submitter) || '注册用户'}</dd></div>
          <div><dt>关联作品</dt><dd>{workID ? `${relationLabel(doc.linkedWork) || doc.targetTitle || '作品'}（站内 ID ${workID}）` : '尚未关联站内作品'}</dd></div>
          <div><dt>提交时间</dt><dd>{formatDate(doc.createdAt)}</dd></div>
          <div><dt>最后更新</dt><dd>{formatDate(doc.updatedAt)}</dd></div>
          <div className="feedback-review-wide"><dt>{isNewWork ? '收录理由与重复核查说明' : '希望网站核实的结论'}</dt><dd>{doc.claim || '未填写'}</dd></div>
          <div className="feedback-review-wide"><dt>{isNewWork ? '来源、版本与身份备注' : '证据说明'}</dt><dd>{doc.evidenceSummary || '未填写'}</dd></div>
          {!isNewWork ? <div className="feedback-review-wide"><dt>主规则 / 决定性规则</dt><dd>{decisiveRule || '未指定'}</dd></div> : null}
          {!isNewWork ? <div className="feedback-review-wide"><dt>全部命中规则</dt><dd>{rules.length ? rules.join('、') : '未指定'}</dd></div> : null}
          <div className="feedback-review-wide"><dt>当前审核说明</dt><dd>{doc.reviewNote || '尚未填写'}</dd></div>
          <div><dt>审核人</dt><dd>{relationLabel(doc.reviewer) || '尚未分配'}</dd></div>
          <div><dt>审核时间</dt><dd>{formatDate(doc.reviewedAt)}</dd></div>
        </dl>

        <section className="feedback-detail-sources">
          <h2>{isNewWork ? '全部作品来源链接' : '全部证据链接'}</h2>
          {links.length ? <ol>{links.map((item, index) => <li key={`${item.url}-${index}`}><a href={item.url} rel="noreferrer" target="_blank">{item.label || item.url}</a><small>{item.url}</small></li>)}</ol> : <p className="muted">没有提交外部来源链接。</p>}
        </section>

        <div className="review-row-actions">
          <Link className="review-link" href="/me/review/feedback">返回反馈审核队列</Link>
          {workID ? <Link className="review-link" href={canonicalContentUrl('works', workID)}>查看关联作品</Link> : null}
          {workID ? <Link className="review-link" href={`/me/studio/works/${workID}?returnTo=${encodeURIComponent(returnTo)}`}>编辑关联作品</Link> : null}
          {isNewWork && !workID ? <Link className="review-link" href={`/me/studio/works/new?feedbackId=${encodeURIComponent(String(doc.id))}&returnTo=${encodeURIComponent(returnTo)}`}>创建作品草稿</Link> : null}
          {mayUsePayload ? <Link className="review-link" href={`/admin/collections/feedback-submissions/${doc.id}`}>Payload 原始记录</Link> : null}
        </div>
      </section>
    </main>
  )
}
