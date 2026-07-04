#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN_V03 = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v03.jsonl'
const DEFAULT_PLAN_V02 = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v02.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/full-catalog-ingestion'
const SAMPLE_LIMIT = 80
const CLUSTER_LIMIT = 50

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
  node scripts/import/audit-full-catalog-ingestion-plan-v03.mjs [--plan-v03 <jsonl>] [--plan-v02 <jsonl>] [--out-dir <dir>]

This is a read-only audit for full catalog ingestion plan v0.3:
  - Reads full-catalog-ingestion-plan-v03.jsonl.
  - Optionally reads full-catalog-ingestion-plan-v02.jsonl for action delta comparison.
  - Confirms noisy numeric / too-short parent candidates have been rejected.
  - Writes JSON / summary JSON / Markdown reports.

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

function isPureNumeric(value) {
  return /^\d+$/u.test(normalizeWhitespace(value))
}

function isTooShortParent(value) {
  const normalized = normalizeTitle(value)
  return normalized.length > 0 && normalized.length < 2
}

function compactPlan(row) {
  return {
    sourceRecordKey: row.sourceRecordKey || '',
    sourceName: row.sourceName || '',
    sourceId: row.sourceId || '',
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
    volumeLike: Boolean(row.volumeLike),
    editionLike: Boolean(row.editionLike),
    rawPath: row.rawPath || '',
  }
}

