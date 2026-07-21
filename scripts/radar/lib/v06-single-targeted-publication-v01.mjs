import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  targetedPublicationExpectations,
  targetedPublicationHumanState,
  targetedPublicationPublishedState,
  targetedPublicationSha256,
} from '../dryrun-ai-radar-v06-targeted-publication-v01.mjs'
import {
  canonical,
  equal,
  humanTrackRecorded,
  payloadComparable,
  val,
} from './payload-plan-v01.mjs'
import {
  approvalTokenFor,
  sha256File,
} from './payload-apply-v01.mjs'
import {
  loadCheckpointEvidence,
  normalizedPath,
} from './v06-batch-release-v01.mjs'

export const SINGLE_CANDIDATE_VERSION = 'ai-radar-v06-single-targeted-publication-candidate-v0.1'
export const SINGLE_GATE_VERSION = 'ai-radar-v06-single-targeted-publication-gate-v0.1'
export const SINGLE_EXECUTE_VERSION = 'ai-radar-v06-single-targeted-publication-execute-v0.1'
export const SINGLE_ARM_CONFIRMATION = 'ARM-AI-RADAR-V06-SINGLE-TARGETED-PUBLICATION'
export const DEFAULT_SINGLE_GATE_TTL_MINUTES = 30
export const MAX_SINGLE_GATE_TTL_MINUTES = 120

export const COMPATIBILITY_FIELDS = ['rank', 'ratingNotice', 'reviewStatus', 'reviewReasons', 'evidenceStrength']
export const ALLOWED_PATCH_FIELDS = new Set(['_status', 'radarAssessment', ...COMPATIBILITY_FIELDS])

function list(value) {
  return Array.isArray(value) ? value : []
}

export function unique(values) {
  return [...new Set(list(values).map(val).filter(Boolean))]
}

export function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Single publication artifacts must remain under data_local: ${target}`)
  }
  return resolved
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

export function readJsonl(file) {
  if (!file || !fs.existsSync(file)) throw new Error(`JSONL input not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  return raw ? raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) : []
}

export function writeJson(file, value) {
  assertUnderDataLocal(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function appendJsonl(file, row) {
  assertUnderDataLocal(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

export function newestFile(root, basename) {
  if (!fs.existsSync(root)) return ''
  const matches = []
  const walk = (dir, depth = 0) => {
    if (depth > 8) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file, depth + 1)
      else if (entry.name.toLowerCase() === basename.toLowerCase()) {
        matches.push({ file, mtimeMs: fs.statSync(file).mtimeMs })
      }
    }
  }
  walk(root)
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))
  return matches[0]?.file || ''
}

function comparable(value) {
  return canonical(payloadComparable(value))
}

function radarOf(work) {
  return work?.radarAssessment && typeof work.radarAssessment === 'object' ? work.radarAssessment : {}
}

function equalStringLists(a, b) {
  const left = unique(a).sort()
  const right = unique(b).sort()
  return equal(left, right)
}

function fieldChanges(work, patch) {
  return Object.entries(patch || {})
    .filter(([key, value]) => !equal(comparable(work?.[key]), comparable(value)))
    .map(([key]) => key)
    .sort()
}

function patchAlreadyApplied(work, patch) {
  return Object.entries(patch || {}).every(([key, value]) => equal(comparable(work?.[key]), comparable(value)))
}

export function validateReadyDryRunRow(row) {
  const blockers = []
  const patch = row?.patch && typeof row.patch === 'object' ? row.patch : null
  if (val(row?.version) !== 'ai-radar-v06-targeted-publication-dryrun-v0.1') blockers.push('single_source_dryrun_version_mismatch')
  if (val(row?.dryRunStatus) !== 'ready_for_targeted_publication') blockers.push('single_source_row_not_ready')
  if (list(row?.blockers).length) blockers.push('single_source_row_has_blockers')
  if (!val(row?.target?.id) || !val(row?.target?.siteId)) blockers.push('single_source_identity_missing')
  if (!patch) blockers.push('single_source_patch_missing')
  if (patch) {
    if (val(patch?._status) !== 'published') blockers.push('single_patch_status_must_be_published')
    if (!patch?.radarAssessment || typeof patch.radarAssessment !== 'object') blockers.push('single_patch_radar_missing')
    if ('humanAssessment' in patch) blockers.push('single_patch_human_assessment_forbidden')
    for (const key of Object.keys(patch)) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) blockers.push(`single_patch_unexpected_field:${key}`)
    }
    if (targetedPublicationSha256(canonical(patch)) !== val(row?.patchSha256)) blockers.push('single_patch_hash_mismatch')
  }
  if (row?.wholeDraftPublicationForbidden !== true) blockers.push('single_whole_draft_guard_missing')
  if (row?.payloadPatchSimulatedOnly !== true) blockers.push('single_source_not_dryrun_only')
  if (!row?.observedBefore?.publishedStateSha256) blockers.push('single_published_before_hash_missing')
  if (!row?.observedBefore?.humanStateSha256) blockers.push('single_human_before_hash_missing')
  if (!row?.observedBefore?.latestDraftRadarSha256) blockers.push('single_draft_radar_hash_missing')
  if (!row?.simulatedAfter?.publishedStateSha256) blockers.push('single_simulated_after_hash_missing')
  return unique(blockers)
}

