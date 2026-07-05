#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN_JSONL = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v04.jsonl'
const DEFAULT_PLAN_SUMMARY = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v04-summary.json'
const DEFAULT_OUT_DIR = 'data_local/staging/full-catalog-ingestion'
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
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

function compact(row) {
  return {
    sourceRecordKey: row.sourceRecordKey || '',
    sourceName: row.sourceName || '',
    sourceId: row.sourceId || '',
    sourceTitle: row.sourceTitle || '',
    sourceMediaType: row.sourceMediaType || '',
    action: row.action || '',
    reason: row.reason || '',
    confidence: row.confidence || '',
    entityBoundary: row.entityBoundary || '',
    boundaryReason: row.boundaryReason || '',
    rawPath: row.rawPath || '',
  }
}

function pushSample(samples, row) {
  if (samples.length < SAMPLE_LIMIT) samples.push(compact(row))
}

function countRows(rows) {
  const byAction = {}
  const byReason = {}
  const bySourceAction = {}
  const byConfidence = {}

  for (const row of rows) {
    inc(byAction, row.action)
    inc(byReason, row.reason)
    inc(bySourceAction, `${row.sourceName || 'missing'}:${row.action || 'missing'}`)
    inc(byConfidence, row.confidence)
  }

  return {
    byAction: sortCountObject(byAction),
    byReason: sortCountObject(byReason),
    bySourceAction: sortCountObject(bySourceAction),
    byConfidence: sortCountObject(byConfidence),
  }
}

