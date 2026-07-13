export type RadarAssessmentMetrics = {
  confidencePercent?: number | null
  evidenceCoveragePercent?: number | null
  evidenceStatus?: string | null
  sourceSummary?: string | null
  policyVersion?: string | null
  assessedAt?: string | null
}

export type RadarAssessmentPresentationInput = {
  radarAssessment?: RadarAssessmentMetrics | null
  ratingNotice?: string | null
  reviewStatus?: string | null
  evidenceStrength?: string | null
}

const evidenceStatusLabels: Record<string, string> = {
  official_confirmed: '官方材料确认',
  primary_material_confirmed: '原作材料确认',
  multiple_secondary_supported: '多个来源支持',
  single_secondary_supported: '单一来源支持',
  community_consensus: '社群资料基本一致',
  inferred_from_metadata: '仅由元数据推断',
  conflicting_evidence: '来源存在冲突',
  insufficient_evidence: '证据不足',
  unknown: '尚未评估',
}

const evidenceStatusTones: Record<string, string> = {
  official_confirmed: 'strong',
  primary_material_confirmed: 'strong',
  multiple_secondary_supported: 'strong',
  single_secondary_supported: 'medium',
  community_consensus: 'medium',
  inferred_from_metadata: 'caution',
  conflicting_evidence: 'danger',
  insufficient_evidence: 'caution',
  unknown: 'neutral',
}

const evidenceStrengthLabels: Record<string, string> = {
  strong: '证据强',
  medium: '证据中',
  weak: '证据弱',
  unassessed: '尚未评估',
}

const reviewStatusLabels: Record<string, string> = {
  pending: '待复核',
  reviewed: '已复核',
  disputed: '有争议',
  deprecated: '已废弃',
}

const ratingNoticeLabels: Record<string, string> = {
  ai_synthesized_pending_review: 'AI 综合，待复核',
  insufficient_information: '信息不足，待补充',
  manual_reviewed: '人工已确认',
}

export function normalizeRadarPercent(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

function metricBand(value: number | null) {
  if (value === null) return '尚未计算'
  if (value >= 90) return '很高'
  if (value >= 75) return '较高'
  if (value >= 50) return '中等'
  return '偏低'
}

function reviewLabel(input: RadarAssessmentPresentationInput) {
  const notice = String(input.ratingNotice || '').trim()
  if (ratingNoticeLabels[notice]) return ratingNoticeLabels[notice]
  const status = String(input.reviewStatus || '').trim()
  return reviewStatusLabels[status] || status || '待复核'
}

function evidenceLabel(input: RadarAssessmentPresentationInput) {
  const status = String(input.radarAssessment?.evidenceStatus || '').trim()
  if (status && status !== 'unknown') return evidenceStatusLabels[status] || status
  const strength = String(input.evidenceStrength || '').trim()
  return evidenceStrengthLabels[strength] || evidenceStatusLabels[status] || '尚未评估'
}

function evidenceTone(input: RadarAssessmentPresentationInput) {
  const status = String(input.radarAssessment?.evidenceStatus || '').trim()
  if (status && status !== 'unknown') return evidenceStatusTones[status] || 'neutral'
  if (input.evidenceStrength === 'strong') return 'strong'
  if (input.evidenceStrength === 'medium') return 'medium'
  if (input.evidenceStrength === 'weak') return 'caution'
  return 'neutral'
}

function assessedDate(value?: string | null) {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  const match = normalized.match(/^\d{4}-\d{2}-\d{2}/u)
  return match?.[0] || normalized
}

export function buildRadarAssessmentPresentation(input: RadarAssessmentPresentationInput) {
  const confidence = normalizeRadarPercent(input.radarAssessment?.confidencePercent)
  const coverage = normalizeRadarPercent(input.radarAssessment?.evidenceCoveragePercent)
  const sourceSummary = String(input.radarAssessment?.sourceSummary || '').trim()
  const policyVersion = String(input.radarAssessment?.policyVersion || '').trim()
  const assessedAt = assessedDate(input.radarAssessment?.assessedAt)

  return {
    confidence,
    confidenceLabel: confidence === null ? '尚未计算' : `${confidence}%`,
    confidenceBand: metricBand(confidence),
    coverage,
    coverageLabel: coverage === null ? '尚未计算' : `${coverage}%`,
    coverageBand: metricBand(coverage),
    evidenceLabel: evidenceLabel(input),
    evidenceTone: evidenceTone(input),
    reviewLabel: reviewLabel(input),
    sourceSummary,
    policyVersion,
    assessedAt,
    hasCalculatedMetrics: confidence !== null || coverage !== null,
    confidenceExplanation: '表示当前排雷建议与现有证据的一致程度，不等同于作品安全概率。',
    coverageExplanation: '表示角色关系、剧情发展、结局、官方说明与来源材料等关键证据的完整度。',
  }
}
