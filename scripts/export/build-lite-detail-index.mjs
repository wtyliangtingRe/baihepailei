#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OUT = 'public/detail-index.json'
const COLLECTIONS = ['works', 'creators', 'terms', 'rules']

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function usage() {
  console.log(`Usage:
  pnpm export:lite-details -- [--url http://localhost:3000] [--out public/detail-index.json] [--include-drafts]

Optional environment variables:
  PAYLOAD_EXPORT_EMAIL
  PAYLOAD_EXPORT_PASSWORD

Fallback environment variables:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

Examples:
  pnpm export:lite-details -- --url "http://localhost:3000"

  $env:PAYLOAD_EXPORT_EMAIL="you@example.com"
  $env:PAYLOAD_EXPORT_PASSWORD="your-password"
  pnpm export:lite-details -- --url "http://localhost:3000" --include-drafts
`)
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

  if (!result?.token) {
    throw new Error('Payload login succeeded but did not return a token.')
  }

  return result.token
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchCollection(baseUrl, token, collection, { includeDrafts }) {
  const docs = []
  let page = 1
  let totalPages = 1

  do {
    const params = new URLSearchParams()
    params.set('limit', '100')
    params.set('page', String(page))
    params.set('depth', '2')

    if (includeDrafts) {
      params.set('draft', 'true')
    } else {
      params.set('where[status][equals]', 'published')
    }

    params.set('where[isLiteVisible][not_equals]', 'false')

    const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
      headers: authHeaders(token),
    })

    docs.push(...(result?.docs || []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)

  return docs
}

function richTextToPlainText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(richTextToPlainText).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    return Object.values(value).map(richTextToPlainText).filter(Boolean).join('\n')
  }
  return ''
}

function normalizeText(value) {
  return String(value || '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

function compactPlainText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join('\n')
}

function aliasesToValues(aliases) {
  if (!Array.isArray(aliases)) return []
  return aliases
    .map((item) => (typeof item === 'string' ? item : item?.value))
    .map(normalizeText)
    .filter(Boolean)
}

function relationshipName(item) {
  if (!item) return ''
  if (typeof item === 'string') return item
  return item.title || item.name || item.slug || ''
}

function relationshipNames(values) {
  if (!Array.isArray(values)) return []
  return values.map(relationshipName).map(normalizeText).filter(Boolean)
}

function workOrganizationNames(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => relationshipName(item?.organization || item))
    .map(normalizeText)
    .filter(Boolean)
}

function mediaImage(value) {
  if (!value || typeof value === 'string') return undefined
  const url = normalizeText(value.url)
  if (!url) return undefined

  return {
    url,
    alt: normalizeText(value.alt),
    filename: normalizeText(value.filename),
    width: Number(value.width) || undefined,
    height: Number(value.height) || undefined,
  }
}

function sourceLinks(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => ({
      label: normalizeText(item?.label),
      url: normalizeText(item?.url),
    }))
    .filter((item) => item.url)
}

function richSection(key, label, content) {
  const plainText = compactPlainText(richTextToPlainText(content))
  if (!content && !plainText) return null
  return {
    key,
    label,
    content: content || null,
    plainText,
  }
}

function sections(values) {
  return values.filter(Boolean)
}

function itemUrl(collection, slug) {
  if (collection === 'works') return `/works/${slug}`
  if (collection === 'creators') return `/creators/${slug}`
  if (collection === 'terms') return `/terms/${slug}`
  if (collection === 'rules') return `/rules/${slug}`
  return `/${collection}/${slug}`
}

function commonFields(collection, doc, title, typeLabel) {
  return {
    id: `${collection}:${doc.slug}`,
    collection,
    typeLabel,
    title: title || '',
    slug: doc.slug || '',
    url: itemUrl(collection, doc.slug),
    legacyXWikiPage: doc.legacyXWikiPage || '',
    updatedAt: doc.updatedAt || '',
    createdAt: doc.createdAt || '',
    status: doc.status || '',
  }
}

function mapWork(doc) {
  return {
    ...commonFields('works', doc, doc.title, '作品'),
    rank: doc.rank || 'unknown',
    originalTitle: doc.originalTitle || '',
    aliases: aliasesToValues(doc.aliases),
    mediaGroup: doc.mediaGroup || 'unknown',
    mediaType: doc.mediaType || 'unknown',
    format: doc.format || 'unknown',
    firstPublishedAt: doc.firstPublishedAt || '',
    firstPublishedPrecision: doc.firstPublishedPrecision || '',
    firstPublishedLabel: doc.firstPublishedLabel || '',
    creators: relationshipNames(doc.creators),
    organizations: workOrganizationNames(doc.organizations),
    tags: relationshipNames(doc.tags),
    warnings: relationshipNames(doc.warnings),
    cover: mediaImage(doc.cover),
    hasEvidence: Boolean(doc.hasEvidence),
    evidenceNote: doc.evidenceNote || '',
    sourceLinks: sourceLinks(doc.sourceLinks),
    sections: sections([
      richSection('summary', '摘要', doc.summary),
      richSection('analysis', '分析', doc.analysis),
    ]),
  }
}

function mapCreator(doc) {
  return {
    ...commonFields('creators', doc, doc.name, '创作者'),
    rank: doc.rank || 'unknown',
    aliases: aliasesToValues(doc.aliases),
    sections: sections([richSection('notes', '备注', doc.notes)]),
  }
}

function mapTerm(doc) {
  return {
    ...commonFields('terms', doc, doc.name, '名词解释'),
    relatedTerms: relationshipNames(doc.relatedTerms),
    relatedWarnings: relationshipNames(doc.relatedWarnings),
    examples: relationshipNames(doc.examples),
    sections: sections([richSection('definition', '定义', doc.definition)]),
  }
}

function mapRule(doc) {
  return {
    ...commonFields('rules', doc, doc.title, '规则'),
    category: doc.category || 'principle',
    relatedTags: relationshipNames(doc.relatedTags),
    relatedWarnings: relationshipNames(doc.relatedWarnings),
    sections: sections([richSection('body', '正文', doc.body)]),
  }
}

function mapDocument(collection, doc) {
  if (collection === 'works') return mapWork(doc)
  if (collection === 'creators') return mapCreator(doc)
  if (collection === 'terms') return mapTerm(doc)
  if (collection === 'rules') return mapRule(doc)
  throw new Error(`Unsupported collection: ${collection}`)
}

function ensureOutputDir(outFile) {
  const dir = path.dirname(path.resolve(outFile))
  fs.mkdirSync(dir, { recursive: true })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    process.exit(0)
  }

  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const outFile = String(args.out || DEFAULT_OUT)
  const includeDrafts = Boolean(args['include-drafts'])
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD

  let token = null
  if (email && password) {
    token = await login(baseUrl, email, password)
  }

  const items = []
  const counts = {}

  for (const collection of COLLECTIONS) {
    const docs = await fetchCollection(baseUrl, token, collection, { includeDrafts })
    counts[collection] = docs.length
    items.push(...docs.map((doc) => mapDocument(collection, doc)))
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    counts,
    total: items.length,
    items,
  }

  ensureOutputDir(outFile)
  fs.writeFileSync(path.resolve(outFile), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log('Lite detail index generated')
  console.log(JSON.stringify({ out: path.resolve(outFile), counts, total: items.length }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
