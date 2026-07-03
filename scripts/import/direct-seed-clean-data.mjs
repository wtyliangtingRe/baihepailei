#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeMediaGroup } from '../../tools/source_import/lib/media-groups.mjs'

const DEFAULT_COLLECTION_ORDER = ['rules', 'terms', 'warnings', 'creators', 'works']
const WORK_EXTERNAL_ID_FIELDS = ['bangumiSubjectId', 'anilistMediaId', 'vndbId', 'wikidataQid', 'malId', 'officialUrl']

function parseArgs(argv) {
  const args = {}

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue

    const equalsIndex = item.indexOf('=')
    if (equalsIndex > 2) {
      const key = item.slice(2, equalsIndex)
      const value = item.slice(equalsIndex + 1)
      args[key] = value || true
      continue
    }

    const key = item.slice(2)
    const values = []

    while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      values.push(argv[i + 1])
      i += 1
    }

    args[key] = values.length > 0 ? values.join(' ') : true
  }

  return args
}
function usage() {
  console.log(`Usage:
  pnpm import:clean-seed -- --file <payload_seed.json> [--url http://localhost:3000] [--dry-run] [--update-existing] [--collections works]

Required environment variables for real import:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

Examples:
  pnpm import:clean-seed -- --file "E:\\data\\baihepailei\\data_local\\import_ready\\bangumi-yuri-tagged.payload.json" --collections works --dry-run

  $env:PAYLOAD_SEED_EMAIL="you@example.com"
  $env:PAYLOAD_SEED_PASSWORD="your-password"
  pnpm import:clean-seed -- --file "E:\\data\\baihepailei\\data_local\\import_ready\\bangumi-yuri-tagged.payload.json" --url "http://localhost:3000" --collections works --update-existing
`)
}

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Seed file not found: ${resolved}`)
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
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
  return {
    Authorization: `JWT ${token}`,
  }
}

function setWhere(params, field, operator, value, prefix = 'where') {
  params.set(`${prefix}[${field}][${operator}]`, String(value))
}

async function findOne(baseUrl, token, collection, configureParams) {
  const params = new URLSearchParams()
  configureParams(params)
  params.set('limit', '1')
  const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
    headers: authHeaders(token),
  })
  return result?.docs?.[0] || null
}

async function findExistingBySlug(baseUrl, token, collection, slug) {
  if (!slug) return null
  return findOne(baseUrl, token, collection, (params) => setWhere(params, 'slug', 'equals', slug))
}

export function candidateWorkLookupPlan(doc) {
  const lookups = []

  if (doc.siteId) {
    lookups.push({ type: 'siteId', field: 'siteId', value: doc.siteId })
  }

  for (const field of WORK_EXTERNAL_ID_FIELDS) {
    const value = doc.externalIds?.[field]
    if (value) {
      lookups.push({ type: 'externalId', field: `externalIds.${field}`, value })
    }
  }

  if (doc.slug) {
    lookups.push({ type: 'slug', field: 'slug', value: doc.slug })
  }

  if (doc.title && doc.mediaType) {
    lookups.push({
      type: 'titleMediaDate',
      and: [
        { field: 'title', operator: 'equals', value: doc.title },
        { field: 'mediaType', operator: 'equals', value: doc.mediaType },
        { field: 'firstPublishedLabel', operator: 'equals', value: doc.firstPublishedLabel || '' },
      ],
    })
  }

  return lookups
}

async function findExistingWork(baseUrl, token, doc) {
  for (const lookup of candidateWorkLookupPlan(doc)) {
    if (lookup.type === 'titleMediaDate') {
      const existing = await findOne(baseUrl, token, 'works', (params) => {
        lookup.and.forEach((condition, index) => {
          params.set(`where[and][${index}][${condition.field}][${condition.operator}]`, String(condition.value))
        })
      })
      if (existing) return { existing, lookup }
      continue
    }

    const existing = await findOne(baseUrl, token, 'works', (params) => setWhere(params, lookup.field, 'equals', lookup.value))
    if (existing) return { existing, lookup }
  }

  return { existing: null, lookup: null }
}

async function createDoc(baseUrl, token, collection, doc) {
  return requestJson(`${baseUrl}/api/${collection}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(doc),
  })
}

