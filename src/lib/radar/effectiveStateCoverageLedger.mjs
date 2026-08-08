import { createHash } from 'node:crypto'
import { normalizeRadarConclusion, normalizeRadarGrade } from './conclusionNormalizer.mjs'

export const EFFECTIVE_BUCKET_ORDER = Object.freeze([
  'Human', 'Published', 'Candidate', 'Research', 'Legacy', 'TrulyUnassessed',
])
const MODES = new Set(['fixed_grade', 'bounded_range', 'labels_only', 'blocked'])
const HUMAN_STATUSES = new Set(['reviewed', 'disputed'])
const RESEARCH_STATUS_RANK = Object.freeze({
  resolved: 40,
  partial: 30,
  insufficient: 20,
  identity_problem: 0,
})
const RESEARCH_SELECTION_REASON = 'quality/status-first: review>researchStatus>assessment-readiness>confidence>source-quality>milestone>timestamp>stable-key'
const val = (value) => String(value ?? '').trim()
const low = (value) => val(value).toLowerCase()
const rel = (value) => value && typeof value === 'object' ? val(value.id ?? value.value) : val(value)
const error = (code, layer, detail, extra = {}) => ({ code, layer, severity: 'error', detail, ...extra })
const warning = (code, layer, detail, extra = {}) => ({ code, layer, severity: 'warning', detail, ...extra })
const hasError = (items) => items.some((item) => item.severity === 'error')

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}
export const stableStringify = (value) => JSON.stringify(stable(value))
export const sha256Json = (value) => createHash('sha256').update(stableStringify(value)).digest('hex')

const workId = (work) => val(work?.id ?? work?.workId ?? work?._id)
const siteId = (work) => val(work?.siteId ?? work?.workSiteId)
const exactKey = (work) => workId(work) && siteId(work) ? `${workId(work)}|${siteId(work)}` : ''
function rowKey(row) {
  const key = val(row?.identityKey)
  if (key.includes('|')) return key
  const id = val(row?.workIdSnapshot ?? row?.workId)
  const site = val(row?.workSiteId ?? row?.siteId)
  return id && site ? `${id}|${site}` : ''
}
function claimedWork(row) {
  const id = rel(row?.work) || val(row?.workIdSnapshot ?? row?.workId)
  if (id) return id
  return val(row?.identityKey).split('|')[0] || ''
}
function statusIsPresence(row, inactive) { return low(row?.recordStatus) !== inactive }
function newest(rows) {
  const key = (row) => [
    val(row?.importedAt ?? row?.publishedAt ?? row?.updatedAt ?? row?.createdAt),
    val(row?.researchKey ?? row?.publicationKey ?? row?.identityKey ?? row?.id),
    sha256Json(row),
  ].join('|')
  return [...rows].sort((a, b) => key(b).localeCompare(key(a)))[0] || null
}

function compareTuple(left, right) {
  const size = Math.max(left.length, right.length)
  for (let index = 0; index < size; index += 1) {
    const a = left[index] ?? '', b = right[index] ?? ''
    if (typeof a === 'number' && typeof b === 'number') {
      if (a !== b) return a - b
    } else {
      const order = String(a).localeCompare(String(b))
      if (order) return order
    }
  }
  return 0
}

function researchReviewRank(row) {
  const status = low(row?.reviewStatus ?? row?.qaStatus)
  if (row?.humanReviewed === true || row?.reviewed === true || row?.qaAccepted === true || ['reviewed', 'accepted', 'approved'].includes(status)) return 2
  if (row?.humanReviewed === false || row?.qaAccepted === false || ['rejected', 'blocked'].includes(status)) return 0
  return 1
}

function researchSourceVector(row) {
  const counts = { official: 0, primary: 0, secondary: 0, community: 0, other: 0 }
  for (const source of Array.isArray(row?.sources) ? row.sources : []) {
    const type = low(source?.sourceType)
    if (Object.hasOwn(counts, type)) counts[type] += 1
    else if (type) counts.other += 1
  }
  return [counts.official, counts.primary, counts.secondary, counts.community, counts.other]
}

function researchQualityPrefix(row) {
  const confidence = Number(row?.confidencePercent)
  const confidenceRank = Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? confidence : -1
  const assessmentReady = low(row?.recommendedNextQueue) === 'full_assessment' || low(row?.recommendedNextAction) === 'promote_for_reassessment' ? 1 : 0
  const milestone = Number(row?.milestone)
  const [official, primary, secondary, community, other] = researchSourceVector(row)
  return [
    researchReviewRank(row),
    RESEARCH_STATUS_RANK[low(row?.researchStatus)] ?? -1,
    assessmentReady,
    confidenceRank,
    official,
    primary,
    secondary,
    community,
    other,
    Number.isFinite(milestone) ? milestone : 0,
  ]
}

