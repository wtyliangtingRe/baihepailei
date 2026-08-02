import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDesiredPublicRecord } from '../scripts/radar/lib/public-release-plan-v01.mjs'
import {
  buildDesiredPublicRating,
  buildUnifiedReleasePlan,
} from '../scripts/radar/lib/unified-rating-release-plan-v01.mjs'

const importedAt = '2026-08-02T00:00:00.000Z'
const newRelease = {
  releaseId: 'RADAR-UNIFIED-RATING-RELEASE-0575-0001',
  sourceCommitSha: '728ad2da5f7d3aba03f652b9fd701157b06793ee',
  policyVersion: 'radar-internal-processing-policy-v03+radar-unified-rating-release-v01',
  researchSnapshotId: 'RADAR-UNIFIED-RATING-RELEASE-0575-0001',
  recordsSha256: '4dcf9e6790fa7175f18b7c91ed3b2f6522ec6d87c623183f0369491b06123605',
  ratingsSha256: '2847b48eb08c2409c94e0380e6351d778421db13466f17138d2a64b20774eef4',
}
const oldRelease = {
  releaseId: 'RADAR-PUBLIC-RELEASE-0001',
  sourceCommitSha: '1555eb3e66cd2f8bb7d5048db1afab969ff819dd',
  policyVersion: 'radar-public-release-v01+radar-rating-policy-v0.2-draft',
  researchSnapshotId: 'global-claim-facts-through-post-wave0009-batch0001-493',
  recordsSha256: 'ecb4440e7e102fd69c5a4ebf1f70970d832944f6a50af924cb9437b3c49dc3e0',
}

function record(index) {
  const id = String(index + 1)
  return {
    schemaVersion: 'radar-public-record-v01',
    workId: id,
    siteId: `SITE-${id}`,
    identityKey: `${id}|SITE-${id}`,
    title: `Work ${id}`,
    aliases: [],
    externalIds: {},
    publicState: 'partial',
    researchStatus: 'partially_verified',
    lastReviewedAt: '2026-08-02T00:00:00Z',
    pageNotice: 'Machine-rated public research record.',
    evidence: [{
      sourceRef: `source-${id}`,
      tier: 'A',
      role: 'primary',
      url: `https://example.test/${id}`,
      title: `Source ${id}`,
      exactIdentityBound: true,
    }],
    facts: [{ factId: `fact-${id}`, type: 'source_page_title', value: `Work ${id}`, sourceRefs: [`source-${id}`] }],
  }
}

function rating(index) {
  const id = String(index + 1)
  const grade = index < 476 ? 'B' : index < 573 ? 'D' : 'E'
  const matchedClass = grade === 'B' ? 'B-LIGHT' : grade === 'D' ? 'D-UNCLEAR' : 'E-MALE-POSSIBILITY'
  const tag = grade === 'B'
    ? { key: 'staff-small-work', group: '排雷协作-站务提示', value: '小作品', warningTemplateId: 'info-insufficient' }
    : grade === 'D'
      ? { key: 'relationship-needs-radar', group: '关系提示', value: '需要排雷', warningTemplateId: 'needs-radar' }
      : null
  return {
    schemaVersion: 'radar-unified-public-rating-v01',
    releaseId: newRelease.releaseId,
    identityKey: `${id}|SITE-${id}`,
    workId: id,
    siteId: `SITE-${id}`,
    title: `Work ${id}`,
    coreGrade: grade,
    bestGrade: grade,
    likelyGrade: grade,
    worstGrade: grade,
    confidence: grade === 'D' ? 'low' : 'medium',
    matchedClasses: [matchedClass],
    factRefs: [`fact-${id}`],
    evidenceRefs: [`source-${id}`],
    reasoningSummary: `Reason ${id}`,
    unresolvedDimensions: ['ending_or_final_state'],
    classificationRule: grade === 'B' ? 'confirmed_yuri_benefit_of_doubt_baseline' : 'lower_or_unclear',
    confirmationBasis: grade === 'B' ? ['vetted_yuri_specialist_catalogue_plus_exact_source'] : [],
    benefitOfDoubtBaselineApplied: grade === 'B',
    publicTagHints: tag ? [tag] : [],
    publicWarningTemplateIds: tag ? [tag.warningTemplateId] : [],
    humanReview: {
      status: 'unreviewed', reviewerIdentity: null, reviewedAt: null, decision: null,
      proposedCoreGrade: null, proposedProfileChanges: [], reasoning: null,
      additionalEvidenceRefs: [], moderationState: null,
      blocksAnalysis: false, blocksPublication: false,
    },
    sourceRatingCampaignId: 'SOURCE-CAMPAIGN',
    sourceRatingDecisionHash: `decision-${id}`,
    releaseRatingHash: `release-rating-${id}`,
  }
}

