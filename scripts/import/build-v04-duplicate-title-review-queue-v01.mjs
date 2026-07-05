#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v04.jsonl'
const DEFAULT_SUMMARY = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v04-summary.json'
const DEFAULT_OUT_DIR = 'data_local/staging/full-catalog-ingestion'

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

function normalizeWhitespace(value) {
  return asText(value).replace(/\s+/gu, ' ')
}

function normalizeTitle(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u3000\s]+/gu, ' ')
    .replace(/[「」『』【】\[\]（）()〈〉《》]/gu, '')
    .replace(/[,:;，。！？!?.·・~〜ー—–_\-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function inc(map, key) {
  const normalized = asText(key) || 'missing'
  map[normalized] = (map[normalized] || 0) + 1
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

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function compactWork(work) {
  return {
    id: work?.id || '',
    siteId: work?.siteId || '',
    slug: work?.slug || '',
    title: work?.title || '',
    chosenBaseSource: work?.chosenBaseSource || '',
    publicCatalog: Boolean(work?.publicCatalog),
  }
}

function compactRow(row) {
  const matchedWorks = Array.isArray(row.matchedWorks) ? row.matchedWorks.map(compactWork) : []
  return {
    reviewAction: 'manual_identity_review',
    reviewReason: 'normalized_title_matches_multiple_works',
    safeForAutomaticResolution: false,
    suggestedNextStep: 'Compare matched Works and source row context before choosing link target, merge candidate, or keep-separate decision.',
    sourceRecordKey: row.sourceRecordKey || '',
    sourceName: row.sourceName || '',
    sourceId: row.sourceId || '',
    sourceUrl: row.sourceUrl || '',
    sourceTitle: row.sourceTitle || '',
    normalizedTitle: normalizeTitle(row.sourceTitle),
    sourceMediaType: row.sourceMediaType || '',
    eligibilityStatus: row.eligibilityStatus || '',
    action: row.action || '',
    reason: row.reason || '',
    confidence: row.confidence || '',
    entityBoundary: row.entityBoundary || '',
    boundaryReason: row.boundaryReason || '',
    rawPath: row.rawPath || '',
    matchedWorks,
    matchedWorkCount: matchedWorks.length,
  }
}

function analyze(reviewRows, summaryInput) {
  const byTitle = {}
  const bySource = {}
  const byMediaType = {}
  const byRawPath = {}
  const byMatchedWorkCount = {}
  const byPayloadBaselineState = {}

  const payloadChecked = summaryInput?.payloadChecked === true
  const payloadWorks = Number(summaryInput?.payloadWorks || 0)
  const hasPayloadBaseline = payloadChecked && payloadWorks > 0
  inc(byPayloadBaselineState, hasPayloadBaseline ? 'payload_baseline_present' : 'payload_baseline_missing')

  for (const row of reviewRows) {
    inc(byTitle, row.normalizedTitle)
    inc(bySource, row.sourceName)
    inc(byMediaType, row.sourceMediaType)
    inc(byRawPath, row.rawPath)
    inc(byMatchedWorkCount, String(row.matchedWorkCount))
  }

  const clusters = Object.entries(reviewRows.reduce((acc, row) => {
    const key = row.normalizedTitle || 'missing'
    if (!acc[key]) acc[key] = []
    acc[key].push(row)
    return acc
  }, {})).map(([normalizedTitle, rows]) => ({
    normalizedTitle,
    count: rows.length,
    sourceRecordKeys: rows.map((row) => row.sourceRecordKey),
    matchedWorks: rows.flatMap((row) => row.matchedWorks),
    rows,
  }))

  const blockers = []
  const warnings = []

  if (!hasPayloadBaseline) blockers.push('v04 summary is not a Payload comparison baseline')
  if (reviewRows.some((row) => row.safeForAutomaticResolution)) blockers.push('automatic resolution flag must remain false')
  if (reviewRows.length === 0) warnings.push('no duplicate-title review rows found')

  return {
    readyForManualIdentityReview: blockers.length === 0,
    blockers,
    warnings,
    counts: {
      reviewRows: reviewRows.length,
      clusters: clusters.length,
      payloadChecked,
      payloadWorks,
      automaticResolutionRows: reviewRows.filter((row) => row.safeForAutomaticResolution).length,
    },
    byTitle: sortCountObject(byTitle),
    bySource: sortCountObject(bySource),
    byMediaType: sortCountObject(byMediaType),
    byMatchedWorkCount: sortCountObject(byMatchedWorkCount),
    topRawPaths: Object.fromEntries(Object.entries(sortCountObject(byRawPath)).slice(0, 50)),
    byPayloadBaselineState: sortCountObject(byPayloadBaselineState),
    clusters,
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

function formatRowsTable(rows) {
  return [
    '## Review rows',
    '',
    '| Source | ID | Title | Media | Matched Works | Raw path |',
    '|---|---|---|---|---:|---|',
    ...rows.map((row) => [
      row.sourceName,
      row.sourceId,
      row.sourceTitle,
      row.sourceMediaType,
      row.matchedWorkCount,
      row.rawPath,
    ].map(mdCell).join(' | ')).map((line) => `| ${line} |`),
    '',
  ]
}

function formatMarkdown(report) {
  return [
    '# V04 Duplicate Title Review Queue v0.1',
    '',
    '## Safety',
    '',
    '- Read-only review queue builder.',
    '- No database connection is used.',
    '- No importer action is performed.',
    '- No automatic identity decision is made.',
    '- Generated files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- readyForManualIdentityReview: ${report.analysis.readyForManualIdentityReview}`,
    `- planRowsRead: ${report.summary.planRowsRead}`,
    `- planRowsFailed: ${report.summary.planRowsFailed}`,
    `- reviewRows: ${report.analysis.counts.reviewRows}`,
    `- clusters: ${report.analysis.counts.clusters}`,
    `- payloadChecked: ${report.analysis.counts.payloadChecked}`,
    `- payloadWorks: ${report.analysis.counts.payloadWorks}`,
    '',
    '## Blockers',
    '',
    ...(report.analysis.blockers.length ? report.analysis.blockers.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Warnings',
    '',
    ...(report.analysis.warnings.length ? report.analysis.warnings.map((item) => `- ${item}`) : ['- none']),
    '',
    ...formatCountTable('By normalized title', report.analysis.byTitle),
    ...formatCountTable('By source', report.analysis.bySource),
    ...formatCountTable('By media type', report.analysis.byMediaType),
    ...formatCountTable('By matched Work count', report.analysis.byMatchedWorkCount),
    ...formatRowsTable(report.reviewRows),
    '## Clusters',
    '',
    '```json',
    JSON.stringify(report.analysis.clusters, null, 2),
    '```',
    '',
    '## Next step',
    '',
    '- Review each cluster manually before any link or merge path exists.',
    '- Keep these rows separate from bulk import planning.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const planPath = args.plan || DEFAULT_PLAN
  const summaryPath = args.summary || DEFAULT_SUMMARY
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planPath)) throw new Error(`v04 plan JSONL not found: ${planPath}`)

  const plan = await readJsonl(planPath)
  const summaryInput = readJsonIfExists(summaryPath)
  const reviewRows = plan.rows
    .filter((row) => row.action === 'possible_duplicate_title')
    .map(compactRow)

  const analysis = analyze(reviewRows, summaryInput)
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v04-duplicate-title-review-queue-v0.1',
    planPath,
    summaryPath,
    planRowsRead: plan.read,
    planRowsFailed: plan.failed,
    safety: {
      readOnly: true,
      databaseConnection: false,
      importerAction: false,
      automaticIdentityDecision: false,
    },
  }

  const report = { ok: true, summary, analysis, reviewRows, outputs: {} }

  fs.mkdirSync(outDir, { recursive: true })
  const outJsonl = path.join(outDir, 'v04-duplicate-title-review-queue-v01.jsonl')
  const outJson = path.join(outDir, 'v04-duplicate-title-review-queue-v01.json')
  const outSummary = path.join(outDir, 'v04-duplicate-title-review-queue-v01-summary.json')
  const outMd = path.join(outDir, 'v04-duplicate-title-review-queue-v01.md')

  fs.writeFileSync(outJsonl, reviewRows.map((row) => JSON.stringify(row)).join('\n') + (reviewRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({ summary, counts: analysis.counts, byTitle: analysis.byTitle, blockers: analysis.blockers, warnings: analysis.warnings }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = { jsonl: outJsonl, json: outJson, summary: outSummary, md: outMd }

  console.log(JSON.stringify({
    ok: true,
    summary,
    readyForManualIdentityReview: analysis.readyForManualIdentityReview,
    blockers: analysis.blockers,
    warnings: analysis.warnings,
    counts: analysis.counts,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
