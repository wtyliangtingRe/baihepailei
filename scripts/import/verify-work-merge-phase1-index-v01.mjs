#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_GROUPS = 'data_local/staging/work-merge/work-merge-public-visibility-verify-v01-verified.groups.jsonl'
const DEFAULT_SEARCH_INDEX = 'public/search-index.json'
const DEFAULT_DETAIL_INDEX = 'public/detail-index.json'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-phase1-index-verify-v0.1'
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

function readJsonFile(file) {
  if (!fs.existsSync(file)) return { exists: false, payload: null }
  return { exists: true, payload: JSON.parse(fs.readFileSync(file, 'utf8')) }
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

function workItems(indexPayload) {
  return (Array.isArray(indexPayload?.items) ? indexPayload.items : [])
    .filter((item) => item?.collection === 'works')
}

function idsOf(items) {
  return new Set(items.map((item) => val(item.id)).filter(Boolean))
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function verifyIndexKind(kind, fileInfo, rows, docsById) {
  const blockers = []
  const warnings = []
  if (!fileInfo.exists) {
    blockers.push(`${kind}_index_missing`)
    return { kind, blockers, warnings, rows: [], counts: {}, mode: 'missing', total: 0 }
  }

  const payload = fileInfo.payload
  const items = workItems(payload)
  const itemIds = idsOf(items)
  const mode = val(payload?.mode || 'unknown')
  const perGroup = []

  for (const row of rows) {
    const master = docsById.get(val(row.master?.id))
    const supplement = docsById.get(val(row.supplement?.id))
    const masterIndexId = master?.slug ? `works:${master.slug}` : ''
    const supplementIndexId = supplement?.slug ? `works:${supplement.slug}` : ''
    const masterPresent = masterIndexId ? itemIds.has(masterIndexId) : false
    const supplementPresent = supplementIndexId ? itemIds.has(supplementIndexId) : false
    const rowBlockers = []
    const rowWarnings = []

    if (!master) rowBlockers.push('master_not_found_in_payload')
    if (!supplement) rowBlockers.push('supplement_not_found_in_payload')
    if (supplementPresent) rowBlockers.push(`${kind}_index_contains_hidden_supplement`)
    if (mode === 'drafts-and-published' && master && !masterPresent) rowBlockers.push(`${kind}_index_missing_lite_master`)
    if (mode === 'published-only' && master && !masterPresent) rowWarnings.push(`${kind}_published_index_missing_draft_master`)

    perGroup.push({
      mergeGroupId: val(row.mergeGroupId),
      kind,
      mode,
      status: rowBlockers.length ? 'blocked' : 'verified',
      blockers: rowBlockers,
      warnings: rowWarnings,
      master: {
        id: val(master?.id || row.master?.id),
        slug: val(master?.slug),
        title: val(master?.title || row.master?.title),
        indexId: masterIndexId,
        presentInIndex: masterPresent,
        isLiteVisible: master?.isLiteVisible ?? null,
      },
      supplement: {
        id: val(supplement?.id || row.supplement?.id),
        slug: val(supplement?.slug),
        title: val(supplement?.title || row.supplement?.title),
        indexId: supplementIndexId,
        presentInIndex: supplementPresent,
        isLiteVisible: supplement?.isLiteVisible ?? null,
      },
    })
  }

  blockers.push(...perGroup.flatMap((row) => row.blockers || []))
  warnings.push(...perGroup.flatMap((row) => row.warnings || []))
  return {
    kind,
    mode,
    total: Number(payload?.total || 0),
    counts: payload?.counts || {},
    workItems: items.length,
    blockers,
    warnings,
    rows: perGroup,
  }
}

function markdown(summary, samples) {
  return [
    '# Work Merge Phase 1 Index Verification v0.1',
    '',
    'Read-only verification for strict-safe phase 1 after Payload visibility changes and index export.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- worksRead: ${summary.worksRead}`,
    `- searchIndexMode: ${summary.searchIndex.mode}`,
    `- detailIndexMode: ${summary.detailIndex.mode}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    '',
    '## Index totals',
    '',
    '| Index | Mode | Total | Works |',
    '|---|---|---:|---:|',
    `| search | ${summary.searchIndex.mode} | ${summary.searchIndex.total} | ${summary.searchIndex.workItems} |`,
    `| detail | ${summary.detailIndex.mode} | ${summary.detailIndex.total} | ${summary.detailIndex.workItems} |`,
    '',
    '## Status',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...Object.entries(summary.byStatus).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Warnings',
    '',
    '| Warning | Count |',
    '|---|---:|',
    ...Object.entries(summary.byWarning).map(([key, count]) => `| ${key} | ${count} |`),
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
  const groupsPath = String(args.input || DEFAULT_GROUPS)
  const searchIndexPath = String(args.search || DEFAULT_SEARCH_INDEX)
  const detailIndexPath = String(args.detail || DEFAULT_DETAIL_INDEX)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(groupsPath)) throw new Error(`verified groups file not found: ${groupsPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const groups = await readJsonl(groupsPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const searchResult = verifyIndexKind('search', readJsonFile(searchIndexPath), groups.rows, docsById)
  const detailResult = verifyIndexKind('detail', readJsonFile(detailIndexPath), groups.rows, docsById)
  const rows = [...searchResult.rows, ...detailResult.rows]
  const blockedRows = rows.filter((row) => row.status === 'blocked')
  const warnings = rows.flatMap((row) => row.warnings || [])
  const blockers = rows.flatMap((row) => row.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-phase1-index-verify-v01.rows.jsonl'),
    summary: path.join(outDir, 'work-merge-phase1-index-verify-v01-summary.json'),
    json: path.join(outDir, 'work-merge-phase1-index-verify-v01.json'),
    md: path.join(outDir, 'work-merge-phase1-index-verify-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: groups.failed === 0 && blockedRows.length === 0,
    payloadBaseUrl: baseUrl,
    groupsFile: groupsPath,
    searchIndexFile: searchIndexPath,
    detailIndexFile: detailIndexPath,
    groupsRead: groups.read,
    groupsLoaded: groups.rows.length,
    parseFailures: groups.failed,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    blockedGroups: blockedRows.length,
    searchIndex: {
      mode: searchResult.mode,
      total: searchResult.total,
      counts: searchResult.counts,
      workItems: searchResult.workItems,
    },
    detailIndex: {
      mode: detailResult.mode,
      total: detailResult.total,
      counts: detailResult.counts,
      workItems: detailResult.workItems,
    },
    byStatus: countBy(rows, 'status'),
    byWarning: countBy(warnings, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      indexReadOnly: true,
      dataChanged: false,
    },
  }

  const samples = { blocked: blockedRows.slice(0, 20), verified: rows.filter((row) => row.status === 'verified').slice(0, 20) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
