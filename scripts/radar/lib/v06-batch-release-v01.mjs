import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  approvalTokenFor,
  changedFieldsAgainstCurrent,
  minimalPatch,
  readJson,
  readJsonl,
  rollbackPatchFor,
  sha256File,
  validateApplyPlanRow,
  validateCheckpoint,
} from './payload-apply-v01.mjs'
import {
  currentStateOf,
  humanProtectionReasons,
  snapshotHash,
  unique,
  val,
} from './payload-plan-v01.mjs'

export const V06_BATCH_CANDIDATE_VERSION = 'ai-radar-v06-batch-release-candidate-v0.1'
export const V06_BATCH_GATE_VERSION = 'ai-radar-v06-batch-local-gate-v0.1'
export const V06_BATCH_APPLY_VERSION = 'ai-radar-v06-batch-apply-v0.1'
export const V06_BATCH_ARM_CONFIRMATION = 'ARM-AI-RADAR-V06-BATCH-LOCAL-GATE-ONLY'
export const DEFAULT_V06_ARM_TTL_MINUTES = 120
export const MAX_V06_ARM_TTL_MINUTES = 720

export function safeBatchId(value) {
  const id = val(value).toUpperCase()
  if (!/^RADAR-ASSESS-\d{4}$/u.test(id)) throw new Error(`Invalid v0.6 assessment batch id: ${value}`)
  return id
}

export function batchSlug(value) {
  return safeBatchId(value).toLowerCase()
}

export function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`v0.6 release output must remain under data_local: ${target}`)
  }
  return resolved
}

