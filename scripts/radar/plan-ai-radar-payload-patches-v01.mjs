#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import { buildPlanRow, buildWorkIndexes, val } from './lib/payload-plan-v01.mjs'

const VERSION = 'ai-radar-payload-patch-plan-v0.1'
const DEFAULT_INPUT = 'data_local/staging/ai-radar/first100-complete-v01/ai-radar-first100-resolved-v01.jsonl'
const DEFAULT_METRICS = 'data_local/staging/ai-radar/first100-complete-v01/ai-radar-first100-metrics-v01.json'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/payload-plan-v01'

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

function readJson(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readRows(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const text = fs.readFileSync(file, 'utf8').trim()
  if (!text) return []
  if (file.toLowerCase().endsWith('.jsonl')) return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.docs)) return parsed.docs
  if (Array.isArray(parsed?.items)) return parsed.items
  throw new Error(`Expected JSON array/docs/items: ${file}`)
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : val(value)
  return `"${text.replaceAll('"', '""')}"`
}

function writeCsv(file, rows) {
  const headers = ['workId', 'siteId', 'title', 'targetId', 'targetTitle', 'gradeSuggestion', 'decisiveRuleCode', 'planStatus', 'changedFields', 'blockers', 'warnings']
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.workId,
      row.siteId,
      row.title,
      row.target?.id,
      row.target?.title,
      row.gradeSuggestion,
      row.decisiveRuleCode,
      row.planStatus,
      row.changedFields,
      row.blockers,
      row.warnings,
    ].map(csvCell).join(','))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
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
  const input = String(args.input || DEFAULT_INPUT)
  const metricsFile = String(args.metrics || DEFAULT_METRICS)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const expectedRows = Number(args['expected-rows'] || 100)
  const limit = Number(args.limit || 0)
  const allAssessments = readRows(input)
  const assessments = limit > 0 ? allAssessments.slice(0, limit) : allAssessments
  if (!limit && expectedRows > 0 && allAssessments.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} assessment rows, found ${allAssessments.length}`)
  }

  const metrics = readJson(metricsFile) || {}
  const loaded = await loadWorks(args, baseUrl)
  const indexes = buildWorkIndexes(loaded.works)
  const assessedAt = val(metrics.generatedAt)
  const plans = assessments.map((row) => buildPlanRow(row, indexes, { assessedAt }))
  const ready = plans.filter((row) => row.planStatus === 'ready_for_payload_dry_run')
  const blocked = plans.filter((row) => row.planStatus === 'blocked')
  const alreadyCurrent = plans.filter((row) => row.planStatus === 'already_current')

  const outputs = {
    all: path.join(outDir, 'ai-radar-payload-patch-plan-v01.jsonl'),
    ready: path.join(outDir, 'ai-radar-payload-patch-plan-v01-ready.jsonl'),
    blocked: path.join(outDir, 'ai-radar-payload-patch-plan-v01-blocked.jsonl'),
    alreadyCurrent: path.join(outDir, 'ai-radar-payload-patch-plan-v01-already-current.jsonl'),
    preview: path.join(outDir, 'ai-radar-payload-patch-plan-v01-preview.csv'),
    summary: path.join(outDir, 'ai-radar-payload-patch-plan-v01-summary.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    metricsFile,
    worksSource: loaded.source,
    assessmentRowsRead: allAssessments.length,
    assessmentRowsProcessed: assessments.length,
    payloadWorksRead: loaded.works.length,
    readyForDryRun: ready.length,
    blocked: blocked.length,
    alreadyCurrent: alreadyCurrent.length,
    byPlanStatus: countBy(plans, (row) => row.planStatus),
    byGrade: countBy(plans, (row) => row.gradeSuggestion),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers).map((blocker) => ({ blocker })), (row) => row.blocker),
    byChangedField: countBy(ready.flatMap((row) => row.changedFields).map((field) => ({ field })), (row) => row.field),
    outputs,
    safety: {
      payloadRead: loaded.payloadRead,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      titleOnlyMatchingAllowed: false,
      humanReviewedRowsProtected: true,
      xRowsBlocked: true,
      planOnly: true,
    },
    nextStep: 'Review blocked rows and preview CSV, then run radar:dryrun-payload. No apply script exists in this stage.',
  }

  writeJsonl(outputs.all, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.alreadyCurrent, alreadyCurrent)
  writeCsv(outputs.preview, plans)
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
