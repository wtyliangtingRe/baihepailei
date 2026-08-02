import configPromise from '@payload-config'
import Link from 'next/link'
import { getPayload, type Where } from 'payload'

import { canonicalContentUrl } from '../_lib/content-identity'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type PublicRating = {
  id: string | number
  publicationKey: string
  workIdSnapshot: string
  title: string
  coreGrade?: string
  bestGrade?: string
  likelyGrade?: string
  worstGrade?: string
  confidence?: string
  reasoningSummary?: string
  matchedClasses?: Array<{ value?: string }>
  publicTagHints?: Array<{ key?: string; group?: string; value?: string; warningTemplateId?: string }>
  publicWarningTemplateIds?: Array<{ value?: string }>
  unresolvedDimensions?: Array<{ value?: string }>
  humanReview?: {
    status?: string
    proposedCoreGrade?: string
  }
  recordStatus: string
}

type Filters = {
  q: string
  grade: string
  confidence: string
  review: string
  page: number
  perPage: number
}

const grades = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']
const confidences = ['high', 'medium', 'low']
const reviews = ['unreviewed', 'reviewed', 'disputed']

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function filtersFrom(params: Record<string, string | string[] | undefined>): Filters {
  const grade = first(params.grade).toUpperCase()
  const confidence = first(params.confidence)
  const review = first(params.review)
  const requestedPerPage = positiveInteger(first(params.perPage), 30)
  return {
    q: first(params.q).trim().slice(0, 160),
    grade: grades.includes(grade) ? grade : 'all',
    confidence: confidences.includes(confidence) ? confidence : 'all',
    review: reviews.includes(review) ? review : 'all',
    page: positiveInteger(first(params.page), 1),
    perPage: [30, 60, 100].includes(requestedPerPage) ? requestedPerPage : 30,
  }
}

function ratingsHref(filters: Filters, overrides: Partial<Filters> = {}) {
  const next = { ...filters, ...overrides }
  const params = new URLSearchParams()
  if (next.q) params.set('q', next.q)
  if (next.grade !== 'all') params.set('grade', next.grade)
  if (next.confidence !== 'all') params.set('confidence', next.confidence)
  if (next.review !== 'all') params.set('review', next.review)
  if (next.perPage !== 30) params.set('perPage', String(next.perPage))
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return query ? `/ratings?${query}` : '/ratings'
}

function whereFor(filters: Filters): Where {
  const and: Where[] = [{ recordStatus: { equals: 'current' } }]
  if (filters.q) {
    and.push({
      or: [
        { title: { like: filters.q } },
        { workIdSnapshot: { like: filters.q } },
        { publicationKey: { like: filters.q } },
      ],
    })
  }
  if (filters.grade !== 'all') and.push({ coreGrade: { equals: filters.grade } })
  if (filters.confidence !== 'all') and.push({ confidence: { equals: filters.confidence } })
  if (filters.review !== 'all') and.push({ 'humanReview.status': { equals: filters.review } })
  return { and }
}

function confidenceLabel(value?: string) {
  if (value === 'high') return '高置信度'
  if (value === 'medium') return '中置信度'
  if (value === 'low') return '低置信度'
  return '置信度未知'
}

function reviewLabel(value?: string) {
  if (value === 'reviewed') return '人工已复核'
  if (value === 'disputed') return '人工标记有争议'
  return '待人工复核'
}

function values(rows?: Array<{ value?: string }>) {
  return (rows || []).map((row) => String(row?.value || '').trim()).filter(Boolean)
}

