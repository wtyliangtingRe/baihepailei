import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPlanRow,
  buildWorkIndexes,
  dryRunPlanRow,
  evidenceStrengthFor,
  resolveTargetWork,
} from '../scripts/radar/lib/payload-plan-v01.mjs'

function work(overrides = {}) {
  return {
    id: '42',
    siteId: 'work:test-42',
    title: '测试作品',
    rank: 'unknown',
    reviewStatus: 'pending',
    reviewReasons: [],
    ratingNotice: 'none',
    evidenceStrength: 'unassessed',
    ...overrides,
  }
}

function assessment(overrides = {}) {
  return {
    workId: '42',
    siteId: 'work:test-42',
    title: '测试作品',
    assessmentBatch: 'batch-v01',
    policyVersion: 'radar-rating-policy-v0.4-draft',
    currentGradeSuggestion: 'B',
    decisiveRule: { code: 'B-LIGHT', grade: 'B', reason: '测试理由', confidencePercent: 88 },
    matchedRules: [{ code: 'B-LIGHT', grade: 'B', reason: '测试理由', confidencePercent: 88 }],
    confidencePercent: 88,
    evidenceCoveragePercent: 72,
    evidenceStatus: 'multiple_secondary_supported',
    sourceSummary: '两个来源支持当前判断。',
    sourceCount: 2,
    blockers: [],
    contradictions: [],
    writeProtection: { protected: false, reasons: [] },
    requiresHumanReview: true,
    ...overrides,
  }
}

test('stable id and siteId resolve the same Payload work', () => {
  const target = resolveTargetWork(assessment(), buildWorkIndexes([work()]))
  assert.equal(target.work.id, '42')
  assert.deepEqual(target.matchedBy, ['id', 'siteId'])
  assert.deepEqual(target.blockers, [])
})

test('different id and siteId targets are blocked as an identity mismatch', () => {
  const indexes = buildWorkIndexes([
    work(),
    work({ id: '43', siteId: 'work:test-43', title: '另一作品' }),
  ])
  const mismatched = resolveTargetWork(assessment({ siteId: 'work:test-43' }), indexes)
  assert.ok(mismatched.blockers.includes('payload_id_site_id_identity_mismatch'))
})

test('title-only matching is never allowed', () => {
  const target = resolveTargetWork(assessment({ workId: '', siteId: '' }), buildWorkIndexes([work()]))
  assert.equal(target.work, null)
  assert.ok(target.blockers.includes('stable_identifier_not_found'))
})

test('recorded human track is preserved while the independent AI track can refresh', () => {
  const manual = work({
    rank: 'S',
    ratingNotice: 'manual_reviewed',
    reviewStatus: 'reviewed',
    reviewReasons: ['manual_review'],
    evidenceStrength: 'strong',
    humanAssessment: { grade: 'S', status: 'reviewed', note: '人工记录' },
  })
  const plan = buildPlanRow(assessment(), buildWorkIndexes([manual]))
  assert.equal(plan.planStatus, 'ready_for_payload_dry_run')
  assert.equal(plan.humanTrackPreserved, true)
  assert.deepEqual(plan.changedFields, ['radarAssessment'])
  assert.equal(plan.patch.rank, 'S')
  assert.equal(plan.patch.ratingNotice, 'manual_reviewed')
  assert.equal(plan.patch.reviewStatus, 'reviewed')
  assert.deepEqual(plan.patch.reviewReasons, ['manual_review'])
  assert.equal(plan.patch.radarAssessment.suggestedGrade, 'B')
})

test('ready plans contain grade, notice, metrics and all matched rules', () => {
  const plan = buildPlanRow(assessment(), buildWorkIndexes([work()]), { assessedAt: '2026-07-13T00:00:00+08:00' })
  assert.equal(plan.planStatus, 'ready_for_payload_dry_run')
  assert.equal(plan.patch.rank, 'B')
  assert.equal(plan.patch.ratingNotice, 'ai_synthesized_pending_review')
  assert.equal(plan.patch.radarAssessment.confidencePercent, 88)
  assert.equal(plan.patch.radarAssessment.evidenceCoveragePercent, 72)
  assert.equal(plan.patch.radarAssessment.matchedRules[0].code, 'B-LIGHT')
  assert.ok(plan.changedFields.includes('radarAssessment'))
})

test('identity blockers and contradictions prevent a ready plan', () => {
  const plan = buildPlanRow(assessment({ blockers: ['identity_review_required'], contradictions: ['source_conflict'] }), buildWorkIndexes([work()]))
  assert.equal(plan.planStatus, 'blocked')
  assert.ok(plan.blockers.includes('identity_review_required'))
  assert.ok(plan.blockers.includes('contradiction:source_conflict'))
})

test('external research insufficiency stays visible as a warning rather than hiding the work', () => {
  const plan = buildPlanRow(assessment({
    currentGradeSuggestion: 'D',
    decisiveRule: { code: 'D-UNCLEAR', grade: 'D', reason: '资料不足', confidencePercent: 60 },
    evidenceStatus: 'insufficient_evidence',
    blockers: ['external_research_insufficient'],
  }), buildWorkIndexes([work()]))
  assert.equal(plan.planStatus, 'ready_for_payload_dry_run')
  assert.ok(plan.warnings.includes('assessment_warning:external_research_insufficient'))
  assert.equal(plan.patch.evidenceStrength, 'weak')
})

test('dry-run detects changes made after plan generation', () => {
  const plan = buildPlanRow(assessment(), buildWorkIndexes([work()]))
  const result = dryRunPlanRow(plan, buildWorkIndexes([work({ evidenceStrength: 'strong' })]))
  assert.equal(result.status, 'blocked')
  assert.ok(result.blockers.includes('stale_payload_snapshot_since_plan'))
})

test('evidence strength remains conservative for insufficient evidence', () => {
  assert.equal(evidenceStrengthFor(assessment({ evidenceStatus: 'insufficient_evidence', evidenceCoveragePercent: 90 })), 'weak')
  assert.equal(evidenceStrengthFor(assessment({ evidenceStatus: 'multiple_secondary_supported', evidenceCoveragePercent: 80 })), 'strong')
})