async function updateDoc(baseUrl, token, collection, id, doc) {
  return requestJson(`${baseUrl}/api/${collection}/${id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(doc),
  })
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

function normalizeValue(value) {
  return String(value || '')
    .replaceAll('=', ' ')
    .replaceAll('*', ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replaceAll('{', ' ')
    .replaceAll('}', ' ')
    .replaceAll('(', ' ')
    .replaceAll(')', ' ')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

function findHeadingValue(text, labels) {
  const lines = String(text || '').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    for (const label of labels) {
      const markerA = `${label}：`
      const markerB = `${label}:`
      const marker = trimmed.includes(markerA) ? markerA : trimmed.includes(markerB) ? markerB : ''
      if (!marker) continue
      const value = trimmed.slice(trimmed.indexOf(marker) + marker.length)
      return normalizeValue(value)
    }
  }
  return ''
}

function splitAliasText(value) {
  let text = String(value || '')
  for (const separator of ['、', ',', '，', ';', '；', '/', '／']) {
    text = text.split(separator).join('|')
  }
  return text
    .split('|')
    .map(normalizeValue)
    .filter(Boolean)
}

function arrayRowsToValues(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => (typeof row === 'string' ? row : row?.value))
    .map(normalizeValue)
    .filter(Boolean)
}

function valuesToArrayRows(values) {
  const seen = new Set()
  const output = []
  for (const raw of values) {
    const value = normalizeValue(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push({ value })
  }
  return output
}

function cleanArrayRows(rows) {
  return Array.isArray(rows) ? rows.filter(Boolean) : []
}

function cleanObject(value) {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function localizedTitleValues(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => (typeof row === 'string' ? row : row?.title))
    .map(normalizeValue)
    .filter(Boolean)
}

function localizedNameValues(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => (typeof row === 'string' ? row : row?.name))
    .map(normalizeValue)
    .filter(Boolean)
}

function buildSearchText(parts) {
  const seen = new Set()
  const lines = []
  for (const raw of parts.flat(Infinity)) {
    const value = normalizeValue(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(value)
  }
  return lines.join('\n')
}

function inferRankFromLegacyPage(legacyXWikiPage) {
  const fullName = String(legacyXWikiPage || '')
  if (fullName.includes('AA级')) return 'AA'
  for (const rank of ['S', 'A', 'B', 'C', 'D', 'E', 'F']) {
    if (fullName.includes(`${rank}级`)) return rank
  }
  if (fullName.includes('垃圾级')) return 'trash'
  return 'unknown'
}

function candidateSourceText(candidateSources) {
  return cleanArrayRows(candidateSources).map((source) => [
    source.label,
    source.source,
    source.externalId,
    source.url,
    source.note,
  ].filter(Boolean).join(' '))
}

export function cleanDoc(collection, input) {
  const doc = { ...input }

  // Keep this import focused on base documents. Relationship resolution and media uploads
  // will be handled after all base documents exist.
  delete doc.creators
  delete doc.tags
  delete doc.warnings
  delete doc.relatedTerms
  delete doc.relatedWarnings
  delete doc.relatedTags
  delete doc.examples
  delete doc.cover
  delete doc.profileImage

  if (collection === 'rules') {
    const bodyText = richTextToPlainText(doc.body)
    const searchText = doc.searchText || buildSearchText([
      doc.title,
      doc.category,
      doc.legacyXWikiPage,
      bodyText,
    ])

    return {
      siteId: doc.siteId,
      title: doc.title,
      slug: doc.slug,
      category: doc.category || 'principle',
      isLiteVisible: doc.isLiteVisible ?? true,
      isFullVisible: doc.isFullVisible ?? true,
      body: doc.body,
      searchText,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  if (collection === 'terms') {
    const definitionText = richTextToPlainText(doc.definition)
    const searchText = doc.searchText || buildSearchText([
      doc.name,
      doc.slug,
      doc.legacyXWikiPage,
      definitionText,
    ])

    return {
      siteId: doc.siteId,
      name: doc.name,
      slug: doc.slug,
      isLiteVisible: doc.isLiteVisible ?? true,
      isFullVisible: doc.isFullVisible ?? true,
      definition: doc.definition,
      searchText,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  if (collection === 'warnings') {
    return {
      siteId: doc.siteId,
      name: doc.name,
      slug: doc.slug,
      severity: doc.severity || 'medium',
      category: doc.category || 'content',
      description: doc.description,
    }
  }
  if (collection === 'creators') {
    const notesText = richTextToPlainText(doc.notes)
    const existingAliases = arrayRowsToValues(doc.aliases)
    const aliasesFromNotes = splitAliasText(findHeadingValue(notesText, ['别名', '其他名称']))
    const aliases = valuesToArrayRows([...existingAliases, ...aliasesFromNotes])
    const localizedNames = cleanArrayRows(doc.localizedNames)
    const rank = doc.rank && doc.rank !== 'unknown' ? doc.rank : inferRankFromLegacyPage(doc.legacyXWikiPage)
    const searchText = doc.searchText || buildSearchText([
      doc.name,
      aliases.map((item) => item.value),
      localizedNameValues(localizedNames),
      rank,
      doc.slug,
      doc.legacyXWikiPage,
      notesText,
    ])

    return {
      siteId: doc.siteId,
      name: doc.name,
      slug: doc.slug,
      rank,
      aliases,
      localizedNames,
      isLiteVisible: doc.isLiteVisible ?? true,
      isFullVisible: doc.isFullVisible ?? true,
      notes: doc.notes,
      searchText,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  if (collection === 'organizations') {
    const notesText = richTextToPlainText(doc.notes)
    const aliases = valuesToArrayRows(arrayRowsToValues(doc.aliases))
    const localizedNames = cleanArrayRows(doc.localizedNames)
    const searchText = doc.searchText || buildSearchText([
      doc.name,
      aliases.map((item) => item.value),
      localizedNameValues(localizedNames),
      doc.type,
      doc.slug,
      doc.legacyXWikiPage,
      notesText,
    ])

    return {
      siteId: doc.siteId,
      name: doc.name,
      slug: doc.slug,
      type: doc.type || 'other',
      aliases,
      localizedNames,
      notes: doc.notes,
      sourceLinks: doc.sourceLinks,
      searchText,
      isLiteVisible: doc.isLiteVisible ?? true,
      isFullVisible: doc.isFullVisible ?? true,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  if (collection === 'works') {
    const summaryText = richTextToPlainText(doc.summary)
    const analysisText = richTextToPlainText(doc.analysis)
    const evidenceNote = doc.evidenceNote || ''
    const originalTitle = doc.originalTitle || findHeadingValue(summaryText, ['原名'])
    const existingAliases = arrayRowsToValues(doc.aliases)
    const aliasesFromSummary = splitAliasText(findHeadingValue(summaryText, ['其他名称', '别名']))
    const aliases = valuesToArrayRows([...existingAliases, ...aliasesFromSummary])
    const localizedTitles = cleanArrayRows(doc.localizedTitles)
    const mediaType = doc.mediaType || 'unknown'
    const mediaGroup = normalizeMediaGroup(doc.mediaGroup, mediaType)
    const rank = doc.rank && doc.rank !== 'unknown' ? doc.rank : inferRankFromLegacyPage(doc.legacyXWikiPage)
    const creatorHint = findHeadingValue(summaryText, ['作者', '开发商', '发行商', '出版社', '其他创作者'])
    const candidateSources = cleanArrayRows(doc.candidateSources)
    const externalIds = cleanObject(doc.externalIds)
    const workGroup = cleanObject(doc.workGroup)
    const sourceLinks = doc.sourceLinks || candidateSources
      .filter((source) => source.url)
      .map((source) => ({ label: source.label || source.source || 'source', url: source.url }))
    const searchText = doc.searchText || buildSearchText([
      doc.title,
      originalTitle,
      aliases.map((item) => item.value),
      localizedTitleValues(localizedTitles),
      creatorHint,
      rank,
      mediaGroup,
      mediaType,
      doc.format,
      doc.firstPublishedLabel,
      doc.slug,
      doc.legacyXWikiPage,
      summaryText,
      analysisText,
      evidenceNote,
      candidateSourceText(candidateSources),
    ])

    return {
      siteId: doc.siteId,
      title: doc.title,
      slug: doc.slug,
      rank,
      reviewStatus: doc.reviewStatus || 'pending',
      evidenceStrength: doc.evidenceStrength || 'unassessed',
      originalTitle,
      aliases,
      localizedTitles,
      mediaGroup,
      mediaType,
      format: doc.format || 'unknown',
      firstPublishedAt: doc.firstPublishedAt || undefined,
      firstPublishedPrecision: doc.firstPublishedPrecision || 'unknown',
      firstPublishedLabel: doc.firstPublishedLabel || undefined,
      externalIds,
      candidateSources,
      workGroup,
      yuriCandidateScore: doc.yuriCandidateScore ?? undefined,
      isLiteVisible: doc.isLiteVisible ?? true,
      isFullVisible: doc.isFullVisible ?? true,
      hasEvidence: doc.hasEvidence ?? false,
      summary: doc.summary,
      analysis: doc.analysis,
      searchText,
      sourceLinks,
      evidenceNote,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  return doc
}

function parseCollectionList(value) {
  if (!value || value === true) return null
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}
export function collectionsForSeed(seed, collectionArg) {
  const requested = parseCollectionList(collectionArg)
  const order = requested || DEFAULT_COLLECTION_ORDER.filter((collection) => Array.isArray(seed[collection]))

  if (order.length === 0) {
    throw new Error(`Seed must contain at least one collection array: ${DEFAULT_COLLECTION_ORDER.join(', ')}`)
  }

  const errors = []
  for (const collection of order) {
    if (!DEFAULT_COLLECTION_ORDER.includes(collection)) {
      errors.push(`Unsupported collection: ${collection}`)
    }
    if (!Array.isArray(seed[collection])) {
      errors.push(`Missing or invalid array: ${collection}`)
    }
  }

  if (errors.length) {
    throw new Error(errors.join('\n'))
  }

  return order
}

async function findExistingDoc({ baseUrl, token, collection, doc }) {
  if (collection === 'works') {
    return findExistingWork(baseUrl, token, doc)
  }

  const existing = await findExistingBySlug(baseUrl, token, collection, doc.slug)
  return { existing, lookup: existing ? { type: 'slug', field: 'slug', value: doc.slug } : null }
}

async function importCollection({ baseUrl, token, collection, docs, dryRun, updateExisting }) {
  const summary = {
    collection,
    total: docs.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  }

  console.log(`\n${collection}: ${docs.length}`)

  for (const raw of docs) {
    const doc = cleanDoc(collection, raw)
    const label = doc.slug || doc.title || doc.name

    if (dryRun) {
      console.log(`  dry-run: ${label}`)
      continue
    }

    try {
      const { existing, lookup } = await findExistingDoc({ baseUrl, token, collection, doc })
      if (existing) {
        if (updateExisting) {
          await updateDoc(baseUrl, token, collection, existing.id, doc)
          summary.updated += 1
          console.log(`  updated: ${label} (${lookup?.type || 'matched'})`)
        } else {
          summary.skipped += 1
          console.log(`  skipped existing: ${label} (${lookup?.type || 'matched'})`)
        }
        continue
      }

      await createDoc(baseUrl, token, collection, doc)
      summary.created += 1
      console.log(`  created: ${label}`)
    } catch (error) {
      summary.errors += 1
      console.warn(`  error: ${label}`)
      console.warn(String(error?.message || error))
    }
  }

  return summary
}

export async function runImport(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || !args.file) {
    usage()
    return args.help ? 0 : 1
  }

  const seed = readJson(String(args.file))
  const collections = collectionsForSeed(seed, args.collections || args.collection)

  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const dryRun = Boolean(args['dry-run'])
  const updateExisting = Boolean(args['update-existing'])

  console.log('Direct clean seed import')
  console.log(JSON.stringify({
    file: path.resolve(String(args.file)),
    url: baseUrl,
    dryRun,
    updateExisting,
    collections,
    counts: Object.fromEntries(collections.map((key) => [key, seed[key].length])),
  }, null, 2))

  if (dryRun) {
    for (const collection of collections) {
      await importCollection({
        baseUrl,
        token: null,
        collection,
        docs: seed[collection],
        dryRun,
        updateExisting,
      })
    }
    return 0
  }

  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) {
    throw new Error('Set PAYLOAD_SEED_EMAIL and PAYLOAD_SEED_PASSWORD before real import.')
  }

  const token = await login(baseUrl, email, password)
  console.log(`Logged in to ${baseUrl}`)

  const summaries = []
  for (const collection of collections) {
    summaries.push(await importCollection({
      baseUrl,
      token,
      collection,
      docs: seed[collection],
      dryRun,
      updateExisting,
    }))
  }

  console.log('\nImport summary:')
  console.log(JSON.stringify(summaries, null, 2))
  return 0
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  runImport().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}



