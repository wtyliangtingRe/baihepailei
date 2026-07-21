import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTargetedPublicationDryRunRow,
  targetedPublicationExpectations,
  targetedPublicationSha256,
} from '../scripts/radar/dryrun-ai-radar-v06-targeted-publication-v01.mjs'

function radar(overrides = {}) {
  return {
    suggestedGrade: 'D',
    confidencePercent: 62,
    evidenceCoveragePercent: 41,
    evidenceStatus: 'single_secondary_supported',
    sourceSummary: 'test source summary',
    policyVersion: 'radar-rating-policy-v0.4-draft',
    assessedAt: '2026-07-01T00:00:00.000Z',
    assessmentBatch: 'RADAR-ASSESS-0001',
    decisiveRuleCode: 'D-UNCLEAR',
    decisiveRuleReason: 'Evidence is incomplete.',
    matchedRules: [],
    sourceCount: 1,
    contradictions: [],
    requiresHumanReview: true,
    ...overrides,
  }
}

function published(overrides = {}) {
  return {
    id: 'work-1',
    siteId: 'work:test-1',
    title: 'Test Work',
    _status: 'published',
    rank: 'unknown',
    ratingNotice: null,
    reviewStatus: 'pending',
    reviewReasons: [],
    evidenceStrength: 'unassessed',
    radarAssessment: {},
    humanAssessment: { status: 'pending' },
    humanReviewNote: null,
    humanReviewedAt: null,
    humanReviewedBy: null,
    ...overrides,
  }
}

function draft(expectedRadar = radar(), overrides = {}) {
  return {
    ...published(),
    _status: 'draft',
    radarAssessment: expectedRadar,
    rank: 'D',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['radar_seed_attached'],
    evidenceStrength: 'weak',
    ...overrides,
  }
}

function patch(expectedRadar = radar()) {
  return {
    _status: 'published',
    radarAssessment: expectedRadar,
    rank: 'D',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewStatus: 'pending',
    reviewReasons: ['radar_seed_attached'],
    evidenceStrength: 'weak',
  }
}

function planFor(before = published(), latest = draft(), desiredPatch = patch()) {
  return {
    version: 'ai-radar-v06-targeted-publication-plan-v0.1',
    planStatus: 'ready_for_publication_dry_run',
    workId: 'work-1',
    target: { id: 'work-1', siteId: 'work:test-1', title: 'Test Work' },
    source: { batchId: 'RADAR-ASSESS-0001' },
    expectedBefore: targetedPublicationExpectations(before, latest),
    patch: desiredPatch,
    patchSha256: targetedPublicationSha256(desiredPatch),
    changedFields: ['evidenceStrength', 'radarAssessment', 'rank', 'ratingNotice', 'reviewReasons'],
    humanTrackRecorded: false,
    humanTrackPreservedByOmission: true,
    wholeDraftPublicationForbidden: true,
    blockers: [],
    warnings: [],
  }
}

test('accepts an unchanged targeted publication plan', () => {
  const before = published()
  const latest = draft()
  const row = buildTargetedPublicationDryRunRow(planFor(before, latest), before, latest)

  assert.equal(row.dryRunStatus, 'ready_for_targeted_publication')
  assert.deepEqual(row.blockers, [])
  assert.deepEqual(row.changedFields, ['evidenceStrength', 'radarAssessment', 'rank', 'ratingNotice', 'reviewReasons'])
  assert.equal(row.payloadPatchSimulatedOnly, true)
})

test('blocks published state drift', () => {
  const before = published()
  const latest = draft()
  const changed = published({ rank: 'C' })
  const row = buildTargetedPublicationDryRunRow(planFor(before, latest), changed, latest)

  assert.equal(row.dryRunStatus, 'blocked')
  assert.ok(row.blockers.includes('published_state_drift'))
})

test('blocks human state drift and compatibility publication', () => {
  const before = published()
  const latest = draft()
  const changed = published({
    humanAssessment: { grade: 'A', status: 'reviewed' },
    humanReviewNote: 'reviewed later',
  })
  const row = buildTargetedPublicationDryRunRow(planFor(before, latest), changed, latest)

  assert.equal(row.dryRunStatus, 'blocked')
  assert.ok(row.blockers.includes('human_state_drift'))
  assert.ok(row.blockers.includes('human_track_presence_drift'))
  assert.ok(row.blockers.some((item) => item.startsWith('human_track_compatibility_patch_forbidden:')))
})

test('blocks latest draft Radar drift', () => {
  const before = published()
  const latest = draft()
  const changedDraft = draft(radar({ suggestedGrade: 'C' }))
  const row = buildTargetedPublicationDryRunRow(planFor(before, latest), before, changedDraft)

  assert.equal(row.dryRunStatus, 'blocked')
  assert.ok(row.blockers.includes('latest_draft_radar_drift'))
  assert.ok(row.blockers.includes('latest_draft_radar_differs_from_patch'))
})

test('recognizes a safely already-published row', () => {
  const before = published()
  const latest = draft()
  const desired = patch()
  const current = { ...before, ...desired }
  const row = buildTargetedPublicationDryRunRow(planFor(before, latest, desired), current, latest)

  assert.equal(row.dryRunStatus, 'already_published')
  assert.deepEqual(row.blockers, [])
  assert.deepEqual(row.changedFields, [])
})

test('rejects unrelated draft fields in the partial patch', () => {
  const before = published()
  const latest = draft()
  const unsafePatch = { ...patch(), title: 'Unrelated draft title' }
  const unsafePlan = planFor(before, latest, unsafePatch)
  unsafePlan.changedFields = [...unsafePlan.changedFields, 'title'].sort()
  const row = buildTargetedPublicationDryRunRow(unsafePlan, before, latest)

  assert.equal(row.dryRunStatus, 'blocked')
  assert.ok(row.blockers.includes('unexpected_patch_field:title'))
})
