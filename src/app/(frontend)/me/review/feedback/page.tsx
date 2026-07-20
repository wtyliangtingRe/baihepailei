import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { isEditor } from '@/access/roles'

import { beginFeedbackReviewAction } from './review-actions'

export const dynamic = 'force-dynamic'

type WorkflowStatus = 'pending' | 'triaging' | 'needs_information' | 'accepted' | 'rejected' | 'archived'
type FeedbackQueue = 'active' | 'processed' | 'all'
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type RelatedWork = { id?: string | number; title?: string }
type FeedbackDoc = {
  id: string | number
  feedbackType?: string
  targetTitle?: string
  proposedGrade?: string
  matchedRuleCodes?: Array<{ code?: string }>
  claim?: string
  evidenceSummary?: string
  evidenceLinks?: Array<{ label?: string; url?: string }>
  containsSpoilers?: boolean
  submitterName?: string
  workflowStatus?: WorkflowStatus
  reviewNote?: string
  linkedWork?: string | number | RelatedWork
  createdAt?: string
}
type Filters = {
  queue: FeedbackQueue
  q: string
  status: 'all' | WorkflowStatus
  type: 'all' | string
  page: number
}

const activeStatuses: WorkflowStatus[] = ['pending', 'triaging', 'needs_information']
const processedStatuses: WorkflowStatus[] = ['accepted', 'rejected', 'archived']
const workflowLabels: Record<WorkflowStatus, string> = {
  pending: '待审核',
  triaging: '核查中',
  needs_information: '等待用户补充',
  accepted: '已采纳',
  rejected: '未采纳',
  archived: '已归档',
}
const feedbackTypeLabels: Record<string, string> = {
  radar_evidence: '人工排雷 / 新证据',
  rating_correction: '分级或规则纠错',
  new_work: '新增作品建议',
  content_correction: '资料错误',
  broken_link: '链接失效',
  display_problem: '页面问题',
  other: '其他',
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function positiveInteger(value: string, fallback = 1) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const requestedQueue = first(params.queue)
  const status = first(params.status)
  const type = first(params.type)
  return {
    queue: requestedQueue === 'processed' || requestedQueue === 'all' ? requestedQueue : 'active',
    q: first(params.q).trim().slice(0, 160),
    status: status in workflowLabels ? status as WorkflowStatus : 'all',
    type: type && type in feedbackTypeLabels ? type : 'all',
    page: positiveInteger(first(params.page)),
  }
}

function buildWhere(filters: Filters): Where {
  const and: Where[] = []
  if (filters.status !== 'all') and.push({ workflowStatus: { equals: filters.status } })
  else if (filters.queue === 'active') and.push({ workflowStatus: { in: activeStatuses } })
  else if (filters.queue === 'processed') and.push({ workflowStatus: { in: processedStatuses } })
  if (filters.type !== 'all') and.push({ feedbackType: { equals: filters.type } })
  if (filters.q) {
    const or: Where[] = [
      { targetTitle: { like: filters.q } },
      { claim: { like: filters.q } },
      { evidenceSummary: { like: filters.q } },
      { submitterName: { like: filters.q } },
    ]
    if (/^\d+$/u.test(filters.q)) or.push({ id: { equals: filters.q } })
    and.push({ or })
  }
  return and.length ? { and } : {}
}

function queryHref(filters: Filters, page: number, overrides: Partial<Filters> = {}) {
  const next = { ...filters, ...overrides, page }
  const params = new URLSearchParams()
  if (next.queue !== 'active') params.set('queue', next.queue)
  if (next.q) params.set('q', next.q)
  if (next.status !== 'all') params.set('status', next.status)
  if (next.type !== 'all') params.set('type', next.type)
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return query ? `/me/review/feedback?${query}` : '/me/review/feedback'
}

function relationID(value: FeedbackDoc['linkedWork']) {
  if (value && typeof value === 'object') return String(value.id || '')
  return value === undefined || value === null ? '' : String(value)
}

