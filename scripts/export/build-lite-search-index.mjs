#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OUT = 'public/search-index.json'
const COLLECTIONS = ['works', 'creators', 'organizations', 'evidence', 'terms', 'rules']
const OPTIONAL_COLLECTIONS = new Set(['evidence'])
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
  pnpm export:lite-search -- [--url http://localhost:3000] [--out public/search-index.json] [--include-drafts]
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

async function login(baseUrl, email, secret) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password: secret }),
  })

  if (!result?.token) {
    throw new Error('Payload login succeeded but did not return a token.')
  }

  return result.token
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

function visibilityParams(collection, includeDrafts) {
  const params = new URLSearchParams()
  params.set('limit', '100')
  params.set('depth', '1')

  if (includeDrafts) {
    params.set('draft', 'true')
  } else if (collection === 'evidence') {
    params.set('where[status][equals]', 'confirmed')
    params.set('where[isPublic][equals]', 'true')
  } else {
    params.set('where[status][equals]', 'published')
  }

  // Visibility flags must still apply when draft records are included.
  // Otherwise manually hidden creator/organization anomalies leak back into Lite indexes.
  if (collection !== 'evidence') {
    params.set('where[isLiteVisible][not_equals]', 'false')
  }

  return params
}

async function fetchCollection(baseUrl, token, collection, { includeDrafts }) {
  const docs = []
  let page = 1
  let totalPages = 1

  do {
    const params = visibilityParams(collection, includeDrafts)
    params.set('page', String(page))

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

function aliasesToValues(aliases) {
  if (!Array.isArray(aliases)) return []
  return aliases
    .map((item) => (typeof item === 'string' ? item : item?.value))
    .map(normalizeText)
    .filter(Boolean)
}

function localizedTitleValues(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => (typeof item === 'string' ? item : item?.title))
    .map(normalizeText)
    .filter(Boolean)
}

function localizedNameValues(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => (typeof item === 'string' ? item : item?.name))
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

function uniqueValues(values) {
  const seen = new Set()
  const output = []
  for (const raw of values.flat(Infinity)) {
    const value = normalizeText(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function buildSearchBlob(parts) {
  return uniqueValues(parts).join('\n')
}

function itemUrl(collection, slug) {
  if (collection === 'works') return `/works/${slug}`
  if (collection === 'creators') return `/creators/${slug}`
  if (collection === 'organizations') return `/organizations/${slug}`
  if (collection === 'evidence') return `/evidence/${slug}`
  if (collection === 'terms') return `/terms/${slug}`
  if (collection === 'rules') return `/rules/${slug}`
  return `/${collection}/${slug}`
}

function sourceNotes(doc) {
  return Array.isArray(doc?.candidateSources)
    ? doc.candidateSources.map((item) => normalizeText(item?.note)).filter(Boolean)
    : []
}

function deriveContentAdvisories({ tags, warnings, notes, searchText }) {
  const haystack = [tags, warnings, notes, searchText].flat().join('\n').toLowerCase()
  const advisories = []

  if (/contentrating=suggestive|\bsuggestive\b|擦边|暗示性/u.test(haystack)) advisories.push('suggestive')
  if (/contentrating=erotica|\berotica\b|情色|成人向/u.test(haystack)) advisories.push('erotica')
  if (/contentrating=pornographic|\bpornographic\b|色情|成人内容|18禁|r-?18/u.test(haystack)) advisories.push('pornographic')
  if (/doujinshi|同人志|同人本|loose extra/u.test(haystack)) advisories.push('doujinshi_or_extra')
  if (/不宜展示|敏感内容|restricted|hidden|quarantine/u.test(haystack)) advisories.push('restricted')

  return uniqueValues(advisories)
}

function contentVisibilityFromAdvisories(advisories) {
  if (advisories.includes('restricted')) return 'restricted'
  if (advisories.some((item) => ['suggestive', 'erotica', 'pornographic', 'doujinshi_or_extra'].includes(item))) return 'adult'
  return 'ordinary'
}

function mapWork(doc) {
  const aliases = aliasesToValues(doc.aliases)
  const localizedTitles = localizedTitleValues(doc.localizedTitles)
  const creators = relationshipNames(doc.creators)
  const organizations = workOrganizationNames(doc.organizations)
  const tags = relationshipNames(doc.tags)
  const warnings = relationshipNames(doc.warnings)
  const summaryText = richTextToPlainText(doc.summary)
  const analysisText = richTextToPlainText(doc.analysis)
  const notes = sourceNotes(doc)
  const contentAdvisories = deriveContentAdvisories({ tags, warnings, notes, searchText: doc.searchText })
  const contentVisibility = contentVisibilityFromAdvisories(contentAdvisories)

  return {
    id: `works:${doc.slug}`,
    collection: 'works',
    typeLabel: '作品',
    title: doc.title || '',
    slug: doc.slug || '',
    url: itemUrl('works', doc.slug),
    rank: doc.rank || 'unknown',
    originalTitle: doc.originalTitle || '',
    aliases,
    localizedTitles,
    mediaGroup: doc.mediaGroup || 'unknown',
    mediaType: doc.mediaType || 'unknown',
    format: doc.format || 'unknown',
    firstPublishedLabel: doc.firstPublishedLabel || '',
    creators,
    organizations,
    tags,
    warnings,
    contentVisibility,
    contentAdvisories,
    cover: mediaImage(doc.cover),
    searchText: buildSearchBlob([
      doc.title,
      doc.originalTitle,
      aliases,
      localizedTitles,
      creators,
      organizations,
      tags,
      warnings,
      doc.rank,
      doc.mediaGroup,
      doc.mediaType,
      doc.format,
      doc.firstPublishedLabel,
      doc.searchText,
      summaryText,
      analysisText,
    ]),
  }
}

function mapCreator(doc) {
  const aliases = aliasesToValues(doc.aliases)
  const localizedNames = localizedNameValues(doc.localizedNames)
  const notesText = richTextToPlainText(doc.notes)

  return {
    id: `creators:${doc.slug}`,
    collection: 'creators',
    typeLabel: '创作者',
    title: doc.name || '',
    slug: doc.slug || '',
    url: itemUrl('creators', doc.slug),
    rank: doc.rank || 'unknown',
    aliases,
    localizedNames,
    searchText: buildSearchBlob([doc.name, aliases, localizedNames, doc.rank, doc.searchText, notesText]),
  }
}

function mapOrganization(doc) {
  const aliases = aliasesToValues(doc.aliases)
  const localizedNames = localizedNameValues(doc.localizedNames)
  const notesText = richTextToPlainText(doc.notes)

  return {
    id: `organizations:${doc.slug}`,
    collection: 'organizations',
    typeLabel: '机构',
    title: doc.name || '',
    slug: doc.slug || '',
    url: itemUrl('organizations', doc.slug),
    organizationType: doc.type || 'other',
    aliases,
    localizedNames,
    searchText: buildSearchBlob([doc.name, aliases, localizedNames, doc.type, doc.searchText, notesText]),
  }
}

function mapEvidence(doc) {
  const relatedWorks = relationshipNames(doc.relatedWorks)
  const relatedCreators = relationshipNames(doc.relatedCreators)
  const relatedOrganizations = relationshipNames(doc.relatedOrganizations)

  return {
    id: `evidence:${doc.slug}`,
    collection: 'evidence',
    typeLabel: '证据材料',
    title: doc.title || '',
    slug: doc.slug || '',
    url: itemUrl('evidence', doc.slug),
    evidenceType: doc.evidenceType || 'other',
    relatedWorks,
    relatedCreators,
    relatedOrganizations,
    image: mediaImage(doc.image),
    searchText: buildSearchBlob([doc.title, doc.evidenceType, relatedWorks, relatedCreators, relatedOrganizations, doc.description, doc.searchText]),
  }
}

function mapTerm(doc) {
  const definitionText = richTextToPlainText(doc.definition)
  const relatedTerms = relationshipNames(doc.relatedTerms)
  const relatedWarnings = relationshipNames(doc.relatedWarnings)

  return {
    id: `terms:${doc.slug}`,
    collection: 'terms',
    typeLabel: '名词解释',
    title: doc.name || '',
    slug: doc.slug || '',
    url: itemUrl('terms', doc.slug),
    relatedTerms,
    relatedWarnings,
    searchText: buildSearchBlob([doc.name, relatedTerms, relatedWarnings, doc.searchText, definitionText]),
  }
}

function mapRule(doc) {
  const bodyText = richTextToPlainText(doc.body)
  const relatedTags = relationshipNames(doc.relatedTags)
  const relatedWarnings = relationshipNames(doc.relatedWarnings)

  return {
    id: `rules:${doc.slug}`,
    collection: 'rules',
    typeLabel: '规则',
    title: doc.title || '',
    slug: doc.slug || '',
    url: itemUrl('rules', doc.slug),
    category: doc.category || 'principle',
    relatedTags,
    relatedWarnings,
    searchText: buildSearchBlob([doc.title, doc.category, relatedTags, relatedWarnings, doc.searchText, bodyText]),
  }
}

function mapDocument(collection, doc) {
  if (collection === 'works') return mapWork(doc)
  if (collection === 'creators') return mapCreator(doc)
  if (collection === 'organizations') return mapOrganization(doc)
  if (collection === 'evidence') return mapEvidence(doc)
  if (collection === 'terms') return mapTerm(doc)
  if (collection === 'rules') return mapRule(doc)
  throw new Error(`Unsupported collection: ${collection}`)
}

function ensureOutputDir(outFile) {
  const dir = path.dirname(path.resolve(outFile))
  fs.mkdirSync(dir, { recursive: true })
}

function countBy(items, getKey) {
  const counts = {}
  for (const item of items) {
    const key = getKey(item) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function exportWarning(collection, error) {
  const message = String(error?.message || error)
  return {
    collection,
    message: message.slice(0, 1200),
  }
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
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const secret = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  let token = null
  if (email && secret) {
    token = await login(baseUrl, email, secret)
  }

  const items = []
  const counts = {}
  const exportWarnings = []

  for (const collection of COLLECTIONS) {
    let docs = []
    try {
      docs = await fetchCollection(baseUrl, token, collection, { includeDrafts })
    } catch (error) {
      if (!OPTIONAL_COLLECTIONS.has(collection)) throw error
      const warning = exportWarning(collection, error)
      exportWarnings.push(warning)
      console.warn(`[warn] skipped optional collection ${collection}: ${warning.message.split('\n')[0]}`)
    }

    counts[collection] = docs.length
    items.push(...docs.map((doc) => mapDocument(collection, doc)))
  }

  const payload = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    source: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    counts,
    visibilityCounts: countBy(items.filter((item) => item.collection === 'works'), (item) => item.contentVisibility || 'ordinary'),
    exportWarnings,
    total: items.length,
    items,
  }

  ensureOutputDir(outFile)
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${items.length} items to ${outFile}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
