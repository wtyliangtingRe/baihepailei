#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  APPLY_BATCH_ID,
  APPLY_VERSION,
  approvalTokenFor,
  changedFieldsAgainstCurrent,
  minimalPatch,
  readJson,
  readJsonl,
  rollbackPatchFor,
  sha256File,
  validateApplyPlanRow,
  validateCheckpoint,
  validateDryRunSummary,
  validateExecutionGate,
  verifyCurrentSnapshot,
} from './lib/payload-apply-v01.mjs'
import {
  DEFAULT_ARM_TTL_MINUTES,
  LOCAL_ARM_CONFIRMATION,
  expectedExecuteConfirmation,
  manifestActualHashes,
  validateArmInputs,
  validateArmedLocalGate,
} from './lib/local-arm-v01.mjs'
import { currentStateOf, snapshotHash, unique, val } from './lib/payload-plan-v01.mjs'

const DEFAULT_PLAN = 'data_local/staging/ai-radar/payload-plan-honest-v01/ai-radar-payload-patch-plan-v01.jsonl'
const DEFAULT_DRYRUN = 'data_local/staging/ai-radar/payload-dryrun-honest-v01/ai-radar-payload-patch-dryrun-v01-summary.json'
const DEFAULT_GATE = 'config/ai-radar-release-gate-v01.json'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/payload-apply-v01'

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

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
}

