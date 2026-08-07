export const RADAR_GRADE_ORDER = Object.freeze(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])

export const RADAR_AI_PENDING_DATABASE_STATUS = 'ai_synthesized_pending_review'
export const RADAR_AI_PENDING_WARNING_TEMPLATE_ID = 'ai-synthesized-pending-review'
export const ACCELERATED_RADAR_AI_REVIEW_TAG = Object.freeze({
  key: 'accelerated-radar-ai-review',
  group: '加速排雷',
  value: 'AI 待补充',
  warningTemplateId: RADAR_AI_PENDING_WARNING_TEMPLATE_ID,
})

const gradeIndex = new Map(RADAR_GRADE_ORDER.map((grade, index) => [grade, index]))
const pendingAliases = new Set([
  'ai_synthesized_pending_review',
  'ai-synthesized-pending-review',
  'ai_synthesized_pending',
  'ai-pending-review',
  'accelerated-radar-ai-review',
])
const explicitModes = new Set(['fixed_grade', 'bounded_range', 'labels_only', 'blocked'])

function clean(value) {
  return String(value ?? '').trim()
}

function values(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.map((item) => clean(typeof item === 'string' ? item : item?.value)).filter(Boolean))]
}

function tagValues(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const output = []
  for (const item of input) {
    const key = clean(item?.key)
    const group = clean(item?.group)
    const value = clean(item?.value)
    const warningTemplateId = normalizeRadarWarningTemplateId(item?.warningTemplateId)
    const identity = `${key}|${group}|${value}|${warningTemplateId}`
    if ((!key && !group && !value) || seen.has(identity)) continue
    seen.add(identity)
    output.push({ key, group, value, warningTemplateId })
  }
  return output
}

export function normalizeRadarGrade(value) {
  const grade = clean(value).toUpperCase()
  if (grade === 'AA') return 'S'
  return gradeIndex.has(grade) ? grade : ''
}

export function normalizeRadarDatabaseStatus(value) {
  const normalized = clean(value).toLowerCase()
  return pendingAliases.has(normalized)
    ? RADAR_AI_PENDING_DATABASE_STATUS
    : normalized
}

export function normalizeRadarWarningTemplateId(value) {
  const normalized = clean(value).toLowerCase()
  return pendingAliases.has(normalized)
    ? RADAR_AI_PENDING_WARNING_TEMPLATE_ID
    : normalized
}

export function isLegalRadarRange(bestGrade, likelyGrade, worstGrade) {
  const best = normalizeRadarGrade(bestGrade)
  const likely = normalizeRadarGrade(likelyGrade)
  const worst = normalizeRadarGrade(worstGrade)
  if (!best || !likely || !worst) return false
  return gradeIndex.get(best) <= gradeIndex.get(likely)
    && gradeIndex.get(likely) <= gradeIndex.get(worst)
}

function isBlocked(input) {
  const statuses = [
    input.blocked === true ? 'blocked' : '',
    input.recordShape,
    input.researchStatus,
    input.publicState,
    input.pageNotice,
    input.ratingNotice,
  ].map((value) => clean(value).toLowerCase())

  return statuses.some((value) => [
    'blocked',
    'quarantined',
    'quarantine_excluded',
    'identity_problem',
    'identity_conflict',
  ].includes(value))
}

function insufficientCoverage(input) {
  const statuses = [
    input.evidenceStatus,
    input.researchStatus,
    input.publicState,
    input.coverageState,
  ].map((value) => clean(value).toLowerCase())

  return input.insufficientCoverage === true || statuses.some((value) => [
    'insufficient',
    'insufficient_evidence',
    'needs_more_research',
    'coverage_insufficient',
    'uncovered',
  ].includes(value))
}

function hasAcceleratedTag(tags) {
  return tags.some((tag) =>
    tag.key === ACCELERATED_RADAR_AI_REVIEW_TAG.key
    || (
      tag.group === ACCELERATED_RADAR_AI_REVIEW_TAG.group
      && tag.value === ACCELERATED_RADAR_AI_REVIEW_TAG.value
    ),
  )
}

