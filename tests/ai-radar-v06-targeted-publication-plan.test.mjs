import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTargetedPublicationPlanRow } from '../scripts/radar/plan-ai-radar-v06-targeted-publication-v01.mjs'

const radar = {
  suggestedGrade: 'B',
  policyVersion: 'radar-rating-policy-v0.4-draft',
  assessmentBatch: 'RADAR-ASSESS-0001',
  assessedAt: '2026-07-15T00:00:00.000Z',
  confidencePercent: 80,
  evidenceCoveragePercent: 65,
  evidenceStatus: 'single_secondary_supported',
  sourceSummary: 'fixture',
  matchedRules: [],
  contradictions: [],
  sourceCount: 1,
  requiresHumanReview: true,
}

function planPatch() {
  return {
    rank: 'B',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewStatus: 'pending',
    reviewReasons: ['radar_seed_attached'],
    evidenceStrength: 'medium',
    radarAssessment: radar,
  }
}

function event() {
  return {
    evidenceKind: 'applied_and_verified',
    workId: '1',
    targetId: '1',
    batchId: 'RADAR-ASSESS-0001',
    generatedAt: '2026-07-15T00:01:00.000Z',
    summaryFile: 'summary.json',
    planFile: 'plan.jsonl',
    plan: {
      workId: '1',
      target: { id: '1', siteId: 'work:1' },
      patch: planPatch(),
    },
  }
}

function gap() {
  return {
    status: 'draft_only_v06_match',
    workId: '1',
    targetId: '1',
    siteId: 'work:1',
    title: 'Fixture',
  }
}

function published(overrides = {}) {
  return {
    id: '1',
    siteId: 'work:1',
    title: 'Fixture',
    _status: 'published',
    rank: 'unknown',
    ratingNotice: 'insufficient_information',
    reviewStatus: 'pending',
    reviewReasons: [],
    evidenceStrength: 'unassessed',
    radarAssessment: {},
    humanAssessment: {},
    ...overrides,
  }
}

function draft(overrides = {}) {
  return {
    ...published(),
    rank: 'B',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewStatus: 'pending',
    reviewReasons: ['radar_seed_attached'],
    evidenceStrength: 'medium',
    radarAssessment: radar,
    ...overrides,
  }
}

test('builds an allowlisted partial publication patch for an AI-only work', () => {
  const row = buildTargetedPublicationPlanRow(gap(), event(), published(), draft())
  assert.equal(row.planStatus, 'ready_for_publication_dry_run')
  assert.deepEqual(Object.keys(row.patch).sort(), [
    '_status',
    'evidenceStrength',
    'radarAssessment',
    'rank',
    'ratingNotice',
    'reviewReasons',
    'reviewStatus',
  ])
  assert.equal(row.patch._status, 'published')
  assert.equal(row.patch.radarAssessment.suggestedGrade, 'B')
  assert.equal(row.wholeDraftPublicationForbidden, true)
  assert.equal(row.humanTrackPreservedByOmission, true)
})

test('omits compatibility fields when a human track is recorded', () => {
  const current = published({
    rank: 'A',
    ratingNotice: 'manual_reviewed',
    reviewStatus: 'reviewed',
    humanAssessment: { grade: 'A', status: 'reviewed', note: 'human' },
  })
  const latest = draft({
    rank: 'A',
    ratingNotice: 'manual_reviewed',
    reviewStatus: 'reviewed',
    humanAssessment: current.humanAssessment,
  })
  const row = buildTargetedPublicationPlanRow(gap(), event(), current, latest)
  assert.equal(row.planStatus, 'ready_for_publication_dry_run')
  assert.equal(row.humanTrackRecorded, true)
  assert.deepEqual(Object.keys(row.patch).sort(), ['_status', 'radarAssessment'])
})

test('blocks a published work that already has another formal AI conclusion', () => {
  const otherRadar = { ...radar, suggestedGrade: 'C', assessmentBatch: 'later' }
  const row = buildTargetedPublicationPlanRow(gap(), event(), published({ radarAssessment: otherRadar }), draft())
  assert.equal(row.planStatus, 'blocked')
  assert.ok(row.blockers.includes('published_has_formal_ai_conclusion'))
})

test('blocks when the latest draft no longer matches the verified v0.6 plan', () => {
  const row = buildTargetedPublicationPlanRow(gap(), event(), published(), draft({ radarAssessment: { ...radar, suggestedGrade: 'D' } }))
  assert.equal(row.planStatus, 'blocked')
  assert.ok(row.blockers.includes('latest_draft_radar_no_longer_matches_verified_v06_plan'))
})

test('never copies unrelated draft fields into the publication patch', () => {
  const latest = draft({ summary: { root: { children: [{ text: 'unrelated draft edit' }] } }, title: 'Fixture changed in draft' })
  const row = buildTargetedPublicationPlanRow(gap(), event(), published(), latest)
  assert.equal('summary' in row.patch, false)
  assert.equal('title' in row.patch, false)
  assert.equal('humanAssessment' in row.patch, false)
  assert.ok(row.warnings.includes('published_draft_title_mismatch_stable_id_preserved'))
})
