#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_COLLECTIONS = [
  'works',
  'rules',
  'terms',
  'warnings',
  'tags',
  'evidence',
  'creators',
  'organizations',
]

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

function parseList(value, fallback) {
  if (!value || value === true) return fallback
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
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

async function login(baseUrl) {
  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD

  if (!email || !password) {
    return {
      token: null,
      mode: 'public_or_signed_out',
      note: 'PAYLOAD_SEED_EMAIL / PAYLOAD_SEED_PASSWORD not set. Preview may only see publicly readable documents.',
    }
  }

  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  if (!result?.token) {
    throw new Error('Payload login succeeded but did not return a token.')
  }

  return {
    token: result.token,
    mode: 'authenticated',
    note: 'Authenticated read enabled.',
  }
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchAllDocs({ baseUrl, token, collection }) {
  const docs = []
  let page = 1
  let totalDocs = 0
  let totalPages = 0

  while (true) {
    const params = new URLSearchParams()
    params.set('limit', '100')
    params.set('page', String(page))
    params.set('depth', '0')

    const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
      headers: authHeaders(token),
    })

    const pageDocs = Array.isArray(result?.docs) ? result.docs : []
    docs.push(...pageDocs)

    totalDocs = Number(result?.totalDocs || docs.length)
    totalPages = Number(result?.totalPages || page)

    if (!result?.hasNextPage || page >= totalPages) break
    page += 1
  }

  return {
    collection,
    totalDocs,
    totalPages,
    docs,
  }
}

function textValues(doc) {
  const values = [
    doc.id,
    doc.title,
    doc.name,
    doc.slug,
    doc.siteId,
    doc.email,
    doc.status,
    doc.legacyXWikiPage,
    doc.searchText,
    doc.evidenceNote,
    doc.description,
  ]

  if (doc.externalIds && typeof doc.externalIds === 'object') {
    values.push(...Object.values(doc.externalIds))
  }

  if (Array.isArray(doc.aliases)) {
    for (const alias of doc.aliases) values.push(alias?.value || alias)
  }

  if (Array.isArray(doc.candidateSources)) {
    for (const source of doc.candidateSources) {
      values.push(source?.source, source?.label, source?.externalId, source?.url, source?.note)
    }
  }

  return values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value))
}

function labelOf(doc) {
  return doc.title || doc.name || doc.slug || doc.email || doc.siteId || doc.id || '(untitled)'
}

function classifyTestCandidate(collection, doc) {
  const slug = String(doc.slug || '').toLowerCase()
  const siteId = String(doc.siteId || '').toLowerCase()
  const title = String(doc.title || doc.name || '').trim()
  const titleLower = title.toLowerCase()

  const reasons = []

  const token = '(test|demo|sample|fixture|dummy|placeholder|tmp|temp|seed-demo)'
  const boundaryPattern = new RegExp(`(^|[-_:])${token}($|[-_:])`)

  if (boundaryPattern.test(slug)) reasons.push('slug-explicit-testlike-token')
  if (boundaryPattern.test(siteId)) reasons.push('siteId-explicit-testlike-token')

  if (/^(test|demo|sample|fixture|dummy|placeholder|tmp|temp)(\\b|[-_:]|$)/.test(titleLower)) {
    reasons.push('title-prefix-en-testlike')
  }

  if (/^(测试|示例|样例|演示|占位)(作品|页面|条目|数据)?$/.test(title)) {
    reasons.push('title-exact-cn-testlike')
  }

  if (/^(测试|示例|样例|演示|占位)[-_:：\s]/.test(title)) {
    reasons.push('title-prefix-cn-testlike')
  }

  const isProtected =
    doc.reviewStatus === 'reviewed' ||
    doc.evidenceStrength === 'strong' ||
    doc.status === 'published' ||
    String(doc.siteId || '').startsWith('rule-radar-') ||
    String(doc.siteId || '').startsWith('rule-source-priority-') ||
    String(doc.siteId || '').startsWith('term-') ||
    String(doc.siteId || '').startsWith('warning-')

  let confidence = 'none'
  if (reasons.length >= 2) confidence = 'high'
  else if (reasons.length >= 1) confidence = 'medium'

  let recommendedAction = 'keep'
  if (confidence === 'high' && !isProtected) recommendedAction = 'review_delete_candidate'
  else if (confidence === 'medium' && !isProtected) recommendedAction = 'manual_review'
  else if (confidence !== 'none' && isProtected) recommendedAction = 'protected_review_only'

  return {
    collection,
    id: doc.id,
    label: labelOf(doc),
    slug: doc.slug || '',
    siteId: doc.siteId || '',
    status: doc.status || '',
    reviewStatus: doc.reviewStatus || '',
    evidenceStrength: doc.evidenceStrength || '',
    isProtected,
    confidence,
    recommendedAction,
    reasons,
  }
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function toCsv(rows) {
  const headers = [
    'collection',
    'id',
    'label',
    'slug',
    'siteId',
    'status',
    'reviewStatus',
    'evidenceStrength',
    'isProtected',
    'confidence',
    'recommendedAction',
    'reasons',
  ]

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => {
      const value = key === 'reasons' ? row.reasons.join('|') : row[key]
      return csvEscape(value)
    }).join(',')),
  ].join('\n')
}