function researchSelectionKey(row) {
  return [
    ...researchQualityPrefix(row),
    val(row?.importedAt ?? row?.updatedAt ?? row?.createdAt),
    val(row?.researchKey ?? row?.programId ?? row?.batchId ?? row?.id),
    sha256Json(row),
  ]
}

function validateIdentity(row, work, layer) {
  const out = []
  const id = workId(work), site = siteId(work), expected = exactKey(work)
  const relation = rel(row?.work), snapId = val(row?.workIdSnapshot ?? row?.workId)
  const snapSite = val(row?.workSiteId ?? row?.siteId), identity = val(row?.identityKey)
  const status = low(row?.recordStatus)
  const allowed = layer === 'Research' ? new Set(['current', 'archived']) : new Set(['current', 'withdrawn'])
  if (!status) out.push(error('record_status_missing', layer, 'recordStatus missing; row still occupies authority and fails closed.'))
  else if (!allowed.has(status)) out.push(error('record_status_invalid', layer, `Unsupported recordStatus ${status}.`))
  if (relation && relation !== id) out.push(error('work_relationship_mismatch', layer, `${relation} != ${id}`))
  if (!snapId) out.push(error('work_id_snapshot_missing', layer, 'workIdSnapshot missing.'))
  else if (snapId !== id) out.push(error('work_id_snapshot_mismatch', layer, `${snapId} != ${id}`))
  if (!site) out.push(error('canonical_site_id_missing', 'Canonical', 'Works.siteId missing.'))
  else if (!snapSite) out.push(error('work_site_id_snapshot_missing', layer, 'workSiteId/siteId snapshot missing.'))
  else if (snapSite !== site) out.push(error('work_site_id_snapshot_mismatch', layer, `${snapSite} != ${site}`))
  if (identity && expected && identity !== expected) out.push(error('identity_key_mismatch', layer, `${identity} != ${expected}`))
  if (val(row?.publicationKey) && val(row.publicationKey) !== `work:${id}`) {
    out.push(error('publication_key_mismatch', layer, `${row.publicationKey} != work:${id}`))
  }
  return out
}

function researchSemanticViolations(row) {
  const out = [], status = low(row?.researchStatus)
  if (!Object.hasOwn(RESEARCH_STATUS_RANK, status)) out.push(error('research_status_invalid', 'Research', `Unsupported researchStatus ${status || '(missing)'}.`))
  else if (status === 'identity_problem') out.push(error('research_identity_problem', 'Research', 'Research observation reports identity_problem.'))
  if (val(row?.confidencePercent)) {
    const confidence = Number(row.confidencePercent)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) out.push(error('research_confidence_invalid', 'Research', `confidencePercent=${row.confidencePercent}`))
  }
  const range = [row?.proposedBestGrade, row?.proposedLikelyGrade, row?.proposedWorstGrade].map(val)
  if (range.some(Boolean)) {
    const normalized = normalizeRadarConclusion({ proposedBestGrade: range[0], proposedLikelyGrade: range[1], proposedWorstGrade: range[2] })
    for (const issue of normalized.validationIssues || []) out.push(error(`research_${issue}`, 'Research', issue))
  }
  return out
}

function selectResearchObservation(work, rows) {
  const evaluated = rows.map((row) => ({
    row,
    key: researchSelectionKey(row),
    violations: [...validateIdentity(row, work, 'Research'), ...researchSemanticViolations(row)],
  }))
  const valid = evaluated.filter((item) => !hasError(item.violations))
  const invalid = evaluated.filter((item) => hasError(item.violations))
  const highest = (items) => [...items].sort((a, b) => compareTuple(b.key, a.key))[0] || null
  const bestValid = highest(valid), bestInvalid = highest(invalid)
  if (!bestValid) {
    return { selected: bestInvalid, blocked: Boolean(bestInvalid), reason: bestInvalid ? 'no_valid_research_observation_highest_priority_malformed' : 'no_research_observation' }
  }
  if (bestInvalid && compareTuple(bestInvalid.key, bestValid.key) >= 0) {
    return { selected: bestInvalid, blocked: true, reason: 'malformed_research_observation_at_or_above_best_valid_priority' }
  }
  return { selected: bestValid, blocked: false, reason: RESEARCH_SELECTION_REASON }
}

