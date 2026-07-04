#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_SOURCE_RECORDS = 'data_local/staging/source-records/source-records-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/full-catalog-ingestion'
const DEFAULT_URL = 'http://localhost:3000'

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue

    const key = item.slice(2)
    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }

    args[key] = next
    index += 1
  }

  return args
}

function usage() {
  console.log(`Usage:
  node scripts/import/plan-full-catalog-ingestion-v03.mjs [--source-records <jsonl>] [--out-dir <dir>] [--url http://localhost:3000] [--no-payload]

This is a read-only full catalog ingestion dry-run v0.3 wrapper:
  - Runs plan-full-catalog-ingestion-v02.mjs.
  - Runs tighten-parent-title-inference-v01.mjs against the generated v02 JSONL.
  - Publishes the tightened rows as full-catalog-ingestion-plan-v03.* outputs.

Safety:
  - No Payload write.
  - No PostgreSQL write.
  - No importer apply.
  - No delete.
  - No data_local output should be committed.
`)
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${scriptPath} failed with exit code ${result.status}`)
  }

  return result
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function countJsonlRows(filePath) {
  if (!fs.existsSync(filePath)) return 0
  const text = fs.readFileSync(filePath, 'utf8')
  if (!text.trim()) return 0
  return text.trimEnd().split('\n').length
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest)
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function formatCountTable(title, entries) {
  return [
    `## ${title}`,
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(entries || {}).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]
}

function formatMarkdown(report) {
  const lines = [
    '# Full Catalog Ingestion Plan v0.3',
    '',
    'v0.3 is v0.2 plus the parent-title inference tightening preview.',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer apply.',
    '- No delete.',
    '- No `data_local` output should be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- sourceRecords: ${report.summary.sourceRecords}`,
    `- v02Rows: ${report.summary.v02Rows}`,
    `- v03Rows: ${report.summary.v03Rows}`,
    `- rejectedParentCandidates: ${report.summary.rejectedParentCandidates}`,
    `- actionChangedRows: ${report.summary.actionChangedRows}`,
    `- payloadChecked: ${report.summary.payloadChecked}`,
    `- payloadWorks: ${report.summary.payloadWorks}`,
    '',
    ...formatCountTable('By action after v0.3 tightening', report.summary.byAction),
    ...formatCountTable('Rejected parent candidates by reason', report.summary.rejectedByReason),
    ...formatCountTable('By boundary reason after v0.3 tightening', report.summary.byBoundaryReason),
    '## Notes',
    '',
    '- v0.3 does not overwrite v0.2 outputs.',
    '- The v0.2 outputs and the tightened preview outputs are retained for comparison.',
    '- The v0.3 JSONL is copied from the tightened preview JSONL.',
    '',
  ]

  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || args.h) {
    usage()
    return
  }

  const sourceRecords = args['source-records'] || DEFAULT_SOURCE_RECORDS
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR
  const baseUrl = args.url || DEFAULT_URL
  const noPayload = Boolean(args['no-payload'])

  const plannerV02 = 'scripts/import/plan-full-catalog-ingestion-v02.mjs'
  const tighten = 'scripts/import/tighten-parent-title-inference-v01.mjs'

  if (!fs.existsSync(plannerV02)) throw new Error(`Missing dependency: ${plannerV02}`)
  if (!fs.existsSync(tighten)) throw new Error(`Missing dependency: ${tighten}`)
  if (!fs.existsSync(sourceRecords)) throw new Error(`Source records file not found: ${sourceRecords}`)

  fs.mkdirSync(outDir, { recursive: true })

  const v02Args = [
    '--source-records', sourceRecords,
    '--out-dir', outDir,
    '--url', baseUrl,
  ]

  if (noPayload) v02Args.push('--no-payload')

  console.error('[plan-v03] running v02 planner ...')
  runNodeScript(plannerV02, v02Args)

  const v02Jsonl = path.join(outDir, 'full-catalog-ingestion-plan-v02.jsonl')
  const v02SummaryPath = path.join(outDir, 'full-catalog-ingestion-plan-v02-summary.json')

  console.error('[plan-v03] tightening parent-title inference ...')
  runNodeScript(tighten, [
    '--plan-v02', v02Jsonl,
    '--out-dir', outDir,
  ])

  const tightenedJsonl = path.join(outDir, 'full-catalog-ingestion-plan-v02-tightened-v01.jsonl')
  const tightenedJson = path.join(outDir, 'full-catalog-ingestion-plan-v02-tightened-v01.json')
  const tightenedSummaryPath = path.join(outDir, 'full-catalog-ingestion-plan-v02-tightened-v01-summary.json')

  const outJsonl = path.join(outDir, 'full-catalog-ingestion-plan-v03.jsonl')
  const outJson = path.join(outDir, 'full-catalog-ingestion-plan-v03.json')
  const outSummary = path.join(outDir, 'full-catalog-ingestion-plan-v03-summary.json')
  const outMd = path.join(outDir, 'full-catalog-ingestion-plan-v03.md')

  copyFile(tightenedJsonl, outJsonl)

  const v02Summary = readJson(v02SummaryPath)
  const tightenedSummary = readJson(tightenedSummaryPath)
  const tightenedJsonPayload = readJson(tightenedJson)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v0.3',
    sourceRecords,
    v02Rows: countJsonlRows(v02Jsonl),
    v03Rows: countJsonlRows(outJsonl),
    sourceRecordsRead: v02Summary.sourceRecordsRead || 0,
    sourceRecordsFailed: v02Summary.sourceRecordsFailed || 0,
    payloadChecked: Boolean(v02Summary.payloadChecked),
    payloadWorks: Number(v02Summary.payloadWorks || 0),
    rejectedParentCandidates: Number(tightenedSummary.rejectedParentCandidates || 0),
    actionChangedRows: Number(tightenedSummary.actionChangedRows || 0),
    byAction: tightenedSummary.after?.byAction || {},
    byReason: tightenedSummary.after?.byReason || {},
    byEntityBoundary: tightenedSummary.after?.byEntityBoundary || {},
    byBoundaryReason: tightenedSummary.after?.byBoundaryReason || {},
    rejectedByReason: tightenedSummary.after?.rejectedByReason || {},
    safety: {
      payloadWrite: false,
      postgresqlWrite: false,
      importerApply: false,
      delete: false,
    },
  }

  const report = {
    ok: true,
    summary,
    v02Summary,
    tighteningSummary: tightenedSummary,
    samples: tightenedJsonPayload.samples || {},
    outputs: {
      jsonl: outJsonl,
      json: outJson,
      summary: outSummary,
      md: outMd,
    },
  }

  writeJson(outJson, report)
  writeJson(outSummary, summary)
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: report.outputs,
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
