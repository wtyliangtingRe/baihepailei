#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN_V04 = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v04.jsonl'
const DEFAULT_PLAN_V03 = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v03.jsonl'
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

function isPureNumeric(value) {
  return /^\d+$/u.test(normalizeWhitespace(value))
}

function isTooShortParent(value) {
  const normalized = normalizeTitle(value)
  return normalized.length > 0 && normalized.length < 2
}

function isWorkflowArtifact(row) {
  return row.rawPath === 'payload/bgm-work-field-plan.json'
    && !asText(row.sourceTitle)
    && !asText(row.sourceId)
    && !asText(row.sourceUrl)
}

function compact(row) {
  return {
    sourceRecordKey: row.sourceRecordKey || '',
    sourceName: row.sourceName || '',
    sourceId: row.sourceId || '',
    sourceUrl: row.sourceUrl || '',
    sourceTitle: row.sourceTitle || '',
    sourceMediaType: row.sourceMediaType || '',
    eligibilityStatus: row.eligibilityStatus || '',
    action: row.action || '',
    reason: row.reason || '',
    confidence: row.confidence || '',
    entityBoundary: row.entityBoundary || '',
    boundaryReason: row.boundaryReason || '',
    parentCandidateTitle: row.parentCandidateTitle || '',
    rejectedParentCandidateTitle: row.rejectedParentCandidateTitle || '',
    parentTitleInferenceRejectedReason: row.parentTitleInferenceRejectedReason || '',
    rawPath: row.rawPath || '',
  }
}

function pushSample(samples, row) {
  if (samples.length < SAMPLE_LIMIT) samples.push(compact(row))
}

function countPlans(rows) {
  const byAction = {}
  const byReason = {}
  const bySource = {}
  const bySourceAction = {}
  const byMediaType = {}
  const byConfidence = {}
  const byEntityBoundary = {}
  const byBoundaryReason = {}
  const rejectedByReason = {}

  for (const row of rows) {
    inc(byAction, row.action)
    inc(byReason, row.reason)
    inc(bySource, row.sourceName)
    inc(bySourceAction, `${row.sourceName || 'missing'}:${row.action || 'missing'}`)
    inc(byMediaType, row.sourceMediaType)
    inc(byConfidence, row.confidence)
    inc(byEntityBoundary, row.entityBoundary)
    inc(byBoundaryReason, row.boundaryReason)
    if (row.parentTitleInferenceRejected) inc(rejectedByReason, row.parentTitleInferenceRejectedReason)
  }

  return {
    byAction: sortCountObject(byAction),
    byReason: sortCountObject(byReason),
    bySource: sortCountObject(bySource),
    bySourceAction: sortCountObject(bySourceAction),
    byMediaType: sortCountObject(byMediaType),
    byConfidence: sortCountObject(byConfidence),
    byEntityBoundary: sortCountObject(byEntityBoundary),
    byBoundaryReason: sortCountObject(byBoundaryReason),
    rejectedByReason: sortCountObject(rejectedByReason),
  }
}

function computeActionDelta(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  return Object.fromEntries([...keys].sort().map((key) => {
    const beforeCount = Number(before?.[key] || 0)
    const afterCount = Number(after?.[key] || 0)
    return [key, { before: beforeCount, after: afterCount, delta: afterCount - beforeCount }]
  }))
}

