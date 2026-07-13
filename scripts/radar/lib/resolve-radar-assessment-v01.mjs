import {
  AI_REVIEW_NOTICE,
  EVIDENCE_STATUSES,
  GRADE_LABELS,
  GRADE_PRIORITY,
  RADAR_POLICY_ID,
  RADAR_POLICY_SAFETY,
  RADAR_RULE_BY_CODE,
} from './radar-policy-v04.mjs'

const POSITIVE_GRADES = new Set(['S', 'A'])
const STRONG_EVIDENCE = new Set([
  'official_confirmed',
  'primary_material_confirmed',
  'multiple_secondary_supported',
])

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export function normalizeConfidence(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const normalized = number > 1 ? number / 100 : number
  return Math.min(1, Math.max(0, normalized))
}

function normalizeEvidenceStatus(value) {
  const status = val(value)
  return EVIDENCE_STATUSES.includes(status) ? status : 'unknown'
}

function normalizeSources(value) {
  return list(value)
    .map((source) => {
      if (typeof source === 'string') return { label: val(source) }
      if (!source || typeof source !== 'object') return null
      return {
        label: val(source.label || source.title || source.source),
        url: val(source.url) || undefined,
        sourceType: val(source.sourceType || source.type || source.source) || undefined,
      }
    })
    .filter((source) => source?.label || source?.url)
}

function normalizeRuleAssessment(item) {
  const code = val(item?.code || item?.ruleCode)
  const rule = RADAR_RULE_BY_CODE[code]
  if (!rule) return { invalid: true, code, raw: item }

  return {
    code,
    grade: rule.grade,
    label: rule.label,
    keywords: rule.keywords,
    matched: item?.matched === true,
    confidence: normalizeConfidence(item?.confidence),
    reason: val(item?.reason),
    evidenceStatus: normalizeEvidenceStatus(item?.evidenceStatus),
    sources: normalizeSources(item?.sources),
    supportingEvidence: list(item?.supportingEvidence).map(val).filter(Boolean),
    contradictingEvidence: list(item?.contradictingEvidence).map(val).filter(Boolean),
    requiresHumanReview: Boolean(rule.requiresHumanReview),
    doNotAutoPublish: Boolean(rule.doNotAutoPublish),
  }
}

function findContradictions(matches) {
  const codes = new Set(matches.map((item) => item.code))
  const contradictions = []

  const pair = (left, right, code) => {
    if (codes.has(left) && codes.has(right)) contradictions.push(code)
  }

  pair('S-CREATOR-SAFE', 'E-OFFICIAL-DENIAL', 'creator_safe_conflicts_with_official_denial')
  pair('S-MARRIAGE', 'F-HET-END', 'yuri_commitment_conflicts_with_heterosexual_ending')
  pair('S-RELATIONSHIP', 'F-YURI-BAIT', 'confirmed_relationship_conflicts_with_yuri_bait')
  pair('A-ONGOING', 'F-HET-END', 'ongoing_safe_conflicts_with_heterosexual_ending')

  if (matches.some((item) => item.evidenceStatus === 'conflicting_evidence')) {
    contradictions.push('rule_evidence_marked_conflicting')
  }

  return unique(contradictions)
}

function makeUnclearFallback(row, reason, confidence) {
  const rule = RADAR_RULE_BY_CODE['D-UNCLEAR']
  return {
    code: rule.code,
    grade: rule.grade,
    label: rule.label,
    keywords: rule.keywords,
    matched: true,
    confidence,
    reason,
    evidenceStatus: normalizeEvidenceStatus(row?.evidenceStatus || 'insufficient_evidence'),
    sources: [],
    supportingEvidence: [],
    contradictingEvidence: [],
    requiresHumanReview: true,
    doNotAutoPublish: false,
    syntheticFallback: true,
  }
}

function compareRuleSeverity(left, right) {
  const gradeDiff = GRADE_PRIORITY[left.grade] - GRADE_PRIORITY[right.grade]
  if (gradeDiff) return gradeDiff
  return right.confidence - left.confidence || left.code.localeCompare(right.code)
}

function workProtection(row) {
  const reasons = unique([
    ...list(row?.writeProtection?.reasons).map(val),
    ...(row?.writeProtection?.protected ? ['input_marked_write_protected'] : []),
    ...(row?.existingState?.ratingNotice === 'manual_reviewed' ? ['manual_rating_notice'] : []),
    ...(row?.existingState?.humanVerified === true ? ['human_verified'] : []),
    ...(row?.existingState?.locked === true ? ['locked'] : []),
  ])
  return { protected: reasons.length > 0, reasons }
}

