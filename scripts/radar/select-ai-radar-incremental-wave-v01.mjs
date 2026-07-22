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
  decideIncrementalAction,
  identityKey,
  normalizeLedgerEntry,
  summarizeActions,
} from './lib/processing-ledger-v01.mjs'

const DEFAULT_LEDGER = 'data_local/outputs/ai-radar/state/ai-radar-processing-ledger-v01.jsonl'
const DEFAULT_OUTPUT_ROOT = 'data_local/outputs/ai-radar/incremental-selection'
const DEFAULT_POLICY = 'radar-rating-policy-v0.4-draft'
const DEFAULT_CALIBRATION = 'site-owner-primary-v0.1'

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

function loadCatalogRows(manifestFile) {
  const manifest = readJson(manifestFile)
  const rows = []
  for (const batch of Array.isArray(manifest?.batches) ? manifest.batches : []) {
    if (val(batch?.queue) !== 'external_research') continue
    const file = assertUnderDataLocal(val(batch?.file))
    if (!fs.existsSync(file)) throw new Error(`Catalog batch file missing: ${file}`)
    for (const row of readJsonl(file)) rows.push({
      ...row,
      incrementalSourceBatchId: val(batch?.batchId),
      incrementalSourceBatchSha256: val(batch?.sha256),
    })
  }
  return rows
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.publish || args.patch || args.gate || args['approval-token']) {
    throw new Error('Incremental selection is local-only. Publish/patch/gate flags are rejected.')
  }

  const catalogManifest = assertUnderDataLocal(val(args['catalog-manifest']))
  const ledgerFile = assertUnderDataLocal(val(args.ledger) || DEFAULT_LEDGER)
  const outputRoot = assertUnderDataLocal(val(args['out-dir']) || DEFAULT_OUTPUT_ROOT)
  const targetRows = Number(args['target-rows'] ?? 250)
  const retryReserve = Number(args['retry-reserve'] ?? Math.min(50, Math.floor(targetRows / 5)))
  const policyVersion = val(args['policy-version']) || DEFAULT_POLICY
  const calibrationProfileId = val(args['calibration-profile-id']) || DEFAULT_CALIBRATION
  if (!Number.isInteger(targetRows) || targetRows < 1) throw new Error('--target-rows must be a positive integer')
  if (!Number.isInteger(retryReserve) || retryReserve < 0 || retryReserve > targetRows) throw new Error('--retry-reserve must be from 0 to target-rows')
  if (!fs.existsSync(catalogManifest)) throw new Error(`Catalog manifest not found: ${catalogManifest}`)

  const ledgerRows = fs.existsSync(ledgerFile) ? readJsonl(ledgerFile) : []
  const ledgerByIdentity = new Map(ledgerRows.map((row) => [identityKey(row), row]))
  const catalogRows = loadCatalogRows(catalogManifest)
  const classified = catalogRows.map((row) => {
    const ledgerEntry = ledgerByIdentity.get(identityKey(row)) || null
    const decision = decideIncrementalAction(row, ledgerEntry, {
      policyVersion,
      calibrationProfileId,
    })
    return {
      row,
      ledgerEntry: ledgerEntry ? normalizeLedgerEntry(ledgerEntry) : null,
      ...decision,
    }
  })

  const newRows = classified.filter((item) => item.action === 'research_new')
  const retryRows = classified.filter((item) => item.needsResearch && item.action !== 'research_new')
  const reassessRows = classified.filter((item) => item.needsAssessment)
  const skippedRows = classified.filter((item) => !item.needsResearch && !item.needsAssessment)

  const selectedRetry = retryRows.slice(0, retryReserve)
  const selectedNew = newRows.slice(0, targetRows - selectedRetry.length)
  const remaining = targetRows - selectedRetry.length - selectedNew.length
  const selected = [
    ...selectedNew,
    ...selectedRetry,
    ...(remaining > 0 ? retryRows.slice(selectedRetry.length, selectedRetry.length + remaining) : []),
  ]

  const selectedAt = new Date().toISOString()
  const decorate = (item) => ({
    ...item.row,
    incrementalSelection: {
      ledgerVersion: PROCESSING_LEDGER_VERSION,
      action: item.action,
      refreshReason: item.refreshReason || null,
      selectedAt,
      policyVersion,
      calibrationProfileId,
    },
    incrementalReuse: item.needsAssessment && item.ledgerEntry?.reusableEvidence
      ? item.ledgerEntry.reusableEvidence
      : null,
  })

  fs.mkdirSync(outputRoot, { recursive: true })
  const outputs = {
    research: path.join(outputRoot, 'incremental-research-selection-v01.jsonl'),
    reassess: path.join(outputRoot, 'incremental-reassessment-selection-v01.jsonl'),
    skipped: path.join(outputRoot, 'incremental-skipped-v01.jsonl'),
    summary: path.join(outputRoot, 'incremental-selection-summary-v01.json'),
  }
  fs.writeFileSync(outputs.research, jsonlText(selected.map(decorate)), 'utf8')
  fs.writeFileSync(outputs.reassess, jsonlText(reassessRows.map(decorate)), 'utf8')
  fs.writeFileSync(outputs.skipped, jsonlText(skippedRows.map(decorate)), 'utf8')

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-incremental-selection-v0.2',
    catalogManifest,
    ledgerFile: fs.existsSync(ledgerFile) ? ledgerFile : null,
    catalogRows: catalogRows.length,
    ledgerRows: ledgerRows.length,
    targetRows,
    retryReserve,
    selectedResearchRows: selected.length,
    selectedNewRows: selected.filter((item) => item.action === 'research_new').length,
    selectedRetryRows: selected.filter((item) => item.action !== 'research_new').length,
    reassessmentRows: reassessRows.length,
    legacyReassessmentRows: reassessRows.filter((item) => item.ledgerEntry?.aiQaStatus === 'legacy_assessed').length,
    reassessmentRowsWithReusableEvidence: reassessRows.filter((item) => item.ledgerEntry?.reusableEvidence).length,
    skippedRows: skippedRows.length,
    byAction: summarizeActions(classified),
    outputs,
    safety: {
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      humanTrackMutations: 0,
      onlyWritesUnderDataLocal: true,
    },
  }
  fs.writeFileSync(outputs.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
