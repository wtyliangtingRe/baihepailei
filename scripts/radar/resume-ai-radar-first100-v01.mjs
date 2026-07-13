#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

import {
  approvalTokenFor,
  changedFieldsAgainstCurrent,
  minimalPatch,
  readJsonl,
  rollbackPatchFor,
  sha256File,
  validateApplyPlanRow,
  validateCheckpoint,
  verifyCurrentSnapshot,
} from './lib/payload-apply-v01.mjs'
import { currentStateOf, snapshotHash, unique, val } from './lib/payload-plan-v01.mjs'

const DEFAULT_PLAN = 'data_local/staging/ai-radar/payload-plan-honest-v01/ai-radar-payload-patch-plan-v01.jsonl'
const OUTPUT_ROOT = 'data_local/staging/ai-radar/payload-apply-resume-runs-v01'
const RESUME_CONFIRMATION = 'RESUME-AI-RADAR-FIRST-100-93-PATCHES'
const EXPECTED_ROWS = 100
const EXPECTED_READY = 94
const EXPECTED_PROTECTED = 6
const EXPECTED_ALREADY_APPLIED = 1
const EXPECTED_PENDING = 93

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

function required(args, key) {
  const value = args[key]
  if (!value || value === true) throw new Error(`--${key} is required`)
  return String(value)
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8')
}

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function runId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, '')
  return `${stamp}-${randomUUID().slice(0, 8)}`
}

function sameSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
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
  if (!email || !password) throw new Error('Missing Payload login env vars. Set RADAR_PAYLOAD_EMAIL and RADAR_PAYLOAD_PASSWORD.')
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function verifyWithRetry(baseUrl, token, plan) {
  const delays = [0, 250, 500, 1000, 1500]
  let lastRemaining = []
  let lastWork = null
  for (const delay of delays) {
    if (delay) await sleep(delay)
    lastWork = await fetchWork(baseUrl, token, val(plan?.target?.id))
    lastRemaining = changedFieldsAgainstCurrent(lastWork, plan)
    if (!lastRemaining.length) return { ok: true, work: lastWork, attempts: delays.indexOf(delay) + 1, remaining: [] }
  }
  return { ok: false, work: lastWork, attempts: delays.length, remaining: lastRemaining }
}

