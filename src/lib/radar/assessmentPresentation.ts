import {
  normalizeRadarConclusion,
  normalizeRadarDatabaseStatus,
  type RadarConclusionMode,
  type RadarPublicTagContract,
} from './conclusionNormalizer.mjs'

export type RadarMatchedRuleMetrics = {
  code?: string | null
  grade?: string | null
  confidencePercent?: number | null
  reason?: string | null
}

export type RadarAssessmentMetrics = {
  confidencePercent?: number | null
  evidenceCoveragePercent?: number | null
  evidenceStatus?: string | null
  sourceSummary?: string | null
  sourceCount?: number | null
  policyVersion?: string | null
  conclusionMode?: RadarConclusionMode | null
  suggestedGrade?: string | null
  fixedGrade?: string | null
  bestGrade?: string | null
  likelyGrade?: string | null
  worstGrade?: string | null
  decisiveRuleCode?: string | null
  decisiveRuleReason?: string | null
  matchedRules?: RadarMatchedRuleMetrics[] | null
  contradictions?: Array<string | { value?: string | null }> | null
  unresolvedDimensions?: Array<string | { value?: string | null }> | null
  validationIssues?: string[] | null
  requiresHumanReview?: boolean | null
  recommendedNextQueue?: string | null
  warningTemplateId?: string | null
  publicTags?: RadarPublicTagContract[] | null
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
  external_source_pending_review: '外部资料整理，待复核',
  insufficient_information: '信息不足，待补充',
  identity_conflict: '条目身份存在冲突',
  quarantine_excluded: '隔离记录，不参与公开评级',
  manual_reviewed: '人工已确认',
  none: '暂无额外页面提示',
  other: '请结合页面说明',
}

const pageNoticeTones: Record<string, string> = {
  ai_synthesized_pending_review: 'medium',
  external_source_pending_review: 'medium',
  insufficient_information: 'caution',
  identity_conflict: 'danger',
  quarantine_excluded: 'danger',
  manual_reviewed: 'strong',
  none: 'neutral',
  other: 'neutral',
}

export function normalizeRadarPercent(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

function normalizeSourceCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function metricBand(value: number | null) {
  if (value === null) return '尚未计算'
  if (value >= 90) return '很高'
  if (value >= 75) return '较高'
  if (value >= 50) return '中等'
  return '偏低'
}

function reviewLabel(input: RadarAssessmentPresentationInput, notice: string) {
  if (ratingNoticeLabels[notice]) return ratingNoticeLabels[notice]
  const status = cleanText(input.reviewStatus)
  return reviewStatusLabels[status] || status || '待复核'
}

function evidenceLabel(input: RadarAssessmentPresentationInput) {
  const status = cleanText(input.radarAssessment?.evidenceStatus)
  if (status && status !== 'unknown') return evidenceStatusLabels[status] || status
  const strength = cleanText(input.evidenceStrength)
  return evidenceStrengthLabels[strength] || evidenceStatusLabels[status] || '尚未评估'
}

function evidenceTone(input: RadarAssessmentPresentationInput) {
  const status = cleanText(input.radarAssessment?.evidenceStatus)
  if (status && status !== 'unknown') return evidenceStatusTones[status] || 'neutral'
  if (input.evidenceStrength === 'strong') return 'strong'
  if (input.evidenceStrength === 'medium') return 'medium'
  if (input.evidenceStrength === 'weak') return 'caution'
  return 'neutral'
}

function assessedDate(value?: string | null) {
  const normalized = cleanText(value)
  if (!normalized) return ''
  const match = normalized.match(/^\d{4}-\d{2}-\d{2}/u)
  return match?.[0] || normalized
}

function normalizeMatchedRules(value?: RadarMatchedRuleMetrics[] | null) {
  if (!Array.isArray(value)) return []
  return value
    .map((rule) => ({
      code: cleanText(rule?.code),
      grade: cleanText(rule?.grade).toUpperCase(),
      confidencePercent: normalizeRadarPercent(rule?.confidencePercent),
      reason: cleanText(rule?.reason),
    }))
    .filter((rule) => rule.code || rule.reason)
}

function normalizeContradictions(value?: Array<string | { value?: string | null }> | null) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => cleanText(typeof item === 'string' ? item : item?.value)).filter(Boolean))]
}

