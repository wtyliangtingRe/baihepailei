import configPromise from '@payload-config'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { canonicalContentUrl } from '../../../_lib/content-identity'

export const dynamic = 'force-dynamic'

type Role = 'owner' | 'admin' | 'editor' | 'member'
type WorkflowStatus = 'pending' | 'triaging' | 'needs_information' | 'accepted' | 'rejected' | 'archived'
type ReviewIntent = WorkflowStatus | 'accept_create_draft'
type FeedbackQueue = 'active' | 'processed' | 'all'
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
  queue: FeedbackQueue
  q: string
  status: 'all' | WorkflowStatus
  type: 'all' | string
  page: number
}

const allowedRoles = new Set<Role>(['owner', 'admin', 'editor'])
const activeStatuses: WorkflowStatus[] = ['pending', 'triaging', 'needs_information']
const processedStatuses: WorkflowStatus[] = ['accepted', 'rejected', 'archived']
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
  if (filters.status !== 'all') {
    and.push({ workflowStatus: { equals: filters.status } })
  } else if (filters.queue === 'active') {
    and.push({ workflowStatus: { in: activeStatuses } })
  } else if (filters.queue === 'processed') {
    and.push({ workflowStatus: { in: processedStatuses } })
  }
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

function safeReturnTo(value: FormDataEntryValue | null) {
  const requested = String(value || '')
  return requested === '/me/review/feedback' || requested.startsWith('/me/review/feedback?')
    ? requested
    : '/me/review/feedback'
}

function actionResultHref(returnTo: string, key: 'reviewError' | 'reviewed', value: string, id?: string) {
  const [pathname, rawQuery = ''] = returnTo.split('?', 2)
  const params = new URLSearchParams(rawQuery)
  params.set(key, value)
  if (id) params.set('reviewId', id)
  return `${pathname}?${params.toString()}`
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

function draftSlug(title: string, id: string) {
  const normalized = title.normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 56) || 'work'
  return `feedback-${normalized}-${id}-${randomUUID().slice(0, 8)}`
}

function newWorkCandidateWhere(title: string): Where {
  return {
    or: [
      { title: { like: title } },
      { originalTitle: { like: title } },
      { searchText: { like: title } },
    ],
  }
}

