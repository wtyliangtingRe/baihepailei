#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_INDEX = 'public/search-index.json'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'lite-search-index-reconcile-v0.1'
const CONFIRM_TOKEN = 'search-index-visible'
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

function countCollections(items) {
  const counts = {}
  for (const item of items) {
    const key = val(item?.collection) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])))
}

function itemSlug(item) {
  const slug = val(item?.slug)
  if (slug) return slug
  const id = val(item?.id)
  if (id.startsWith('works:')) return id.slice('works:'.length)
  return ''
}

function buildRows(items, docsBySlug) {
  return items
    .filter((item) => item?.collection === 'works')
    .map((item) => {
      const slug = itemSlug(item)
      const doc = docsBySlug.get(slug)
      const shouldKeep = Boolean(doc && doc.isLiteVisible !== false)
      return {
        id: val(item?.id),
        slug,
        title: val(item?.title),
        payloadFound: Boolean(doc),
        payloadIsLiteVisible: doc?.isLiteVisible ?? null,
        action: shouldKeep ? 'keep' : 'omit_from_search_index',
      }
    })
}

function summarizeRows(rows) {
  const out = {}
  for (const row of rows) out[row.action] = (out[row.action] || 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function markdown(summary, samples) {
  return [
    '# Lite Search Index Reconcile v0.1',
    '',
    'Reconciles exported lite search index work items with current Payload lite visibility. Default mode is dry-run.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- mode: ${summary.mode}`,
    `- indexFile: ${summary.indexFile}`,
    `- originalTotal: ${summary.originalTotal}`,
    `- reconciledTotal: ${summary.reconciledTotal}`,
    `- originalWorks: ${summary.originalCounts.works || 0}`,
    `- reconciledWorks: ${summary.reconciledCounts.works || 0}`,
    `- omittedWorkItems: ${summary.omittedWorkItems}`,
    '',
    '## Safety',
    '',
    `- payloadRead: ${summary.safety.payloadRead}`,
    `- payloadWrite: ${summary.safety.payloadWrite}`,
    `- indexWrite: ${summary.safety.indexWrite}`,
    '- No Payload data change.',
    '- No PostgreSQL write.',
    '',
    '## Actions',
    '',
    '| Action | Count |',
    '|---|---:|',
    ...Object.entries(summary.byAction).map(([key, count]) => `| ${key} | ${count} |`),
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
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const indexFile = String(args.index || DEFAULT_INDEX)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const applyRequested = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM_TOKEN
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(indexFile)) throw new Error(`search index not found: ${indexFile}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)
  if (applyRequested && !confirmMatched) throw new Error(`Refusing to update index. Use --confirm ${CONFIRM_TOKEN}.`)

  const payload = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  const originalItems = Array.isArray(payload.items) ? payload.items : []
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsBySlug = new Map(works.docs.map((doc) => [val(doc.slug), doc]).filter(([slug]) => slug))
  const rows = buildRows(originalItems, docsBySlug)
  const omittedRows = rows.filter((row) => row.action === 'omit_from_search_index')
  const omittedSlugs = new Set(omittedRows.map((row) => row.slug))
  const reconciledItems = originalItems.filter((item) => item?.collection !== 'works' || !omittedSlugs.has(itemSlug(item)))
  const reconciledPayload = {
    ...payload,
    reconciledAt: new Date().toISOString(),
    counts: countCollections(reconciledItems),
    total: reconciledItems.length,
    items: reconciledItems,
  }

  const outputs = {
    rows: path.join(outDir, 'lite-search-index-reconcile-v01.rows.jsonl'),
    summary: path.join(outDir, 'lite-search-index-reconcile-v01-summary.json'),
    json: path.join(outDir, 'lite-search-index-reconcile-v01.json'),
    md: path.join(outDir, 'lite-search-index-reconcile-v01.md'),
  }

  if (applyRequested) writeJson(indexFile, reconciledPayload)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: true,
    mode: applyRequested ? 'apply' : 'dry-run',
    payloadBaseUrl: baseUrl,
    indexFile,
    originalTotal: originalItems.length,
    reconciledTotal: reconciledItems.length,
    originalCounts: countCollections(originalItems),
    reconciledCounts: countCollections(reconciledItems),
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    omittedWorkItems: omittedRows.length,
    byAction: summarizeRows(rows),
    outputs,
    safety: {
      applyRequested,
      confirmMatched,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      indexRead: true,
      indexWrite: applyRequested,
      dataChanged: false,
    },
  }

  const samples = {
    omitted: omittedRows.slice(0, 30),
    kept: rows.filter((row) => row.action === 'keep').slice(0, 10),
  }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  writeJson(outputs.summary, summary)
  writeJson(outputs.json, report)
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
