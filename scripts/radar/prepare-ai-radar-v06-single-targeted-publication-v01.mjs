#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { loadCheckpointEvidence } from './lib/v06-batch-release-v01.mjs'
import {
  SINGLE_ARM_CONFIRMATION,
  approvalScopeFor,
  buildSingleCandidate,
  newestFile,
  readJsonl,
  selectSingleReadyRow,
  val,
  writeJson,
} from './lib/v06-single-targeted-publication-v01.mjs'

const DEFAULT_DRYRUN_ROOT = 'data_local/staging/ai-radar/v06-targeted-publication-dryrun-v01'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-single-targeted-publication-v01'

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
  if (args.arm || args.execute || args.apply || args.write || args.patch || args.publish || args.confirm || args['approval-token']) {
    throw new Error('Single publication candidate preparation is read-only. Arm/execute/write/publish flags are rejected.')
  }
  const checkpointPath = val(args.checkpoint)
  const restoreVerificationFile = val(args['restore-verification'])
  if (!checkpointPath) throw new Error('--checkpoint is required')
  if (!restoreVerificationFile || !fs.existsSync(restoreVerificationFile)) throw new Error('--restore-verification is required and must exist')

  const dryRunFile = val(args['dryrun-file']) || newestFile(val(args['dryrun-root']) || DEFAULT_DRYRUN_ROOT, 'ready-for-targeted-publication.jsonl')
  if (!dryRunFile) throw new Error('No ready-for-targeted-publication.jsonl was found. Run the targeted publication dry-run first or pass --dryrun-file.')
  const rows = readJsonl(dryRunFile)
  const selected = selectSingleReadyRow(rows, val(args['work-id']))

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const checkpoint = loadCheckpointEvidence(checkpointPath, restoreVerificationFile, {
    currentBranch,
    currentCommit,
    maxAgeHours: Number(args['max-backup-age-hours'] || 24),
  })
  if (checkpoint.blockers.length) throw new Error(`Checkpoint validation failed: ${checkpoint.blockers.join(', ')}`)

  const candidate = buildSingleCandidate(selected, checkpoint, {
    dryRunFile,
    checkpointPath,
    currentBranch,
    currentCommit,
  })
  const outRoot = val(args['out-dir']) || DEFAULT_OUT_ROOT
  const outDir = path.join(outRoot, candidate.candidateId.toLowerCase())
  if (fs.existsSync(outDir)) throw new Error(`Refusing to reuse existing candidate directory: ${outDir}`)
  const outputs = {
    candidateManifest: path.join(outDir, 'candidate-manifest.json'),
    disarmedGate: path.join(outDir, 'local-gate-disarmed.json'),
    summary: path.join(outDir, 'candidate-summary.json'),
  }
  writeJson(outputs.candidateManifest, candidate)
  writeJson(outputs.disarmedGate, {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-v06-single-targeted-publication-gate-v0.1',
    candidateId: candidate.candidateId,
    targetId: candidate.target.id,
    writeEnabled: false,
    maximumPayloadPatchRequests: 0,
    reason: 'candidate_preparation_is_disarmed',
  })

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-v06-single-targeted-publication-candidate-preparation-v0.1',
    candidateReady: true,
    candidateId: candidate.candidateId,
    target: candidate.target,
    suggestedGrade: val(candidate?.expected?.patch?.radarAssessment?.suggestedGrade),
    changedFields: candidate.expected.changedFields,
    dryRunRowsRead: rows.length,
    selectedWorkId: val(selected?.workId),
    checkpointPath,
    currentBranch,
    currentCommit,
    approvalScope: approvalScopeFor(candidate),
    approvalTokenPrinted: false,
    armConfirmationRequired: SINGLE_ARM_CONFIRMATION,
    executeConfirmationRequired: candidate.executeConfirmationRequired,
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      localFilesOnly: true,
      wholeDraftPublicationForbidden: true,
      maximumFuturePatchRequests: 1,
    },
  }
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({
    ok: true,
    summary,
    nextStep: 'Inspect the selected target, derive the approval token from the candidate dry-run hash, then arm the short-lived local gate. No write has occurred.',
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
