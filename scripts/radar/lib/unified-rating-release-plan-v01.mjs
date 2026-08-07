import crypto from 'node:crypto'

import { normalizeRadarConclusion } from '../../../src/lib/radar/conclusionNormalizer.mjs'
import {
  buildCurrentRecordIndexes,
  buildPlanRow,
  buildWorkIndexes,
  matchExactWork,
  stableValue,
} from './public-release-plan-v01.mjs'

const val = (value) => String(value ?? '').trim()
const EXPLICIT_CONCLUSION_MODES = new Set(['fixed_grade', 'bounded_range', 'labels_only', 'blocked'])

const normalizeRelationship = (value) => {
  if (value && typeof value === 'object') return val(value.id)
  return val(value)
}

const sha256Text = (value) => crypto.createHash('sha256').update(value).digest('hex')

function publicConclusionProjection(rating) {
  const requestedMode = val(rating?.conclusionMode).toLowerCase()
  if (!EXPLICIT_CONCLUSION_MODES.has(requestedMode)) {
    return {
      conclusionMode: null,
      coreGrade: val(rating?.coreGrade),
      bestGrade: val(rating?.bestGrade),
      likelyGrade: val(rating?.likelyGrade),
      worstGrade: val(rating?.worstGrade),
    }
  }

  const normalized = normalizeRadarConclusion({
    ...rating,
    suggestedGrade: rating?.coreGrade,
  })

  if (normalized.conclusionMode === 'fixed_grade') {
    return {
      conclusionMode: 'fixed_grade',
      coreGrade: normalized.fixedGrade,
      bestGrade: normalized.fixedGrade,
      likelyGrade: normalized.fixedGrade,
      worstGrade: normalized.fixedGrade,
    }
  }

  if (normalized.conclusionMode === 'bounded_range') {
    return {
      conclusionMode: 'bounded_range',
      coreGrade: normalized.likelyGrade,
      bestGrade: normalized.bestGrade,
      likelyGrade: normalized.likelyGrade,
      worstGrade: normalized.worstGrade,
    }
  }

  return {
    conclusionMode: normalized.conclusionMode === 'blocked' ? 'blocked' : 'labels_only',
    coreGrade: null,
    bestGrade: null,
    likelyGrade: null,
    worstGrade: null,
  }
}

export function parseJsonl(text, label = 'JSONL') {
  if (text.includes('\r')) throw new Error(`${label} must use LF line endings`)
  if (text && !text.endsWith('\n')) throw new Error(`${label} must end with LF`)
  return text.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`${label} line ${index + 1} is invalid JSON: ${error.message}`)
    }
  })
}

export function validateLockedRelease({ manifestText, recordsText, ratingsText, indexText, lock }) {
  const manifest = JSON.parse(manifestText)
  const records = parseJsonl(recordsText, 'records.jsonl')
  const ratings = parseJsonl(ratingsText, 'ratings.jsonl')
  const index = parseJsonl(indexText, 'release-index.jsonl')

  const blockers = []
  const check = (condition, blocker) => {
    if (!condition) blockers.push(blocker)
  }

  check(sha256Text(manifestText) === lock.manifestSha256, 'manifest_sha_mismatch')
  check(sha256Text(recordsText) === lock.recordsSha256, 'records_sha_mismatch')
  check(sha256Text(ratingsText) === lock.ratingsSha256, 'ratings_sha_mismatch')
  check(sha256Text(indexText) === lock.releaseIndexSha256, 'release_index_sha_mismatch')
  check(manifest.releaseId === lock.releaseId, 'release_id_mismatch')
  check(manifest.previousRelease?.releaseId === lock.previousRelease.releaseId, 'previous_release_id_mismatch')
  check(manifest.previousRelease?.recordsSha256 === lock.previousRelease.recordsSha256, 'previous_records_sha_mismatch')
  check(records.length === lock.counts.records, 'record_count_mismatch')
  check(ratings.length === lock.counts.ratings, 'rating_count_mismatch')
  check(index.length === lock.counts.records, 'release_index_count_mismatch')

  const recordIDs = records.map((row) => val(row.identityKey))
  const ratingIDs = ratings.map((row) => val(row.identityKey))
  const indexIDs = index.map((row) => val(row.identityKey))
  check(new Set(recordIDs).size === records.length, 'duplicate_record_identity')
  check(new Set(ratingIDs).size === ratings.length, 'duplicate_rating_identity')
  check(JSON.stringify(recordIDs) === JSON.stringify(ratingIDs), 'record_rating_order_mismatch')
  check(JSON.stringify(recordIDs) === JSON.stringify(indexIDs), 'record_index_order_mismatch')
  check(ratings.every((row) => row.humanReview?.status === 'unreviewed'), 'nonblank_human_review_status')
  check(ratings.every((row) => row.humanReview?.blocksPublication === false), 'human_review_blocks_publication')
  check(manifest.gates?.productionAuthorization === false, 'release_production_authorized')
  check(lock.productionAuthorization === false, 'lock_production_authorized')

  return { manifest, records, ratings, index, blockers, accepted: blockers.length === 0 }
}