function conclusionInput(row, layer) {
  return {
    ...row,
    suggestedGrade: layer === 'Candidate'
      ? row?.compatibilityGrade ?? row?.radarAssessment?.suggestedGrade
      : row?.coreGrade ?? row?.suggestedGrade ?? row?.radarAssessment?.suggestedGrade,
    bestGrade: row?.bestGrade ?? row?.radarAssessment?.bestGrade,
    likelyGrade: row?.likelyGrade ?? row?.radarAssessment?.likelyGrade,
    worstGrade: row?.worstGrade ?? row?.radarAssessment?.worstGrade,
    conclusionMode: row?.conclusionMode ?? row?.radarAssessment?.conclusionMode,
  }
}
function persistedConclusion(row, layer, expectedPolicyVersion) {
  const out = [], rawMode = low(row?.conclusionMode ?? row?.radarAssessment?.conclusionMode)
  const grades = [
    layer === 'Candidate' ? row?.compatibilityGrade : row?.coreGrade,
    row?.bestGrade, row?.likelyGrade, row?.worstGrade,
  ].map(val)
  const normalized = normalizeRadarConclusion(conclusionInput(row, layer))
  if (!rawMode && layer === 'Candidate') out.push(error('candidate_conclusion_mode_missing', layer, 'Current Candidate must persist a canonical conclusion mode.'))
  if (rawMode && !MODES.has(rawMode)) out.push(error('invalid_conclusion_mode', layer, `Unsupported conclusionMode ${rawMode}.`))
  if (['labels_only', 'blocked'].includes(rawMode) && grades.some(Boolean)) out.push(error('nonrating_mode_ghost_grades', layer, `${rawMode} carries grade fields.`))
  if (grades.some((grade) => grade.toUpperCase() === 'X')) out.push(error('machine_x_not_allowed', layer, 'Machine Candidate/Published state carries X.'))
  if (rawMode && normalized.conclusionMode !== rawMode) {
    out.push(error('conclusion_normalization_mismatch', layer, `${rawMode} normalizes to ${normalized.conclusionMode}.`, { validationIssues: normalized.validationIssues }))
  }
  for (const issue of normalized.validationIssues || []) out.push(error(`conclusion_${issue}`, layer, issue))
  const policy = val(row?.sourcePolicyVersion ?? row?.policyVersion ?? row?.radarAssessment?.policyVersion)
  if (rawMode && !policy) out.push(warning('policy_version_missing', layer, 'Explicit conclusion has no policy binding.'))
  else if (rawMode && expectedPolicyVersion && policy && policy !== expectedPolicyVersion) {
    out.push(warning('policy_version_differs_from_active', layer, `${policy} != ${expectedPolicyVersion}`, { policyVersion: policy }))
  }
  return {
    violations: out,
    conclusion: {
      conclusionMode: normalized.conclusionMode,
      fixedGrade: normalized.fixedGrade || null,
      bestGrade: normalized.bestGrade || null,
      likelyGrade: normalized.likelyGrade || null,
      worstGrade: normalized.worstGrade || null,
      validationIssues: [...(normalized.validationIssues || [])],
    },
  }
}

function humanState(work) {
  const human = work?.humanAssessment && typeof work.humanAssessment === 'object' ? work.humanAssessment : {}
  const status = low(human.status), legacyStatus = low(work?.reviewStatus), manual = low(work?.ratingNotice) === 'manual_reviewed'
  const present = HUMAN_STATUSES.has(status) || HUMAN_STATUSES.has(legacyStatus) || manual || (val(human.grade) && status !== 'pending')
  if (!present) return { present: false, violations: [], conclusion: null }
  const out = []
  if (status === 'pending' && val(human.grade)) out.push(error('human_pending_with_grade', 'Human', 'Pending human state carries a grade.'))
  if (status === 'disputed' || legacyStatus === 'disputed') out.push(warning('human_state_disputed', 'Human', 'Human authority is disputed.'))
  const direct = normalizeRadarGrade(human.grade)
  const grade = direct || (HUMAN_STATUSES.has(legacyStatus) || manual ? normalizeRadarGrade(work?.rank) : '')
  if (!grade) out.push(error('human_grade_missing_or_invalid', 'Human', 'Human presence has no valid grade.'))
  return { present: true, violations: out, conclusion: { conclusionMode: grade ? 'fixed_grade' : 'labels_only', fixedGrade: grade || null, source: direct ? 'humanAssessment' : 'legacy-reviewed-compatibility' } }
}

