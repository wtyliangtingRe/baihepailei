#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PREVIEW = 'data_local/staging/import/payload-work-preview-v01.rows.jsonl'
const DEFAULT_PREVIEW_SUMMARY = 'data_local/staging/import/payload-work-preview-v01-summary.json'
const DEFAULT_CHECK_SUMMARY = 'data_local/staging/import/payload-work-preview-check-v01-summary.json'
const DEFAULT_OUT_DIR = 'data_local/staging/import'
const EXPECTED_PREVIEW_VERSION = 'payload-work-preview-v0.1'
const EXPECTED_CHECK_VERSION = 'payload-work-preview-check-v0.1'
const PAGE_LIMIT = 200
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

function rowIssues(row) {
  const issues = []
  const payload = row.payload || {}
  const safety = row.safety || {}

  if (row.version !== EXPECTED_PREVIEW_VERSION) issues.push('unexpected_preview_version')
  if (row.collection !== 'works') issues.push('unexpected_collection')
  if (row.operation !== 'create_draft_preview') issues.push('unexpected_operation')
  if (!val(row.previewId)) issues.push('missing_preview_id')
  if (!val(payload.title)) issues.push('missing_title')
  if (!val(payload.slug)) issues.push('missing_slug')
  if (!val(payload.siteId)) issues.push('missing_site_id')
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

function selectRows(rows, offset, limit) {
  const start = Math.max(0, Number(offset || 0))
  const count = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : null
  if (count === null) return rows.slice(start)
  return rows.slice(start, start + count)
}

function conflictFor(row, bySlug, bySiteId) {
  const slug = val(row.payload?.slug)
  const siteId = val(row.payload?.siteId)
  const slugMatches = bySlug.get(slug) || []
  const siteIdMatches = bySiteId.get(siteId) || []
  if (!slugMatches.length && !siteIdMatches.length) return null
  return {
    previewId: row.previewId,
    title: val(row.payload?.title),
    slug,
    siteId,
    conflictTypes: [slugMatches.length ? 'slug_exists' : '', siteIdMatches.length ? 'site_id_exists' : ''].filter(Boolean),
    slugMatchCount: slugMatches.length,
    siteIdMatchCount: siteIdMatches.length,
    samples: [...slugMatches, ...siteIdMatches].slice(0, 10).map((doc) => ({
      id: val(doc.id),
      title: val(doc.title),
      slug: val(doc.slug),
      siteId: val(doc.siteId),
      status: val(doc.status),
    })),
  }
}

async function createWork(baseUrl, token, payload) {
  return requestJson(`${baseUrl}/api/works`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  })
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

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function markdown(summary, samples) {
  return [
    '# Payload Work Draft Import v0.1',
    '',
    'Creates Payload draft works only when `--apply` is provided. Without `--apply`, this is a dry-run report.',
    '',
    '## Safety',
    '',
    `- Mode: ${summary.mode}`,
    `- Payload read: ${summary.safety.payloadRead}`,
    `- Payload write: ${summary.safety.payloadWrite}`,
    `- Direct PostgreSQL write: ${summary.safety.directPostgresqlWrite}`,
    `- Payload-backed database write: ${summary.safety.payloadBackedDatabaseWrite}`,
    `- Create action: ${summary.safety.createAction}`,
    `- Apply allowed: ${summary.safety.applyAllowed}`,
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- previewRowsRead: ${summary.previewRowsRead}`,
    `- selectedRows: ${summary.selectedRows}`,
    `- wouldCreate: ${summary.wouldCreate}`,
    `- created: ${summary.created}`,
    `- skippedExisting: ${summary.skippedExisting}`,
    `- conflictRows: ${summary.conflictRows}`,
    `- previewIssueRows: ${summary.previewIssueRows}`,
    `- failedRows: ${summary.failedRows}`,
    '',
    ...table('Selected rows by source', summary.bySource, 'Source'),
    ...table('Selected rows by media type', summary.byMediaType, 'Media Type'),
    ...table('Result rows by status', summary.byResultStatus, 'Status'),
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
  const apply = Boolean(args.apply)
  const skipExisting = Boolean(args['skip-existing'])
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const previewPath = String(args.preview || DEFAULT_PREVIEW)
  const previewSummaryPath = String(args['preview-summary'] || DEFAULT_PREVIEW_SUMMARY)
  const checkSummaryPath = String(args['check-summary'] || DEFAULT_CHECK_SUMMARY)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const offset = Number(args.offset || 0)
  const limit = args.limit === undefined ? null : Number(args.limit)

  if (!fs.existsSync(previewPath)) throw new Error(`Preview rows file not found: ${previewPath}`)

  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const secret = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]
  if (!email || !secret) {
    throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV} before running this importer.`)
  }

  const preview = await readJsonl(previewPath)
  const previewSummary = readJsonIfExists(previewSummaryPath)
  const checkSummary = readJsonIfExists(checkSummaryPath)

  const allRows = preview.rows
  const selectedRows = selectRows(allRows, offset, limit)
  const previewIssueRows = []
  for (const row of selectedRows) {
    const issues = rowIssues(row)
    if (issues.length) {
      previewIssueRows.push({ previewId: val(row.previewId), title: val(row.payload?.title), slug: val(row.payload?.slug), siteId: val(row.payload?.siteId), issues })
    }
  }

  const token = await login(baseUrl, email, secret)
  const existing = await fetchAllWorks(baseUrl, token)
  const bySlug = indexBy(existing.docs, (doc) => doc.slug)
  const bySiteId = indexBy(existing.docs, (doc) => doc.siteId)
  const conflicts = []
  const candidates = []

  for (const row of selectedRows) {
    const conflict = conflictFor(row, bySlug, bySiteId)
    if (conflict) {
      conflicts.push(conflict)
      if (!skipExisting) continue
      continue
    }
    candidates.push(row)
  }

  const blockers = []
  if (preview.failed) blockers.push(`preview_rows_failed_to_parse:${preview.failed}`)
  if (!previewSummary || previewSummary.readyForPayloadDryRun !== true) blockers.push('preview_summary_not_ready')
  if (!checkSummary || checkSummary.version !== EXPECTED_CHECK_VERSION || checkSummary.readyForCreateDryRun !== true) blockers.push('preview_check_not_ready')
  if (previewIssueRows.length) blockers.push(`preview_issue_rows:${previewIssueRows.length}`)
  if (conflicts.length && !skipExisting) blockers.push(`payload_conflict_rows:${conflicts.length}`)

  const results = []
  let created = 0
  let failedRows = 0

  const canCreate = apply && blockers.length === 0
  if (canCreate) {
    for (let i = 0; i < candidates.length; i += 1) {
      const row = candidates[i]
      try {
        const createdDoc = await createWork(baseUrl, token, row.payload)
        created += 1
        results.push({
          status: 'created',
          previewId: row.previewId,
          title: val(row.payload?.title),
          slug: val(row.payload?.slug),
          siteId: val(row.payload?.siteId),
          id: val(createdDoc?.doc?.id || createdDoc?.id),
        })
        bySlug.set(val(row.payload?.slug), [createdDoc?.doc || createdDoc])
        bySiteId.set(val(row.payload?.siteId), [createdDoc?.doc || createdDoc])
        if (created % 50 === 0) console.log(`created ${created}/${candidates.length}`)
      } catch (error) {
        failedRows += 1
        results.push({
          status: 'failed',
          previewId: row.previewId,
          title: val(row.payload?.title),
          slug: val(row.payload?.slug),
          siteId: val(row.payload?.siteId),
          error: String(error?.message || error),
        })
      }
    }
  } else {
    for (const row of candidates) {
      results.push({
        status: 'would_create',
        previewId: row.previewId,
        title: val(row.payload?.title),
        slug: val(row.payload?.slug),
        siteId: val(row.payload?.siteId),
      })
    }
    for (const conflict of conflicts) {
      results.push({ status: skipExisting ? 'skipped_existing' : 'blocked_conflict', ...conflict })
    }
    for (const issue of previewIssueRows) {
      results.push({ status: 'blocked_preview_issue', ...issue })
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'payload-work-draft-import-v0.1',
    ok: blockers.length === 0 && failedRows === 0,
    mode: apply ? 'apply' : 'dry-run',
    payloadBaseUrl: baseUrl,
    offset,
    limit,
    previewRowsRead: preview.read,
    previewRowsFailed: preview.failed,
    previewRowsLoaded: allRows.length,
    selectedRows: selectedRows.length,
    existingWorksReadBefore: existing.docs.length,
    existingWorksTotalDocsBefore: existing.totalDocs,
    wouldCreate: apply ? 0 : candidates.length,
    created,
    skippedExisting: skipExisting ? conflicts.length : 0,
    conflictRows: conflicts.length,
    previewIssueRows: previewIssueRows.length,
    failedRows,
    blockers,
    bySource: countBy(selectedRows, (row) => row.payload?.candidateSources?.[0]?.source),
    byMediaType: countBy(selectedRows, (row) => row.payload?.mediaType),
    byResultStatus: countBy(results, (row) => row.status),
    inputs: {
      preview: previewPath,
      previewSummary: previewSummaryPath,
      checkSummary: checkSummaryPath,
    },
    outputs: {
      rows: path.join(outDir, 'payload-work-draft-import-v01.rows.jsonl'),
      json: path.join(outDir, 'payload-work-draft-import-v01.json'),
      summary: path.join(outDir, 'payload-work-draft-import-v01-summary.json'),
      md: path.join(outDir, 'payload-work-draft-import-v01.md'),
    },
    safety: {
      readOnly: !apply,
      payloadRead: true,
      payloadWrite: apply,
      directPostgresqlWrite: false,
      payloadBackedDatabaseWrite: apply,
      createAction: apply,
      importerAction: apply,
      applyAllowed: apply,
    },
  }

  const samples = {
    results: results.slice(0, 40),
    conflicts: conflicts.slice(0, 40),
    previewIssueRows: previewIssueRows.slice(0, 40),
  }

  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(summary.outputs.rows, results.map((row) => JSON.stringify(row)).join('\n') + (results.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(summary.outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: report.ok, summary, outputs: summary.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
