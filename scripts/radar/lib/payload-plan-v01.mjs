import { createHash } from 'node:crypto'

export const ALLOWED_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])
export const ALLOWED_REVIEW_REASONS = new Set([
  'radar_seed_attached',
  'radar_v06_package_import',
  'radar_publication_guard',
  'radar_guard_low_evidence_coverage',
  'radar_guard_weak_or_conflicting_source',
  'radar_guard_unclear_provisional_grade',
  'source_conflict',
  'multi_source_or_variant',
  'wikidata_candidate_review',
  'wikidata_quarantine',
  'manual_review',
  'other',
])
export const ALLOWED_PATCH_FIELDS = new Set([
  'rank',
  'ratingNotice',
  'reviewStatus',
  'reviewReasons',
  'evidenceStrength',
  'radarAssessment',
])

export function val(value) {
  return String(value ?? '').trim()
}

export function list(value) {
  return Array.isArray(value) ? value : []
}

export function unique(values) {
  return [...new Set(list(values).map(val).filter(Boolean))]
}

export function normalizeTitle(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[\-‐‑‒–—―~〜～・:：;；,，.。!！?？'"“”‘’「」『』【】\[\]（）()]/gu, '')
}

function aliasValues(value) {
  return list(value)
    .map((item) => (typeof item === 'string' ? item : item?.value || item?.title))
    .map(val)
    .filter(Boolean)
}

function localizedTitleValues(value) {
  return list(value)
    .map((item) => (typeof item === 'string' ? item : item?.title))
    .map(val)
    .filter(Boolean)
}

export function titleSetOfWork(work) {
  return new Set([
    work?.title,
    work?.originalTitle,
    ...aliasValues(work?.aliases),
    ...localizedTitleValues(work?.localizedTitles),
  ].map(normalizeTitle).filter(Boolean))
}

export function titleSetOfAssessment(row) {
  return new Set([
    row?.title,
    row?.series?.seriesKey,
    ...list(row?.titles),
  ].map((item) => typeof item === 'string' ? item : item?.value || item?.title)
    .map(normalizeTitle)
    .filter(Boolean))
}

export function titleOverlap(work, assessment) {
  const current = titleSetOfWork(work)
  const incoming = titleSetOfAssessment(assessment)
  return [...incoming].some((item) => current.has(item))
}

function mapUnique(values, keyFn) {
  const map = new Map()
  for (const value of values) {
    const key = keyFn(value)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(value)
  }
  return map
}

export function buildWorkIndexes(works) {
  return {
    byId: mapUnique(works, (work) => val(work?.id)),
    bySiteId: mapUnique(works, (work) => val(work?.siteId)),
  }
}

function one(map, key) {
  const rows = map.get(key) || []
  if (rows.length === 1) return { value: rows[0], ambiguous: false }
  if (rows.length > 1) return { value: null, ambiguous: true }
  return { value: null, ambiguous: false }
}

export function resolveTargetWork(assessment, indexes) {
  const blockers = []
  const warnings = []
  const workId = val(assessment?.workId)
  const siteId = val(assessment?.siteId)
  const byId = workId ? one(indexes.byId, workId) : { value: null, ambiguous: false }
  const bySiteId = siteId ? one(indexes.bySiteId, siteId) : { value: null, ambiguous: false }

  if (byId.ambiguous) blockers.push('ambiguous_payload_id')
  if (bySiteId.ambiguous) blockers.push('ambiguous_site_id')
  if (blockers.length) return { work: null, blockers, warnings, matchedBy: [] }

  if (byId.value && bySiteId.value && val(byId.value.id) !== val(bySiteId.value.id)) {
    blockers.push('payload_id_site_id_identity_mismatch')
    return { work: null, blockers, warnings, matchedBy: ['id', 'siteId'] }
  }

  const work = byId.value || bySiteId.value || null
  const matchedBy = [byId.value ? 'id' : '', bySiteId.value ? 'siteId' : ''].filter(Boolean)
  if (!work) {
    blockers.push('stable_identifier_not_found')
    return { work: null, blockers, warnings, matchedBy }
  }

  if (!titleOverlap(work, assessment)) {
    if (matchedBy.length >= 2) warnings.push('title_mismatch_but_stable_ids_match')
    else blockers.push('title_mismatch_on_single_identifier')
  }

  return { work, blockers, warnings, matchedBy }
}

export function humanProtectionReasons(work) {
  const reasons = []
  if (val(work?.ratingNotice) === 'manual_reviewed') reasons.push('existing_manual_review_notice')
  if (['reviewed', 'disputed', 'deprecated'].includes(val(work?.reviewStatus))) reasons.push(`existing_review_status:${val(work.reviewStatus)}`)
  if (work?.humanVerified === true) reasons.push('existing_human_verified')
  if (work?.locked === true || work?.isLocked === true) reasons.push('existing_locked_record')
  return unique(reasons)
}

export function evidenceStrengthFor(assessment) {
  const status = val(assessment?.evidenceStatus)
  const coverage = Number(assessment?.evidenceCoveragePercent)
  if (['official_confirmed', 'primary_material_confirmed'].includes(status) && coverage >= 75) return 'strong'
  if (['multiple_secondary_supported', 'community_consensus'].includes(status) && coverage >= 70) return 'strong'
  if (!['insufficient_evidence', 'conflicting_evidence', 'inferred_from_metadata'].includes(status) && coverage >= 50) return 'medium'
  return 'weak'
}

function normalizeRule(rule) {
  return {
    code: val(rule?.code),
    grade: val(rule?.grade),
    confidencePercent: Number.isFinite(Number(rule?.confidencePercent))
      ? Math.min(100, Math.max(0, Math.round(Number(rule.confidencePercent))))
      : Math.min(100, Math.max(0, Math.round(Number(rule?.confidence || 0) * 100))),
    reason: val(rule?.reason),
  }
}

export function matchedRulesFor(assessment) {
  return list(assessment?.matchedRules)
    .map(normalizeRule)
    .filter((rule) => rule.code)
}

function arrayValues(values) {
  return unique(values).map((value) => ({ value }))
}

export function desiredPayloadFor(assessment, work, assessedAt) {
  const contradictions = unique(assessment?.contradictions)
  const reviewReasons = unique([
    ...list(work?.reviewReasons),
    'radar_seed_attached',
    ...(val(assessment?.evidenceStatus) === 'conflicting_evidence' || contradictions.length ? ['source_conflict'] : []),
  ])
  const decisive = assessment?.decisiveRule || {}
  return {
    rank: val(assessment?.currentGradeSuggestion),
    ratingNotice: 'ai_synthesized_pending_review',
    reviewStatus: 'pending',
    reviewReasons,
    evidenceStrength: evidenceStrengthFor(assessment),
    radarAssessment: {
      confidencePercent: Math.min(100, Math.max(0, Math.round(Number(assessment?.confidencePercent || 0)))),
      evidenceCoveragePercent: Math.min(100, Math.max(0, Math.round(Number(assessment?.evidenceCoveragePercent || 0)))),
      evidenceStatus: val(assessment?.evidenceStatus) || 'unknown',
      sourceSummary: val(assessment?.sourceSummary),
      policyVersion: val(assessment?.policyVersion),
      assessedAt: val(assessment?.assessedAt || assessedAt) || undefined,
      assessmentBatch: val(assessment?.assessmentBatch),
      suggestedGrade: val(assessment?.currentGradeSuggestion),
      decisiveRuleCode: val(decisive?.code),
      decisiveRuleReason: val(decisive?.reason),
      matchedRules: matchedRulesFor(assessment),
      sourceCount: Number.isFinite(Number(assessment?.sourceCount)) ? Number(assessment.sourceCount) : 0,
      contradictions: arrayValues(contradictions),
      requiresHumanReview: assessment?.requiresHumanReview !== false,
    },
  }
}

function normalizeArray(value) {
  return list(value).map((item) => canonical(item))
}

export function canonical(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return normalizeArray(value)
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const item = canonical(value[key])
    return item === undefined ? [] : [[key, item]]
  }))
}

