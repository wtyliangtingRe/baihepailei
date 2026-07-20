import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { isEditor } from '@/access/roles'

import { beginContentReviewAction, type ContentCollection } from './review-actions'
import { mergedWorkReference, type ReviewableContentDoc } from './review-utils'

export const dynamic = 'force-dynamic'

type ReviewQueue = 'pending' | 'processed' | 'all'
type ReviewStatus = 'all' | 'pending' | 'reviewed' | 'disputed' | 'deprecated'
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type ContentDoc = ReviewableContentDoc & {
  id: string | number
  title?: string
  name?: string
  slug?: string
  siteId?: string
  rank?: string
  type?: string
  mediaGroup?: string
  mediaType?: string
  format?: string
  reviewOrigin?: string
  ratingNotice?: string
  radarAssessment?: {
    assessedAt?: string
    suggestedGrade?: string
    confidencePercent?: number
    decisiveRuleCode?: string
    decisiveRuleReason?: string
  }
  humanAssessment?: { grade?: string; status?: string } | null
  humanReviewNote?: string
  updatedAt?: string
}
type Filters = {
  collection: ContentCollection
  queue: ReviewQueue
  q: string
  reviewStatus: ReviewStatus
  origin: 'all' | 'ai' | 'human' | 'unassessed'
  page: number
  perPage: 20 | 50 | 100
}

const collectionMeta: Record<ContentCollection, { label: string; titleField: 'title' | 'name' }> = {
  works: { label: '作品', titleField: 'title' },
  creators: { label: '创作者', titleField: 'name' },
  organizations: { label: '机构', titleField: 'name' },
}
const processedStatuses = ['reviewed', 'disputed', 'deprecated']

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function positiveInteger(value: string, fallback = 1) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function contentCollection(value: string | undefined): ContentCollection {
  return value === 'creators' || value === 'organizations' ? value : 'works'
}

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const requestedQueue = first(params.queue)
  const requestedStatus = first(params.reviewStatus)
  const requestedOrigin = first(params.origin)
  const requestedPerPage = positiveInteger(first(params.perPage), 50)
  return {
    collection: contentCollection(first(params.collection)),
    queue: requestedQueue === 'processed' || requestedQueue === 'all' ? requestedQueue : 'pending',
    q: first(params.q).trim().slice(0, 160),
    reviewStatus: ['pending', 'reviewed', 'disputed', 'deprecated'].includes(requestedStatus) ? requestedStatus as ReviewStatus : 'all',
    origin: ['ai', 'human', 'unassessed'].includes(requestedOrigin) ? requestedOrigin as Filters['origin'] : 'all',
    page: positiveInteger(first(params.page)),
    perPage: [20, 50, 100].includes(requestedPerPage) ? requestedPerPage as Filters['perPage'] : 50,
  }
}

function buildWhere(filters: Filters): Where {
  const and: Where[] = []
  const titleField = collectionMeta[filters.collection].titleField
  if (filters.q) {
    const or: Where[] = [
      { [titleField]: { like: filters.q } },
      { slug: { like: filters.q } },
      { siteId: { like: filters.q } },
    ]
    if (/^\d+$/u.test(filters.q)) or.push({ id: { equals: filters.q } })
    and.push({ or })
  }
  if (filters.reviewStatus !== 'all') and.push({ reviewStatus: { equals: filters.reviewStatus } })
  else if (filters.queue === 'pending') and.push({ reviewStatus: { equals: 'pending' } })
  else if (filters.queue === 'processed') and.push({ reviewStatus: { in: processedStatuses } })

  if (filters.origin !== 'all') {
    if (filters.collection === 'works') {
      if (filters.origin === 'ai') and.push({ ratingNotice: { equals: 'ai_synthesized_pending_review' } })
      if (filters.origin === 'human') and.push({ ratingNotice: { equals: 'manual_reviewed' } })
      if (filters.origin === 'unassessed') {
        and.push({
          and: [
            { ratingNotice: { not_equals: 'ai_synthesized_pending_review' } },
            { ratingNotice: { not_equals: 'manual_reviewed' } },
          ],
        })
      }
    } else {
      const origin = filters.origin === 'ai' ? 'ai_assessed' : filters.origin === 'human' ? 'human_reviewed' : 'unassessed'
      and.push({ reviewOrigin: { equals: origin } })
    }
  }
  return and.length ? { and } : {}
}

function listHref(filters: Filters, overrides: Partial<Filters> = {}) {
  const next = { ...filters, ...overrides }
  const params = new URLSearchParams({ collection: next.collection })
  if (next.queue !== 'pending') params.set('queue', next.queue)
  if (next.q) params.set('q', next.q)
  if (next.reviewStatus !== 'all') params.set('reviewStatus', next.reviewStatus)
  if (next.origin !== 'all') params.set('origin', next.origin)
  if (next.perPage !== 50) params.set('perPage', String(next.perPage))
  if (next.page > 1) params.set('page', String(next.page))
  return `/me/review/content?${params.toString()}`
}

