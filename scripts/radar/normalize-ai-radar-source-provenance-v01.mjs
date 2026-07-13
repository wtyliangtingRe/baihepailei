#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import { normalizeSourceProvenance } from './lib/source-provenance-normalize-v01.mjs'

const VERSION = 'ai-radar-source-provenance-normalization-v0.1'
const DEFAULT_INPUT = 'data_local/staging/ai-radar/first100-complete-v01/ai-radar-first100-resolved-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/source-provenance-normalized-v01'

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
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const text = fs.readFileSync(file, 'utf8').trim()
  if (!text) return []
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function countBy(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] || 0) + 1
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function writeCsv(file, results) {
  const headers = [
    'workId', 'title', 'changed', 'originalEvidenceStatus', 'normalizedEvidenceStatus',
    'originalSourceCount', 'traceableSourceCount', 'reasons', 'auditAfterStatus',
    'auditAfterBlockers', 'auditAfterWarnings',
  ]
  const lines = [headers.map(csvCell).join(',')]
  for (const result of results) {
    const metadata = result.row.sourceProvenanceNormalization || {}
    lines.push([
      result.row.workId,
      result.row.title,
      result.changed,
      metadata.originalEvidenceStatus,
      metadata.normalizedEvidenceStatus,
      metadata.originalSourceCount,
      metadata.traceableSourceCount,
      metadata.reasons,
      result.auditAfter.auditStatus,
      result.auditAfter.blockers,
      result.auditAfter.warnings,
    ].map(csvCell).join(','))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const expectedRows = Number(args['expected-rows'] || 100)
  const rows = readJsonl(input)
  if (expectedRows > 0 && rows.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} rows, found ${rows.length}`)
  }

  const results = rows.map((row) => normalizeSourceProvenance(row))
  const normalizedRows = results.map((result) => result.row)
  const changedRows = results.filter((result) => result.changed)
  const statusChangedRows = results.filter((result) => result.statusChanged)
  const sourceCountChangedRows = results.filter((result) => result.sourceCountChanged)
  const annotationOnlyRows = results.filter((result) => result.changed && !result.statusChanged && !result.sourceCountChanged)
  const blockedAfter = results.filter((result) => result.auditAfter.auditStatus === 'blocked')
  const warningsAfter = results.filter((result) => result.auditAfter.auditStatus === 'warning')
  const cleanAfter = results.filter((result) => result.auditAfter.auditStatus === 'ok')

  const outputs = {
    normalized: path.join(outDir, 'ai-radar-first100-resolved-source-honest-v01.jsonl'),
    changed: path.join(outDir, 'ai-radar-source-provenance-normalized-changed-v01.jsonl'),
    preview: path.join(outDir, 'ai-radar-source-provenance-normalized-preview-v01.csv'),
    summary: path.join(outDir, 'ai-radar-source-provenance-normalized-summary-v01.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    rowsRead: rows.length,
    changed: changedRows.length,
    unchanged: rows.length - changedRows.length,
    evidenceStatusDowngraded: statusChangedRows.length,
    sourceCountCorrected: sourceCountChangedRows.length,
    annotationOnly: annotationOnlyRows.length,
    byEvidenceStatusTransition: countBy(statusChangedRows.map((result) => {
      const metadata = result.row.sourceProvenanceNormalization
      return `${metadata.originalEvidenceStatus}->${metadata.normalizedEvidenceStatus}`
    })),
    auditAfter: {
      blocked: blockedAfter.length,
      warningsOnly: warningsAfter.length,
      clean: cleanAfter.length,
    },
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesOriginalInput: false,
      writesNormalizedCopyOnly: true,
      preservesUnlinkedContext: true,
      unlinkedContextCountsAsSource: false,
      changesConfidencePercent: false,
      changesEvidenceCoveragePercent: false,
    },
    nextStep: 'Review the normalized preview, then build a new Payload plan using the normalized JSONL.',
  }

  writeJsonl(outputs.normalized, normalizedRows)
  writeJsonl(outputs.changed, changedRows.map((result) => result.row))
  writeCsv(outputs.preview, results)
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exit(1)
}
