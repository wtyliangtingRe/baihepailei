import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  approvalTokenFingerprint,
  buildDisarmedLocalGate,
  buildReleaseCandidateManifest,
  validateReleaseCandidateInputs,
} from '../scripts/radar/lib/release-candidate-v01.mjs'

const planHash = 'a'.repeat(64)
const dumpHash = 'b'.repeat(64)
const checksumHash = 'c'.repeat(64)
const branch = 'wm-ai-radar-release-candidate-v01'
const commit = 'abc123'
const checkpointPath = 'D:\\Baihepailei-backups\\Baihepailei-test'

function validInputs(overrides = {}) {
  return {
    planHash,
    dryRunSummary: {
      version: 'ai-radar-payload-patch-dryrun-v0.1',
      inputSha256: planHash,
      planRowsRead: 100,
      wouldUpdate: 94,
      blocked: 6,
      alreadyCurrent: 0,
      safety: { payloadWrite: false, payloadPatchRequests: 0 },
    },
    readinessSummary: {
      version: 'ai-radar-payload-apply-v0.1',
      mode: 'readiness',
      currentBranch: branch,
      currentCommit: commit,
      planSha256: planHash,
      checkpointPath,
      planRowsRead: 100,
      readyPlanRows: 94,
      protectedPlanRows: 6,
      preflightRowsChecked: 94,
      preflightReadyRows: 94,
      preflightBlockedRows: 0,
      preflightReady: true,
      executionReady: false,
      payloadPatchRequests: 0,
      appliedAndVerified: 0,
      staticBlockers: [],
      safety: { payloadWrite: false },
    },
    sourceAuditSummary: {
      rowsRead: 100,
      blocked: 0,
      warningsOnly: 6,
      clean: 94,
      rowsWithDeclaredCountMismatch: 0,
    },
    checkpointPath,
    checkpointManifest: {
      includesDatabase: true,
      includesWorkspace: true,
      includesGitBundle: true,
      branch,
      commit,
    },
    checkpointStatus: { state: 'complete' },
    checkpointDumpSize: 12345,
    checkpointDumpHash: dumpHash,
    checkpointChecksumHash: checksumHash,
    restoreVerification: {
      verified: true,
      dumpSha256: dumpHash,
      listEntryCount: 123,
      pgRestoreVersion: 'pg_restore (PostgreSQL) 17.10',
    },
    currentBranch: branch,
    currentCommit: commit,
    ...overrides,
  }
}

test('release candidate accepts the reviewed 100/94/6 state with final readiness and a readable dump archive', () => {
  assert.deepEqual(validateReleaseCandidateInputs(validInputs()), [])
})

test('release candidate blocks source provenance regressions and unreadable dumps', () => {
  const sourceBlocked = validInputs({
    sourceAuditSummary: {
      ...validInputs().sourceAuditSummary,
      blocked: 1,
      clean: 93,
    },
  })
  assert.ok(validateReleaseCandidateInputs(sourceBlocked).includes('source_audit_has_blockers'))

  const unreadable = validInputs({
    restoreVerification: {
      ...validInputs().restoreVerification,
      verified: false,
      listEntryCount: 0,
    },
  })
  const blockers = validateReleaseCandidateInputs(unreadable)
  assert.ok(blockers.includes('database_restore_listing_not_verified'))
  assert.ok(blockers.includes('restore_verification_has_no_entries'))
})

test('release candidate requires checkpoint and readiness to match the final branch and commit', () => {
  const result = validateReleaseCandidateInputs(validInputs({ currentCommit: 'different' }))
  assert.ok(result.includes('checkpoint_commit_mismatch'))
  assert.ok(result.includes('readiness_commit_mismatch'))
})

test('release candidate refuses a readiness summary with writes or blocked preflight rows', () => {
  const invalid = validInputs({
    readinessSummary: {
      ...validInputs().readinessSummary,
      preflightBlockedRows: 1,
      preflightReadyRows: 93,
      payloadPatchRequests: 1,
      safety: { payloadWrite: true },
    },
  })
  const blockers = validateReleaseCandidateInputs(invalid)
  assert.ok(blockers.includes('readiness_has_blocked_rows'))
  assert.ok(blockers.includes('readiness_write_detected'))
  assert.ok(blockers.includes('readiness_payload_write_safety_mismatch'))
})

test('generated local release gate is always disarmed and stores no approval token', () => {
  const gate = buildDisarmedLocalGate({
    writeEnabled: true,
    approvalToken: 'SHOULD-BE-CLEARED',
    requirements: { sourceProvenanceAuditReviewed: false },
  }, { planHash })

  assert.equal(gate.writeEnabled, false)
  assert.equal(gate.approvalToken, null)
  assert.equal(gate.localOnly, true)
  assert.equal(gate.requirements.sourceProvenanceAuditReviewed, true)
  assert.equal(gate.planSha256, planHash)
})

test('release manifest binds final readiness and stores only the approval-token fingerprint', () => {
  const manifest = buildReleaseCandidateManifest({
    planFile: 'plan.jsonl',
    planHash,
    dryRunFile: 'dryrun.json',
    dryRunHash: 'd'.repeat(64),
    readinessFile: 'readiness.json',
    readinessHash: '3'.repeat(64),
    readinessSummary: validInputs().readinessSummary,
    sourceAuditFile: 'source.json',
    sourceAuditHash: 'e'.repeat(64),
    checkpointPath: 'checkpoint',
    checkpointManifestHash: 'f'.repeat(64),
    checkpointStatusHash: '1'.repeat(64),
    checkpointChecksumsHash: checksumHash,
    checkpointDumpFile: 'checkpoint/payload-postgresql.dump',
    checkpointDumpHash: dumpHash,
    checkpointDumpSize: 12345,
    restoreVerificationFile: 'restore.json',
    restoreVerificationHash: '2'.repeat(64),
    restoreVerification: validInputs().restoreVerification,
    currentBranch: branch,
    currentCommit: commit,
    dryRunSummary: validInputs().dryRunSummary,
    sourceAuditSummary: validInputs().sourceAuditSummary,
  })

  assert.equal(manifest.approval.tokenStored, false)
  assert.equal(manifest.approval.tokenFingerprintSha256, approvalTokenFingerprint(planHash))
  assert.equal(JSON.stringify(manifest).includes('APPLY-AI-RADAR-FIRST-100'), false)
  assert.equal(manifest.files.readinessSummary.sha256, '3'.repeat(64))
  assert.equal(manifest.reviewedState.readiness.readyRows, 94)
  assert.equal(manifest.reviewedState.readiness.executionReady, false)
  assert.equal(manifest.safety.payloadWrite, false)
})

test('release preparation and restore verification remain read-only', () => {
  const prepare = readFileSync('scripts/radar/prepare-ai-radar-release-candidate-v01.mjs', 'utf8')
  const verify = readFileSync('scripts/backup/verify-local-database-checkpoint.ps1', 'utf8')

  assert.match(prepare, /Arm\/execute\/approval flags are rejected/u)
  assert.doesNotMatch(prepare, /method:\s*['"]PATCH['"]/u)
  assert.match(verify, /pg_restore --list/u)
  assert.match(verify, /restoreExecuted = \$false/u)
  assert.match(verify, /elseif \(Test-RunningContainer/u)
  assert.doesNotMatch(verify, /\belif\b/u)
})
