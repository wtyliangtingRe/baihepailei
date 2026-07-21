#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { sha256File } from './lib/payload-apply-v01.mjs'
import {
  DEFAULT_SINGLE_GATE_TTL_MINUTES,
  MAX_SINGLE_GATE_TTL_MINUTES,
  SINGLE_ARM_CONFIRMATION,
  approvalTokenForCandidate,
  buildSingleGate,
  readJson,
  sha256Text,
  unique,
  validateSingleCandidate,
  writeJson,
} from './lib/v06-single-targeted-publication-v01.mjs'

function val(value) {
  return String(value ?? '').trim()
}

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
  if (args.execute || args.apply || args.write || args.patch || args.publish || args.confirm) {
    throw new Error('This command only arms a local single-publication gate. Execute/write/publish flags are rejected.')
  }
  const candidateManifestFile = val(args['candidate-manifest'])
  const checkpointPath = val(args.checkpoint)
  const approvalToken = val(args['approval-token'])
  const confirmation = val(args.confirmation)
  const ttlMinutes = Number(args['ttl-minutes'] || DEFAULT_SINGLE_GATE_TTL_MINUTES)
  if (!candidateManifestFile || !fs.existsSync(candidateManifestFile)) throw new Error('--candidate-manifest is required and must exist')
  if (!checkpointPath) throw new Error('--checkpoint is required')
  if (!approvalToken) throw new Error('--approval-token is required')
  if (!confirmation) throw new Error('--confirmation is required')

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const candidate = readJson(candidateManifestFile)
  const candidateManifestSha256 = sha256File(candidateManifestFile)
  const validated = validateSingleCandidate(candidate, {
    candidateManifestFile,
    checkpointPath,
    currentBranch,
    currentCommit,
    maxAgeHours: Number(args['max-backup-age-hours'] || 24),
  })
  const expectedToken = approvalTokenForCandidate(candidate)
  const blockers = unique([
    ...validated.blockers,
    ...(approvalToken !== expectedToken ? ['single_arm_approval_token_mismatch'] : []),
    ...(confirmation !== SINGLE_ARM_CONFIRMATION ? ['single_arm_confirmation_mismatch'] : []),
    ...(!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > MAX_SINGLE_GATE_TTL_MINUTES ? ['single_arm_ttl_out_of_range'] : []),
  ])

  const outDir = val(args['out-dir']) || path.dirname(candidateManifestFile)
  const outputs = {
    gate: path.join(outDir, 'local-gate-armed.json'),
    summary: path.join(outDir, 'arm-summary.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-v06-single-targeted-publication-arm-v0.1',
    candidateId: val(candidate?.candidateId),
    target: candidate?.target || null,
    candidateManifestFile,
    candidateManifestSha256,
    checkpointPath,
    currentBranch,
    currentCommit,
    ttlMinutes,
    approvalTokenMatched: approvalToken === expectedToken,
    approvalTokenFingerprintSha256: sha256Text(approvalToken),
    approvalTokenPrinted: false,
    confirmationMatched: confirmation === SINGLE_ARM_CONFIRMATION,
    armed: blockers.length === 0,
    blockers,
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      localFileWriteOnly: true,
      gateExpiresAutomatically: true,
      maximumFuturePatchRequests: 1,
    },
  }
  if (blockers.length) {
    writeJson(outputs.summary, summary)
    console.log(JSON.stringify({ ok: false, summary }, null, 2))
    process.exitCode = 2
    return
  }

  const gate = buildSingleGate(candidate, {
    candidateManifestSha256,
    approvalToken,
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
    candidateId: gate.candidateId,
    targetId: gate.targetId,
    gateFile: outputs.gate,
    armedAt: gate.armedAt,
    expiresAt: gate.expiresAt,
    executeConfirmationRequired: gate.executeConfirmationRequired,
    approvalTokenPrinted: false,
    safety: summary.safety,
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