export function writeJson(file, value) {
  assertUnderDataLocal(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function writeJsonl(file, rows) {
  assertUnderDataLocal(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

export function appendJsonl(file, row) {
  assertUnderDataLocal(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

export function normalizedPath(value) {
  return val(value).replace(/\\/gu, '/').replace(/\/{2,}/gu, '/').replace(/\/+$/u, '').toLowerCase()
}

export function localRuntimePath(value) {
  const raw = val(value)
  if (process.platform === 'win32') return raw.replace(/\/{1,}/gu, '\\').replace(/\\{2,}/gu, '\\')
  return raw.replace(/\\/gu, '/').replace(/\/{2,}/gu, '/')
}

export function countBy(values, getter = (item) => item) {
  const counts = {}
  for (const value of values) {
    const key = val(getter(value)) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function requireFile(file, label) {
  if (!file || !fs.existsSync(file)) throw new Error(`${label} not found: ${file}`)
}

export function reviewedBatchPaths(batchId, {
  planRoot = 'data_local/staging/ai-radar/v06-payload-plan-v01',
  dryRunRoot = 'data_local/staging/ai-radar/v06-payload-dryrun-v01',
} = {}) {
  const slug = batchSlug(batchId)
  return {
    planSummary: path.join(planRoot, 'batches', slug, 'payload-plan-summary.json'),
    dryRunSummary: path.join(dryRunRoot, 'batches', slug, 'payload-dryrun-summary.json'),
  }
}

export function loadReviewedBatch(batchId, options = {}) {
  const id = safeBatchId(batchId)
  const paths = reviewedBatchPaths(id, options)
  requireFile(paths.planSummary, 'Batch plan summary')
  requireFile(paths.dryRunSummary, 'Batch dry-run summary')
  const planSummary = readJson(paths.planSummary)
  const dryRunSummary = readJson(paths.dryRunSummary)
  const planFile = localRuntimePath(planSummary?.planFile)
  requireFile(planFile, 'Batch plan')
  const plans = readJsonl(planFile)
  const planHash = sha256File(planFile)
  const readyPlans = plans.filter((row) => val(row?.planStatus) === 'ready_for_payload_dry_run')
  const blockedPlans = plans.filter((row) => val(row?.planStatus) === 'blocked')
  const alreadyCurrentPlans = plans.filter((row) => val(row?.planStatus) === 'already_current')
  const blockers = []

  if (safeBatchId(planSummary?.batchId) !== id) blockers.push('plan_summary_batch_id_mismatch')
  if (val(planSummary?.planSha256) !== planHash) blockers.push('plan_summary_hash_mismatch')
  if (safeBatchId(dryRunSummary?.batchId) !== id) blockers.push('dryrun_batch_id_mismatch')
  if (val(dryRunSummary?.version) !== 'ai-radar-v06-payload-batch-dryrun-v0.1') blockers.push('unexpected_dryrun_version')
  if (val(dryRunSummary?.planSha256) !== planHash) blockers.push('dryrun_plan_hash_mismatch')
  if (Number(planSummary?.rows) !== plans.length || Number(dryRunSummary?.planRows) !== plans.length) blockers.push('reviewed_row_count_mismatch')
  if (Number(planSummary?.readyForDryRun) !== readyPlans.length || Number(dryRunSummary?.wouldUpdate) !== readyPlans.length) blockers.push('reviewed_ready_count_mismatch')
  if (Number(planSummary?.blocked) !== blockedPlans.length || Number(dryRunSummary?.blocked) !== blockedPlans.length) blockers.push('reviewed_blocked_count_mismatch')
  if (Number(planSummary?.alreadyCurrent) !== alreadyCurrentPlans.length || Number(dryRunSummary?.alreadyCurrent) !== alreadyCurrentPlans.length) blockers.push('reviewed_already_current_count_mismatch')
  if (alreadyCurrentPlans.length !== 0) blockers.push('reviewed_batch_contains_already_current_rows')
  if (dryRunSummary?.safety?.payloadWrite !== false || Number(dryRunSummary?.safety?.payloadPatchRequests) !== 0) blockers.push('reviewed_dryrun_write_detected')

  for (const plan of readyPlans) {
    const rowBlockers = validateApplyPlanRow(plan)
    if (rowBlockers.length) blockers.push(`invalid_ready_plan:${val(plan?.workId)}:${rowBlockers.join('|')}`)
  }
  for (const plan of blockedPlans) {
    if (!Array.isArray(plan?.blockers) || plan.blockers.length === 0) blockers.push(`blocked_plan_without_reason:${val(plan?.workId)}`)
  }

  return {
    batchId: id,
    blockers: unique(blockers),
    paths: { ...paths, planFile },
    hashes: {
      plan: planHash,
      planSummary: sha256File(paths.planSummary),
      dryRunSummary: sha256File(paths.dryRunSummary),
    },
    planSummary,
    dryRunSummary,
    plans,
    readyPlans,
    blockedPlans,
    alreadyCurrentPlans,
  }
}

export function loadCheckpointEvidence(checkpointPath, restoreVerificationFile, { currentBranch = '', currentCommit = '', maxAgeHours = 24 } = {}) {
  const checkpoint = validateCheckpoint(checkpointPath, { currentBranch, currentCommit, maxAgeHours })
  const blockers = [...checkpoint.blockers]
  requireFile(restoreVerificationFile, 'Database restore verification')
  const restoreVerification = readJson(restoreVerificationFile)
  const dumpFile = checkpoint?.files?.databaseDump
  const dumpHash = dumpFile && fs.existsSync(dumpFile) ? sha256File(dumpFile) : ''
  if (restoreVerification?.verified !== true) blockers.push('database_restore_listing_not_verified')
  if (val(restoreVerification?.dumpSha256).toLowerCase() !== dumpHash.toLowerCase()) blockers.push('restore_verification_dump_hash_mismatch')
  if (Number(restoreVerification?.listEntryCount) <= 0) blockers.push('restore_verification_has_no_entries')
  return {
    blockers: unique(blockers),
    checkpoint,
    restoreVerification,
    files: {
      checkpointManifest: checkpoint?.files?.manifest,
      checkpointStatus: checkpoint?.files?.status,
      checkpointChecksums: checkpoint?.files?.checksums,
      checkpointDump: dumpFile,
      restoreVerification: restoreVerificationFile,
    },
    hashes: {
      checkpointManifest: checkpoint?.files?.manifest ? sha256File(checkpoint.files.manifest) : '',
      checkpointStatus: checkpoint?.files?.status ? sha256File(checkpoint.files.status) : '',
      checkpointChecksums: checkpoint?.files?.checksums ? sha256File(checkpoint.files.checksums) : '',
      checkpointDump: dumpHash,
      restoreVerification: sha256File(restoreVerificationFile),
    },
  }
}

export function approvalTokenFingerprint(planHash, batchId) {
  return sha256Text(approvalTokenFor(planHash, safeBatchId(batchId)))
}

export function buildBatchCandidate(reviewed, checkpointEvidence, { checkpointPath, currentBranch, currentCommit } = {}) {
  const material = JSON.stringify({
    batchId: reviewed.batchId,
    plan: reviewed.hashes.plan,
    planSummary: reviewed.hashes.planSummary,
    dryRunSummary: reviewed.hashes.dryRunSummary,
    checkpointManifest: checkpointEvidence.hashes.checkpointManifest,
    checkpointStatus: checkpointEvidence.hashes.checkpointStatus,
    checkpointChecksums: checkpointEvidence.hashes.checkpointChecksums,
    checkpointDump: checkpointEvidence.hashes.checkpointDump,
    restoreVerification: checkpointEvidence.hashes.restoreVerification,
    currentBranch,
    currentCommit,
  })
  return {
    generatedAt: new Date().toISOString(),
    version: V06_BATCH_CANDIDATE_VERSION,
    batchId: reviewed.batchId,
    candidateId: `RC-V06-${sha256Text(material).slice(0, 20).toUpperCase()}`,
    currentBranch: val(currentBranch),
    currentCommit: val(currentCommit),
    checkpointPath: normalizedPath(checkpointPath),
    expected: {
      rows: reviewed.plans.length,
      wouldUpdate: reviewed.readyPlans.length,
      blocked: reviewed.blockedPlans.length,
      alreadyCurrent: 0,
    },
    files: {
      plan: { path: reviewed.paths.planFile, sha256: reviewed.hashes.plan },
      planSummary: { path: reviewed.paths.planSummary, sha256: reviewed.hashes.planSummary },
      dryRunSummary: { path: reviewed.paths.dryRunSummary, sha256: reviewed.hashes.dryRunSummary },
      checkpointManifest: { path: checkpointEvidence.files.checkpointManifest, sha256: checkpointEvidence.hashes.checkpointManifest },
      checkpointStatus: { path: checkpointEvidence.files.checkpointStatus, sha256: checkpointEvidence.hashes.checkpointStatus },
      checkpointChecksums: { path: checkpointEvidence.files.checkpointChecksums, sha256: checkpointEvidence.hashes.checkpointChecksums },
      checkpointDump: { path: checkpointEvidence.files.checkpointDump, sha256: checkpointEvidence.hashes.checkpointDump },
      restoreVerification: { path: checkpointEvidence.files.restoreVerification, sha256: checkpointEvidence.hashes.restoreVerification },
    },
    approval: {
      required: true,
      tokenStored: false,
      tokenFingerprintSha256: approvalTokenFingerprint(reviewed.hashes.plan, reviewed.batchId),
      finalApprovalReceived: false,
    },
    safety: {
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      blockedPlansNeverApplied: true,
      requiresFreshCheckpointForCommit: true,
      requiresSeparateLocalArm: true,
    },
  }
}

export function candidateActualHashes(manifest, checkpointPath) {
  const checkpointRoot = localRuntimePath(checkpointPath)
  const dumpName = path.basename(localRuntimePath(manifest?.files?.checkpointDump?.path))
  const files = {
    plan: localRuntimePath(manifest?.files?.plan?.path),
    planSummary: localRuntimePath(manifest?.files?.planSummary?.path),
    dryRunSummary: localRuntimePath(manifest?.files?.dryRunSummary?.path),
    checkpointManifest: path.join(checkpointRoot, 'checkpoint-manifest.json'),
    checkpointStatus: path.join(checkpointRoot, 'checkpoint-status.json'),
    checkpointChecksums: path.join(checkpointRoot, 'sha256-checksums.csv'),
    checkpointDump: path.join(checkpointRoot, dumpName),
    restoreVerification: localRuntimePath(manifest?.files?.restoreVerification?.path),
  }
  for (const [key, file] of Object.entries(files)) requireFile(file, `Candidate ${key}`)
  return { files, hashes: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha256File(file)])) }
}

export function validateCandidate(manifest, { manifestHash = '', actualHashes = {}, checkpointPath = '', currentBranch = '', currentCommit = '' } = {}) {
  const blockers = []
  let batchId = ''
  try { batchId = safeBatchId(manifest?.batchId) } catch { blockers.push('candidate_batch_id_invalid') }
  if (val(manifest?.version) !== V06_BATCH_CANDIDATE_VERSION) blockers.push('candidate_version_mismatch')
  if (!/^RC-V06-[A-F0-9]{20}$/u.test(val(manifest?.candidateId))) blockers.push('candidate_id_invalid')
  if (val(manifest?.currentBranch) !== val(currentBranch)) blockers.push('candidate_branch_mismatch')
  if (val(manifest?.currentCommit) !== val(currentCommit)) blockers.push('candidate_commit_mismatch')
  if (normalizedPath(manifest?.checkpointPath) !== normalizedPath(checkpointPath)) blockers.push('candidate_checkpoint_path_mismatch')
  if (manifest?.approval?.required !== true || manifest?.approval?.tokenStored !== false || manifest?.approval?.finalApprovalReceived !== false) blockers.push('candidate_approval_state_invalid')
  if (manifest?.safety?.payloadWrite !== false || Number(manifest?.safety?.payloadPatchRequests) !== 0) blockers.push('candidate_write_detected')
  if (!/^[a-f0-9]{64}$/u.test(val(manifestHash))) blockers.push('candidate_manifest_hash_invalid')
  for (const key of ['plan', 'planSummary', 'dryRunSummary', 'checkpointManifest', 'checkpointStatus', 'checkpointChecksums', 'checkpointDump', 'restoreVerification']) {
    if (val(actualHashes?.[key]) !== val(manifest?.files?.[key]?.sha256)) blockers.push(`candidate_file_hash_mismatch:${key}`)
  }
  if (batchId && val(manifest?.approval?.tokenFingerprintSha256) !== approvalTokenFingerprint(manifest?.files?.plan?.sha256, batchId)) blockers.push('candidate_token_fingerprint_mismatch')
  const expected = manifest?.expected || {}
  if (!Number.isInteger(Number(expected.rows)) || Number(expected.rows) < 1) blockers.push('candidate_expected_rows_invalid')
  if (!Number.isInteger(Number(expected.wouldUpdate)) || Number(expected.wouldUpdate) < 1) blockers.push('candidate_expected_writes_invalid')
  if (Number(expected.wouldUpdate) + Number(expected.blocked) + Number(expected.alreadyCurrent) !== Number(expected.rows)) blockers.push('candidate_expected_counts_do_not_sum')
  return unique(blockers)
}

export function expectedExecuteConfirmation(manifest) {
  const candidateId = val(manifest?.candidateId).toUpperCase()
  const count = Number(manifest?.expected?.wouldUpdate)
  if (!/^RC-V06-[A-F0-9]{20}$/u.test(candidateId) || !Number.isInteger(count) || count < 1) throw new Error('Valid v0.6 candidate and write count required')
  return `EXECUTE-${candidateId}-${count}-PATCHES`
}

export function buildDisarmedBatchGate(manifest) {
  return {
    version: V06_BATCH_GATE_VERSION,
    localOnly: true,
    batchId: safeBatchId(manifest?.batchId),
    candidateId: val(manifest?.candidateId),
    writeEnabled: false,
    finalApprovalReceived: false,
    approvalToken: null,
    notes: ['Disarmed local gate. This file cannot execute writes.'],
  }
}

export function buildArmedBatchGate(manifest, { manifestHash, checkpointPath, readinessFile, readinessHash, approvalToken, currentBranch, currentCommit, ttlMinutes = DEFAULT_V06_ARM_TTL_MINUTES, now = Date.now() } = {}) {
  const armedAt = new Date(now)
  const expiresAt = new Date(now + Number(ttlMinutes) * 60 * 1000)
  return {
    version: V06_BATCH_GATE_VERSION,
    localOnly: true,
    batchId: safeBatchId(manifest?.batchId),
    candidateId: val(manifest?.candidateId),
    candidateManifestSha256: val(manifestHash),
    planSha256: val(manifest?.files?.plan?.sha256),
    checkpointPath: normalizedPath(checkpointPath),
    checkpointDumpSha256: val(manifest?.files?.checkpointDump?.sha256),
    readinessFile: localRuntimePath(readinessFile),
    readinessSha256: val(readinessHash),
    currentBranch: val(currentBranch),
    currentCommit: val(currentCommit),
    writeEnabled: true,
    finalApprovalReceived: true,
    approvalToken,
    approvalTokenFingerprintSha256: sha256Text(approvalToken),
    executeConfirmationRequired: expectedExecuteConfirmation(manifest),
    armedAt: armedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    notes: [
      'Local-only armed gate. Never commit it.',
      'The gate does not write by itself.',
      'Run armed readiness before separately approved execution.',
    ],
  }
}

export function validateReadinessForArm(summary, manifest, { manifestHash = '', currentBranch = '', currentCommit = '' } = {}) {
  const blockers = []
  if (val(summary?.version) !== V06_BATCH_APPLY_VERSION) blockers.push('readiness_version_mismatch')
  if (val(summary?.mode) !== 'readiness') blockers.push('readiness_mode_mismatch')
  if (val(summary?.candidateId) !== val(manifest?.candidateId)) blockers.push('readiness_candidate_id_mismatch')
  if (val(summary?.candidateManifestSha256) !== val(manifestHash)) blockers.push('readiness_candidate_hash_mismatch')
  if (val(summary?.currentBranch) !== val(currentBranch) || val(summary?.currentCommit) !== val(currentCommit)) blockers.push('readiness_git_state_mismatch')
  if (Number(summary?.pendingOriginal) !== Number(manifest?.expected?.wouldUpdate)) blockers.push('readiness_pending_count_mismatch')
  if (Number(summary?.alreadyApplied) !== 0) blockers.push('readiness_already_applied_before_first_arm')
  if (Number(summary?.drifted) !== 0 || summary?.preflightReady !== true) blockers.push('readiness_preflight_not_clean')
  if (Number(summary?.payloadPatchRequests) !== 0 || Number(summary?.appliedAndVerified) !== 0) blockers.push('readiness_write_detected')
  if (summary?.safety?.payloadWrite !== false) blockers.push('readiness_payload_write_safety_mismatch')
  return unique(blockers)
}

export function validateArmedBatchGate(gate, manifest, { manifestHash = '', checkpointPath = '', currentBranch = '', currentCommit = '', approvalToken = '', now = Date.now() } = {}) {
  const blockers = []
  if (val(gate?.version) !== V06_BATCH_GATE_VERSION) blockers.push('gate_version_mismatch')
  if (gate?.localOnly !== true || gate?.writeEnabled !== true || gate?.finalApprovalReceived !== true) blockers.push('gate_not_armed')
  if (val(gate?.batchId) !== val(manifest?.batchId) || val(gate?.candidateId) !== val(manifest?.candidateId)) blockers.push('gate_candidate_mismatch')
  if (val(gate?.candidateManifestSha256) !== val(manifestHash)) blockers.push('gate_manifest_hash_mismatch')
  if (val(gate?.planSha256) !== val(manifest?.files?.plan?.sha256)) blockers.push('gate_plan_hash_mismatch')
  if (normalizedPath(gate?.checkpointPath) !== normalizedPath(checkpointPath)) blockers.push('gate_checkpoint_path_mismatch')
  if (val(gate?.checkpointDumpSha256) !== val(manifest?.files?.checkpointDump?.sha256)) blockers.push('gate_checkpoint_dump_hash_mismatch')
  if (val(gate?.currentBranch) !== val(currentBranch) || val(gate?.currentCommit) !== val(currentCommit)) blockers.push('gate_git_state_mismatch')
  if (val(gate?.approvalToken) !== val(approvalToken) || val(gate?.approvalTokenFingerprintSha256) !== sha256Text(approvalToken)) blockers.push('gate_approval_token_mismatch')
  if (val(gate?.executeConfirmationRequired) !== expectedExecuteConfirmation(manifest)) blockers.push('gate_execute_confirmation_mismatch')
  if (!gate?.readinessFile || !fs.existsSync(localRuntimePath(gate.readinessFile))) blockers.push('gate_readiness_file_missing')
  else if (sha256File(localRuntimePath(gate.readinessFile)) !== val(gate?.readinessSha256)) blockers.push('gate_readiness_hash_mismatch')
  const armedAt = Date.parse(val(gate?.armedAt))
  const expiresAt = Date.parse(val(gate?.expiresAt))
  if (!Number.isFinite(armedAt) || !Number.isFinite(expiresAt)) blockers.push('gate_time_invalid')
  if (Number.isFinite(armedAt) && armedAt > now + 5 * 60 * 1000) blockers.push('gate_armed_in_future')
  if (Number.isFinite(expiresAt) && expiresAt <= now) blockers.push('gate_expired')
  if (Number.isFinite(armedAt) && Number.isFinite(expiresAt) && expiresAt - armedAt > MAX_V06_ARM_TTL_MINUTES * 60 * 1000) blockers.push('gate_ttl_too_long')
  return unique(blockers)
}

export function classifyPlanAgainstWork(plan, work) {
  const blockers = [...validateApplyPlanRow(plan)]
  if (!work) blockers.push('payload_work_missing')
  else {
    blockers.push(...humanProtectionReasons(work))
    if (val(work?.id) !== val(plan?.target?.id)) blockers.push('payload_id_changed')
    if (val(work?.siteId) !== val(plan?.target?.siteId)) blockers.push('site_id_changed')
  }
  if (blockers.length) return { status: 'drifted', blockers: unique(blockers), changedFields: [] }
  const changed = changedFieldsAgainstCurrent(work, plan)
  if (changed.length === 0) return { status: 'already_applied', blockers: [], changedFields: [] }
  const currentHash = snapshotHash(currentStateOf(work))
  if (currentHash !== val(plan?.expectedBeforeHash)) blockers.push('stale_payload_snapshot')
  const expectedFields = [...(plan?.changedFields || [])].sort()
  const actualFields = [...changed].sort()
  if (JSON.stringify(expectedFields) !== JSON.stringify(actualFields)) blockers.push('changed_field_set_differs_from_plan')
  return {
    status: blockers.length ? 'drifted' : 'pending_original',
    blockers: unique(blockers),
    changedFields: changed,
    currentHash,
  }
}

export { approvalTokenFor, minimalPatch, readJson, readJsonl, rollbackPatchFor, sha256File, unique, val }
