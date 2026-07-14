#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  V06_DRYRUN_VERSION,
  buildIndexes,
  countBy,
  dryRunBatchPlans,
  readJson,
  summarizeDryRunResults,
  unique,
  validateBatchManifest,
  writeJson,
  writeJsonl,
} from './lib/v06-payload-dryrun-v01.mjs'
import {
  assertUnderDataLocal,
  readJsonl,
  sha256File,
} from './lib/v06-package-import-v01.mjs'
import { val } from './lib/payload-plan-v01.mjs'

const DEFAULT_MANIFEST = 'data_local/staging/ai-radar/v06-payload-plan-v01/ai-radar-v06-payload-plan-v01-batches.json'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/v06-payload-dryrun-v01'

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
  if (!fs.existsSync(file)) throw new Error(`Works file not found: ${file}`)
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
    const source = val(args['works-file'])
    return { works: readRows(source), payloadRead: false, source }
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('v0.6 batch dry-run is read-only. Execute/apply/write flags are rejected.')
  }

  const manifestFile = val(args.manifest) || DEFAULT_MANIFEST
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  const selectedBatchId = val(args['batch-id'])
  const expectedBatches = Number(args['expected-batches'] || 44)
  const expectedRows = Number(args['expected-rows'] || 10805)
  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')

  assertUnderDataLocal(outDir)
  if (!fs.existsSync(manifestFile)) throw new Error(`Batch manifest not found: ${manifestFile}`)
  const manifest = readJson(manifestFile)
  const validated = validateBatchManifest(manifest, {
    expectedBatches,
    expectedRows,
    selectedBatchId,
  })
  if (validated.blockers.length) {
    throw new Error(`Batch manifest validation failed: ${validated.blockers.join(', ')}`)
  }

  const loaded = await loadWorks(args, baseUrl)
  const indexes = buildIndexes(loaded.works)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  const allResults = []
  const batchSummaries = []
  for (const batch of validated.batches) {
    const batchId = val(batch?.batchId)
    const planFile = val(batch?.planFile)
    const plans = readJsonl(planFile)
    const results = dryRunBatchPlans(plans, indexes)
    const summarized = summarizeDryRunResults(results)
    const batchDir = path.join(outDir, 'batches', batchId.toLowerCase())
    const outputs = {
      all: path.join(batchDir, 'payload-dryrun.jsonl'),
      wouldUpdate: path.join(batchDir, 'payload-dryrun-would-update.jsonl'),
      blocked: path.join(batchDir, 'payload-dryrun-blocked.jsonl'),
      alreadyCurrent: path.join(batchDir, 'payload-dryrun-already-current.jsonl'),
      summary: path.join(batchDir, 'payload-dryrun-summary.json'),
    }
    writeJsonl(outputs.all, results)
    writeJsonl(outputs.wouldUpdate, summarized.wouldUpdateRows)
    writeJsonl(outputs.blocked, summarized.blockedRows)
    writeJsonl(outputs.alreadyCurrent, summarized.alreadyCurrentRows)

    const summary = {
      generatedAt: new Date().toISOString(),
      version: V06_DRYRUN_VERSION,
      batchId,
      planFile,
      planSha256: sha256File(planFile),
      planRows: plans.length,
      payloadWorksRead: loaded.works.length,
      wouldUpdate: summarized.wouldUpdate,
      blocked: summarized.blocked,
      alreadyCurrent: summarized.alreadyCurrent,
      byStatus: summarized.byStatus,
      byBlocker: summarized.byBlocker,
      byRemainingChangedField: summarized.byRemainingChangedField,
      outputs,
      safety: {
        payloadRead: loaded.payloadRead,
        payloadWrite: false,
        payloadPatchRequests: 0,
        directPostgresqlWrite: false,
        staleSnapshotsBlocked: true,
        titleOnlyMatchingAllowed: false,
      },
    }
    writeJson(outputs.summary, summary)
    batchSummaries.push(summary)
    allResults.push(...results)
  }

  const total = summarizeDryRunResults(allResults)
  const outputs = {
    all: path.join(outDir, 'ai-radar-v06-payload-dryrun-v01.jsonl'),
    wouldUpdate: path.join(outDir, 'ai-radar-v06-payload-dryrun-v01-would-update.jsonl'),
    blocked: path.join(outDir, 'ai-radar-v06-payload-dryrun-v01-blocked.jsonl'),
    alreadyCurrent: path.join(outDir, 'ai-radar-v06-payload-dryrun-v01-already-current.jsonl'),
    batchManifest: path.join(outDir, 'ai-radar-v06-payload-dryrun-v01-batches.json'),
    summary: path.join(outDir, 'ai-radar-v06-payload-dryrun-v01-summary.json'),
    batchesRoot: path.join(outDir, 'batches'),
  }
  writeJsonl(outputs.all, allResults)
  writeJsonl(outputs.wouldUpdate, total.wouldUpdateRows)
  writeJsonl(outputs.blocked, total.blockedRows)
  writeJsonl(outputs.alreadyCurrent, total.alreadyCurrentRows)
  writeJson(outputs.batchManifest, {
    generatedAt: new Date().toISOString(),
    version: V06_DRYRUN_VERSION,
    sourceManifest: manifestFile,
    sourceManifestSha256: sha256File(manifestFile),
    batches: batchSummaries,
  })

  const integrityBlockers = unique([
    ...(allResults.length !== validated.rows ? [`dryrun_rows_expected_${validated.rows}_received_${allResults.length}`] : []),
    ...batchSummaries.flatMap((batch) => batch.planRows > 0 ? [] : [`empty_batch:${batch.batchId}`]),
  ])
  const summary = {
    generatedAt: new Date().toISOString(),
    version: V06_DRYRUN_VERSION,
    complete: integrityBlockers.length === 0,
    selectedBatchId: selectedBatchId || null,
    planManifest: manifestFile,
    planManifestSha256: sha256File(manifestFile),
    worksSource: loaded.source,
    payloadWorksRead: loaded.works.length,
    batchCount: batchSummaries.length,
    planRowsRead: allResults.length,
    wouldUpdate: total.wouldUpdate,
    blocked: total.blocked,
    alreadyCurrent: total.alreadyCurrent,
    byStatus: total.byStatus,
    byBlocker: total.byBlocker,
    byRemainingChangedField: total.byRemainingChangedField,
    byBatchStatus: countBy(batchSummaries, (batch) => batch.blocked ? 'contains_blocked_rows' : 'no_blocked_rows'),
    integrityBlockers,
    outputs,
    safety: {
      payloadRead: loaded.payloadRead,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      payloadLoadedOnce: true,
      allPlanHashesVerified: true,
      staleSnapshotsBlocked: true,
      titleOnlyMatchingAllowed: false,
      generalizedApplyPathExists: false,
    },
    nextStep: integrityBlockers.length
      ? 'Fix integrity blockers and rerun. Do not design or execute an apply stage.'
      : 'Review aggregate and per-batch dry-run summaries. A separate generalized release/apply PR is required before any write.',
  }
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: summary.complete, summary }, null, 2))
  if (!summary.complete) process.exitCode = 2
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
