import { createHash } from 'node:crypto'
import fs from 'node:fs'

import { approvalTokenFor, readJson, sha256File } from './payload-apply-v01.mjs'
import { unique, val } from './payload-plan-v01.mjs'

export const RELEASE_CANDIDATE_VERSION = 'ai-radar-release-candidate-v0.1'
export const RELEASE_CANDIDATE_BATCH_ID = 'ai-radar-first-100-v01'

export function sha256Text(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    )
  }
  return value
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

export function approvalTokenFingerprint(planHash) {
  return sha256Text(approvalTokenFor(planHash, RELEASE_CANDIDATE_BATCH_ID))
}

export function validateReleaseCandidateInputs({
  planHash,
  dryRunSummary,
  sourceAuditSummary,
  checkpointManifest,
  checkpointStatus,
  checkpointDumpSize,
  checkpointDumpHash,
  checkpointChecksumHash,
  restoreVerification,
  currentBranch,
  currentCommit,
  expectedRows = 100,
  expectedWrites = 94,
  expectedProtected = 6,
} = {}) {
  const blockers = []

  if (!/^[a-f0-9]{64}$/u.test(val(planHash))) blockers.push('invalid_plan_sha256')

  if (val(dryRunSummary?.version) !== 'ai-radar-payload-patch-dryrun-v0.1') blockers.push('unexpected_dryrun_version')
  if (val(dryRunSummary?.inputSha256) !== val(planHash)) blockers.push('dryrun_plan_hash_mismatch')
  if (Number(dryRunSummary?.planRowsRead) !== expectedRows) blockers.push('dryrun_row_count_mismatch')
  if (Number(dryRunSummary?.wouldUpdate) !== expectedWrites) blockers.push('dryrun_would_update_count_mismatch')
  if (Number(dryRunSummary?.blocked) !== expectedProtected) blockers.push('dryrun_protected_count_mismatch')
  if (Number(dryRunSummary?.alreadyCurrent) !== 0) blockers.push('dryrun_already_current_not_zero')
  if (dryRunSummary?.safety?.payloadWrite !== false || Number(dryRunSummary?.safety?.payloadPatchRequests) !== 0) {
    blockers.push('dryrun_write_safety_mismatch')
  }

  if (Number(sourceAuditSummary?.rowsRead) !== expectedRows) blockers.push('source_audit_row_count_mismatch')
  if (Number(sourceAuditSummary?.blocked) !== 0) blockers.push('source_audit_has_blockers')
  if (Number(sourceAuditSummary?.rowsWithDeclaredCountMismatch) !== 0) blockers.push('source_audit_count_mismatch_remaining')
  if (Number(sourceAuditSummary?.clean || 0) + Number(sourceAuditSummary?.warningsOnly || 0) !== expectedRows) {
    blockers.push('source_audit_status_total_mismatch')
  }

  if (val(checkpointStatus?.state) !== 'complete') blockers.push('checkpoint_not_complete')
  if (checkpointManifest?.includesDatabase !== true) blockers.push('checkpoint_database_not_included')
  if (checkpointManifest?.includesWorkspace !== true) blockers.push('checkpoint_workspace_not_included')
  if (checkpointManifest?.includesGitBundle !== true) blockers.push('checkpoint_git_bundle_not_included')
  if (val(checkpointManifest?.branch) !== val(currentBranch)) blockers.push('checkpoint_branch_mismatch')
  if (val(checkpointManifest?.commit) !== val(currentCommit)) blockers.push('checkpoint_commit_mismatch')
  if (!Number.isFinite(Number(checkpointDumpSize)) || Number(checkpointDumpSize) <= 0) blockers.push('checkpoint_dump_empty')
  if (!/^[a-f0-9]{64}$/u.test(val(checkpointDumpHash).toLowerCase())) blockers.push('invalid_checkpoint_dump_sha256')
  if (!/^[a-f0-9]{64}$/u.test(val(checkpointChecksumHash).toLowerCase())) blockers.push('invalid_checkpoint_checksums_sha256')

  if (restoreVerification?.verified !== true) blockers.push('database_restore_listing_not_verified')
  if (val(restoreVerification?.dumpSha256).toLowerCase() !== val(checkpointDumpHash).toLowerCase()) {
    blockers.push('restore_verification_dump_hash_mismatch')
  }
  if (Number(restoreVerification?.listEntryCount) <= 0) blockers.push('restore_verification_has_no_entries')

  return unique(blockers)
}

export function buildDisarmedLocalGate(baseGate, { planHash } = {}) {
  const gate = structuredClone(baseGate || {})
  gate.version = 'ai-radar-local-release-gate-v0.1'
  gate.batchId = RELEASE_CANDIDATE_BATCH_ID
  gate.expectedRows = 100
  gate.writeEnabled = false
  gate.userApprovalRequired = true
  gate.approvalToken = null
  gate.requirements = {
    ...(gate.requirements || {}),
    payloadPatchPlanReviewed: true,
    payloadApplyDryRunReviewed: true,
    sourceProvenanceAuditReviewed: true,
  }
  gate.localOnly = true
  gate.planSha256 = val(planHash)
  gate.notes = [
    'Local release gate generated in disarmed state.',
    'Do not set writeEnabled or add an approval token without a separate explicit final approval.',
    'This file belongs under data_local and must never be committed.',
  ]
  return gate
}

