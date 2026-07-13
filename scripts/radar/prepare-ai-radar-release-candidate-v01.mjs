#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { readJson } from './lib/payload-apply-v01.mjs'
import {
  buildDisarmedLocalGate,
  buildReleaseCandidateManifest,
  loadReleaseCandidateFiles,
  validateReleaseCandidateInputs,
} from './lib/release-candidate-v01.mjs'
import { unique, val } from './lib/payload-plan-v01.mjs'

const DEFAULT_PLAN = 'data_local/staging/ai-radar/payload-plan-honest-v01/ai-radar-payload-patch-plan-v01.jsonl'
const DEFAULT_DRYRUN = 'data_local/staging/ai-radar/payload-dryrun-honest-v01/ai-radar-payload-patch-dryrun-v01-summary.json'
const DEFAULT_SOURCE_AUDIT = 'data_local/staging/ai-radar/source-provenance-audit-honest-v01/ai-radar-source-provenance-audit-v01-summary.json'
const DEFAULT_RESTORE_VERIFICATION = 'data_local/staging/ai-radar/release-candidate-v01/database-restore-verification-v01.json'
const DEFAULT_GATE = 'config/ai-radar-release-gate-v01.json'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/release-candidate-v01'

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function requireFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.arm || args.execute || args.apply || args.confirm || args['approval-token']) {
    throw new Error('Release candidate preparation is disarmed only. Arm/execute/approval flags are rejected.')
  }

  const planFile = String(args.plan || DEFAULT_PLAN)
  const dryRunFile = String(args.dryrun || DEFAULT_DRYRUN)
  const sourceAuditFile = String(args['source-audit'] || DEFAULT_SOURCE_AUDIT)
  const checkpointPath = val(args.checkpoint)
  const restoreVerificationFile = String(args['restore-verification'] || DEFAULT_RESTORE_VERIFICATION)
  const gateFile = String(args.gate || DEFAULT_GATE)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)

  if (!checkpointPath) throw new Error('--checkpoint is required')
  requireFile(planFile, 'Plan')
  requireFile(dryRunFile, 'Dry-run summary')
  requireFile(sourceAuditFile, 'Source provenance audit summary')
  requireFile(restoreVerificationFile, 'Database restore verification')
  requireFile(gateFile, 'Checked-in release gate')

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const loaded = loadReleaseCandidateFiles({
    planFile,
    dryRunFile,
    sourceAuditFile,
    checkpointPath,
    restoreVerificationFile,
  })

  const blockers = validateReleaseCandidateInputs({
    planHash: loaded.hashes.plan,
    dryRunSummary: loaded.dryRunSummary,
    sourceAuditSummary: loaded.sourceAuditSummary,
    checkpointManifest: loaded.checkpointManifest,
    checkpointStatus: loaded.checkpointStatus,
    checkpointDumpSize: loaded.checkpointDumpSize,
    checkpointDumpHash: loaded.hashes.checkpointDump,
    checkpointChecksumHash: loaded.hashes.checkpointChecksums,
    restoreVerification: loaded.restoreVerification,
    currentBranch,
    currentCommit,
  })

  if (loaded.restoreVerification?.checkpointBranch !== currentBranch) blockers.push('restore_verification_branch_mismatch')
  if (loaded.restoreVerification?.checkpointCommit !== currentCommit) blockers.push('restore_verification_commit_mismatch')

  const outputs = {
    manifest: path.join(outDir, 'ai-radar-release-candidate-manifest-v01.json'),
    localGate: path.join(outDir, 'ai-radar-release-gate-local-disarmed-v01.json'),
    summary: path.join(outDir, 'ai-radar-release-candidate-summary-v01.json'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-release-candidate-preparation-v0.1',
    currentBranch,
    currentCommit,
    checkpointPath,
    candidateReady: unique(blockers).length === 0,
    blockers: unique(blockers),
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      databaseRead: false,
      databaseWrite: false,
      dumpArchiveRead: false,
      localGateWriteEnabled: false,
      approvalTokenStored: false,
      preparationOnly: true,
    },
  }

  if (!summary.candidateReady) {
    writeJson(outputs.summary, summary)
    console.log(JSON.stringify({ ok: false, summary }, null, 2))
    process.exitCode = 2
    return
  }

  const manifest = buildReleaseCandidateManifest({
    planFile,
    planHash: loaded.hashes.plan,
    dryRunFile,
    dryRunHash: loaded.hashes.dryRun,
    sourceAuditFile,
    sourceAuditHash: loaded.hashes.sourceAudit,
    checkpointPath,
    checkpointManifestHash: loaded.hashes.checkpointManifest,
    checkpointStatusHash: loaded.hashes.checkpointStatus,
    checkpointChecksumsHash: loaded.hashes.checkpointChecksums,
    checkpointDumpFile: loaded.checkpointDumpFile,
    checkpointDumpHash: loaded.hashes.checkpointDump,
    checkpointDumpSize: loaded.checkpointDumpSize,
    restoreVerificationFile,
    restoreVerificationHash: loaded.hashes.restoreVerification,
    restoreVerification: loaded.restoreVerification,
    currentBranch,
    currentCommit,
    dryRunSummary: loaded.dryRunSummary,
    sourceAuditSummary: loaded.sourceAuditSummary,
  })

  const checkedInGate = readJson(gateFile)
  const localGate = buildDisarmedLocalGate(checkedInGate, { planHash: loaded.hashes.plan })
  writeJson(outputs.manifest, manifest)
  writeJson(outputs.localGate, localGate)
  writeJson(outputs.summary, { ...summary, candidateId: manifest.candidateId })

  console.log(JSON.stringify({
    ok: true,
    candidateId: manifest.candidateId,
    currentBranch,
    currentCommit,
    planSha256: loaded.hashes.plan,
    checkpointDumpSha256: loaded.hashes.checkpointDump,
    databaseRestoreListEntries: loaded.restoreVerification.listEntryCount,
    localGateWriteEnabled: localGate.writeEnabled,
    approvalTokenStored: Boolean(localGate.approvalToken),
    outputs,
    safety: summary.safety,
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
