#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  changedFieldsAgainstCurrent,
  readJsonl,
  validateApplyPlanRow,
} from './lib/payload-apply-v01.mjs'
import { currentStateOf, snapshotHash, unique, val } from './lib/payload-plan-v01.mjs'

const DEFAULT_PLAN = 'data_local/staging/ai-radar/payload-plan-honest-v01/ai-radar-payload-patch-plan-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/payload-apply-reconcile-v01'

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

function sameSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function countByStatus(rows) {
  const counts = {}
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1
  return counts
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.confirm || args['approval-token'] || args.gate) {
    throw new Error('Reconciliation is read-only. Execute/apply/gate/approval flags are rejected.')
  }

  const planFile = String(args.plan || DEFAULT_PLAN)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const plans = readJsonl(planFile)
  const readyPlans = plans.filter((row) => row.planStatus === 'ready_for_payload_dry_run')
  const token = await login(baseUrl)
  const rows = []

  for (const plan of readyPlans) {
    const row = {
      workId: val(plan?.workId),
      siteId: val(plan?.siteId),
      title: val(plan?.title),
      targetId: val(plan?.target?.id),
      targetSiteId: val(plan?.target?.siteId),
      status: 'unknown',
      blockers: validateApplyPlanRow(plan),
      expectedBeforeHash: val(plan?.expectedBeforeHash),
      currentHash: null,
      expectedChangedFields: [...(plan?.changedFields || [])].sort(),
      remainingChangedFields: [],
    }

    try {
      const work = await fetchWork(baseUrl, token, row.targetId)
      const current = currentStateOf(work)
      row.currentHash = snapshotHash(current)
      row.remainingChangedFields = changedFieldsAgainstCurrent(work, plan).sort()

      if (row.blockers.length) {
        row.status = 'plan_blocked'
      } else if (row.remainingChangedFields.length === 0) {
        row.status = 'already_applied'
      } else if (
        row.currentHash === row.expectedBeforeHash
        && sameSet(row.remainingChangedFields, row.expectedChangedFields)
      ) {
        row.status = 'pending_original_snapshot'
      } else {
        row.status = 'drifted_or_partially_applied'
        if (row.currentHash !== row.expectedBeforeHash) row.blockers.push('current_snapshot_differs_from_original_plan')
        if (!sameSet(row.remainingChangedFields, row.expectedChangedFields)) row.blockers.push('remaining_changed_field_set_differs_from_original_plan')
      }
    } catch (error) {
      row.status = 'fetch_error'
      row.blockers.push(`reconcile_error:${String(error?.message || error).slice(0, 800)}`)
    }

    row.blockers = unique(row.blockers)
    rows.push(row)
  }

  const outputs = {
    rows: path.join(outDir, 'ai-radar-payload-reconcile-v01.jsonl'),
    summary: path.join(outDir, 'ai-radar-payload-reconcile-summary-v01.json'),
  }
  const byStatus = countByStatus(rows)
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-payload-reconcile-v0.1',
    mode: 'read_only_reconcile',
    payloadBaseUrl: baseUrl,
    planFile,
    planRowsRead: plans.length,
    readyPlanRows: readyPlans.length,
    byStatus,
    pendingOriginalSnapshot: Number(byStatus.pending_original_snapshot || 0),
    alreadyApplied: Number(byStatus.already_applied || 0),
    driftedOrPartiallyApplied: Number(byStatus.drifted_or_partially_applied || 0),
    fetchErrors: Number(byStatus.fetch_error || 0),
    safeToResumeAutomatically: Number(byStatus.drifted_or_partially_applied || 0) === 0 && Number(byStatus.fetch_error || 0) === 0,
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      payloadPatchRequests: 0,
      databaseRead: false,
      databaseWrite: false,
    },
    nextStep: Number(byStatus.drifted_or_partially_applied || 0) > 0
      ? 'Inspect drifted_or_partially_applied rows before any further execute attempt.'
      : 'The batch can be resumed with already-applied rows skipped and pending rows revalidated.',
  }

  writeJsonl(outputs.rows, rows)
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
