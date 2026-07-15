import {
  V06_BATCH_APPLY_VERSION,
  unique,
  val,
  validateReadinessForArm,
} from './v06-batch-release-v01.mjs'

export function validateReadinessForArmMode(summary, manifest, {
  manifestHash = '',
  currentBranch = '',
  currentCommit = '',
  resume = false,
} = {}) {
  if (!resume) return validateReadinessForArm(summary, manifest, { manifestHash, currentBranch, currentCommit })
  const blockers = []
  if (val(summary?.version) !== V06_BATCH_APPLY_VERSION) blockers.push('readiness_version_mismatch')
  if (val(summary?.mode) !== 'readiness') blockers.push('readiness_mode_mismatch')
  if (val(summary?.candidateId) !== val(manifest?.candidateId)) blockers.push('readiness_candidate_id_mismatch')
  if (val(summary?.candidateManifestSha256) !== val(manifestHash)) blockers.push('readiness_candidate_hash_mismatch')
  if (val(summary?.currentBranch) !== val(currentBranch) || val(summary?.currentCommit) !== val(currentCommit)) blockers.push('readiness_git_state_mismatch')
  const pending = Number(summary?.pendingOriginal)
  const applied = Number(summary?.alreadyApplied)
  const expected = Number(manifest?.expected?.wouldUpdate)
  if (!Number.isInteger(pending) || pending < 1) blockers.push('resume_readiness_has_no_pending_rows')
  if (!Number.isInteger(applied) || applied < 1) blockers.push('resume_readiness_has_no_already_applied_rows')
  if (pending + applied !== expected) blockers.push('resume_readiness_count_mismatch')
  if (Number(summary?.drifted) !== 0 || summary?.preflightReady !== true) blockers.push('resume_readiness_preflight_not_clean')
  if (Number(summary?.payloadPatchRequests) !== 0 || Number(summary?.appliedAndVerified) !== 0) blockers.push('readiness_write_detected')
  if (summary?.safety?.payloadWrite !== false) blockers.push('readiness_payload_write_safety_mismatch')
  return unique(blockers)
}
