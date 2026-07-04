#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/source-records/source-records-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/source-records'
const SAMPLE_LIMIT = 80

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

function asText(value) {
  return String(value ?? '').trim()
}

function inc(map, key, amount = 1) {
  const normalized = asText(key) || 'missing'
  map[normalized] = (map[normalized] || 0) + amount
}

function sortCountObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  }))
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

async function readJsonl(filePath) {
  const rows = []
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let read = 0
  let failed = 0

  for await (const line of rl) {
    const text = line.trim()
    if (!text) continue
    try {
      rows.push(JSON.parse(text))
    } catch {
      failed += 1
    }
    read += 1
  }

  return { rows, read, failed }
}

function isWorkflowArtifact(row) {
  const rawPath = asText(row.rawPath)
  const title = asText(row.sourceTitle)
  const sourceId = asText(row.sourceId)
  const sourceUrl = asText(row.sourceUrl)

  if (rawPath === 'payload/bgm-work-field-plan.json' && !title && !sourceId && !sourceUrl) {
    return {
      artifactReason: 'missing_title_no_identity_from_bgm_field_plan',
      artifactKind: 'local_workflow_artifact',
    }
  }

  return null
}

function countRows(rows) {
  const bySource = {}
  const byEligibilityStatus = {}
  const bySourceAndEligibility = {}
  const byMediaType = {}
  const byRawPath = {}

  for (const row of rows) {
    inc(bySource, row.sourceName)
    inc(byEligibilityStatus, row.eligibilityStatus)
    inc(bySourceAndEligibility, `${row.sourceName || 'missing'}:${row.eligibilityStatus || 'missing'}`)
    inc(byMediaType, row.sourceMediaType)
    inc(byRawPath, row.rawPath)
  }

  return {
    bySource: sortCountObject(bySource),
    byEligibilityStatus: sortCountObject(byEligibilityStatus),
    bySourceAndEligibility: sortCountObject(bySourceAndEligibility),
    byMediaType: sortCountObject(byMediaType),
    topRawPaths: Object.fromEntries(Object.entries(sortCountObject(byRawPath)).slice(0, 50)),
  }
}

function compact(row, artifact) {
  return {
    sourceRecordKey: row.sourceRecordKey || '',
    sourceName: row.sourceName || '',
    sourceId: row.sourceId || '',
    sourceUrl: row.sourceUrl || '',
    sourceTitle: row.sourceTitle || '',
    sourceMediaType: row.sourceMediaType || '',
    eligibilityStatus: row.eligibilityStatus || '',
    excludeReason: row.excludeReason || '',
    rawPath: row.rawPath || '',
    artifactKind: artifact?.artifactKind || '',
    artifactReason: artifact?.artifactReason || '',
  }
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
    '# SourceRecord Workflow Artifact Filter v0.1',
    '',
    '## Safety',
    '',
    '- Read-only input scan.',
    '- No database connection is used.',
    '- No importer action is performed.',
    '- Original `source-records-v01` outputs are not modified.',
    '- Generated files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- inputRowsRead: ${report.summary.inputRowsRead}`,
    `- inputRowsFailed: ${report.summary.inputRowsFailed}`,
    `- keptRows: ${report.summary.keptRows}`,
    `- removedRows: ${report.summary.removedRows}`,
    `- outputVersion: ${report.summary.outputVersion}`,
    '',
    ...formatCountTable('Removed rows by reason', report.summary.removedByReason),
    ...formatCountTable('Kept rows by eligibility', report.after.byEligibilityStatus),
    ...formatCountTable('Kept rows by source and eligibility', report.after.bySourceAndEligibility),
    '## Removed row samples',
    '',
    '```json',
    JSON.stringify(report.removedSamples, null, 2),
    '```',
    '',
    '## Next step',
    '',
    '- Use `source-records-v02.jsonl` as the input for the next full-catalog planner if the removed rows match only local workflow artifacts.',
    '- Keep `source-records-v01` for traceability and comparison.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = args.input || DEFAULT_INPUT
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(inputPath)) {
    throw new Error(`SourceRecord input not found: ${inputPath}`)
  }

  console.error(`[source-record-filter] reading: ${inputPath}`)
  const readResult = await readJsonl(inputPath)

  const keptRows = []
  const removedRows = []
  const removedByReason = {}

  for (const row of readResult.rows) {
    const artifact = isWorkflowArtifact(row)
    if (artifact) {
      const removed = compact(row, artifact)
      removedRows.push(removed)
      inc(removedByReason, artifact.artifactReason)
      continue
    }
    keptRows.push(row)
  }

  const before = countRows(readResult.rows)
  const after = countRows(keptRows)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'source-record-workflow-artifact-filter-v0.1',
    outputVersion: 'source-records-v02',
    input: inputPath,
    inputRowsRead: readResult.read,
    inputRowsFailed: readResult.failed,
    keptRows: keptRows.length,
    removedRows: removedRows.length,
    removedByReason: sortCountObject(removedByReason),
    safety: {
      readOnly: true,
      databaseConnection: false,
      importerAction: false,
    },
  }

  const report = {
    ok: true,
    summary,
    before,
    after,
    removedSamples: removedRows.slice(0, SAMPLE_LIMIT),
    outputs: {},
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outJsonl = path.join(outDir, 'source-records-v02.jsonl')
  const outJson = path.join(outDir, 'source-records-v02.json')
  const outSummary = path.join(outDir, 'source-records-v02-summary.json')
  const outMd = path.join(outDir, 'source-records-v02.md')
  const outRemoved = path.join(outDir, 'source-records-v02-removed-workflow-artifacts.jsonl')

  fs.writeFileSync(outJsonl, keptRows.map((row) => JSON.stringify(row)).join('\n') + (keptRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outJson, JSON.stringify({ ...report, rows: keptRows }, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({ summary, before, after }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')
  fs.writeFileSync(outRemoved, removedRows.map((row) => JSON.stringify(row)).join('\n') + (removedRows.length ? '\n' : ''), 'utf8')

  report.outputs = {
    jsonl: outJsonl,
    json: outJson,
    summary: outSummary,
    md: outMd,
    removedWorkflowArtifactsJsonl: outRemoved,
  }

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
