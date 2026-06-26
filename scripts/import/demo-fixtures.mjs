#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const COLLECTION_ORDER = ['creators', 'organizations', 'works', 'evidence']
const DEFAULT_FIXTURE = 'fixtures/demo-content.json'
const EMAIL_ENV = ['PAYLOAD', 'SEED', 'EMAIL'].join('_')
const SECRET_ENV = ['PAYLOAD', 'SEED', 'PASSWORD'].join('_')

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

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) throw new Error(`Demo fixture not found: ${resolved}`)
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

function payloadDoc(payload) {
  return payload?.doc || payload
}

async function login(baseUrl, email, secret) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password: secret }),
  })

  if (!result?.token) throw new Error('Payload login succeeded but did not return a token.')
  return result.token
}

function authHeaders(token) {
  return { Authorization: `JWT ${token}` }
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
  return payloadDoc(await requestJson(`${baseUrl}/api/${collection}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(doc),
  }))
}

async function updateDoc(baseUrl, token, collection, id, doc) {
  return payloadDoc(await requestJson(`${baseUrl}/api/${collection}/${id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(doc),
  }))
}

function assertDemoSlug(collection, doc) {
  if (!doc?.slug || typeof doc.slug !== 'string') throw new Error(`${collection} item is missing slug.`)
  if (!doc.slug.startsWith('demo-')) throw new Error(`${collection} slug must start with demo-: ${doc.slug}`)
}

function validateUniqueSlugs(collection, docs) {
  const seen = new Set()
  for (const doc of docs) {
    assertDemoSlug(collection, doc)
    if (seen.has(doc.slug)) throw new Error(`Duplicate ${collection} slug: ${doc.slug}`)
    seen.add(doc.slug)
  }
}

function validateReferences(seed) {
  const creators = new Set(seed.creators.map((doc) => doc.slug))
  const organizations = new Set(seed.organizations.map((doc) => doc.slug))
  const works = new Set(seed.works.map((doc) => doc.slug))

  for (const work of seed.works) {
    for (const slug of work.creators || []) {
      if (!creators.has(slug)) throw new Error(`Unknown creator for ${work.slug}: ${slug}`)
    }
    for (const item of work.organizations || []) {
      if (!organizations.has(item.organization)) throw new Error(`Unknown organization for ${work.slug}: ${item.organization}`)
    }
  }

  for (const item of seed.evidence) {
    for (const slug of item.relatedWorks || []) {
      if (!works.has(slug)) throw new Error(`Unknown work for ${item.slug}: ${slug}`)
    }
    for (const slug of item.relatedCreators || []) {
      if (!creators.has(slug)) throw new Error(`Unknown creator for ${item.slug}: ${slug}`)
    }
    for (const slug of item.relatedOrganizations || []) {
      if (!organizations.has(slug)) throw new Error(`Unknown organization for ${item.slug}: ${slug}`)
    }
  }
}

function validateSeed(seed) {
  const errors = []
  for (const collection of COLLECTION_ORDER) {
    if (!Array.isArray(seed[collection])) errors.push(`Missing or invalid array: ${collection}`)
  }
  if (errors.length) throw new Error(errors.join('\n'))

  for (const collection of COLLECTION_ORDER) validateUniqueSlugs(collection, seed[collection])
  validateReferences(seed)
}

function stripRelationshipSlugs(collection, input) {
  const doc = { ...input }
  if (collection === 'works') {
    delete doc.creators
    delete doc.organizations
  }
  if (collection === 'evidence') {
    delete doc.relatedWorks
    delete doc.relatedCreators
    delete doc.relatedOrganizations
  }
  return doc
}

function resolveMany(slugs, lookup, label) {
  return (slugs || []).map((slug) => {
    const id = lookup.get(slug)
    if (!id) throw new Error(`Cannot resolve ${label}: ${slug}`)
    return id
  })
}

function resolveWorkDoc(input, lookup) {
  return {
    ...stripRelationshipSlugs('works', input),
    creators: resolveMany(input.creators, lookup.creators, 'creator'),
    organizations: (input.organizations || []).map((item) => {
      const organization = lookup.organizations.get(item.organization)
      if (!organization) throw new Error(`Cannot resolve organization: ${item.organization}`)
      return { organization, role: item.role || 'other', note: item.note }
    }),
  }
}

