#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  DEFAULT_V06_ARM_TTL_MINUTES,
  MAX_V06_ARM_TTL_MINUTES,
  V06_BATCH_ARM_CONFIRMATION,
  approvalTokenFor,
  approvalTokenFingerprint,
  batchSlug,
  buildArmedBatchGate,
  candidateActualHashes,
  expectedExecuteConfirmation,
  loadCheckpointEvidence,
  readJson,
  safeBatchId,
  sha256File,
  sha256Text,
  unique,
  val,
  validateCandidate,
  writeJson,
} from './lib/v06-batch-release-v01.mjs'
import { validateReadinessForArmMode } from './lib/v06-batch-resume-v01.mjs'

const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-batch-arms-v01'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm) {
    throw new Error('This command only arms a local v0.6 batch gate. Execute/write flags are rejected.')
  }
  const resume = args.resume === true
  const candidateManifestFile = val(args['candidate-manifest'])
  const readinessFile = val(args.readiness)
  const checkpointPath = val(args.checkpoint)
  const approvalToken = val(args['approval-token'])
  const confirmation = val(args.confirmation)
  const ttlMinutes = Number(args['ttl-minutes'] || DEFAULT_V06_ARM_TTL_MINUTES)
  const outRoot = val(args['out-dir']) || DEFAULT_OUT_ROOT
  if (!candidateManifestFile || !fs.existsSync(candidateManifestFile)) throw new Error('--candidate-manifest is required and must exist')
  if (!readinessFile || !fs.existsSync(readinessFile)) throw new Error('--readiness is required and must exist')
  if (!checkpointPath) throw new Error('--checkpoint is required')
  if (!approvalToken) throw new Error('--approval-token is required')
  if (!confirmation) throw new Error('--confirmation is required')

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const manifest = readJson(candidateManifestFile)
  const batchId = safeBatchId(manifest?.batchId)
  const manifestHash = sha256File(candidateManifestFile)
  const actual = candidateActualHashes(manifest, checkpointPath)
  const checkpoint = loadCheckpointEvidence(checkpointPath, manifest?.files?.restoreVerification?.path, {
    currentBranch,
    currentCommit,
    maxAgeHours: Number(args['max-backup-age-hours'] || 24),
  })
  const readiness = readJson(readinessFile)
  const planHash = val(manifest?.files?.plan?.sha256)
  const expectedToken = approvalTokenFor(planHash, batchId)
  const blockers = unique([
    ...validateCandidate(manifest, {
      manifestHash,
      actualHashes: actual.hashes,
      checkpointPath,
      currentBranch,
      currentCommit,
    }),
    ...checkpoint.blockers,
    ...validateReadinessForArmMode(readiness, manifest, {
      manifestHash,
      currentBranch,
      currentCommit,
      resume,
    }),
    ...(approvalToken !== expectedToken ? ['local_arm_approval_token_mismatch'] : []),
    ...(val(manifest?.approval?.tokenFingerprintSha256) !== approvalTokenFingerprint(planHash, batchId) ? ['candidate_token_fingerprint_mismatch'] : []),
    ...(confirmation !== V06_BATCH_ARM_CONFIRMATION ? ['local_arm_confirmation_mismatch'] : []),
    ...(!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > MAX_V06_ARM_TTL_MINUTES ? ['local_arm_ttl_out_of_range'] : []),
  ])
  const dir = path.join(outRoot, batchSlug(batchId))
  const outputs = {
    gate: path.join(dir, 'local-gate-armed.json'),
    summary: path.join(dir, 'arm-summary.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-v06-batch-arm-v0.1',
    mode: resume ? 'local_resume_arm_only' : 'local_arm_only',
    resume,
    batchId,
    candidateId: val(manifest?.candidateId),
    candidateManifestFile,
    candidateManifestSha256: manifestHash,
    readinessFile,
    readinessSha256: sha256File(readinessFile),
    checkpointPath,
    currentBranch,
    currentCommit,
    planSha256: planHash,
    readinessPendingOriginal: Number(readiness?.pendingOriginal || 0),
    readinessAlreadyApplied: Number(readiness?.alreadyApplied || 0),
    approvalTokenMatched: approvalToken === expectedToken,
    approvalTokenFingerprintSha256: sha256Text(approvalToken),
    confirmationMatched: confirmation === V06_BATCH_ARM_CONFIRMATION,
    ttlMinutes,
    armed: blockers.length === 0,
    blockers,
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      localFileWriteOnly: true,
      approvalTokenPrinted: false,
      gateExpiresAutomatically: true,
      resumeRequiresAlreadyAppliedAndPendingRows: resume,
      resumeRequiresZeroDrift: true,
      executeModeExists: false,
    },
  }
  if (blockers.length) {
    writeJson(outputs.summary, summary)
    console.log(JSON.stringify({ ok: false, summary }, null, 2))
    process.exitCode = 2
    return
  }

  const gate = buildArmedBatchGate(manifest, {
    manifestHash,
    checkpointPath,
    readinessFile,
    readinessHash: sha256File(readinessFile),
    approvalToken,
    currentBranch,
    currentCommit,
    ttlMinutes,
  })
  writeJson(outputs.gate, gate)
  writeJson(outputs.summary, {
    ...summary,
    armedAt: gate.armedAt,
    expiresAt: gate.expiresAt,
    executeConfirmationRequired: gate.executeConfirmationRequired,
  })
  console.log(JSON.stringify({
    ok: true,
    armed: true,
    resume,
    batchId,
    candidateId: gate.candidateId,
    gateFile: outputs.gate,
    armedAt: gate.armedAt,
    expiresAt: gate.expiresAt,
    executeConfirmationRequired: expectedExecuteConfirmation(manifest),
    approvalTokenStoredLocally: true,
    approvalTokenPrinted: false,
    nextStep: `pnpm radar:readiness-v06-batch -- --candidate-manifest "${candidateManifestFile}" --checkpoint "${checkpointPath}" --gate "${outputs.gate}" --approval-token <same-token> --url http://localhost:3000`,
    safety: summary.safety,
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
