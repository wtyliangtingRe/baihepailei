import assert from 'node:assert/strict'
import test from 'node:test'

import { validateReadinessForArmMode } from '../scripts/radar/lib/v06-batch-resume-v01.mjs'

const manifest = {
  candidateId: 'RC-V06-0123456789ABCDEF0123',
  expected: { wouldUpdate: 200 },
}

function readiness(overrides = {}) {
  return {
    version: 'ai-radar-v06-batch-apply-v0.1',
    mode: 'readiness',
    candidateId: manifest.candidateId,
    candidateManifestSha256: 'a'.repeat(64),
    currentBranch: 'release-branch',
    currentCommit: 'release-commit',
    pendingOriginal: 150,
    alreadyApplied: 50,
    drifted: 0,
    preflightReady: true,
    payloadPatchRequests: 0,
    appliedAndVerified: 0,
    safety: { payloadWrite: false },
    ...overrides,
  }
}

const options = {
  manifestHash: 'a'.repeat(64),
  currentBranch: 'release-branch',
  currentCommit: 'release-commit',
  resume: true,
}

test('resume re-arming accepts only an exact partial applied plus pending partition', () => {
  assert.deepEqual(validateReadinessForArmMode(readiness(), manifest, options), [])
})

test('resume re-arming rejects drift, missing applied rows and count mismatch', () => {
  assert.ok(validateReadinessForArmMode(readiness({ drifted: 1 }), manifest, options).includes('resume_readiness_preflight_not_clean'))
  assert.ok(validateReadinessForArmMode(readiness({ alreadyApplied: 0, pendingOriginal: 200 }), manifest, options).includes('resume_readiness_has_no_already_applied_rows'))
  assert.ok(validateReadinessForArmMode(readiness({ alreadyApplied: 49 }), manifest, options).includes('resume_readiness_count_mismatch'))
})