function markdownReport({ generatedAt, baseUrl, auth, collectionSummaries, candidates, errors }) {
  const actionCounts = {}
  const confidenceCounts = {}

  for (const row of candidates) {
    actionCounts[row.recommendedAction] = (actionCounts[row.recommendedAction] || 0) + 1
    confidenceCounts[row.confidence] = (confidenceCounts[row.confidence] || 0) + 1
  }

  return [
    '# Clear Test Data Preview v0.1',
    '',
    `Generated at: ${generatedAt}`,
    `Base URL: ${baseUrl}`,
    `Auth mode: ${auth.mode}`,
    '',
    `> ${auth.note}`,
    '',
    '## Safety',
    '',
    '- Preview only.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No delete.',
    '- No production data change.',
    '',
    '## Collection counts',
    '',
    '| collection | visible docs | total pages |',
    '|---|---:|---:|',
    ...collectionSummaries.map((item) => `| ${item.collection} | ${item.totalDocs} | ${item.totalPages} |`),
    '',
    '## Candidate summary',
    '',
    '### By recommended action',
    '',
    '```json',
    JSON.stringify(actionCounts, null, 2),
    '```',
    '',
    '### By confidence',
    '',
    '```json',
    JSON.stringify(confidenceCounts, null, 2),
    '```',
    '',
    '## Candidate rows',
    '',
    candidates.length === 0
      ? 'No test-like candidates detected by the current heuristic.'
      : '| collection | label | slug | siteId | confidence | action | reasons |',
    candidates.length === 0
      ? ''
      : '|---|---|---|---|---:|---|---|',
    ...candidates.map((row) => `| ${row.collection} | ${row.label} | ${row.slug} | ${row.siteId} | ${row.confidence} | ${row.recommendedAction} | ${row.reasons.join(', ')} |`),
    '',
    '## Errors',
    '',
    errors.length === 0 ? 'No collection read errors.' : '```json',
    errors.length === 0 ? '' : JSON.stringify(errors, null, 2),
    errors.length === 0 ? '' : '```',
    '',
    '## Notes',
    '',
    '- This preview is heuristic. Review candidates manually before any apply step.',
    '- Published, reviewed, strong-evidence, rule, term, and warning foundation records are protected by default.',
    '- A future apply script should require an explicit reviewed candidate list, not raw heuristic output.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const collections = parseList(args.collections || args.collection, DEFAULT_COLLECTIONS)
  const outDir = String(args.out || path.join('data_local', 'staging', 'clear-test-data-preview'))

  fs.mkdirSync(outDir, { recursive: true })

  const generatedAt = new Date().toISOString()
  const auth = await login(baseUrl)

  const collectionSummaries = []
  const candidates = []
  const errors = []

  for (const collection of collections) {
    try {
      const result = await fetchAllDocs({ baseUrl, token: auth.token, collection })
      collectionSummaries.push({
        collection,
        totalDocs: result.totalDocs,
        totalPages: result.totalPages,
      })

      for (const doc of result.docs) {
        const row = classifyTestCandidate(collection, doc)
        if (row.confidence !== 'none') candidates.push(row)
      }
    } catch (error) {
      errors.push({
        collection,
        error: String(error?.message || error),
      })
    }
  }

  candidates.sort((a, b) => {
    const actionOrder = {
      review_delete_candidate: 0,
      manual_review: 1,
      protected_review_only: 2,
      keep: 3,
    }

    return (
      (actionOrder[a.recommendedAction] ?? 9) - (actionOrder[b.recommendedAction] ?? 9) ||
      a.collection.localeCompare(b.collection) ||
      a.label.localeCompare(b.label)
    )
  })

  const payload = {
    generatedAt,
    baseUrl,
    auth,
    collections,
    collectionSummaries,
    candidates,
    errors,
    safety: {
      payloadWrite: false,
      postgresqlWrite: false,
      delete: false,
      productionDataChange: false,
    },
  }

  const jsonPath = path.join(outDir, 'clear-test-data-preview-v01.json')
  const csvPath = path.join(outDir, 'clear-test-data-preview-v01-candidates.csv')
  const mdPath = path.join(outDir, 'clear-test-data-preview-v01.md')

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')
  fs.writeFileSync(csvPath, toCsv(candidates), 'utf8')
  fs.writeFileSync(mdPath, markdownReport({
    generatedAt,
    baseUrl,
    auth,
    collectionSummaries,
    candidates,
    errors,
  }), 'utf8')

  console.log(JSON.stringify({
    ok: errors.length === 0,
    baseUrl,
    authMode: auth.mode,
    collections,
    collectionSummaries,
    candidates: candidates.length,
    errors,
    outputs: {
      jsonPath,
      csvPath,
      mdPath,
    },
  }, null, 2))

  return errors.length === 0 ? 0 : 1
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
