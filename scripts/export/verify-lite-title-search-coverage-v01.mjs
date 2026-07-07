#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_INDEX = 'public/search-index.json'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'lite-title-search-coverage-v0.1'
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')

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

function cleanText(value) {
  return String(value ?? '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

function collectTextValues(value, out = []) {
  if (!value) return out
  if (typeof value === 'string' || typeof value === 'number') {
    const text = cleanText(value)
    if (text) out.push(text)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextValues(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const key of ['title', 'name', 'value', 'text', 'label', 'native', 'romaji', 'english', 'chinese', 'japanese', 'zh', 'ja', 'en']) {
      if (key in value) collectTextValues(value[key], out)
    }
  }
  return out
}

function unique(values) {
  const seen = new Set()
  const out = []
  for (const value of values.flat(Infinity).map(cleanText).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function titleValues(doc) {
  return unique([
    doc.title,
    doc.originalTitle,
    doc.subtitle,
    doc.displayTitle,
    doc.searchTitle,
    collectTextValues(doc.aliases),
    collectTextValues(doc.localizedTitles),
    collectTextValues(doc.titles),
    collectTextValues(doc.alternativeTitles),
    collectTextValues(doc.altTitles),
    collectTextValues(doc.synonyms),
    collectTextValues(doc.titleTranslations),
    collectTextValues(doc.titleVariants),
    collectTextValues(doc.names),
  ])
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

function visibilityParams(includeDrafts) {
  const params = new URLSearchParams()
  params.set('limit', String(PAGE_LIMIT))
  params.set('depth', '1')
  if (includeDrafts) {
    params.set('draft', 'true')
  } else {
    params.set('where[status][equals]', 'published')
    params.set('where[isLiteVisible][not_equals]', 'false')
  }
  return params
}

async function fetchWorks(baseUrl, token, includeDrafts) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0
  do {
    const params = visibilityParams(includeDrafts)
    params.set('page', String(page))
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

function containsValue(searchText, value) {
  const haystack = String(searchText || '').toLowerCase()
  const needle = String(value || '').toLowerCase()
  return !needle || haystack.includes(needle)
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = String(typeof getKey === 'function' ? getKey(row) : row[getKey] || 'missing')
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const indexFile = String(args.index || args.file || DEFAULT_INDEX)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const includeDrafts = Boolean(args['include-drafts'])
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const secret = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(indexFile)) throw new Error(`index file not found: ${indexFile}`)

  let token = null
  if (email && secret) token = await login(baseUrl, email, secret)

  const works = await fetchWorks(baseUrl, token, includeDrafts)
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  const items = Array.isArray(index?.items) ? index.items : []
  const indexBySlug = new Map(items.filter((item) => item.collection === 'works').map((item) => [String(item.slug || '').trim(), item]).filter(([slug]) => slug))
  const rows = []

  for (const doc of works.docs) {
    const slug = String(doc.slug || '').trim()
    const item = indexBySlug.get(slug)
    const values = titleValues(doc)
    const missing = item ? values.filter((value) => !containsValue(item.searchText, value)) : values
    rows.push({
      id: String(doc.id || ''),
      slug,
      title: String(doc.title || ''),
      indexed: Boolean(item),
      titleValueCount: values.length,
      missingTitleValueCount: missing.length,
      missingTitleValues: missing.slice(0, 50),
      hasOriginalTitle: Boolean(cleanText(doc.originalTitle)),
      aliasCount: collectTextValues(doc.aliases).length,
      localizedTitleCount: collectTextValues(doc.localizedTitles).length,
      safety: {
        readOnly: true,
        payloadRead: true,
        payloadWrite: false,
        directPostgresqlWrite: false,
        indexReadOnly: true,
        dataChanged: false,
      },
    })
  }

  const missingRows = rows.filter((row) => !row.indexed || row.missingTitleValueCount > 0)
  const outputs = {
    rows: path.join(outDir, 'lite-title-search-coverage-v01.rows.jsonl'),
    missing: path.join(outDir, 'lite-title-search-coverage-v01-missing.rows.jsonl'),
    summary: path.join(outDir, 'lite-title-search-coverage-v01-summary.json'),
    json: path.join(outDir, 'lite-title-search-coverage-v01.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: missingRows.length === 0,
    payloadBaseUrl: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    indexFile,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    indexedWorkItems: indexBySlug.size,
    missingRows: missingRows.length,
    byIndexed: countBy(rows, (row) => String(row.indexed)),
    byMissingTitleValueCount: countBy(rows, (row) => row.missingTitleValueCount ? 'missing' : 'complete'),
    totals: {
      titleValues: rows.reduce((sum, row) => sum + row.titleValueCount, 0),
      missingTitleValues: rows.reduce((sum, row) => sum + row.missingTitleValueCount, 0),
      aliases: rows.reduce((sum, row) => sum + row.aliasCount, 0),
      localizedTitles: rows.reduce((sum, row) => sum + row.localizedTitleCount, 0),
      originalTitles: rows.filter((row) => row.hasOriginalTitle).length,
    },
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

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.missing, missingRows.map((item) => JSON.stringify(item)).join('\n') + (missingRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify({ ok: summary.ok, summary, samples: { missing: missingRows.slice(0, 50) } }, null, 2), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
