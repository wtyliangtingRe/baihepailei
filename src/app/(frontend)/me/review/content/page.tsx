import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { canonicalContentUrl } from '../../../_lib/content-identity'
import {
  isMergedDuplicateWork,
  mergedWorkReference,
  reviewActionHref,
  safeReviewReturnTo,
  type ReviewableContentDoc,
} from './review-utils'

export const dynamic = 'force-dynamic'

type ContentCollection = 'works' | 'creators' | 'organizations'
type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'trusted'
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
  humanReviewNote?: string
  reviewReasons?: string[] | string
  status?: string
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

const allowedRoles: Role[] = ['owner', 'admin', 'editor', 'reviewer']
const collectionMeta: Record<ContentCollection, { label: string; titleField: 'title' | 'name' }> = {
  works: { label: '作品', titleField: 'title' },
  creators: { label: '创作者', titleField: 'name' },
  organizations: { label: '机构', titleField: 'name' },
}
const workRankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']
const creatorRankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown']
const organizationTypes = [
  'publisher', 'production_company', 'animation_studio', 'game_company', 'distributor',
  'circle', 'brand', 'platform', 'committee', 'other',
]
const processedStatuses = ['reviewed', 'disputed', 'deprecated']

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function positiveInteger(value: string, fallback = 1) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function contentCollection(value: FormDataEntryValue | string | null | undefined): ContentCollection {
  return value === 'creators' || value === 'organizations' ? value : 'works'
}

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const requestedQueue = first(params.queue)
  const requestedStatus = first(params.reviewStatus)
  const requestedOrigin = first(params.origin)
  return {
    collection: contentCollection(first(params.collection)),
    queue: requestedQueue === 'processed' || requestedQueue === 'all' ? requestedQueue : 'pending',
    q: first(params.q).trim().slice(0, 160),
    reviewStatus: ['pending', 'reviewed', 'disputed', 'deprecated'].includes(requestedStatus)
      ? requestedStatus as ReviewStatus
      : 'all',
    origin: ['ai', 'human', 'unassessed'].includes(requestedOrigin)
      ? requestedOrigin as Filters['origin']
      : 'all',
    page: positiveInteger(first(params.page)),
    perPage: [20, 50, 100].includes(positiveInteger(first(params.perPage), 50))
      ? positiveInteger(first(params.perPage), 50) as Filters['perPage']
      : 50,
  }
}

function roleOf(user: unknown): Role | undefined {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

function canReview(user: unknown) {
  const role = roleOf(user)
  return Boolean(role && allowedRoles.includes(role))
}

function reviewReasons(value: ContentDoc['reviewReasons']) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[;|,]/u).map((item) => item.trim()).filter(Boolean)
  return []
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

  if (filters.reviewStatus !== 'all') {
    and.push({ reviewStatus: { equals: filters.reviewStatus } })
  } else if (filters.queue === 'pending') {
    and.push({ reviewStatus: { equals: 'pending' } })
  } else if (filters.queue === 'processed') {
    and.push({ reviewStatus: { in: processedStatuses } })
  }

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
      const origin = filters.origin === 'ai'
        ? 'ai_assessed'
        : filters.origin === 'human'
          ? 'human_reviewed'
          : 'unassessed'
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
  const isHuman = doc.reviewStatus === 'reviewed'
    || doc.ratingNotice === 'manual_reviewed'
    || doc.reviewOrigin === 'human_reviewed'
  const isAI = doc.ratingNotice === 'ai_synthesized_pending_review'
    || doc.reviewOrigin === 'ai_assessed'
    || Boolean(doc.radarAssessment?.assessedAt || doc.radarAssessment?.suggestedGrade)
  if (isAI && isHuman) return 'AI 辅助 · 人工已复核'
  if (isHuman) return '人工已复核'
  if (isAI) return 'AI 已评估 · 待人工复核'
  return '尚未标记评估来源'
}

function reviewStatusLabel(value?: string) {
  if (value === 'reviewed') return '已复核'
  if (value === 'disputed') return '有争议'
  if (value === 'deprecated') return '已合并 / 已废弃'
  return '待复核'
}

function reviewResultLabel(value: string) {
  if (value === 'approve') return '通过并记录人工复核'
  if (value === 'reject') return '驳回并标记争议'
  return '保存修改'
}

