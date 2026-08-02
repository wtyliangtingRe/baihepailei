import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { isEditor } from '@/access/roles'

import { canonicalContentUrl } from '../_lib/content-identity'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type RadarRecord = {
  id: string | number
  publicationKey: string
  identityKey: string
  workIdSnapshot: string
  workSiteId: string
  title: string
  publicState: string
  researchStatus: string
  pageNotice: string
  facts?: Array<unknown>
  evidence?: Array<unknown>
  sourceReviewedAt?: string
  recordStatus: string
}

type RadarRating = {
  publicationKey: string
  coreGrade?: string
  confidence?: string
  reasoningSummary?: string
  matchedClasses?: Array<{ value?: string }>
  publicTagHints?: Array<{ value?: string }>
  humanReview?: { status?: string; proposedCoreGrade?: string }
  recordStatus: string
}

type Filters = {
  q: string
  grade: string
  state: string
  review: string
  status: string
  page: number
  perPage: number
}

const grades = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']
const states = ['verified', 'partial', 'needs_more_research']
const reviews = ['unreviewed', 'reviewed', 'disputed']
const statuses = ['current', 'withdrawn', 'all']

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function filtersFrom(params: Record<string, string | string[] | undefined>, staff: boolean): Filters {
  const requestedGrade = first(params.grade).toUpperCase()
  const requestedState = first(params.state)
  const requestedReview = first(params.review)
  const requestedStatus = first(params.status)
  const requestedPerPage = positiveInteger(first(params.perPage), 30)
  return {
    q: first(params.q).trim().slice(0, 160),
    grade: grades.includes(requestedGrade) ? requestedGrade : 'all',
    state: states.includes(requestedState) ? requestedState : 'all',
    review: reviews.includes(requestedReview) ? requestedReview : 'all',
    status: staff && statuses.includes(requestedStatus) ? requestedStatus : 'current',
    page: positiveInteger(first(params.page), 1),
    perPage: [30, 60, 100].includes(requestedPerPage) ? requestedPerPage : 30,
  }
}

function radarHref(filters: Filters, overrides: Partial<Filters> = {}) {
  const next = { ...filters, ...overrides }
  const params = new URLSearchParams()
  if (next.q) params.set('q', next.q)
  if (next.grade !== 'all') params.set('grade', next.grade)
  if (next.state !== 'all') params.set('state', next.state)
  if (next.review !== 'all') params.set('review', next.review)
  if (next.status !== 'current') params.set('status', next.status)
  if (next.perPage !== 30) params.set('perPage', String(next.perPage))
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return query ? `/radar?${query}` : '/radar'
}

function stateLabel(value?: string) {
  if (value === 'verified') return '已验证'
  if (value === 'partial') return '部分资料已验证'
  if (value === 'needs_more_research') return '资料待补充'
  return value || '未知'
}

function confidenceLabel(value?: string) {
  if (value === 'high') return '高'
  if (value === 'medium') return '中'
  if (value === 'low') return '低'
  return value || '—'
}

function reviewLabel(value?: string) {
  if (value === 'reviewed') return '已复核'
  if (value === 'disputed') return '有争议'
  return '未复核'
}

function formatDate(value?: string) {
  if (!value) return '未记录'
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value))
  } catch {
    return value
  }
}

function valueList(rows?: Array<{ value?: string }>) {
  return (rows || []).map((row) => String(row?.value || '').trim()).filter(Boolean)
}

function recordWhere(filters: Filters, allowedPublicationKeys: string[] | null): Where {
  const and: Where[] = []
  if (filters.status !== 'all') and.push({ recordStatus: { equals: filters.status } })
  if (filters.state !== 'all') and.push({ publicState: { equals: filters.state } })
  if (filters.q) {
    and.push({
      or: [
        { title: { like: filters.q } },
        { identityKey: { like: filters.q } },
        { workSiteId: { like: filters.q } },
        { workIdSnapshot: { like: filters.q } },
      ],
    })
  }
  if (allowedPublicationKeys) and.push({ publicationKey: { in: allowedPublicationKeys } })
  return and.length ? { and } : {}
}