export function buildCurrentRatingIndexes(ratings) {
  const byPublicationKey = new Map()
  const duplicatePublicationKeys = new Set()
  for (const rating of ratings) {
    if (val(rating?.recordStatus || 'current') !== 'current') continue
    const key = val(rating?.publicationKey)
    if (!key) continue
    if (byPublicationKey.has(key)) duplicatePublicationKeys.add(key)
    else byPublicationKey.set(key, rating)
  }
  return { byPublicationKey, duplicatePublicationKeys }
}

export function buildDesiredPublicRating(rating, work, release, importedAt) {
  const conclusion = publicConclusionProjection(rating)
  return {
    publicationKey: `work:${val(work.id)}`,
    work: val(work.id),
    identityKey: val(rating.identityKey),
    workIdSnapshot: val(rating.workId),
    workSiteId: val(rating.siteId),
    title: val(rating.title),
    conclusionMode: conclusion.conclusionMode,
    coreGrade: conclusion.coreGrade,
    bestGrade: conclusion.bestGrade,
    likelyGrade: conclusion.likelyGrade,
    worstGrade: conclusion.worstGrade,
    confidence: val(rating.confidence),
    matchedClasses: (rating.matchedClasses || []).map((value) => ({ value: val(value) })),
    factRefs: (rating.factRefs || []).map((value) => ({ value: val(value) })),
    evidenceRefs: (rating.evidenceRefs || []).map((value) => ({ value: val(value) })),
    reasoningSummary: val(rating.reasoningSummary),
    unresolvedDimensions: (rating.unresolvedDimensions || []).map((value) => ({ value: val(value) })),
    classificationRule: val(rating.classificationRule),
    confirmationBasis: (rating.confirmationBasis || []).map((value) => ({ value: val(value) })),
    benefitOfDoubtBaselineApplied: rating.benefitOfDoubtBaselineApplied === true,
    publicTagHints: (rating.publicTagHints || []).map((tag) => ({
      key: val(tag.key),
      group: val(tag.group),
      value: val(tag.value),
      warningTemplateId: val(tag.warningTemplateId),
    })),
    publicWarningTemplateIds: (rating.publicWarningTemplateIds || []).map((value) => ({ value: val(value) })),
    humanReview: {
      status: val(rating.humanReview?.status || 'unreviewed'),
      reviewerIdentity: val(rating.humanReview?.reviewerIdentity),
      reviewedAt: val(rating.humanReview?.reviewedAt),
      decision: val(rating.humanReview?.decision),
      proposedCoreGrade: val(rating.humanReview?.proposedCoreGrade),
      proposedProfileChanges: (rating.humanReview?.proposedProfileChanges || []).map((value) => ({ value: val(value) })),
      reasoning: val(rating.humanReview?.reasoning),
      additionalEvidenceRefs: (rating.humanReview?.additionalEvidenceRefs || []).map((value) => ({ value: val(value) })),
      moderationState: val(rating.humanReview?.moderationState),
      blocksAnalysis: rating.humanReview?.blocksAnalysis === true,
      blocksPublication: rating.humanReview?.blocksPublication === true,
    },
    sourceReleaseId: val(release.releaseId),
    sourceCommitSha: val(release.sourceCommitSha),
    sourcePolicyVersion: val(release.policyVersion),
    researchSnapshotId: val(release.researchSnapshotId),
    sourceRatingCampaignId: val(rating.sourceRatingCampaignId),
    sourceRatingDecisionHash: val(rating.sourceRatingDecisionHash),
    releaseRatingHash: val(rating.releaseRatingHash),
    releaseRatingsSha256: val(release.ratingsSha256),
    importedAt,
    recordStatus: 'current',
  }
}

