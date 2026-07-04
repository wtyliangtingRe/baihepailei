#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN_V03 = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v03.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/full-catalog-ingestion'
const SAMPLE_LIMIT = 120

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
  node scripts/import/audit-v03-warning-rows-v01.mjs [--plan-v03 <jsonl>] [--out-dir <dir>]

This is a read-only warning-row audit for full catalog ingestion plan v0.3:
  - Reads full-catalog-ingestion-plan-v03.jsonl.
  - Extracts possible_duplicate_title rows.
  - Extracts quarantine rows.
  - Writes JSON / JSONL / summary JSON / Markdown reports.

Safety:
  - No Payload read or write.
  - No PostgreSQL write.
  - No importer apply.
  - No delete.
  - No data_local output should be committed.
`)
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

async function readJsonl(filePath, onRow) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let rows = 0
  let failed = 0

  for await (const line of rl) {
    const text = line.trim()
    if (!text) continue

    try {
      await onRow(JSON.parse(text), rows)
    } catch {
      failed += 1
    }

    rows += 1
  }

  return { rows, failed }
}

function compactPlan(row) {
  return {
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
    matchedWorks: Array.isArray(row.matchedWorks) ? row.matchedWorks : [],
    parentCandidateTitle: row.parentCandidateTitle || '',
    rejectedParentCandidateTitle: row.rejectedParentCandidateTitle || '',
  }
}

function pushSample(collection, row, limit = SAMPLE_LIMIT) {
  if (collection.length < limit) collection.push(compactPlan(row))
}

function analyze(plans) {
  const possibleDuplicateTitleRows = []
  const quarantineRows = []
  const duplicateByTitle = new Map()

  const byWarningAction = {}
  const duplicateBySource = {}
  const duplicateByMediaType = {}
  const quarantineBySource = {}
  const quarantineByMediaType = {}
  const quarantineByReason = {}
  const quarantineByRawPath = {}

  for (const row of plans) {
    if (row.action === 'possible_duplicate_title') {
      const compact = compactPlan(row)
      possibleDuplicateTitleRows.push(compact)
      inc(byWarningAction, row.action)
      inc(duplicateBySource, row.sourceName)
      inc(duplicateByMediaType, row.sourceMediaType)

      const normalized = compact.normalizedTitle || 'missing'
      if (!duplicateByTitle.has(normalized)) duplicateByTitle.set(normalized, [])
      duplicateByTitle.get(normalized).push(compact)
    }

    if (row.action === 'quarantine') {
      const compact = compactPlan(row)
      quarantineRows.push(compact)
      inc(byWarningAction, row.action)
      inc(quarantineBySource, row.sourceName)
      inc(quarantineByMediaType, row.sourceMediaType)
      inc(quarantineByReason, row.reason)
      inc(quarantineByRawPath, row.rawPath)
    }
  }

  const duplicateTitleClusters = [...duplicateByTitle.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([normalizedTitle, rows]) => ({
      normalizedTitle,
      count: rows.length,
      rows,
      matchedWorks: rows.flatMap((row) => Array.isArray(row.matchedWorks) ? row.matchedWorks : []),
    }))

  const recommendations = []

  if (possibleDuplicateTitleRows.length > 0) {
    recommendations.push({
      priority: 'high',
      topic: 'possible_duplicate_title',
      count: possibleDuplicateTitleRows.length,
      message: 'Review duplicate-title rows before any write path. These rows should become manual identity decisions, not automatic creates.',
    })
  }

  if (quarantineRows.length > 0) {
    recommendations.push({
      priority: 'medium',
      topic: 'quarantine',
      count: quarantineRows.length,
      message: 'Inspect quarantine rows and classify them as parse bugs, evidence-only rows, or true junk before import apply scripts exist.',
    })
  }

  return {
    counts: {
      possibleDuplicateTitleRows: possibleDuplicateTitleRows.length,
      quarantineRows: quarantineRows.length,
      totalWarningRows: possibleDuplicateTitleRows.length + quarantineRows.length,
    },
    byWarningAction: sortCountObject(byWarningAction),
    duplicate: {
      bySource: sortCountObject(duplicateBySource),
      byMediaType: sortCountObject(duplicateByMediaType),
      clusters: duplicateTitleClusters,
      rows: possibleDuplicateTitleRows,
    },
    quarantine: {
      bySource: sortCountObject(quarantineBySource),
      byMediaType: sortCountObject(quarantineByMediaType),
      byReason: sortCountObject(quarantineByReason),
      topRawPaths: Object.fromEntries(Object.entries(sortCountObject(quarantineByRawPath)).slice(0, 50)),
      rows: quarantineRows,
    },
    recommendations,
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

function formatRowsTable(title, rows) {
  return [
    `## ${title}`,
    '',
    '| Source | ID | Title | Media | Reason | Raw path |',
    '|---|---|---|---|---|---|',
    ...rows.slice(0, SAMPLE_LIMIT).map((row) => [
      row.sourceName,
      row.sourceId,
      row.sourceTitle,
      row.sourceMediaType,
      row.reason,
      row.rawPath,
    ].map(mdCell).join(' | ')).map((line) => `| ${line} |`),
    '',
  ]
}

