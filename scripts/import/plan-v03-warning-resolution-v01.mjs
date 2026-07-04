#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_DUPLICATES = 'data_local/staging/full-catalog-ingestion/v03-warning-possible-duplicate-title-v01.jsonl'
const DEFAULT_QUARANTINE = 'data_local/staging/full-catalog-ingestion/v03-warning-quarantine-v01.jsonl'
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
  if (!fs.existsSync(filePath)) return { rows, read: 0, failed: 0, missing: true }

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

  return { rows, read, failed, missing: false }
}

function compact(row) {
  return {
    sourceRecordKey: row.sourceRecordKey || '',
    sourceName: row.sourceName || '',
    sourceId: row.sourceId || '',
    sourceUrl: row.sourceUrl || '',
    sourceTitle: row.sourceTitle || '',
    normalizedTitle: row.normalizedTitle || normalizeTitle(row.sourceTitle),
    sourceMediaType: row.sourceMediaType || '',
    eligibilityStatus: row.eligibilityStatus || '',
    action: row.action || '',
    reason: row.reason || '',
    confidence: row.confidence || '',
    rawPath: row.rawPath || '',
    matchedWorks: Array.isArray(row.matchedWorks) ? row.matchedWorks : [],
  }
}

function classifyDuplicate(row) {
  const base = compact(row)
  const matched = base.matchedWorks.map((work) => work.siteId || work.slug || String(work.id || '')).filter(Boolean)
  return {
    warningType: 'possible_duplicate_title',
    resolutionAction: matched.length >= 2 ? 'manual_identity_review' : 'manual_review',
    resolutionReason: base.normalizedTitle === '雨眠'
      ? 'known_yumian_duplicate_title_cluster'
      : 'title_matches_existing_work_candidates',
    priority: 'high',
    applyAllowed: false,
    suggestedNextStep: 'Review source URL, media type, creator/context, and matched Works before choosing link, merge, or keep-separate handling.',
    ...base,
  }
}

function classifyQuarantine(row) {
  const base = compact(row)
  const hasTitle = Boolean(base.sourceTitle)
  const hasIdentity = Boolean(base.sourceId || base.sourceUrl)
  const isFieldPlanArtifact = base.rawPath === 'payload/bgm-work-field-plan.json'

  let resolutionAction = 'quarantine_review'
  let resolutionReason = 'quarantine_row_needs_review'
  let priority = 'medium'
  let suggestedNextStep = 'Classify as parse issue, evidence-only candidate, or local-only junk.'

  if (!hasTitle && !hasIdentity && isFieldPlanArtifact) {
    resolutionAction = 'local_workflow_artifact'
    resolutionReason = 'missing_title_no_identity_from_field_plan_artifact'
    priority = 'low'
    suggestedNextStep = 'Keep local-only and do not promote as catalog source evidence.'
  } else if (!hasTitle && hasIdentity) {
    resolutionAction = 'evidence_only_review'
    resolutionReason = 'missing_title_but_has_identity_hint'
    suggestedNextStep = 'Check whether this belongs in evidence-only rows.'
  }

  return {
    warningType: 'quarantine',
    resolutionAction,
    resolutionReason,
    priority,
    applyAllowed: false,
    suggestedNextStep,
    ...base,
  }
}

function analyze(rows) {
  const byWarningType = {}
  const byResolutionAction = {}
  const byResolutionReason = {}
  const byPriority = {}
  const bySource = {}
  const byRawPath = {}

  for (const row of rows) {
    inc(byWarningType, row.warningType)
    inc(byResolutionAction, row.resolutionAction)
    inc(byResolutionReason, row.resolutionReason)
    inc(byPriority, row.priority)
    inc(bySource, row.sourceName)
    inc(byRawPath, row.rawPath)
  }

  const duplicateClusters = {}
  for (const row of rows.filter((item) => item.warningType === 'possible_duplicate_title')) {
    const key = row.normalizedTitle || 'missing'
    if (!duplicateClusters[key]) duplicateClusters[key] = []
    duplicateClusters[key].push(row.sourceRecordKey)
  }

  return {
    counts: {
      totalRows: rows.length,
      duplicateRows: rows.filter((row) => row.warningType === 'possible_duplicate_title').length,
      quarantineRows: rows.filter((row) => row.warningType === 'quarantine').length,
      applyAllowedRows: rows.filter((row) => row.applyAllowed).length,
      reviewOnlyRows: rows.filter((row) => !row.applyAllowed).length,
    },
    byWarningType: sortCountObject(byWarningType),
    byResolutionAction: sortCountObject(byResolutionAction),
    byResolutionReason: sortCountObject(byResolutionReason),
    byPriority: sortCountObject(byPriority),
    bySource: sortCountObject(bySource),
    topRawPaths: Object.fromEntries(Object.entries(sortCountObject(byRawPath)).slice(0, 50)),
    duplicateClusters,
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
    '## Resolution rows',
    '',
    '| Warning | Resolution | Priority | Source | Title / Key | Reason |',
    '|---|---|---|---|---|---|',
    ...rows.slice(0, 120).map((row) => [
      row.warningType,
      row.resolutionAction,
      row.priority,
      row.sourceName,
      row.sourceTitle || row.sourceRecordKey,
      row.resolutionReason,
    ].map(mdCell).join(' | ')).map((line) => `| ${line} |`),
    '',
  ]
}