function analyze(rows) {
  const samples = {
    quarantineRows: [],
    missingTitleRows: [],
    workflowArtifactRows: [],
    noisyParentCandidatesRemaining: [],
    rejectedParentCandidates: [],
    possibleDuplicateTitle: [],
  }

  let quarantineRows = 0
  let missingTitleRows = 0
  let workflowArtifactRows = 0
  let numericParentCandidatesRemaining = 0
  let tooShortParentCandidatesRemaining = 0
  let rejectedParentCandidates = 0
  let possibleDuplicateTitle = 0

  for (const row of rows) {
    const parent = normalizeWhitespace(row.parentCandidateTitle)

    if (row.action === 'quarantine') {
      quarantineRows += 1
      pushSample(samples.quarantineRows, row)
    }

    if (row.reason === 'missing_title' || row.excludeReason === 'missing_title') {
      missingTitleRows += 1
      pushSample(samples.missingTitleRows, row)
    }

    if (isWorkflowArtifact(row)) {
      workflowArtifactRows += 1
      pushSample(samples.workflowArtifactRows, row)
    }

    if (parent && isPureNumeric(parent)) {
      numericParentCandidatesRemaining += 1
      pushSample(samples.noisyParentCandidatesRemaining, row)
    } else if (parent && isTooShortParent(parent)) {
      tooShortParentCandidatesRemaining += 1
      pushSample(samples.noisyParentCandidatesRemaining, row)
    }

    if (row.parentTitleInferenceRejected) {
      rejectedParentCandidates += 1
      pushSample(samples.rejectedParentCandidates, row)
    }

    if (row.action === 'possible_duplicate_title') {
      possibleDuplicateTitle += 1
      pushSample(samples.possibleDuplicateTitle, row)
    }
  }

  const noisyParentCandidatesRemaining = numericParentCandidatesRemaining + tooShortParentCandidatesRemaining

  const blockers = []
  const warnings = []

  if (quarantineRows > 0) blockers.push(`quarantine rows remain: ${quarantineRows}`)
  if (missingTitleRows > 0) blockers.push(`missing-title plan rows remain: ${missingTitleRows}`)
  if (workflowArtifactRows > 0) blockers.push(`workflow artifact rows remain: ${workflowArtifactRows}`)
  if (noisyParentCandidatesRemaining > 0) blockers.push(`noisy parent candidates remain: ${noisyParentCandidatesRemaining}`)

  if (possibleDuplicateTitle > 0) warnings.push(`possible duplicate title rows remain: ${possibleDuplicateTitle}`)
  if (rejectedParentCandidates === 0) warnings.push('no rejected parent candidates were found; verify v04 was produced through the tightening path')

  return {
    readyForV04UseAsCurrentDryRunPlan: blockers.length === 0,
    blockers,
    warnings,
    riskCounts: {
      quarantineRows,
      missingTitleRows,
      workflowArtifactRows,
      numericParentCandidatesRemaining,
      tooShortParentCandidatesRemaining,
      noisyParentCandidatesRemaining,
      rejectedParentCandidates,
      possibleDuplicateTitle,
      lowConfidence: rows.filter((row) => row.confidence === 'low').length,
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

function formatDeltaTable(delta) {
  return [
    '## v03 → v04 action delta',
    '',
    '| Action | v03 | v04 | Delta |',
    '|---|---:|---:|---:|',
    ...Object.entries(delta || {}).map(([key, item]) => `| ${mdCell(key)} | ${item.before} | ${item.after} | ${item.delta} |`),
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
    '# Full Catalog Ingestion Plan v0.4 Audit',
    '',
    '## Safety',
    '',
    '- Read-only audit.',
    '- No database connection is used.',
    '- No importer action is performed.',
    '- Generated files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- planV04RowsRead: ${report.summary.planV04RowsRead}`,
    `- planV04RowsFailed: ${report.summary.planV04RowsFailed}`,
    `- auditedRows: ${report.summary.auditedRows}`,
    `- planV03Checked: ${report.summary.planV03Checked}`,
    `- readyForV04UseAsCurrentDryRunPlan: ${report.analysis.readyForV04UseAsCurrentDryRunPlan}`,
    '',
    '## Blockers',
    '',
    ...(report.analysis.blockers.length ? report.analysis.blockers.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Warnings',
    '',
    ...(report.analysis.warnings.length ? report.analysis.warnings.map((item) => `- ${item}`) : ['- none']),
    '',
    ...formatCountTable('By action', report.summary.byAction),
    ...formatCountTable('By reason', report.summary.byReason),
    ...formatCountTable('By entity boundary', report.summary.byEntityBoundary),
    ...formatCountTable('Rejected parent candidates by reason', report.summary.rejectedByReason),
    ...formatDeltaTable(report.comparison.actionDelta),
    '## Risk counts',
    '',
    '| Risk | Count |',
    '|---|---:|',
    ...Object.entries(report.analysis.riskCounts).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
    ...formatSamples('Workflow artifact samples', report.analysis.samples.workflowArtifactRows),
    ...formatSamples('Noisy parent candidates remaining samples', report.analysis.samples.noisyParentCandidatesRemaining),
    ...formatSamples('Rejected parent candidate samples', report.analysis.samples.rejectedParentCandidates),
    ...formatSamples('Possible duplicate title samples', report.analysis.samples.possibleDuplicateTitle),
    '## Next step',
    '',
    '- If this audit has no blockers, keep v04 as the current full-catalog dry-run plan.',
    '- Continue handling duplicate-title identity decisions separately.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const planV04Path = args['plan-v04'] || DEFAULT_PLAN_V04
  const planV03Path = args['plan-v03'] || DEFAULT_PLAN_V03
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planV04Path)) throw new Error(`v04 plan file not found: ${planV04Path}`)

  console.error(`[audit-v04] reading v04 plan: ${planV04Path}`)
  const v04 = await readJsonl(planV04Path)

  let v03 = { rows: [], read: 0, failed: 0, missing: true }
  if (!args['no-v03'] && fs.existsSync(planV03Path)) {
    console.error(`[audit-v04] reading v03 plan for comparison: ${planV03Path}`)
    v03 = await readJsonl(planV03Path)
  }

  const v04Counts = countPlans(v04.rows)
  const v03Counts = countPlans(v03.rows)
  const analysis = analyze(v04.rows)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v0.4-audit',
    planV04RowsRead: v04.read,
    planV04RowsFailed: v04.failed,
    auditedRows: v04.rows.length,
    planV03Checked: !v03.missing,
    planV03RowsRead: v03.read,
    planV03RowsFailed: v03.failed,
    ...v04Counts,
    riskCounts: analysis.riskCounts,
    safety: {
      readOnly: true,
      databaseConnection: false,
      importerAction: false,
    },
  }

  const report = {
    ok: true,
    summary,
    comparison: {
      v03Available: !v03.missing,
      actionDelta: computeActionDelta(v03Counts.byAction, v04Counts.byAction),
    },
    analysis,
    outputs: {},
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outJson = path.join(outDir, 'full-catalog-ingestion-plan-v04-audit.json')
  const outSummary = path.join(outDir, 'full-catalog-ingestion-plan-v04-audit-summary.json')
  const outMd = path.join(outDir, 'full-catalog-ingestion-plan-v04-audit.md')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({
    summary,
    comparison: report.comparison,
    analysis: {
      readyForV04UseAsCurrentDryRunPlan: analysis.readyForV04UseAsCurrentDryRunPlan,
      blockers: analysis.blockers,
      warnings: analysis.warnings,
      riskCounts: analysis.riskCounts,
    },
  }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = { json: outJson, summary: outSummary, md: outMd }

  console.log(JSON.stringify({
    ok: true,
    summary,
    comparison: report.comparison,
    readyForV04UseAsCurrentDryRunPlan: analysis.readyForV04UseAsCurrentDryRunPlan,
    blockers: analysis.blockers,
    warnings: analysis.warnings,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