export function selectSingleReadyRow(rows, requestedWorkId = '') {
  const ready = list(rows)
    .filter((row) => val(row?.dryRunStatus) === 'ready_for_targeted_publication')
    .sort((a, b) => val(a?.target?.id || a?.workId).localeCompare(val(b?.target?.id || b?.workId), undefined, { numeric: true }))
  if (!ready.length) throw new Error('No ready_for_targeted_publication row was found.')
  if (!val(requestedWorkId)) return ready[0]
  const matches = ready.filter((row) => [val(row?.workId), val(row?.target?.id), val(row?.target?.siteId)].includes(val(requestedWorkId)))
  if (matches.length !== 1) throw new Error(`Expected exactly one ready row for --work-id ${requestedWorkId}; found ${matches.length}.`)
  return matches[0]
}

export function approvalScopeFor(candidate) {
  return `radar-v06-single-${val(candidate?.target?.id)}`
}

export function approvalTokenForCandidate(candidate) {
  return approvalTokenFor(val(candidate?.files?.dryRun?.sha256), approvalScopeFor(candidate))
}

export function approvalTokenFingerprintForCandidate(candidate) {
  return sha256Text(approvalTokenForCandidate(candidate))
}

export function executeConfirmationFor(candidate) {
  return `PUBLISH-${val(candidate?.candidateId)}-ONCE`
}

export function buildSingleCandidate(row, checkpointEvidence, {
  dryRunFile,
  checkpointPath,
  currentBranch,
  currentCommit,
} = {}) {
  const rowBlockers = validateReadyDryRunRow(row)
  if (rowBlockers.length) throw new Error(`Ready dry-run row is invalid: ${rowBlockers.join(', ')}`)
  if (checkpointEvidence?.blockers?.length) throw new Error(`Checkpoint evidence is invalid: ${checkpointEvidence.blockers.join(', ')}`)
  const dryRunHash = sha256File(dryRunFile)
  const rowHash = targetedPublicationSha256(row)
  const material = JSON.stringify({
    rowHash,
    dryRunHash,
    checkpointDump: checkpointEvidence.hashes.checkpointDump,
    restoreVerification: checkpointEvidence.hashes.restoreVerification,
    currentBranch,
    currentCommit,
  })
  const candidate = {
    generatedAt: new Date().toISOString(),
    version: SINGLE_CANDIDATE_VERSION,
    candidateId: `RC-V06-SINGLE-${sha256Text(material).slice(0, 20).toUpperCase()}`,
    currentBranch: val(currentBranch),
    currentCommit: val(currentCommit),
    checkpointPath: normalizedPath(checkpointPath),
    target: canonical(row.target),
    expected: {
      workId: val(row?.workId),
      changedFields: list(row?.changedFields).map(val).filter(Boolean).sort(),
      patch: canonical(row.patch),
      patchSha256: val(row?.patchSha256),
      observedBefore: canonical(row.observedBefore),
      simulatedAfter: canonical(row.simulatedAfter),
      humanTrackRecorded: row?.humanTrackRecorded === true,
    },
    sourceDryRunRow: canonical(row),
    sourceDryRunRowSha256: rowHash,
    files: {
      dryRun: { path: dryRunFile, sha256: dryRunHash },
      checkpointManifest: { path: checkpointEvidence.files.checkpointManifest, sha256: checkpointEvidence.hashes.checkpointManifest },
      checkpointStatus: { path: checkpointEvidence.files.checkpointStatus, sha256: checkpointEvidence.hashes.checkpointStatus },
      checkpointChecksums: { path: checkpointEvidence.files.checkpointChecksums, sha256: checkpointEvidence.hashes.checkpointChecksums },
      checkpointDump: { path: checkpointEvidence.files.checkpointDump, sha256: checkpointEvidence.hashes.checkpointDump },
      restoreVerification: { path: checkpointEvidence.files.restoreVerification, sha256: checkpointEvidence.hashes.restoreVerification },
    },
    approval: {
      required: true,
      tokenStored: false,
      tokenFingerprintSha256: '',
      armConfirmationRequired: SINGLE_ARM_CONFIRMATION,
    },
    safety: {
      maximumPayloadPatchRequests: 1,
      wholeDraftPublicationForbidden: true,
      allowlistedPartialPatchOnly: true,
      humanAssessmentPatchForbidden: true,
      requiresFreshCheckpointForCurrentCommit: true,
      requiresSeparateLocalArm: true,
      requiresExactPostWriteVerification: true,
      automaticRollback: false,
    },
  }
  candidate.approval.tokenFingerprintSha256 = approvalTokenFingerprintForCandidate(candidate)
  candidate.executeConfirmationRequired = executeConfirmationFor(candidate)
  return canonical(candidate)
}

