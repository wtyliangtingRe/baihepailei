#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-safe-strict-v01-review.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-strict-review-rerank-v0.1'
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
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    read += 1
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
  }
  return { rows, read, failed }
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

async function login(baseUrl, email, password) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
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

function indexBy(docs, field) {
  const out = new Map()
  for (const doc of docs) {
    const key = val(doc[field])
    if (key) out.set(key, doc)
  }
  return out
}

function normalizeUrl(value) {
  return val(value).replace(/\/$/u, '')
}

function sourceOf(doc) {
  const first = Array.isArray(doc?.candidateSources) ? doc.candidateSources[0] : null
  return val(first?.source || first?.label || doc?.originalSource || doc?.source || 'unknown').toLowerCase() || 'unknown'
}

function getExternalIds(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function plannedExternalIds(row) {
  const ids = row?.preservedDataPreview?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function sourceLinks(row) {
  return Array.isArray(row?.preservedDataPreview?.sourceLinks) ? row.preservedDataPreview.sourceLinks : []
}

function candidateSources(row) {
  return Array.isArray(row?.preservedDataPreview?.candidateSources) ? row.preservedDataPreview.candidateSources : []
}

function hasSourceLink(row, sourceName) {
  const needle = sourceName.toLowerCase()
  return sourceLinks(row).some((item) => `${val(item?.label)} ${normalizeUrl(item?.url)}`.toLowerCase().includes(needle))
}

function hasCandidateSource(row, sourceName) {
  const needle = sourceName.toLowerCase()
  return candidateSources(row).some((item) => `${val(item?.source)} ${val(item?.label)} ${normalizeUrl(item?.url)}`.toLowerCase().includes(needle))
}

function titleKey(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/gu, 'and')
    .replace(/[^\u{L}\u{N}]+/gu, '')
}

function titlesOf(row) {
  return [...new Set([
    row?.master?.title,
    ...(Array.isArray(row?.master?.titles) ? row.master.titles : []),
    ...((row?.supplements || []).flatMap((doc) => [doc.title, ...(Array.isArray(doc.titles) ? doc.titles : [])])),
    ...(Array.isArray(row?.preservedDataPreview?.titles) ? row.preservedDataPreview.titles : []),
  ].map(val).filter(Boolean))]
}

function titleKeyCount(row) {
  return new Set(titlesOf(row).map(titleKey).filter(Boolean)).size
}

function externalIdConflicts(masterDoc, ids) {
  const current = getExternalIds(masterDoc)
  const out = []
  for (const [key, value] of Object.entries(ids)) {
    if (current[key] && current[key] !== value) out.push(`${key}:${current[key]}!=${value}`)
  }
  return out
}

function classify(row, docsById) {
  const blockers = []
  const deferReasons = []
  const autoReasons = []
  const supplementRows = Array.isArray(row?.supplements) ? row.supplements : []
  const supplementRow = supplementRows[0] || null
  const masterDoc = docsById.get(val(row?.master?.id))
  const supplementDoc = docsById.get(val(supplementRow?.id))
  const plannedIds = plannedExternalIds(row)

  if (row.reviewBucket !== 'safe') blockers.push('not_from_safe_preview')
  if (Number(row.groupSize || 0) !== 2) blockers.push('not_one_to_one')
  if (supplementRows.length !== 1) blockers.push('supplement_count_not_one')
  if ((row.warnings || []).length) blockers.push('preview_has_warnings')
  if (!masterDoc) blockers.push('master_not_found')
  if (!supplementDoc) blockers.push('supplement_not_found')
  if (masterDoc && sourceOf(masterDoc) !== 'bangumi') blockers.push('master_source_not_bangumi')
  if (supplementDoc && sourceOf(supplementDoc) !== 'anilist') blockers.push('supplement_source_not_anilist')

  const conflicts = externalIdConflicts(masterDoc, plannedIds)
  if (conflicts.length) blockers.push('master_external_id_conflict')

  const reviewReasons = new Set(row.strictReviewReasons || [])
  const onlyTitleRisk = reviewReasons.size === 1 && reviewReasons.has('generic_or_short_title')
  if (!onlyTitleRisk) deferReasons.push('review_reason_not_title_only')

  const hasAnilistExternalId = Boolean(plannedIds.anilistMediaId || plannedIds.anilistId || plannedIds.anilist)
  const hasBangumiExternalId = Boolean(plannedIds.bangumiSubjectId || plannedIds.bangumiId || plannedIds.bangumi)
  const hasAnilistSource = hasCandidateSource(row, 'anilist') || hasSourceLink(row, 'anilist')
  const hasBangumiSource = hasCandidateSource(row, 'bangumi') || hasSourceLink(row, 'bangumi')

  if (hasAnilistExternalId) autoReasons.push('has_anilist_external_id')
  else deferReasons.push('missing_anilist_external_id')
  if (hasAnilistSource) autoReasons.push('has_anilist_source_trace')
  else deferReasons.push('missing_anilist_source_trace')
  if (hasBangumiExternalId || hasBangumiSource) autoReasons.push('has_bangumi_trace')
  else deferReasons.push('missing_bangumi_trace')
  if (titleKeyCount(row) <= 2) autoReasons.push('compact_title_key_set')
  else deferReasons.push('many_title_key_variants')

  const bucket = blockers.length
    ? 'blocked'
    : deferReasons.length
      ? 'defer'
      : 'auto_ready'

  return {
    ...row,
    stage2Bucket: bucket,
    stage2AutoReasons: [...new Set(autoReasons)],
    stage2DeferReasons: [...new Set(deferReasons)],
    stage2Blockers: [...new Set(blockers)],
    stage2Evidence: {
      titleKeys: [...new Set(titlesOf(row).map(titleKey).filter(Boolean))],
      plannedExternalIds: plannedIds,
      candidateSources: candidateSources(row),
      sourceLinks: sourceLinks(row),
      currentMaster: masterDoc ? {
        id: val(masterDoc.id),
        title: val(masterDoc.title),
        slug: val(masterDoc.slug),
        siteId: val(masterDoc.siteId),
        source: sourceOf(masterDoc),
        isLiteVisible: masterDoc.isLiteVisible ?? null,
        isFullVisible: masterDoc.isFullVisible ?? null,
        externalIds: getExternalIds(masterDoc),
      } : null,
      currentSupplement: supplementDoc ? {
        id: val(supplementDoc.id),
        title: val(supplementDoc.title),
        slug: val(supplementDoc.slug),
        siteId: val(supplementDoc.siteId),
        source: sourceOf(supplementDoc),
        isLiteVisible: supplementDoc.isLiteVisible ?? null,
        isFullVisible: supplementDoc.isFullVisible ?? null,
        externalIds: getExternalIds(supplementDoc),
      } : null,
      externalIdConflicts: conflicts,
    },
    intendedNextStep: bucket === 'auto_ready'
      ? 'build_stage2_field_plan_dry_run'
      : bucket === 'defer'
        ? 'park_without_blocking_stage2'
        : 'do_not_apply',
    safety: {
      localReportReadOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }
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
    '# Strict Review Work Merge Rerank v0.1',
    '',
    'Read-only automatic rerank for the 19 strict-review work merge groups. Groups are classified into auto_ready, defer, or blocked. Defer groups are parked and do not block the automatic path.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- worksRead: ${summary.worksRead}`,
    `- autoReadyGroups: ${summary.autoReadyGroups}`,
    `- deferGroups: ${summary.deferGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    '',
    '## Safety',
    '',
    '- Payload read only.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No data change.',
    '',
    '## Buckets',
    '',
    '| Bucket | Count |',
    '|---|---:|',
    ...Object.entries(summary.byBucket).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Auto reasons',
    '',
    '| Reason | Count |',
    '|---|---:|',
    ...Object.entries(summary.byAutoReason).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Defer reasons',
    '',
    '| Reason | Count |',
    '|---|---:|',
    ...Object.entries(summary.byDeferReason).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Blockers',
    '',
    '| Blocker | Count |',
    '|---|---:|',
    ...Object.entries(summary.byBlocker).map(([key, count]) => `| ${key} | ${count} |`),
    '',
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
  const inputPath = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(inputPath)) throw new Error(`strict-review input file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = input.rows.map((row) => classify(row, docsById))
  const autoReady = rows.filter((row) => row.stage2Bucket === 'auto_ready')
  const defer = rows.filter((row) => row.stage2Bucket === 'defer')
  const blocked = rows.filter((row) => row.stage2Bucket === 'blocked')
  const autoReasons = rows.flatMap((row) => row.stage2AutoReasons || [])
  const deferReasons = rows.flatMap((row) => row.stage2DeferReasons || [])
  const blockers = rows.flatMap((row) => row.stage2Blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-strict-review-rerank-v01.rows.jsonl'),
    autoReady: path.join(outDir, 'work-merge-strict-review-rerank-v01-auto-ready.groups.jsonl'),
    defer: path.join(outDir, 'work-merge-strict-review-rerank-v01-defer.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-strict-review-rerank-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-strict-review-rerank-v01-summary.json'),
    json: path.join(outDir, 'work-merge-strict-review-rerank-v01.json'),
    md: path.join(outDir, 'work-merge-strict-review-rerank-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0,
    payloadBaseUrl: baseUrl,
    inputFile: inputPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    autoReadyGroups: autoReady.length,
    deferGroups: defer.length,
    blockedGroups: blocked.length,
    byBucket: countBy(rows, 'stage2Bucket'),
    byAutoReason: countBy(autoReasons, (value) => value),
    byDeferReason: countBy(deferReasons, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      localReportReadOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }

  const samples = { autoReady: autoReady.slice(0, 30), defer: defer.slice(0, 30), blocked: blocked.slice(0, 30) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.autoReady, autoReady.map((item) => JSON.stringify(item)).join('\n') + (autoReady.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.defer, defer.map((item) => JSON.stringify(item)).join('\n') + (defer.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((item) => JSON.stringify(item)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
