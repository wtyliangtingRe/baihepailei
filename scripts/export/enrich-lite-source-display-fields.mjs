#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_FILE = 'public/detail-index.json'
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

function text(value) {
  return String(value ?? '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

function uniqueBy(values, getKey) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const key = getKey(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function textValues(value, out = []) {
  if (!value) return out
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = text(value)
    if (normalized) out.push(normalized)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) textValues(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const key of ['title', 'name', 'value', 'text', 'label', 'native', 'romaji', 'english', 'chinese', 'japanese', 'zh', 'ja', 'en']) {
      if (key in value) textValues(value[key], out)
    }
  }
  return out
}

function titleValues(doc) {
  return uniqueBy([
    doc.title,
    doc.originalTitle,
    doc.subtitle,
    doc.displayTitle,
    doc.searchTitle,
    textValues(doc.aliases),
    textValues(doc.localizedTitles),
    textValues(doc.titles),
    textValues(doc.alternativeTitles),
    textValues(doc.altTitles),
    textValues(doc.synonyms),
    textValues(doc.titleTranslations),
    textValues(doc.titleVariants),
    textValues(doc.names),
  ].flat(Infinity).map(text).filter(Boolean), (value) => value.toLowerCase())
}

function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, text(value)]).filter(([, value]) => value))
}

function candidateSourcesOf(doc) {
  const sources = Array.isArray(doc?.candidateSources) ? doc.candidateSources : []
  return uniqueBy(
    sources
      .map((item) => ({
        source: text(item?.source),
        label: text(item?.label),
        externalId: text(item?.externalId),
        url: text(item?.url),
      }))
      .filter((item) => item.source || item.label || item.externalId || item.url),
    (item) => [item.source, item.externalId, item.url, item.label].join('|').toLowerCase(),
  )
}

function sourceLinksOf(doc) {
  const rawLinks = Array.isArray(doc?.sourceLinks) ? doc.sourceLinks : []
  const sourceLinks = rawLinks
    .map((item) => ({ label: text(typeof item === 'string' ? '' : item?.label), url: text(typeof item === 'string' ? item : item?.url) }))
    .filter((item) => item.url)
  const candidateLinks = candidateSourcesOf(doc)
    .filter((item) => item.url)
    .map((item) => ({
      label: text(item.label || [item.source, item.externalId].filter(Boolean).join(' ')),
      url: item.url,
    }))
  return uniqueBy([...sourceLinks, ...candidateLinks], (item) => item.url)
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await response.text()
  let payload = null
  try {
    payload = body ? JSON.parse(body) : null
  } catch {
    payload = { raw: body }
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}\n${JSON.stringify(payload, null, 2)}`)
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
  const file = String(args.file || args.out || DEFAULT_FILE)
  const includeDrafts = Boolean(args['include-drafts'])
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const secret = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(file)) throw new Error(`detail index file not found: ${file}`)

  let token = null
  if (email && secret) token = await login(baseUrl, email, secret)

  const works = await fetchWorks(baseUrl, token, includeDrafts)
  const bySlug = new Map(works.docs.map((doc) => [text(doc.slug), doc]).filter(([slug]) => slug))
  const index = JSON.parse(fs.readFileSync(file, 'utf8'))
  const items = Array.isArray(index?.items) ? index.items : []

  let enriched = 0
  let workItems = 0
  let sourceLinkCount = 0
  let candidateSourceCount = 0
  let externalIdCount = 0
  let titleValueCount = 0

  for (const item of items) {
    if (item.collection !== 'works') continue
    workItems += 1
    const doc = bySlug.get(text(item.slug))
    if (!doc) continue
    const sourceLinks = uniqueBy([...(item.sourceLinks || []), ...sourceLinksOf(doc)], (link) => text(link.url))
    const candidateSources = candidateSourcesOf(doc)
    const externalIds = externalIdsOf(doc)
    const allTitles = uniqueBy([item.title, item.originalTitle, item.aliases || [], item.localizedTitles || [], titleValues(doc)].flat(Infinity).map(text).filter(Boolean), (value) => value.toLowerCase())
    item.sourceLinks = sourceLinks
    item.candidateSources = candidateSources
    item.externalIds = externalIds
    item.allTitles = allTitles
    enriched += 1
    sourceLinkCount += sourceLinks.length
    candidateSourceCount += candidateSources.length
    externalIdCount += Object.keys(externalIds).length
    titleValueCount += allTitles.length
  }

  index.generatedAt = new Date().toISOString()
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  console.log('Lite detail source/title display fields enriched')
  console.log(JSON.stringify({
    file: path.resolve(file),
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    workItems,
    enriched,
    sourceLinkCount,
    candidateSourceCount,
    externalIdCount,
    titleValueCount,
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
