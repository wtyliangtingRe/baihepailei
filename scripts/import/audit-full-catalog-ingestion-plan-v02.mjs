#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN_V02 = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v02.jsonl'
const DEFAULT_PLAN_V01 = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v01.jsonl'
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
  node scripts/import/audit-full-catalog-ingestion-plan-v02.mjs [--plan-v02 <jsonl>] [--plan-v01 <jsonl>] [--out-dir <dir>]

This is a read-only audit for the full catalog ingestion v0.2 dry-run plan:
  - Reads full-catalog-ingestion-plan-v02.jsonl.
  - Optionally reads full-catalog-ingestion-plan-v01.jsonl for action-delta comparison.
  - Audits entity boundaries, boundary reasons, parent candidates, child/edition routing, and known duplicate/quarantine risks.
  - Writes JSON / summary JSON / Markdown reports under data_local/staging/full-catalog-ingestion by default.

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

function compactPlan(plan) {
  return {
    sourceRecordKey: plan.sourceRecordKey || '',
    sourceName: plan.sourceName || '',
    sourceId: plan.sourceId || '',
    sourceTitle: plan.sourceTitle || '',
    sourceMediaType: plan.sourceMediaType || '',
    eligibilityStatus: plan.eligibilityStatus || '',
    action: plan.action || '',
    reason: plan.reason || '',
    confidence: plan.confidence || '',
    entityBoundary: plan.entityBoundary || '',
    boundaryReason: plan.boundaryReason || '',
    parentCandidateTitle: plan.parentCandidateTitle || '',
    volumeLike: Boolean(plan.volumeLike),
    editionLike: Boolean(plan.editionLike),
    rawPath: plan.rawPath || '',
    matchedWorks: Array.isArray(plan.matchedWorks) ? plan.matchedWorks.slice(0, 5) : [],
    parentCandidateSourceRecords: Array.isArray(plan.parentCandidateSourceRecords)
      ? plan.parentCandidateSourceRecords.slice(0, 5)
      : [],
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
  const byParentCandidate = {}
  const byRawPath = {}

  for (const plan of plans) {
    inc(byAction, plan.action)
    inc(byReason, plan.reason)
    inc(bySource, plan.sourceName)
    inc(bySourceAction, `${plan.sourceName}:${plan.action}`)
    inc(byMediaType, plan.sourceMediaType)
    inc(byConfidence, plan.confidence)
    inc(byEntityBoundary, plan.entityBoundary)
    inc(byBoundaryReason, plan.boundaryReason)
    inc(byRawPath, plan.rawPath)
    if (plan.parentCandidateTitle) inc(byParentCandidate, plan.parentCandidateTitle)
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
    topParentCandidates: Object.fromEntries(Object.entries(sortCountObject(byParentCandidate)).slice(0, 80)),
    topRawPaths: Object.fromEntries(Object.entries(sortCountObject(byRawPath)).slice(0, 50)),
  }
}

function computeActionDelta(v01Counts, v02Counts) {
  const keys = new Set([...Object.keys(v01Counts || {}), ...Object.keys(v02Counts || {})])
  return Object.fromEntries([...keys].sort().map((key) => {
    const before = Number(v01Counts?.[key] || 0)
    const after = Number(v02Counts?.[key] || 0)
    return [key, { before, after, delta: after - before }]
  }))
}

function analyze(plans) {
  const samples = {
    createChildEntityNeedsPolicy: [],
    linkToParentWorkCandidate: [],
    createVolumeOrEditionNeedsPolicy: [],
    possibleParentDuplicateTitle: [],
    possibleDuplicateTitle: [],
    quarantine: [],
    topLevelCreateNewWork: [],
    lowConfidence: [],
    suspiciousNumericParentCandidates: [],
  }

  const parentClusters = new Map()
  const childByParent = new Map()

  for (const plan of plans) {
    if (plan.action === 'create_child_entity_needs_policy') pushSample(samples.createChildEntityNeedsPolicy, plan)
    if (plan.action === 'link_to_parent_work_candidate') pushSample(samples.linkToParentWorkCandidate, plan)
    if (plan.action === 'create_volume_or_edition_needs_policy') pushSample(samples.createVolumeOrEditionNeedsPolicy, plan)
    if (plan.action === 'possible_parent_duplicate_title') pushSample(samples.possibleParentDuplicateTitle, plan)
    if (plan.action === 'possible_duplicate_title') pushSample(samples.possibleDuplicateTitle, plan)
    if (plan.action === 'quarantine') pushSample(samples.quarantine, plan)
    if (plan.action === 'create_new_work') pushSample(samples.topLevelCreateNewWork, plan)
    if (plan.confidence === 'low') pushSample(samples.lowConfidence, plan)

    if (plan.parentCandidateTitle) {
      const parent = normalizeWhitespace(plan.parentCandidateTitle)
      if (!parentClusters.has(parent)) parentClusters.set(parent, [])
      parentClusters.get(parent).push(plan)

      if (/^\d+$/u.test(parent)) pushSample(samples.suspiciousNumericParentCandidates, plan)
    }

    if (plan.action === 'create_child_entity_needs_policy' && plan.parentCandidateTitle) {
      const parent = normalizeWhitespace(plan.parentCandidateTitle)
      if (!childByParent.has(parent)) childByParent.set(parent, [])
      childByParent.get(parent).push(plan)
    }
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

  const childClusters = [...childByParent.entries()]
    .filter(([, rows]) => rows.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, CLUSTER_LIMIT)
    .map(([parentCandidateTitle, rows]) => ({
      parentCandidateTitle,
      normalizedParentCandidateTitle: normalizeTitle(parentCandidateTitle),
      count: rows.length,
      rows: rows.slice(0, 12).map(compactPlan),
    }))

  const riskCounts = {
    possibleDuplicateTitle: plans.filter((row) => row.action === 'possible_duplicate_title').length,
    possibleParentDuplicateTitle: plans.filter((row) => row.action === 'possible_parent_duplicate_title').length,
    quarantine: plans.filter((row) => row.action === 'quarantine').length,
    lowConfidence: plans.filter((row) => row.confidence === 'low').length,
    childEntityNeedsPolicy: plans.filter((row) => row.action === 'create_child_entity_needs_policy').length,
    volumeOrEditionNeedsPolicy: plans.filter((row) => row.action === 'create_volume_or_edition_needs_policy').length,
    linkToParentWorkCandidate: plans.filter((row) => row.action === 'link_to_parent_work_candidate').length,
    suspiciousNumericParentCandidates: plans.filter((row) => /^\d+$/u.test(normalizeWhitespace(row.parentCandidateTitle))).length,
    parentCandidateClusters: parentCandidateClusters.length,
    childEntityParentClusters: childClusters.length,
  }

  const recommendations = []

  if (riskCounts.childEntityNeedsPolicy > 0) {
    recommendations.push({
      priority: 'high',
      topic: 'child_entity_policy',
      count: riskCounts.childEntityNeedsPolicy,
      message: 'Review child entity candidates and define schema fields before any apply path for volumes or editions.',
    })
  }

  if (riskCounts.suspiciousNumericParentCandidates > 0) {
    recommendations.push({
      priority: 'high',
      topic: 'parent_title_inference_noise',
      count: riskCounts.suspiciousNumericParentCandidates,
      message: 'Numeric parent candidates suggest title parsing noise. Tighten parent-title inference before using parent links automatically.',
    })
  }

  if (riskCounts.linkToParentWorkCandidate > 0) {
    recommendations.push({
      priority: 'medium',
      topic: 'parent_link_candidates',
      count: riskCounts.linkToParentWorkCandidate,
      message: 'Review parent link candidates manually; exact parent-title matches are useful but still not enough for automatic writes.',
    })
  }

  if (riskCounts.possibleDuplicateTitle > 0 || riskCounts.possibleParentDuplicateTitle > 0) {
    recommendations.push({
      priority: 'high',
      topic: 'duplicate_titles',
      count: riskCounts.possibleDuplicateTitle + riskCounts.possibleParentDuplicateTitle,
      message: 'Resolve duplicate title rows before write paths, especially known duplicate titles such as 雨眠 and 少女.',
    })
  }

  if (riskCounts.quarantine > 0) {
    recommendations.push({
      priority: 'medium',
      topic: 'quarantine',
      count: riskCounts.quarantine,
      message: 'Inspect quarantine rows and classify them as parse bugs, evidence-only rows, or true junk.',
    })
  }

  return {
    riskCounts,
    recommendations,
    samples,
    parentCandidateClusters,
    childEntityParentClusters: childClusters,
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
    '## v01 → v02 action delta',
    '',
    '| Action | v01 | v02 | Delta |',
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
    '# Full Catalog Ingestion Plan v0.2 Audit',
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
    `- planV02RowsRead: ${report.summary.planV02RowsRead}`,
    `- planV02RowsFailed: ${report.summary.planV02RowsFailed}`,
    `- auditedRows: ${report.summary.auditedRows}`,
    `- planV01Checked: ${report.summary.planV01Checked}`,
    ...(report.summary.planV01Checked ? [`- planV01RowsRead: ${report.summary.planV01RowsRead}`] : []),
    '',
    ...formatCountTable('By action', report.summary.byAction),
    ...formatCountTable('By entity boundary', report.summary.byEntityBoundary),
    ...formatCountTable('By boundary reason', report.summary.byBoundaryReason),
    ...formatCountTable('By source and action', report.summary.bySourceAction),
    ...formatDeltaTable(report.comparison.actionDelta),
    '## Risk counts',
    '',
    '| Risk | Count |',
    '|---|---:|',
    ...Object.entries(report.analysis.riskCounts).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
    '## Recommendations',
    '',
    ...(report.analysis.recommendations.length
      ? report.analysis.recommendations.map((item) => `- **${item.priority} / ${item.topic}** (${item.count}): ${item.message}`)
      : ['- none']),
    '',
    ...formatSamples('Create child entity samples', report.analysis.samples.createChildEntityNeedsPolicy),
    ...formatSamples('Link to parent work candidate samples', report.analysis.samples.linkToParentWorkCandidate),
    ...formatSamples('Volume or edition needs policy samples', report.analysis.samples.createVolumeOrEditionNeedsPolicy),
    ...formatSamples('Suspicious numeric parent candidate samples', report.analysis.samples.suspiciousNumericParentCandidates),
    ...formatSamples('Possible duplicate title samples', report.analysis.samples.possibleDuplicateTitle),
    ...formatSamples('Quarantine samples', report.analysis.samples.quarantine),
    ...formatSamples('Top parent candidate clusters', report.analysis.parentCandidateClusters),
    ...formatSamples('Child entity parent clusters', report.analysis.childEntityParentClusters),
    '## Next step',
    '',
    '- Tighten parent-title inference before creating automatic parent links.',
    '- Define the Volume / Edition schema or keep child rows as source-record-only until schema work is ready.',
    '- Keep future apply scripts behind single-row validation and small-batch dry-run gates.',
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

  const planV02Path = args['plan-v02'] || DEFAULT_PLAN_V02
  const planV01Path = args['plan-v01'] || DEFAULT_PLAN_V01
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planV02Path)) {
    throw new Error(`v02 plan file not found: ${planV02Path}\nRun plan-full-catalog-ingestion-v02 first.`)
  }

  const planV02 = []
  console.error(`[audit-v02] reading v02 plan: ${planV02Path}`)
  const readV02 = await readJsonl(planV02Path, async (plan) => {
    planV02.push(plan)
  })

  const counts = countPlans(planV02)
  const analysis = analyze(planV02)

  let planV01 = []
  let readV01 = { rows: 0, failed: 0 }
  let planV01Checked = false
  let planV01Counts = {}

  if (fs.existsSync(planV01Path) && !args['no-v01']) {
    console.error(`[audit-v02] reading v01 plan for comparison: ${planV01Path}`)
    readV01 = await readJsonl(planV01Path, async (plan) => {
      planV01.push(plan)
    })
    planV01Checked = true
    planV01Counts = countPlans(planV01)
  }

  const comparison = {
    actionDelta: computeActionDelta(planV01Counts.byAction, counts.byAction),
    v01Available: planV01Checked,
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'v0.2-audit',
    planV02RowsRead: readV02.rows,
    planV02RowsFailed: readV02.failed,
    auditedRows: planV02.length,
    planV01Checked,
    planV01RowsRead: readV01.rows,
    planV01RowsFailed: readV01.failed,
    ...counts,
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

  const outJson = path.join(outDir, 'full-catalog-ingestion-plan-v02-audit.json')
  const outSummary = path.join(outDir, 'full-catalog-ingestion-plan-v02-audit-summary.json')
  const outMd = path.join(outDir, 'full-catalog-ingestion-plan-v02-audit.md')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({ summary, comparison }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = { json: outJson, summary: outSummary, md: outMd }

  console.log(JSON.stringify({
    ok: true,
    summary,
    comparison,
    recommendations: analysis.recommendations,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