async function saveContentAction(formData: FormData) {
  'use server'

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canReview(auth.user)) throw new Error('没有内容审核权限。')

  const collection = contentCollection(formData.get('collection'))
  const id = String(formData.get('id') || '').trim()
  const title = String(formData.get('title') || '').trim().slice(0, 300)
  const intent = String(formData.get('intent') || 'save')
  const selectedReviewStatus = String(formData.get('reviewStatus') || 'pending')
  const reviewStatus = intent === 'approve'
    ? 'reviewed'
    : intent === 'reject'
      ? 'disputed'
      : selectedReviewStatus
  const status = String(formData.get('status') || 'draft')
  const note = String(formData.get('note') || '').trim().slice(0, 4000)
  const returnTo = safeReviewReturnTo(formData.get('returnTo'))

  if (!id || !title || !['save', 'approve', 'reject'].includes(intent)) {
    redirect(reviewActionHref(returnTo, 'reviewError', 'invalid_action', { reviewId: id }))
  }
  if (!['pending', 'reviewed', 'disputed', 'deprecated'].includes(reviewStatus)) {
    redirect(reviewActionHref(returnTo, 'reviewError', 'invalid_status', { reviewId: id }))
  }
  if (!['draft', 'review', 'published', 'archived'].includes(status)) {
    redirect(reviewActionHref(returnTo, 'reviewError', 'invalid_status', { reviewId: id }))
  }
  if (reviewStatus === 'disputed' && !note) {
    redirect(reviewActionHref(returnTo, 'reviewError', 'note_required', { reviewId: id }))
  }

  const current = await payload.findByID({
    collection: collection as never,
    id,
    depth: 0,
    draft: true,
    overrideAccess: true,
  }) as unknown as ContentDoc

  if (collection === 'works' && isMergedDuplicateWork(current)) {
    const merged = mergedWorkReference(current)
    redirect(reviewActionHref(returnTo, 'reviewError', 'merged_duplicate', {
      reviewId: id,
      targetId: merged?.id,
      targetTitle: merged?.title,
    }))
  }

  const actorID = (auth.user as { id?: string | number }).id
  const data: Record<string, unknown> = {
    [collectionMeta[collection].titleField]: title,
    reviewStatus,
    status,
    humanReviewNote: note,
  }

  if (collection === 'works') {
    const rank = String(formData.get('rank') || 'unknown')
    if (!workRankOptions.includes(rank)) {
      redirect(reviewActionHref(returnTo, 'reviewError', 'invalid_status', { reviewId: id }))
    }
    data.rank = rank
    if (reviewStatus !== 'pending') {
      data.reviewReasons = [...new Set([...reviewReasons(current.reviewReasons), 'manual_review'])]
    }
    if (reviewStatus === 'reviewed') data.ratingNotice = 'manual_reviewed'
  } else if (collection === 'creators') {
    const rank = String(formData.get('rank') || 'unknown')
    if (!creatorRankOptions.includes(rank)) {
      redirect(reviewActionHref(returnTo, 'reviewError', 'invalid_status', { reviewId: id }))
    }
    data.rank = rank
  } else {
    const type = String(formData.get('type') || 'other')
    if (!organizationTypes.includes(type)) {
      redirect(reviewActionHref(returnTo, 'reviewError', 'invalid_status', { reviewId: id }))
    }
    data.type = type
  }

  if (reviewStatus !== 'pending') {
    data.humanReviewedAt = new Date().toISOString()
    data.humanReviewedBy = actorID
    if (collection !== 'works') data.reviewOrigin = 'human_reviewed'
  }

  try {
    await payload.update({
      collection: collection as never,
      id,
      depth: 0,
      draft: true,
      overrideAccess: true,
      context: { reviewWorkbench: true },
      data: data as never,
    })
  } catch (error) {
    console.error('Content review update failed', { collection, id, error })
    redirect(reviewActionHref(returnTo, 'reviewError', 'save_failed', { reviewId: id }))
  }

  revalidatePath('/me/review/content')
  revalidatePath(`/${collection}`)
  revalidatePath(canonicalContentUrl(collection, id))
  redirect(reviewActionHref(returnTo, 'reviewed', intent, { reviewId: id }))
}

