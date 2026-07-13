import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateReleaseGate } from '../scripts/radar/check-ai-radar-release-gate-v01.mjs'

const REQUIRED_KEYS = [
  'allRowsHaveAssessment',
  'allMissingEvidenceRowsResearched',
  'allIdentityConflictsReviewedOrExplicitlyBlocked',
  'allRowsHaveConfidence',
  'allRowsHaveEvidenceCoverage',
  'allRowsHaveEvidenceStatus',
  'allRowsHavePageNotice',
  'allRowsHaveSourceSummary',
  'allRowsHaveReviewStatus',
  'allRuleConflictsAudited',
  'humanVerifiedRowsRemainProtected',
  'xRowsRequireHumanAdjudication',
  'payloadPatchPlanReviewed',
  'payloadApplyDryRunReviewed',
]

function completeRequirements(value = true) {
  return Object.fromEntries(REQUIRED_KEYS.map((key) => [key, value]))
}

function gate(overrides = {}) {
  return {
    expectedRows: 100,
    writeEnabled: false,
    userApprovalRequired: true,
    approvalToken: 'approved-token',
    requirements: completeRequirements(true),
    ...overrides,
  }
}

function summary(overrides = {}) {
  return {
    rows: 100,
    approvalToken: 'approved-token',
    payloadWrite: false,
    directPostgresqlWrite: false,
    writeEligibleRows: 0,
    requirements: completeRequirements(true),
    ...overrides,
  }
}

test('a disabled gate blocks release even when all batch metrics are complete', () => {
  const result = evaluateReleaseGate(gate(), summary())
  assert.equal(result.releaseReady, false)
  assert.ok(result.blockers.includes('release_gate_write_disabled'))
})

test('missing approval token blocks release', () => {
  const result = evaluateReleaseGate(
    gate({ approvalToken: null }),
    summary({ approvalToken: null }),
  )
  assert.equal(result.releaseReady, false)
  assert.ok(result.blockers.includes('explicit_user_approval_token_missing'))
})

test('an incomplete required review blocks release', () => {
  const requirements = completeRequirements(true)
  requirements.payloadApplyDryRunReviewed = false
  const result = evaluateReleaseGate(gate({ writeEnabled: true }), summary({ requirements }))
  assert.equal(result.releaseReady, false)
  assert.ok(result.blockers.includes('requirement_not_met:payloadApplyDryRunReviewed'))
})

test('write-eligible rows are rejected while the gate is disabled', () => {
  const result = evaluateReleaseGate(gate(), summary({ writeEligibleRows: 3 }))
  assert.equal(result.releaseReady, false)
  assert.ok(result.blockers.includes('write_eligible_rows_present_while_gate_disabled'))
})

test('release can only pass with enabled gate, matching approval and every review complete', () => {
  const result = evaluateReleaseGate(
    gate({ writeEnabled: true }),
    summary(),
  )
  assert.deepEqual(result, {
    releaseReady: true,
    blockers: [],
    warnings: [],
  })
})
