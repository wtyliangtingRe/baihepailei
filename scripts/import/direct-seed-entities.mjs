#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanDoc } from './direct-seed-clean-data.mjs'

export const ENTITY_COLLECTIONS = ['creators', 'organizations']

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

function usage() {
  console.log(`Usage:
  pnpm import:entities -- --file <payload_entity_seed.json> [--url http://localhost:3000] [--dry-run] [--update-existing] [--collections creators,organizations]

Required environment variables for real import:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD
`)
}

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) throw new Error(`Seed file not found: ${resolved}`)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function parseCollectionList(value) {
  if (!value || value === true) return null
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

export function collectionsForEntitySeed(seed, collectionArg) {
  const requested = parseCollectionList(collectionArg)
  const order = requested || ENTITY_COLLECTIONS.filter((collection) => Array.isArray(seed[collection]))
  const errors = []

  if (order.length === 0) errors.push(`Seed must contain at least one entity collection array: ${ENTITY_COLLECTIONS.join(', ')}`)

  for (const collection of order) {
    if (!ENTITY_COLLECTIONS.includes(collection)) errors.push(`Unsupported entity collection: ${collection}`)
    if (!Array.isArray(seed[collection])) errors.push(`Missing or invalid array: ${collection}`)
  }

  if (errors.length) throw new Error(errors.join('\n'))
  return order
}

export function entityLookupPlan(doc) {
  const lookups = []
  if (doc.siteId) lookups.push({ type: 'siteId', field: 'siteId', value: doc.siteId })
  if (doc.slug) lookups.push({ type: 'slug', field: 'slug', value: doc.slug })
  return lookups
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
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}\n${payload ? JSON.stringify(payload, null, 2) : text}`)
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

function setWhere(params, field, operator, value) {
  params.set(`where[${field}][${operator}]`, String(value))
}

async function findOne(baseUrl, token, collection, lookup) {
  const params = new URLSearchParams()
  setWhere(params, lookup.field, 'equals', lookup.value)
  params.set('limit', '1')
  const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
    headers: authHeaders(token),
  })
  return result?.docs?.[0] || null
}

async function findExistingEntity(baseUrl, token, collection, doc) {
  for (const lookup of entityLookupPlan(doc)) {
    const existing = await findOne(baseUrl, token, collection, lookup)
    if (existing) return { existing, lookup }
  }
  return { existing: null, lookup: null }
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

async function importCollection({ baseUrl, token, collection, docs, dryRun, updateExisting }) {
  const summary = { collection, total: docs.length, created: 0, updated: 0, skipped: 0, errors: 0 }
  console.log(`\n${collection}: ${docs.length}`)

  for (const raw of docs) {
    const doc = cleanDoc(collection, raw)
    const label = doc.slug || doc.name

    if (dryRun) {
      console.log(`  dry-run: ${label}`)
      continue
    }

    try {
      const { existing, lookup } = await findExistingEntity(baseUrl, token, collection, doc)
      if (existing) {
        if (updateExisting) {
          await updateDoc(baseUrl, token, collection, existing.id, doc)
          summary.updated += 1
          console.log(`  updated: ${label} (${lookup?.type || 'matched'})`)
        } else {
          summary.skipped += 1
          console.log(`  skipped existing: ${label} (${lookup?.type || 'matched'})`)
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

export async function runEntityImport(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || !args.file) {
    usage()
    return args.help ? 0 : 1
  }

  const seed = readJson(String(args.file))
  const collections = collectionsForEntitySeed(seed, args.collections || args.collection)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const dryRun = Boolean(args['dry-run'])
  const updateExisting = Boolean(args['update-existing'])

  console.log('Direct entity seed import')
  console.log(JSON.stringify({
    file: path.resolve(String(args.file)),
    url: baseUrl,
    dryRun,
    updateExisting,
    collections,
    counts: Object.fromEntries(collections.map((key) => [key, seed[key].length])),
  }, null, 2))

  if (dryRun) {
    for (const collection of collections) {
      await importCollection({ baseUrl, token: null, collection, docs: seed[collection], dryRun, updateExisting })
    }
    return 0
  }

  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Set PAYLOAD_SEED_EMAIL and PAYLOAD_SEED_PASSWORD before real import.')

  const token = await login(baseUrl, email, password)
  console.log(`Logged in to ${baseUrl}`)

  const summaries = []
  for (const collection of collections) {
    summaries.push(await importCollection({ baseUrl, token, collection, docs: seed[collection], dryRun, updateExisting }))
  }

  console.log('\nImport summary:')
  console.log(JSON.stringify(summaries, null, 2))
  return summaries.some((summary) => summary.errors > 0) ? 1 : 0
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  runEntityImport().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
