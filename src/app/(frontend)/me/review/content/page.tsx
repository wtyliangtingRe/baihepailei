import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { canonicalContentUrl } from '../../../_lib/content-identity'

export const dynamic = 'force-dynamic'

type ContentCollection = 'works' | 'creators' | 'organizations'
type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'trusted'
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

type ContentDoc = {
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
  reviewStatus?: string
  reviewOrigin?: string
  ratingNotice?: string
  radarAssessment?: { assessedAt?: string; suggestedGrade?: string }
  humanReviewNote?: string
  reviewReasons?: string[] | string
  status?: string
  updatedAt?: string
}

type Filters = {
  collection: ContentCollection
  q: string
  reviewStatus: 'all' | 'pending' | 'reviewed' | 'disputed'
  origin: 'all' | 'ai' | 'human' | 'unassessed'
  page: number
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
  const requestedStatus = first(params.reviewStatus)
  const requestedOrigin = first(params.origin)
  return {
    collection: contentCollection(first(params.collection)),
    q: first(params.q).trim().slice(0, 160),
    reviewStatus: ['pending', 'reviewed', 'disputed'].includes(requestedStatus)
      ? requestedStatus as Filters['reviewStatus']
      : 'all',
    origin: ['ai', 'human', 'unassessed'].includes(requestedOrigin)
      ? requestedOrigin as Filters['origin']
      : 'all',
    page: positiveInteger(first(params.page)),
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
    and.push({
      or: [
        { [titleField]: { like: filters.q } },
        { slug: { like: filters.q } },
        { siteId: { like: filters.q } },
      ],
    })
  }
  if (filters.reviewStatus !== 'all') and.push({ reviewStatus: { equals: filters.reviewStatus } })

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

function queryHref(filters: Filters, page: number) {
  const params = new URLSearchParams({ collection: filters.collection })
  if (filters.q) params.set('q', filters.q)
  if (filters.reviewStatus !== 'all') params.set('reviewStatus', filters.reviewStatus)
  if (filters.origin !== 'all') params.set('origin', filters.origin)
  if (page > 1) params.set('page', String(page))
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
  if (value === 'deprecated') return '已废弃'
  return '待复核'
}

async function saveContentAction(formData: FormData) {
  'use server'

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canReview(auth.user)) throw new Error('没有内容审核权限。')

  const collection = contentCollection(formData.get('collection'))
  const id = String(formData.get('id') || '').trim()
  const title = String(formData.get('title') || '').trim().slice(0, 300)
  const reviewStatus = String(formData.get('reviewStatus') || 'pending')
  const status = String(formData.get('status') || 'draft')
  const note = String(formData.get('note') || '').trim().slice(0, 4000)

  if (!id || !title) throw new Error('条目 ID 和名称不能为空。')
  if (!['pending', 'reviewed', 'disputed'].includes(reviewStatus)) throw new Error('复核状态无效。')
  if (!['draft', 'review', 'published', 'archived'].includes(status)) throw new Error('发布状态无效。')
  if (reviewStatus === 'disputed' && !note) throw new Error('标记争议时必须填写人工复核记录。')

  const current = await payload.findByID({ collection: collection as never, id, depth: 0, overrideAccess: true }) as unknown as ContentDoc
  const actorID = (auth.user as { id?: string | number }).id
  const data: Record<string, unknown> = {
    [collectionMeta[collection].titleField]: title,
    reviewStatus,
    status,
    humanReviewNote: note,
  }

  if (collection === 'works') {
    const rank = String(formData.get('rank') || 'unknown')
    if (!workRankOptions.includes(rank)) throw new Error('作品分级无效。')
    data.rank = rank
    if (reviewStatus !== 'pending') {
      data.reviewReasons = [...new Set([...reviewReasons(current.reviewReasons), 'manual_review'])]
    }
    if (reviewStatus === 'reviewed') data.ratingNotice = 'manual_reviewed'
  } else if (collection === 'creators') {
    const rank = String(formData.get('rank') || 'unknown')
    if (!creatorRankOptions.includes(rank)) throw new Error('创作者分级无效。')
    data.rank = rank
  } else {
    const type = String(formData.get('type') || 'other')
    if (!organizationTypes.includes(type)) throw new Error('机构类型无效。')
    data.type = type
  }

  if (reviewStatus !== 'pending') {
    data.humanReviewedAt = new Date().toISOString()
    data.humanReviewedBy = actorID
    if (collection !== 'works') data.reviewOrigin = 'human_reviewed'
  }

  await payload.update({
    collection: collection as never,
    id,
    depth: 0,
    overrideAccess: true,
    data: data as never,
  })

  revalidatePath('/me/review/content')
  revalidatePath(`/${collection}`)
  revalidatePath(canonicalContentUrl(collection, id))
}