function analyze(summary, rows) {
  const samples = {
    needsPayloadComparison: [],
    duplicateTitle: [],
    quarantine: [],
    workflowArtifact: [],
  }

  let needsPayloadComparison = 0
  let possibleDuplicateTitle = 0
  let quarantineRows = 0
  let workflowArtifactRows = 0

  for (const row of rows) {
    if (row.action === 'needs_payload_comparison') {
      needsPayloadComparison += 1
      pushSample(samples.needsPayloadComparison, row)
    }
    if (row.action === 'possible_duplicate_title') {
      possibleDuplicateTitle += 1
      pushSample(samples.duplicateTitle, row)
    }
    if (row.action === 'quarantine') {
      quarantineRows += 1
      pushSample(samples.quarantine, row)
    }
    if (row.rawPath === 'payload/bgm-work-field-plan.json' && !asText(row.sourceTitle) && !asText(row.sourceId) && !asText(row.sourceUrl)) {
      workflowArtifactRows += 1
      pushSample(samples.workflowArtifact, row)
    }
  }

  const blockers = []
  const warnings = []

  if (summary.payloadChecked !== true) blockers.push('payloadChecked is not true')
  if (Number(summary.payloadWorks || 0) <= 0) blockers.push('payloadWorks is not positive')
  if (needsPayloadComparison > 0) blockers.push(`needs_payload_comparison rows remain: ${needsPayloadComparison}`)
  if (quarantineRows > 0) blockers.push(`quarantine rows remain: ${quarantineRows}`)
  if (workflowArtifactRows > 0) blockers.push(`workflow artifact rows remain: ${workflowArtifactRows}`)
  if (Number(summary.sourceRecordsFailed || 0) !== 0) blockers.push(`sourceRecordsFailed is not zero: ${summary.sourceRecordsFailed}`)
  if (Number(summary.plannedRows || 0) !== rows.length) blockers.push(`plannedRows does not match JSONL rows: ${summary.plannedRows} vs ${rows.length}`)

  if (possibleDuplicateTitle > 0) warnings.push(`possible duplicate title rows remain for manual identity review: ${possibleDuplicateTitle}`)

  return {
    readyForPayloadBaseline: blockers.length === 0,
    blockers,
    warnings,
    riskCounts: {
      jsonlRows: rows.length,
      sourceRecordsRead: Number(summary.sourceRecordsRead || 0),
      sourceRecordsFailed: Number(summary.sourceRecordsFailed || 0),
      plannedRows: Number(summary.plannedRows || 0),
      payloadChecked: Boolean(summary.payloadChecked),
      payloadWorks: Number(summary.payloadWorks || 0),
      needsPayloadComparison,
      possibleDuplicateTitle,
      quarantineRows,
      workflowArtifactRows,
      rejectedParentCandidates: Number(summary.rejectedParentCandidates || 0),
      actionChangedRows: Number(summary.actionChangedRows || 0),
    },
    samples,
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

function formatSamples(title, rows) {
  return [
    `## ${title}`,
    '',
    '```json',
    JSON.stringify(rows || [], null, 2),
    '```',
    '',
  ]
}

function formatMarkdown(report) {
  return [
    '# V04 Payload Baseline Guard v0.1',
    '',
    '## Safety',
    '',
    '- Read-only guard.',
    '- No database connection is used.',
    '- No importer action is performed.',
    '- Generated files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- readyForPayloadBaseline: ${report.analysis.readyForPayloadBaseline}`,
    `- planRowsRead: ${report.summary.planRowsRead}`,
    `- planRowsFailed: ${report.summary.planRowsFailed}`,
    `- payloadChecked: ${report.analysis.riskCounts.payloadChecked}`,
    `- payloadWorks: ${report.analysis.riskCounts.payloadWorks}`,
    `- needsPayloadComparison: ${report.analysis.riskCounts.needsPayloadComparison}`,
    '',
    '## Blockers',
    '',
    ...(report.analysis.blockers.length ? report.analysis.blockers.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Warnings',
    '',
    ...(report.analysis.warnings.length ? report.analysis.warnings.map((item) => `- ${item}`) : ['- none']),
    '',
    ...formatCountTable('By action', report.counts.byAction),
    ...formatCountTable('By reason', report.counts.byReason),
    '## Risk counts',
    '',
    '| Risk | Count |',
    '|---|---:|',
    ...Object.entries(report.analysis.riskCounts).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
    ...formatSamples('needs_payload_comparison samples', report.analysis.samples.needsPayloadComparison),
    ...formatSamples('possible_duplicate_title samples', report.analysis.samples.duplicateTitle),
    '## Next step',
    '',
    '- If blockers are present, rerun `plan-full-catalog-ingestion-v04.mjs` with Payload credentials and audit again.',
    '- Treat `possible_duplicate_title` as manual identity review, not as an automatic write path.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const planJsonl = args.plan || DEFAULT_PLAN_JSONL
  const planSummary = args.summary || DEFAULT_PLAN_SUMMARY
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planJsonl)) throw new Error(`v04 plan JSONL not found: ${planJsonl}`)
  if (!fs.existsSync(planSummary)) throw new Error(`v04 plan summary not found: ${planSummary}`)

  const summaryInput = readJson(planSummary)
  const plan = await readJsonl(planJsonl)
  const counts = countRows(plan.rows)
  const analysis = analyze(summaryInput, plan.rows)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v04-payload-baseline-guard-v0.1',
    planJsonl,
    planSummary,
    planRowsRead: plan.read,
    planRowsFailed: plan.failed,
    safety: {
      readOnly: true,
      databaseConnection: false,
      importerAction: false,
    },
  }

  const report = { ok: true, summary, sourceSummary: summaryInput, counts, analysis, outputs: {} }

  fs.mkdirSync(outDir, { recursive: true })
  const outJson = path.join(outDir, 'v04-payload-baseline-guard-v01.json')
  const outSummary = path.join(outDir, 'v04-payload-baseline-guard-v01-summary.json')
  const outMd = path.join(outDir, 'v04-payload-baseline-guard-v01.md')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({ summary, counts, analysis: { ...analysis, samples: undefined } }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = { json: outJson, summary: outSummary, md: outMd }

  console.log(JSON.stringify({
    ok: true,
    summary,
    readyForPayloadBaseline: analysis.readyForPayloadBaseline,
    blockers: analysis.blockers,
    warnings: analysis.warnings,
    riskCounts: analysis.riskCounts,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
