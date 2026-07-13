#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import { sha256File } from './lib/payload-apply-v01.mjs'
import { buildWorkIndexes, dryRunPlanRow, val } from './lib/payload-plan-v01.mjs'

const VERSION = 'ai-radar-payload-patch-dryrun-v0.1'
const DEFAULT_INPUT = 'data_local/staging/ai-radar/payload-plan-v01/ai-radar-payload-patch-plan-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/payload-dryrun-v01'

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

function readRows(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const text = fs.readFileSync(file, 'utf8').trim()
  if (!text) return []
  if (file.toLowerCase().endsWith('.jsonl')) return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.docs)) return parsed.docs
  throw new Error(`Expected JSON array/docs: ${file}`)
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function countBy(rows, selector) {
  const counts = {}
  for (const row of rows) {
    const key = val(selector(row)) || 'missing'
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

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', draft: 'true' })
    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

async function loadWorks(args, baseUrl) {
  if (args['works-file']) return { works: readRows(String(args['works-file'])), payloadRead: false, source: String(args['works-file']) }
  const email = process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars. Set RADAR_PAYLOAD_EMAIL and RADAR_PAYLOAD_PASSWORD, or pass --works-file.')
  const login = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  if (!login?.token) throw new Error('Payload login did not return a token')
  return { works: await fetchAllWorks(baseUrl, login.token), payloadRead: true, source: baseUrl }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply || args.confirm) throw new Error('This command is dry-run only. It has no apply mode.')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const expectedRows = Number(args['expected-rows'] || 100)
  const inputSha256 = sha256File(input)
  const plans = readRows(input)
  if (expectedRows > 0 && plans.length !== expectedRows) throw new Error(`Expected ${expectedRows} plan rows, found ${plans.length}`)
  const loaded = await loadWorks(args, baseUrl)
  const indexes = buildWorkIndexes(loaded.works)
  const results = plans.map((plan) => {
    if (plan.planStatus !== 'ready_for_payload_dry_run') {
      return {
        workId: val(plan.workId),
        siteId: val(plan.siteId),
        title: val(plan.title),
        target: plan.target,
        status: plan.planStatus === 'already_current' ? 'already_current' : 'blocked',
        remainingChangedFields: [],
        blockers: plan.planStatus === 'blocked' ? plan.blockers : [`plan_status:${val(plan.planStatus)}`],
        warnings: plan.warnings || [],
        safety: { payloadRead: true, payloadWrite: false, payloadPatchRequests: 0, directPostgresqlWrite: false },
      }
    }
    return dryRunPlanRow(plan, indexes)
  })

  const wouldUpdate = results.filter((row) => row.status === 'would_update')
  const blocked = results.filter((row) => row.status === 'blocked')
  const alreadyCurrent = results.filter((row) => row.status === 'already_current')
  const outputs = {
    all: path.join(outDir, 'ai-radar-payload-patch-dryrun-v01.jsonl'),
    wouldUpdate: path.join(outDir, 'ai-radar-payload-patch-dryrun-v01-would-update.jsonl'),
    blocked: path.join(outDir, 'ai-radar-payload-patch-dryrun-v01-blocked.jsonl'),
    alreadyCurrent: path.join(outDir, 'ai-radar-payload-patch-dryrun-v01-already-current.jsonl'),
    summary: path.join(outDir, 'ai-radar-payload-patch-dryrun-v01-summary.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    inputSha256,
    worksSource: loaded.source,
    planRowsRead: plans.length,
    payloadWorksRead: loaded.works.length,
    wouldUpdate: wouldUpdate.length,
    blocked: blocked.length,
    alreadyCurrent: alreadyCurrent.length,
    byStatus: countBy(results, (row) => row.status),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers).map((blocker) => ({ blocker })), (row) => row.blocker),
    byRemainingChangedField: countBy(wouldUpdate.flatMap((row) => row.remainingChangedFields).map((field) => ({ field })), (row) => row.field),
    outputs,
    safety: {
      payloadRead: loaded.payloadRead,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      applyModeExists: false,
      staleSnapshotsBlocked: true,
      titleOnlyMatchingAllowed: false,
      exactPlanHashRecorded: true,
    },
    nextStep: 'Review this dry-run output. A separate, explicitly guarded apply stage may be designed only after approval.',
  }
  writeJsonl(outputs.all, results)
  writeJsonl(outputs.wouldUpdate, wouldUpdate)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.alreadyCurrent, alreadyCurrent)
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
