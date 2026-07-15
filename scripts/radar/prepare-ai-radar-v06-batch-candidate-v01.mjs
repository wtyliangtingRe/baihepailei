#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  batchSlug,
  buildBatchCandidate,
  buildDisarmedBatchGate,
  loadCheckpointEvidence,
  loadReviewedBatch,
  safeBatchId,
  unique,
  val,
  writeJson,
} from './lib/v06-batch-release-v01.mjs'

const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-batch-candidates-v01'

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
  if (args.arm || args.execute || args.apply || args.write || args.patch || args.confirm || args['approval-token']) {
    throw new Error('v0.6 candidate preparation is disarmed only. Arm/execute/write flags are rejected.')
  }
  const batchId = safeBatchId(args['batch-id'])
  const checkpointPath = val(args.checkpoint)
  const restoreVerificationFile = val(args['restore-verification'])
  const outRoot = val(args['out-dir']) || DEFAULT_OUT_ROOT
  if (!checkpointPath) throw new Error('--checkpoint is required')
  if (!restoreVerificationFile) throw new Error('--restore-verification is required')
  if (!fs.existsSync(restoreVerificationFile)) throw new Error(`Restore verification not found: ${restoreVerificationFile}`)

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const reviewed = loadReviewedBatch(batchId, {
    planRoot: val(args['plan-root']) || undefined,
    dryRunRoot: val(args['dryrun-root']) || undefined,
  })
  const checkpoint = loadCheckpointEvidence(checkpointPath, restoreVerificationFile, {
    currentBranch,
    currentCommit,
    maxAgeHours: Number(args['max-backup-age-hours'] || 24),
  })
  const blockers = unique([...reviewed.blockers, ...checkpoint.blockers])
  const dir = path.join(outRoot, batchSlug(batchId))
  const outputs = {
    manifest: path.join(dir, 'candidate-manifest.json'),
    disarmedGate: path.join(dir, 'local-gate-disarmed.json'),
    summary: path.join(dir, 'candidate-summary.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-v06-batch-candidate-preparation-v0.1',
    batchId,
    currentBranch,
    currentCommit,
    checkpointPath,
    reviewedRows: reviewed.plans.length,
    reviewedWouldUpdate: reviewed.readyPlans.length,
    reviewedBlocked: reviewed.blockedPlans.length,
    candidateReady: blockers.length === 0,
    blockers,
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      localGateWriteEnabled: false,
      approvalTokenStored: false,
      preparationOnly: true,
    },
  }
  if (blockers.length) {
    writeJson(outputs.summary, summary)
    console.log(JSON.stringify({ ok: false, summary }, null, 2))
    process.exitCode = 2
    return
  }

  const manifest = buildBatchCandidate(reviewed, checkpoint, {
    checkpointPath,
    currentBranch,
    currentCommit,
  })
  writeJson(outputs.manifest, manifest)
  writeJson(outputs.disarmedGate, buildDisarmedBatchGate(manifest))
  writeJson(outputs.summary, { ...summary, candidateId: manifest.candidateId })
  console.log(JSON.stringify({
    ok: true,
    candidateId: manifest.candidateId,
    batchId,
    reviewedRows: manifest.expected.rows,
    wouldUpdate: manifest.expected.wouldUpdate,
    blockedNeverApplied: manifest.expected.blocked,
    currentBranch,
    currentCommit,
    outputs,
    nextStep: `pnpm radar:readiness-v06-batch -- --candidate-manifest "${outputs.manifest}" --checkpoint "${checkpointPath}" --url http://localhost:3000`,
    safety: summary.safety,
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
