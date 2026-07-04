#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_SOURCE_RECORDS = 'data_local/staging/source-records/source-records-v02.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/full-catalog-ingestion'
const DEFAULT_URL = 'http://localhost:3000'
const WORK_DIR_NAME = 'v04-work'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function runNode(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${scriptPath} failed with exit code ${result.status}`)
  return result
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function copyFile(source, target) {
  fs.copyFileSync(source, target)
}

function countJsonlRows(filePath) {
  if (!fs.existsSync(filePath)) return 0
  const text = fs.readFileSync(filePath, 'utf8').trim()
  if (!text) return 0
  return text.split('\n').length
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
  return [
    '# Full Catalog Ingestion Plan v0.4',
    '',
    'v0.4 uses SourceRecord v0.2, which excludes known local workflow artifacts from the source-record input.',
    '',
    '## Safety',
    '',
    '- Read-only planning path.',
    '- No database changes are made.',
    '- No importer action is performed.',
    '- Generated files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- sourceRecords: ${report.summary.sourceRecords}`,
    `- sourceRecordsRead: ${report.summary.sourceRecordsRead}`,
    `- sourceRecordsFailed: ${report.summary.sourceRecordsFailed}`,
    `- plannedRows: ${report.summary.plannedRows}`,
    `- payloadChecked: ${report.summary.payloadChecked}`,
    `- payloadWorks: ${report.summary.payloadWorks}`,
    `- rejectedParentCandidates: ${report.summary.rejectedParentCandidates}`,
    `- actionChangedRows: ${report.summary.actionChangedRows}`,
    '',
    ...formatCountTable('By action', report.summary.byAction),
    ...formatCountTable('By reason', report.summary.byReason),
    ...formatCountTable('By entity boundary', report.summary.byEntityBoundary),
    ...formatCountTable('Rejected parent candidates by reason', report.summary.rejectedByReason),
    '## Notes',
    '',
    '- Intermediate v03-compatible outputs are kept under `data_local/staging/full-catalog-ingestion/v04-work` for comparison.',
    '- The top-level `full-catalog-ingestion-plan-v04.*` files are the intended v04 outputs.',
    '',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const sourceRecords = args['source-records'] || DEFAULT_SOURCE_RECORDS
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR
  const url = args.url || DEFAULT_URL
  const noPayload = Boolean(args['no-payload'])

  const plannerV03 = 'scripts/import/plan-full-catalog-ingestion-v03.mjs'
  if (!fs.existsSync(plannerV03)) throw new Error(`Missing dependency: ${plannerV03}`)
  if (!fs.existsSync(sourceRecords)) throw new Error(`SourceRecord input not found: ${sourceRecords}`)

  fs.mkdirSync(outDir, { recursive: true })
  const workDir = path.join(outDir, WORK_DIR_NAME)
  fs.mkdirSync(workDir, { recursive: true })

  const plannerArgs = [
    '--source-records', sourceRecords,
    '--out-dir', workDir,
    '--url', url,
  ]
  if (noPayload) plannerArgs.push('--no-payload')

  console.error('[plan-v04] running v03 planner with SourceRecord v02 input ...')
  runNode(plannerV03, plannerArgs)

  const v03Jsonl = path.join(workDir, 'full-catalog-ingestion-plan-v03.jsonl')
  const v03Json = path.join(workDir, 'full-catalog-ingestion-plan-v03.json')
  const v03SummaryPath = path.join(workDir, 'full-catalog-ingestion-plan-v03-summary.json')

  const outJsonl = path.join(outDir, 'full-catalog-ingestion-plan-v04.jsonl')
  const outJson = path.join(outDir, 'full-catalog-ingestion-plan-v04.json')
  const outSummary = path.join(outDir, 'full-catalog-ingestion-plan-v04-summary.json')
  const outMd = path.join(outDir, 'full-catalog-ingestion-plan-v04.md')

  copyFile(v03Jsonl, outJsonl)

  const v03Summary = readJson(v03SummaryPath)
  const v03Report = readJson(v03Json)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v0.4',
    sourceRecords,
    plannedRows: countJsonlRows(outJsonl),
    sourceRecordsRead: Number(v03Summary.sourceRecordsRead || 0),
    sourceRecordsFailed: Number(v03Summary.sourceRecordsFailed || 0),
    payloadChecked: Boolean(v03Summary.payloadChecked),
    payloadWorks: Number(v03Summary.payloadWorks || 0),
    rejectedParentCandidates: Number(v03Summary.rejectedParentCandidates || 0),
    actionChangedRows: Number(v03Summary.actionChangedRows || 0),
    byAction: v03Summary.byAction || {},
    byReason: v03Summary.byReason || {},
    byEntityBoundary: v03Summary.byEntityBoundary || {},
    byBoundaryReason: v03Summary.byBoundaryReason || {},
    rejectedByReason: v03Summary.rejectedByReason || {},
    safety: {
      readOnly: true,
      databaseChange: false,
      importerAction: false,
    },
  }

  const report = {
    ok: true,
    summary,
    sourceRecordVersion: 'v0.2',
    upstreamV03Summary: v03Summary,
    upstreamV03Samples: v03Report.samples || {},
    outputs: {
      jsonl: outJsonl,
      json: outJson,
      summary: outSummary,
      md: outMd,
      workDir,
    },
  }

  writeJson(outJson, report)
  writeJson(outSummary, summary)
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  console.log(JSON.stringify({ ok: true, summary, outputs: report.outputs }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