export function buildRadarAssessmentPresentation(input: RadarAssessmentPresentationInput) {
  const assessment = input.radarAssessment
  const confidence = normalizeRadarPercent(assessment?.confidencePercent)
  const coverage = normalizeRadarPercent(assessment?.evidenceCoveragePercent)
  const sourceSummary = cleanText(assessment?.sourceSummary)
  const sourceCount = normalizeSourceCount(assessment?.sourceCount)
  const policyVersion = cleanText(assessment?.policyVersion)
  const assessedAt = assessedDate(assessment?.assessedAt)
  const reviewStatus = cleanText(input.reviewStatus)
  const rawNotice = normalizeRadarDatabaseStatus(input.ratingNotice)
  const baseRequiresHumanReview = assessment?.requiresHumanReview === true
    || rawNotice === 'ai_synthesized_pending_review'
    || rawNotice === 'external_source_pending_review'
    || reviewStatus === 'pending'
    || reviewStatus === 'disputed'

  const conclusion = normalizeRadarConclusion({
    suggestedGrade: assessment?.suggestedGrade ?? assessment?.fixedGrade,
    bestGrade: assessment?.bestGrade,
    likelyGrade: assessment?.likelyGrade,
    worstGrade: assessment?.worstGrade,
    classificationRule: assessment?.decisiveRuleCode,
    matchedClasses: assessment?.matchedRules?.map((rule) => rule.code || ''),
    unresolvedDimensions: assessment?.unresolvedDimensions,
    requiresHumanReview: baseRequiresHumanReview,
    recommendedNextQueue: assessment?.recommendedNextQueue,
    evidenceStatus: assessment?.evidenceStatus,
    ratingNotice: rawNotice,
    warningTemplateId: assessment?.warningTemplateId,
    publicTags: assessment?.publicTags,
  })
  const notice = conclusion.databaseStatus || rawNotice

  return {
    confidence,
    confidenceLabel: confidence === null ? '尚未计算' : `${confidence}%`,
    confidenceBand: metricBand(confidence),
    coverage,
    coverageLabel: coverage === null ? '尚未计算' : `${coverage}%`,
    coverageBand: metricBand(coverage),
    evidenceLabel: evidenceLabel(input),
    evidenceTone: evidenceTone(input),
    reviewLabel: reviewLabel(input, notice),
    reviewStatusLabel: reviewStatusLabels[reviewStatus] || reviewStatus || '待复核',
    pageNoticeTone: pageNoticeTones[notice] || 'neutral',
    sourceSummary,
    sourceCount,
    policyVersion,
    assessedAt,
    conclusionMode: conclusion.conclusionMode,
    conclusionTitle: conclusion.title,
    conclusionDisplay: conclusion.display,
    likelyLabel: conclusion.likelyLabel,
    fixedGrade: conclusion.fixedGrade,
    bestGrade: conclusion.bestGrade,
    likelyGrade: conclusion.likelyGrade,
    worstGrade: conclusion.worstGrade,
    suggestedGrade: conclusion.fixedGrade,
    validationIssues: [...new Set([
      ...(assessment?.validationIssues || []),
      ...conclusion.validationIssues,
    ])],
    warningTemplateId: conclusion.warningTemplateId,
    publicTags: conclusion.publicTags,
    pendingReasons: conclusion.pendingReasons,
    unresolvedDimensions: conclusion.unresolvedDimensions,
    decisiveRuleCode: cleanText(assessment?.decisiveRuleCode),
    decisiveRuleReason: cleanText(assessment?.decisiveRuleReason),
    matchedRules: normalizeMatchedRules(assessment?.matchedRules),
    contradictions: normalizeContradictions(assessment?.contradictions),
    requiresHumanReview: conclusion.requiresHumanReview || conclusion.needsPendingTag,
    hasCalculatedMetrics: confidence !== null || coverage !== null,
    confidenceExplanation: '表示当前排雷建议与现有证据的一致程度，不等同于作品安全概率。',
    coverageExplanation: '表示角色关系、剧情发展、结局、官方说明与来源材料等关键证据的完整度。',
  }
}
