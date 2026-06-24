#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const COLLECTION_ORDER = ['rules', 'terms', 'creators', 'works']

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
  pnpm import:clean-seed -- --file <payload_seed_direct_v2_clean.json> [--url http://localhost:3000] [--dry-run] [--update-existing]

Required environment variables for real import:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

Examples:
  pnpm import:clean-seed -- --file "D:\\0GitHubtest\\Baihepailei\\_clean_real_data\\payload_seed_direct_v2_clean.json" --dry-run

  $env:PAYLOAD_SEED_EMAIL="you@example.com"
  $env:PAYLOAD_SEED_PASSWORD="your-password"
  pnpm import:clean-seed -- --file "D:\\0GitHubtest\\Baihepailei\\_clean_real_data\\payload_seed_direct_v2_clean.json" --url "http://localhost:3000" --update-existing
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

async function findExistingBySlug(baseUrl, token, collection, slug) {
  if (!slug) return null
  const params = new URLSearchParams()
  params.set('where[slug][equals]', slug)
  params.set('limit', '1')
  const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
    headers: authHeaders(token),
  })
  return result?.docs?.[0] || null
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

function cleanDoc(collection, input) {
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

  if (collection === 'creators') {
    const notesText = richTextToPlainText(doc.notes)
    const existingAliases = arrayRowsToValues(doc.aliases)
    const aliasesFromNotes = splitAliasText(findHeadingValue(notesText, ['别名', '其他名称']))
    const aliases = valuesToArrayRows([...existingAliases, ...aliasesFromNotes])
    const rank = doc.rank && doc.rank !== 'unknown' ? doc.rank : inferRankFromLegacyPage(doc.legacyXWikiPage)
    const searchText = doc.searchText || buildSearchText([
      doc.name,
      aliases.map((item) => item.value),
      rank,
      doc.slug,
      doc.legacyXWikiPage,
      notesText,
    ])

    return {
      name: doc.name,
      slug: doc.slug,
      rank,
      aliases,
      isLiteVisible: doc.isLiteVisible ?? true,
      isFullVisible: doc.isFullVisible ?? true,
      notes: doc.notes,
      searchText,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  if (collection === 'works') {
    const summaryText = richTextToPlainText(doc.summary)
    const analysisText = richTextToPlainText(doc.analysis)
    const originalTitle = doc.originalTitle || findHeadingValue(summaryText, ['原名'])
    const existingAliases = arrayRowsToValues(doc.aliases)
    const aliasesFromSummary = splitAliasText(findHeadingValue(summaryText, ['其他名称', '别名']))
    const aliases = valuesToArrayRows([...existingAliases, ...aliasesFromSummary])
    const rank = doc.rank && doc.rank !== 'unknown' ? doc.rank : inferRankFromLegacyPage(doc.legacyXWikiPage)
    const creatorHint = findHeadingValue(summaryText, ['作者', '开发商', '发行商', '出版社', '其他创作者'])
    const searchText = doc.searchText || buildSearchText([
      doc.title,
      originalTitle,
      aliases.map((item) => item.value),
      creatorHint,
      rank,
      doc.slug,
      doc.legacyXWikiPage,
      summaryText,
      analysisText,
    ])

    return {
      title: doc.title,
      slug: doc.slug,
      rank,
      originalTitle,
      aliases,
      isLiteVisible: doc.isLiteVisible ?? true,
      isFullVisible: doc.isFullVisible ?? true,
      hasEvidence: doc.hasEvidence ?? false,
      summary: doc.summary,
      analysis: doc.analysis,
      searchText,
      sourceLinks: doc.sourceLinks,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  return doc
}

function validateSeed(seed) {
  const errors = []
  for (const collection of COLLECTION_ORDER) {
    if (!Array.isArray(seed[collection])) {
      errors.push(`Missing or invalid array: ${collection}`)
    }
  }
  if (errors.length) {
    throw new Error(errors.join('\n'))
  }
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
      const existing = await findExistingBySlug(baseUrl, token, collection, doc.slug)
      if (existing) {
        if (updateExisting) {
          await updateDoc(baseUrl, token, collection, existing.id, doc)
          summary.updated += 1
          console.log(`  updated: ${label}`)
        } else {
          summary.skipped += 1
          console.log(`  skipped existing: ${label}`)
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.file) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const seed = readJson(String(args.file))
  validateSeed(seed)

  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const dryRun = Boolean(args['dry-run'])
  const updateExisting = Boolean(args['update-existing'])

  console.log('Direct clean seed import')
  console.log(JSON.stringify({
    file: path.resolve(String(args.file)),
    url: baseUrl,
    dryRun,
    updateExisting,
    counts: Object.fromEntries(COLLECTION_ORDER.map((key) => [key, seed[key].length])),
  }, null, 2))

  if (dryRun) {
    for (const collection of COLLECTION_ORDER) {
      await importCollection({
        baseUrl,
        token: null,
        collection,
        docs: seed[collection],
        dryRun,
        updateExisting,
      })
    }
    return
  }

  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) {
    throw new Error('Set PAYLOAD_SEED_EMAIL and PAYLOAD_SEED_PASSWORD before real import.')
  }

  const token = await login(baseUrl, email, password)
  console.log(`Logged in to ${baseUrl}`)

  const summaries = []
  for (const collection of COLLECTION_ORDER) {
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
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