function publishedState(work, records, ratings, expectedPolicyVersion) {
  const rs = records.filter((row) => statusIsPresence(row, 'withdrawn'))
  const gs = ratings.filter((row) => statusIsPresence(row, 'withdrawn'))
  if (!rs.length && !gs.length) return { present: false, violations: [], conclusion: null }
  const out = []
  if (rs.length !== 1 || gs.length !== 1) out.push(error('published_pair_cardinality_invalid', 'Published', `Expected 1+1 current pair; got ${rs.length}+${gs.length}.`))
  for (const row of [...rs, ...gs]) out.push(...validateIdentity(row, work, 'Published'))
  const record = newest(rs), rating = newest(gs)
  let conclusion = null
  if (rating) {
    const checked = persistedConclusion(rating, 'Published', expectedPolicyVersion)
    out.push(...checked.violations); conclusion = checked.conclusion
    if (rating?.humanReview?.blocksPublication === true || rating?.blocksPublication === true) out.push(error('published_row_blocks_publication', 'Published', 'Current rating blocks publication.'))
  }
  if (record && rating) {
    for (const field of ['identityKey', 'sourceReleaseId', 'sourceCommitSha', 'researchSnapshotId']) {
      const a = val(record[field]), b = val(rating[field])
      if (a && b && a !== b) out.push(error('published_pair_binding_mismatch', 'Published', `${field}: ${a} != ${b}`, { field }))
    }
  }
  return { present: true, violations: out, conclusion }
}

function candidateState(work, rows, expectedPolicyVersion) {
  const current = rows.filter((row) => statusIsPresence(row, 'withdrawn'))
  if (!current.length) return { present: false, violations: [], conclusion: null }
  const out = []
  if (current.length !== 1) out.push(error('duplicate_current_candidate_claim', 'Candidate', `${current.length} current Candidate rows.`))
  for (const row of current) out.push(...validateIdentity(row, work, 'Candidate'))
  const checked = persistedConclusion(newest(current), 'Candidate', expectedPolicyVersion)
  out.push(...checked.violations)
  return { present: true, violations: out, conclusion: checked.conclusion }
}

function researchState(work, history) {
  if (!history.length) return { present: false, violations: [], historicalObservationCount: 0, effectiveObservation: null }
  const current = history.filter((row) => statusIsPresence(row, 'archived')), pool = current.length ? current : history
  const selection = selectResearchObservation(work, pool), effective = selection.selected?.row || null, out = []
  if (!current.length) out.push(error('research_no_current_observation', 'Research', 'History exists with no current Research observation.'))
  if (current.length > 1) out.push(error('duplicate_current_research_claim', 'Research', `${current.length} current Research rows.`))
  for (const observation of history) out.push(...validateIdentity(observation, work, 'Research'))
  if (selection.blocked) out.push(error('research_effective_selection_blocked_by_malformed_observation', 'Research', selection.reason))
  if (effective) out.push(...researchSemanticViolations(effective))
  return {
    present: true, violations: out, historicalObservationCount: history.length,
    effectiveObservation: effective ? {
      id: val(effective.id) || null, researchKey: val(effective.researchKey) || null,
      programId: val(effective.programId) || null, batchId: val(effective.batchId) || null,
      recordStatus: val(effective.recordStatus) || null, researchStatus: val(effective.researchStatus) || null,
      workIdSnapshot: val(effective.workIdSnapshot) || null, workSiteId: val(effective.workSiteId) || null,
      proposedBestGrade: val(effective.proposedBestGrade) || null, proposedLikelyGrade: val(effective.proposedLikelyGrade) || null,
      proposedWorstGrade: val(effective.proposedWorstGrade) || null, importedAt: val(effective.importedAt) || null,
      updatedAt: val(effective.updatedAt) || null, sourceResponseSha256: val(effective.sourceResponseSha256) || null,
      selectionReason: selection.reason,
      selectionBlocked: selection.blocked,
    } : null,
  }
}