function candidateFileMap(candidate, checkpointPath) {
  const checkpointRoot = path.resolve(checkpointPath)
  return {
    dryRun: path.resolve(val(candidate?.files?.dryRun?.path)),
    checkpointManifest: path.join(checkpointRoot, 'checkpoint-manifest.json'),
    checkpointStatus: path.join(checkpointRoot, 'checkpoint-status.json'),
    checkpointChecksums: path.join(checkpointRoot, 'sha256-checksums.csv'),
    checkpointDump: path.join(checkpointRoot, path.basename(val(candidate?.files?.checkpointDump?.path))),
    restoreVerification: path.resolve(val(candidate?.files?.restoreVerification?.path)),
  }
}

export function validateSingleCandidate(candidate, {
  candidateManifestFile = '',
  checkpointPath = '',
  currentBranch = '',
  currentCommit = '',
  maxAgeHours = 24,
} = {}) {
  const blockers = []
  if (val(candidate?.version) !== SINGLE_CANDIDATE_VERSION) blockers.push('single_candidate_version_mismatch')
  if (!/^RC-V06-SINGLE-[A-F0-9]{20}$/u.test(val(candidate?.candidateId))) blockers.push('single_candidate_id_invalid')
  if (val(candidate?.currentBranch) !== val(currentBranch)) blockers.push('single_candidate_branch_mismatch')
  if (val(candidate?.currentCommit) !== val(currentCommit)) blockers.push('single_candidate_commit_mismatch')
  if (normalizedPath(candidate?.checkpointPath) !== normalizedPath(checkpointPath)) blockers.push('single_candidate_checkpoint_path_mismatch')
  blockers.push(...validateReadyDryRunRow(candidate?.sourceDryRunRow))
  if (targetedPublicationSha256(candidate?.sourceDryRunRow) !== val(candidate?.sourceDryRunRowSha256)) blockers.push('single_candidate_source_row_hash_mismatch')
  if (!equal(canonical(candidate?.expected?.patch), canonical(candidate?.sourceDryRunRow?.patch))) blockers.push('single_candidate_patch_differs_from_source')
  if (val(candidate?.expected?.patchSha256) !== val(candidate?.sourceDryRunRow?.patchSha256)) blockers.push('single_candidate_patch_hash_reference_mismatch')
  if (val(candidate?.target?.id) !== val(candidate?.sourceDryRunRow?.target?.id)) blockers.push('single_candidate_target_id_mismatch')
  if (val(candidate?.target?.siteId) !== val(candidate?.sourceDryRunRow?.target?.siteId)) blockers.push('single_candidate_site_id_mismatch')
  if (candidate?.safety?.maximumPayloadPatchRequests !== 1) blockers.push('single_candidate_patch_limit_invalid')
  if (candidate?.safety?.wholeDraftPublicationForbidden !== true) blockers.push('single_candidate_whole_draft_guard_missing')
  if (candidate?.safety?.humanAssessmentPatchForbidden !== true) blockers.push('single_candidate_human_guard_missing')
  if (val(candidate?.approval?.tokenFingerprintSha256) !== approvalTokenFingerprintForCandidate(candidate)) blockers.push('single_candidate_token_fingerprint_mismatch')
  if (val(candidate?.executeConfirmationRequired) !== executeConfirmationFor(candidate)) blockers.push('single_candidate_execute_confirmation_mismatch')

  const fileMap = candidateFileMap(candidate, checkpointPath)
  for (const [key, file] of Object.entries(fileMap)) {
    if (!file || !fs.existsSync(file)) blockers.push(`single_candidate_file_missing:${key}`)
    else if (sha256File(file) !== val(candidate?.files?.[key]?.sha256)) blockers.push(`single_candidate_file_hash_mismatch:${key}`)
  }
  if (candidateManifestFile && !fs.existsSync(candidateManifestFile)) blockers.push('single_candidate_manifest_missing')

  let checkpointEvidence = null
  try {
    checkpointEvidence = loadCheckpointEvidence(checkpointPath, fileMap.restoreVerification, {
      currentBranch,
      currentCommit,
      maxAgeHours,
    })
    blockers.push(...list(checkpointEvidence?.blockers))
  } catch (error) {
    blockers.push(`single_checkpoint_validation_error:${val(error?.message || error)}`)
  }
  return { blockers: unique(blockers), checkpointEvidence, files: fileMap }
}