export default async function RatingsPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = filtersFrom(await searchParams)
  const payload = await getPayload({ config: configPromise })
  const result = await payload.find({
    collection: 'radar-public-ratings',
    depth: 0,
    limit: filters.perPage,
    page: filters.page,
    pagination: true,
    overrideAccess: true,
    sort: ['coreGrade', 'title'],
    where: whereFor(filters),
  })

  const ratings = result.docs as unknown as PublicRating[]
  const totalPages = Math.max(1, Number(result.totalPages || 1))
  const currentPage = Math.min(Number(result.page || filters.page), totalPages)

  return (
    <main className="page collection-page ratings-public-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">大众页面</p>
        <h1>作品排雷评级</h1>
        <p>这里展示统一 Release 中可以公开呈现的评级结论。机器等级、置信度、判断摘要、规则类别和人工复核状态都会明确标注；研究事实与来源档案需要登录后在 Radar 资料区查看。</p>
        <div className="collection-actions">
          <span>{Number(result.totalDocs || 0).toLocaleString('zh-CN')} 条当前评级</span>
          <span>第 {currentPage} / {totalPages} 页</span>
          <Link className="back-link" href="/works">浏览全部作品</Link>
          <Link className="back-link" href="/radar">登录后查看研究档案</Link>
        </div>

        <form action="/ratings" className="works-filter-panel">
          <div className="works-filter-grid">
            <label>
              <span>作品</span>
              <input defaultValue={filters.q} name="q" placeholder="标题、Work ID 或公开 Key" type="search" />
            </label>
            <label>
              <span>机器核心等级</span>
              <select defaultValue={filters.grade} name="grade">
                <option value="all">全部等级</option>
                {grades.map((grade) => <option key={grade} value={grade}>{grade} 级</option>)}
              </select>
            </label>
            <label>
              <span>置信度</span>
              <select defaultValue={filters.confidence} name="confidence">
                <option value="all">全部置信度</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <label>
              <span>人工复核</span>
              <select defaultValue={filters.review} name="review">
                <option value="all">全部状态</option>
                <option value="unreviewed">待复核</option>
                <option value="reviewed">已复核</option>
                <option value="disputed">有争议</option>
              </select>
            </label>
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
            <button className="result-link" type="submit">筛选评级</button>
            <Link className="back-link" href="/ratings">清除筛选</Link>
          </div>
        </form>
      </section>

      {ratings.length ? (
        <section className="collection-grid radar-card-grid">
          {ratings.map((rating) => {
            const matchedClasses = values(rating.matchedClasses)
            const tags = (rating.publicTagHints || []).map((item) => String(item?.value || '').trim()).filter(Boolean)
            const warnings = values(rating.publicWarningTemplateIds)
            const unresolved = values(rating.unresolvedDimensions)
            return (
              <article className="collection-card radar-list-card rating-public-card" key={rating.id}>
                <div className="radar-public-heading-row">
                  <div className="work-card-badges">
                    <span className="radar-grade-badge">机器 {rating.coreGrade || '?'} 级</span>
                    <span className="work-type-chip">{confidenceLabel(rating.confidence)}</span>
                    <span className="work-type-chip">{reviewLabel(rating.humanReview?.status)}</span>
                    {rating.humanReview?.proposedCoreGrade ? <span className="work-type-chip">人工建议 {rating.humanReview.proposedCoreGrade} 级</span> : null}
                  </div>
                </div>
                <h2><Link href={canonicalContentUrl('works', rating.workIdSnapshot)}>{rating.title}</Link></h2>
                <p className="radar-reasoning-summary">{rating.reasoningSummary || '暂无公开判断摘要。'}</p>

                <div className="radar-grade-range">
                  <span>最好 <strong>{rating.bestGrade || '?'}</strong></span>
                  <span>最可能 <strong>{rating.likelyGrade || '?'}</strong></span>
                  <span>最坏 <strong>{rating.worstGrade || '?'}</strong></span>
                </div>

                {matchedClasses.length || tags.length ? (
                  <div className="radar-chip-list">
                    {matchedClasses.slice(0, 6).map((value) => <span key={`class:${rating.id}:${value}`}>{value}</span>)}
                    {tags.slice(0, 6).map((value) => <span key={`tag:${rating.id}:${value}`}>{value}</span>)}
                  </div>
                ) : null}

                <div className="radar-list-meta">
                  <span>公开提示 {warnings.length}</span>
                  <span>未决维度 {unresolved.length}</span>
                </div>

                <div className="collection-actions">
                  <Link className="result-link" href={canonicalContentUrl('works', rating.workIdSnapshot)}>查看作品与完整评级</Link>
                  <Link className="back-link" href="/rules">查看分级规则</Link>
                </div>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="empty-state small">
          <h2>没有符合条件的评级</h2>
          <p>可以放宽等级、置信度或人工复核筛选。</p>
          <Link className="result-link" href="/ratings">查看全部当前评级</Link>
        </section>
      )}

      <nav className="collection-actions" aria-label="评级分页">
        {currentPage > 1 ? <Link className="back-link" href={ratingsHref(filters, { page: currentPage - 1 })}>上一页</Link> : <span>上一页</span>}
        <span>第 {currentPage} / {totalPages} 页</span>
        {currentPage < totalPages ? <Link className="back-link" href={ratingsHref(filters, { page: currentPage + 1 })}>下一页</Link> : <span>下一页</span>}
      </nav>
    </main>
  )
}