function legacyState(work) {
  const radar = work?.radarAssessment && typeof work.radarAssessment === 'object' ? work.radarAssessment : null
  const signal = radar && [radar.conclusionMode, radar.suggestedGrade, radar.bestGrade, radar.likelyGrade, radar.worstGrade, radar.policyVersion, radar.assessedAt, radar.assessmentBatch, radar.sourceSummary].some((x) => val(x))
  const rank = val(work?.rank), rankSignal = !['', 'unknown', 'trash'].includes(low(rank))
  if (!signal && !rankSignal) return { present: false, violations: [], conclusion: null }
  const out = []
  let conclusion
  if (signal) {
    const normalized = normalizeRadarConclusion(radar)
    for (const issue of normalized.validationIssues || []) out.push(error(`legacy_${issue}`, 'Legacy', issue))
    conclusion = { conclusionMode: normalized.conclusionMode, fixedGrade: normalized.fixedGrade || null, bestGrade: normalized.bestGrade || null, likelyGrade: normalized.likelyGrade || null, worstGrade: normalized.worstGrade || null, source: 'Works.radarAssessment' }
  } else {
    const grade = normalizeRadarGrade(rank)
    if (!grade) out.push(error('legacy_grade_unrecognized', 'Legacy', `Unrecognized Works.rank ${rank}.`))
    conclusion = { conclusionMode: 'legacy', fixedGrade: grade || null, source: 'Works.rank' }
  }
  if ([rank, radar?.suggestedGrade, radar?.bestGrade, radar?.likelyGrade, radar?.worstGrade].some((x) => val(x).toUpperCase() === 'X')) out.push(warning('legacy_machine_x_historical', 'Legacy', 'Historical machine X preserved but must not be promoted.'))
  return { present: true, violations: out, conclusion }
}

function indexRows(rows, knownIds, layer, globals, allowHistoricalDuplicates = false) {
  const map = new Map(), seen = new Set()
  for (const row of rows) {
    const id = claimedWork(row), identity = rowKey(row)
    if (!allowHistoricalDuplicates && identity && seen.has(identity)) globals.push(error('duplicate_physical_identity_claim', layer, `Duplicate ${identity}.`, { identityKey: identity }))
    if (identity) seen.add(identity)
    if (!id || !knownIds.has(id)) { globals.push(error('orphan_work_reference', layer, `Unknown Work ${id || '(missing)'}.`, { claimedWorkId: id || null, identityKey: identity || null })); continue }
    if (!map.has(id)) map.set(id, [])
    map.get(id).push(row)
  }
  return map
}

