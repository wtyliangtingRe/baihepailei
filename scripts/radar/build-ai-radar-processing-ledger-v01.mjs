#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  assertUnderDataLocal,
  jsonlText,
  readJsonl,
  val,
} from './lib/assessment-handoff-v01.mjs'
import {
  PROCESSING_LEDGER_VERSION,
  catalogFingerprint,
  identityKey,
  normalizeLedgerEntry,
  sha256Json,
} from './lib/processing-ledger-v01.mjs'

const DEFAULT_SCAN_ROOT = 'data_local'
const DEFAULT_OUTPUT = 'data_local/outputs/ai-radar/state/ai-radar-processing-ledger-v01.jsonl'

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
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function walkFiles(root) {
  const out = []
  if (!fs.existsSync(root)) return out
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) out.push(full)
    }
  }
  return out.sort()
}

function loadCatalogRows(manifestFile) {
  const manifest = readJson(manifestFile)
  const rows = []
  for (const batch of Array.isArray(manifest?.batches) ? manifest.batches : []) {
    const file = assertUnderDataLocal(val(batch?.file))
    if (!fs.existsSync(file)) continue
    for (const row of readJsonl(file)) rows.push(row)
  }
  return rows
}

function nextAction(entry) {
  if (entry.aiQaStatus === 'ai_qa_passed') return 'skip_completed_unchanged'
  if (entry.aiQaStatus === 'ai_qa_deferred') return 'retry_ai_qa_deferred'
  if (entry.researchStatus === 'needs_more_research') return 'retry_needs_more_research'
  if (entry.researchStatus === 'identity_review') return 'retry_identity_review'
  if (entry.researchStatus === 'ready_for_ai_assessment') return 'assess_existing_research'
  return 'retry_incomplete'
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.publish || args.patch || args.gate || args['approval-token']) {
    throw new Error('Processing ledger is local-only. Publish/patch/gate flags are rejected.')
  }

  const catalogManifest = assertUnderDataLocal(val(args['catalog-manifest']))
  const scanRoot = assertUnderDataLocal(val(args['scan-root']) || DEFAULT_SCAN_ROOT)
  const output = assertUnderDataLocal(val(args.out) || DEFAULT_OUTPUT)
  if (!catalogManifest || !fs.existsSync(catalogManifest)) throw new Error('--catalog-manifest must point to an existing data_local file')

  const catalogRows = loadCatalogRows(catalogManifest)
  const catalogByIdentity = new Map(catalogRows.map((row) => [identityKey(row), row]))
  const ledger = new Map()

  const ensure = (row) => {
    const key = identityKey(row)
    const catalog = catalogByIdentity.get(key)
    const current = ledger.get(key) || normalizeLedgerEntry({
      workId: row.workId,
      siteId: row.siteId,
      title: row.title || catalog?.title,
      catalogFingerprint: catalog ? catalogFingerprint(catalog) : '',
      sourceBatchIds: [],
    })
    if (!current.catalogFingerprint && catalog) current.catalogFingerprint = catalogFingerprint(catalog)
    if (!current.title) current.title = val(row?.title || catalog?.title)
    ledger.set(key, current)
    return current
  }

  const files = walkFiles(scanRoot)
  const researchFiles = files.filter((file) => path.basename(file) === 'research-results-v01.jsonl')
  const qaFiles = files.filter((file) => {
    const name = path.basename(file)
    return /ai-qa-(?:final|passed|deferred).*\.jsonl$/iu.test(name)
      || /ai-radar-ai-qa-final-v0\.1\.jsonl$/iu.test(name)
  })

  for (const file of researchFiles) {
    for (const row of readJsonl(file)) {
      const entry = ensure(row)
      entry.researchStatus = val(row?.researchStatus) || entry.researchStatus
      entry.researchVersion = val(row?.externalResearch?.version || row?.researchVersion || row?.version) || entry.researchVersion
      entry.researchResultSha256 = sha256Json(row)
      entry.sourceBatchIds = [...new Set([...entry.sourceBatchIds, val(row?.researchBatch)].filter(Boolean))]
      entry.completedAt = val(row?.generatedAt || row?.researchedAt) || entry.completedAt
    }
  }

  for (const file of qaFiles) {
    for (const row of readJsonl(file)) {
      const entry = ensure(row)
      entry.policyVersion = val(row?.policyVersion) || entry.policyVersion
      entry.calibrationProfileId = val(row?.calibration?.profileId) || entry.calibrationProfileId
      entry.assessmentResultSha256 = val(row?.aiQaFinalResolvedRowSha256) || sha256Json(row)
      entry.aiQaStatus = val(row?.aiQaStatus)
        || (path.basename(file).includes('deferred') ? 'ai_qa_deferred' : 'ai_qa_passed')
      entry.sourceBatchIds = [...new Set([
        ...entry.sourceBatchIds,
        val(row?.assessmentBatch),
      ].filter(Boolean))]
      entry.completedAt = val(row?.generatedAt || row?.assessedAt) || entry.completedAt
    }
  }

  const rows = [...ledger.values()]
    .map((entry) => normalizeLedgerEntry({ ...entry, nextAction: nextAction(entry) }))
    .sort((a, b) => Number(a.workId) - Number(b.workId) || a.workId.localeCompare(b.workId))

  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, jsonlText(rows), 'utf8')
  const summaryFile = output.replace(/\.jsonl$/iu, '-summary.json')
  const byNextAction = {}
  for (const row of rows) byNextAction[row.nextAction] = (byNextAction[row.nextAction] || 0) + 1
  const summary = {
    generatedAt: new Date().toISOString(),
    version: PROCESSING_LEDGER_VERSION,
    catalogManifest,
    catalogRows: catalogRows.length,
    ledgerRows: rows.length,
    researchFilesScanned: researchFiles.length,
    aiQaFilesScanned: qaFiles.length,
    byNextAction,
    output,
    safety: {
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      humanTrackMutations: 0,
      onlyWritesUnderDataLocal: true,
    },
  }
  fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