function relationTitle(value: FeedbackDoc['linkedWork']) {
  return value && typeof value === 'object' ? String(value.title || '') : ''
}

function formatDate(value?: string) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

export default async function FeedbackReviewPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/review/feedback')}`)
  if (!isEditor(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员和编辑。</p></section></main>
  }

  const rawParams = await searchParams
  const filters = parseFilters(rawParams)
  const reviewError = first(rawParams.reviewError)
  const [result, pending, triaging, needsInformation, processed, all] = await Promise.all([
    payload.find({
      collection: 'feedback-submissions',
      depth: 1,
      limit: 15,
      page: filters.page,
      pagination: true,
      overrideAccess: true,
      sort: '-createdAt',
      where: buildWhere(filters),
    }),
    payload.count({ collection: 'feedback-submissions', overrideAccess: true, where: { workflowStatus: { equals: 'pending' } } }),
    payload.count({ collection: 'feedback-submissions', overrideAccess: true, where: { workflowStatus: { equals: 'triaging' } } }),
    payload.count({ collection: 'feedback-submissions', overrideAccess: true, where: { workflowStatus: { equals: 'needs_information' } } }),
    payload.count({ collection: 'feedback-submissions', overrideAccess: true, where: { workflowStatus: { in: processedStatuses } } }),
    payload.count({ collection: 'feedback-submissions', overrideAccess: true }),
  ])

  const docs = result.docs as unknown as FeedbackDoc[]
  const totalPages = Math.max(1, result.totalPages || 1)
  const currentPage = Math.min(result.page || filters.page, totalPages)
  const activeTotal = pending.totalDocs + triaging.totalDocs + needsInformation.totalDocs
  const currentReturnTo = queryHref(filters, currentPage)

  return (
    <main className="page review-workbench feedback-review-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">用户反馈审核</p>
          <h1>先进入详情，再作出处理决定</h1>
          <p className="muted">队列页不再同时摆放采纳、驳回、归档和补充材料按钮。点击“开始核查”后进入完整详情，读完材料，再在页面底部保存或作出决定。</p>
          <div className="review-safety-note">这样会多一次明确进入动作，但能显著降低连续处理时点错按钮、把相邻反馈误判为已处理的风险。</div>
        </div>
        <div className="review-stat-grid">
          <Stat label="待审核" value={pending.totalDocs} />
          <Stat label="核查中" value={triaging.totalDocs} />
          <Stat label="待补材料" value={needsInformation.totalDocs} />
          <Stat label="当前筛选" value={result.totalDocs} />
        </div>
      </section>

      {reviewError ? <div className="review-action-message review-action-message-error" role="alert">反馈 ID 或开始核查动作无效，请刷新页面后重试。</div> : null}

      <nav className="review-queue-tabs" aria-label="用户反馈队列">
        <Link aria-current={filters.queue === 'active' ? 'page' : undefined} href={queryHref(filters, 1, { queue: 'active', status: 'all' })}><span>待处理</span><strong>{activeTotal.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.queue === 'processed' ? 'page' : undefined} href={queryHref(filters, 1, { queue: 'processed', status: 'all' })}><span>已处理</span><strong>{processed.totalDocs.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.queue === 'all' ? 'page' : undefined} href={queryHref(filters, 1, { queue: 'all', status: 'all' })}><span>全部历史</span><strong>{all.totalDocs.toLocaleString('zh-CN')}</strong></Link>
      </nav>

      <form action="/me/review/feedback" className="review-filter-panel">
        <input name="queue" type="hidden" value={filters.queue} />
        <label><span>关键词</span><input defaultValue={filters.q} name="q" placeholder="标题、结论、证据、提交者或反馈 ID" type="search" /></label>
        <label><span>精确处理状态</span><select defaultValue={filters.status} name="status"><option value="all">沿用当前队列</option>{Object.entries(workflowLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>反馈类型</span><select defaultValue={filters.type} name="type"><option value="all">全部</option>{Object.entries(feedbackTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="review-filter-actions"><button className="review-button" type="submit">应用筛选</button><Link className="review-link" href={queryHref(filters, 1, { q: '', status: 'all', type: 'all' })}>清除细筛选</Link></div>
      </form>

      <div className="review-row-actions"><Link className="review-link" href="/me/review/content">AI / 内容审核</Link><Link className="review-link" href="/admin/collections/feedback-submissions">Payload 高级维护</Link></div>
      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />

      <section className="review-list">
        {docs.map((doc) => {
          const workID = relationID(doc.linkedWork)
          const active = activeStatuses.includes(doc.workflowStatus || 'pending')
          const detailHref = `/me/review/feedback/${doc.id}?returnTo=${encodeURIComponent(currentReturnTo)}`
          return (
            <article className="review-row feedback-review-row" key={doc.id}>
              <header className="review-row-header">
                <div className="review-row-title"><h2>{doc.targetTitle || '未命名反馈'}</h2><small>反馈 ID：{doc.id} · {formatDate(doc.createdAt)}</small></div>
                <div className="review-chip-list"><span className="review-row-chip">{feedbackTypeLabels[doc.feedbackType || 'other'] || doc.feedbackType}</span><span className="review-row-chip">{workflowLabels[doc.workflowStatus || 'pending']}</span>{doc.proposedGrade ? <span className="review-row-chip">建议 {doc.proposedGrade} 级</span> : null}{doc.containsSpoilers ? <span className="review-row-chip review-row-chip-warning">含剧透</span> : null}</div>
              </header>

              <dl className="feedback-review-facts">
                <div><dt>提交者</dt><dd>{doc.submitterName || '注册用户'}</dd></div>
                <div><dt>关联作品</dt><dd>{workID ? `${relationTitle(doc.linkedWork) || doc.targetTitle || '作品'}（ID ${workID}）` : '尚未关联站内作品'}</dd></div>
                <div className="feedback-review-wide"><dt>希望核实的结论</dt><dd>{doc.claim || '未填写'}</dd></div>
                {doc.evidenceSummary ? <div className="feedback-review-wide"><dt>证据说明</dt><dd>{doc.evidenceSummary}</dd></div> : null}
              </dl>

              <div className="review-content-actions">
                {doc.workflowStatus === 'pending' || doc.workflowStatus === 'needs_information' ? (
                  <form action={beginFeedbackReviewAction}>
                    <input name="id" type="hidden" value={String(doc.id)} />
                    <input name="returnTo" type="hidden" value={currentReturnTo} />
                    <button className="review-button review-button-primary" type="submit">开始核查</button>
                  </form>
                ) : <Link className="review-button review-button-primary" href={detailHref}>{active ? '继续核查' : '查看处理记录'}</Link>}
              </div>
            </article>
          )
        })}
        {docs.length === 0 ? <section className="review-empty"><h2>{filters.queue === 'active' ? '待处理反馈已经清空' : '没有匹配的用户反馈'}</h2><p>{filters.queue === 'active' ? '采纳、驳回和归档的表单都保存在“已处理”中。' : '可以切换队列、处理状态、反馈类型，或减少关键词。'}</p></section> : null}
      </section>

      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="review-stat"><span>{label}</span><strong>{value.toLocaleString('zh-CN')}</strong></div>
}

function Pagination({ filters, currentPage, totalPages }: { filters: Filters; currentPage: number; totalPages: number }) {
  if (totalPages <= 1) return null
  return <nav className="review-pagination" aria-label="用户反馈审核分页">{currentPage > 1 ? <Link href={queryHref(filters, currentPage - 1)}>上一页</Link> : null}<span aria-current="page">第 {currentPage} / {totalPages} 页</span>{currentPage < totalPages ? <Link href={queryHref(filters, currentPage + 1)}>下一页</Link> : null}</nav>
}
