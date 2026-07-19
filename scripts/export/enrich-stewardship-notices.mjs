#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const COLLECTIONS = ['works', 'creators', 'organizations']
function exportPageLimit() {
  const requested = Number(process.env.PUBLIC_INDEX_PAGE_LIMIT || 100)
  if (!Number.isFinite(requested)) return 100
  return Math.min(250, Math.max(25, Math.round(requested)))
}
const PAGE_LIMIT = exportPageLimit()

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.text()
  let payload = null
  try { payload = body ? JSON.parse(body) : null } catch { payload = { raw: body } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 1000)}`)
  return payload
}

async function tokenFor(baseUrl) {
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) return ''
  const login = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return String(login?.token || '')
}

async function fetchAll(baseUrl, token, collection) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({
      depth: '2',
      limit: String(PAGE_LIMIT),
      page: String(page),
    })
    const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
      headers: token ? { Authorization: `JWT ${token}` } : {},
    })
    docs.push(...(result?.docs || []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function text(value) {
  return String(value ?? '').trim()
}

function noticeView(value) {
  if (!value || typeof value !== 'object') return null
  if (value.isPublic === false) return null
  const title = text(value.title)
  const summary = text(value.summary)
  if (!title && !summary) return null
  return {
    id: value.id,
    slug: text(value.slug),
    title,
    summary,
    category: text(value.category),
    tone: text(value.tone) || 'note',
    severity: text(value.severity) || 'low',
    helpUrl: text(value.helpUrl),
    sortOrder: Number.isFinite(Number(value.sortOrder)) ? Number(value.sortOrder) : 100,
  }
}

function notices(values) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  return values
    .map(noticeView)
    .filter(Boolean)
    .filter((notice) => {
      const key = String(notice.id || notice.slug || notice.title).toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

async function main() {
  const baseUrl = String(arg('--url', process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000')).replace(/\/+$/u, '')
  const out = path.resolve(arg('--out', 'public/detail-index.json'))
  if (!fs.existsSync(out)) throw new Error(`Detail index not found: ${out}`)

  const index = JSON.parse(fs.readFileSync(out, 'utf8'))
  const token = await tokenFor(baseUrl)
  const lookup = new Map(index.items.map((item, position) => [`${item.collection}:${String(item.recordId || '')}`, position]))
  let patched = 0

  try {
    for (const collection of COLLECTIONS) {
      const docs = await fetchAll(baseUrl, token, collection)
      for (const doc of docs) {
        const position = lookup.get(`${collection}:${String(doc.id)}`)
        if (position === undefined) continue
        const next = notices(doc.stewardshipNotices)
        if (next.length) index.items[position].stewardshipNotices = next
        else delete index.items[position].stewardshipNotices
        patched += 1
      }
    }
  } catch (error) {
    console.warn(`[warn] stewardship notice enrichment skipped: ${String(error?.message || error).split('\n')[0]}`)
    return
  }

  index.generatedAt = new Date().toISOString()
  fs.writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ out, patched, feature: 'stewardship-notices' }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
