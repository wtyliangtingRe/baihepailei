import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { approvalTokenFor } from '../scripts/radar/lib/payload-apply-v01.mjs'
import {
  DEFAULT_ARM_TTL_MINUTES,
  LOCAL_ARM_CONFIRMATION,
  buildArmedLocalGate,
  expectedExecuteConfirmation,
  localRuntimePath,
  validateArmInputs,
  validateArmedLocalGate,
} from '../scripts/radar/lib/local-arm-v01.mjs'
import { approvalTokenFingerprint } from '../scripts/radar/lib/release-candidate-v01.mjs'

const planHash = 'a'.repeat(64)
const manifestHash = 'b'.repeat(64)
const branch = 'wm-ai-radar-local-arm-v01'
const commit = 'abc123'
const checkpointPath = 'D:\\Baihepailei-backups\\Baihepailei-test'
const token = approvalTokenFor(planHash)
const candidateId = 'RC-1234567890ABCDEF1234'

function hashes() {
  return {
    plan: planHash,
    dryRunSummary: 'c'.repeat(64),
    readinessSummary: 'd'.repeat(64),
    sourceAuditSummary: 'e'.repeat(64),
    checkpointManifest: 'f'.repeat(64),
    checkpointStatus: '1'.repeat(64),
    checkpointChecksums: '2'.repeat(64),
    checkpointDump: '3'.repeat(64),
    restoreVerification: '4'.repeat(64),
  }
}

function manifest() {
  const h = hashes()
  return {
    version: 'ai-radar-release-candidate-v0.1',
    batchId: 'ai-radar-first-100-v01',
    candidateId,
    currentBranch: branch,
    currentCommit: commit,
    expected: { rows: 100, wouldUpdate: 94, protected: 6, alreadyCurrent: 0 },
    files: {
      plan: { path: 'data_local/plan.jsonl', sha256: h.plan },
      dryRunSummary: { path: 'data_local/dryrun.json', sha256: h.dryRunSummary },
      readinessSummary: { path: 'data_local/readiness.json', sha256: h.readinessSummary },
      sourceAuditSummary: { path: 'data_local/source.json', sha256: h.sourceAuditSummary },
      checkpointManifest: { path: `${checkpointPath}\\checkpoint-manifest.json`, sha256: h.checkpointManifest },
      checkpointStatus: { path: `${checkpointPath}\\checkpoint-status.json`, sha256: h.checkpointStatus },
      checkpointChecksums: { path: `${checkpointPath}\\sha256-checksums.csv`, sha256: h.checkpointChecksums },
      checkpointDump: { path: `${checkpointPath}\\payload-postgresql.dump`, sha256: h.checkpointDump, sizeBytes: 123 },
      restoreVerification: { path: 'data_local/restore.json', sha256: h.restoreVerification },
    },
    reviewedState: {
      readiness: {
        readyRows: 94,
        blockedRows: 0,
        preflightReady: true,
        executionReady: false,
        payloadPatchRequests: 0,
      },
    },
    approval: {
      required: true,
      tokenStored: false,
      tokenFingerprintSha256: approvalTokenFingerprint(planHash),
      finalApprovalReceived: false,
    },
    safety: { payloadWrite: false, payloadPatchRequests: 0 },
  }
}

function validArmInputs(overrides = {}) {
  return {
    manifest: manifest(),
    manifestHash,
    actualHashes: hashes(),
    checkpointPath,
    currentBranch: branch,
    currentCommit: commit,
    approvalToken: token,
    confirmation: LOCAL_ARM_CONFIRMATION,
    ttlMinutes: DEFAULT_ARM_TTL_MINUTES,
    ...overrides,
  }
}

test('local arm accepts only the exact candidate, files, token and confirmation', () => {
  assert.deepEqual(validateArmInputs(validArmInputs()), [])
})

test('local arm blocks altered files, wrong token and ambiguous confirmation', () => {
  const altered = validateArmInputs(validArmInputs({
    actualHashes: { ...hashes(), checkpointDump: '9'.repeat(64) },
    approvalToken: 'WRONG',
    confirmation: 'yes',
  }))
  assert.ok(altered.includes('candidate_file_hash_mismatch:checkpointDump'))
  assert.ok(altered.includes('local_arm_approval_token_mismatch'))
  assert.ok(altered.includes('local_arm_confirmation_mismatch'))
})

test('armed local gate is candidate-bound and expires automatically', () => {
  const now = Date.parse('2026-07-14T00:00:00.000Z')
  const gate = buildArmedLocalGate(manifest(), {
    manifestHash,
    checkpointPath,
    approvalToken: token,
    currentBranch: branch,
    currentCommit: commit,
    now,
    ttlMinutes: 30,
  })

  assert.equal(gate.writeEnabled, true)
  assert.equal(gate.localOnly, true)
  assert.equal(gate.candidateManifestSha256, manifestHash)
  assert.equal(gate.executeConfirmationRequired, `EXECUTE-${candidateId}-94-PATCHES`)
  assert.deepEqual(validateArmedLocalGate({
    gate,
    manifest: manifest(),
    manifestHash,
    planHash,
    checkpointPath,
    currentBranch: branch,
    currentCommit: commit,
    approvalToken: token,
    now: now + 5 * 60 * 1000,
  }), [])

  const expired = validateArmedLocalGate({
    gate,
    manifest: manifest(),
    manifestHash,
    planHash,
    checkpointPath,
    currentBranch: branch,
    currentCommit: commit,
    approvalToken: token,
    now: now + 31 * 60 * 1000,
  })
  assert.ok(expired.includes('local_gate_expired'))
})

test('execution confirmation is candidate-specific', () => {
  assert.equal(expectedExecuteConfirmation(candidateId), `EXECUTE-${candidateId}-94-PATCHES`)
  assert.throws(() => expectedExecuteConfirmation('RC-WRONG'))
})

test('runtime paths collapse repeated separators', () => {
  const normalized = localRuntimePath('D:\\\\Baihepailei-backups\\Baihepailei-test')
  if (process.platform === 'win32') assert.equal(normalized, 'D:\\Baihepailei-backups\\Baihepailei-test')
  else assert.equal(normalized, 'D:/Baihepailei-backups/Baihepailei-test')
})

test('arming command cannot execute and apply requires a local manifest-bound gate', () => {
  const armSource = readFileSync('scripts/radar/arm-ai-radar-release-candidate-v01.mjs', 'utf8')
  const applySource = readFileSync('scripts/radar/apply-ai-radar-payload-patches-v01.mjs', 'utf8')

  assert.match(armSource, /only arms a local gate/u)
  assert.doesNotMatch(armSource, /method:\s*['"]PATCH['"]/u)
  assert.match(armSource, /output must remain under ignored data_local/u)
  assert.match(applySource, /execute_requires_local_armed_gate/u)
  assert.match(applySource, /local_gate_candidate_manifest_required/u)
  assert.match(applySource, /explicit_execute_confirmation_mismatch/u)
  assert.match(applySource, /armedGateAutoExpires: true/u)
})
