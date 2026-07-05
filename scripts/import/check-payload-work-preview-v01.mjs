#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PREVIEW = 'data_local/staging/import/payload-work-preview-v01.rows.jsonl'
const DEFAULT_PREVIEW_SUMMARY = 'data_local/staging/import/payload-work-preview-v01-summary.json'
const DEFAULT_OUT_DIR = 'data_local/staging/import'
const EXPECTED_PREVIEW_VERSION = 'payload-work-preview-v0.1'
const PAGE_LIMIT = 200
const SAMPLE_LIMIT = 50
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')

function val(value) {
  return String(value ?? '').trim()
}

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

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
    read += 1
  }

  return { rows, read, failed }
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }

  if (!response.ok) {
    const detail = payload ? JSON.stringify(payload, null, 2) : text
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${detail}`)
  }

  return payload
}

async function login(baseUrl, email, secret) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password: secret }),
  })

  if (!result?.token) throw new Error('Payload login succeeded but did not return a token.')
  return result.token
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0

  do {
    const params = new URLSearchParams()
    params.set('limit', String(PAGE_LIMIT))
    params.set('page', String(page))
    params.set('depth', '0')
    params.set('draft', 'true')

    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, {
      headers: authHeaders(token),
    })

    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    totalDocs = Number(result?.totalDocs || docs.length)
    page += 1
  } while (page <= totalPages)

  return { docs, totalDocs }
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function indexBy(docs, getKey) {
  const out = new Map()
  for (const doc of docs) {
    const key = val(getKey(doc))
    if (!key) continue
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(doc)
  }
  return out
}

function matchSamples(previewRow, matches, matchField) {
  return matches.slice(0, 10).map((doc) => ({
    matchField,
    id: val(doc.id),
    title: val(doc.title),
    slug: val(doc.slug),
    siteId: val(doc.siteId),
    status: val(doc.status),
    reviewStatus: val(doc.reviewStatus),
    previewTitle: val(previewRow.payload?.title),
    previewSlug: val(previewRow.payload?.slug),
    previewSiteId: val(previewRow.payload?.siteId),
  }))
}

function buildConflicts(previewRows, existingWorks) {
  const bySlug = indexBy(existingWorks, (doc) => doc.slug)
  const bySiteId = indexBy(existingWorks, (doc) => doc.siteId)
  const conflicts = []

  for (const row of previewRows) {
    const slug = val(row.payload?.slug)
    const siteId = val(row.payload?.siteId)
    const slugMatches = bySlug.get(slug) || []
    const siteIdMatches = bySiteId.get(siteId) || []

    if (!slugMatches.length && !siteIdMatches.length) continue

    conflicts.push({
      previewId: row.previewId,
      sourcePlanId: row.sourcePlanId,
      title: val(row.payload?.title),
      slug,
      siteId,
      conflictTypes: [
        slugMatches.length ? 'slug_exists' : '',
        siteIdMatches.length ? 'site_id_exists' : '',
      ].filter(Boolean),
      slugMatchCount: slugMatches.length,
      siteIdMatchCount: siteIdMatches.length,
      samples: [
        ...matchSamples(row, slugMatches, 'slug'),
        ...matchSamples(row, siteIdMatches, 'siteId'),
      ],
    })
  }

  return conflicts
}

function previewRowIssues(row) {
  const issues = []
  const payload = row.payload || {}
  const safety = row.safety || {}

  if (row.version !== EXPECTED_PREVIEW_VERSION) issues.push('unexpected_preview_version')
  if (row.collection !== 'works') issues.push('unexpected_collection')
  if (row.operation !== 'create_draft_preview') issues.push('unexpected_operation')
  if (!val(row.previewId)) issues.push('missing_preview_id')
  if (!val(payload.slug)) issues.push('missing_slug')
  if (!val(payload.siteId)) issues.push('missing_site_id')
  if (!val(payload.title)) issues.push('missing_title')
  if (payload.status !== 'draft') issues.push('status_not_draft')
  if (payload.reviewStatus !== 'pending') issues.push('review_status_not_pending')
  if (safety.dryRunOnly !== true) issues.push('not_dry_run_only')
  if (safety.localReportOnly !== true) issues.push('not_local_report_only')
  if (safety.payloadWrite !== false) issues.push('payload_write_not_false')
  if (safety.postgresqlWrite !== false) issues.push('postgresql_write_not_false')
  if (safety.importerAction !== false) issues.push('importer_action_not_false')
  if (safety.applyAllowed !== false) issues.push('apply_allowed_not_false')

  return issues
}

function auditPreviewRows(previewRows) {
  const issueRows = []
  const byIssue = {}
  for (const row of previewRows) {
    const issues = previewRowIssues(row)
    if (!issues.length) continue
    issueRows.push({
      previewId: val(row.previewId),
      title: val(row.payload?.title),
      slug: val(row.payload?.slug),
      siteId: val(row.payload?.siteId),
      issues,
    })
    for (const issue of issues) byIssue[issue] = (byIssue[issue] || 0) + 1
  }
  return { issueRows, byIssue }
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function table(title, rows, keyLabel = 'Key') {
  return [
    `## ${title}`,
    '',
    `| ${keyLabel} | Count |`,
    '|---|---:|',
    ...Object.entries(rows || {}).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]
}