function canonicalInstant(value) {
  if (typeof value !== 'string') return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
}

export function payloadComparable(value, parentKey = '') {
  if (parentKey === 'assessedAt') return canonicalInstant(value)
  if (Array.isArray(value)) {
    return value.map((item) => payloadComparable(item, parentKey))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (key === 'id') return []
        return [[key, payloadComparable(item, key)]]
      }),
    )
  }
  return value
}

export function equal(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

export function currentStateOf(work) {
  return canonical({
    rank: work?.rank,
    ratingNotice: work?.ratingNotice,
    reviewStatus: work?.reviewStatus,
    reviewReasons: unique(work?.reviewReasons),
    evidenceStrength: work?.evidenceStrength,
    radarAssessment: work?.radarAssessment,
  })
}

export function changedFields(before, desired) {
  const changes = []
  for (const key of ALLOWED_PATCH_FIELDS) {
    if (!equal(
      payloadComparable(before?.[key], key),
      payloadComparable(desired?.[key], key),
    )) {
      changes.push(key)
    }
  }
  return changes
}

export function snapshotHash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export const NON_FATAL_ASSESSMENT_FLAGS = new Set(['external_research_insufficient'])

export function assessmentBlockers(assessment) {
  const blockers = [
    ...list(assessment?.blockers).map(val).filter((item) => item && !NON_FATAL_ASSESSMENT_FLAGS.has(item)),
    ...list(assessment?.contradictions).map((item) => `contradiction:${val(item)}`),
    ...list(assessment?.writeProtection?.reasons).map((item) => `assessment_write_protection:${val(item)}`),
  ].filter(Boolean)
  if (assessment?.writeProtection?.protected === true) blockers.push('assessment_write_protected')
  const grade = val(assessment?.currentGradeSuggestion)
  if (grade === 'X') blockers.push('x_grade_requires_human_adjudication')
  else if (!ALLOWED_GRADES.has(grade)) blockers.push('invalid_grade_suggestion')
  if (!val(assessment?.policyVersion)) blockers.push('missing_policy_version')
  if (!val(assessment?.decisiveRule?.code)) blockers.push('missing_decisive_rule')
  return unique(blockers)
}

export function buildPlanRow(assessment, indexes, { assessedAt = '' } = {}) {
  const target = resolveTargetWork(assessment, indexes)
  const blockers = unique([...assessmentBlockers(assessment), ...target.blockers])
  const warnings = unique([
    ...target.warnings,
    ...list(assessment?.blockers).map(val).filter((item) => NON_FATAL_ASSESSMENT_FLAGS.has(item)).map((item) => `assessment_warning:${item}`),
  ])
  const work = target.work

  if (work) blockers.push(...humanProtectionReasons(work))
  const uniqueBlockers = unique(blockers)
  const before = work ? currentStateOf(work) : undefined
  const patch = work ? canonical(desiredPayloadFor(assessment, work, assessedAt)) : undefined
  const changes = work && patch ? changedFields(before, patch) : []
  const planStatus = uniqueBlockers.length
    ? 'blocked'
    : changes.length
      ? 'ready_for_payload_dry_run'
      : 'already_current'

  return canonical({
    version: 'ai-radar-payload-patch-plan-v0.1',
    action: 'update_existing_work_radar_assessment',
    workId: val(assessment?.workId),
    siteId: val(assessment?.siteId),
    title: val(assessment?.title),
    assessmentBatch: val(assessment?.assessmentBatch),
    policyVersion: val(assessment?.policyVersion),
    gradeSuggestion: val(assessment?.currentGradeSuggestion),
    decisiveRuleCode: val(assessment?.decisiveRule?.code),
    matchedBy: target.matchedBy,
    target: work ? { id: val(work.id), siteId: val(work.siteId), title: val(work.title) } : undefined,
    expectedBefore: before,
    expectedBeforeHash: before ? snapshotHash(before) : undefined,
    patch,
    changedFields: changes,
    planStatus,
    blockers: uniqueBlockers,
    warnings,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      titleOnlyMatchingAllowed: false,
      overwritesHumanReviewed: false,
    },
  })
}

