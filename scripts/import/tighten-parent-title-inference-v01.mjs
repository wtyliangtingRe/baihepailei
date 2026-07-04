#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN_V02 = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v02.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/full-catalog-ingestion'
const SAMPLE_LIMIT = 80

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
  node scripts/import/tighten-parent-title-inference-v01.mjs [--plan-v02 <jsonl>] [--out-dir <dir>]

This is a read-only parent-title inference tightening preview:
  - Reads full-catalog-ingestion-plan-v02.jsonl.
  - Rejects noisy parent candidates such as pure numeric parent titles.
  - Writes tightened JSONL / JSON / summary JSON / Markdown reports.
  - Does not modify the source v02 plan file.

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

function isPureNumeric(value) {
  return /^\d+$/u.test(normalizeWhitespace(value))
}

function isTooShortParent(value) {
  const normalized = normalizeTitle(value)
  return normalized.length > 0 && normalized.length < 2
}

function isNoisyParentCandidate(value) {
  const text = normalizeWhitespace(value)
  if (!text) return false
  if (isPureNumeric(text)) return true
  if (isTooShortParent(text)) return true
  return false
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
    volumeLike: Boolean(row.volumeLike),
    editionLike: Boolean(row.editionLike),
    rawPath: row.rawPath || '',
  }
}

function maybeRetargetAfterRejectedParent(row) {
  const before = row.action
  const rejectedParentCandidateTitle = row.parentCandidateTitle || ''
  const next = {
    ...row,
    rejectedParentCandidateTitle,
    parentCandidateTitle: '',
    parentCandidateNormalizedTitle: '',
    parentCandidateSourceRecords: [],
    parentTitleInferenceRejected: true,
    parentTitleInferenceRejectedReason: isPureNumeric(rejectedParentCandidateTitle)
      ? 'numeric_parent_candidate'
      : 'too_short_parent_candidate',
  }

  if (row.volumeLike) {
    return {
      row: {
        ...next,
        boundaryReason: 'volume_like_title_without_useful_parent',
        reason: row.action === 'link_to_parent_work_candidate'
          ? 'rejected_noisy_parent_candidate_from_parent_link'
          : 'volume_like_row_no_useful_parent_candidate',
        action: row.action === 'link_to_parent_work_candidate'
          ? 'create_child_entity_needs_policy'
          : row.action,
        confidence: 'low',
        matchedWorks: row.action === 'link_to_parent_work_candidate' ? [] : row.matchedWorks,
      },
      changedAction: before !== (row.action === 'link_to_parent_work_candidate' ? 'create_child_entity_needs_policy' : row.action),
    }
  }

  if (row.entityBoundary === 'child_candidate' && row.boundaryReason === 'parent_title_inferred') {
    const action = row.eligibilityStatus === 'maybe_catalog'
      ? 'create_new_work_needs_review'
      : 'create_new_work_needs_review'

    return {
      row: {
        ...next,
        entityBoundary: 'work_candidate',
        boundaryReason: 'parent_title_inference_rejected',
        action,
        reason: 'parent_title_inference_rejected_noisy_parent',
        confidence: 'low',
        matchedWorks: [],
      },
      changedAction: before !== action,
    }
  }

  return {
    row: {
      ...next,
      boundaryReason: 'parent_title_inference_rejected',
      reason: 'parent_title_inference_rejected_noisy_parent',
      confidence: 'low',
    },
    changedAction: false,
  }
}

function tightenRow(row) {
  if (!isNoisyParentCandidate(row.parentCandidateTitle)) {
    return { row, changed: false, changedAction: false }
  }

  const result = maybeRetargetAfterRejectedParent(row)
  return { row: result.row, changed: true, changedAction: result.changedAction }
}

function buildCounts(rows) {
  const byAction = {}
  const byReason = {}
  const byEntityBoundary = {}
  const byBoundaryReason = {}
  const rejectedByReason = {}

  for (const row of rows) {
    inc(byAction, row.action)
    inc(byReason, row.reason)
    inc(byEntityBoundary, row.entityBoundary)
    inc(byBoundaryReason, row.boundaryReason)
    if (row.parentTitleInferenceRejected) inc(rejectedByReason, row.parentTitleInferenceRejectedReason)
  }

  return {
    byAction: sortCountObject(byAction),
    byReason: sortCountObject(byReason),
    byEntityBoundary: sortCountObject(byEntityBoundary),
    byBoundaryReason: sortCountObject(byBoundaryReason),
    rejectedByReason: sortCountObject(rejectedByReason),
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
  const lines = [
    '# Parent Title Inference Tightening Preview v0.1',
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
    `- inputRowsRead: ${report.summary.inputRowsRead}`,
    `- inputRowsFailed: ${report.summary.inputRowsFailed}`,
    `- outputRows: ${report.summary.outputRows}`,
    `- rejectedParentCandidates: ${report.summary.rejectedParentCandidates}`,
    `- actionChangedRows: ${report.summary.actionChangedRows}`,
    '',
    ...formatCountTable('By action after tightening', report.summary.after.byAction),
    ...formatCountTable('By rejected reason', report.summary.after.rejectedByReason),
    ...formatCountTable('By boundary reason after tightening', report.summary.after.byBoundaryReason),
    '## Rejected parent candidate samples',
    '',
    '```json',
    JSON.stringify(report.samples.rejectedParentCandidates, null, 2),
    '```',
    '',
    '## Next step',
    '',
    '- Run the v02 audit against the tightened JSONL output to confirm suspicious numeric parent candidates drop to zero.',
    '- If the distribution is healthy, fold this useful-parent-title check into `plan-full-catalog-ingestion-v02.mjs` or the next planner version.',
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

  const planPath = args['plan-v02'] || DEFAULT_PLAN_V02
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planPath)) {
    throw new Error(`v02 plan file not found: ${planPath}\nRun plan-full-catalog-ingestion-v02 first.`)
  }

  const inputRows = []
  console.error(`[tighten-parent] reading v02 plan: ${planPath}`)
  const readResult = await readJsonl(planPath, async (row) => {
    inputRows.push(row)
  })

  const outputRows = []
  const rejectedSamples = []
  let rejectedParentCandidates = 0
  let actionChangedRows = 0

  for (const row of inputRows) {
    const result = tightenRow(row)
    outputRows.push(result.row)

    if (result.changed) {
      rejectedParentCandidates += 1
      if (rejectedSamples.length < SAMPLE_LIMIT) rejectedSamples.push(compactPlan(result.row))
    }

    if (result.changedAction) actionChangedRows += 1
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    input: planPath,
    inputRowsRead: readResult.rows,
    inputRowsFailed: readResult.failed,
    outputRows: outputRows.length,
    rejectedParentCandidates,
    actionChangedRows,
    before: buildCounts(inputRows),
    after: buildCounts(outputRows),
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
    samples: {
      rejectedParentCandidates: rejectedSamples,
    },
    outputs: {},
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJsonl = path.join(outDir, 'full-catalog-ingestion-plan-v02-tightened-v01.jsonl')
  const outJson = path.join(outDir, 'full-catalog-ingestion-plan-v02-tightened-v01.json')
  const outSummary = path.join(outDir, 'full-catalog-ingestion-plan-v02-tightened-v01-summary.json')
  const outMd = path.join(outDir, 'full-catalog-ingestion-plan-v02-tightened-v01.md')

  fs.writeFileSync(outJsonl, outputRows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  fs.writeFileSync(outJson, JSON.stringify({ ...report, rows: outputRows }, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = {
    jsonl: outJsonl,
    json: outJson,
    summary: outSummary,
    md: outMd,
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