export function buildSingleGate(candidate, {
  candidateManifestSha256,
  approvalToken,
  ttlMinutes = DEFAULT_SINGLE_GATE_TTL_MINUTES,
  now = Date.now(),
} = {}) {
  const expiresAt = new Date(now + ttlMinutes * 60 * 1000).toISOString()
  return canonical({
    generatedAt: new Date(now).toISOString(),
    version: SINGLE_GATE_VERSION,
    candidateId: val(candidate?.candidateId),
    targetId: val(candidate?.target?.id),
    candidateManifestSha256: val(candidateManifestSha256),
    checkpointPath: val(candidate?.checkpointPath),
    currentBranch: val(candidate?.currentBranch),
    currentCommit: val(candidate?.currentCommit),
    approvalTokenFingerprintSha256: sha256Text(approvalToken),
    armedAt: new Date(now).toISOString(),
    expiresAt,
    writeEnabled: true,
    maximumPayloadPatchRequests: 1,
    executeConfirmationRequired: executeConfirmationFor(candidate),
  })
}

export function validateSingleGate(gate, candidate, {
  candidateManifestSha256 = '',
  approvalToken = '',
  now = Date.now(),
} = {}) {
  const blockers = []
  if (val(gate?.version) !== SINGLE_GATE_VERSION) blockers.push('single_gate_version_mismatch')
  if (gate?.writeEnabled !== true) blockers.push('single_gate_write_disabled')
  if (Number(gate?.maximumPayloadPatchRequests) !== 1) blockers.push('single_gate_patch_limit_invalid')
  if (val(gate?.candidateId) !== val(candidate?.candidateId)) blockers.push('single_gate_candidate_mismatch')
  if (val(gate?.targetId) !== val(candidate?.target?.id)) blockers.push('single_gate_target_mismatch')
  if (val(gate?.candidateManifestSha256) !== val(candidateManifestSha256)) blockers.push('single_gate_manifest_hash_mismatch')
  if (val(gate?.checkpointPath) !== val(candidate?.checkpointPath)) blockers.push('single_gate_checkpoint_mismatch')
  if (val(gate?.currentBranch) !== val(candidate?.currentBranch)) blockers.push('single_gate_branch_mismatch')
  if (val(gate?.currentCommit) !== val(candidate?.currentCommit)) blockers.push('single_gate_commit_mismatch')
  if (val(gate?.approvalTokenFingerprintSha256) !== sha256Text(approvalToken)) blockers.push('single_gate_approval_token_mismatch')
  if (val(gate?.executeConfirmationRequired) !== executeConfirmationFor(candidate)) blockers.push('single_gate_execute_confirmation_mismatch')
  const armedAt = Date.parse(val(gate?.armedAt))
  const expiresAt = Date.parse(val(gate?.expiresAt))
  if (!Number.isFinite(armedAt) || !Number.isFinite(expiresAt)) blockers.push('single_gate_time_invalid')
  else {
    if (now < armedAt - 60_000) blockers.push('single_gate_armed_in_future')
    if (now > expiresAt) blockers.push('single_gate_expired')
  }
  return unique(blockers)
}