export function validatePlanForDryRun(plan) {
  const blockers = []
  if (val(plan?.action) !== 'update_existing_work_radar_assessment') blockers.push('unexpected_action')
  if (val(plan?.planStatus) !== 'ready_for_payload_dry_run') blockers.push('plan_not_ready_for_dry_run')
  if (!val(plan?.target?.id) && !val(plan?.target?.siteId)) blockers.push('missing_stable_target_identifier')
  if (!val(plan?.expectedBeforeHash)) blockers.push('missing_expected_before_hash')
  const patchKeys = Object.keys(plan?.patch || {})
  for (const key of patchKeys) if (!ALLOWED_PATCH_FIELDS.has(key)) blockers.push(`unexpected_patch_field:${key}`)
  if (val(plan?.patch?.ratingNotice) !== 'ai_synthesized_pending_review') blockers.push('missing_ai_pending_review_notice')
  if (val(plan?.patch?.reviewStatus) !== 'pending') blockers.push('unexpected_review_status')
  if (val(plan?.patch?.rank) === 'X') blockers.push('x_grade_requires_human_adjudication')
  if (!ALLOWED_GRADES.has(val(plan?.patch?.rank))) blockers.push('invalid_patch_rank')
  return unique(blockers)
}

export function dryRunPlanRow(plan, indexes) {
  const blockers = validatePlanForDryRun(plan)
  const targetAssessment = {
    workId: val(plan?.target?.id),
    siteId: val(plan?.target?.siteId),
    title: val(plan?.target?.title || plan?.title),
  }
  const resolved = resolveTargetWork(targetAssessment, indexes)
  blockers.push(...resolved.blockers)
  const work = resolved.work
  if (work) blockers.push(...humanProtectionReasons(work))
  const current = work ? currentStateOf(work) : undefined
  const remainingChanges = work ? changedFields(current, plan?.patch || {}) : []

  if (work && remainingChanges.length && snapshotHash(current) !== val(plan?.expectedBeforeHash)) {
    blockers.push('stale_payload_snapshot_since_plan')
  }

  const uniqueBlockers = unique(blockers)
  const status = uniqueBlockers.length
    ? 'blocked'
    : remainingChanges.length
      ? 'would_update'
      : 'already_current'

  return canonical({
    workId: val(plan?.workId),
    siteId: val(plan?.siteId),
    title: val(plan?.title),
    target: work ? { id: val(work.id), siteId: val(work.siteId), title: val(work.title) } : plan?.target,
    status,
    remainingChangedFields: remainingChanges,
    blockers: uniqueBlockers,
    warnings: unique([...(plan?.warnings || []), ...resolved.warnings]),
    safety: {
      payloadRead: true,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
    },
  })
}