export function normalizeRadarConclusion(input = {}) {
  const suggestedGrade = normalizeRadarGrade(
    input.suggestedGrade ?? input.coreGrade ?? input.fixedGrade,
  )
  const bestGrade = normalizeRadarGrade(input.bestGrade ?? input.proposedBestGrade)
  const likelyGrade = normalizeRadarGrade(input.likelyGrade ?? input.proposedLikelyGrade)
  const worstGrade = normalizeRadarGrade(input.worstGrade ?? input.proposedWorstGrade)
  const rawRange = [
    clean(input.bestGrade ?? input.proposedBestGrade),
    clean(input.likelyGrade ?? input.proposedLikelyGrade),
    clean(input.worstGrade ?? input.proposedWorstGrade),
  ]
  const rangeFieldCount = rawRange.filter(Boolean).length
  const completeRange = Boolean(bestGrade && likelyGrade && worstGrade)
  const legalRange = completeRange && isLegalRadarRange(bestGrade, likelyGrade, worstGrade)
  const allEqual = legalRange && bestGrade === likelyGrade && likelyGrade === worstGrade
  const classificationLabels = values([
    input.classificationRule,
    ...(input.matchedClasses || []),
  ])
  const riskSignals = values(input.riskSignals)
  const unresolved = values(input.unresolvedDimensions || input.unresolvedQuestions)
  const validationIssues = []
  const requestedMode = clean(input.conclusionMode).toLowerCase()
  const explicitMode = explicitModes.has(requestedMode) ? requestedMode : ''

  let conclusionMode = 'unscanned'
  let fixedGrade = ''

  if (explicitMode === 'blocked' || isBlocked(input)) {
    conclusionMode = 'blocked'
  } else if (explicitMode === 'labels_only') {
    conclusionMode = 'labels_only'
  } else if (explicitMode === 'bounded_range') {
    if (legalRange && !allEqual) {
      conclusionMode = 'bounded_range'
      if (suggestedGrade && suggestedGrade !== likelyGrade) validationIssues.push('core_likely_mismatch')
    } else {
      conclusionMode = 'labels_only'
      validationIssues.push(completeRange ? 'bounded_range_not_distinct' : 'invalid_bounded_range')
    }
  } else if (explicitMode === 'fixed_grade') {
    if (!suggestedGrade) {
      conclusionMode = 'labels_only'
      validationIssues.push('invalid_fixed_grade')
    } else if (completeRange && (!legalRange || !allEqual || suggestedGrade !== likelyGrade)) {
      conclusionMode = 'labels_only'
      validationIssues.push('fixed_grade_conflict')
    } else {
      conclusionMode = 'fixed_grade'
      fixedGrade = suggestedGrade
    }
  } else if (rangeFieldCount > 0 && !completeRange) {
    conclusionMode = 'labels_only'
    validationIssues.push('missing_range_grade')
    if (rawRange.some(Boolean) && [bestGrade, likelyGrade, worstGrade].filter(Boolean).length !== rangeFieldCount) {
      validationIssues.push('invalid_range_grade')
    }
  } else if (completeRange && !legalRange) {
    conclusionMode = 'labels_only'
    validationIssues.push('range_order_invalid')
  } else if (legalRange && !allEqual) {
    conclusionMode = 'bounded_range'
    if (suggestedGrade && suggestedGrade !== likelyGrade) validationIssues.push('core_likely_mismatch')
  } else if (allEqual) {
    if (suggestedGrade && suggestedGrade !== likelyGrade) {
      conclusionMode = 'labels_only'
      validationIssues.push('fixed_grade_conflict')
    } else {
      conclusionMode = 'fixed_grade'
      fixedGrade = likelyGrade
    }
  } else if (suggestedGrade) {
    conclusionMode = 'fixed_grade'
    fixedGrade = suggestedGrade
  } else if (classificationLabels.length || riskSignals.length || unresolved.length) {
    conclusionMode = 'labels_only'
  }

  const requiresHumanReview = input.requiresHumanReview === true
  const recommendedNextQueue = clean(input.recommendedNextQueue).toLowerCase()
  const pendingReasons = []
  if (conclusionMode === 'bounded_range') pendingReasons.push('bounded_range')
  if (requiresHumanReview) pendingReasons.push('requires_human_review')
  if (unresolved.length) pendingReasons.push('unresolved_dimensions')
  if (recommendedNextQueue === 'more_research') pendingReasons.push('more_research')
  if (insufficientCoverage(input)) pendingReasons.push('insufficient_coverage')

  const publicTags = tagValues(input.publicTags || input.publicTagHints)
  const needsPendingTag = pendingReasons.length > 0
  if (needsPendingTag && !hasAcceleratedTag(publicTags)) {
    publicTags.push({ ...ACCELERATED_RADAR_AI_REVIEW_TAG })
  }

  const inputDatabaseStatus = normalizeRadarDatabaseStatus(input.databaseStatus ?? input.ratingNotice)
  const inputWarningTemplateId = normalizeRadarWarningTemplateId(
    input.warningTemplateId
      ?? values(input.publicWarningTemplateIds)[0]
      ?? input.pageNotice,
  )

  const databaseStatus = needsPendingTag
    ? RADAR_AI_PENDING_DATABASE_STATUS
    : inputDatabaseStatus
  const warningTemplateId = needsPendingTag
    ? RADAR_AI_PENDING_WARNING_TEMPLATE_ID
    : inputWarningTemplateId

  const title = conclusionMode === 'fixed_grade'
    ? 'AI 暂定等级'
    : conclusionMode === 'bounded_range'
      ? 'AI 暂定评级范围'
      : conclusionMode === 'blocked'
        ? 'AI 结论暂不可展示'
        : conclusionMode === 'labels_only'
          ? 'AI 暂定结论'
          : '等待 AI Radar 管线'

  const display = conclusionMode === 'fixed_grade'
    ? fixedGrade
    : conclusionMode === 'bounded_range'
      ? `${bestGrade} ～ ${worstGrade}`
      : conclusionMode === 'labels_only'
        ? '仅有规则 / 标签线索'
        : conclusionMode === 'blocked'
          ? '已阻塞'
          : '尚未扫描'

  return {
    conclusionMode,
    fixedGrade,
    suggestedGrade: fixedGrade,
    bestGrade,
    likelyGrade,
    worstGrade,
    title,
    display,
    likelyLabel: conclusionMode === 'bounded_range' ? `最可能 ${likelyGrade}` : '',
    classificationLabels,
    riskSignals,
    unresolvedDimensions: unresolved,
    validationIssues,
    requiresHumanReview,
    pendingReasons: [...new Set(pendingReasons)],
    needsPendingTag,
    databaseStatus,
    warningTemplateId,
    publicTags,
  }
}
