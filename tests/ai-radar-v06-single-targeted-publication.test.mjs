import test from 'node:test'
import assert from 'node:assert/strict'

import {
  targetedPublicationExpectations,
  targetedPublicationPublishedState,
  targetedPublicationSha256,
} from '../scripts/radar/dryrun-ai-radar-v06-targeted-publication-v01.mjs'
import {
  SINGLE_ARM_CONFIRMATION,
  approvalTokenForCandidate,
  buildSingleGate,
  executeConfirmationFor,
  selectSingleReadyRow,
  validateCurrentForSingleExecution,
  validateReadyDryRunRow,
  validateSingleGate,
  verifySingleExecution,
} from '../scripts/radar/lib/v06-single-targeted-publication-v01.mjs'

function fixture() {
  const radarAssessment = {
    suggestedGrade: 'B',
    confidencePercent: 82,
    evidenceCoveragePercent: 72,
    evidenceStatus: 'single_secondary_supported',
    sourceSummary: 'traceable summary',
    policyVersion: 'radar-rating-policy-v0.4-draft',
    assessedAt: '2026-07-01T00:00:00.000Z',
    assessmentBatch: 'RADAR-ASSESS-0001',
    decisiveRuleCode: 'B-SAFE',
    decisiveRuleReason: 'fixture',
    matchedRules: [],
    sourceCount: 1,
    contradictions: [],
    requiresHumanReview: true,
  }
  const published = {
    id: '101',
    siteId: 'work:101',
    title: 'Fixture Work',
    _status: 'published',
    rank: 'unknown',
    ratingNotice: 'none',
    reviewStatus: 'pending',
    reviewReasons: [],
    evidenceStrength: 'unassessed',
    radarAssessment: {},
    humanAssessment: null,
    humanReviewNote: null,
    humanReviewedAt: null,
    humanReviewedBy: null,
  }
  const patch = {
    _status: 'published',
    radarAssessment,
    rank: 'B',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['radar_seed_attached'],
    evidenceStrength: 'weak',
  }
  const latestDraft = { ...published, ...patch }
  const observedBefore = targetedPublicationExpectations(published, latestDraft)
  const after = { ...published, ...patch }
  const changedFields = ['evidenceStrength', 'radarAssessment', 'rank', 'ratingNotice', 'reviewReasons']
  const row = {
    version: 'ai-radar-v06-targeted-publication-dryrun-v0.1',
    dryRunStatus: 'ready_for_targeted_publication',
    workId: '101',
    target: { id: '101', siteId: 'work:101', title: 'Fixture Work' },
    patch,
    patchSha256: targetedPublicationSha256(patch),
    changedFields,
    observedBefore,
    simulatedAfter: {
      publishedState: targetedPublicationPublishedState(after),
      publishedStateSha256: targetedPublicationSha256(targetedPublicationPublishedState(after)),
      humanStateSha256: observedBefore.humanStateSha256,
      radarAssessmentSha256: targetedPublicationSha256(radarAssessment),
    },
    humanTrackRecorded: false,
    wholeDraftPublicationForbidden: true,
    payloadPatchSimulatedOnly: true,
    blockers: [],
    warnings: [],
  }
  const candidate = {
    version: 'ai-radar-v06-single-targeted-publication-candidate-v0.1',
    candidateId: 'RC-V06-SINGLE-1234567890ABCDEF1234',
    currentBranch: 'main',
    currentCommit: 'abc',
    checkpointPath: 'd:/backup',
    target: row.target,
    expected: {
      workId: row.workId,
      changedFields,
      patch,
      patchSha256: row.patchSha256,
      observedBefore,
      simulatedAfter: row.simulatedAfter,
      humanTrackRecorded: false,
    },
    sourceDryRunRow: row,
    files: { dryRun: { sha256: 'a'.repeat(64) } },
  }
  candidate.executeConfirmationRequired = executeConfirmationFor(candidate)
  return { published, latestDraft, patch, row, candidate, after }
}

test('accepts a valid ready row and deterministic selection', () => {
  const { row } = fixture()
  assert.deepEqual(validateReadyDryRunRow(row), [])
  assert.equal(selectSingleReadyRow([{ ...row, workId: '202', target: { ...row.target, id: '202' } }, row]).workId, '101')
  assert.equal(selectSingleReadyRow([row], 'work:101').workId, '101')
})

test('rejects unrelated or human-assessment patch fields', () => {
  const { row } = fixture()
  const bad = {
    ...row,
    patch: { ...row.patch, title: 'should never publish', humanAssessment: { grade: 'S' } },
  }
  bad.patchSha256 = targetedPublicationSha256(bad.patch)
  const blockers = validateReadyDryRunRow(bad)
  assert.ok(blockers.includes('single_patch_unexpected_field:title'))
  assert.ok(blockers.includes('single_patch_human_assessment_forbidden'))
})

test('validates unchanged current state and blocks drift', () => {
  const { published, latestDraft, candidate } = fixture()
  const ready = validateCurrentForSingleExecution(candidate, published, latestDraft)
  assert.equal(ready.status, 'ready_to_execute_once')
  assert.deepEqual(ready.blockers, [])

  const drifted = validateCurrentForSingleExecution(candidate, { ...published, title: 'Changed title' }, latestDraft)
  assert.equal(drifted.status, 'blocked')
  assert.ok(drifted.blockers.includes('single_execute_published_state_drift'))
})

test('recognizes an already-published row without another write', () => {
  const { after, latestDraft, candidate } = fixture()
  const result = validateCurrentForSingleExecution(candidate, after, latestDraft)
  assert.equal(result.status, 'already_published')
  assert.deepEqual(result.blockers, [])
})

test('verifies exact post-write state and human-track immutability', () => {
  const { published, after, candidate } = fixture()
  const verified = verifySingleExecution(candidate, published, after, after)
  assert.equal(verified.verified, true)
  assert.deepEqual(verified.blockers, [])

  const changedHuman = { ...after, humanAssessment: { grade: 'A', status: 'reviewed' } }
  const failed = verifySingleExecution(candidate, published, changedHuman, changedHuman)
  assert.equal(failed.verified, false)
  assert.ok(failed.blockers.includes('single_verify_human_state_changed'))
})

test('uses a short-lived gate bound to candidate, token, and confirmation', () => {
  const { candidate } = fixture()
  const token = approvalTokenForCandidate(candidate)
  const now = Date.parse('2026-07-21T08:00:00.000Z')
  const gate = buildSingleGate(candidate, {
    candidateManifestSha256: 'b'.repeat(64),
    approvalToken: token,
    ttlMinutes: 30,
    now,
  })
  assert.equal(gate.executeConfirmationRequired, executeConfirmationFor(candidate))
  assert.equal(SINGLE_ARM_CONFIRMATION, 'ARM-AI-RADAR-V06-SINGLE-TARGETED-PUBLICATION')
  assert.deepEqual(validateSingleGate(gate, candidate, {
    candidateManifestSha256: 'b'.repeat(64),
    approvalToken: token,
    now: now + 1_000,
  }), [])
  assert.ok(validateSingleGate(gate, candidate, {
    candidateManifestSha256: 'b'.repeat(64),
    approvalToken: 'wrong',
    now: now + 1_000,
  }).includes('single_gate_approval_token_mismatch'))
  assert.ok(validateSingleGate(gate, candidate, {
    candidateManifestSha256: 'b'.repeat(64),
    approvalToken: token,
    now: now + 31 * 60 * 1000,
  }).includes('single_gate_expired'))
})
