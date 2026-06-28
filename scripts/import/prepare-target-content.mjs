#!/usr/bin/env node

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

const DEFAULT_COLLECTIONS = ['comments', 'evidence', 'works', 'creators', 'organizations']
const PROTECTED_COLLECTIONS = ['rules', 'terms', 'tags', 'warnings', 'users', 'media']
const EMAIL_ENV = ['PAYLOAD', 'SEED', 'EMAIL'].join('_')
const SECRET_ENV = ['PAYLOAD', 'SEED', 'PASSWORD'].join('_')

function usage() {
  console.log(`Usage:
  pnpm import:prepare-target -- --url http://localhost:3000 --dry-run

Real run requires:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

Examples:
  pnpm import:prepare-target -- --url http://localhost:3000 --dry-run

  $env:PAYLOAD_SEED_EMAIL="you@example.com"
  $env:PAYLOAD_SEED_PASSWORD="your-password"
  pnpm import:prepare-target -- --url http://localhost:3000 --confirm-reset-content

Default affected collections:
  ${DEFAULT_COLLECTIONS.join(', ')}

Always protected collections:
  ${PROTECTED_COLLECTIONS.join(', ')}
`)
}

function parseCollectionList(value) {
  if (!value || value === true) return [...DEFAULT_COLLECTIONS]
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function planTargetCollections(collectionArg) {
  const requested = parseCollectionList(collectionArg)
  const protectedRequested = requested.filter((collection) => PROTECTED_COLLECTIONS.includes(collection))
  if (protectedRequested.length > 0) {
    throw new Error(`Protected collections cannot be prepared by this command: ${protectedRequested.join(', ')}`)
  }

  const unsupported = requested.filter((collection) => !DEFAULT_COLLECTIONS.includes(collection))
  if (unsupported.length > 0) {
    throw new Error(`Unsupported target collection: ${unsupported.join(', ')}`)
  }

  return requested
}

export function shouldRunRealPreparation(args) {
  return Boolean(args['confirm-reset-content']) && !args['dry-run']
}

export function assertRealPreparationAllowed(args) {
  if (shouldRunRealPreparation(args)) return
  throw new Error('Real target preparation requires --confirm-reset-content and must not include --dry-run.')
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

  if (!result?.token) throw new Error('Payload login succeeded but did not return a token.')
  return result.token
}

function authHeaders(token) {
  return { Authorization: `JWT ${token}` }
}

async function fetchCollectionPage({ baseUrl, token, collection, page = 1, limit = 100 }) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('page', String(page))
  params.set('depth', '0')
  return requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
    headers: authHeaders(token),
  })
}

async function fetchAllDocs({ baseUrl, token, collection }) {
  const docs = []
  let page = 1
  while (true) {
    const result = await fetchCollectionPage({ baseUrl, token, collection, page })
    docs.push(...(result?.docs || []))
    if (!result?.hasNextPage) break
    page += 1
  }
  return docs
}

async function countRules({ baseUrl, token }) {
  const result = await fetchCollectionPage({ baseUrl, token, collection: 'rules', page: 1, limit: 1 })
  return Number(result?.totalDocs || 0)
}

async function removeDoc({ baseUrl, token, collection, id }) {
  return requestJson(`${baseUrl}/api/${collection}/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
}

function docLabel(doc) {
  return doc?.slug || doc?.title || doc?.name || doc?.id || '(unknown)'
}

async function prepareCollection({ baseUrl, token, collection, dryRun }) {
  const docs = await fetchAllDocs({ baseUrl, token, collection })
  const summary = {
    collection,
    found: docs.length,
    removed: 0,
    dryRun: Boolean(dryRun),
    sample: docs.slice(0, 10).map(docLabel),
  }

  console.log(`\n${collection}: ${docs.length}`)
  if (docs.length > 0) {
    console.log(`  sample: ${summary.sample.join(', ')}`)
  }

  if (dryRun) return summary

  for (const doc of docs) {
    if (!doc?.id) throw new Error(`Cannot remove ${collection} item without id: ${docLabel(doc)}`)
    await removeDoc({ baseUrl, token, collection, id: doc.id })
    summary.removed += 1
    console.log(`  removed: ${docLabel(doc)}`)
  }

  return summary
}

export async function runPrepareTarget(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) {
    usage()
    return 0
  }

  const collections = planTargetCollections(args.collections || args.collection)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const dryRun = Boolean(args['dry-run']) || !Boolean(args['confirm-reset-content'])
  const requireRules = args['skip-rules-check'] ? false : true

  console.log('Payload target content preparation')
  console.log(JSON.stringify({
    url: baseUrl,
    dryRun,
    collections,
    protectedCollections: PROTECTED_COLLECTIONS,
    requireRules,
  }, null, 2))

  const email = process.env[EMAIL_ENV]
  const password = process.env[SECRET_ENV]
  if (!email || !password) throw new Error(`Set ${EMAIL_ENV} and ${SECRET_ENV} before running this command.`)

  if (!dryRun) assertRealPreparationAllowed(args)

  const token = await login(baseUrl, email, password)
  console.log(`Logged in to ${baseUrl}`)

  if (requireRules) {
    const rulesCount = await countRules({ baseUrl, token })
    console.log(`Protected rules count: ${rulesCount}`)
    if (rulesCount < 2) {
      throw new Error('Expected at least 2 rules before import preparation. Use --skip-rules-check only if this is intentional.')
    }
  }

  const summaries = []
  for (const collection of collections) {
    summaries.push(await prepareCollection({ baseUrl, token, collection, dryRun }))
  }

  console.log('\nPreparation summary:')
  console.log(JSON.stringify(summaries, null, 2))
  return 0
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('prepare-target-content.mjs')

if (isDirectRun) {
  runPrepareTarget().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