function pushSample(collection, row, limit = SAMPLE_LIMIT) {
  if (collection.length < limit) collection.push(compactPlan(row))
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

function countPlans(plans) {
  const byAction = {}
  const byReason = {}
  const bySource = {}
  const bySourceAction = {}
  const byMediaType = {}
  const byConfidence = {}
  const byEntityBoundary = {}
  const byBoundaryReason = {}
  const rejectedByReason = {}

  for (const plan of plans) {
    inc(byAction, plan.action)
    inc(byReason, plan.reason)
    inc(bySource, plan.sourceName)
    inc(bySourceAction, `${plan.sourceName}:${plan.action}`)
    inc(byMediaType, plan.sourceMediaType)
    inc(byConfidence, plan.confidence)
    inc(byEntityBoundary, plan.entityBoundary)
    inc(byBoundaryReason, plan.boundaryReason)
    if (plan.parentTitleInferenceRejected) inc(rejectedByReason, plan.parentTitleInferenceRejectedReason)
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

function analyze(plans) {
  const samples = {
    rejectedParentCandidates: [],
    noisyParentCandidatesRemaining: [],
    linkToParentWorkCandidate: [],
    createChildEntityNeedsPolicy: [],
    createNewWorkNeedsReview: [],
    possibleDuplicateTitle: [],
    quarantine: [],
  }

  const parentClusters = new Map()
  let numericParentCandidatesRemaining = 0
  let tooShortParentCandidatesRemaining = 0
  let rejectedParentCandidates = 0

  for (const plan of plans) {
    const parent = normalizeWhitespace(plan.parentCandidateTitle)

    if (parent) {
      if (!parentClusters.has(parent)) parentClusters.set(parent, [])
      parentClusters.get(parent).push(plan)

      if (isPureNumeric(parent)) {
        numericParentCandidatesRemaining += 1
        pushSample(samples.noisyParentCandidatesRemaining, plan)
      } else if (isTooShortParent(parent)) {
        tooShortParentCandidatesRemaining += 1
        pushSample(samples.noisyParentCandidatesRemaining, plan)
      }
    }

    if (plan.parentTitleInferenceRejected) {
      rejectedParentCandidates += 1
      pushSample(samples.rejectedParentCandidates, plan)
    }

    if (plan.action === 'link_to_parent_work_candidate') pushSample(samples.linkToParentWorkCandidate, plan)
    if (plan.action === 'create_child_entity_needs_policy') pushSample(samples.createChildEntityNeedsPolicy, plan)
    if (plan.action === 'create_new_work_needs_review') pushSample(samples.createNewWorkNeedsReview, plan)
    if (plan.action === 'possible_duplicate_title') pushSample(samples.possibleDuplicateTitle, plan)
    if (plan.action === 'quarantine') pushSample(samples.quarantine, plan)
  }

  const parentCandidateClusters = [...parentClusters.entries()]
    .filter(([, rows]) => rows.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, CLUSTER_LIMIT)
    .map(([parentCandidateTitle, rows]) => ({
      parentCandidateTitle,
      normalizedParentCandidateTitle: normalizeTitle(parentCandidateTitle),
      count: rows.length,
      actions: sortCountObject(rows.reduce((acc, row) => {
        inc(acc, row.action)
        return acc
      }, {})),
      rows: rows.slice(0, 12).map(compactPlan),
    }))

  const riskCounts = {
    rejectedParentCandidates,
    numericParentCandidatesRemaining,
    tooShortParentCandidatesRemaining,
    noisyParentCandidatesRemaining: numericParentCandidatesRemaining + tooShortParentCandidatesRemaining,
    createChildEntityNeedsPolicy: plans.filter((row) => row.action === 'create_child_entity_needs_policy').length,
    volumeOrEditionNeedsPolicy: plans.filter((row) => row.action === 'create_volume_or_edition_needs_policy').length,
    linkToParentWorkCandidate: plans.filter((row) => row.action === 'link_to_parent_work_candidate').length,
    possibleDuplicateTitle: plans.filter((row) => row.action === 'possible_duplicate_title').length,
    quarantine: plans.filter((row) => row.action === 'quarantine').length,
    lowConfidence: plans.filter((row) => row.confidence === 'low').length,
    parentCandidateClusters: parentCandidateClusters.length,
  }

  const blockers = []
  const warnings = []

  if (riskCounts.noisyParentCandidatesRemaining > 0) {
    blockers.push(`noisy parent candidates remain: ${riskCounts.noisyParentCandidatesRemaining}`)
  }

  if (riskCounts.rejectedParentCandidates === 0) {
    warnings.push('no rejected parent candidates were found; verify v03 was generated from tightened output')
  }

  if (riskCounts.possibleDuplicateTitle > 0) {
    warnings.push(`possible duplicate title rows remain: ${riskCounts.possibleDuplicateTitle}`)
  }

  if (riskCounts.quarantine > 0) {
    warnings.push(`quarantine rows remain: ${riskCounts.quarantine}`)
  }

  return {
    readyForV03UseAsCurrentDryRunPlan: blockers.length === 0,
    blockers,
    warnings,
    riskCounts,
    samples,
    parentCandidateClusters,
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
    '## v02 → v03 action delta',
    '',
    '| Action | v02 | v03 | Delta |',
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
    JSON.stringify(rows, null, 2),
    '```',
    '',
  ]
}

function formatMarkdown(report) {
  const lines = [
    '# Full Catalog Ingestion Plan v0.3 Audit',
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
    `- planV03RowsRead: ${report.summary.planV03RowsRead}`,
    `- planV03RowsFailed: ${report.summary.planV03RowsFailed}`,
    `- auditedRows: ${report.summary.auditedRows}`,
    `- planV02Checked: ${report.summary.planV02Checked}`,
    `- readyForV03UseAsCurrentDryRunPlan: ${report.analysis.readyForV03UseAsCurrentDryRunPlan}`,
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
    ...formatCountTable('By entity boundary', report.summary.byEntityBoundary),
    ...formatCountTable('By boundary reason', report.summary.byBoundaryReason),
    ...formatCountTable('Rejected parent candidates by reason', report.summary.rejectedByReason),
    ...formatDeltaTable(report.comparison.actionDelta),
    '## Risk counts',
    '',
    '| Risk | Count |',
    '|---|---:|',
    ...Object.entries(report.analysis.riskCounts).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
    ...formatSamples('Rejected parent candidate samples', report.analysis.samples.rejectedParentCandidates),
    ...formatSamples('Noisy parent candidates remaining samples', report.analysis.samples.noisyParentCandidatesRemaining),
    ...formatSamples('Link to parent work candidate samples', report.analysis.samples.linkToParentWorkCandidate),
    ...formatSamples('Parent candidate clusters', report.analysis.parentCandidateClusters),
    '## Next step',
    '',
    '- If this audit has no blockers, use v03 as the current full-catalog ingestion dry-run plan.',
    '- Keep write paths behind single-row validation and small-batch dry-run gates.',
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

  const planV03Path = args['plan-v03'] || DEFAULT_PLAN_V03
  const planV02Path = args['plan-v02'] || DEFAULT_PLAN_V02
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planV03Path)) {
    throw new Error(`v03 plan file not found: ${planV03Path}\nRun plan-full-catalog-ingestion-v03 first.`)
  }

  const planV03 = []
  console.error(`[audit-v03] reading v03 plan: ${planV03Path}`)
  const readV03 = await readJsonl(planV03Path, async (row) => {
    planV03.push(row)
  })

  let planV02 = []
  let readV02 = { rows: 0, failed: 0 }
  let planV02Checked = false
  let v02Counts = {}

  if (fs.existsSync(planV02Path) && !args['no-v02']) {
    console.error(`[audit-v03] reading v02 plan for comparison: ${planV02Path}`)
    readV02 = await readJsonl(planV02Path, async (row) => {
      planV02.push(row)
    })
    planV02Checked = true
    v02Counts = countPlans(planV02)
  }

  const v03Counts = countPlans(planV03)
  const analysis = analyze(planV03)
  const comparison = {
    v02Available: planV02Checked,
    actionDelta: computeActionDelta(v02Counts.byAction, v03Counts.byAction),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v0.3-audit',
    planV03RowsRead: readV03.rows,
    planV03RowsFailed: readV03.failed,
    auditedRows: planV03.length,
    planV02Checked,
    planV02RowsRead: readV02.rows,
    planV02RowsFailed: readV02.failed,
    ...v03Counts,
    riskCounts: analysis.riskCounts,
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
    comparison,
    analysis,
    outputs: {},
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJson = path.join(outDir, 'full-catalog-ingestion-plan-v03-audit.json')
  const outSummary = path.join(outDir, 'full-catalog-ingestion-plan-v03-audit-summary.json')
  const outMd = path.join(outDir, 'full-catalog-ingestion-plan-v03-audit.md')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({ summary, comparison, analysis: { ...analysis, samples: undefined, parentCandidateClusters: undefined } }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = { json: outJson, summary: outSummary, md: outMd }

  console.log(JSON.stringify({
    ok: true,
    summary,
    comparison,
    readyForV03UseAsCurrentDryRunPlan: analysis.readyForV03UseAsCurrentDryRunPlan,
    blockers: analysis.blockers,
    warnings: analysis.warnings,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