function comparableRating(record) {
  if (!record) return null
  return {
    publicationKey: val(record.publicationKey),
    work: normalizeRelationship(record.work),
    identityKey: val(record.identityKey),
    workIdSnapshot: val(record.workIdSnapshot),
    workSiteId: val(record.workSiteId),
    title: val(record.title),
    conclusionMode: val(record.conclusionMode) || null,
    coreGrade: val(record.coreGrade) || null,
    bestGrade: val(record.bestGrade) || null,
    likelyGrade: val(record.likelyGrade) || null,
    worstGrade: val(record.worstGrade) || null,
    confidence: val(record.confidence),
    matchedClasses: (record.matchedClasses || []).map((item) => ({ value: val(item?.value ?? item) })),
    factRefs: (record.factRefs || []).map((item) => ({ value: val(item?.value ?? item) })),
    evidenceRefs: (record.evidenceRefs || []).map((item) => ({ value: val(item?.value ?? item) })),
    reasoningSummary: val(record.reasoningSummary),
    unresolvedDimensions: (record.unresolvedDimensions || []).map((item) => ({ value: val(item?.value ?? item) })),
    classificationRule: val(record.classificationRule),
    confirmationBasis: (record.confirmationBasis || []).map((item) => ({ value: val(item?.value ?? item) })),
    benefitOfDoubtBaselineApplied: record.benefitOfDoubtBaselineApplied === true,
    publicTagHints: (record.publicTagHints || []).map((tag) => ({
      key: val(tag.key), group: val(tag.group), value: val(tag.value), warningTemplateId: val(tag.warningTemplateId),
    })),
    publicWarningTemplateIds: (record.publicWarningTemplateIds || []).map((item) => ({ value: val(item?.value ?? item) })),
    humanReview: {
      status: val(record.humanReview?.status || 'unreviewed'),
      reviewerIdentity: val(record.humanReview?.reviewerIdentity),
      reviewedAt: val(record.humanReview?.reviewedAt),
      decision: val(record.humanReview?.decision),
      proposedCoreGrade: val(record.humanReview?.proposedCoreGrade),
      proposedProfileChanges: (record.humanReview?.proposedProfileChanges || []).map((item) => ({ value: val(item?.value ?? item) })),
      reasoning: val(record.humanReview?.reasoning),
      additionalEvidenceRefs: (record.humanReview?.additionalEvidenceRefs || []).map((item) => ({ value: val(item?.value ?? item) })),
      moderationState: val(record.humanReview?.moderationState),
      blocksAnalysis: record.humanReview?.blocksAnalysis === true,
      blocksPublication: record.humanReview?.blocksPublication === true,
    },
    sourceReleaseId: val(record.sourceReleaseId),
    sourceCommitSha: val(record.sourceCommitSha),
    sourcePolicyVersion: val(record.sourcePolicyVersion),
    researchSnapshotId: val(record.researchSnapshotId),
    sourceRatingCampaignId: val(record.sourceRatingCampaignId),
    sourceRatingDecisionHash: val(record.sourceRatingDecisionHash),
    releaseRatingHash: val(record.releaseRatingHash),
    releaseRatingsSha256: val(record.releaseRatingsSha256),
    recordStatus: val(record.recordStatus || 'current'),
  }
}

function comparableDesiredRating(record) {
  const { importedAt, ...rest } = record
  return rest
}