function formatMarkdown(report) {
  const lines = [
    '# V03 Warning Rows Audit v0.1',
    '',
    '## Safety',
    '',
    '- No Payload read.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer apply.',
    '- No delete.',
    '- No `data_local` output should be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- planRowsRead: ${report.summary.planRowsRead}`,
    `- planRowsFailed: ${report.summary.planRowsFailed}`,
    `- auditedRows: ${report.summary.auditedRows}`,
    `- totalWarningRows: ${report.analysis.counts.totalWarningRows}`,
    `- possibleDuplicateTitleRows: ${report.analysis.counts.possibleDuplicateTitleRows}`,
    `- quarantineRows: ${report.analysis.counts.quarantineRows}`,
    '',
    ...formatCountTable('By warning action', report.analysis.byWarningAction),
    ...formatCountTable('Duplicate rows by source', report.analysis.duplicate.bySource),
    ...formatCountTable('Duplicate rows by media type', report.analysis.duplicate.byMediaType),
    ...formatCountTable('Quarantine rows by source', report.analysis.quarantine.bySource),
    ...formatCountTable('Quarantine rows by media type', report.analysis.quarantine.byMediaType),
    ...formatCountTable('Quarantine rows by reason', report.analysis.quarantine.byReason),
    '## Recommendations',
    '',
    ...(report.analysis.recommendations.length
      ? report.analysis.recommendations.map((item) => `- **${item.priority} / ${item.topic}** (${item.count}): ${item.message}`)
      : ['- none']),
    '',
    '## Duplicate title clusters',
    '',
    '```json',
    JSON.stringify(report.analysis.duplicate.clusters, null, 2),
    '```',
    '',
    ...formatRowsTable('Quarantine rows', report.analysis.quarantine.rows),
    '## Next step',
    '',
    '- Resolve duplicate-title rows with manual identity decisions before write paths.',
    '- Inspect quarantine rows and decide parse bug / evidence-only / junk classification.',
    '- Keep v03 as the current dry-run plan while these warning rows are handled separately.',
    '',
  ]

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || args.h) {
    usage()
    return
  }

  const planPath = args['plan-v03'] || DEFAULT_PLAN_V03
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planPath)) {
    throw new Error(`v03 plan file not found: ${planPath}\nRun plan-full-catalog-ingestion-v03 first.`)
  }

  const plans = []
  console.error(`[audit-v03-warning] reading v03 plan: ${planPath}`)
  const readResult = await readJsonl(planPath, async (row) => {
    plans.push(row)
  })

  const analysis = analyze(plans)
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v03-warning-rows-v0.1',
    input: planPath,
    planRowsRead: readResult.rows,
    planRowsFailed: readResult.failed,
    auditedRows: plans.length,
    warningRows: analysis.counts,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerApply: false,
      delete: false,
    },
  }

  const report = {
    ok: true,
    summary,
    analysis,
    outputs: {},
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJson = path.join(outDir, 'v03-warning-rows-audit-v01.json')
  const outSummary = path.join(outDir, 'v03-warning-rows-audit-v01-summary.json')
  const outMd = path.join(outDir, 'v03-warning-rows-audit-v01.md')
  const outDuplicatesJsonl = path.join(outDir, 'v03-warning-possible-duplicate-title-v01.jsonl')
  const outQuarantineJsonl = path.join(outDir, 'v03-warning-quarantine-v01.jsonl')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({ summary, counts: analysis.counts, recommendations: analysis.recommendations }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')
  fs.writeFileSync(outDuplicatesJsonl, analysis.duplicate.rows.map((row) => JSON.stringify(row)).join('\n') + (analysis.duplicate.rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outQuarantineJsonl, analysis.quarantine.rows.map((row) => JSON.stringify(row)).join('\n') + (analysis.quarantine.rows.length ? '\n' : ''), 'utf8')

  report.outputs = {
    json: outJson,
    summary: outSummary,
    md: outMd,
    possibleDuplicateTitleJsonl: outDuplicatesJsonl,
    quarantineJsonl: outQuarantineJsonl,
  }

  console.log(JSON.stringify({
    ok: true,
    summary,
    counts: analysis.counts,
    recommendations: analysis.recommendations,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