function itemTitle(doc: ContentDoc) {
  return doc.title || doc.name || '未命名条目'
}

function assessmentOrigin(collection: ContentCollection, doc: ContentDoc) {
  const isHuman = doc.reviewStatus === 'reviewed' || doc.ratingNotice === 'manual_reviewed' || doc.reviewOrigin === 'human_reviewed'
  const isAI = doc.ratingNotice === 'ai_synthesized_pending_review' || doc.reviewOrigin === 'ai_assessed' || Boolean(doc.radarAssessment?.assessedAt || doc.radarAssessment?.suggestedGrade)
  if (isAI && isHuman) return 'AI 辅助 · 人工已复核'
  if (isHuman) return '人工已复核'
  if (isAI) return 'AI 已评估 · 待人工复核'
  return '尚未评估'
}

function reviewStatusLabel(value?: string) {
  if (value === 'reviewed') return '已复核'
  if (value === 'disputed') return '有争议'
  if (value === 'deprecated') return '已合并 / 已废弃'
  return '待复核'
}

export default async function ContentReviewPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/review/content')}`)
  if (!isEditor(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员和编辑。</p></section></main>
  }

  const rawParams = await searchParams
  const filters = parseFilters(rawParams)
  const reviewError = first(rawParams.reviewError)
  const draftCount = (collection: ContentCollection, where: Where = {}) => payload.find({
    collection: collection as never,
    depth: 0,
    limit: 1,
    page: 1,
    pagination: true,
    overrideAccess: true,
    where,
  })
  const [result, workPending, creatorPending, organizationPending, processed, all] = await Promise.all([
    payload.find({
      collection: filters.collection as never,
      depth: 0,
      limit: filters.perPage,
      page: filters.page,
      pagination: true,
      overrideAccess: true,
      sort: '-updatedAt',
      where: buildWhere(filters),
    }),
    draftCount('works', { reviewStatus: { equals: 'pending' } }),
    draftCount('creators', { reviewStatus: { equals: 'pending' } }),
    draftCount('organizations', { reviewStatus: { equals: 'pending' } }),
    draftCount(filters.collection, { reviewStatus: { in: processedStatuses } }),
    draftCount(filters.collection),
  ])

  const docs = result.docs as unknown as ContentDoc[]
  const totalPages = Math.max(1, result.totalPages || 1)
  const currentPage = Math.min(result.page || filters.page, totalPages)
  const returnTo = listHref(filters, { page: currentPage })
  const pendingCounts: Record<ContentCollection, number> = {
    works: workPending.totalDocs,
    creators: creatorPending.totalDocs,
    organizations: organizationPending.totalDocs,
  }

  return (
    <main className="page review-workbench">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">AI / 内容审核</p>
          <h1>队列只负责进入审查</h1>
          <p className="muted">这里不再直接修改等级、发布状态或审核结论。点击“开始审查”后进入独立页面，阅读 AI 建议和前台预览，再在底部只保存、通过或驳回。</p>
          <div className="review-safety-note">正式内容编辑与审核决定已经分离；队列里不再提供“站内完整编辑”捷径，避免审核时误改其他字段。</div>
        </div>
        <div className="review-stat-grid"><Stat label="当前筛选" value={result.totalDocs} /><Stat label="当前页" value={docs.length} /></div>
      </section>

      {reviewError ? <div className="review-action-message review-action-message-error" role="alert">审查入口参数无效，请刷新页面后重试。</div> : null}

      <nav className="review-content-tabs" aria-label="内容类型">
        {(Object.keys(collectionMeta) as ContentCollection[]).map((collection) => (
          <Link aria-current={filters.collection === collection ? 'page' : undefined} href={listHref(filters, { collection, page: 1, reviewStatus: 'all' })} key={collection}>
            <span>{collectionMeta[collection].label}</span><strong>{pendingCounts[collection].toLocaleString('zh-CN')} 待复核</strong>
          </Link>
        ))}
      </nav>

      <nav className="review-queue-tabs" aria-label="审核队列">
        <Link aria-current={filters.queue === 'pending' ? 'page' : undefined} href={listHref(filters, { queue: 'pending', reviewStatus: 'all', page: 1 })}><span>待处理</span><strong>{pendingCounts[filters.collection].toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.queue === 'processed' ? 'page' : undefined} href={listHref(filters, { queue: 'processed', reviewStatus: 'all', page: 1 })}><span>已处理</span><strong>{processed.totalDocs.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.queue === 'all' ? 'page' : undefined} href={listHref(filters, { queue: 'all', reviewStatus: 'all', page: 1 })}><span>全部历史</span><strong>{all.totalDocs.toLocaleString('zh-CN')}</strong></Link>
      </nav>

      <form action="/me/review/content" className="review-filter-panel">
        <input name="collection" type="hidden" value={filters.collection} />
        <input name="queue" type="hidden" value={filters.queue} />
        <label><span>关键词</span><input defaultValue={filters.q} name="q" placeholder="名称、Slug、导入追踪 ID 或数据库 ID" type="search" /></label>
        <label><span>精确复核状态</span><select defaultValue={filters.reviewStatus} name="reviewStatus"><option value="all">沿用当前队列</option><option value="pending">待复核</option><option value="reviewed">已复核</option><option value="disputed">有争议</option><option value="deprecated">已合并 / 已废弃</option></select></label>
        <label><span>评估来源</span><select defaultValue={filters.origin} name="origin"><option value="all">全部</option><option value="ai">AI 已评估</option><option value="human">人工已复核</option><option value="unassessed">尚未评估</option></select></label>
        <label><span>每页数量</span><select defaultValue={filters.perPage} name="perPage"><option value="20">20 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
        <div className="review-filter-actions"><button className="review-button" type="submit">应用筛选</button><Link className="review-link" href={listHref(filters, { q: '', reviewStatus: 'all', origin: 'all', page: 1 })}>清除细筛选</Link></div>
      </form>

      <div className="review-row-actions"><Link className="review-link" href="/me/review/feedback">审核用户反馈</Link><Link className="review-link" href={`/admin/collections/${filters.collection}`}>Payload 高级维护</Link></div>
      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />

      <section className="review-list">
        {docs.map((doc) => {
          const merged = filters.collection === 'works' ? mergedWorkReference(doc) : null
          const reviewHref = `/me/review/content/${filters.collection}/${doc.id}?returnTo=${encodeURIComponent(returnTo)}`
          return (
            <article className={`review-row review-content-row${merged ? ' review-merged-row' : ''}`} key={doc.id}>
              <header className="review-row-header">
                <div className="review-row-title"><h2>{itemTitle(doc)}</h2><small>{collectionMeta[filters.collection].label} ID：{doc.id}</small></div>
                <div className="review-chip-list"><span className="review-row-chip assessment-origin-badge">{assessmentOrigin(filters.collection, doc)}</span><span className={`review-row-chip${doc.reviewStatus === 'deprecated' ? ' review-row-chip-warning' : ''}`}>{reviewStatusLabel(doc.reviewStatus)}</span></div>
              </header>

              {merged ? (
                <aside className="review-merged-warning"><strong>这个旧条目已经合并，不可继续审核。</strong><p>保留作品：{merged.title || `作品 #${merged.id}`}（ID {merged.id}）。</p><div className="review-content-actions"><Link className="review-button review-button-primary" href={`/me/review/content/works/${merged.id}?returnTo=${encodeURIComponent(returnTo)}`}>审查规范作品</Link></div></aside>
              ) : (
                <>
                  {filters.collection === 'works' ? (
                    <aside className="review-ai-suggestion">
                      <strong>{doc.radarAssessment?.suggestedGrade ? `AI 建议：${doc.radarAssessment.suggestedGrade} 级` : '尚无 AI 建议'}</strong>
                      {typeof doc.radarAssessment?.confidencePercent === 'number' ? <span>置信度 {doc.radarAssessment.confidencePercent}%</span> : null}
                      {doc.radarAssessment?.decisiveRuleCode ? <span>规则 {doc.radarAssessment.decisiveRuleCode}</span> : null}
                      {doc.radarAssessment?.decisiveRuleReason ? <p>{doc.radarAssessment.decisiveRuleReason}</p> : null}
                      {!doc.radarAssessment?.suggestedGrade ? <small>人工新建或尚未评估的作品会等待下一次 unassessed 管线。</small> : null}
                    </aside>
                  ) : null}
                  <div className="review-content-actions">
                    {doc.reviewStatus === 'pending' ? (
                      <form action={beginContentReviewAction}>
                        <input name="collection" type="hidden" value={filters.collection} />
                        <input name="id" type="hidden" value={String(doc.id)} />
                        <input name="returnTo" type="hidden" value={returnTo} />
                        <button className="review-button review-button-primary" type="submit">开始审查</button>
                      </form>
                    ) : <Link className="review-button review-button-primary" href={reviewHref}>查看审查记录</Link>}
                  </div>
                </>
              )}
            </article>
          )
        })}
        {docs.length === 0 ? <section className="review-empty"><h2>{filters.queue === 'pending' ? '待处理队列已经清空' : '没有匹配的条目'}</h2><p>可以切换内容类型、队列、复核状态或评估来源。</p></section> : null}
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
  return <nav className="review-pagination" aria-label="内容审核分页">{currentPage > 1 ? <Link href={listHref(filters, { page: currentPage - 1 })}>上一页</Link> : null}<span aria-current="page">第 {currentPage} / {totalPages} 页</span>{currentPage < totalPages ? <Link href={listHref(filters, { page: currentPage + 1 })}>下一页</Link> : null}</nav>
}
