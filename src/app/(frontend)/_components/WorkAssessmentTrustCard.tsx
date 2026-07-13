import { buildRadarAssessmentPresentation, type RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'

import type { DetailItem } from '../_lib/detail-index'

type AssessmentDetailItem = DetailItem & {
  radarAssessment?: RadarAssessmentMetrics
  ratingNotice?: string
  reviewStatus?: string
  evidenceStrength?: string
}

function Metric({ description, label, value }: { description: string; label: string; value: number | null }) {
  return (
    <article className="work-assessment-metric" data-calculated={value !== null ? 'true' : 'false'}>
      <div className="work-assessment-metric-heading">
        <span>{label}</span>
        <strong>{value === null ? '尚未计算' : `${value}%`}</strong>
      </div>
      {value !== null ? <progress aria-label={`${label} ${value}%`} max={100} value={value} /> : <div className="work-assessment-progress-placeholder" aria-hidden="true" />}
      <p>{description}</p>
    </article>
  )
}

export default function WorkAssessmentTrustCard({ item }: { item: DetailItem }) {
  if (item.collection !== 'works') return null

  const assessmentItem = item as AssessmentDetailItem
  const presentation = buildRadarAssessmentPresentation({
    radarAssessment: assessmentItem.radarAssessment,
    ratingNotice: assessmentItem.ratingNotice,
    reviewStatus: assessmentItem.reviewStatus,
    evidenceStrength: assessmentItem.evidenceStrength,
  })

  return (
    <section className="detail-card work-assessment-trust-card" aria-label="排雷可信度">
      <div className="work-assessment-trust-head">
        <p className="eyebrow">评级依据</p>
        <h2>排雷可信度</h2>
        <p className="muted">
          {presentation.hasCalculatedMetrics
            ? '这些指标说明当前排雷判断依赖的证据质量和资料完整度。'
            : '该条目尚未完成新版可信度计算，当前仅展示已有的证据与复核状态。'}
        </p>
      </div>

      <div className="work-assessment-metrics">
        <Metric description={presentation.confidenceExplanation} label="判断置信度" value={presentation.confidence} />
        <Metric description={presentation.coverageExplanation} label="资料覆盖度" value={presentation.coverage} />
      </div>

      <dl className="work-assessment-statuses">
        <div>
          <dt>证据状态</dt>
          <dd data-tone={presentation.evidenceTone}>{presentation.evidenceLabel}</dd>
        </div>
        <div>
          <dt>复核状态</dt>
          <dd>{presentation.reviewLabel}</dd>
        </div>
        {presentation.assessedAt ? (
          <div>
            <dt>评估日期</dt>
            <dd>{presentation.assessedAt}</dd>
          </div>
        ) : null}
        {presentation.policyVersion ? (
          <div>
            <dt>规则版本</dt>
            <dd>{presentation.policyVersion}</dd>
          </div>
        ) : null}
      </dl>

      {presentation.sourceSummary ? (
        <details className="work-assessment-source-summary">
          <summary>查看来源摘要</summary>
          <p>{presentation.sourceSummary}</p>
        </details>
      ) : null}

      <p className="work-assessment-disclaimer">
        置信度反映“当前判断有多可靠”，并不表示作品有多少概率安全；资料不足或来源冲突时，请优先阅读雷点说明与公开来源。
      </p>
    </section>
  )
}
