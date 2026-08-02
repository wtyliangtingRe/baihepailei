import configPromise from '@payload-config'
import Link from 'next/link'
import { getPayload } from 'payload'

type RadarRecord = {
  id: string | number
  publicationKey: string
  publicState: string
  pageNotice: string
  facts?: Array<unknown>
  evidence?: Array<unknown>
}

type RadarRating = {
  coreGrade?: string
  bestGrade?: string
  likelyGrade?: string
  worstGrade?: string
  confidence?: string
  reasoningSummary?: string
  matchedClasses?: Array<{ value?: string }>
  unresolvedDimensions?: Array<{ value?: string }>
  publicTagHints?: Array<{ value?: string }>
  publicWarningTemplateIds?: Array<{ value?: string }>
  humanReview?: { status?: string; proposedCoreGrade?: string }
}

function stateLabel(value?: string) {
  if (value === 'verified') return '资料已验证'
  if (value === 'partial') return '部分资料已验证'
  if (value === 'needs_more_research') return '资料待补充'
  return '资料状态未知'
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

export default async function RadarPublicProjection({ workId }: { workId?: string | number }) {
  if (workId === undefined || workId === null || String(workId).trim() === '') return null

  const payload = await getPayload({ config: configPromise })
  const publicationKey = `work:${String(workId)}`
  const [recordResult, ratingResult] = await Promise.all([
    payload.find({
      collection: 'radar-public-records',
      depth: 0,
      limit: 1,
      page: 1,
      pagination: true,
      overrideAccess: true,
      where: {
        and: [
          { publicationKey: { equals: publicationKey } },
          { recordStatus: { equals: 'current' } },
        ],
      },
    }),
    payload.find({
      collection: 'radar-public-ratings',
      depth: 0,
      limit: 1,
      page: 1,
      pagination: true,
      overrideAccess: true,
      where: {
        and: [
          { publicationKey: { equals: publicationKey } },
          { recordStatus: { equals: 'current' } },
        ],
      },
    }),
  ])

  const record = recordResult.docs[0] as unknown as RadarRecord | undefined
  const rating = ratingResult.docs[0] as unknown as RadarRating | undefined
  if (!record || !rating) return null

  const matchedClasses = values(rating.matchedClasses)
  const unresolved = values(rating.unresolvedDimensions)
  const warnings = values(rating.publicWarningTemplateIds)
  const tags = (rating.publicTagHints || []).map((item) => String(item?.value || '').trim()).filter(Boolean)

  return (
    <section className="detail-card radar-public-panel" aria-labelledby="radar-public-heading">
      <div className="radar-public-heading-row">
        <div>
          <p className="eyebrow">作品排雷评级</p>
          <h2 id="radar-public-heading">统一评级结论</h2>
        </div>
        <div className="work-card-badges">
          <span className="radar-grade-badge">机器 {rating.coreGrade || '?'} 级</span>
          <span className="work-type-chip">{confidenceLabel(rating.confidence)}</span>
          <span className="work-type-chip">{reviewLabel(rating.humanReview?.status)}</span>
          {rating.humanReview?.proposedCoreGrade ? <span className="work-type-chip">人工建议 {rating.humanReview.proposedCoreGrade} 级</span> : null}
        </div>
      </div>

      <p className="radar-page-notice">{record.pageNotice}</p>
      <div className="radar-summary-block">
        <h3>判断摘要</h3>
        <p>{rating.reasoningSummary || '暂无公开判断摘要。'}</p>
      </div>

      <div className="radar-grade-range" aria-label="评级区间">
        <span>最好 <strong>{rating.bestGrade || '?'}</strong></span>
        <span>最可能 <strong>{rating.likelyGrade || '?'}</strong></span>
        <span>最坏 <strong>{rating.worstGrade || '?'}</strong></span>
      </div>

      {matchedClasses.length || tags.length ? (
        <div className="radar-detail-section">
          <h3>规则类别与标签</h3>
          <div className="radar-chip-list">
            {matchedClasses.slice(0, 10).map((value) => <span key={`class:${value}`}>{value}</span>)}
            {tags.slice(0, 10).map((value) => <span key={`tag:${value}`}>{value}</span>)}
          </div>
        </div>
      ) : null}

      <div className="radar-metric-grid">
        <div><span>资料状态</span><strong>{stateLabel(record.publicState)}</strong></div>
        <div><span>公开提示</span><strong>{warnings.length}</strong></div>
        <div><span>未决维度</span><strong>{unresolved.length}</strong></div>
        <div><span>研究规模</span><strong>{record.facts?.length || 0} 条事实 · {record.evidence?.length || 0} 条证据</strong></div>
      </div>

      {unresolved.length ? (
        <details className="rank-explainer">
          <summary><span>仍需注意</span><strong>查看尚未解决的排雷维度</strong></summary>
          <ul>{unresolved.slice(0, 12).map((value) => <li key={value}>{value}</li>)}</ul>
        </details>
      ) : null}

      <div className="collection-actions">
        <Link className="result-link" href="/ratings">浏览大众评级页</Link>
        <Link className="back-link" href={`/radar/${record.id}`}>登录后查看研究事实与来源</Link>
        <Link className="back-link" href="/rules">查看完整评级规则</Link>
      </div>
    </section>
  )
}
