import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { isEditor } from '@/access/roles'

import { beginContentReviewAction } from './review-actions'
import { mergedWorkReference, type ReviewableContentDoc } from './review-utils'

export const dynamic = 'force-dynamic'

type ReviewQueue = 'pending' | 'processed' | 'all'
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type WorkDoc = ReviewableContentDoc & {
  id: string | number
  title?: string
  slug?: string
  siteId?: string
  rank?: string
  reviewStatus?: string
  ratingNotice?: string
  catalogStatus?: string
  radarAssessment?: {
    assessedAt?: string
    suggestedGrade?: string
    confidencePercent?: number
    decisiveRuleCode?: string
    decisiveRuleReason?: string
  } | null
  humanAssessment?: { grade?: string; status?: string } | null
  updatedAt?: string
}

type Filters = {
  queue: ReviewQueue
  q: string
  page: number
  perPage: 20 | 50 | 100
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
  const requestedPerPage = positiveInteger(first(params.perPage), 50)
  return {
    queue: requestedQueue === 'processed' || requestedQueue === 'all' ? requestedQueue : 'pending',
    q: first(params.q).trim().slice(0, 160),
    page: positiveInteger(first(params.page)),
    perPage: [20, 50, 100].includes(requestedPerPage) ? requestedPerPage as Filters['perPage'] : 50,
  }
}

function buildWhere(filters: Filters): Where {
  const and: Where[] = [
    { 'radarAssessment.assessedAt': { exists: true } },
    { catalogStatus: { not_equals: 'archived' } },
  ]

  if (filters.q) {
    const or: Where[] = [
      { title: { like: filters.q } },
      { slug: { like: filters.q } },
      { siteId: { like: filters.q } },
    ]
    if (/^\d+$/u.test(filters.q)) or.push({ id: { equals: filters.q } })
    and.push({ or })
  }

  if (filters.queue === 'pending') {
    and.push({ reviewStatus: { equals: 'pending' } })
    and.push({ ratingNotice: { equals: 'ai_synthesized_pending_review' } })
  } else if (filters.queue === 'processed') {
    and.push({ reviewStatus: { in: ['reviewed', 'disputed'] } })
  }

  return { and }
}

function countWhere(queue: ReviewQueue): Where {
  return buildWhere({ queue, q: '', page: 1, perPage: 20 })
}

function listHref(filters: Filters, overrides: Partial<Filters> = {}) {
  const next = { ...filters, ...overrides }
  const params = new URLSearchParams()
  if (next.queue !== 'pending') params.set('queue', next.queue)
  if (next.q) params.set('q', next.q)
  if (next.perPage !== 50) params.set('perPage', String(next.perPage))
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return query ? `/me/review/content?${query}` : '/me/review/content'
}

function humanStatus(doc: WorkDoc) {
  if (doc.humanAssessment?.status === 'reviewed' || doc.reviewStatus === 'reviewed') return '人工已复核'
  if (doc.humanAssessment?.status === 'disputed' || doc.reviewStatus === 'disputed') return '人工标记争议'
  return '尚无人工评级'
}

