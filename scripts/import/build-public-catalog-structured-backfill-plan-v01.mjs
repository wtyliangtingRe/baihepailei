#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_INPUT = 'data_local/staging/public-catalog-import/public-catalog-import-preview-v02-compat.payload.json'
const DEFAULT_OUT_DIR = 'data_local/staging/public-catalog-import'
const DEFAULT_URL = 'http://localhost:3000'
const PAGE_LIMIT = 100

const reviewFields = [
  'importBatch',
  'ratingNotice',
  'chosenBaseSource',
  'reviewReasons',
  'sourceConflictNotes',
]

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue

    const key = item.slice(2)
    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }

    args[key] = next
    index += 1
  }

  return args
}

function usage() {
  console.log(`Usage:
  node scripts/import/build-public-catalog-structured-backfill-plan-v01.mjs [--input <payload.json>] [--url http://localhost:3000] [--out-dir <dir>]

Required environment variables:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

This is a read-only dry-run planner.
It reads the v02 compat payload and compares structured Public Catalog review fields against current Payload works.
It does not write Payload, does not write PostgreSQL, and does not delete anything.
`)
}

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`)
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
  return { Authorization: `JWT ${token}` }
}

async function fetchCollectionDocs({ baseUrl, token, collection, limit = PAGE_LIMIT }) {
  const docs = []
  let page = 1
  let totalDocs = null
  let totalPages = null

  while (totalPages === null || page <= totalPages) {
    const result = await requestJson(`${baseUrl}/api/${collection}?limit=${limit}&page=${page}&depth=0`, {
      headers: authHeaders(token),
    })

    totalDocs = Number(result.totalDocs || 0)
    totalPages = Number(result.totalPages || 1)
    docs.push(...(Array.isArray(result.docs) ? result.docs : []))
    page += 1
  }

  return { totalDocs, docs }
}

function asText(value) {
  return String(value || '').trim()
}

function normalizeReviewReasons(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[;|,]/u)

  return [...new Set(values.map((item) => asText(item)).filter(Boolean))].sort()
}

function normalizeComparable(field, value) {
  if (field === 'reviewReasons') return normalizeReviewReasons(value)
  return asText(value)
}

function sameValue(field, left, right) {
  const normalizedLeft = normalizeComparable(field, left)
  const normalizedRight = normalizeComparable(field, right)

  if (Array.isArray(normalizedLeft) || Array.isArray(normalizedRight)) {
    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
  }

  return normalizedLeft === normalizedRight
}

function changedFields(seedWork, existingWork) {
  const changes = {}

  for (const field of reviewFields) {
    const seedValue = normalizeComparable(field, seedWork[field])
    const existingValue = normalizeComparable(field, existingWork[field])

    if (!sameValue(field, seedWork[field], existingWork[field])) {
      changes[field] = {
        before: existingValue,
        after: seedValue,
      }
    }
  }

  return changes
}

function countBy(rows, getter) {
  const result = {}

  for (const row of rows) {
    const key = String(getter(row) || 'unknown')
    result[key] = (result[key] || 0) + 1
  }

  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]))
}

function indexByUnique(docs, field) {
  const map = new Map()
  const duplicates = []

  for (const doc of docs) {
    const value = asText(doc[field])
    if (!value) continue

    if (map.has(value)) {
      duplicates.push({ field, value, ids: [map.get(value).id, doc.id].filter(Boolean) })
      continue
    }

    map.set(value, doc)
  }

  return { map, duplicates }
}

function findExisting(seedWork, indexes) {
  const siteId = asText(seedWork.siteId)
  if (siteId && indexes.siteId.map.has(siteId)) {
    return { existing: indexes.siteId.map.get(siteId), matchBy: 'siteId', matchValue: siteId }
  }

  const slug = asText(seedWork.slug)
  if (slug && indexes.slug.map.has(slug)) {
    return { existing: indexes.slug.map.get(slug), matchBy: 'slug', matchValue: slug }
  }

  const title = asText(seedWork.title)
  if (title && indexes.title.map.has(title)) {
    return { existing: indexes.title.map.get(title), matchBy: 'title', matchValue: title }
  }

  return { existing: null, matchBy: null, matchValue: null }
}

function buildPlan({ seedWorks, dbWorks }) {
  const indexes = {
    siteId: indexByUnique(dbWorks, 'siteId'),
    slug: indexByUnique(dbWorks, 'slug'),
    title: indexByUnique(dbWorks, 'title'),
  }

  const duplicateDbKeys = [
    ...indexes.siteId.duplicates,
    ...indexes.slug.duplicates,
    ...indexes.title.duplicates,
  ]

  const rows = seedWorks.map((seedWork) => {
    const { existing, matchBy, matchValue } = findExisting(seedWork, indexes)

    if (!existing) {
      return {
        action: 'missing_db_work',
        title: seedWork.title || '',
        slug: seedWork.slug || '',
        siteId: seedWork.siteId || '',
        matchBy,
        matchValue,
        patch: Object.fromEntries(reviewFields.map((field) => [field, normalizeComparable(field, seedWork[field])])),
      }
    }

    const changes = changedFields(seedWork, existing)
    const changeKeys = Object.keys(changes)

    return {
      action: changeKeys.length ? 'backfill_structured_review_fields' : 'unchanged',
      id: existing.id,
      title: seedWork.title || existing.title || '',
      slug: seedWork.slug || existing.slug || '',
      siteId: seedWork.siteId || existing.siteId || '',
      matchBy,
      matchValue,
      changes,
      patch: changeKeys.length
        ? Object.fromEntries(changeKeys.map((field) => [field, normalizeComparable(field, seedWork[field])]))
        : {},
    }
  })

  const backfillRows = rows.filter((row) => row.action === 'backfill_structured_review_fields')
  const missingRows = rows.filter((row) => row.action === 'missing_db_work')
  const unchangedRows = rows.filter((row) => row.action === 'unchanged')

  const summary = {
    generatedAt: new Date().toISOString(),
    inputWorks: seedWorks.length,
    dbWorks: dbWorks.length,
    plannedBackfills: backfillRows.length,
    unchanged: unchangedRows.length,
    missingDbWorks: missingRows.length,
    duplicateDbKeys: duplicateDbKeys.length,
    byAction: countBy(rows, (row) => row.action),
    byMatchBy: countBy(rows, (row) => row.matchBy),
    byChangedField: countBy(
      backfillRows.flatMap((row) => Object.keys(row.changes).map((field) => ({ field }))),
      (row) => row.field
    ),
    safety: {
      payloadWrite: false,
      postgresqlWrite: false,
      importerApply: false,
      delete: false,
    },
  }

  return {
    summary,
    rows,
    samples: {
      backfill: backfillRows.slice(0, 20),
      missingDbWorks: missingRows.slice(0, 20),
      duplicateDbKeys: duplicateDbKeys.slice(0, 20),
    },
  }
}

function formatMarkdown(plan) {
  const lines = [
    '# Public Catalog Structured Backfill Plan v0.1',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer apply.',
    '- No delete.',
    '',
    '## Summary',
    '',
    ...Object.entries(plan.summary).map(([key, value]) => {
      if (typeof value === 'object') return `- ${key}: ${JSON.stringify(value)}`
      return `- ${key}: ${value}`
    }),
    '',
    '## By action',
    '',
    '```json',
    JSON.stringify(plan.summary.byAction, null, 2),
    '```',
    '',
    '## By changed field',
    '',
    '```json',
    JSON.stringify(plan.summary.byChangedField, null, 2),
    '```',
    '',
    '## Sample backfills',
    '',
    '```json',
    JSON.stringify(plan.samples.backfill, null, 2),
    '```',
    '',
    '## Sample missing DB works',
    '',
    '```json',
    JSON.stringify(plan.samples.missingDbWorks, null, 2),
    '```',
    '',
    '## Sample duplicate DB keys',
    '',
    '```json',
    JSON.stringify(plan.samples.duplicateDbKeys, null, 2),
    '```',
    '',
  ]

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || args.h) {
    usage()
    return
  }

  const input = args.input || DEFAULT_INPUT
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR
  const baseUrl = args.url || DEFAULT_URL
  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD

  if (!email || !password) {
    throw new Error('Missing PAYLOAD_SEED_EMAIL or PAYLOAD_SEED_PASSWORD.')
  }

  const seed = readJson(input)
  const seedWorks = Array.isArray(seed.works) ? seed.works : []

  if (!seedWorks.length) {
    throw new Error(`No works found in input: ${input}`)
  }

  console.error(`[plan] logging in to ${baseUrl} ...`)
  const token = await login(baseUrl, email, password)

  console.error('[plan] fetching works from Payload ...')
  const { totalDocs, docs: dbWorks } = await fetchCollectionDocs({ baseUrl, token, collection: 'works' })
  console.error(`[plan] fetched works: ${dbWorks.length}/${totalDocs}`)

  const plan = buildPlan({ seedWorks, dbWorks })
  plan.summary.dbWorksTotalDocs = totalDocs

  const outJson = path.join(outDir, 'public-catalog-structured-backfill-plan-v01.json')
  const outJsonl = path.join(outDir, 'public-catalog-structured-backfill-plan-v01.jsonl')
  const outSummary = path.join(outDir, 'public-catalog-structured-backfill-plan-v01-summary.json')
  const outMd = path.join(outDir, 'public-catalog-structured-backfill-plan-v01.md')

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outJson, JSON.stringify(plan, null, 2), 'utf8')
  fs.writeFileSync(outJsonl, plan.rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(plan.summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(plan), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    inputWorks: plan.summary.inputWorks,
    dbWorks: plan.summary.dbWorks,
    plannedBackfills: plan.summary.plannedBackfills,
    unchanged: plan.summary.unchanged,
    missingDbWorks: plan.summary.missingDbWorks,
    duplicateDbKeys: plan.summary.duplicateDbKeys,
    byChangedField: plan.summary.byChangedField,
    safety: plan.summary.safety,
    outputs: {
      json: outJson,
      jsonl: outJsonl,
      summary: outSummary,
      md: outMd,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})


