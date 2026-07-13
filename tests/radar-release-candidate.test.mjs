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
    sourceAuditSummary: {
      rowsRead: 100,
      blocked: 0,
      warningsOnly: 6,
      clean: 94,
      rowsWithDeclaredCountMismatch: 0,
    },
    checkpointManifest: {
      includesDatabase: true,
      includesWorkspace: true,
      includesGitBundle: true,
      branch: 'wm-ai-radar-release-candidate-v01',
      commit: 'abc123',
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
    currentBranch: 'wm-ai-radar-release-candidate-v01',
    currentCommit: 'abc123',
    ...overrides,
  }
}

test('release candidate accepts the reviewed 100/94/6 state with a readable dump archive', () => {
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

test('release candidate requires the checkpoint branch and commit to match', () => {
  const result = validateReleaseCandidateInputs(validInputs({ currentCommit: 'different' }))
  assert.ok(result.includes('checkpoint_commit_mismatch'))
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

test('release manifest stores only the approval-token fingerprint', () => {
  const manifest = buildReleaseCandidateManifest({
    planFile: 'plan.jsonl',
    planHash,
    dryRunFile: 'dryrun.json',
    dryRunHash: 'd'.repeat(64),
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
    currentBranch: 'wm-ai-radar-release-candidate-v01',
    currentCommit: 'abc123',
    dryRunSummary: validInputs().dryRunSummary,
    sourceAuditSummary: validInputs().sourceAuditSummary,
  })

  assert.equal(manifest.approval.tokenStored, false)
  assert.equal(manifest.approval.tokenFingerprintSha256, approvalTokenFingerprint(planHash))
  assert.equal(JSON.stringify(manifest).includes('APPLY-AI-RADAR-FIRST-100'), false)
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