export default async function ContentReviewPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/review/content')}`)
  if (!isEditor(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员和编辑。</p></section></main>
  }

  const raw = await searchParams
  const filters = parseFilters(raw)
  const reviewError = first(raw.reviewError)
  const [result, pending, processed, all] = await Promise.all([
    payload.find({
      collection: 'works',
      depth: 0,
      limit: filters.perPage,
      page: filters.page,
      pagination: true,
      overrideAccess: true,
      sort: '-radarAssessment.assessedAt',
      where: buildWhere(filters),
    }),
    payload.find({ collection: 'works', depth: 0, limit: 1, page: 1, pagination: true, overrideAccess: true, where: countWhere('pending') }),
    payload.find({ collection: 'works', depth: 0, limit: 1, page: 1, pagination: true, overrideAccess: true, where: countWhere('processed') }),
    payload.find({ collection: 'works', depth: 0, limit: 1, page: 1, pagination: true, overrideAccess: true, where: countWhere('all') }),
  ])

  const docs = result.docs as unknown as WorkDoc[]
  const totalPages = Math.max(1, result.totalPages || 1)
  const currentPage = Math.min(result.page || filters.page, totalPages)
  const returnTo = listHref(filters, { page: currentPage })

  return (
    <main className="page review-workbench">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">AI 评级人工复核</p>
          <h1>已有 AI 评级，等待人工确认</h1>
          <p className="muted">这里只收录具备受控 AI 评估时间、但尚未记录人工评级的作品。作品始终保持发布；本通道只负责快速记录人工采用等级、说明或争议。</p>
          <div className="review-safety-note">普通未评估作品、创作者和机构不再进入这个队列。人工复核不会覆盖 AI 原始记录，也不会改变临时/正式阶段。</div>
        </div>
        <div className="review-stat-grid"><Stat label="等待人工复核" value={pending.totalDocs} /><Stat label="当前页" value={docs.length} /></div>
      </section>

      {reviewError ? <div className="review-action-message review-action-message-error" role="alert">无法进入该作品的 AI 评级人工复核页，请刷新后重试。</div> : null}

      <nav className="review-queue-tabs" aria-label="AI 评级人工复核队列">
        <Link aria-current={filters.queue === 'pending' ? 'page' : undefined} href={listHref(filters, { queue: 'pending', page: 1 })}><span>待人工复核</span><strong>{pending.totalDocs.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.queue === 'processed' ? 'page' : undefined} href={listHref(filters, { queue: 'processed', page: 1 })}><span>已处理</span><strong>{processed.totalDocs.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.queue === 'all' ? 'page' : undefined} href={listHref(filters, { queue: 'all', page: 1 })}><span>全部 AI 评级作品</span><strong>{all.totalDocs.toLocaleString('zh-CN')}</strong></Link>
      </nav>

      <form action="/me/review/content" className="review-filter-panel">
        <input name="queue" type="hidden" value={filters.queue} />
        <label><span>关键词</span><input defaultValue={filters.q} name="q" placeholder="标题、Slug、追踪 ID 或作品 ID" type="search" /></label>
        <label><span>每页数量</span><select defaultValue={filters.perPage} name="perPage"><option value="20">20 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
        <div className="review-filter-actions"><button className="review-button" type="submit">应用筛选</button><Link className="review-link" href={listHref(filters, { q: '', page: 1 })}>清除搜索</Link></div>
      </form>

      <div className="review-row-actions"><Link className="review-link" href="/me/review/feedback">审核用户提交</Link><Link className="review-link" href="/admin/collections/works">Payload 高级维护</Link></div>
      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />

      <section className="review-list">
        {docs.map((doc) => {
          const merged = mergedWorkReference(doc)
          const reviewHref = `/me/review/content/works/${doc.id}?returnTo=${encodeURIComponent(returnTo)}`
          return (
            <article className={`review-row review-content-row${merged ? ' review-merged-row' : ''}`} key={doc.id}>
              <header className="review-row-header">
                <div className="review-row-title"><h2>{doc.title || `作品 #${doc.id}`}</h2><small>作品 ID：{doc.id} · AI 评估 {doc.radarAssessment?.assessedAt || '时间未知'}</small></div>
                <div className="review-chip-list"><span className="review-row-chip assessment-origin-badge">AI 已评级</span><span className="review-row-chip">{humanStatus(doc)}</span>{doc.catalogStatus === 'temporary' ? <span className="review-row-chip review-row-chip-warning">临时作品</span> : null}</div>
              </header>

              {merged ? (
                <aside className="review-merged-warning"><strong>这个旧条目已经合并，不可继续复核。</strong><p>保留作品：{merged.title || `作品 #${merged.id}`}。</p><div className="review-content-actions"><Link className="review-button review-button-primary" href={`/me/review/content/works/${merged.id}?returnTo=${encodeURIComponent(returnTo)}`}>复核规范作品</Link></div></aside>
              ) : (
                <>
                  <aside className="review-ai-suggestion">
                    <strong>{doc.radarAssessment?.suggestedGrade ? `AI 建议：${doc.radarAssessment.suggestedGrade} 级` : 'AI 尚未给出等级'}</strong>
                    {typeof doc.radarAssessment?.confidencePercent === 'number' ? <span>置信度 {doc.radarAssessment.confidencePercent}%</span> : null}
                    {doc.radarAssessment?.decisiveRuleCode ? <span>规则 {doc.radarAssessment.decisiveRuleCode}</span> : null}
                    {doc.radarAssessment?.decisiveRuleReason ? <p>{doc.radarAssessment.decisiveRuleReason}</p> : null}
                  </aside>
                  <div className="review-content-actions">
                    {doc.reviewStatus === 'pending' ? (
                      <form action={beginContentReviewAction}>
                        <input name="collection" type="hidden" value="works" />
                        <input name="id" type="hidden" value={String(doc.id)} />
                        <input name="returnTo" type="hidden" value={returnTo} />
                        <button className="review-button review-button-primary" type="submit">开始人工复核</button>
                      </form>
                    ) : <Link className="review-button review-button-primary" href={reviewHref}>查看人工复核记录</Link>}
                  </div>
                </>
              )}
            </article>
          )
        })}
        {docs.length === 0 ? <section className="review-empty"><h2>{filters.queue === 'pending' ? '没有等待人工复核的 AI 评级作品' : '没有匹配的记录'}</h2><p>受控 AI 管线写入评估时间后，且人工轨道仍未复核的作品会自动出现在这里。</p></section> : null}
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
  return <nav className="review-pagination" aria-label="AI 评级人工复核分页">{currentPage > 1 ? <Link href={listHref(filters, { page: currentPage - 1 })}>上一页</Link> : null}<span aria-current="page">第 {currentPage} / {totalPages} 页</span>{currentPage < totalPages ? <Link href={listHref(filters, { page: currentPage + 1 })}>下一页</Link> : null}</nav>
}