async function classifyPlan(baseUrl, token, plan) {
  const row = {
    workId: val(plan?.workId),
    siteId: val(plan?.siteId),
    title: val(plan?.title),
    targetId: val(plan?.target?.id),
    status: 'unknown',
    blockers: validateApplyPlanRow(plan),
    remainingChangedFields: [],
  }
  if (row.blockers.length) {
    row.status = 'plan_blocked'
    return row
  }

  try {
    const work = await fetchWork(baseUrl, token, row.targetId)
    const snapshot = verifyCurrentSnapshot(work, plan)
    const nonStaleBlockers = snapshot.blockers.filter((item) => item !== 'stale_payload_snapshot_before_apply')
    row.remainingChangedFields = changedFieldsAgainstCurrent(work, plan).sort()

    if (nonStaleBlockers.length) {
      row.status = 'blocked'
      row.blockers.push(...nonStaleBlockers)
    } else if (!row.remainingChangedFields.length) {
      row.status = 'already_applied'
    } else if (
      snapshot.currentHash === val(plan?.expectedBeforeHash)
      && sameSet(row.remainingChangedFields, plan?.changedFields || [])
    ) {
      row.status = 'pending_original_snapshot'
    } else {
      row.status = 'drifted_or_partially_applied'
      row.blockers.push('resume_requires_original_snapshot_or_semantically_complete_target')
    }
  } catch (error) {
    row.status = 'fetch_error'
    row.blockers.push(`preflight_error:${String(error?.message || error).slice(0, 800)}`)
  }

  row.blockers = unique(row.blockers)
  return row
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args['out-dir'] || args.limit || args.apply || args.confirm) {
    throw new Error('Resume output is isolated automatically; --out-dir, --limit and legacy apply/confirm flags are rejected.')
  }
  if (args.execute !== true) throw new Error('--execute is required for the resume command')

  const checkpointPath = required(args, 'checkpoint')
  const suppliedApprovalToken = required(args, 'approval-token')
  const suppliedConfirmation = required(args, 'confirmation')
  const planFile = String(args.plan || DEFAULT_PLAN)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const currentBranch = gitValue(['branch', '--show-current'])
  const planHash = sha256File(planFile)
  const expectedApprovalToken = approvalTokenFor(planHash)
  const checkpoint = validateCheckpoint(checkpointPath, { currentCommit, currentBranch, maxAgeHours: 24 })
  const plans = readJsonl(planFile)
  const readyPlans = plans.filter((row) => row.planStatus === 'ready_for_payload_dry_run')
  const protectedPlans = plans.filter((row) => row.planStatus === 'blocked')
  const staticBlockers = [...checkpoint.blockers]

  if (plans.length !== EXPECTED_ROWS) staticBlockers.push(`expected_${EXPECTED_ROWS}_plan_rows`)
  if (readyPlans.length !== EXPECTED_READY) staticBlockers.push(`expected_${EXPECTED_READY}_ready_rows`)
  if (protectedPlans.length !== EXPECTED_PROTECTED) staticBlockers.push(`expected_${EXPECTED_PROTECTED}_protected_rows`)
  if (suppliedApprovalToken !== expectedApprovalToken) staticBlockers.push('resume_approval_token_mismatch')
  if (suppliedConfirmation !== RESUME_CONFIRMATION) staticBlockers.push('resume_confirmation_mismatch')
  if (staticBlockers.length) throw new Error(`Resume gate blocked: ${unique(staticBlockers).join(', ')}`)

  const token = await login(baseUrl)
  const preflightRows = []
  for (const plan of readyPlans) preflightRows.push(await classifyPlan(baseUrl, token, plan))

  const alreadyAppliedPlans = []
  const pendingPlans = []
  const unsafeRows = []
  for (let index = 0; index < readyPlans.length; index += 1) {
    const row = preflightRows[index]
    if (row.status === 'already_applied') alreadyAppliedPlans.push(readyPlans[index])
    else if (row.status === 'pending_original_snapshot') pendingPlans.push(readyPlans[index])
    else unsafeRows.push(row)
  }

  if (
    alreadyAppliedPlans.length !== EXPECTED_ALREADY_APPLIED
    || pendingPlans.length !== EXPECTED_PENDING
    || unsafeRows.length !== 0
  ) {
    const reportDir = path.join(OUTPUT_ROOT, `blocked-${runId()}`)
    writeJson(path.join(reportDir, 'resume-preflight-summary.json'), {
      ok: false,
      alreadyApplied: alreadyAppliedPlans.length,
      pendingOriginalSnapshot: pendingPlans.length,
      unsafeRows,
      safety: { payloadWrite: false, payloadPatchRequests: 0 },
    })
    throw new Error(`Resume preflight expected 1 already applied and 93 pending; received ${alreadyAppliedPlans.length} and ${pendingPlans.length}.`)
  }

  const outDir = path.join(OUTPUT_ROOT, runId())
  fs.mkdirSync(outDir, { recursive: false })
  const journalFile = path.join(outDir, 'ai-radar-resume-journal-v01.jsonl')
  const rollbackFile = path.join(outDir, 'ai-radar-resume-rollback-v01.jsonl')
  const summaryFile = path.join(outDir, 'ai-radar-resume-summary-v01.json')
  const preflightFile = path.join(outDir, 'ai-radar-resume-preflight-v01.json')
  writeJson(preflightFile, preflightRows)

  let payloadPatchRequests = 0
  let appliedAndVerifiedThisRun = 0
  let stoppedAfterFailure = false
  let failedRow = null

  for (const plan of pendingPlans) {
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

    try {
      const current = await fetchWork(baseUrl, token, targetId)
      const snapshot = verifyCurrentSnapshot(current, plan)
      if (snapshot.blockers.length) throw new Error(snapshot.blockers.join(','))
      journal.changedFields = changedFieldsAgainstCurrent(current, plan)
      if (!sameSet(journal.changedFields, plan?.changedFields || [])) {
        throw new Error('changed_field_set_differs_before_resume_patch')
      }
      const patch = minimalPatch(plan, journal.changedFields)
      const rollback = {
        version: 'ai-radar-payload-rollback-plan-v0.1',
        action: 'restore_ai_radar_payload_fields',
        workId: val(plan?.workId),
        siteId: val(plan?.siteId),
        title: val(plan?.title),
        target: plan.target,
        changedFields: journal.changedFields,
        patch: rollbackPatchFor(plan, journal.changedFields),
        patchRequestCompleted: false,
        verificationCompleted: false,
        automaticallyExecuted: false,
      }
      appendJsonl(rollbackFile, rollback)

      payloadPatchRequests += 1
      await patchWork(baseUrl, token, targetId, patch)
      rollback.patchRequestCompleted = true

      const verification = await verifyWithRetry(baseUrl, token, plan)
      journal.verificationAttempts = verification.attempts
      if (!verification.ok) throw new Error(`post_patch_verification_failed:${verification.remaining.join(',')}`)

      journal.status = 'applied_and_verified'
      journal.afterHash = snapshotHash(currentStateOf(verification.work))
      appliedAndVerifiedThisRun += 1
      appendJsonl(journalFile, journal)
    } catch (error) {
      journal.status = 'failed_stop'
      journal.blockers.push(String(error?.message || error).slice(0, 1000))
      appendJsonl(journalFile, journal)
      stoppedAfterFailure = true
      failedRow = journal
      break
    }
  }

  const totalAppliedOrVerified = alreadyAppliedPlans.length + appliedAndVerifiedThisRun
  const ok = !stoppedAfterFailure
    && payloadPatchRequests === EXPECTED_PENDING
    && appliedAndVerifiedThisRun === EXPECTED_PENDING
    && totalAppliedOrVerified === EXPECTED_READY

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-first100-resume-v0.1',
    mode: 'resume_execute',
    currentBranch,
    currentCommit,
    checkpointPath,
    planSha256: planHash,
    outputDirectory: outDir,
    alreadyAppliedBeforeRun: alreadyAppliedPlans.length,
    pendingAtStart: pendingPlans.length,
    appliedAndVerifiedThisRun,
    totalAppliedOrVerified,
    payloadPatchRequests,
    protectedRows: protectedPlans.length,
    stoppedAfterFailure,
    failedRow,
    safety: {
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      sequentialPatchOnly: true,
      stopsOnFirstFailure: true,
      verifiesWithRetry: true,
      rollbackIntentPersistedBeforePatch: true,
      automaticRollback: false,
      isolatedEvidenceDirectory: true,
    },
  }
  writeJson(summaryFile, summary)
  console.log(JSON.stringify({ ok, summary }, null, 2))
  if (!ok) process.exitCode = 4
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