export function resolveRadarAssessment(row, options = {}) {
  const minimumMatchConfidence = normalizeConfidence(options.minimumMatchConfidence, 0.5)
  const positiveCoverageThreshold = normalizeConfidence(options.positiveCoverageThreshold, 0.5)
  const evidenceCoverage = normalizeConfidence(row?.evidenceCoverage, 0)
  const overallEvidenceStatus = normalizeEvidenceStatus(row?.evidenceStatus)
  const protection = workProtection(row)

  const normalized = list(row?.ruleAssessments || row?.rules).map(normalizeRuleAssessment)
  const invalidRules = normalized.filter((item) => item.invalid)
  const allRuleAssessments = normalized.filter((item) => !item.invalid)
  let matchedRules = allRuleAssessments.filter(
    (item) => item.matched && item.confidence >= minimumMatchConfidence,
  )

  const warnings = []
  const blockers = []

  if (invalidRules.length) warnings.push(`unknown_rule_codes:${invalidRules.map((item) => item.code || 'missing').join(',')}`)

  if (!matchedRules.length) {
    matchedRules.push(makeUnclearFallback(
      row,
      '没有达到最低置信阈值的规则命中；当前只能按资料不足保底处理。',
      evidenceCoverage < 0.2 ? 0.95 : 0.75,
    ))
    warnings.push('no_effective_rule_match_fell_back_to_d_unclear')
  }

  matchedRules.sort(compareRuleSeverity)
  let decisiveRule = matchedRules[0]

  const positiveOnly = POSITIVE_GRADES.has(decisiveRule.grade)
  const positiveEvidenceIsStrong = STRONG_EVIDENCE.has(overallEvidenceStatus)
    || matchedRules.some((item) => STRONG_EVIDENCE.has(item.evidenceStatus))

  if (positiveOnly && evidenceCoverage < positiveCoverageThreshold && !positiveEvidenceIsStrong) {
    const fallback = makeUnclearFallback(
      row,
      '存在正向关系证据，但资料覆盖不足，尚不能排除更低等级雷点。',
      Math.max(0.7, 1 - evidenceCoverage / 2),
    )
    matchedRules.push(fallback)
    matchedRules.sort(compareRuleSeverity)
    decisiveRule = matchedRules[0]
    warnings.push('positive_grade_blocked_by_insufficient_evidence_coverage')
  }

  const contradictions = findContradictions(matchedRules)
  if (contradictions.length) blockers.push(...contradictions)
  if (protection.protected) blockers.push(...protection.reasons.map((reason) => `write_protected:${reason}`))
  if (decisiveRule.grade === 'X' && RADAR_POLICY_SAFETY.doNotAutoAssignX) blockers.push('x_grade_requires_human_adjudication')

  const highConfidenceWithoutSources = matchedRules.filter(
    (item) => item.confidence >= 0.85
      && item.sources.length === 0
      && item.supportingEvidence.length === 0
      && !item.syntheticFallback,
  )
  if (highConfidenceWithoutSources.length) warnings.push(
    `high_confidence_without_source:${highConfidenceWithoutSources.map((item) => item.code).join(',')}`,
  )

  let overallConfidence = decisiveRule.confidence
  if (contradictions.length) overallConfidence -= 0.15
  if (overallEvidenceStatus === 'conflicting_evidence') overallConfidence -= 0.1
  overallConfidence = normalizeConfidence(overallConfidence)

  const requiresHumanReview = blockers.length > 0
    || matchedRules.some((item) => item.requiresHumanReview)
    || overallConfidence < 0.7
    || evidenceCoverage < 0.3

  const planStatus = blockers.length
    ? 'blocked_or_human_review_required'
    : requiresHumanReview
      ? 'ready_ai_suggestion_review_required'
      : 'ready_ai_suggestion'

  return {
    assessmentVersion: 'ai-radar-assessment-resolver-v0.1',
    policyVersion: RADAR_POLICY_ID,
    generatedAt: new Date().toISOString(),
    workId: val(row?.workId || row?.id),
    siteId: val(row?.siteId),
    title: val(row?.title),
    currentGradeSuggestion: decisiveRule.grade,
    currentGradeLabel: GRADE_LABELS[decisiveRule.grade],
    decisiveRule: {
      code: decisiveRule.code,
      grade: decisiveRule.grade,
      label: decisiveRule.label,
      confidence: decisiveRule.confidence,
      reason: decisiveRule.reason,
      evidenceStatus: decisiveRule.evidenceStatus,
    },
    matchedRules,
    allRuleAssessments,
    overallConfidence,
    confidencePercent: Math.round(overallConfidence * 100),
    evidenceCoverage,
    evidenceCoveragePercent: Math.round(evidenceCoverage * 100),
    evidenceStatus: overallEvidenceStatus,
    pageNotice: AI_REVIEW_NOTICE,
    reviewStatus: 'ai_unreviewed',
    requiresHumanReview,
    planStatus,
    blockers: unique(blockers),
    warnings: unique(warnings),
    contradictions,
    writeProtection: protection,
    safety: {
      payloadWrite: false,
      directPostgresqlWrite: false,
      overwritesHumanVerified: false,
      autoPublishes: false,
      autoAssignsX: false,
      preservesAllMatchedRules: true,
      resolvedByLowestGrade: true,
    },
  }
}
