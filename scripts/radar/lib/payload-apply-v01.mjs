import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  ALLOWED_GRADES,
  ALLOWED_REVIEW_REASONS,
  ALLOWED_PATCH_FIELDS,
  canonical,
  currentStateOf,
  equal,
  humanProtectionReasons,
  snapshotHash,
  unique,
  val,
  validatePlanForDryRun,
} from './payload-plan-v01.mjs'

export const APPLY_VERSION = 'ai-radar-payload-apply-v0.1'
export const APPLY_BATCH_ID = 'ai-radar-first-100-v01'

export function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file))
}

export function approvalTokenFor(planHash, batchId = APPLY_BATCH_ID) {
  const hash = val(planHash).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(hash)) throw new Error('A valid SHA-256 plan hash is required')
  return `APPLY-${batchId.toUpperCase()}-${hash.slice(0, 16)}`
}

export function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  return JSON.parse(raw)
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!text) return []
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

export function checkpointFiles(checkpointPath) {
  const root = path.resolve(checkpointPath)
  return {
    root,
    manifest: path.join(root, 'checkpoint-manifest.json'),
    status: path.join(root, 'checkpoint-status.json'),
    checksums: path.join(root, 'sha256-checksums.csv'),
  }
}

export function validateCheckpoint(checkpointPath, {
  currentCommit = '',
  currentBranch = '',
  now = Date.now(),
  maxAgeHours = 24,
} = {}) {
  const files = checkpointFiles(checkpointPath)
  const blockers = []
  for (const [kind, file] of Object.entries(files)) {
    if (kind !== 'root' && !fs.existsSync(file)) blockers.push(`checkpoint_${kind}_missing`)
  }
  if (blockers.length) return { ok: false, blockers: unique(blockers), files }

  const manifest = readJson(files.manifest)
  const status = readJson(files.status)
  if (val(status?.state) !== 'complete') blockers.push('checkpoint_not_complete')
  const checkpointProfile = val(manifest?.checkpointProfile) || 'full_workspace'
  if (manifest?.includesDatabase !== true) blockers.push('checkpoint_database_not_included')
  if (checkpointProfile === 'database_only') {
    if (manifest?.includesWorkspace !== false) blockers.push('checkpoint_database_only_workspace_flag_invalid')
    if (manifest?.includesGitBundle !== false) blockers.push('checkpoint_database_only_git_bundle_flag_invalid')
  } else {
    if (manifest?.includesWorkspace !== true) blockers.push('checkpoint_workspace_not_included')
    if (manifest?.includesGitBundle !== true) blockers.push('checkpoint_git_bundle_not_included')
  }

  const databaseDumpName = val(manifest?.databaseDump)
  const databaseDump = databaseDumpName ? path.join(files.root, databaseDumpName) : ''
  if (!databaseDumpName) blockers.push('checkpoint_database_dump_missing_from_manifest')
  else if (!fs.existsSync(databaseDump)) blockers.push('checkpoint_database_dump_file_missing')
  else if (fs.statSync(databaseDump).size <= 0) blockers.push('checkpoint_database_dump_empty')

  const checksumText = fs.readFileSync(files.checksums, 'utf8')
  if (databaseDumpName && !checksumText.includes(databaseDumpName)) blockers.push('checkpoint_database_dump_not_checksums_listed')

  const createdAt = Date.parse(val(manifest?.createdAt))
  if (!Number.isFinite(createdAt)) blockers.push('checkpoint_created_at_invalid')
  else {
    const ageMs = now - createdAt
    if (ageMs < -5 * 60 * 1000) blockers.push('checkpoint_created_in_future')
    if (ageMs > maxAgeHours * 60 * 60 * 1000) blockers.push('checkpoint_too_old')
  }

  if (val(currentCommit) && val(manifest?.commit) !== val(currentCommit)) blockers.push('checkpoint_commit_mismatch')
  if (val(currentBranch) && val(manifest?.branch) !== val(currentBranch)) blockers.push('checkpoint_branch_mismatch')

  return {
    ok: blockers.length === 0,
    blockers: unique(blockers),
    files: { ...files, databaseDump },
    manifest,
    status,
  }
}

export function validateHonestEvidencePatch(patch) {
  const blockers = []
  const assessment = patch?.radarAssessment || {}
  const status = val(assessment?.evidenceStatus)
  const sourceCount = Number(assessment?.sourceCount)
  if (!Number.isInteger(sourceCount) || sourceCount < 0) blockers.push('invalid_traceable_source_count')
  if (status === 'multiple_secondary_supported' && sourceCount < 2) blockers.push('multiple_secondary_requires_two_traceable_sources')
  if (status === 'single_secondary_supported' && sourceCount < 1) blockers.push('single_secondary_requires_one_traceable_source')
  return unique(blockers)
}

