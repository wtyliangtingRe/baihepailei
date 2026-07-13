import path from 'node:path'

import { approvalTokenFor, sha256File } from './payload-apply-v01.mjs'
import {
  RELEASE_CANDIDATE_BATCH_ID,
  approvalTokenFingerprint,
  normalizedPath,
  sha256Text,
} from './release-candidate-v01.mjs'
import { unique, val } from './payload-plan-v01.mjs'

export const LOCAL_ARM_VERSION = 'ai-radar-local-release-gate-armed-v0.1'
export const LOCAL_ARM_CONFIRMATION = 'ARM-AI-RADAR-FIRST-100-LOCAL-GATE-ONLY'
export const DEFAULT_ARM_TTL_MINUTES = 30

export function localRuntimePath(value) {
  const raw = val(value)
  if (process.platform === 'win32') {
    return raw.replace(/\/{1,}/gu, '\\').replace(/\\{2,}/gu, '\\')
  }
  return raw.replace(/\\/gu, '/')
}

export function expectedExecuteConfirmation(candidateId) {
  const id = val(candidateId).toUpperCase()
  if (!/^RC-[A-F0-9]{20}$/u.test(id)) throw new Error('A valid release candidate id is required')
  return `EXECUTE-${id}-94-PATCHES`
}

export function manifestActualHashes(manifest, checkpointPath) {
  const checkpointRoot = localRuntimePath(checkpointPath)
  const dumpName = path.basename(localRuntimePath(manifest?.files?.checkpointDump?.path))
  const files = {
    plan: localRuntimePath(manifest?.files?.plan?.path),
    dryRunSummary: localRuntimePath(manifest?.files?.dryRunSummary?.path),
    readinessSummary: localRuntimePath(manifest?.files?.readinessSummary?.path),
    sourceAuditSummary: localRuntimePath(manifest?.files?.sourceAuditSummary?.path),
    checkpointManifest: path.join(checkpointRoot, 'checkpoint-manifest.json'),
    checkpointStatus: path.join(checkpointRoot, 'checkpoint-status.json'),
    checkpointChecksums: path.join(checkpointRoot, 'sha256-checksums.csv'),
    checkpointDump: path.join(checkpointRoot, dumpName),
    restoreVerification: localRuntimePath(manifest?.files?.restoreVerification?.path),
  }

  return {
    files,
    hashes: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha256File(file)])),
  }
}

export function validateArmInputs({
  manifest,
  manifestHash,
  actualHashes,
  checkpointPath,
  currentBranch,
  currentCommit,
  approvalToken,
  confirmation,
  ttlMinutes = DEFAULT_ARM_TTL_MINUTES,
} = {}) {
  const blockers = []
  const planHash = val(manifest?.files?.plan?.sha256)
  let expectedToken = ''
  try {
    expectedToken = approvalTokenFor(planHash, RELEASE_CANDIDATE_BATCH_ID)
  } catch {
    blockers.push('candidate_plan_hash_invalid')
  }

  if (val(manifest?.version) !== 'ai-radar-release-candidate-v0.1') blockers.push('unexpected_candidate_version')
  if (!/^RC-[A-F0-9]{20}$/u.test(val(manifest?.candidateId))) blockers.push('invalid_candidate_id')
  if (val(manifest?.currentBranch) !== val(currentBranch)) blockers.push('candidate_branch_mismatch')
  if (val(manifest?.currentCommit) !== val(currentCommit)) blockers.push('candidate_commit_mismatch')
  if (manifest?.approval?.required !== true) blockers.push('candidate_approval_not_required')
  if (manifest?.approval?.tokenStored !== false) blockers.push('candidate_should_not_store_token')
  if (manifest?.approval?.finalApprovalReceived !== false) blockers.push('candidate_already_marked_approved')
  if (manifest?.safety?.payloadWrite !== false || Number(manifest?.safety?.payloadPatchRequests) !== 0) blockers.push('candidate_write_detected')
  if (manifest?.reviewedState?.readiness?.preflightReady !== true) blockers.push('candidate_preflight_not_ready')
  if (manifest?.reviewedState?.readiness?.executionReady !== false) blockers.push('candidate_should_be_disarmed')
  if (Number(manifest?.reviewedState?.readiness?.readyRows) !== 94) blockers.push('candidate_ready_rows_mismatch')
  if (Number(manifest?.reviewedState?.readiness?.blockedRows) !== 0) blockers.push('candidate_preflight_blocked')
  if (Number(manifest?.expected?.wouldUpdate) !== 94 || Number(manifest?.expected?.protected) !== 6) blockers.push('candidate_expected_counts_mismatch')

  if (!/^[a-f0-9]{64}$/u.test(val(manifestHash))) blockers.push('invalid_candidate_manifest_hash')
  if (normalizedPath(checkpointPath) !== normalizedPath(path.dirname(localRuntimePath(manifest?.files?.checkpointManifest?.path)))) {
    blockers.push('candidate_checkpoint_path_mismatch')
  }

  const expectedHashes = {
    plan: manifest?.files?.plan?.sha256,
    dryRunSummary: manifest?.files?.dryRunSummary?.sha256,
    readinessSummary: manifest?.files?.readinessSummary?.sha256,
    sourceAuditSummary: manifest?.files?.sourceAuditSummary?.sha256,
    checkpointManifest: manifest?.files?.checkpointManifest?.sha256,
    checkpointStatus: manifest?.files?.checkpointStatus?.sha256,
    checkpointChecksums: manifest?.files?.checkpointChecksums?.sha256,
    checkpointDump: manifest?.files?.checkpointDump?.sha256,
    restoreVerification: manifest?.files?.restoreVerification?.sha256,
  }
  for (const [key, expected] of Object.entries(expectedHashes)) {
    if (val(actualHashes?.[key]) !== val(expected)) blockers.push(`candidate_file_hash_mismatch:${key}`)
  }

  if (expectedToken && val(approvalToken) !== expectedToken) blockers.push('local_arm_approval_token_mismatch')
  if (val(confirmation) !== LOCAL_ARM_CONFIRMATION) blockers.push('local_arm_confirmation_mismatch')
  if (expectedToken && val(manifest?.approval?.tokenFingerprintSha256) !== approvalTokenFingerprint(planHash)) {
    blockers.push('candidate_token_fingerprint_mismatch')
  }
  if (!Number.isInteger(Number(ttlMinutes)) || Number(ttlMinutes) < 5 || Number(ttlMinutes) > 60) blockers.push('local_arm_ttl_out_of_range')

  return unique(blockers)
}

