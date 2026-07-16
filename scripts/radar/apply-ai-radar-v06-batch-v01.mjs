#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

import {
  V06_BATCH_APPLY_VERSION,
  appendJsonl,
  approvalTokenFor,
  batchSlug,
  candidateActualHashes,
  classifyPlanAgainstWork,
  countBy,
  expectedExecuteConfirmation,
  loadCheckpointEvidence,
  localRuntimePath,
  minimalPatch,
  readJson,
  readJsonl,
  rollbackPatchFor,
  safeBatchId,
  sha256File,
  unique,
  val,
  validateArmedBatchGate,
  validateCandidate,
  writeJson,
  writeJsonl,
} from './lib/v06-batch-release-v01.mjs'
import { currentStateOf, snapshotHash } from './lib/payload-plan-v01.mjs'

const DEFAULT_READINESS_ROOT = 'data_local/staging/ai-radar/v06-batch-readiness-v01'
const DEFAULT_ARMED_ROOT = 'data_local/staging/ai-radar/v06-batch-armed-readiness-v01'
const DEFAULT_EXECUTE_ROOT = 'data_local/staging/ai-radar/v06-batch-execute-runs-v01'

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

function runId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, '')
  return `${stamp}-${randomUUID().slice(0, 8)}`
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return payload
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function login(baseUrl) {
  const email = process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload credentials. Set RADAR_PAYLOAD_EMAIL and RADAR_PAYLOAD_PASSWORD.')
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login did not return a token')
  return result.token
}

async function fetchWork(baseUrl, token, id) {
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(id)}?depth=0&draft=true`, {
    headers: authHeaders(token),
  })
}

async function patchWork(baseUrl, token, id, patch) {
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(id)}?depth=0&draft=true`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  })
}

