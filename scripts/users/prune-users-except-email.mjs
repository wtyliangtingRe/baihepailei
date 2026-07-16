#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'prune-users-except-email-v0.2'
const APPLY_CONFIRMATION = 'DELETE-USERS-EXCEPT-KEEP-EMAIL'

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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8')
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
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  }
  return payload
}

async function login(baseUrl, email, password) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login did not return a token.')
  return result
}

function authenticatedHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    DisableAutologin: 'true',
  }
}

async function verifyMaintenanceIdentity(baseUrl, token, loginEmail) {
  const result = await requestJson(`${baseUrl}/api/users/me?depth=0`, {
    headers: authenticatedHeaders(token),
  })
  const user = result?.user
  if (!user) {
    throw new Error(
      'Login credentials passed, but the token did not establish a user session. '
      + 'Set SITE_OWNER_EMAIL to the retained email in .env, restart pnpm dev, and log in again. '
      + 'Older owner records may need the compatibility normalization included in the latest main branch.',
    )
  }
  if (normalizeEmail(user.email) !== loginEmail) {
    throw new Error(`Authenticated as unexpected account: ${normalizeEmail(user.email) || '(missing email)'}`)
  }
  if (String(user.role || '') !== 'owner') {
    throw new Error(
      `Authenticated account has role ${String(user.role || '(missing)')}, not owner. `
      + `Set SITE_OWNER_EMAIL=${loginEmail} in .env, restart pnpm dev, then retry.`,
    )
  }
  return user
}

async function fetchAll(baseUrl, token, slug, where = {}) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ depth: '0', limit: '200', page: String(page) })
    for (const [field, value] of Object.entries(where)) {
      params.set(`where[${field}][equals]`, String(value))
    }
    const result = await requestJson(`${baseUrl}/api/${slug}?${params}`, {
      headers: authenticatedHeaders(token),
    })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

async function buildCandidatePlan(baseUrl, token, user) {
  const [userLists, comments, submittedFeedback, reviewedFeedback, reviewedWorks] = await Promise.all([
    fetchAll(baseUrl, token, 'user-lists', { user: user.id }),
    fetchAll(baseUrl, token, 'comments', { author: user.id }),
    fetchAll(baseUrl, token, 'feedback-submissions', { submitter: user.id }),
    fetchAll(baseUrl, token, 'feedback-submissions', { reviewer: user.id }),
    fetchAll(baseUrl, token, 'works', { humanReviewedBy: user.id }),
  ])
  const submittedIDs = new Set(submittedFeedback.map((doc) => String(doc.id)))
  return {
    id: user.id,
    email: normalizeEmail(user.email),
    role: String(user.role || 'member'),
    dependencies: {
      deleteUserListIDs: userLists.map((doc) => doc.id),
      deleteCommentIDs: comments.map((doc) => doc.id),
      deleteSubmittedFeedbackIDs: submittedFeedback.map((doc) => doc.id),
      clearReviewerFeedbackIDs: reviewedFeedback
        .filter((doc) => !submittedIDs.has(String(doc.id)))
        .map((doc) => doc.id),
      clearReviewedWorkIDs: reviewedWorks.map((doc) => doc.id),
    },
  }
}

