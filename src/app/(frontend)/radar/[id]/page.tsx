import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { isEditor } from '@/access/roles'

import { canonicalContentUrl } from '../../_lib/content-identity'

export const dynamic = 'force-dynamic'

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
  facts?: Array<{
    factId?: string
    factType?: string
    value?: string
    sourceRefs?: Array<{ value?: string }>
  }>
  evidence?: Array<{
    sourceRef?: string
    tier?: string
    role?: string
    url?: string
    title?: string
    exactIdentityBound?: boolean
  }>
  sourceReleaseId?: string
  sourceCommitSha?: string
  sourcePolicyVersion?: string
  researchSnapshotId?: string
  recordSha256?: string
  sourceReviewedAt?: string
  importedAt?: string
  recordStatus: string
  updatedAt?: string
}

type RadarRating = {
  id: string | number
  publicationKey: string
  coreGrade?: string
  bestGrade?: string
  likelyGrade?: string
  worstGrade?: string
  confidence?: string
  matchedClasses?: Array<{ value?: string }>
  factRefs?: Array<{ value?: string }>
  evidenceRefs?: Array<{ value?: string }>
  reasoningSummary?: string
  unresolvedDimensions?: Array<{ value?: string }>
  classificationRule?: string
  confirmationBasis?: Array<{ value?: string }>
  benefitOfDoubtBaselineApplied?: boolean
  publicTagHints?: Array<{ key?: string; group?: string; value?: string; warningTemplateId?: string }>
  publicWarningTemplateIds?: Array<{ value?: string }>
  humanReview?: {
    status?: string
    reviewerIdentity?: string
    reviewedAt?: string
    decision?: string
    proposedCoreGrade?: string
    reasoning?: string
    moderationState?: string
    blocksAnalysis?: boolean
    blocksPublication?: boolean
  }
  sourceRatingCampaignId?: string
  sourceRatingDecisionHash?: string
  releaseRatingHash?: string
  importedAt?: string
  recordStatus?: string
}

function values(rows?: Array<{ value?: string }>) {
  return (rows || []).map((row) => String(row?.value || '').trim()).filter(Boolean)
}

function stateLabel(value?: string) {
  if (value === 'verified') return '已验证'
  if (value === 'partial') return '部分资料已验证'
  if (value === 'needs_more_research') return '资料待补充'
  return value || '未知'
}

function researchLabel(value?: string) {
  if (value === 'ready_for_publication') return '可公开'
  if (value === 'partially_verified') return '部分验证'
  if (value === 'needs_more_research') return '资料不足'
  return value || '未知'
}

function roleLabel(value?: string) {
  if (value === 'primary') return '主要证据'
  if (value === 'licensed_or_authorized') return '正版或授权来源'
  if (value === 'supplemental') return '补充证据'
  if (value === 'lead_only') return '仅作线索'
  return value || '未标注'
}

function confidenceLabel(value?: string) {
  if (value === 'high') return '高'
  if (value === 'medium') return '中'
  if (value === 'low') return '低'
  return value || '未知'
}