export default async function ContentReviewPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/review/content')}`)

  if (!canReview(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员、编辑和审核人员。</p></section></main>
  }

  const filters = parseFilters(await searchParams)
  const [result, workPending, creatorPending, organizationPending] = await Promise.all([
    payload.find({
      collection: filters.collection as never,
      depth: 0,
      limit: 20,
      page: filters.page,
      pagination: true,
      overrideAccess: true,
      sort: '-updatedAt',
      where: buildWhere(filters),
    }),
    payload.count({ collection: 'works', overrideAccess: true, where: { reviewStatus: { equals: 'pending' } } }),
    payload.count({ collection: 'creators', overrideAccess: true, where: { reviewStatus: { equals: 'pending' } } }),
    payload.count({ collection: 'organizations', overrideAccess: true, where: { reviewStatus: { equals: 'pending' } } }),
  ])

  const docs = result.docs as unknown as ContentDoc[]
  const totalPages = Math.max(1, result.totalPages || 1)
  const currentPage = Math.min(result.page || filters.page, totalPages)
  const pendingCounts: Record<ContentCollection, number> = {
    works: workPending.totalDocs,
    creators: creatorPending.totalDocs,
    organizations: organizationPending.totalDocs,
  }

  return (
    <main className="page review-workbench">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">内容审核与快速编辑</p>
          <h1>作品、创作者、机构放在同一个工作台</h1>
          <p className="muted">这里适合查找、核对和修改最常用字段；来源数组、关系、富文本等复杂资料仍可从“完整编辑”进入 Payload 内容后台。</p>
          <div className="review-safety-note">AI 已评估只说明机器整理已经存在，不代表人工通过。只有人工保存“已复核”后，前台才会显示人工复核状态。</div>
        </div>
        <div className="review-stat-grid">
          <Stat label="当前筛选" value={result.totalDocs} />
          <Stat label="当前页" value={docs.length} />
        </div>
      </section>

      <nav className="review-content-tabs" aria-label="内容类型">
        {(Object.keys(collectionMeta) as ContentCollection[]).map((collection) => (
          <Link aria-current={filters.collection === collection ? 'page' : undefined} href={`/me/review/content?collection=${collection}`} key={collection}>
            <span>{collectionMeta[collection].label}</span>
            <strong>{pendingCounts[collection].toLocaleString('zh-CN')} 待复核</strong>
          </Link>
        ))}
      </nav>

      <form action="/me/review/content" className="review-filter-panel">
        <input name="collection" type="hidden" value={filters.collection} />
        <label><span>关键词</span><input defaultValue={filters.q} name="q" placeholder="名称、Slug 或导入追踪 ID" type="search" /></label>
        <label><span>复核状态</span><select defaultValue={filters.reviewStatus} name="reviewStatus"><option value="all">全部</option><option value="pending">待复核</option><option value="reviewed">已复核</option><option value="disputed">有争议</option></select></label>
        <label><span>评估来源</span><select defaultValue={filters.origin} name="origin"><option value="all">全部</option><option value="ai">AI 已评估</option><option value="human">人工已复核</option><option value="unassessed">尚未评估</option></select></label>
        <div className="review-filter-actions"><button className="review-button" type="submit">应用筛选</button><Link className="review-link" href={`/me/review/content?collection=${filters.collection}`}>重置</Link></div>
      </form>

      <div className="review-row-actions">
        {filters.collection === 'works' ? <Link className="review-link" href="/me/review/public-catalog">进入作品证据深度审核</Link> : null}
        <Link className="review-link" href={`/admin/collections/${filters.collection}`}>打开 Payload 完整列表</Link>
      </div>

      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />

      <section className="review-list">
        {docs.map((doc) => (
          <article className="review-row review-content-row" key={doc.id}>
            <header className="review-row-header">
              <div className="review-row-title">
                <h2><Link href={canonicalContentUrl(filters.collection, doc.id)}>{itemTitle(doc)}</Link></h2>
                <small>{collectionMeta[filters.collection].label} ID：{doc.id}</small>
              </div>
              <div className="review-chip-list">
                <span className="review-row-chip assessment-origin-badge">{assessmentOrigin(filters.collection, doc)}</span>
                <span className="review-row-chip">{reviewStatusLabel(doc.reviewStatus)}</span>
                <span className="review-row-chip">{doc.status || 'draft'}</span>
              </div>
            </header>

            <form action={saveContentAction} className="review-content-form">
              <input name="collection" type="hidden" value={filters.collection} />
              <input name="id" type="hidden" value={String(doc.id)} />
              <label className="review-content-title"><span>名称</span><input defaultValue={itemTitle(doc)} maxLength={300} name="title" required /></label>
              {filters.collection !== 'organizations' ? (
                <label><span>分级</span><select defaultValue={doc.rank || 'unknown'} name="rank">{(filters.collection === 'works' ? workRankOptions : creatorRankOptions).map((rank) => <option key={rank} value={rank}>{rank === 'AA' ? 'S（兼容 AA）' : rank === 'unknown' ? '未知' : rank}</option>)}</select></label>
              ) : (
                <label><span>机构类型</span><select defaultValue={doc.type || 'other'} name="type">{organizationTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              )}
              <label><span>复核状态</span><select defaultValue={doc.reviewStatus || 'pending'} name="reviewStatus"><option value="pending">待复核</option><option value="reviewed">已复核</option><option value="disputed">有争议</option></select></label>
              <label><span>发布状态</span><select defaultValue={doc.status || 'draft'} name="status"><option value="draft">草稿</option><option value="review">待发布审核</option><option value="published">已发布</option><option value="archived">已归档</option></select></label>
              <label className="review-content-note"><span>人工复核记录</span><textarea defaultValue={doc.humanReviewNote || ''} maxLength={4000} name="note" placeholder="记录核对过的来源、结论与尚待确认的问题；标记争议时必填。" /></label>
              <div className="review-content-actions">
                <button className="review-button review-button-primary" type="submit">保存这一个条目</button>
                <Link className="review-link" href={canonicalContentUrl(filters.collection, doc.id)}>查看前台</Link>
                <Link className="review-link" href={`/admin/collections/${filters.collection}/${doc.id}`}>完整编辑</Link>
              </div>
            </form>
          </article>
        ))}
        {docs.length === 0 ? <section className="review-empty"><h2>没有匹配条目</h2><p>可以切换复核状态、评估来源，或减少关键词。</p></section> : null}
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
      {currentPage > 1 ? <Link href={queryHref(filters, currentPage - 1)}>上一页</Link> : null}
      <span aria-current="page">第 {currentPage} / {totalPages} 页</span>
      {currentPage < totalPages ? <Link href={queryHref(filters, currentPage + 1)}>下一页</Link> : null}
    </nav>
  )
}