export default async function ContentReviewPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/review/content')}`)

  if (!canReview(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员、编辑和审核人员。</p></section></main>
  }

  const rawParams = await searchParams
  const filters = parseFilters(rawParams)
  const reviewError = first(rawParams.reviewError)
  const reviewed = first(rawParams.reviewed)
  const reviewID = first(rawParams.reviewId)
  const targetID = first(rawParams.targetId)
  const targetTitle = first(rawParams.targetTitle)

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
    payload.count({ collection: 'works', overrideAccess: true, where: { reviewStatus: { equals: 'pending' } } }),
    payload.count({ collection: 'creators', overrideAccess: true, where: { reviewStatus: { equals: 'pending' } } }),
    payload.count({ collection: 'organizations', overrideAccess: true, where: { reviewStatus: { equals: 'pending' } } }),
    payload.count({ collection: filters.collection as never, overrideAccess: true, where: { reviewStatus: { in: processedStatuses } } }),
    payload.count({ collection: filters.collection as never, overrideAccess: true }),
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
          <p className="eyebrow">内容审核与站内编辑</p>
          <h1>把待处理、已处理和高级维护分开</h1>
          <p className="muted">默认只显示仍需碳基生物处理的条目。通过、驳回或归档后会离开当前队列，但仍能在“已处理”中追溯。</p>
          <div className="review-safety-note">AI 已评估只说明机器整理已经存在，不代表人工通过。合并后的重复作品不会再允许从旧条目保存，审核应转到保留的规范作品。</div>
        </div>
        <div className="review-stat-grid">
          <Stat label="当前筛选" value={result.totalDocs} />
          <Stat label="当前页" value={docs.length} />
        </div>
      </section>

      {reviewError ? (
        <div className="review-action-message review-action-message-error" role="alert">
          {reviewError === 'merged_duplicate'
            ? <>作品 {reviewID || ''} 已合并，不应再审核旧条目。{targetID ? <>请改为处理 <Link href={`/me/review/content/works/${targetID}?returnTo=${encodeURIComponent(returnTo)}`}>{targetTitle || `规范作品 #${targetID}`}</Link>。</> : null}</>
            : reviewError === 'note_required'
              ? `条目 ${reviewID || ''} 标记争议时必须填写人工复核记录。`
              : reviewError === 'save_failed'
                ? `条目 ${reviewID || ''} 保存失败；页面已安全返回，没有把错误扩散成整页 Runtime Error。请查看开发服务器日志。`
                : '审核参数无效，请刷新页面后重试。'}
        </div>
      ) : null}
      {reviewed ? <div className="review-action-message review-action-message-success" role="status">条目 {reviewID || ''} 已完成“{reviewResultLabel(reviewed)}”；若它不再需要处理，已自动离开待处理队列。</div> : null}

      <nav className="review-content-tabs" aria-label="内容类型">
        {(Object.keys(collectionMeta) as ContentCollection[]).map((collection) => (
          <Link
            aria-current={filters.collection === collection ? 'page' : undefined}
            href={listHref(filters, { collection, page: 1, reviewStatus: 'all' })}
            key={collection}
          >
            <span>{collectionMeta[collection].label}</span>
            <strong>{pendingCounts[collection].toLocaleString('zh-CN')} 待复核</strong>
          </Link>
        ))}
      </nav>

      <nav className="review-queue-tabs" aria-label="审核队列">
        <Link aria-current={filters.queue === 'pending' ? 'page' : undefined} href={listHref(filters, { queue: 'pending', reviewStatus: 'all', page: 1 })}>
          <span>待处理</span><strong>{pendingCounts[filters.collection].toLocaleString('zh-CN')}</strong>
        </Link>
        <Link aria-current={filters.queue === 'processed' ? 'page' : undefined} href={listHref(filters, { queue: 'processed', reviewStatus: 'all', page: 1 })}>
          <span>已处理</span><strong>{processed.totalDocs.toLocaleString('zh-CN')}</strong>
        </Link>
        <Link aria-current={filters.queue === 'all' ? 'page' : undefined} href={listHref(filters, { queue: 'all', reviewStatus: 'all', page: 1 })}>
          <span>全部历史</span><strong>{all.totalDocs.toLocaleString('zh-CN')}</strong>
        </Link>
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

      <div className="review-row-actions">
        {filters.collection === 'works' ? <Link className="review-link" href="/me/review/public-catalog">进入作品证据深度审核</Link> : null}
        <Link className="review-link" href="/me/review/feedback">审核用户反馈</Link>
        <Link className="review-link" href={`/admin/collections/${filters.collection}`}>Payload 高级维护</Link>
      </div>

      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />

      <section className="review-list">
        {docs.map((doc) => {
          const merged = filters.collection === 'works' ? mergedWorkReference(doc) : null
          return (
            <article className={`review-row review-content-row${merged ? ' review-merged-row' : ''}`} key={doc.id}>
              <header className="review-row-header">
                <div className="review-row-title">
                  <h2><Link href={canonicalContentUrl(filters.collection, doc.id)}>{itemTitle(doc)}</Link></h2>
                  <small>{collectionMeta[filters.collection].label} ID：{doc.id}</small>
                </div>
                <div className="review-chip-list">
                  <span className="review-row-chip assessment-origin-badge">{assessmentOrigin(filters.collection, doc)}</span>
                  <span className={`review-row-chip${doc.reviewStatus === 'deprecated' ? ' review-row-chip-warning' : ''}`}>{reviewStatusLabel(doc.reviewStatus)}</span>
                  <span className="review-row-chip">{doc.status || 'draft'}</span>
                </div>
              </header>

              {merged ? (
                <aside className="review-merged-warning">
                  <strong>这个旧条目已经合并，不可继续保存或审核。</strong>
                  <p>保留作品：{merged.title || `作品 #${merged.id}`}（ID {merged.id}）。旧记录只保留作追踪历史，避免再次制造重复来源或唯一键冲突。</p>
                  <div className="review-content-actions">
                    <Link className="review-button review-button-primary" href={`/me/review/content/works/${merged.id}?returnTo=${encodeURIComponent(returnTo)}`}>打开规范作品编辑台</Link>
                    <Link className="review-link" href={canonicalContentUrl('works', merged.id)}>查看规范作品前台</Link>
                    <Link className="review-link" href={`/admin/collections/works/${doc.id}`}>Payload 查看旧记录</Link>
                  </div>
                </aside>
              ) : (
                <>
                  {filters.collection === 'works' && doc.radarAssessment?.suggestedGrade ? (
                    <aside className="review-ai-suggestion">
                      <strong>AI 建议：{doc.radarAssessment.suggestedGrade} 级</strong>
                      {typeof doc.radarAssessment.confidencePercent === 'number' ? <span>置信度 {doc.radarAssessment.confidencePercent}%</span> : null}
                      {doc.radarAssessment.decisiveRuleCode ? <span>规则 {doc.radarAssessment.decisiveRuleCode}</span> : null}
                      {doc.radarAssessment.decisiveRuleReason ? <p>{doc.radarAssessment.decisiveRuleReason}</p> : null}
                      <small>这里只展示机器建议；人工仍需在下方选择最终分级并明确通过或标记争议。</small>
                    </aside>
                  ) : null}

                  <form action={saveContentAction} className="review-content-form">
                    <input name="collection" type="hidden" value={filters.collection} />
                    <input name="id" type="hidden" value={String(doc.id)} />
                    <input name="returnTo" type="hidden" value={returnTo} />
                    <label className="review-content-title"><span>名称</span><input defaultValue={itemTitle(doc)} maxLength={300} name="title" required /></label>
                    {filters.collection !== 'organizations' ? (
                      <label><span>分级</span><select defaultValue={doc.rank || 'unknown'} name="rank">{(filters.collection === 'works' ? workRankOptions : creatorRankOptions).map((rank) => <option key={rank} value={rank}>{rank === 'AA' ? 'S（兼容 AA）' : rank === 'unknown' ? '未知' : rank}</option>)}</select></label>
                    ) : (
                      <label><span>机构类型</span><select defaultValue={doc.type || 'other'} name="type">{organizationTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                    )}
                    <label><span>复核状态</span><select defaultValue={doc.reviewStatus || 'pending'} name="reviewStatus"><option value="pending">待复核</option><option value="reviewed">已复核</option><option value="disputed">有争议</option><option value="deprecated">已废弃</option></select></label>
                    <label><span>发布状态</span><select defaultValue={doc.status || 'draft'} name="status"><option value="draft">草稿</option><option value="review">待发布审核</option><option value="published">已发布</option><option value="archived">已归档</option></select></label>
                    <label className="review-content-note"><span>人工复核记录</span><textarea defaultValue={doc.humanReviewNote || ''} maxLength={4000} name="note" placeholder="记录核对过的来源、结论与尚待确认的问题；标记争议时必填。" /></label>
                    <div className="review-content-actions">
                      <button className="review-button" name="intent" type="submit" value="save">只保存修改</button>
                      <button className="review-button review-button-primary" name="intent" type="submit" value="approve">通过并移入已处理</button>
                      <button className="review-button review-button-danger" name="intent" type="submit" value="reject">驳回并移入已处理</button>
                      {filters.collection === 'works' ? <Link className="review-link" href={`/me/review/content/works/${doc.id}?returnTo=${encodeURIComponent(returnTo)}`}>站内完整编辑</Link> : null}
                      <Link className="review-link" href={canonicalContentUrl(filters.collection, doc.id)}>查看前台</Link>
                      <Link className="review-link" href={`/admin/collections/${filters.collection}/${doc.id}`}>Payload 高级维护</Link>
                    </div>
                  </form>
                </>
              )}
            </article>
          )
        })}
        {docs.length === 0 ? <section className="review-empty"><h2>{filters.queue === 'pending' ? '待处理队列已经清空' : '没有匹配条目'}</h2><p>{filters.queue === 'pending' ? '做得好。已通过、已驳回和已合并的记录都在“已处理”中保留。' : '可以切换队列、复核状态、评估来源，或减少关键词。'}</p></section> : null}
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
  return (
    <nav className="review-pagination" aria-label="内容审核分页">
      {currentPage > 1 ? <Link href={listHref(filters, { page: currentPage - 1 })}>上一页</Link> : null}
      <span aria-current="page">第 {currentPage} / {totalPages} 页</span>
      {currentPage < totalPages ? <Link href={listHref(filters, { page: currentPage + 1 })}>下一页</Link> : null}
    </nav>
  )
}
