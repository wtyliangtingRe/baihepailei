#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import { auditSourceProvenance } from './lib/source-provenance-audit-v01.mjs'

const VERSION = 'ai-radar-source-provenance-audit-v0.1'
const DEFAULT_INPUT = 'data_local/staging/ai-radar/first100-complete-v01/ai-radar-first100-resolved-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/source-provenance-audit-v01'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const text = fs.readFileSync(file, 'utf8').trim()
  if (!text) return []
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function writeCsv(file, rows) {
  const headers = [
    'workId',
    'siteId',
    'title',
    'gradeSuggestion',
    'evidenceStatus',
    'declaredSourceCount',
    'traceableSourceCount',
    'sourceRecordCount',
    'auditStatus',
    'blockers',
    'warnings',
    'traceableUrls',
  ]
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(','))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `\uFEFF${lines.join('\n')}\n`, 'utf8')
}

function countBy(rows, key) {
  const counts = {}
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row?.[key]
    const name = String(value || 'missing')
    counts[name] = (counts[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const assessments = readJsonl(input)
  const rows = assessments.map(auditSourceProvenance)
  const blockedRows = rows.filter((row) => row.auditStatus === 'blocked')
  const warningRows = rows.filter((row) => row.auditStatus === 'warning')
  const cleanRows = rows.filter((row) => row.auditStatus === 'ok')

  const outputs = {
    all: path.join(outDir, 'ai-radar-source-provenance-audit-v01.jsonl'),
    blocked: path.join(outDir, 'ai-radar-source-provenance-audit-v01-blocked.jsonl'),
    warnings: path.join(outDir, 'ai-radar-source-provenance-audit-v01-warnings.jsonl'),
    clean: path.join(outDir, 'ai-radar-source-provenance-audit-v01-clean.jsonl'),
    preview: path.join(outDir, 'ai-radar-source-provenance-audit-v01-preview.csv'),
    summary: path.join(outDir, 'ai-radar-source-provenance-audit-v01-summary.json'),
  }

  writeJsonl(outputs.all, rows)
  writeJsonl(outputs.blocked, blockedRows)
  writeJsonl(outputs.warnings, warningRows)
  writeJsonl(outputs.clean, cleanRows)
  writeCsv(outputs.preview, rows)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    rowsRead: assessments.length,
    blocked: blockedRows.length,
    warningsOnly: warningRows.length,
    clean: cleanRows.length,
    byAuditStatus: countBy(rows, 'auditStatus'),
    byBlocker: countBy(blockedRows.flatMap((row) => row.blockers), (value) => value),
    byWarning: countBy(rows.flatMap((row) => row.warnings), (value) => value),
    rowsWithDeclaredCountMismatch: rows.filter((row) => row.declaredSourceCount !== row.traceableSourceCount).length,
    rowsWithUnlinkedSecondarySource: rows.filter((row) => row.unlinkedSecondarySources.length > 0).length,
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesAssessments: false,
      auditOnly: true,
    },
    nextStep: 'Resolve blocked provenance rows before apply. Warning-only rows may proceed after review, with sourceCount based on traceable URLs.',
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