async function reviewFeedbackAction(formData: FormData) {
  'use server'

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canReview(auth.user)) throw new Error('没有用户反馈审核权限。')

  const id = String(formData.get('id') || '').trim()
  const intent = String(formData.get('intent') || '').trim() as ReviewIntent
  const note = String(formData.get('reviewNote') || '').trim().slice(0, 4000)
  const returnTo = safeReturnTo(formData.get('returnTo'))
  const actorID = Number((auth.user as { id?: string | number }).id)
  const feedbackID = Number(id)
  if (!id || !Number.isSafeInteger(feedbackID) || feedbackID <= 0 || (!(intent in workflowLabels) && intent !== 'accept_create_draft')) {
    redirect(actionResultHref(returnTo, 'reviewError', 'invalid_action', id))
  }
  if (!Number.isSafeInteger(actorID) || actorID <= 0) {
    throw new Error('当前账户缺少可用于审计的数字 ID。')
  }
  if (intent === 'needs_information' && !note) {
    redirect(actionResultHref(returnTo, 'reviewError', 'note_required', id))
  }

  if (intent === 'accept_create_draft') {
    const feedback = await payload.findByID({
      collection: 'feedback-submissions',
      id: feedbackID,
      depth: 0,
      overrideAccess: true,
    }) as unknown as FeedbackDoc
    const existingWorkID = relationID(feedback.linkedWork)
    if (feedback.feedbackType !== 'new_work' || existingWorkID) {
      redirect(actionResultHref(returnTo, 'reviewError', 'draft_not_available', id))
    }

    const title = String(feedback.targetTitle || '').trim()
    if (!title) redirect(actionResultHref(returnTo, 'reviewError', 'invalid_action', id))

    const duplicates = await payload.find({
      collection: 'works',
      depth: 0,
            limit: 8,
      page: 1,
      pagination: false,
      overrideAccess: true,
      where: newWorkCandidateWhere(title),
    })
    if (duplicates.docs.length) {
      const duplicateNote = '发现可能重复的现有作品；未自动创建，已转入预填草稿页进行人工确认。'
      await payload.update({
        collection: 'feedback-submissions',
        id: feedbackID,
        depth: 0,
        overrideAccess: true,
        context: { reviewWorkbench: true, auditActorID: actorID },
        data: {
          workflowStatus: 'triaging',
          reviewer: actorID,
          reviewedAt: new Date().toISOString(),
          reviewNote: note || duplicateNote,
        },
      })
      const target = new URLSearchParams({
        feedbackId: id,
        q: title,
        duplicateWarning: 'true',
        returnTo: `/me/review/feedback/${id}`,
      })
      redirect(`/me/studio/works/new?${target.toString()}`)
    }

    const sourceLinks = (feedback.evidenceLinks || [])
      .filter((item) => item?.url)
      .map((item, index) => ({ label: String(item.label || `用户来源 ${index + 1}`).slice(0, 120), url: String(item.url).slice(0, 1000) }))
    const claim = String(feedback.claim || '').trim()
    const evidenceSummary = String(feedback.evidenceSummary || '').trim()
    const created = await payload.create({
      collection: 'works',
      depth: 0,
      draft: false,
      overrideAccess: true,
      context: { firstPartyStudio: true, feedbackIntake: true, feedbackID: id, auditActorID: actorID },
      data: {
        title,
        slug: draftSlug(title, id),
        siteId: `feedback:${id}:${randomUUID().slice(0, 12)}`,
        rank: 'unknown',
        reviewStatus: 'pending',
        ratingNotice: 'none',
        evidenceStrength: 'unassessed',
        mediaGroup: 'unknown',
        mediaType: 'unknown',
        format: 'unknown',
        firstPublishedPrecision: 'unknown',
        status: 'draft',
        isLiteVisible: false,
        isFullVisible: false,
        hasEvidence: sourceLinks.length > 0 || Boolean(evidenceSummary),
        sourceLinks,
        evidenceNote: evidenceSummary,
        searchText: [title, claim, evidenceSummary].filter(Boolean).join('\n'),
        humanReviewNote: `[${new Date().toISOString()}] 由用户新作品申请 #${id} 采纳生成草稿；提交者材料需继续核验。\n${claim}`.slice(0, 4000),
        importBatch: `feedback-intake:${id}`,
      } as never,
    })
    const createdID = Number(created.id)
    if (!Number.isSafeInteger(createdID) || createdID <= 0) throw new Error('草稿创建后未取得有效作品 ID。')

    const acceptedNote = note || `已采纳并创建预填作品草稿 #${createdID}；未公开、未人工评级、未写入 AI 结论。`
    await payload.update({
      collection: 'feedback-submissions',
      id: feedbackID,
      depth: 0,
      overrideAccess: true,
      context: { reviewWorkbench: true, auditActorID: actorID },
      data: {
        workflowStatus: 'accepted',
        linkedWork: createdID,
        reviewer: actorID,
        reviewedAt: new Date().toISOString(),
        reviewNote: acceptedNote,
      },
    })
    revalidatePath('/me/review/feedback')
    revalidatePath('/me/studio')
    revalidatePath(`/me/studio/works/${createdID}`)
    redirect(`/me/review/feedback/${id}?createdWork=${createdID}`)
  }

  const workflowIntent = intent as WorkflowStatus
  const defaultNotes: Partial<Record<WorkflowStatus, string>> = {
    accepted: '已采纳，待在关联内容条目中落实。',
    rejected: '未采纳；审核人员未填写补充说明。',
  }
  const effectiveNote = note || defaultNotes[workflowIntent] || ''

  try {
    await payload.update({
      collection: 'feedback-submissions',
      id: feedbackID,
      depth: 0,
      overrideAccess: true,
      context: { reviewWorkbench: true, auditActorID: (auth.user as { id?: string | number }).id },
      data: {
        workflowStatus: workflowIntent,
        reviewNote: effectiveNote,
        reviewer: actorID,
        reviewedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Feedback review update failed', error)
    redirect(actionResultHref(returnTo, 'reviewError', 'save_failed', id))
  }

  revalidatePath('/me/review/feedback')
  revalidatePath('/account')
  redirect(actionResultHref(returnTo, 'reviewed', intent, id))
}

export default async function FeedbackReviewPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/review/feedback')}`)
  if (!canReview(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员、编辑和审核人员。</p></section></main>
  }

  const rawParams = await searchParams
  const filters = parseFilters(rawParams)
  const reviewError = first(rawParams.reviewError)
  const reviewed = first(rawParams.reviewed)
  const reviewID = first(rawParams.reviewId)
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
          <h1>把待处理表单和已处理历史分开</h1>
          <p className="muted">默认只显示仍需处理的人工排雷、纠错和新证据。采纳、驳回或归档后会离开当前队列，但审核结论仍可在“已处理”中追溯。</p>
          <div className="review-safety-note">“已采纳”代表材料被审核人员接受，不等于关联作品已经完成整条人工复核，也不会自动覆盖作品等级。</div>
        </div>
        <div className="review-stat-grid">
          <Stat label="待审核" value={pending.totalDocs} />
          <Stat label="核查中" value={triaging.totalDocs} />
          <Stat label="待补材料" value={needsInformation.totalDocs} />
          <Stat label="当前筛选" value={result.totalDocs} />
        </div>
      </section>

      {reviewError ? (
        <div className="review-action-message review-action-message-error" role="alert">
          {reviewError === 'note_required'
            ? `反馈 ${reviewID || ''} 选择“要求补充材料”时，请先写明需要用户补充什么。`
            : reviewError === 'save_failed'
              ? `反馈 ${reviewID || ''} 保存失败，请刷新后重试；若仍失败请查看开发服务器日志。`
              : '反馈 ID 或处理动作无效，请刷新页面后重试。'}
        </div>
      ) : null}
      {reviewed ? <div className="review-action-message review-action-message-success" role="status">反馈 {reviewID || ''} 已更新为“{workflowLabels[reviewed as WorkflowStatus] || reviewed}”；完成态表单会自动离开待处理队列。</div> : null}

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

      <div className="review-row-actions">
        <Link className="review-link" href="/me/review/content">作品、创作者与机构工作台</Link>
        <Link className="review-link" href="/admin/collections/feedback-submissions">Payload 高级维护</Link>
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
                <input name="returnTo" type="hidden" value={currentReturnTo} />
                <label><span>审核说明</span><textarea defaultValue={doc.reviewNote || ''} maxLength={4000} name="reviewNote" placeholder="采纳和驳回可直接操作；要求补充材料时请写明需要什么。" /></label>
                <div className="review-content-actions">
                  <button className="review-button" name="intent" type="submit" value="triaging">开始核查</button>
                  <button className="review-button" name="intent" type="submit" value="needs_information">要求补充材料</button>
                  {doc.feedbackType === 'new_work' && !workID ? (
                    <button className="review-button review-button-primary" name="intent" type="submit" value="accept_create_draft">采纳并生成预填草稿</button>
                  ) : (
                    <button className="review-button review-button-primary" name="intent" type="submit" value="accepted">采纳反馈并移入已处理</button>
                  )}
                  <button className="review-button review-button-danger" name="intent" type="submit" value="rejected">驳回并移入已处理</button>
                  <button className="review-button" name="intent" type="submit" value="archived">归档并移入已处理</button>
                </div>
              </form>

              <div className="review-row-actions">
                {workID ? <Link className="review-link" href={canonicalContentUrl('works', workID)}>查看作品前台</Link> : null}
                {workID ? <Link className="review-link" href={`/me/review/content/works/${workID}?returnTo=${encodeURIComponent(currentReturnTo)}`}>站内编辑关联作品</Link> : null}
                <Link className="review-link" href={`/me/review/feedback/${doc.id}`}>站内完整详情</Link>
                <Link className="review-link" href={`/admin/collections/feedback-submissions/${doc.id}`}>Payload 原始记录</Link>
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
