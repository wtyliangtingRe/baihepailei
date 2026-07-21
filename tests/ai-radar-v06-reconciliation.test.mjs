import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyCurrentAgainstV06,
  reconcileVerifiedEvents,
  selectLatestRuns,
} from '../scripts/radar/audit-ai-radar-v06-reconciliation-v01.mjs'

function radar(grade, batch = 'RADAR-ASSESS-0001') {
  return {
    confidencePercent: 80,
    evidenceCoveragePercent: 70,
    evidenceStatus: 'multiple_secondary_supported',
    sourceSummary: 'Two traceable sources.',
    policyVersion: 'radar-rating-policy-v0.4-draft',
    assessedAt: '2026-07-15T00:00:00.000Z',
    assessmentBatch: batch,
    suggestedGrade: grade,
    decisiveRuleCode: 'R-A-01',
    decisiveRuleReason: 'fixture',
    matchedRules: [],
    sourceCount: 2,
    contradictions: [],
    requiresHumanReview: true,
  }
}

function event({ workId = '1', grade = 'B', batchId = 'RADAR-ASSESS-0001', generatedAt = '2026-07-15T00:00:00.000Z' } = {}) {
  return {
    evidenceKind: 'applied_and_verified',
    workId,
    targetId: workId,
    batchId,
    generatedAt,
    summaryFile: 'summary.json',
    planFile: 'plan.jsonl',
    plan: {
      workId,
      siteId: `site-${workId}`,
      title: `Work ${workId}`,
      target: { id: workId, siteId: `site-${workId}` },
      patch: { radarAssessment: radar(grade, batchId) },
    },
    appliedRow: { workId, targetId: workId },
  }
}

test('selects the latest execute run for each batch', () => {
  const selected = selectLatestRuns([
    { batchId: 'RADAR-ASSESS-0001', generatedAt: '2026-07-15T00:00:00Z', payloadPatchRequests: 1 },
    { batchId: 'RADAR-ASSESS-0001', generatedAt: '2026-07-15T01:00:00Z', payloadPatchRequests: 250 },
    { batchId: 'RADAR-ASSESS-0002', generatedAt: '2026-07-15T00:30:00Z', payloadPatchRequests: 250 },
  ])
  assert.equal(selected.length, 2)
  assert.equal(selected[0].payloadPatchRequests, 250)
  assert.equal(selected[1].batchId, 'RADAR-ASSESS-0002')
})

test('classifies exact, missing, and diverged current states', () => {
  const applied = event()
  assert.equal(
    classifyCurrentAgainstV06({ id: '1', radarAssessment: radar('B') }, applied),
    'current_matches_v06_exact',
  )
  assert.equal(
    classifyCurrentAgainstV06({ id: '1', radarAssessment: {} }, applied),
    'current_missing_after_verified_apply',
  )
  assert.equal(
    classifyCurrentAgainstV06({ id: '1', radarAssessment: radar('C', 'RADAR-ASSESS-0099') }, applied),
    'current_has_other_formal_conclusion',
  )
})

test('does not confuse a partial radar object with a formal conclusion', () => {
  const applied = event()
  const work = {
    id: '1',
    radarAssessment: {
      sourceSummary: 'Some scan trace exists.',
      evidenceStatus: 'insufficient_evidence',
    },
  }
  assert.equal(classifyCurrentAgainstV06(work, applied), 'current_scanned_without_valid_conclusion')
})

test('reconciles one latest verified event per work', () => {
  const older = event({ generatedAt: '2026-07-15T00:00:00Z' })
  const newer = event({ generatedAt: '2026-07-15T01:00:00Z' })
  const rows = reconcileVerifiedEvents(
    [{ id: '1', siteId: 'site-1', title: 'Work 1', radarAssessment: {} }],
    [{ events: [older] }, { events: [newer] }],
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].executeGeneratedAt, '2026-07-15T01:00:00Z')
  assert.equal(rows[0].status, 'current_missing_after_verified_apply')
  assert.equal(rows[0].expectedSuggestedGrade, 'B')
})