async function ratingKeys(payload: Awaited<ReturnType<typeof getPayload>>, filters: Filters) {
  if (filters.grade === 'all' && filters.review === 'all') return null
  const and: Where[] = []
  if (filters.status !== 'all') and.push({ recordStatus: { equals: filters.status } })
  if (filters.grade !== 'all') and.push({ coreGrade: { equals: filters.grade } })
  if (filters.review !== 'all') and.push({ 'humanReview.status': { equals: filters.review } })
  const result = await payload.find({
    collection: 'radar-public-ratings',
    depth: 0,
    limit: 2000,
    page: 1,
    pagination: true,
    overrideAccess: true,
    where: and.length ? { and } : {},
  })
  return (result.docs as unknown as RadarRating[]).map((doc) => doc.publicationKey)
}

export default async function RadarIndexPage({ searchParams }: { searchParams: SearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/radar')}`)

  const staff = isEditor(auth.user)
  const filters = filtersFrom(await searchParams, staff)
  const allowedPublicationKeys = await ratingKeys(payload, filters)
  const emptyByRatingFilter = Array.isArray(allowedPublicationKeys) && allowedPublicationKeys.length === 0
  const result = emptyByRatingFilter
    ? { docs: [], totalDocs: 0, totalPages: 1, page: 1 }
    : await payload.find({
        collection: 'radar-public-records',
        depth: 0,
        limit: filters.perPage,
        page: filters.page,
        pagination: true,
        overrideAccess: true,
        sort: 'title',
        where: recordWhere(filters, allowedPublicationKeys),
      })

  const records = result.docs as unknown as RadarRecord[]
  const keys = records.map((record) => record.publicationKey)
  const ratingResult = keys.length
    ? await payload.find({
        collection: 'radar-public-ratings',
        depth: 0,
        limit: Math.max(keys.length, 1),
        page: 1,
        pagination: true,
        overrideAccess: true,
        where: filters.status === 'all'
          ? { publicationKey: { in: keys } }
          : {
              and: [
                { publicationKey: { in: keys } },
                { recordStatus: { equals: filters.status } },
              ],
            },
      })
    : { docs: [] }
  const ratings = ratingResult.docs as unknown as RadarRating[]
  const ratingByKey = new Map(ratings.map((rating) => [rating.publicationKey, rating]))
  const totalPages = Math.max(1, Number(result.totalPages || 1))
  const currentPage = Math.min(Number(result.page || filters.page), totalPages)

  return (
    <main className="page collection-page radar-index-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">注册用户资料区</p>
        <h1>Radar 研究档案</h1>
        <p>这里保存事实、证据与来源绑定，登录后只读浏览。普通注册用户只能查看当前记录；编辑以上可以检查撤回记录并下载单条 JSON，但本页不提供任何修改入口。</p>
        <div className="collection-actions">
          <span>{Number(result.totalDocs || 0).toLocaleString('zh-CN')} 条</span>
          <span>第 {currentPage} / {totalPages} 页</span>
          <Link className="result-link" href="/ratings">查看面向大众的评级页</Link>
          <Link className="back-link" href="/works">返回作品</Link>
        </div>

        <form action="/radar" className="works-filter-panel">
          <div className="works-filter-grid">
            <label>
              <span>关键词</span>
              <input defaultValue={filters.q} name="q" placeholder="标题、身份 Key、Work ID、Site ID" type="search" />
            </label>
            <label>
              <span>机器核心等级</span>
              <select defaultValue={filters.grade} name="grade">
                <option value="all">全部等级</option>
                {grades.map((grade) => <option key={grade} value={grade}>{grade} 级</option>)}
              </select>
            </label>
            <label>
              <span>资料状态</span>
              <select defaultValue={filters.state} name="state">
                <option value="all">全部状态</option>
                <option value="verified">已验证</option>
                <option value="partial">部分资料已验证</option>
                <option value="needs_more_research">资料待补充</option>
              </select>
            </label>
            <label>
              <span>人工复核</span>
              <select defaultValue={filters.review} name="review">
                <option value="all">全部状态</option>
                <option value="unreviewed">未复核</option>
                <option value="reviewed">已复核</option>
                <option value="disputed">有争议</option>
              </select>
            </label>
            {staff ? (
              <label>
                <span>记录范围</span>
                <select defaultValue={filters.status} name="status">
                  <option value="current">当前</option>
                  <option value="withdrawn">已撤回</option>
                  <option value="all">全部</option>
                </select>
              </label>
            ) : null}
            <label>
              <span>每页</span>
              <select defaultValue={String(filters.perPage)} name="perPage">
                <option value="30">30</option>
                <option value="60">60</option>
                <option value="100">100</option>
              </select>
            </label>
          </div>
          <div className="works-filter-actions">
            <button className="result-link" type="submit">筛选档案</button>
            <Link className="back-link" href="/radar">清除筛选</Link>
          </div>
        </form>
      </section>

      {records.length ? (
        <section className="collection-grid radar-card-grid">
          {records.map((record) => {
            const rating = ratingByKey.get(record.publicationKey)
            const matched = valueList(rating?.matchedClasses)
            const tags = (rating?.publicTagHints || []).map((item) => String(item?.value || '').trim()).filter(Boolean)
            return (
              <article className="collection-card radar-list-card" key={record.id}>
                <div className="radar-public-heading-row">
                  <div className="work-card-badges">
                    <span className="radar-grade-badge">{rating?.coreGrade ? `机器 ${rating.coreGrade} 级` : '未评级'}</span>
                    <span className="work-type-chip">{stateLabel(record.publicState)}</span>
                    <span className="work-type-chip">置信度 {confidenceLabel(rating?.confidence)}</span>
                    <span className="work-type-chip">{reviewLabel(rating?.humanReview?.status)}</span>
                  </div>
                  {record.recordStatus !== 'current' ? <span className="content-visibility-chip">已撤回</span> : null}
                </div>
                <h2><Link href={`/radar/${record.id}`}>{record.title}</Link></h2>
                <p>{rating?.reasoningSummary || record.pageNotice}</p>
                <div className="radar-chip-list">
                  {matched.slice(0, 4).map((value) => <span key={`class:${record.id}:${value}`}>{value}</span>)}
                  {tags.slice(0, 4).map((value) => <span key={`tag:${record.id}:${value}`}>{value}</span>)}
                </div>
                <div className="radar-list-meta">
                  <span>事实 {record.facts?.length || 0}</span>
                  <span>证据 {record.evidence?.length || 0}</span>
                  <span>复核 {formatDate(record.sourceReviewedAt)}</span>
                </div>
                <div className="collection-actions">
                  <Link className="result-link" href={`/radar/${record.id}`}>只读查看</Link>
                  <Link className="back-link" href={canonicalContentUrl('works', record.workIdSnapshot)}>大众作品页</Link>
                </div>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="empty-state small">
          <h2>没有符合条件的 Radar 档案</h2>
          <p>可以清除等级、资料状态或人工复核筛选。</p>
          <Link className="result-link" href="/radar">查看全部当前记录</Link>
        </section>
      )}

      <nav className="collection-actions" aria-label="Radar 分页">
        {currentPage > 1 ? <Link className="back-link" href={radarHref(filters, { page: currentPage - 1 })}>上一页</Link> : <span>上一页</span>}
        <span>第 {currentPage} / {totalPages} 页</span>
        {currentPage < totalPages ? <Link className="back-link" href={radarHref(filters, { page: currentPage + 1 })}>下一页</Link> : <span>下一页</span>}
      </nav>
    </main>
  )
}
