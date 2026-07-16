#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  buildPlanRow,
  buildWorkIndexes,
  canonical,
  changedFields,
  unique as planUnique,
  val,
} from './lib/payload-plan-v01.mjs'
import {
  assertUnderDataLocal,
  jsonlText,
  readJsonl,
  sha256File,
} from './lib/v06-package-import-v01.mjs'

const VERSION = 'ai-radar-v06-payload-batch-plan-v0.1'
const DEFAULT_INPUT = 'data_local/staging/ai-radar/v06-package-import-v01/ai-radar-v06-package-import-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/v06-payload-plan-v01'

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
  fs.writeFileSync(file, jsonlText(rows), 'utf8')
}

function readRows(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  if (file.toLowerCase().endsWith('.jsonl')) return readJsonl(file)
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.docs)) return parsed.docs
  if (Array.isArray(parsed?.items)) return parsed.items
  throw new Error(`Expected JSONL, JSON array, docs or items: ${file}`)
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

async function loadWorks(args, baseUrl) {
  if (args['works-file']) {
    return { works: readRows(String(args['works-file'])), payloadRead: false, source: String(args['works-file']) }
  }
  const email = process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars. Set RADAR_PAYLOAD_EMAIL and RADAR_PAYLOAD_PASSWORD, or pass --works-file.')
  const login = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!login?.token) throw new Error('Payload login did not return a token')

  const works = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', draft: 'true' })
    const result = await requestJson(`${baseUrl}/api/works?${params}`, {
      headers: { Authorization: `JWT ${login.token}` },
    })
    works.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return { works, payloadRead: true, source: baseUrl }
}

function countBy(rows, getter) {
  const counts = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function addIncomingReviewReasons(plan, assessment) {
  if (!plan?.patch || !Array.isArray(assessment?.reviewReasons) || !assessment.reviewReasons.length) return plan
  const patch = canonical({
    ...plan.patch,
    reviewReasons: planUnique([...(plan.patch.reviewReasons || []), ...assessment.reviewReasons]),
  })
  const changes = changedFields(plan.expectedBefore || {}, patch)
  return canonical({
    ...plan,
    patch,
    changedFields: changes,
    planStatus: plan.blockers?.length
      ? 'blocked'
      : changes.length
        ? 'ready_for_payload_dry_run'
        : 'already_current',
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('v0.6 payload batch planning is read-only. Execute/apply/write flags are rejected.')
  }

  const input = val(args.input) || DEFAULT_INPUT
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  assertUnderDataLocal(outDir)
  const expectedRows = Number(args['expected-rows'] || 10805)
  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  if (!fs.existsSync(input)) throw new Error(`Input file not found: ${input}`)
  const assessments = readJsonl(input)
  if (expectedRows > 0 && assessments.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} assessments, found ${assessments.length}`)
  }

  const loaded = await loadWorks(args, baseUrl)
  const indexes = buildWorkIndexes(loaded.works)
  const plans = assessments.map((assessment) => addIncomingReviewReasons(
    buildPlanRow(assessment, indexes, { assessedAt: val(assessment?.assessedAt) }),
    assessment,
  ))

  const batchesRoot = path.join(outDir, 'batches')
  fs.rmSync(batchesRoot, { recursive: true, force: true })
  const byBatch = new Map()
  for (const plan of plans) {
    const batchId = val(plan?.assessmentBatch) || 'missing-batch'
    if (!byBatch.has(batchId)) byBatch.set(batchId, [])
    byBatch.get(batchId).push(plan)
  }

  const batchSummaries = []
  for (const [batchId, batchPlans] of [...byBatch.entries()].sort()) {
    const dir = path.join(batchesRoot, batchId.toLowerCase())
    const ready = batchPlans.filter((row) => row.planStatus === 'ready_for_payload_dry_run')
    const blocked = batchPlans.filter((row) => row.planStatus === 'blocked')
    const alreadyCurrent = batchPlans.filter((row) => row.planStatus === 'already_current')
    const allFile = path.join(dir, 'payload-plan.jsonl')
    const readyFile = path.join(dir, 'payload-plan-ready.jsonl')
    const blockedFile = path.join(dir, 'payload-plan-blocked.jsonl')
    const alreadyFile = path.join(dir, 'payload-plan-already-current.jsonl')
    writeJsonl(allFile, batchPlans)
    writeJsonl(readyFile, ready)
    writeJsonl(blockedFile, blocked)
    writeJsonl(alreadyFile, alreadyCurrent)
    const dryrunDir = path.join(outDir, 'dryruns', batchId.toLowerCase())
    const summary = {
      batchId,
      rows: batchPlans.length,
      readyForDryRun: ready.length,
      blocked: blocked.length,
      alreadyCurrent: alreadyCurrent.length,
      planFile: allFile,
      planSha256: sha256File(allFile),
      dryrunCommand: `pnpm radar:dryrun-payload -- --input "${allFile}" --out-dir "${dryrunDir}" --expected-rows ${batchPlans.length} --url ${baseUrl}`,
    }
    writeJson(path.join(dir, 'payload-plan-summary.json'), summary)
    batchSummaries.push(summary)
  }

  const ready = plans.filter((row) => row.planStatus === 'ready_for_payload_dry_run')
  const blocked = plans.filter((row) => row.planStatus === 'blocked')
  const alreadyCurrent = plans.filter((row) => row.planStatus === 'already_current')
  const outputs = {
    all: path.join(outDir, 'ai-radar-v06-payload-plan-v01.jsonl'),
    ready: path.join(outDir, 'ai-radar-v06-payload-plan-v01-ready.jsonl'),
    blocked: path.join(outDir, 'ai-radar-v06-payload-plan-v01-blocked.jsonl'),
    alreadyCurrent: path.join(outDir, 'ai-radar-v06-payload-plan-v01-already-current.jsonl'),
    batchManifest: path.join(outDir, 'ai-radar-v06-payload-plan-v01-batches.json'),
    summary: path.join(outDir, 'ai-radar-v06-payload-plan-v01-summary.json'),
    batchesRoot,
  }
  writeJsonl(outputs.all, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.alreadyCurrent, alreadyCurrent)
  writeJson(outputs.batchManifest, {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    batches: batchSummaries,
  })

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    inputSha256: sha256File(input),
    worksSource: loaded.source,
    assessmentRowsRead: assessments.length,
    payloadWorksRead: loaded.works.length,
    batchCount: batchSummaries.length,
    readyForDryRun: ready.length,
    blocked: blocked.length,
    alreadyCurrent: alreadyCurrent.length,
    byGrade: countBy(plans, (row) => row.gradeSuggestion),
    byPlanStatus: countBy(plans, (row) => row.planStatus),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers), (item) => item),
    outputs,
    safety: {
      payloadRead: loaded.payloadRead,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      titleOnlyMatchingAllowed: false,
      humanReviewedRowsProtected: true,
      publicationGuardRowsRemainAiPending: true,
      perBatchPlans: true,
      applyModeExists: false,
    },
    nextStep: 'Run the generated dry-run command for each batch. Do not use the first-100 execute/resume commands for this generalized plan.',
  }
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
