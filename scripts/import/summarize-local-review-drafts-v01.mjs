#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DRAFTS = 'data_local/staging/review/local-review-drafts-v01.json'
const OUT_DIR = 'data_local/staging/review'

function val(value) {
  return String(value ?? '').trim()
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = val(row[key]) || 'missing'
    out[value] = (out[value] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function rowId(row) {
  return val(row.combinedQueueId || row.candidateId || row.groupId || row.sourceRecordKey || row.title)
}

function compact(row) {
  return {
    combinedQueueId: val(row.combinedQueueId),
    queueSource: val(row.queueSource),
    priority: val(row.priority),
    issueType: val(row.issueType),
    title: val(row.title),
    sourceName: val(row.sourceName),
    sourceId: val(row.sourceId),
    sourceRecordKey: val(row.sourceRecordKey),
    candidateId: val(row.candidateId),
    groupId: val(row.groupId),
    reviewDecision: val(row.reviewDecision),
    note: val(row.note),
    updatedAt: val(row.updatedAt),
  }
}

function decisionRows(rows, decision) {
  return rows.filter((row) => val(row.reviewDecision) === decision)
}

function markdown(summary, sections) {
  const lines = [
    '# Local Review Drafts Summary v0.1',
    '',
    'This is a read-only summary of exported local review drafts.',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- No production change.',
    '- Draft decisions are review notes only and do not apply merges.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- inputRows: ${summary.inputRows}`,
    `- uniqueRows: ${summary.uniqueRows}`,
    `- duplicateRowIds: ${summary.duplicateRowIds}`,
    `- applyAllowedRows: ${summary.safety.applyAllowedRows}`,
    '',
    '## By decision',
    '',
    '| Decision | Count |',
    '|---|---:|',
    ...Object.entries(summary.byReviewDecision).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
    '## By issue type',
    '',
    '| Issue Type | Count |',
    '|---|---:|',
    ...Object.entries(summary.byIssueType).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
    '## By priority',
    '',
    '| Priority | Count |',
    '|---|---:|',
    ...Object.entries(summary.byPriority).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]

  for (const section of sections) {
    lines.push(`## ${section.title}`, '')
    if (!section.rows.length) {
      lines.push('- none', '')
      continue
    }
    lines.push('| Priority | Issue Type | Title | Decision | Note | ID |')
    lines.push('|---|---|---|---|---|---|')
    for (const row of section.rows.slice(0, 120)) {
      lines.push(`| ${mdCell(row.priority)} | ${mdCell(row.issueType)} | ${mdCell(row.title)} | ${mdCell(row.reviewDecision)} | ${mdCell(row.note)} | ${mdCell(row.combinedQueueId)} |`)
    }
    if (section.rows.length > 120) lines.push(`| ... | ... | ... | ... | ${section.rows.length - 120} more rows omitted | ... |`)
    lines.push('')
  }

  return lines.join('\n')
}

function main() {
  const draftsPath = arg('drafts', DRAFTS)
  const outDir = arg('out-dir', OUT_DIR)

  if (!fs.existsSync(draftsPath)) throw new Error(`Input file not found: ${draftsPath}`)

  const payload = readJson(draftsPath)
  const rawRows = Array.isArray(payload.rows) ? payload.rows : []
  const rows = rawRows.map(compact)

  const seen = new Set()
  const duplicateIds = new Set()
  const uniqueRows = []
  for (const row of rows) {
    const id = rowId(row)
    if (!id) continue
    if (seen.has(id)) {
      duplicateIds.add(id)
      continue
    }
    seen.add(id)
    uniqueRows.push(row)
  }

  const sections = [
    { key: 'same_identity_candidate', title: 'same_identity_candidate', rows: decisionRows(uniqueRows, 'same_identity_candidate') },
    { key: 'not_same_identity', title: 'not_same_identity', rows: decisionRows(uniqueRows, 'not_same_identity') },
    { key: 'keep_separate', title: 'keep_separate', rows: decisionRows(uniqueRows, 'keep_separate') },
    { key: 'defer', title: 'defer', rows: decisionRows(uniqueRows, 'defer') },
    { key: 'missing_decision', title: 'missing decision', rows: uniqueRows.filter((row) => !val(row.reviewDecision)) },
  ]

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'local-review-drafts-summary-v0.1',
    input: draftsPath,
    inputVersion: val(payload.version),
    inputGeneratedAt: val(payload.generatedAt),
    inputRows: rawRows.length,
    uniqueRows: uniqueRows.length,
    duplicateRowIds: duplicateIds.size,
    byReviewDecision: countBy(uniqueRows, 'reviewDecision'),
    byIssueType: countBy(uniqueRows, 'issueType'),
    byPriority: countBy(uniqueRows, 'priority'),
    byQueueSource: countBy(uniqueRows, 'queueSource'),
    decisionCounts: Object.fromEntries(sections.map((section) => [section.key, section.rows.length])),
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowedRows: rawRows.filter((row) => row?.safety?.applyAllowed === true || row?.applyAllowed === true).length,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJson = path.join(outDir, 'local-review-drafts-v01-summary.json')
  const outMd = path.join(outDir, 'local-review-drafts-v01.md')

  fs.writeFileSync(outJson, JSON.stringify({ ok: true, summary, rows: uniqueRows, sections }, null, 2), 'utf8')
  fs.writeFileSync(outMd, markdown(summary, sections), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: {
      summary: outJson,
      md: outMd,
    },
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