function counts(items, key) {
  const out = {}
  for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

export function auditEffectiveStateCoverage(snapshot, options = {}) {
  const expectedPolicyVersion = val(options.expectedPolicyVersion || 'radar-rating-policy-v0.5')
  const works = Array.isArray(snapshot?.works) ? snapshot.works : []
  const records = Array.isArray(snapshot?.radarPublicRecords) ? snapshot.radarPublicRecords : []
  const ratings = Array.isArray(snapshot?.radarPublicRatings) ? snapshot.radarPublicRatings : []
  const candidates = Array.isArray(snapshot?.radarPublicConclusions) ? snapshot.radarPublicConclusions : []
  const research = Array.isArray(snapshot?.radarResearchRecords) ? snapshot.radarResearchRecords : []
  const globals = [], ids = works.map(workId), knownIds = new Set(ids.filter(Boolean))
  const idCounts = new Map(), siteCounts = new Map()
  for (const id of ids) if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1)
  for (const site of works.map(siteId).filter(Boolean)) siteCounts.set(site, (siteCounts.get(site) || 0) + 1)
  const dupIds = new Set([...idCounts].filter(([, n]) => n > 1).map(([id]) => id))
  const dupSites = new Set([...siteCounts].filter(([, n]) => n > 1).map(([id]) => id))
  if (dupIds.size) globals.push(error('duplicate_canonical_work_id', 'Canonical', `${dupIds.size} duplicated Works ids.`))
  if (dupSites.size) globals.push(error('canonical_site_id_collision', 'Canonical', `${dupSites.size} duplicated Works.siteId values.`))
  const recordIndex = indexRows(records, knownIds, 'PublishedRecord', globals)
  const ratingIndex = indexRows(ratings, knownIds, 'PublishedRating', globals)
  const candidateIndex = indexRows(candidates, knownIds, 'Candidate', globals)
  const researchIndex = indexRows(research, knownIds, 'Research', globals, true)

  const ledger = works.map((work, ordinal) => {
    const id = workId(work), canonical = []
    if (!id) canonical.push(error('canonical_work_id_missing', 'Canonical', 'Works id missing.'))
    if (!siteId(work)) canonical.push(error('canonical_site_id_missing', 'Canonical', 'Works.siteId missing.'))
    if (id && dupIds.has(id)) canonical.push(error('duplicate_canonical_work_id', 'Canonical', `Duplicate Work ${id}.`))
    if (siteId(work) && dupSites.has(siteId(work))) canonical.push(error('canonical_site_id_collision', 'Canonical', `Duplicate siteId ${siteId(work)}.`))
    const states = {
      Human: humanState(work),
      Published: publishedState(work, recordIndex.get(id) || [], ratingIndex.get(id) || [], expectedPolicyVersion),
      Candidate: candidateState(work, candidateIndex.get(id) || [], expectedPolicyVersion),
      Research: researchState(work, researchIndex.get(id) || []),
      Legacy: legacyState(work),
    }
    const presence = Object.fromEntries(EFFECTIVE_BUCKET_ORDER.map((bucket) => [bucket, bucket === 'TrulyUnassessed' ? true : states[bucket].present]))
    const effectiveBucket = EFFECTIVE_BUCKET_ORDER.find((bucket) => presence[bucket])
    const selected = states[effectiveBucket]
    const effectiveViolations = [...canonical, ...(selected?.violations || [])]
    const violations = [...canonical, ...EFFECTIVE_BUCKET_ORDER.slice(0, -1).flatMap((bucket) => states[bucket].violations || [])]
    return {
      schemaVersion: 'radar-effective-state-coverage-ledger-row-v01', ordinal: ordinal + 1,
      canonicalWorkId: id || null, canonicalSiteId: siteId(work) || null, canonicalIdentityKey: exactKey(work) || null,
      title: val(work?.title) || null, effectiveBucket, effectiveValid: !hasError(effectiveViolations),
      effectiveConclusion: selected?.conclusion || null, violations, effectiveViolations, authorityPresence: presence,
      historicalObservationCount: states.Research.historicalObservationCount || 0,
      effectiveResearchObservation: states.Research.effectiveObservation || null,
    }
  }).sort((a, b) => {
    const x = Number(a.canonicalWorkId), y = Number(b.canonicalWorkId)
    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y
    return val(a.canonicalWorkId).localeCompare(val(b.canonicalWorkId)) || a.ordinal - b.ordinal
  })

  const bucketCounts = Object.fromEntries(EFFECTIVE_BUCKET_ORDER.map((bucket) => [bucket, ledger.filter((row) => row.effectiveBucket === bucket).length]))
  const bucketTotal = Object.values(bucketCounts).reduce((sum, n) => sum + n, 0)
  const uniqueIds = new Set(ledger.map((row) => row.canonicalWorkId).filter(Boolean)).size
  const conservation = { canonicalWorksUniverse: works.length, bucketTotal, ledgerRows: ledger.length, uniqueCanonicalWorkIds: uniqueIds, strictSatisfied: bucketTotal === works.length && ledger.length === works.length && uniqueIds === works.length }
  if (!conservation.strictSatisfied) globals.push(error('effective_state_conservation_failure', 'Global', JSON.stringify(conservation)))
  const all = [...globals, ...ledger.flatMap((row) => row.violations.map((item) => ({ ...item, canonicalWorkId: row.canonicalWorkId })))]
  const invalidEffectiveCount = ledger.filter((row) => !row.effectiveValid).length
  const errors = all.filter((item) => item.severity === 'error').length, warnings = all.length - errors
  return {
    schemaVersion: 'radar-effective-state-coverage-audit-v01', authorityOrder: EFFECTIVE_BUCKET_ORDER,
    expectedPolicyVersion, inputDigestSha256: sha256Json(snapshot),
    sourceCounts: { works: works.length, radarPublicRecords: records.length, radarPublicRatings: ratings.length, radarPublicConclusions: candidates.length, radarResearchRecords: research.length },
    bucketCounts, conservation, invalidEffectiveCount, violationCounts: { errors, warnings, byCode: counts(all, 'code') },
    globalViolations: globals, decision: errors === 0 && invalidEffectiveCount === 0 && conservation.strictSatisfied ? 'PASS' : 'FAIL', ledger,
    safety: { databaseMigrationAuthorized: false, payloadWriteAuthorized: false, postgresqlWriteAuthorized: false, productionAuthorization: false, historicalReleaseRewriteAuthorized: false, existingPublicRatingsRerateAuthorized: false, readOnlySnapshotAudit: true },
  }
}