export function buildReleaseCandidateManifest({
  planFile,
  planHash,
  dryRunFile,
  dryRunHash,
  sourceAuditFile,
  sourceAuditHash,
  checkpointPath,
  checkpointManifestHash,
  checkpointStatusHash,
  checkpointChecksumsHash,
  checkpointDumpFile,
  checkpointDumpHash,
  checkpointDumpSize,
  restoreVerificationFile,
  restoreVerificationHash,
  restoreVerification,
  currentBranch,
  currentCommit,
  dryRunSummary,
  sourceAuditSummary,
} = {}) {
  const candidateMaterial = stableJson({
    planHash,
    dryRunHash,
    sourceAuditHash,
    checkpointManifestHash,
    checkpointStatusHash,
    checkpointChecksumsHash,
    checkpointDumpHash,
    restoreVerificationHash,
    currentBranch,
    currentCommit,
  })

  return {
    generatedAt: new Date().toISOString(),
    version: RELEASE_CANDIDATE_VERSION,
    batchId: RELEASE_CANDIDATE_BATCH_ID,
    candidateId: `RC-${sha256Text(candidateMaterial).slice(0, 20).toUpperCase()}`,
    currentBranch,
    currentCommit,
    expected: {
      rows: 100,
      wouldUpdate: 94,
      protected: 6,
      alreadyCurrent: 0,
      sourceAuditBlocked: 0,
    },
    files: {
      plan: { path: planFile, sha256: planHash },
      dryRunSummary: { path: dryRunFile, sha256: dryRunHash },
      sourceAuditSummary: { path: sourceAuditFile, sha256: sourceAuditHash },
      checkpointManifest: { path: `${checkpointPath}/checkpoint-manifest.json`, sha256: checkpointManifestHash },
      checkpointStatus: { path: `${checkpointPath}/checkpoint-status.json`, sha256: checkpointStatusHash },
      checkpointChecksums: { path: `${checkpointPath}/sha256-checksums.csv`, sha256: checkpointChecksumsHash },
      checkpointDump: { path: checkpointDumpFile, sha256: checkpointDumpHash, sizeBytes: checkpointDumpSize },
      restoreVerification: { path: restoreVerificationFile, sha256: restoreVerificationHash },
    },
    reviewedState: {
      dryRun: {
        rows: Number(dryRunSummary?.planRowsRead),
        wouldUpdate: Number(dryRunSummary?.wouldUpdate),
        protected: Number(dryRunSummary?.blocked),
        alreadyCurrent: Number(dryRunSummary?.alreadyCurrent),
      },
      sourceProvenance: {
        rows: Number(sourceAuditSummary?.rowsRead),
        blocked: Number(sourceAuditSummary?.blocked),
        warningsOnly: Number(sourceAuditSummary?.warningsOnly),
        clean: Number(sourceAuditSummary?.clean),
      },
      databaseRestoreListing: {
        verified: restoreVerification?.verified === true,
        listEntryCount: Number(restoreVerification?.listEntryCount || 0),
        pgRestoreVersion: val(restoreVerification?.pgRestoreVersion),
      },
    },
    approval: {
      required: true,
      tokenStored: false,
      tokenFingerprintSha256: approvalTokenFingerprint(planHash),
      finalApprovalReceived: false,
    },
    safety: {
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      checkedInGateRemainsDisabled: true,
      localGateGeneratedDisarmed: true,
      requiresFreshCheckpointForThisCommit: true,
      requiresSeparateExplicitFinalApproval: true,
    },
  }
}

export function loadReleaseCandidateFiles({
  planFile,
  dryRunFile,
  sourceAuditFile,
  checkpointPath,
  restoreVerificationFile,
} = {}) {
  const checkpointManifestFile = `${checkpointPath}/checkpoint-manifest.json`
  const checkpointStatusFile = `${checkpointPath}/checkpoint-status.json`
  const checkpointChecksumsFile = `${checkpointPath}/sha256-checksums.csv`
  const checkpointManifest = readJson(checkpointManifestFile)
  const checkpointStatus = readJson(checkpointStatusFile)
  const checkpointDumpFile = `${checkpointPath}/${val(checkpointManifest?.databaseDump)}`

  return {
    dryRunSummary: readJson(dryRunFile),
    sourceAuditSummary: readJson(sourceAuditFile),
    checkpointManifest,
    checkpointStatus,
    restoreVerification: readJson(restoreVerificationFile),
    hashes: {
      plan: sha256File(planFile),
      dryRun: sha256File(dryRunFile),
      sourceAudit: sha256File(sourceAuditFile),
      checkpointManifest: sha256File(checkpointManifestFile),
      checkpointStatus: sha256File(checkpointStatusFile),
      checkpointChecksums: sha256File(checkpointChecksumsFile),
      checkpointDump: sha256File(checkpointDumpFile),
      restoreVerification: sha256File(restoreVerificationFile),
    },
    checkpointDumpFile,
    checkpointDumpSize: fs.statSync(checkpointDumpFile).size,
  }
}
