#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_INDEX = 'public/search-index.json'
const PAGE_LIMIT = 200
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

function pushValue(out, value) {
  const text = cleanText(value)
  if (text) out.push(text)
}

function collectTextValues(value, out = []) {
  if (!value) return out
  if (typeof value === 'string' || typeof value === 'number') {
    pushValue(out, value)
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

function sourceValues(doc) {
  const values = []
  if (doc.siteId) values.push(doc.siteId)
  if (doc.originalSource) values.push(doc.originalSource)
  if (doc.source) values.push(doc.source)
  if (doc.externalIds && typeof doc.externalIds === 'object' && !Array.isArray(doc.externalIds)) {
    for (const [key, value] of Object.entries(doc.externalIds)) {
      if (value) values.push(`${key}:${value}`, value)
    }
  }
  for (const link of Array.isArray(doc.sourceLinks) ? doc.sourceLinks : []) {
    if (typeof link === 'string') values.push(link)
    else values.push(link?.label, link?.url, link?.source, link?.externalId)
  }
  for (const source of Array.isArray(doc.candidateSources) ? doc.candidateSources : []) {
    values.push(source?.source, source?.label, source?.externalId, source?.url)
  }
  return unique(values)
}

function appendSearchText(existing, values) {
  return unique([existing, values]).join('\n')
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const indexFile = String(args.index || args.file || DEFAULT_INDEX)
  const includeDrafts = Boolean(args['include-drafts'])
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const secret = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(indexFile)) throw new Error(`index file not found: ${indexFile}`)

  let token = null
  if (email && secret) token = await login(baseUrl, email, secret)

  const works = await fetchWorks(baseUrl, token, includeDrafts)
  const bySlug = new Map(works.docs.map((doc) => [String(doc.slug || '').trim(), doc]).filter(([slug]) => slug))
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  const items = Array.isArray(index?.items) ? index.items : []

  let enriched = 0
  let workItems = 0
  let titleValuesAdded = 0
  let sourceValuesAdded = 0

  for (const item of items) {
    if (item.collection !== 'works') continue
    workItems += 1
    const doc = bySlug.get(String(item.slug || '').trim())
    if (!doc) continue
    const titles = titleValues(doc)
    const sources = sourceValues(doc)
    const before = String(item.searchText || '')
    item.allTitles = unique([item.title, item.originalTitle, item.aliases, item.localizedTitles, titles])
    item.sourceTraces = sources
    item.searchText = appendSearchText(before, [titles, sources])
    if (item.searchText !== before) enriched += 1
    titleValuesAdded += titles.length
    sourceValuesAdded += sources.length
  }

  index.generatedAt = new Date().toISOString()
  fs.writeFileSync(path.resolve(indexFile), `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  console.log('Lite title/source search fields enriched')
  console.log(JSON.stringify({
    file: path.resolve(indexFile),
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    workItems,
    enriched,
    titleValuesAdded,
    sourceValuesAdded,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      indexWrite: true,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