function outputDirectory({ mode, batchId, requested }) {
  if (requested) return requested
  const slug = batchSlug(batchId)
  if (mode === 'readiness') return path.join(DEFAULT_READINESS_ROOT, slug)
  if (mode === 'armed_readiness') return path.join(DEFAULT_ARMED_ROOT, slug, runId())
  return path.join(DEFAULT_EXECUTE_ROOT, slug, runId())
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const execute = args.execute === true
  if (args.apply || args.confirm || args.limit) throw new Error('Legacy apply/confirm and --limit are rejected.')
  const candidateManifestFile = val(args['candidate-manifest'])
  const checkpointPath = val(args.checkpoint)
  const gateFile = val(args.gate)
  const approvalToken = val(args['approval-token'])
  const executeConfirmation = val(args['execute-confirmation'])
  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  if (!candidateManifestFile || !fs.existsSync(candidateManifestFile)) throw new Error('--candidate-manifest is required and must exist')
  if (!checkpointPath) throw new Error('--checkpoint is required')

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const manifest = readJson(candidateManifestFile)
  const batchId = safeBatchId(manifest?.batchId)
  const manifestHash = sha256File(candidateManifestFile)
  const actual = candidateActualHashes(manifest, checkpointPath)
  const checkpoint = loadCheckpointEvidence(
    checkpointPath,
    localRuntimePath(manifest?.files?.restoreVerification?.path),
    { currentBranch, currentCommit, maxAgeHours: Number(args['max-backup-age-hours'] || 24) },
  )
  const staticBlockers = unique([
    ...validateCandidate(manifest, {
      manifestHash,
      actualHashes: actual.hashes,
      checkpointPath,
      currentBranch,
      currentCommit,
    }),
    ...checkpoint.blockers,
  ])

  const plans = readJsonl(localRuntimePath(manifest?.files?.plan?.path))
  const readyPlans = plans.filter((row) => val(row?.planStatus) === 'ready_for_payload_dry_run')
  const blockedPlans = plans.filter((row) => val(row?.planStatus) === 'blocked')
  const alreadyCurrentPlans = plans.filter((row) => val(row?.planStatus) === 'already_current')
  if (plans.length !== Number(manifest?.expected?.rows)) staticBlockers.push('candidate_plan_row_count_mismatch')
  if (readyPlans.length !== Number(manifest?.expected?.wouldUpdate)) staticBlockers.push('candidate_ready_plan_count_mismatch')
  if (blockedPlans.length !== Number(manifest?.expected?.blocked)) staticBlockers.push('candidate_blocked_plan_count_mismatch')
  if (alreadyCurrentPlans.length !== Number(manifest?.expected?.alreadyCurrent)) staticBlockers.push('candidate_already_current_plan_count_mismatch')

  let gate = null
  const gateBlockers = []
  if (gateFile) {
    if (!fs.existsSync(gateFile)) gateBlockers.push('armed_gate_missing')
    else {
      gate = readJson(gateFile)
      gateBlockers.push(...validateArmedBatchGate(gate, manifest, {
        manifestHash,
        checkpointPath,
        currentBranch,
        currentCommit,
        approvalToken,
      }))
    }
  }
  if (execute && !gateFile) gateBlockers.push('execute_requires_armed_gate')
  if (execute && !approvalToken) gateBlockers.push('execute_requires_approval_token')
  if (execute && executeConfirmation !== expectedExecuteConfirmation(manifest)) gateBlockers.push('execute_confirmation_mismatch')

  const mode = execute ? 'execute' : gateFile ? 'armed_readiness' : 'readiness'
  const outDir = outputDirectory({ mode, batchId, requested: val(args['out-dir']) })
  const outputs = {
    preflight: path.join(outDir, 'preflight.jsonl'),
    journal: path.join(outDir, 'journal.jsonl'),
    applied: path.join(outDir, 'applied.jsonl'),
    rollback: path.join(outDir, 'rollback.jsonl'),
    rollbackStatus: path.join(outDir, 'rollback-status.jsonl'),
    summary: path.join(outDir, 'summary.json'),
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.journal, '', 'utf8')
  fs.writeFileSync(outputs.rollback, '', 'utf8')
  fs.writeFileSync(outputs.rollbackStatus, '', 'utf8')

  let token = ''
  const preflight = []
  if (staticBlockers.length === 0) {
    token = await login(baseUrl)
    for (const plan of readyPlans) {
      const row = {
        workId: val(plan?.workId),
        siteId: val(plan?.siteId),
        title: val(plan?.title),
        targetId: val(plan?.target?.id),
        status: 'drifted',
        changedFields: [],
        blockers: [],
      }
      try {
        const work = await fetchWork(baseUrl, token, row.targetId)
        const classified = classifyPlanAgainstWork(plan, work)
        row.status = classified.status
        row.changedFields = classified.changedFields
        row.blockers = classified.blockers
      } catch (error) {
        row.blockers.push(`preflight_error:${String(error?.message || error).slice(0, 700)}`)
      }
      row.blockers = unique(row.blockers)
      if (row.blockers.length) row.status = 'drifted'
      preflight.push(row)
    }
  }
  writeJsonl(outputs.preflight, preflight)

  const pendingOriginal = preflight.filter((row) => row.status === 'pending_original')
  const alreadyApplied = preflight.filter((row) => row.status === 'already_applied')
  const drifted = preflight.filter((row) => row.status === 'drifted')
  const expectedWrites = Number(manifest?.expected?.wouldUpdate)
  const preflightReady = staticBlockers.length === 0
    && preflight.length === expectedWrites
    && drifted.length === 0
    && pendingOriginal.length + alreadyApplied.length === expectedWrites
  const executionReady = preflightReady && gateBlockers.length === 0 && Boolean(gateFile) && Boolean(approvalToken)

  const appliedRows = []
  let payloadPatchRequests = 0
  let stoppedAfterFailure = false
  if (execute && executionReady) {
    const planByWorkId = new Map(readyPlans.map((plan) => [val(plan?.workId), plan]))
    for (const preflightRow of pendingOriginal) {
      const plan = planByWorkId.get(preflightRow.workId)
      const targetId = val(plan?.target?.id)
      const journal = {
        workId: val(plan?.workId),
        siteId: val(plan?.siteId),
        title: val(plan?.title),
        targetId,
        status: 'pending',
        changedFields: [],
        blockers: [],
      }
      let rollback = null
      try {
        const current = await fetchWork(baseUrl, token, targetId)
        const classified = classifyPlanAgainstWork(plan, current)
        if (classified.status !== 'pending_original') throw new Error(`apply_state_not_pending_original:${classified.status}:${classified.blockers.join('|')}`)
        journal.changedFields = classified.changedFields
        const patch = minimalPatch(plan, journal.changedFields)
        if (!Object.keys(patch).length) throw new Error('no_changed_fields_at_apply_time')
        rollback = {
          version: 'ai-radar-v06-batch-rollback-v0.1',
          batchId,
          candidateId: val(manifest?.candidateId),
          workId: val(plan?.workId),
          siteId: val(plan?.siteId),
          title: val(plan?.title),
          target: plan.target,
          changedFields: journal.changedFields,
          patch: rollbackPatchFor(plan, journal.changedFields),
          expectedCurrentHash: null,
          patchRequestCompleted: false,
          verificationCompleted: false,
          automaticallyExecuted: false,
        }
        appendJsonl(outputs.rollback, rollback)
        payloadPatchRequests += 1
        await patchWork(baseUrl, token, targetId, patch)
        rollback.patchRequestCompleted = true
        appendJsonl(outputs.rollbackStatus, {
          ...rollback,
          status: 'patch_request_completed',
          recordedAt: new Date().toISOString(),
        })

        const verified = await fetchWork(baseUrl, token, targetId)
        const after = classifyPlanAgainstWork(plan, verified)
        if (after.status !== 'already_applied') throw new Error(`post_patch_verification_failed:${after.status}:${after.blockers.join('|')}`)
        journal.status = 'applied_and_verified'
        journal.afterHash = snapshotHash(currentStateOf(verified))
        rollback.expectedCurrentHash = journal.afterHash
        rollback.verificationCompleted = true
        appendJsonl(outputs.rollbackStatus, {
          ...rollback,
          status: 'verification_completed',
          recordedAt: new Date().toISOString(),
        })

        appliedRows.push(journal)
        appendJsonl(outputs.journal, journal)
      } catch (error) {
        const message = String(error?.message || error).slice(0, 800)
        if (rollback) {
          appendJsonl(outputs.rollbackStatus, {
            ...rollback,
            status: rollback.patchRequestCompleted
              ? 'patch_failed_or_unverified'
              : 'patch_request_failed',
            error: message,
            recordedAt: new Date().toISOString(),
          })
        }
        journal.status = rollback ? 'patch_attempt_failed_or_unverified_stop' : 'failed_before_patch_stop'
        journal.blockers.push(message)
        appendJsonl(outputs.journal, journal)
        stoppedAfterFailure = true
        break
      }
    }
  }
  writeJsonl(outputs.applied, appliedRows)

  const completedAfterRun = alreadyApplied.length + appliedRows.length
  const summary = {
    generatedAt: new Date().toISOString(),
    version: V06_BATCH_APPLY_VERSION,
    mode,
    batchId,
    candidateId: val(manifest?.candidateId),
    candidateManifestFile,
    candidateManifestSha256: manifestHash,
    currentBranch,
    currentCommit,
    checkpointPath,
    payloadBaseUrl: baseUrl,
    planRowsRead: plans.length,
    readyPlanRows: readyPlans.length,
    blockedPlanRowsNeverApplied: blockedPlans.length,
    preflightRowsChecked: preflight.length,
    pendingOriginal: pendingOriginal.length,
    alreadyApplied: alreadyApplied.length,
    drifted: drifted.length,
    preflightReady,
    executionReady,
    appliedAndVerified: appliedRows.length,
    completedAfterRun,
    remainingAfterRun: Math.max(0, expectedWrites - completedAfterRun),
    payloadPatchRequests,
    stoppedAfterFailure,
    staticBlockers: unique(staticBlockers),
    gateBlockers: unique(gateBlockers),
    byPreflightStatus: countBy(preflight, (row) => row.status),
    byPreflightBlocker: countBy(preflight.flatMap((row) => row.blockers)),
    outputs,
    safety: {
      payloadRead: staticBlockers.length === 0,
      payloadWrite: execute && payloadPatchRequests > 0,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      blockedPlansNeverApplied: true,
      sequentialPatchOnly: true,
      stopsOnFirstFailure: true,
      verifiesEveryPatch: true,
      rollbackIntentPersistedBeforePatch: true,
      rollbackStatusPersistedAfterPatchOutcome: true,
      automaticRollback: false,
      supportsSafeResumeByStateClassification: true,
      requiresDatabaseCheckpoint: true,
      requiresCandidateFileHashes: true,
      executeRequiresLocalArmedGate: true,
      executeRequiresExplicitConfirmation: true,
    },
    nextStep: execute
      ? (stoppedAfterFailure
          ? 'Inspect journal and rollback evidence. Re-run readiness to classify already-applied, pending and drifted rows before any resume.'
          : (completedAfterRun === expectedWrites ? 'Batch complete. Re-run readiness or the global dry-run to verify the final state.' : 'Batch did not complete; inspect evidence.'))
      : (gateFile
          ? (executionReady ? 'Armed readiness passed. Execute only after a separate explicit final approval.' : 'Armed readiness failed; do not execute.')
          : (preflightReady ? 'Disarmed readiness passed. Use this exact summary to arm the candidate after explicit approval.' : 'Readiness failed; do not arm.')),
  }
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: execute ? executionReady && !stoppedAfterFailure : (gateFile ? executionReady : preflightReady), summary }, null, 2))
  if (!preflightReady) process.exitCode = 2
  else if (gateFile && !executionReady) process.exitCode = 3
  else if (stoppedAfterFailure) process.exitCode = 4
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