export function validateCurrentForSingleExecution(candidate, published, latestDraft) {
  const blockers = []
  const row = candidate?.sourceDryRunRow || {}
  const patch = candidate?.expected?.patch || {}
  blockers.push(...validateReadyDryRunRow(row))
  if (!published) blockers.push('single_execute_published_work_missing')
  if (!latestDraft) blockers.push('single_execute_latest_draft_work_missing')
  if (published && val(published?.id) !== val(candidate?.target?.id)) blockers.push('single_execute_published_id_mismatch')
  if (latestDraft && val(latestDraft?.id) !== val(candidate?.target?.id)) blockers.push('single_execute_draft_id_mismatch')
  if (published && val(published?.siteId) !== val(candidate?.target?.siteId)) blockers.push('single_execute_published_site_id_mismatch')
  if (latestDraft && val(latestDraft?.siteId) !== val(candidate?.target?.siteId)) blockers.push('single_execute_draft_site_id_mismatch')

  const alreadyPublished = Boolean(published && patchAlreadyApplied(published, patch))
  const expectations = published && latestDraft ? targetedPublicationExpectations(published, latestDraft) : null
  if (expectations) {
    if (!alreadyPublished && expectations.publishedStateSha256 !== val(row?.observedBefore?.publishedStateSha256)) blockers.push('single_execute_published_state_drift')
    if (expectations.humanStateSha256 !== val(row?.observedBefore?.humanStateSha256)) blockers.push('single_execute_human_state_drift')
    if (expectations.latestDraftRadarSha256 !== val(row?.observedBefore?.latestDraftRadarSha256)) blockers.push('single_execute_draft_radar_drift')
  }
  if (latestDraft && !equal(comparable(radarOf(latestDraft)), comparable(patch?.radarAssessment))) blockers.push('single_execute_draft_radar_differs_from_patch')
  if (targetedPublicationSha256(canonical(patch)) !== val(candidate?.expected?.patchSha256)) blockers.push('single_execute_patch_hash_mismatch')

  const currentHumanTrack = published ? humanTrackRecorded(published) : false
  if (Boolean(candidate?.expected?.humanTrackRecorded) !== currentHumanTrack) blockers.push('single_execute_human_track_presence_drift')
  if (currentHumanTrack) {
    for (const field of COMPATIBILITY_FIELDS) {
      if (field in patch) blockers.push(`single_execute_human_compatibility_patch_forbidden:${field}`)
    }
  }
  const changedFields = published ? fieldChanges(published, patch) : []
  if (!alreadyPublished && !equalStringLists(changedFields, candidate?.expected?.changedFields)) blockers.push('single_execute_changed_fields_drift')
  if (alreadyPublished && changedFields.length) blockers.push('single_execute_already_published_detection_inconsistent')

  const beforeState = published ? targetedPublicationPublishedState(published) : null
  const beforeHuman = published ? targetedPublicationHumanState(published) : null
  const rollbackPatch = {}
  for (const field of list(candidate?.expected?.changedFields)) {
    rollbackPatch[field] = beforeState && field in beforeState ? beforeState[field] : null
  }
  const status = blockers.length ? 'blocked' : alreadyPublished ? 'already_published' : 'ready_to_execute_once'
  return canonical({
    status,
    blockers: unique(blockers),
    changedFields,
    observedBefore: expectations,
    beforePublishedState: beforeState,
    beforeHumanStateSha256: beforeHuman ? targetedPublicationSha256(beforeHuman) : '',
    rollbackPatch,
  })
}

export function verifySingleExecution(candidate, beforePublished, afterPublished, afterDraft) {
  const blockers = []
  const patch = candidate?.expected?.patch || {}
  if (!afterPublished) blockers.push('single_verify_published_missing')
  if (!afterDraft) blockers.push('single_verify_draft_missing')
  if (afterPublished && val(afterPublished?.id) !== val(candidate?.target?.id)) blockers.push('single_verify_published_id_mismatch')
  if (afterDraft && val(afterDraft?.id) !== val(candidate?.target?.id)) blockers.push('single_verify_draft_id_mismatch')
  for (const [key, value] of Object.entries(patch)) {
    if (afterPublished && !equal(comparable(afterPublished?.[key]), comparable(value))) blockers.push(`single_verify_published_field_mismatch:${key}`)
  }
  if (afterDraft && !equal(comparable(radarOf(afterDraft)), comparable(patch?.radarAssessment))) blockers.push('single_verify_latest_draft_radar_mismatch')
  const publishedState = afterPublished ? targetedPublicationPublishedState(afterPublished) : null
  const humanState = afterPublished ? targetedPublicationHumanState(afterPublished) : null
  const beforeHuman = beforePublished ? targetedPublicationHumanState(beforePublished) : null
  const publishedStateSha256 = publishedState ? targetedPublicationSha256(publishedState) : ''
  const humanStateSha256 = humanState ? targetedPublicationSha256(humanState) : ''
  const beforeHumanSha256 = beforeHuman ? targetedPublicationSha256(beforeHuman) : ''
  if (publishedStateSha256 !== val(candidate?.expected?.simulatedAfter?.publishedStateSha256)) blockers.push('single_verify_published_state_hash_mismatch')
  if (humanStateSha256 !== beforeHumanSha256) blockers.push('single_verify_human_state_changed')
  return canonical({
    verified: blockers.length === 0,
    blockers: unique(blockers),
    publishedStateSha256,
    humanStateSha256,
    radarAssessmentSha256: afterPublished ? targetedPublicationSha256(comparable(radarOf(afterPublished))) : '',
  })
}
