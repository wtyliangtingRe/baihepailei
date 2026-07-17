import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { canonicalContentUrl } from '../../../_lib/content-identity'

export const dynamic = 'force-dynamic'

type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'trusted' | 'member'
type WorkflowStatus = 'pending' | 'triaging' | 'needs_information' | 'accepted' | 'rejected' | 'archived'
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

type RelatedWork = {
  id?: string | number
  title?: string
}

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
  updatedAt?: string
}

type Filters = {
  q: string
  status: 'all' | WorkflowStatus
  type: 'all' | string
  page: number
}

const allowedRoles = new Set<Role>(['owner', 'admin', 'editor', 'reviewer'])
const workflowLabels: Record<WorkflowStatus, string> = {
  pending: '待审核',
  triaging: '核查中',
  needs_information: '需要补充材料',
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

function roleOf(user: unknown): Role | undefined {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

function canReview(user: unknown) {
  const role = roleOf(user)
  return Boolean(role && allowedRoles.has(role))
}

function positiveInteger(value: string, fallback = 1) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const status = first(params.status)
  const type = first(params.type)
  return {
    q: first(params.q).trim().slice(0, 160),
    status: status in workflowLabels ? status as WorkflowStatus : 'all',
    type: type && type in feedbackTypeLabels ? type : 'all',
    page: positiveInteger(first(params.page)),
  }
}

function buildWhere(filters: Filters): Where {
  const and: Where[] = []
  if (filters.status !== 'all') and.push({ workflowStatus: { equals: filters.status } })
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

function queryHref(filters: Filters, page: number) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.type !== 'all') params.set('type', filters.type)
  if (page > 1) params.set('page', String(page))
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

async function reviewFeedbackAction(formData: FormData) {
  'use server'

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canReview(auth.user)) throw new Error('没有用户反馈审核权限。')

  const id = String(formData.get('id') || '').trim()
  const intent = String(formData.get('intent') || '').trim() as WorkflowStatus
  const note = String(formData.get('reviewNote') || '').trim().slice(0, 4000)
  if (!id || !(intent in workflowLabels)) throw new Error('反馈 ID 或处理动作无效。')
  if (['accepted', 'rejected', 'needs_information'].includes(intent) && !note) {
    throw new Error('采纳、未采纳或要求补充材料时必须填写审核说明。')
  }

  await payload.update({
    collection: 'feedback-submissions',
    id,
    depth: 0,
    overrideAccess: true,
    context: { reviewWorkbench: true },
    data: {
      workflowStatus: intent,
      reviewNote: note,
      reviewer: (auth.user as { id?: string | number }).id,
      reviewedAt: new Date().toISOString(),
    },
  })

  revalidatePath('/me/review/feedback')
  revalidatePath('/account')
}

export default async function FeedbackReviewPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/review/feedback')}`)
  if (!canReview(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员、编辑和审核人员。</p></section></main>
  }

  const filters = parseFilters(await searchParams)
  const [result, pending, triaging, needsInformation] = await Promise.all([
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
  ])

  const docs = result.docs as unknown as FeedbackDoc[]
  const totalPages = Math.max(1, result.totalPages || 1)
  const currentPage = Math.min(result.page || filters.page, totalPages)

  return (
    <main className="page review-workbench feedback-review-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">用户反馈审核</p>
          <h1>人工排雷、纠错和新证据集中处理</h1>
          <p className="muted">这里显示注册用户提交的全部材料。采纳反馈只记录审核结论，不会自动覆盖作品等级；需要改条目时再进入内容工作台逐项保存。</p>
          <div className="review-safety-note">“已采纳”代表材料被审核人员接受，不等于关联作品已经完成整条人工复核。</div>
        </div>
        <div className="review-stat-grid">
          <Stat label="待审核" value={pending.totalDocs} />
          <Stat label="核查中" value={triaging.totalDocs} />
          <Stat label="待补材料" value={needsInformation.totalDocs} />
          <Stat label="当前筛选" value={result.totalDocs} />
        </div>
      </section>

      <form action="/me/review/feedback" className="review-filter-panel">
        <label><span>关键词</span><input defaultValue={filters.q} name="q" placeholder="标题、结论、证据、提交者或反馈 ID" type="search" /></label>
        <label><span>处理状态</span><select defaultValue={filters.status} name="status"><option value="all">全部</option>{Object.entries(workflowLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>反馈类型</span><select defaultValue={filters.type} name="type"><option value="all">全部</option>{Object.entries(feedbackTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="review-filter-actions"><button className="review-button" type="submit">应用筛选</button><Link className="review-link" href="/me/review/feedback">重置</Link></div>
      </form>

      <div className="review-row-actions">
        <Link className="review-link" href="/me/review/content">作品、创作者与机构工作台</Link>
        <Link className="review-link" href="/admin/collections/feedback-submissions">打开 Payload 完整列表</Link>
      </div>

      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />

      <section className="review-list">
        {docs.map((doc) => {
          const workID = relationID(doc.linkedWork)
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
                {(doc.matchedRuleCodes || []).length ? <div className="feedback-review-wide"><dt>建议规则</dt><dd>{doc.matchedRuleCodes?.map((item) => item.code).filter(Boolean).join('、')}</dd></div> : null}
              </dl>

              {(doc.evidenceLinks || []).length ? <ul className="feedback-review-links">{doc.evidenceLinks?.map((item, index) => item.url ? <li key={`${item.url}-${index}`}><a href={item.url} rel="noreferrer" target="_blank">{item.label || `来源 ${index + 1}`}</a></li> : null)}</ul> : null}

              <form action={reviewFeedbackAction} className="feedback-review-action-form">
                <input name="id" type="hidden" value={String(doc.id)} />
                <label><span>审核说明</span><textarea defaultValue={doc.reviewNote || ''} maxLength={4000} name="reviewNote" placeholder="记录为什么采纳、未采纳，或还需要用户补充什么。" /></label>
                <div className="review-content-actions">
                  <button className="review-button" name="intent" type="submit" value="triaging">开始核查</button>
                  <button className="review-button" name="intent" type="submit" value="needs_information">要求补充材料</button>
                  <button className="review-button review-button-primary" name="intent" type="submit" value="accepted">采纳反馈</button>
                  <button className="review-button review-button-danger" name="intent" type="submit" value="rejected">未采纳 / 驳回</button>
                  <button className="review-button" name="intent" type="submit" value="archived">归档</button>
                </div>
              </form>

              <div className="review-row-actions">
                {workID ? <Link className="review-link" href={canonicalContentUrl('works', workID)}>查看作品前台</Link> : null}
                {workID ? <Link className="review-link" href={`/me/review/content?collection=works&q=${encodeURIComponent(workID)}`}>编辑关联作品</Link> : null}
                <Link className="review-link" href={`/admin/collections/feedback-submissions/${doc.id}`}>完整查看反馈</Link>
              </div>
            </article>
          )
        })}
        {docs.length === 0 ? <section className="review-empty"><h2>没有匹配的用户反馈</h2><p>可以切换处理状态、反馈类型，或减少关键词。</p></section> : null}
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