function formatDate(value?: string) {
  if (!value) return '未记录'
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

export default async function RadarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  const staff = isEditor(auth.user)

  let record: RadarRecord
  try {
    record = await payload.findByID({
      collection: 'radar-public-records',
      id,
      depth: 0,
      overrideAccess: true,
    }) as unknown as RadarRecord
  } catch {
    notFound()
  }

  if (record.recordStatus !== 'current' && !staff) notFound()

  const ratingResult = await payload.find({
    collection: 'radar-public-ratings',
    depth: 0,
    limit: 1,
    page: 1,
    pagination: true,
    overrideAccess: true,
    where: {
      and: [
        { publicationKey: { equals: record.publicationKey } },
        { recordStatus: { equals: record.recordStatus } },
      ],
    },
  })
  const rating = ratingResult.docs[0] as unknown as RadarRating | undefined
  const matchedClasses = values(rating?.matchedClasses)
  const unresolved = values(rating?.unresolvedDimensions)
  const confirmationBasis = values(rating?.confirmationBasis)
  const warningIds = values(rating?.publicWarningTemplateIds)

  return (
    <main className="page collection-page radar-detail-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">统一 Radar 记录</p>
        <h1>{record.title}</h1>
        <p>{record.pageNotice}</p>
        <div className="work-card-badges">
          <span className="radar-grade-badge">{rating?.coreGrade ? `${rating.coreGrade} 级` : '尚未评级'}</span>
          <span className="work-type-chip">{stateLabel(record.publicState)}</span>
          <span className="work-type-chip">{researchLabel(record.researchStatus)}</span>
          <span className="work-type-chip">置信度 {confidenceLabel(rating?.confidence)}</span>
          {record.recordStatus !== 'current' ? <span className="content-visibility-chip">已撤回</span> : null}
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/radar">返回 Radar 列表</Link>
          <Link className="result-link" href={canonicalContentUrl('works', record.workIdSnapshot)}>查看作品页</Link>
          {staff ? <Link className="review-link" href={`/me/studio/radar/${record.id}`}>网页编辑</Link> : null}
          {staff ? <Link className="review-link" href={`/admin/collections/radar-public-records/${record.id}`}>完整编辑研究记录</Link> : null}
          {staff && rating ? <Link className="review-link" href={`/admin/collections/radar-public-ratings/${rating.id}`}>完整编辑评级</Link> : null}
        </div>
      </section>

      {rating ? (
        <section className="detail-card radar-rating-detail">
          <div className="radar-public-heading-row">
            <div>
              <p className="eyebrow">机器评级</p>
              <h2>公开评级结论</h2>
            </div>
            <div className="radar-grade-range">
              <span>最好 <strong>{rating.bestGrade || '?'}</strong></span>
              <span>最可能 <strong>{rating.likelyGrade || '?'}</strong></span>
              <span>最坏 <strong>{rating.worstGrade || '?'}</strong></span>
            </div>
          </div>
          <p className="radar-reasoning-summary">{rating.reasoningSummary}</p>

          {matchedClasses.length ? (
            <div className="radar-detail-section">
              <h3>命中的公开规则类别</h3>
              <div className="radar-chip-list">{matchedClasses.map((value) => <span key={value}>{value}</span>)}</div>
            </div>
          ) : null}

          {rating.publicTagHints?.length ? (
            <div className="radar-detail-section">
              <h3>公开标签提示</h3>
              <div className="radar-tag-table">
                {rating.publicTagHints.map((item, index) => (
                  <div key={`${item.key || item.value || 'tag'}:${index}`}>
                    <strong>{item.value || item.key || '未命名标签'}</strong>
                    <span>{item.group || '未分组'}</span>
                    {item.warningTemplateId ? <code>{item.warningTemplateId}</code> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {warningIds.length ? (
            <div className="radar-detail-section">
              <h3>公开提示模板</h3>
              <div className="radar-chip-list">{warningIds.map((value) => <code key={value}>{value}</code>)}</div>
            </div>
          ) : null}

          {unresolved.length ? (
            <div className="radar-detail-section">
              <h3>尚未解决的排雷维度</h3>
              <ul>{unresolved.map((value) => <li key={value}>{value}</li>)}</ul>
            </div>
          ) : null}

          {confirmationBasis.length ? (
            <div className="radar-detail-section">
              <h3>确认依据</h3>
              <ul>{confirmationBasis.map((value) => <li key={value}>{value}</li>)}</ul>
            </div>
          ) : null}

          <div className="radar-metric-grid">
            <div><span>分类规则</span><strong>{rating.classificationRule || '未记录'}</strong></div>
            <div><span>谨慎有利推定</span><strong>{rating.benefitOfDoubtBaselineApplied ? '已应用' : '未应用'}</strong></div>
            <div><span>人工复核</span><strong>{rating.humanReview?.status || 'unreviewed'}</strong></div>
            <div><span>建议等级</span><strong>{rating.humanReview?.proposedCoreGrade || '无'}</strong></div>
          </div>

          {staff && rating.humanReview?.reasoning ? (
            <div className="review-safety-note">
              <strong>内部复核理由</strong>
              <p>{rating.humanReview.reasoning}</p>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="detail-card">
          <h2>尚无公开评级</h2>
          <p>这条公开研究记录目前没有对应的机器评级记录。</p>
        </section>
      )}

      <section className="detail-card">
        <div className="radar-public-heading-row">
          <div>
            <p className="eyebrow">研究事实</p>
            <h2>公开事实</h2>
          </div>
          <span>{record.facts?.length || 0} 条</span>
        </div>
        {record.facts?.length ? (
          <div className="radar-fact-list">
            {record.facts.map((fact, index) => (
              <article key={`${fact.factId || 'fact'}:${index}`}>
                <div className="radar-fact-heading">
                  <strong>{fact.factType || '未分类事实'}</strong>
                  <code>{fact.factId || `fact-${index + 1}`}</code>
                </div>
                <p>{fact.value}</p>
                {fact.sourceRefs?.length ? (
                  <div className="radar-chip-list">
                    {fact.sourceRefs.map((ref, refIndex) => (
                      <code key={`${ref.value || 'ref'}:${refIndex}`}>{ref.value}</code>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : <p>暂无公开事实。</p>}
      </section>

      <section className="detail-card">
        <div className="radar-public-heading-row">
          <div>
            <p className="eyebrow">证据</p>
            <h2>公开来源</h2>
          </div>
          <span>{record.evidence?.length || 0} 条</span>
        </div>
        {record.evidence?.length ? (
          <div className="radar-evidence-list">
            {record.evidence.map((evidence, index) => (
              <article key={`${evidence.sourceRef || 'evidence'}:${index}`}>
                <div className="radar-fact-heading">
                  <strong>{evidence.title || evidence.sourceRef || '未命名来源'}</strong>
                  <span>Tier {evidence.tier || '?'} · {roleLabel(evidence.role)}</span>
                </div>
                <p><code>{evidence.sourceRef}</code>{evidence.exactIdentityBound ? ' · 已绑定精确身份' : ''}</p>
                {evidence.url ? <a href={evidence.url} rel="noreferrer noopener" target="_blank">打开来源</a> : null}
              </article>
            ))}
          </div>
        ) : <p>暂无公开来源。</p>}
      </section>

      <section className="detail-card radar-provenance-card">
        <h2>版本与来源绑定</h2>
        <dl>
          <div><dt>身份 Key</dt><dd><code>{record.identityKey}</code></dd></div>
          <div><dt>作品 Site ID</dt><dd><code>{record.workSiteId}</code></dd></div>
          <div><dt>Release</dt><dd><code>{record.sourceReleaseId || '未记录'}</code></dd></div>
          <div><dt>研究 Commit</dt><dd><code>{record.sourceCommitSha || '未记录'}</code></dd></div>
          <div><dt>Policy</dt><dd><code>{record.sourcePolicyVersion || '未记录'}</code></dd></div>
          <div><dt>记录 SHA-256</dt><dd><code>{record.recordSha256 || '未记录'}</code></dd></div>
          <div><dt>来源复核</dt><dd>{formatDate(record.sourceReviewedAt)}</dd></div>
          <div><dt>导入时间</dt><dd>{formatDate(record.importedAt)}</dd></div>
          {rating?.sourceRatingCampaignId ? <div><dt>评级 Campaign</dt><dd><code>{rating.sourceRatingCampaignId}</code></dd></div> : null}
          {rating?.sourceRatingDecisionHash ? <div><dt>评级决策 SHA</dt><dd><code>{rating.sourceRatingDecisionHash}</code></dd></div> : null}
        </dl>
      </section>
    </main>
  )
}
