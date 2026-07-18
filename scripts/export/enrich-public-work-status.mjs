#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const SEARCH_FILE = 'public/search-index.json'
const DETAIL_FILE = 'public/detail-index.json'
const PAGE_LIMIT = 1000

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
  return payload
}

async function login(baseUrl) {
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload export login environment variables')
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login did not return a token')
  return result.token
}

async function workStatuses(baseUrl, token, includeDrafts) {
  const output = new Map()
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), page: String(page), depth: '0' })
    if (includeDrafts) params.set('draft', 'true')
    else params.set('where[status][equals]', 'published')
    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, {
      headers: { Authorization: `JWT ${token}` },
    })
    for (const doc of result?.docs || []) output.set(String(doc.id), String(doc.status || 'draft'))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return output
}

function atomicWrite(file, value) {
  const resolved = path.resolve(file)
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.rmSync(resolved, { force: true })
  fs.renameSync(temporary, resolved)
}

function enrich(file, statuses) {
  const resolved = path.resolve(file)
  if (!fs.existsSync(resolved)) throw new Error(`Missing generated index: ${resolved}`)
  const index = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  let updated = 0
  for (const item of index.items || []) {
    if (item.collection !== 'works') continue
    const status = statuses.get(String(item.recordId || ''))
    if (!status) continue
    if (item.status !== status) updated += 1
    item.status = status
  }
  index.generatedAt = new Date().toISOString()
  atomicWrite(resolved, index)
  return updated
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const includeDrafts = Boolean(args['include-drafts']) || !Boolean(args['published-only'])
  const token = await login(baseUrl)
  const statuses = await workStatuses(baseUrl, token, includeDrafts)
  const searchUpdated = enrich(args.search || SEARCH_FILE, statuses)
  const detailUpdated = enrich(args.detail || DETAIL_FILE, statuses)
  console.log(JSON.stringify({
    step: 'enrich-public-work-status',
    worksRead: statuses.size,
    searchUpdated,
    detailUpdated,
    includeDrafts,
    directPostgresqlWrite: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