function formatMarkdown(report) {
  return [
    '# V03 Warning Resolution Preview v0.1',
    '',
    '## Safety',
    '',
    '- Read-only classification preview.',
    '- No database connection is used.',
    '- No importer action is performed.',
    '- Generated files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- duplicateRowsRead: ${report.summary.duplicateRowsRead}`,
    `- quarantineRowsRead: ${report.summary.quarantineRowsRead}`,
    `- totalRows: ${report.analysis.counts.totalRows}`,
    `- applyAllowedRows: ${report.analysis.counts.applyAllowedRows}`,
    `- reviewOnlyRows: ${report.analysis.counts.reviewOnlyRows}`,
    '',
    ...formatCountTable('By warning type', report.analysis.byWarningType),
    ...formatCountTable('By resolution action', report.analysis.byResolutionAction),
    ...formatCountTable('By resolution reason', report.analysis.byResolutionReason),
    ...formatCountTable('By priority', report.analysis.byPriority),
    '## Duplicate clusters',
    '',
    '```json',
    JSON.stringify(report.analysis.duplicateClusters, null, 2),
    '```',
    '',
    ...formatRowsTable(report.resolutionRows),
    '## Next step',
    '',
    '- Review the 雨眠 cluster as a manual identity decision.',
    '- Treat field-plan quarantine rows as local workflow artifacts if this preview is accepted.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.h) {
    usage()
    return
  }

  const duplicatePath = args.duplicates || DEFAULT_DUPLICATES
  const quarantinePath = args.quarantine || DEFAULT_QUARANTINE
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  const duplicates = await readJsonl(duplicatePath)
  const quarantine = await readJsonl(quarantinePath)

  const resolutionRows = [
    ...duplicates.rows.map(classifyDuplicate),
    ...quarantine.rows.map(classifyQuarantine),
  ]

  const analysis = analyze(resolutionRows)
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v03-warning-resolution-v0.1',
    duplicateInput: duplicatePath,
    quarantineInput: quarantinePath,
    duplicateRowsRead: duplicates.read,
    duplicateRowsFailed: duplicates.failed,
    duplicateRowsMissing: duplicates.missing,
    quarantineRowsRead: quarantine.read,
    quarantineRowsFailed: quarantine.failed,
    quarantineRowsMissing: quarantine.missing,
    resolutionRows: resolutionRows.length,
    safety: {
      readOnly: true,
      databaseConnection: false,
      importerAction: false,
    },
  }

  const report = { ok: true, summary, analysis, resolutionRows, outputs: {} }

  fs.mkdirSync(outDir, { recursive: true })
  const outJsonl = path.join(outDir, 'v03-warning-resolution-preview-v01.jsonl')
  const outJson = path.join(outDir, 'v03-warning-resolution-preview-v01.json')
  const outSummary = path.join(outDir, 'v03-warning-resolution-preview-v01-summary.json')
  const outMd = path.join(outDir, 'v03-warning-resolution-preview-v01.md')

  fs.writeFileSync(outJsonl, resolutionRows.map((row) => JSON.stringify(row)).join('\n') + (resolutionRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({ summary, counts: analysis.counts, byResolutionAction: analysis.byResolutionAction, byResolutionReason: analysis.byResolutionReason, byPriority: analysis.byPriority }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = { jsonl: outJsonl, json: outJson, summary: outSummary, md: outMd }

  console.log(JSON.stringify({
    ok: true,
    summary,
    counts: analysis.counts,
    byResolutionAction: analysis.byResolutionAction,
    byResolutionReason: analysis.byResolutionReason,
    byPriority: analysis.byPriority,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
