#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  CATALOG_VERSION,
  DEFAULT_ASSESSMENT_BATCH_SIZE,
  DEFAULT_IDENTITY_BATCH_SIZE,
  DEFAULT_RESEARCH_BATCH_SIZE,
  buildCatalogQueues,
  sha256Text,
} from './lib/catalog-batch-v01.mjs'

const DEFAULT_INPUT = 'data_local/staging/ai-radar/catalog-v01/audit/ai-radar-clean-input-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/catalog-v01/queue'

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

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

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Catalog clean input not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function jsonlText(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = jsonlText(rows)
  fs.writeFileSync(file, text, 'utf8')
  return { file, rows: rows.length, sha256: sha256Text(text) }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = `${JSON.stringify(value, null, 2)}\n`
  fs.writeFileSync(file, text, 'utf8')
  return { file, sha256: sha256Text(text) }
}

function countClassificationReasons(inventory) {
  const counts = {}
  for (const row of inventory) {
    for (const reason of list(row?.catalogQueue?.reasons).map(val).filter(Boolean)) {
      counts[reason] = (counts[reason] || 0) + 1
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  )
}

function padded(index) {
  return String(index + 1).padStart(4, '0')
}

function queueSlug(queue) {
  return queue.replaceAll('_', '-')
}

function batchId(queue, index) {
  const prefix = {
    ready_for_ai_assessment: 'ASSESS',
    external_research: 'RESEARCH',
    identity_review: 'IDENTITY',
  }[queue] || 'QUEUE'
  return `RADAR-${prefix}-${padded(index)}`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.confirm || args.write) {
    throw new Error('Catalog queue preparation is read-only. Execute/apply/write flags are rejected.')
  }

  const input = val(args.input) || DEFAULT_INPUT
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  const assessmentBatchSize = Number(args['batch-size'] || DEFAULT_ASSESSMENT_BATCH_SIZE)
  const researchBatchSize = Number(args['research-batch-size'] || DEFAULT_RESEARCH_BATCH_SIZE)
  const identityBatchSize = Number(args['identity-batch-size'] || DEFAULT_IDENTITY_BATCH_SIZE)
  const rows = readJsonl(input)
  const sourceText = fs.readFileSync(input, 'utf8')
  const built = buildCatalogQueues(rows, {
    assessmentBatchSize,
    researchBatchSize,
    identityBatchSize,
  })

  fs.mkdirSync(outDir, { recursive: true })
  const batchesRoot = path.join(outDir, 'batches')
  fs.rmSync(batchesRoot, { recursive: true, force: true })

  const inventoryOutput = writeJsonl(path.join(outDir, 'catalog-inventory-v01.jsonl'), built.inventory)
  const queueOutputs = {}
  const allQueueNames = [
    'ready_for_ai_assessment',
    'external_research',
    'identity_review',
    'already_ai_assessed',
    'protected_or_manual_review',
    'invalid_record',
    'unclassified',
  ]
  for (const queue of allQueueNames) {
    queueOutputs[queue] = writeJsonl(
      path.join(outDir, `catalog-${queueSlug(queue)}-v01.jsonl`),
      built.queues[queue] || [],
    )
  }

  const batchManifestRows = []
  for (const [queue, batches] of Object.entries(built.batches)) {
    for (let index = 0; index < batches.length; index += 1) {
      const rowsInBatch = batches[index]
      const id = batchId(queue, index)
      const file = path.join(batchesRoot, queueSlug(queue), `${id.toLowerCase()}.jsonl`)
      const output = writeJsonl(file, rowsInBatch)
      const seriesKeys = [...new Set(rowsInBatch.map((row) => val(row?.series?.seriesKey) || `work:${val(row?.workId)}`))]
      batchManifestRows.push({
        batchId: id,
        queue,
        index: index + 1,
        rowCount: rowsInBatch.length,
        seriesCount: seriesKeys.length,
        firstWorkId: val(rowsInBatch[0]?.workId),
        lastWorkId: val(rowsInBatch.at(-1)?.workId),
        file,
        sha256: output.sha256,
      })
    }
  }

  const accountedRows = Object.values(built.queues).reduce((sum, queueRows) => sum + queueRows.length, 0)
  const byQueue = Object.fromEntries(allQueueNames.map((queue) => [queue, (built.queues[queue] || []).length]))
  const summary = {
    generatedAt: new Date().toISOString(),
    version: CATALOG_VERSION,
    input,
    inputSha256: sha256Text(sourceText),
    rowsRead: rows.length,
    inventoryRows: built.inventory.length,
    accountedRows,
    allRowsAccountedFor: accountedRows === rows.length,
    byQueue,
    byClassificationReason: countClassificationReasons(built.inventory),
    batchSizes: { assessmentBatchSize, researchBatchSize, identityBatchSize },
    batchCounts: {
      readyForAiAssessment: built.batches.ready_for_ai_assessment.length,
      externalResearch: built.batches.external_research.length,
      identityReview: built.batches.identity_review.length,
      total: batchManifestRows.length,
    },
    outputs: {
      inventory: inventoryOutput,
      queues: queueOutputs,
      batchesRoot,
      batchManifest: path.join(outDir, 'catalog-batch-manifest-v01.json'),
      summary: path.join(outDir, 'catalog-queue-summary-v01.json'),
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      deterministicOrdering: true,
      seriesFamiliesKeptTogether: true,
    },
    nextStep: 'Process assessment batches first, research missing-evidence batches separately, and keep identity/manual queues out of automatic writes.',
  }

  const manifest = {
    generatedAt: summary.generatedAt,
    version: CATALOG_VERSION,
    input,
    inputSha256: summary.inputSha256,
    batchSizes: summary.batchSizes,
    batches: batchManifestRows,
  }
  writeJson(summary.outputs.batchManifest, manifest)
  writeJson(summary.outputs.summary, summary)
  console.log(JSON.stringify({ ok: summary.allRowsAccountedFor, summary }, null, 2))
  if (!summary.allRowsAccountedFor) process.exitCode = 2
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