export function buildArmedLocalGate(manifest, {
  manifestHash,
  checkpointPath,
  approvalToken,
  currentBranch,
  currentCommit,
  now = Date.now(),
  ttlMinutes = DEFAULT_ARM_TTL_MINUTES,
} = {}) {
  const armedAt = new Date(now)
  const expiresAt = new Date(now + Number(ttlMinutes) * 60 * 1000)
  return {
    version: LOCAL_ARM_VERSION,
    batchId: RELEASE_CANDIDATE_BATCH_ID,
    expectedRows: 100,
    writeEnabled: true,
    userApprovalRequired: true,
    approvalToken,
    requirements: {
      payloadPatchPlanReviewed: true,
      payloadApplyDryRunReviewed: true,
      sourceProvenanceAuditReviewed: true,
    },
    localOnly: true,
    candidateId: val(manifest?.candidateId),
    candidateManifestSha256: val(manifestHash),
    planSha256: val(manifest?.files?.plan?.sha256),
    checkpointPath: normalizedPath(checkpointPath),
    checkpointDumpSha256: val(manifest?.files?.checkpointDump?.sha256),
    currentBranch: val(currentBranch),
    currentCommit: val(currentCommit),
    armedAt: armedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    finalApprovalReceived: true,
    executeConfirmationRequired: expectedExecuteConfirmation(manifest?.candidateId),
    approvalTokenFingerprintSha256: sha256Text(approvalToken),
    notes: [
      'Local armed gate. Never commit this file.',
      'This gate does not execute writes by itself.',
      'Run an armed readiness without --execute before any separately approved execution.',
    ],
  }
}

export function validateArmedLocalGate({
  gate,
  manifest,
  manifestHash,
  planHash,
  checkpointPath,
  currentBranch,
  currentCommit,
  approvalToken,
  now = Date.now(),
} = {}) {
  const blockers = []
  if (val(gate?.version) !== LOCAL_ARM_VERSION) blockers.push('local_gate_version_mismatch')
  if (gate?.localOnly !== true) blockers.push('local_gate_not_local_only')
  if (gate?.writeEnabled !== true) blockers.push('local_gate_not_armed')
  if (gate?.finalApprovalReceived !== true) blockers.push('local_gate_final_approval_missing')
  if (val(gate?.candidateId) !== val(manifest?.candidateId)) blockers.push('local_gate_candidate_id_mismatch')
  if (val(gate?.candidateManifestSha256) !== val(manifestHash)) blockers.push('local_gate_manifest_hash_mismatch')
  if (val(gate?.planSha256) !== val(planHash)) blockers.push('local_gate_plan_hash_mismatch')
  if (normalizedPath(gate?.checkpointPath) !== normalizedPath(checkpointPath)) blockers.push('local_gate_checkpoint_path_mismatch')
  if (val(gate?.checkpointDumpSha256) !== val(manifest?.files?.checkpointDump?.sha256)) blockers.push('local_gate_checkpoint_dump_hash_mismatch')
  if (val(gate?.currentBranch) !== val(currentBranch)) blockers.push('local_gate_branch_mismatch')
  if (val(gate?.currentCommit) !== val(currentCommit)) blockers.push('local_gate_commit_mismatch')
  if (val(manifest?.currentBranch) !== val(currentBranch)) blockers.push('armed_candidate_branch_mismatch')
  if (val(manifest?.currentCommit) !== val(currentCommit)) blockers.push('armed_candidate_commit_mismatch')
  if (val(manifest?.files?.plan?.sha256) !== val(planHash)) blockers.push('armed_candidate_plan_hash_mismatch')
  if (val(gate?.approvalToken) !== val(approvalToken)) blockers.push('local_gate_approval_token_mismatch')
  if (val(gate?.approvalTokenFingerprintSha256) !== sha256Text(approvalToken)) blockers.push('local_gate_token_fingerprint_mismatch')

  const armedAt = Date.parse(val(gate?.armedAt))
  const expiresAt = Date.parse(val(gate?.expiresAt))
  if (!Number.isFinite(armedAt)) blockers.push('local_gate_armed_at_invalid')
  if (!Number.isFinite(expiresAt)) blockers.push('local_gate_expires_at_invalid')
  if (Number.isFinite(armedAt) && armedAt > now + 5 * 60 * 1000) blockers.push('local_gate_armed_in_future')
  if (Number.isFinite(expiresAt) && expiresAt <= now) blockers.push('local_gate_expired')
  if (Number.isFinite(armedAt) && Number.isFinite(expiresAt) && expiresAt - armedAt > 60 * 60 * 1000) blockers.push('local_gate_ttl_too_long')

  return unique(blockers)
}
