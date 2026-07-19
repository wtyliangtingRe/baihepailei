#!/usr/bin/env node
const urlIndex = process.argv.indexOf('--url')
const baseUrl = String(urlIndex >= 0 ? process.argv[urlIndex + 1] : process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
const apply = process.argv.includes('--apply')
const confirmIndex = process.argv.indexOf('--confirm')
const confirmation = confirmIndex >= 0 ? process.argv[confirmIndex + 1] : ''
const expected = 'MIGRATE-LEGACY-ROLES-TO-MEMBER'

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 1000)}`)
  return body
}

async function main() {
  const email = process.env.USER_MAINTENANCE_EMAIL || process.env.SITE_OWNER_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  if (!email) throw new Error('Missing USER_MAINTENANCE_EMAIL, SITE_OWNER_EMAIL, or PAYLOAD_EXPORT_EMAIL')
  const password = process.env.USER_MAINTENANCE_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!password) throw new Error('Missing USER_MAINTENANCE_PASSWORD, PAYLOAD_EXPORT_PASSWORD, or PAYLOAD_SEED_PASSWORD')
  const login = await requestJson('/api/users/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  if (!login?.token) throw new Error('Login did not return a token')
  const headers = { Authorization: `JWT ${login.token}` }
  const users = []
  let page = 1
  let totalPages = 1
  do {
    const result = await requestJson(`/api/users?limit=200&depth=0&page=${page}`, { headers })
    users.push(...(result?.docs || []))
    totalPages = Number(result?.totalPages || page)
    page += 1
  } while (page <= totalPages)
  const legacyUsers = users.filter((user) => user.role === 'reviewer' || user.role === 'trusted')
  const summary = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry_run',
    expectedConfirmation: expected,
    authenticatedAs: { id: login.user?.id, email: login.user?.email, role: login.user?.role },
    usersRead: users.length,
    candidates: legacyUsers.map((user) => ({ id: user.id, email: user.email, previousRole: user.role, nextRole: 'member' })),
    updatedCount: 0,
    blockers: [],
  }
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }
  if (confirmation !== expected) throw new Error(`Apply requires --confirm "${expected}"`)
  if (login.user?.role !== 'owner') throw new Error('Only the owner can migrate legacy roles')
  for (const user of legacyUsers) {
    await requestJson(`/api/users/${encodeURIComponent(String(user.id))}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ role: 'member' }),
    })
    summary.updatedCount += 1
  }
  summary.complete = true
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