export function validateApplyPlanRow(plan) {
  const blockers = [...validatePlanForDryRun(plan)]
  if (val(plan?.planStatus) !== 'ready_for_payload_dry_run') blockers.push('plan_not_ready_for_apply')
  if ((plan?.blockers || []).length) blockers.push('plan_blockers_present')
  if (!val(plan?.target?.id) || !val(plan?.target?.siteId)) blockers.push('apply_requires_id_and_site_id')
  if (!val(plan?.expectedBeforeHash)) blockers.push('missing_expected_before_hash')
  const preservesHumanTrack = plan?.humanTrackPreserved === true
  if (!preservesHumanTrack && !ALLOWED_GRADES.has(val(plan?.patch?.rank))) blockers.push('invalid_apply_rank')

  if (!preservesHumanTrack) {
    const reviewReasons = Array.isArray(plan?.patch?.reviewReasons)
      ? plan.patch.reviewReasons
      : []
    for (const reason of reviewReasons) {
      const value = val(reason)
      if (!ALLOWED_REVIEW_REASONS.has(value)) {
        blockers.push(`invalid_apply_review_reason:${value || 'missing'}`)
      }
    }
  }

  const matchedRules = Array.isArray(plan?.patch?.radarAssessment?.matchedRules)
    ? plan.patch.radarAssessment.matchedRules
    : []
  for (const [index, rule] of matchedRules.entries()) {
    const grade = val(rule?.grade)
    if (!ALLOWED_GRADES.has(grade)) {
      blockers.push(`invalid_apply_matched_rule_grade:${index}:${grade || 'missing'}`)
    }
  }
  for (const key of Object.keys(plan?.patch || {})) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) blockers.push(`unexpected_apply_field:${key}`)
  }
  blockers.push(...validateHonestEvidencePatch(plan?.patch))
  return unique(blockers)
}

function canonicalInstant(value) {
  if (typeof value !== 'string') return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
}

export function payloadComparable(value, parentKey = '') {
  if (parentKey === 'assessedAt') return canonicalInstant(value)
  if (Array.isArray(value)) return value.map((item) => payloadComparable(item, parentKey))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (key === 'id') return []
      return [[key, payloadComparable(item, key)]]
    }))
  }
  return value
}

export function changedFieldsAgainstCurrent(work, plan) {
  const current = currentStateOf(work)
  const patch = canonical(plan?.patch || {})
  const fields = []
  for (const key of ALLOWED_PATCH_FIELDS) {
    if (key in patch && !equal(payloadComparable(current?.[key], key), payloadComparable(patch?.[key], key))) fields.push(key)
  }
  return fields
}

export function minimalPatch(plan, changedFields) {
  const patch = {}
  for (const field of changedFields) {
    if (field in (plan?.patch || {})) patch[field] = plan.patch[field]
  }
  return canonical(patch)
}

export function rollbackPatchFor(plan, appliedFields = plan?.changedFields || []) {
  const before = plan?.expectedBefore || {}
  const patch = {}
  for (const field of appliedFields) {
    patch[field] = field in before ? before[field] : null
  }
  return canonical(patch)
}

export function verifyCurrentSnapshot(work, plan) {
  const blockers = []
  blockers.push(...humanProtectionReasons(work))
  const current = currentStateOf(work)
  if (snapshotHash(current) !== val(plan?.expectedBeforeHash)) blockers.push('stale_payload_snapshot_before_apply')
  if (val(work?.id) !== val(plan?.target?.id)) blockers.push('payload_id_changed_before_apply')
  if (val(work?.siteId) !== val(plan?.target?.siteId)) blockers.push('site_id_changed_before_apply')
  return { blockers: unique(blockers), current, currentHash: snapshotHash(current) }
}

export function validateDryRunSummary(summary, { planHash, expectedRows = 100, expectedWrites = 94, expectedBlocked = 6 } = {}) {
  const blockers = []
  if (val(summary?.version) !== 'ai-radar-payload-patch-dryrun-v0.1') blockers.push('unexpected_dryrun_version')
  if (Number(summary?.planRowsRead) !== expectedRows) blockers.push('dryrun_row_count_mismatch')
  if (Number(summary?.wouldUpdate) !== expectedWrites) blockers.push('dryrun_would_update_count_mismatch')
  if (Number(summary?.blocked) !== expectedBlocked) blockers.push('dryrun_blocked_count_mismatch')
  if (Number(summary?.alreadyCurrent) !== 0) blockers.push('dryrun_already_current_not_zero')
  if (summary?.safety?.payloadWrite !== false || Number(summary?.safety?.payloadPatchRequests) !== 0) blockers.push('dryrun_write_safety_mismatch')
  if (val(summary?.inputSha256) !== val(planHash)) blockers.push('dryrun_plan_hash_mismatch')
  return unique(blockers)
}

export function validateExecutionGate(gate, approvalToken) {
  const blockers = []
  if (gate?.writeEnabled !== true) blockers.push('release_gate_write_disabled')
  if (gate?.requirements?.sourceProvenanceAuditReviewed !== true) blockers.push('source_provenance_audit_not_reviewed')
  if (!val(gate?.approvalToken)) blockers.push('release_gate_approval_token_missing')
  if (val(gate?.approvalToken) !== val(approvalToken)) blockers.push('release_gate_approval_token_mismatch')
  return unique(blockers)
}