async function deleteDocument(baseUrl, token, slug, id) {
  return requestJson(`${baseUrl}/api/${slug}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  })
}

async function patchDocument(baseUrl, token, slug, id, data) {
  return requestJson(`${baseUrl}/api/${slug}/${encodeURIComponent(id)}?depth=0&draft=true`, {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(data),
  })
}

async function applyCandidate(baseUrl, token, candidate, journal) {
  const steps = [
    ...candidate.dependencies.deleteUserListIDs.map((id) => ({ action: 'delete', slug: 'user-lists', id })),
    ...candidate.dependencies.deleteCommentIDs.map((id) => ({ action: 'delete', slug: 'comments', id })),
    ...candidate.dependencies.deleteSubmittedFeedbackIDs.map((id) => ({ action: 'delete', slug: 'feedback-submissions', id })),
    ...candidate.dependencies.clearReviewerFeedbackIDs.map((id) => ({ action: 'patch', slug: 'feedback-submissions', id, data: { reviewer: null } })),
    ...candidate.dependencies.clearReviewedWorkIDs.map((id) => ({ action: 'patch', slug: 'works', id, data: { humanReviewedBy: null } })),
    { action: 'delete', slug: 'users', id: candidate.id },
  ]

  for (const step of steps) {
    appendJsonl(journal, { at: new Date().toISOString(), phase: 'intent', userId: candidate.id, ...step })
    if (step.action === 'delete') await deleteDocument(baseUrl, token, step.slug, step.id)
    else await patchDocument(baseUrl, token, step.slug, step.id, step.data)
    appendJsonl(journal, { at: new Date().toISOString(), phase: 'complete', userId: candidate.id, ...step })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = path.resolve(String(args.repo || process.cwd()))
  for (const name of ['.env', '.env.local', '.env.development.local']) {
    loadEnvFile(path.join(repoRoot, name))
  }

  const keepEmail = normalizeEmail(args['keep-email'])
  if (!keepEmail) throw new Error('Required: --keep-email <email>')
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const loginEmail = normalizeEmail(
    process.env.USER_MAINTENANCE_EMAIL
      || process.env.RADAR_PAYLOAD_EMAIL
      || process.env.PAYLOAD_EXPORT_EMAIL,
  )
  const loginPassword = String(
    process.env.USER_MAINTENANCE_PASSWORD
      || process.env.RADAR_PAYLOAD_PASSWORD
      || process.env.PAYLOAD_EXPORT_PASSWORD
      || '',
  )
  if (!loginEmail || !loginPassword) {
    throw new Error('Set USER_MAINTENANCE_EMAIL and USER_MAINTENANCE_PASSWORD in this PowerShell session.')
  }

  const apply = Boolean(args.apply)
  if (apply && String(args.confirm || '') !== APPLY_CONFIRMATION) {
    throw new Error(`Exact apply confirmation required: ${APPLY_CONFIRMATION}`)
  }
  if (apply && loginEmail !== keepEmail) {
    throw new Error('Apply requires USER_MAINTENANCE_EMAIL to equal --keep-email.')
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').replace('T', '-').replace('Z', '')
  const outDir = path.resolve(
    repoRoot,
    String(args['out-dir'] || `data_local/staging/user-maintenance/prune-users-${stamp}`),
  )
  const loginResult = await login(baseUrl, loginEmail, loginPassword)
  const token = loginResult.token
  const maintenanceUser = await verifyMaintenanceIdentity(baseUrl, token, loginEmail)
  const users = await fetchAll(baseUrl, token, 'users')
  const keepUsers = users.filter((user) => normalizeEmail(user.email) === keepEmail)
  const blockers = []
  if (keepUsers.length !== 1) blockers.push(`keep_email_matches_${keepUsers.length}`)
  if (keepUsers[0] && String(keepUsers[0].role || '') !== 'owner') blockers.push('keep_user_is_not_owner')

  const candidates = []
  for (const user of users) {
    if (normalizeEmail(user.email) === keepEmail) continue
    candidates.push(await buildCandidatePlan(baseUrl, token, user))
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry_run',
    complete: blockers.length === 0,
    authenticatedAs: {
      id: maintenanceUser.id,
      email: normalizeEmail(maintenanceUser.email),
      role: maintenanceUser.role,
    },
    keepEmail,
    keepUser: keepUsers[0]
      ? { id: keepUsers[0].id, email: normalizeEmail(keepUsers[0].email), role: keepUsers[0].role }
      : null,
    usersRead: users.length,
    candidateCount: candidates.length,
    candidates,
    blockers,
    safety: {
      payloadRead: true,
      payloadWrite: apply,
      directPostgresqlWrite: false,
      keepEmailRequired: true,
      keepUserMustBeOwner: true,
      applyConfirmation: APPLY_CONFIRMATION,
      dependentCommunityRowsHandledFirst: true,
      databaseCheckpointRequiredBeforeApply: true,
    },
  }
  writeJson(path.join(outDir, 'plan.json'), summary)
  if (blockers.length) {
    console.log(JSON.stringify({ ok: false, summary }, null, 2))
    process.exitCode = 2
    return
  }

  if (apply) {
    const journal = path.join(outDir, 'operations.jsonl')
    for (const candidate of candidates) {
      await applyCandidate(baseUrl, token, candidate, journal)
    }
    const remaining = await fetchAll(baseUrl, token, 'users')
    const finalComplete = remaining.length === 1 && normalizeEmail(remaining[0]?.email) === keepEmail
    summary.finalUsers = remaining.map((user) => ({ id: user.id, email: normalizeEmail(user.email), role: user.role }))
    summary.complete = finalComplete
    writeJson(path.join(outDir, 'summary.json'), summary)
    if (!finalComplete) process.exitCode = 2
  }

  console.log(JSON.stringify({ ok: summary.complete, summary }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
