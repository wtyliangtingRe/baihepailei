#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { approvalTokenFor, readJson, sha256File } from './lib/payload-apply-v01.mjs'
import {
  DEFAULT_ARM_TTL_MINUTES,
  LOCAL_ARM_CONFIRMATION,
  buildArmedLocalGate,
  manifestActualHashes,
  validateArmInputs,
} from './lib/local-arm-v01.mjs'
import { RELEASE_CANDIDATE_BATCH_ID, sha256Text } from './lib/release-candidate-v01.mjs'
import { unique, val } from './lib/payload-plan-v01.mjs'

const DEFAULT_MANIFEST = 'data_local/staging/ai-radar/release-candidate-v01/ai-radar-release-candidate-manifest-v01.json'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/release-arm-v01'

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function assertOutputUnderDataLocal(file) {
  const dataRoot = path.resolve('data_local')
  const resolved = path.resolve(file)
  const prefix = `${dataRoot}${path.sep}`
  if (resolved !== dataRoot && !resolved.startsWith(prefix)) {
    throw new Error('Armed gate output must remain under ignored data_local.')
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.confirm) {
    throw new Error('This command only arms a local gate. Execute/apply/legacy confirm flags are rejected.')
  }

  const manifestFile = String(args.manifest || DEFAULT_MANIFEST)
  const checkpointPath = val(args.checkpoint)
  const approvalToken = val(args['approval-token'])
  const confirmation = val(args.confirmation)
  const ttlMinutes = Number(args['ttl-minutes'] || DEFAULT_ARM_TTL_MINUTES)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const gateFile = path.join(outDir, 'ai-radar-release-gate-local-armed-v01.json')
  const summaryFile = path.join(outDir, 'ai-radar-release-arm-summary-v01.json')

  assertOutputUnderDataLocal(gateFile)
  assertOutputUnderDataLocal(summaryFile)
  if (!checkpointPath) throw new Error('--checkpoint is required')
  if (!approvalToken) throw new Error('--approval-token is required')
  if (!confirmation) throw new Error('--confirmation is required')
  if (!fs.existsSync(manifestFile)) throw new Error(`Release candidate manifest not found: ${manifestFile}`)

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const manifest = readJson(manifestFile)
  const manifestHash = sha256File(manifestFile)
  const loaded = manifestActualHashes(manifest, checkpointPath)
  const blockers = validateArmInputs({
    manifest,
    manifestHash,
    actualHashes: loaded.hashes,
    checkpointPath,
    currentBranch,
    currentCommit,
    approvalToken,
    confirmation,
    ttlMinutes,
  })

  const planHash = val(manifest?.files?.plan?.sha256)
  const expectedApprovalToken = approvalTokenFor(planHash, RELEASE_CANDIDATE_BATCH_ID)
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-local-release-arm-v0.1',
    mode: 'local_arm_only',
    currentBranch,
    currentCommit,
    candidateId: val(manifest?.candidateId),
    candidateManifestFile: manifestFile,
    candidateManifestSha256: manifestHash,
    checkpointPath,
    planSha256: planHash,
    approvalTokenMatched: approvalToken === expectedApprovalToken,
    approvalTokenFingerprintSha256: sha256Text(approvalToken),
    confirmationMatched: confirmation === LOCAL_ARM_CONFIRMATION,
    ttlMinutes,
    armed: blockers.length === 0,
    blockers: unique(blockers),
    outputs: { gate: gateFile, summary: summaryFile },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      databaseRead: false,
      databaseWrite: false,
      localFileWriteOnly: true,
      outputRestrictedToDataLocal: true,
      executeModeExists: false,
      gateExpiresAutomatically: true,
      approvalTokenPrinted: false,
    },
  }

  if (blockers.length) {
    writeJson(summaryFile, summary)
    console.log(JSON.stringify({ ok: false, summary }, null, 2))
    process.exitCode = 2
    return
  }

  const gate = buildArmedLocalGate(manifest, {
    manifestHash,
    checkpointPath,
    approvalToken,
    currentBranch,
    currentCommit,
    ttlMinutes,
  })
  writeJson(gateFile, gate)
  writeJson(summaryFile, {
    ...summary,
    armedAt: gate.armedAt,
    expiresAt: gate.expiresAt,
    executeConfirmationRequired: gate.executeConfirmationRequired,
  })

  console.log(JSON.stringify({
    ok: true,
    armed: true,
    candidateId: gate.candidateId,
    currentBranch,
    currentCommit,
    gateFile,
    armedAt: gate.armedAt,
    expiresAt: gate.expiresAt,
    executeConfirmationRequired: gate.executeConfirmationRequired,
    approvalTokenStoredLocally: true,
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
