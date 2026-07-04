#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/full-catalog-ingestion'
const SAMPLE_LIMIT = 80
const CLUSTER_SAMPLE_LIMIT = 40

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
  node scripts/import/audit-full-catalog-ingestion-plan-v01.mjs [--plan <jsonl>] [--out-dir <dir>]

This is a read-only audit for the full catalog ingestion dry-run plan:
  - Reads full-catalog-ingestion-plan-v01.jsonl.
  - Audits action/source/media distributions and high-risk rows.
  - Surfaces volume-like create_new_work rows, duplicate-title clusters, possible duplicates, quarantine rows, low-confidence rows, and exact-title link samples.
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

function normalizeSeriesTitle(value) {
  return normalizeTitle(value)
    .replace(/\b(?:vol(?:ume)?|第?卷|巻|册|冊|episode|ep|part)\s*\d+\b/giu, '')
    .replace(/\b\d{1,3}\b/gu, '')
    .replace(/[上下前後后篇編编]+$/u, '')
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
    rawPath: plan.rawPath || '',
    matchedWorks: Array.isArray(plan.matchedWorks) ? plan.matchedWorks.slice(0, 5) : [],
  }
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

function looksVolumeLike(title) {
  const text = normalizeWhitespace(title)
  return /(?:\bvol(?:ume)?\.?\s*\d+\b|\b\d{1,3}\b|第\s*\d+\s*[卷巻册冊話话]|\d+\s*[卷巻册冊]|上巻|下巻|前篇|後篇|后篇|番外|外伝|外传)/iu.test(text)
}

function pushSample(collection, row, limit = SAMPLE_LIMIT) {
  if (collection.length < limit) collection.push(compactPlan(row))
}

function buildCountSummary(plans, readResult) {
  const byAction = {}
  const bySource = {}
  const bySourceAction = {}
  const byMediaType = {}
  const byConfidence = {}
  const byReason = {}
  const byRawPath = {}

  for (const plan of plans) {
    inc(byAction, plan.action)
    inc(bySource, plan.sourceName)
    inc(bySourceAction, `${plan.sourceName}:${plan.action}`)
    inc(byMediaType, plan.sourceMediaType)
    inc(byConfidence, plan.confidence)
    inc(byReason, plan.reason)
    inc(byRawPath, plan.rawPath)
  }

  return {
    generatedAt: new Date().toISOString(),
    planRowsRead: readResult.rows,
    planRowsFailed: readResult.failed,
    auditedRows: plans.length,
    byAction: sortCountObject(byAction),
    bySource: sortCountObject(bySource),
    bySourceAction: sortCountObject(bySourceAction),
    byMediaType: sortCountObject(byMediaType),
    byConfidence: sortCountObject(byConfidence),
    byReason: sortCountObject(byReason),
    topRawPaths: Object.fromEntries(Object.entries(sortCountObject(byRawPath)).slice(0, 40)),
    safety: {
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerApply: false,
      delete: false,
    },
  }
}