function countBy(values) {
  const counts = {}
  for (const value of values) {
    const key = val(value) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
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

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const execute = args.execute === true
  if (args.apply || args.confirm) throw new Error('Use --execute and --approval-token. Legacy --apply/--confirm flags are rejected.')
  if (execute && args.limit) throw new Error('--limit is forbidden in execute mode')

  const planFile = String(args.plan || DEFAULT_PLAN)
  const dryRunFile = String(args.dryrun || DEFAULT_DRYRUN)
  const gateFile = String(args.gate || DEFAULT_GATE)
  const checkpointPath = val(args.checkpoint)
  const candidateManifestFile = val(args['candidate-manifest'])
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const expectedRows = Number(args['expected-rows'] || 100)
  const expectedWrites = Number(args['expected-writes'] || 94)
  const expectedBlocked = Number(args['expected-blocked'] || 6)
  const maxBackupAgeHours = Number(args['max-backup-age-hours'] || 24)

  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const currentBranch = gitValue(['branch', '--show-current'])
  const planHash = sha256File(planFile)
  const expectedApprovalToken = approvalTokenFor(planHash, APPLY_BATCH_ID)
  const suppliedApprovalToken = val(args['approval-token'])
  const suppliedExecuteConfirmation = val(args['execute-confirmation'])
  const plans = readJsonl(planFile)
  const dryRunSummary = readJson(dryRunFile)
  const gate = readJson(gateFile)
  const localGateRequested = gate?.localOnly === true
  const requireExecutionReady = localGateRequested || args['require-execution-ready'] === true

  let candidateManifest = null
  let candidateManifestHash = ''
  let expectedExecuteConfirmationValue = ''
  let candidateActualHashes = null

  const readyPlans = plans.filter((row) => row.planStatus === 'ready_for_payload_dry_run')
  const protectedPlans = plans.filter((row) => row.planStatus === 'blocked')
  const alreadyCurrentPlans = plans.filter((row) => row.planStatus === 'already_current')

  const staticBlockers = []
  if (!checkpointPath) staticBlockers.push('checkpoint_path_required')
  if (plans.length !== expectedRows) staticBlockers.push(`plan_rows_expected_${expectedRows}_received_${plans.length}`)
  if (readyPlans.length !== expectedWrites) staticBlockers.push(`ready_rows_expected_${expectedWrites}_received_${readyPlans.length}`)
  if (protectedPlans.length !== expectedBlocked) staticBlockers.push(`protected_rows_expected_${expectedBlocked}_received_${protectedPlans.length}`)
  if (alreadyCurrentPlans.length !== 0) staticBlockers.push('plan_contains_already_current_rows')
  staticBlockers.push(...validateDryRunSummary(dryRunSummary, {
    planHash,
    expectedRows,
    expectedWrites,
    expectedBlocked,
  }))

  const checkpoint = checkpointPath
    ? validateCheckpoint(checkpointPath, { currentCommit, currentBranch, maxAgeHours: maxBackupAgeHours })
    : { ok: false, blockers: ['checkpoint_path_required'] }
  staticBlockers.push(...checkpoint.blockers)

  const executionGateBlockers = validateExecutionGate(gate, suppliedApprovalToken)
  if (localGateRequested) {
    if (!candidateManifestFile) {
      executionGateBlockers.push('local_gate_candidate_manifest_required')
    } else if (!fs.existsSync(candidateManifestFile)) {
      executionGateBlockers.push('local_gate_candidate_manifest_missing')
    } else if (checkpointPath) {
      try {
        candidateManifest = readJson(candidateManifestFile)
        candidateManifestHash = sha256File(candidateManifestFile)
        candidateActualHashes = manifestActualHashes(candidateManifest, checkpointPath)
        expectedExecuteConfirmationValue = expectedExecuteConfirmation(candidateManifest?.candidateId)
        executionGateBlockers.push(...validateArmInputs({
          manifest: candidateManifest,
          manifestHash: candidateManifestHash,
          actualHashes: candidateActualHashes.hashes,
          checkpointPath,
          currentBranch,
          currentCommit,
          approvalToken: suppliedApprovalToken,
          confirmation: LOCAL_ARM_CONFIRMATION,
          ttlMinutes: DEFAULT_ARM_TTL_MINUTES,
        }))
        executionGateBlockers.push(...validateArmedLocalGate({
          gate,
          manifest: candidateManifest,
          manifestHash: candidateManifestHash,
          planHash,
          checkpointPath,
          currentBranch,
          currentCommit,
          approvalToken: suppliedApprovalToken,
        }))
      } catch (error) {
        executionGateBlockers.push(`local_gate_candidate_validation_error:${String(error?.message || error).slice(0, 700)}`)
      }
    }
  }

  if (execute && !localGateRequested) executionGateBlockers.push('execute_requires_local_armed_gate')
  if (execute && suppliedApprovalToken !== expectedApprovalToken) executionGateBlockers.push('explicit_approval_token_mismatch')
  if (execute && !suppliedApprovalToken) executionGateBlockers.push('explicit_approval_token_missing')
  if (execute && suppliedExecuteConfirmation !== expectedExecuteConfirmationValue) executionGateBlockers.push('explicit_execute_confirmation_mismatch')

  const outputs = {
    preflightRows: path.join(outDir, 'ai-radar-payload-apply-preflight-v01.jsonl'),
    journal: path.join(outDir, 'ai-radar-payload-apply-journal-v01.jsonl'),
    applied: path.join(outDir, 'ai-radar-payload-apply-applied-v01.jsonl'),
    rollback: path.join(outDir, 'ai-radar-payload-rollback-plan-v01.jsonl'),
    summary: path.join(outDir, 'ai-radar-payload-apply-summary-v01.json'),
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.journal, '', 'utf8')
  fs.writeFileSync(outputs.rollback, '', 'utf8')

  let token = ''
  const preflightRows = []
  if (!staticBlockers.length) {
    token = await login(baseUrl)
    for (const plan of readyPlans) {
      const row = {
        workId: val(plan?.workId),
        siteId: val(plan?.siteId),
        title: val(plan?.title),
        targetId: val(plan?.target?.id),
        targetSiteId: val(plan?.target?.siteId),
        status: 'ready',
        blockers: validateApplyPlanRow(plan),
        changedFields: [],
      }
      try {
        if (!row.blockers.length) {
          const work = await fetchWork(baseUrl, token, row.targetId)
          const snapshot = verifyCurrentSnapshot(work, plan)
          row.blockers.push(...snapshot.blockers)
          row.changedFields = changedFieldsAgainstCurrent(work, plan)
          if (!row.changedFields.length) row.blockers.push('target_already_current_before_apply')
          const expectedFields = [...(plan.changedFields || [])].sort()
          const actualFields = [...row.changedFields].sort()
          if (JSON.stringify(expectedFields) !== JSON.stringify(actualFields)) row.blockers.push('changed_field_set_differs_from_reviewed_plan')
        }
      } catch (error) {
        row.blockers.push(`preflight_error:${String(error?.message || error).slice(0, 700)}`)
      }
      row.blockers = unique(row.blockers)
      if (row.blockers.length) row.status = 'blocked'
      preflightRows.push(row)
    }
  }

  writeJsonl(outputs.preflightRows, preflightRows)
  const preflightBlocked = preflightRows.filter((row) => row.status === 'blocked')
  const preflightReady = staticBlockers.length === 0
    && preflightRows.length === expectedWrites
    && preflightBlocked.length === 0
  const executionReady = preflightReady
    && executionGateBlockers.length === 0
    && suppliedApprovalToken === expectedApprovalToken

  const appliedRows = []
  const rollbackRows = []
  let payloadPatchRequests = 0
  let stoppedAfterFailure = false

  if (execute && executionReady) {
    for (const plan of readyPlans) {
      const targetId = val(plan?.target?.id)
      const journalRow = {
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
        const work = await fetchWork(baseUrl, token, targetId)
        const snapshot = verifyCurrentSnapshot(work, plan)
        if (snapshot.blockers.length) throw new Error(snapshot.blockers.join(','))
        journalRow.changedFields = changedFieldsAgainstCurrent(work, plan)
        const patch = minimalPatch(plan, journalRow.changedFields)
        if (!Object.keys(patch).length) throw new Error('no_changed_fields_at_apply_time')

        rollback = {
          version: 'ai-radar-payload-rollback-plan-v0.1',
          action: 'restore_ai_radar_payload_fields',
          workId: val(plan?.workId),
          siteId: val(plan?.siteId),
          title: val(plan?.title),
          target: plan.target,
          expectedCurrentHash: null,
          changedFields: journalRow.changedFields,
          patch: rollbackPatchFor(plan, journalRow.changedFields),
          patchRequestCompleted: false,
          verificationCompleted: false,
          automaticallyExecuted: false,
        }
        rollbackRows.push(rollback)
        appendJsonl(outputs.rollback, rollback)

        payloadPatchRequests += 1
        await patchWork(baseUrl, token, targetId, patch)
        rollback.patchRequestCompleted = true

        const verified = await fetchWork(baseUrl, token, targetId)
        const remaining = changedFieldsAgainstCurrent(verified, plan)
        if (remaining.length) throw new Error(`post_patch_verification_failed:${remaining.join(',')}`)

        journalRow.status = 'applied_and_verified'
        journalRow.afterHash = snapshotHash(currentStateOf(verified))
        rollback.expectedCurrentHash = journalRow.afterHash
        rollback.verificationCompleted = true
        appliedRows.push(journalRow)
        appendJsonl(outputs.journal, journalRow)
      } catch (error) {
        const message = String(error?.message || error).slice(0, 800)
        journalRow.status = rollback ? 'patch_attempt_failed_or_unverified_stop' : 'failed_before_patch_stop'
        journalRow.blockers.push(message)
        if (rollback) rollback.failure = message
        appendJsonl(outputs.journal, journalRow)
        stoppedAfterFailure = true
        break
      }
    }
  }

  writeJsonl(outputs.applied, appliedRows)
  writeJsonl(outputs.rollback, rollbackRows)
  const commandOk = execute
    ? executionReady && !stoppedAfterFailure
    : (requireExecutionReady ? executionReady : preflightReady)
  const summary = {
    generatedAt: new Date().toISOString(),
    version: APPLY_VERSION,
    batchId: APPLY_BATCH_ID,
    mode: execute ? 'execute' : (localGateRequested ? 'armed_readiness' : 'readiness'),
    currentBranch,
    currentCommit,
    payloadBaseUrl: baseUrl,
    planFile,
    planSha256: planHash,
    dryRunFile,
    gateFile,
    gateLocalOnly: localGateRequested,
    armedGateExpiresAt: localGateRequested ? val(gate?.expiresAt) : null,
    checkpointPath: checkpointPath || null,
    candidateManifestFile: candidateManifestFile || null,
    candidateManifestSha256: candidateManifestHash || null,
    candidateId: val(candidateManifest?.candidateId) || null,
    expectedApprovalToken,
    suppliedApprovalTokenMatched: suppliedApprovalToken === expectedApprovalToken,
    expectedExecuteConfirmation: expectedExecuteConfirmationValue || null,
    suppliedExecuteConfirmationMatched: Boolean(expectedExecuteConfirmationValue) && suppliedExecuteConfirmation === expectedExecuteConfirmationValue,
    planRowsRead: plans.length,
    readyPlanRows: readyPlans.length,
    protectedPlanRows: protectedPlans.length,
    preflightRowsChecked: preflightRows.length,
    preflightReadyRows: preflightRows.filter((row) => row.status === 'ready').length,
    preflightBlockedRows: preflightBlocked.length,
    preflightReady,
    executionReady,
    appliedAndVerified: appliedRows.length,
    payloadPatchRequests,
    stoppedAfterFailure,
    rollbackRowsGenerated: rollbackRows.length,
    staticBlockers: unique(staticBlockers),
    executionGateBlockers: unique(executionGateBlockers),
    byPreflightBlocker: countBy(preflightRows.flatMap((row) => row.blockers)),
    outputs,
    safety: {
      payloadRead: staticBlockers.length === 0,
      payloadWrite: execute && payloadPatchRequests > 0,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      sequentialPatchOnly: true,
      stopsOnFirstFailure: true,
      verifiesEveryPatch: true,
      rollbackIntentPersistedBeforePatch: true,
      automaticRollback: false,
      requiresDatabaseCheckpoint: true,
      requiresExactPlanHashFromDryRun: true,
      requiresExplicitApprovalToken: true,
      releaseGateMustBeEnabled: true,
      executeRequiresLocalArmedGate: true,
      localArmedGateRequiresCandidateManifest: true,
      revalidatesCandidateFileHashes: true,
      armedGateAutoExpires: true,
      executeRequiresCandidateBoundConfirmation: true,
    },
    nextStep: execute
      ? (stoppedAfterFailure ? 'Inspect the journal and rollback plan before any further action.' : 'Inspect the applied journal and verify selected work pages.')
      : (executionReady
          ? 'Armed readiness passed. Do not execute without a separate explicit final approval.'
          : 'Review readiness output. Do not execute until the release gate and exact approval token are explicitly enabled.'),
  }
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: commandOk, summary }, null, 2))

  if (!preflightReady) process.exitCode = 2
  else if ((execute || requireExecutionReady) && !executionReady) process.exitCode = 3
  else if (stoppedAfterFailure) process.exitCode = 4
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
