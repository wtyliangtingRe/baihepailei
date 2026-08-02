import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { getPayload } from 'payload'

import { isEditor } from '@/access/roles'

type RadarRecord = {
  id: string | number
  publicationKey: string
  title: string
  publicState: string
  researchStatus: string
  pageNotice: string
  facts?: Array<{ factId?: string; factType?: string; value?: string }>
  evidence?: Array<{ sourceRef?: string; tier?: string; role?: string; url?: string; title?: string }>
  recordStatus: string
}

type RadarRating = {
  id: string | number
  coreGrade?: string
  bestGrade?: string
  likelyGrade?: string
  worstGrade?: string
  confidence?: string
  reasoningSummary?: string
  matchedClasses?: Array<{ value?: string }>
  publicTagHints?: Array<{ key?: string; group?: string; value?: string }>
  publicWarningTemplateIds?: Array<{ value?: string }>
  humanReview?: { status?: string; proposedCoreGrade?: string }
  recordStatus?: string
}

function gradeLabel(value?: string) {
  return value ? `机器 ${value} 级` : '尚未评级'
}

function stateLabel(value?: string) {
  if (value === 'verified') return '已验证'
  if (value === 'partial') return '部分资料已验证'
  if (value === 'needs_more_research') return '资料待补充'
  return value || '状态未知'
}

function confidenceLabel(value?: string) {
  if (value === 'high') return '高置信度'
  if (value === 'medium') return '中置信度'
  if (value === 'low') return '低置信度'
  return value || '置信度未知'
}

function values(rows?: Array<{ value?: string }>) {
  return (rows || []).map((row) => String(row?.value || '').trim()).filter(Boolean)
}

export default async function RadarPublicProjection({ workId }: { workId?: string | number }) {
  if (workId === undefined || workId === null || String(workId).trim() === '') return null

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
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
  if (!record) return null
  const rating = ratingResult.docs[0] as unknown as RadarRating | undefined
  const canEdit = isEditor(auth.user)
  const matchedClasses = values(rating?.matchedClasses)
  const tags = (rating?.publicTagHints || [])
    .map((item) => String(item?.value || '').trim())
    .filter(Boolean)

  return (
    <section className="detail-card radar-public-panel" aria-labelledby="radar-public-heading">
      <div className="radar-public-heading-row">
        <div>
          <p className="eyebrow">统一 Radar 公开投影</p>
          <h2 id="radar-public-heading">公开研究与机器评级</h2>
        </div>
        <div className="work-card-badges">
          <span className="radar-grade-badge">{gradeLabel(rating?.coreGrade)}</span>
          <span className="work-type-chip">{stateLabel(record.publicState)}</span>
          {rating?.confidence ? <span className="work-type-chip">{confidenceLabel(rating.confidence)}</span> : null}
        </div>
      </div>

      <p className="radar-page-notice">{record.pageNotice}</p>

      {rating?.reasoningSummary ? (
        <div className="radar-summary-block">
          <h3>公开判断摘要</h3>
          <p>{rating.reasoningSummary}</p>
        </div>
      ) : null}

      {matchedClasses.length || tags.length ? (
        <div className="radar-chip-list" aria-label="公开规则与标签">
          {matchedClasses.slice(0, 8).map((value) => <span key={`class:${value}`}>{value}</span>)}
          {tags.slice(0, 8).map((value) => <span key={`tag:${value}`}>{value}</span>)}
        </div>
      ) : null}

      <div className="radar-metric-grid">
        <div><span>公开事实</span><strong>{record.facts?.length || 0}</strong></div>
        <div><span>公开证据</span><strong>{record.evidence?.length || 0}</strong></div>
        <div><span>最好 / 可能 / 最坏</span><strong>{rating ? `${rating.bestGrade || '?'} / ${rating.likelyGrade || '?'} / ${rating.worstGrade || '?'}` : '未评级'}</strong></div>
        <div><span>人工复核</span><strong>{rating?.humanReview?.status || '未复核'}</strong></div>
      </div>

      <div className="collection-actions">
        <Link className="result-link" href={`/radar/${record.id}`}>查看完整 Radar 记录</Link>
        <Link className="back-link" href={`/works?assessment=ai`}>浏览已评估作品</Link>
        {canEdit ? <Link className="review-link" href={`/me/studio/radar/${record.id}`}>编辑这条 Radar 记录</Link> : null}
      </div>
    </section>
  )
}