const records = Array.from({ length: 575 }, (_, index) => record(index))
const ratings = Array.from({ length: 575 }, (_, index) => rating(index))
const works = records.map((row) => ({ id: row.workId, siteId: row.siteId, title: row.title }))

function count(plan, kind, status) {
  return plan.counts[kind === 'record' ? 'recordStatusCounts' : 'ratingStatusCounts'][status] || 0
}

test('fresh database plans 575 fact creates and 575 rating creates', () => {
  const plan = buildUnifiedReleasePlan({ records, ratings, works, release: newRelease, importedAt })
  assert.equal(plan.accepted, true)
  assert.equal(plan.counts.rows, 575)
  assert.equal(count(plan, 'record', 'ready_create'), 575)
  assert.equal(count(plan, 'rating', 'ready_create'), 575)
  assert.equal(plan.counts.blockers, 0)
  assert.deepEqual(plan.safety, {
    payloadRead: false,
    payloadWrite: false,
    postgresqlRead: false,
    postgresqlWrite: false,
    websiteWrite: false,
    productionAuthorization: false,
  })
})

test('old 520-row fact release plans 520 updates, 55 fact creates, and 575 rating creates', () => {
  const currentRecords = records.slice(0, 520).map((row, index) => ({
    id: String(10000 + index),
    ...buildDesiredPublicRecord(row, works[index], oldRelease, '2026-08-01T00:00:00.000Z'),
  }))
  const plan = buildUnifiedReleasePlan({ records, ratings, works, currentRecords, release: newRelease, importedAt })
  assert.equal(plan.accepted, true)
  assert.equal(count(plan, 'record', 'ready_update'), 520)
  assert.equal(count(plan, 'record', 'ready_create'), 55)
  assert.equal(count(plan, 'rating', 'ready_create'), 575)
  assert.equal(plan.counts.blockers, 0)
})

test('fully converged release is idempotent', () => {
  const currentRecords = records.map((row, index) => ({
    id: String(20000 + index),
    ...buildDesiredPublicRecord(row, works[index], newRelease, importedAt),
  }))
  const currentRatings = ratings.map((row, index) => ({
    id: String(30000 + index),
    ...buildDesiredPublicRating(row, works[index], newRelease, importedAt),
  }))
  const plan = buildUnifiedReleasePlan({ records, ratings, works, currentRecords, currentRatings, release: newRelease, importedAt: '2026-08-03T00:00:00.000Z' })
  assert.equal(plan.accepted, true)
  assert.equal(count(plan, 'record', 'already_current'), 575)
  assert.equal(count(plan, 'rating', 'already_current'), 575)
  assert.equal(plan.counts.blockers, 0)
})

test('nonblank or blocking release human review is rejected', () => {
  const badRatings = ratings.map((row, index) => index === 0
    ? { ...row, humanReview: { ...row.humanReview, status: 'reviewed' } }
    : row)
  const plan = buildUnifiedReleasePlan({ records, ratings: badRatings, works, release: newRelease, importedAt })
  assert.equal(plan.accepted, false)
  assert.equal(count(plan, 'rating', 'blocked_release_human_review_state'), 1)
  assert.equal(plan.counts.blockers, 1)
})

test('exact Work identity conflict blocks both fact and rating plans', () => {
  const conflictingWorks = works.map((work, index) => index === 10 ? { ...work, siteId: 'OTHER-SITE' } : work)
  const plan = buildUnifiedReleasePlan({ records, ratings, works: conflictingWorks, release: newRelease, importedAt })
  assert.equal(plan.accepted, false)
  assert.equal(count(plan, 'record', 'blocked_identity_conflict'), 1)
  assert.equal(count(plan, 'rating', 'blocked_identity_conflict'), 1)
  assert.equal(plan.counts.blockers, 2)
})
