#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_FILE = 'public/search-index.json'
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

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`)
  return payload
}

async function login(baseUrl, email, credential) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password: credential }),
  })
  if (!result?.token) throw new Error('Payload login succeeded but did not return a token.')
  return result.token
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

function visibilityParams(collection, includeDrafts) {
  const params = new URLSearchParams()
  params.set('limit', '100')
  params.set('depth', '0')
  if (includeDrafts) {
    params.set('draft', 'true')
  } else if (collection === 'evidence') {
    params.set('where[status][equals]', 'confirmed')
    params.set('where[isPublic][equals]', 'true')
  } else {
    params.set('where[status][equals]', 'published')
  }
  if (collection !== 'evidence') {
    params.set('where[isLiteVisible][not_equals]', 'false')
  }
  return params
}

async function fetchCollection(baseUrl, token, collection, includeDrafts) {
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

async function fetchOptionalCollection(baseUrl, token, collection, includeDrafts) {
  try {
    return await fetchCollection(baseUrl, token, collection, includeDrafts)
  } catch (error) {
    console.warn(`[warn] skipped optional review enrichment collection ${collection}: ${String(error?.message || error).split('\n')[0]}`)
    return []
  }
}

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) throw new Error(`Missing file: ${resolved}`)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function defaultReviewStatus(value) {
  return value || 'pending'
}

function defaultEvidenceStrength(value) {
  return value || 'unassessed'
}

function optionalPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return Math.min(100, Math.max(0, number))
}

function normalizeRadarAssessment(value) {
  if (!value || typeof value !== 'object') return undefined
  const assessment = {
    confidencePercent: optionalPercent(value.confidencePercent),
    evidenceCoveragePercent: optionalPercent(value.evidenceCoveragePercent),
    evidenceStatus: String(value.evidenceStatus || '').trim() || undefined,
    sourceSummary: String(value.sourceSummary || '').trim() || undefined,
    policyVersion: String(value.policyVersion || '').trim() || undefined,
    assessedAt: String(value.assessedAt || '').trim() || undefined,
  }
  return Object.values(assessment).some((item) => item !== undefined) ? assessment : undefined
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = String(args.file || args.out || DEFAULT_FILE)
  const index = readJson(file)
  const baseUrl = String(args.url || index.source || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const includeDrafts = Boolean(args['include-drafts']) || index.mode === 'drafts-and-published'
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const credential = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  let token = null
  if (email && credential) token = await login(baseUrl, email, credential)

  const works = await fetchCollection(baseUrl, token, 'works', includeDrafts)
  const evidence = await fetchOptionalCollection(baseUrl, token, 'evidence', includeDrafts)
  const reviewById = new Map()

  for (const doc of works) {
    reviewById.set(`works:${doc.slug}`, {
      reviewStatus: defaultReviewStatus(doc.reviewStatus),
      evidenceStrength: defaultEvidenceStrength(doc.evidenceStrength),
      ratingNotice: doc.ratingNotice || '',
      radarAssessment: normalizeRadarAssessment(doc.radarAssessment),
    })
  }

  for (const doc of evidence) {
    reviewById.set(`evidence:${doc.slug}`, {
      reviewStatus: defaultReviewStatus(doc.reviewStatus),
      evidenceStrength: defaultEvidenceStrength(doc.evidenceStrength),
    })
  }

  const items = (index.items || []).map((item) => {
    if (!['works', 'evidence'].includes(item.collection)) return item
    const fields = reviewById.get(item.id) || {}
    const enriched = {
      ...item,
      reviewStatus: defaultReviewStatus(fields.reviewStatus || item.reviewStatus),
      evidenceStrength: defaultEvidenceStrength(fields.evidenceStrength || item.evidenceStrength),
    }
    if (item.collection === 'works') {
      enriched.ratingNotice = fields.ratingNotice || item.ratingNotice || ''
      enriched.radarAssessment = fields.radarAssessment || item.radarAssessment
    }
    return enriched
  })

  writeJson(file, { ...index, items })
  console.log('Lite review and radar assessment fields enriched')
  console.log(JSON.stringify({ file: path.resolve(file), works: works.length, evidence: evidence.length }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