function resolveEvidenceDoc(input, lookup) {
  return {
    ...stripRelationshipSlugs('evidence', input),
    relatedWorks: resolveMany(input.relatedWorks, lookup.works, 'work'),
    relatedCreators: resolveMany(input.relatedCreators, lookup.creators, 'creator'),
    relatedOrganizations: resolveMany(input.relatedOrganizations, lookup.organizations, 'organization'),
  }
}

function resolveDoc(collection, input, lookup) {
  if (collection === 'works') return resolveWorkDoc(input, lookup)
  if (collection === 'evidence') return resolveEvidenceDoc(input, lookup)
  return stripRelationshipSlugs(collection, input)
}

async function upsertDoc({ baseUrl, token, collection, doc, updateExisting }) {
  const existing = await findExistingBySlug(baseUrl, token, collection, doc.slug)
  if (existing) {
    if (!updateExisting) return { action: 'skipped', doc: existing }
    return { action: 'updated', doc: await updateDoc(baseUrl, token, collection, existing.id, doc) }
  }
  return { action: 'created', doc: await createDoc(baseUrl, token, collection, doc) }
}

function requireDocId(collection, slug, doc) {
  const id = doc?.id
  if (!id) throw new Error(`Imported ${collection} did not return an id: ${slug}`)
  return id
}

async function importCollection({ baseUrl, token, collection, docs, lookup, updateExisting }) {
  const summary = { collection, total: docs.length, created: 0, updated: 0, skipped: 0, errors: 0 }
  console.log(`\n${collection}: ${docs.length}`)

  for (const raw of docs) {
    const label = raw.slug || raw.title || raw.name
    try {
      const doc = resolveDoc(collection, raw, lookup)
      const result = await upsertDoc({ baseUrl, token, collection, doc, updateExisting })
      summary[result.action] += 1
      lookup[collection].set(raw.slug, requireDocId(collection, raw.slug, result.doc))
      console.log(`  ${result.action}: ${label}`)
    } catch (error) {
      summary.errors += 1
      console.warn(`  error: ${label}`)
      console.warn(String(error?.message || error))
    }
  }

  return summary
}

async function preloadExistingLookup({ baseUrl, token, seed, lookup }) {
  for (const collection of ['creators', 'organizations', 'works']) {
    for (const doc of seed[collection] || []) {
      const existing = await findExistingBySlug(baseUrl, token, collection, doc.slug)
      if (existing?.id) lookup[collection].set(doc.slug, existing.id)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const fixtureFile = String(args.file || DEFAULT_FIXTURE)
  const seed = readJson(fixtureFile)
  validateSeed(seed)

  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const dryRun = Boolean(args['dry-run'])
  const updateExisting = Boolean(args['update-existing'])

  console.log('Demo fixture import')
  console.log(JSON.stringify({
    file: path.resolve(fixtureFile),
    url: baseUrl,
    dryRun,
    updateExisting,
    counts: Object.fromEntries(COLLECTION_ORDER.map((key) => [key, seed[key].length])),
  }, null, 2))

  if (dryRun) {
    for (const collection of COLLECTION_ORDER) {
      for (const doc of seed[collection]) console.log(`  dry-run ${collection}: ${doc.slug}`)
    }
    return
  }

  const email = process.env[EMAIL_ENV]
  const secret = process.env[SECRET_ENV]
  if (!email || !secret) throw new Error(`Set ${EMAIL_ENV} and ${SECRET_ENV} before real import.`)

  const token = await login(baseUrl, email, secret)
  console.log(`Logged in to ${baseUrl}`)

  const lookup = { creators: new Map(), organizations: new Map(), works: new Map(), evidence: new Map() }
  await preloadExistingLookup({ baseUrl, token, seed, lookup })

  const summaries = []
  for (const collection of COLLECTION_ORDER) {
    summaries.push(await importCollection({ baseUrl, token, collection, docs: seed[collection], lookup, updateExisting }))
  }

  console.log('\nImport summary:')
  console.log(JSON.stringify(summaries, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