function analyze(plans) {
  const samples = {
    possibleDuplicateTitle: [],
    quarantine: [],
    createNewWorkNeedsReview: [],
    lowConfidence: [],
    exactTitleLinks: [],
    volumeLikeCreateNewWork: [],
    anilistCreateNewWork: [],
    bangumiCreateNewWork: [],
    evidenceOnly: [],
  }

  const createNewByNormalizedTitle = new Map()
  const createNewBySeriesTitle = new Map()

  for (const plan of plans) {
    if (plan.action === 'possible_duplicate_title') pushSample(samples.possibleDuplicateTitle, plan)
    if (plan.action === 'quarantine') pushSample(samples.quarantine, plan)
    if (plan.action === 'create_new_work_needs_review') pushSample(samples.createNewWorkNeedsReview, plan)
    if (plan.confidence === 'low') pushSample(samples.lowConfidence, plan)
    if (plan.action === 'link_existing_work_exact_title') pushSample(samples.exactTitleLinks, plan)
    if (plan.action === 'evidence_only') pushSample(samples.evidenceOnly, plan)

    if (plan.action === 'create_new_work') {
      if (plan.sourceName === 'anilist') pushSample(samples.anilistCreateNewWork, plan)
      if (plan.sourceName === 'bangumi') pushSample(samples.bangumiCreateNewWork, plan)

      const normalizedTitle = normalizeTitle(plan.sourceTitle)
      if (normalizedTitle) {
        if (!createNewByNormalizedTitle.has(normalizedTitle)) createNewByNormalizedTitle.set(normalizedTitle, [])
        createNewByNormalizedTitle.get(normalizedTitle).push(plan)
      }

      const seriesTitle = normalizeSeriesTitle(plan.sourceTitle)
      if (seriesTitle && seriesTitle.length >= 2) {
        if (!createNewBySeriesTitle.has(seriesTitle)) createNewBySeriesTitle.set(seriesTitle, [])
        createNewBySeriesTitle.get(seriesTitle).push(plan)
      }

      if (looksVolumeLike(plan.sourceTitle)) pushSample(samples.volumeLikeCreateNewWork, plan)
    }
  }

  const duplicateTitleClusters = [...createNewByNormalizedTitle.entries()]
    .filter(([, rows]) => rows.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, CLUSTER_SAMPLE_LIMIT)
    .map(([normalizedTitle, rows]) => ({
      normalizedTitle,
      count: rows.length,
      rows: rows.slice(0, 12).map(compactPlan),
    }))

  const seriesLikeClusters = [...createNewBySeriesTitle.entries()]
    .filter(([, rows]) => rows.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, CLUSTER_SAMPLE_LIMIT)
    .map(([seriesTitle, rows]) => ({
      seriesTitle,
      count: rows.length,
      rows: rows.slice(0, 12).map(compactPlan),
    }))

  const riskCounts = {
    possibleDuplicateTitle: plans.filter((row) => row.action === 'possible_duplicate_title').length,
    quarantine: plans.filter((row) => row.action === 'quarantine').length,
    createNewWorkNeedsReview: plans.filter((row) => row.action === 'create_new_work_needs_review').length,
    lowConfidence: plans.filter((row) => row.confidence === 'low').length,
    volumeLikeCreateNewWork: plans.filter((row) => row.action === 'create_new_work' && looksVolumeLike(row.sourceTitle)).length,
    duplicateCreateNewTitleClusters: duplicateTitleClusters.length,
    seriesLikeCreateNewClusters: seriesLikeClusters.length,
  }

  const recommendations = []

  if (riskCounts.volumeLikeCreateNewWork > 0) {
    recommendations.push({
      priority: 'high',
      topic: 'volume_like_create_new_work',
      message: 'Review whether volume / chapter / edition-like rows should become independent Works or be modeled as editions / volumes / source records under a parent work.',
      count: riskCounts.volumeLikeCreateNewWork,
    })
  }

  if (riskCounts.seriesLikeCreateNewClusters > 0) {
    recommendations.push({
      priority: 'high',
      topic: 'series_like_clusters',
      message: 'Create a parent-work / edition policy before applying large create_new_work batches.',
      count: riskCounts.seriesLikeCreateNewClusters,
    })
  }

  if (riskCounts.possibleDuplicateTitle > 0) {
    recommendations.push({
      priority: 'high',
      topic: 'possible_duplicate_title',
      message: 'Manually review title rows that match multiple existing Works before any write path.',
      count: riskCounts.possibleDuplicateTitle,
    })
  }

  if (riskCounts.quarantine > 0) {
    recommendations.push({
      priority: 'medium',
      topic: 'quarantine',
      message: 'Inspect missing-title quarantine rows and decide whether they are parse bugs, evidence-only rows, or true junk.',
      count: riskCounts.quarantine,
    })
  }

  if (riskCounts.createNewWorkNeedsReview > 0) {
    recommendations.push({
      priority: 'medium',
      topic: 'maybe_catalog',
      message: 'Review maybe-catalog rows before creating public Works, especially unknown media types.',
      count: riskCounts.createNewWorkNeedsReview,
    })
  }

  return {
    riskCounts,
    samples,
    duplicateTitleClusters,
    seriesLikeClusters,
    recommendations,
  }
}

function formatCountTable(title, entries) {
  return [
    `## ${title}`,
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(entries).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
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
    '# Full Catalog Ingestion Plan Audit v0.1',
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
    '',
    ...formatCountTable('By action', report.summary.byAction),
    ...formatCountTable('By source and action', report.summary.bySourceAction),
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
    ...formatSamples('Possible duplicate title samples', report.analysis.samples.possibleDuplicateTitle),
    ...formatSamples('Quarantine samples', report.analysis.samples.quarantine),
    ...formatSamples('Create new work needs review samples', report.analysis.samples.createNewWorkNeedsReview),
    ...formatSamples('Volume-like create_new_work samples', report.analysis.samples.volumeLikeCreateNewWork),
    ...formatSamples('Series-like create_new_work clusters', report.analysis.seriesLikeClusters),
    ...formatSamples('Duplicate exact create_new_work title clusters', report.analysis.duplicateTitleClusters),
    ...formatSamples('Exact-title link samples', report.analysis.samples.exactTitleLinks),
    '## Next step',
    '',
    '- Decide whether volume-like source records should be standalone Works, editions, volumes, or child source records.',
    '- Review possible duplicate and quarantine samples before any write path exists.',
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

  const planPath = args.plan || DEFAULT_PLAN
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}\nRun plan-full-catalog-ingestion-v01 first.`)
  }

  const plans = []
  console.error(`[audit] reading plan: ${planPath}`)
  const readResult = await readJsonl(planPath, async (plan) => {
    plans.push(plan)
  })

  const summary = buildCountSummary(plans, readResult)
  const analysis = analyze(plans)
  const report = {
    ok: true,
    summary,
    analysis,
    outputs: {},
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJson = path.join(outDir, 'full-catalog-ingestion-plan-audit-v01.json')
  const outSummary = path.join(outDir, 'full-catalog-ingestion-plan-audit-v01-summary.json')
  const outMd = path.join(outDir, 'full-catalog-ingestion-plan-audit-v01.md')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({ ...summary, riskCounts: analysis.riskCounts }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = {
    json: outJson,
    summary: outSummary,
    md: outMd,
  }

  console.log(JSON.stringify({
    ok: report.ok,
    summary,
    riskCounts: analysis.riskCounts,
    recommendations: analysis.recommendations,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