function markdown(summary, samples) {
  return [
    '# Payload Work Preview Check v0.1',
    '',
    'Read-only check comparing local preview rows with current Payload works by slug and siteId.',
    '',
    '## Safety',
    '',
    '- Payload read only.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No create action.',
    '- No apply action.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- readyForCreateDryRun: ${summary.readyForCreateDryRun}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- previewRowsRead: ${summary.previewRowsRead}`,
    `- previewRowsFailed: ${summary.previewRowsFailed}`,
    `- existingWorksRead: ${summary.existingWorksRead}`,
    `- conflictRows: ${summary.conflictRows}`,
    `- previewIssueRows: ${summary.previewIssueRows}`,
    `- payloadRead: ${summary.safety.payloadRead}`,
    `- payloadWrite: ${summary.safety.payloadWrite}`,
    `- postgresqlWrite: ${summary.safety.postgresqlWrite}`,
    `- createAction: ${summary.safety.createAction}`,
    `- applyAllowed: ${summary.safety.applyAllowed}`,
    '',
    ...table('Conflicts by type', summary.byConflictType, 'Conflict'),
    ...table('Preview rows by source', summary.bySource, 'Source'),
    ...table('Preview rows by media type', summary.byMediaType, 'Media Type'),
    ...table('Preview row issues', summary.byPreviewIssue, 'Issue'),
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const previewPath = String(args.preview || DEFAULT_PREVIEW)
  const previewSummaryPath = String(args['preview-summary'] || DEFAULT_PREVIEW_SUMMARY)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)

  if (!fs.existsSync(previewPath)) throw new Error(`Preview rows file not found: ${previewPath}`)

  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const secret = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]
  if (!email || !secret) {
    throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV} before running this read-only Payload check.`)
  }

  const preview = await readJsonl(previewPath)
  const previewSummary = readJsonIfExists(previewSummaryPath)
  const previewAudit = auditPreviewRows(preview.rows)

  const token = await login(baseUrl, email, secret)
  const existing = await fetchAllWorks(baseUrl, token)
  const conflicts = buildConflicts(preview.rows, existing.docs)

  const byConflictType = {}
  for (const conflict of conflicts) {
    for (const type of conflict.conflictTypes) byConflictType[type] = (byConflictType[type] || 0) + 1
  }

  const blockers = []
  if (preview.failed) blockers.push(`preview_rows_failed_to_parse:${preview.failed}`)
  if (!previewSummary) blockers.push('missing_preview_summary')
  if (previewSummary && previewSummary.readyForPayloadDryRun !== true) blockers.push('preview_summary_not_ready')
  if (previewAudit.issueRows.length) blockers.push(`preview_issue_rows:${previewAudit.issueRows.length}`)
  if (conflicts.length) blockers.push(`payload_conflict_rows:${conflicts.length}`)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'payload-work-preview-check-v0.1',
    readyForCreateDryRun: blockers.length === 0 && preview.rows.length > 0,
    payloadBaseUrl: baseUrl,
    previewRowsRead: preview.read,
    previewRowsFailed: preview.failed,
    previewRowsLoaded: preview.rows.length,
    existingWorksRead: existing.docs.length,
    existingWorksTotalDocs: existing.totalDocs,
    conflictRows: conflicts.length,
    previewIssueRows: previewAudit.issueRows.length,
    byConflictType: Object.fromEntries(Object.entries(byConflictType).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    bySource: countBy(preview.rows, (row) => row.payload?.candidateSources?.[0]?.source),
    byMediaType: countBy(preview.rows, (row) => row.payload?.mediaType),
    byPreviewIssue: Object.fromEntries(Object.entries(previewAudit.byIssue).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    inputs: {
      preview: previewPath,
      previewSummary: previewSummaryPath,
    },
    outputs: {
      conflicts: path.join(outDir, 'payload-work-preview-check-v01-conflicts.jsonl'),
      json: path.join(outDir, 'payload-work-preview-check-v01.json'),
      summary: path.join(outDir, 'payload-work-preview-check-v01-summary.json'),
      md: path.join(outDir, 'payload-work-preview-check-v01.md'),
    },
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      postgresqlWrite: false,
      createAction: false,
      importerAction: false,
      applyAllowed: false,
    },
  }

  const samples = {
    conflicts: conflicts.slice(0, SAMPLE_LIMIT),
    previewIssueRows: previewAudit.issueRows.slice(0, SAMPLE_LIMIT),
  }

  const report = {
    ok: blockers.length === 0,
    summary,
    blockers,
    samples,
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(summary.outputs.conflicts, conflicts.map((row) => JSON.stringify(row)).join('\n') + (conflicts.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(summary.outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: report.ok, summary, blockers, outputs: summary.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
