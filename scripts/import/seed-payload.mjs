#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function usage() {
  console.log(`Usage:
  node scripts/import/seed-payload.mjs --file <staged-json> [--url http://localhost:3000] [--dry-run]

Environment variables:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD
`)
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!response.ok) {
    const detail = json ? JSON.stringify(json, null, 2) : text
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${detail}`)
  }

  return json
}

async function login(baseUrl, email, password) {
  const result = await request(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  const token = result?.token
  if (!token) {
    throw new Error('Login response did not include a token.')
  }
  return token
}

async function createDoc(baseUrl, token, collection, doc) {
  return request(`${baseUrl}/api/${collection}`, {
    method: 'POST',
    headers: {
      Authorization: `JWT ${token}`,
    },
    body: JSON.stringify(doc),
  })
}

function minimalDocFor(collection, doc) {
  // Keep relationships out of the first import pass. Relationship resolution should happen
  // in a later pass after all documents exist and have stable IDs.
  const clone = { ...doc }
  delete clone.creators
  delete clone.tags
  delete clone.warnings
  delete clone.relatedTerms
  delete clone.relatedWarnings
  delete clone.relatedTags
  delete clone.examples
  delete clone.cover
  delete clone.profileImage
  delete clone.legacy

  if (collection === 'works') {
    return {
      title: clone.title,
      slug: clone.slug,
      rank: clone.rank || 'unknown',
      summary: clone.summary,
      analysis: clone.analysis,
      legacyXWikiPage: clone.legacyXWikiPage,
      status: clone.status || 'draft',
    }
  }

  if (collection === 'creators') {
    return {
      name: clone.name,
      slug: clone.slug,
      rank: clone.rank || 'unknown',
      notes: clone.notes,
      legacyXWikiPage: clone.legacyXWikiPage,
      status: clone.status || 'draft',
    }
  }

  if (collection === 'terms') {
    return {
      name: clone.name,
      slug: clone.slug,
      definition: clone.definition,
      legacyXWikiPage: clone.legacyXWikiPage,
      status: clone.status || 'draft',
    }
  }

  if (collection === 'rules') {
    return {
      title: clone.title,
      slug: clone.slug,
      category: clone.category || 'principle',
      body: clone.body,
      legacyXWikiPage: clone.legacyXWikiPage,
      status: clone.status || 'draft',
    }
  }

  return clone
}

async function importCollection({ baseUrl, token, collection, items, dryRun }) {
  console.log(`\n${collection}: ${items.length}`)
  let created = 0

  for (const item of items) {
    const doc = minimalDocFor(collection, item)
    if (dryRun) {
      console.log(`  dry-run: ${doc.slug || doc.title || doc.name}`)
      continue
    }

    try {
      await createDoc(baseUrl, token, collection, doc)
      created += 1
      console.log(`  created: ${doc.slug || doc.title || doc.name}`)
    } catch (error) {
      console.warn(`  skipped/error: ${doc.slug || doc.title || doc.name}`)
      console.warn(String(error.message || error))
    }
  }

  return created
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.file) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const filePath = path.resolve(String(args.file))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const dryRun = Boolean(args['dry-run'])

  if (!fs.existsSync(filePath)) {
    throw new Error(`Staged JSON not found: ${filePath}`)
  }

  const staged = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const collections = ['tags', 'warnings', 'creators', 'terms', 'rules', 'works']

  if (dryRun) {
    console.log('Dry run only. No Payload documents will be created.')
    for (const collection of collections) {
      console.log(`${collection}: ${(staged[collection] || []).length}`)
    }
    return
  }

  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) {
    throw new Error('Set PAYLOAD_SEED_EMAIL and PAYLOAD_SEED_PASSWORD before importing.')
  }

  const token = await login(baseUrl, email, password)
  console.log(`Logged in to ${baseUrl}`)

  const summary = {}
  for (const collection of collections) {
    summary[collection] = await importCollection({
      baseUrl,
      token,
      collection,
      items: staged[collection] || [],
      dryRun,
    })
  }

  console.log('\nImport summary:')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