export function buildRatingPlanRow(rating, workIndexes, currentIndexes, release, importedAt) {
  const match = matchExactWork(rating, workIndexes)
  const base = {
    identityKey: val(rating.identityKey),
    workId: val(rating.workId),
    siteId: val(rating.siteId),
    title: val(rating.title),
    coreGrade: val(rating.coreGrade),
    blockers: [...match.blockers],
    warnings: [],
    target: match.work ? { id: val(match.work.id), siteId: val(match.work.siteId), title: val(match.work.title) } : null,
    currentRatingId: null,
    desired: null,
  }
  if (match.status !== 'matched_exact_work') return { ...base, planStatus: match.status }
  if (rating.humanReview?.status !== 'unreviewed' || rating.humanReview?.blocksPublication === true) {
    return { ...base, planStatus: 'blocked_release_human_review_state', blockers: ['release_human_review_state_not_blank_nonblocking'] }
  }

  const desired = buildDesiredPublicRating(rating, match.work, release, importedAt)
  const publicationKey = desired.publicationKey
  if (currentIndexes.duplicatePublicationKeys.has(publicationKey)) {
    return { ...base, desired, planStatus: 'blocked_duplicate_current_rating', blockers: [`duplicate_current_rating:${publicationKey}`] }
  }
  const current = currentIndexes.byPublicationKey.get(publicationKey)
  if (!current) return { ...base, desired, planStatus: 'ready_create' }

  const currentWork = normalizeRelationship(current.work)
  base.currentRatingId = val(current.id)
  if (currentWork !== val(match.work.id) || val(current.identityKey) !== val(rating.identityKey)) {
    return {
      ...base,
      desired,
      planStatus: 'blocked_existing_rating_identity_conflict',
      blockers: [`existing_rating_identity_conflict:${currentWork}|${val(current.identityKey)}`],
    }
  }

  const same = JSON.stringify(stableValue(comparableRating(current)))
    === JSON.stringify(stableValue(comparableDesiredRating(desired)))
  return { ...base, desired, planStatus: same ? 'already_current' : 'ready_update' }
}

export function buildUnifiedReleasePlan({ records, ratings, works, currentRecords = [], currentRatings = [], release, importedAt }) {
  if (records.length !== ratings.length) throw new Error(`Release record/rating count mismatch: ${records.length} != ${ratings.length}`)
  const recordIDs = records.map((row) => val(row.identityKey))
  const ratingIDs = ratings.map((row) => val(row.identityKey))
  if (JSON.stringify(recordIDs) !== JSON.stringify(ratingIDs)) throw new Error('Release record/rating identity order mismatch')

  const workIndexes = buildWorkIndexes(works)
  const currentRecordIndexes = buildCurrentRecordIndexes(currentRecords)
  const currentRatingIndexes = buildCurrentRatingIndexes(currentRatings)
  const rows = records.map((record, index) => ({
    releaseOrdinal: index + 1,
    identityKey: val(record.identityKey),
    recordPlan: buildPlanRow(record, workIndexes, currentRecordIndexes, release, importedAt),
    ratingPlan: buildRatingPlanRow(ratings[index], workIndexes, currentRatingIndexes, release, importedAt),
  }))

  const recordStatusCounts = Object.fromEntries([...new Set(rows.map((row) => row.recordPlan.planStatus))].sort().map((status) => [status, rows.filter((row) => row.recordPlan.planStatus === status).length]))
  const ratingStatusCounts = Object.fromEntries([...new Set(rows.map((row) => row.ratingPlan.planStatus))].sort().map((status) => [status, rows.filter((row) => row.ratingPlan.planStatus === status).length]))
  const blockers = rows.flatMap((row) => [
    ...row.recordPlan.blockers.map((value) => `record:${row.identityKey}:${value}`),
    ...row.ratingPlan.blockers.map((value) => `rating:${row.identityKey}:${value}`),
  ])
  return {
    schemaVersion: 'radar-unified-rating-release-transition-plan-v01',
    releaseId: release.releaseId,
    generatedAt: importedAt,
    counts: { rows: rows.length, recordStatusCounts, ratingStatusCounts, blockers: blockers.length },
    accepted: blockers.length === 0,
    blockers,
    rows,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      postgresqlRead: false,
      postgresqlWrite: false,
      websiteWrite: false,
      productionAuthorization: false,
    },
  }
}
