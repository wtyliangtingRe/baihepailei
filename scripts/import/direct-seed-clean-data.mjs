#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const COLLECTION_ORDER = ['rules', 'terms', 'creators', 'works']

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
  pnpm import:clean-seed -- --file <payload_seed_direct_v2_clean.json> [--url http://localhost:3000] [--dry-run] [--update-existing]

Required environment variables for real import:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

Examples:
  pnpm import:clean-seed -- --file "D:\\0GitHubtest\\Baihepailei\\_clean_real_data\\payload_seed_direct_v2_clean.json" --dry-run

  $env:PAYLOAD_SEED_EMAIL="you@example.com"
  $env:PAYLOAD_SEED_PASSWORD="your-password"
  pnpm import:clean-seed -- --file "D:\\0GitHubtest\\Baihepailei\\_clean_real_data\\payload_seed_direct_v2_clean.json" --url "http://localhost:3000"
`)
}

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Seed file not found: ${resolved}`)
  }
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

async function login(baseUrl, email, password) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  if (!result?.token) {
    throw new Error('Payload login succeeded but did not return a token.')
  }
  return result.token
}

function authHeaders(token) {
  return {
    Authorization: `JWT ${token}`,
  }
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

function cleanDoc(collection, input) {
  const doc = { ...input }

  // Keep this first import simple and direct. Relationship resolution and media uploads
  // will be handled later after all base documents exist.
  delete doc.creators
  delete doc.tags
  delete doc.warnings
  delete doc.relatedTerms
  delete doc.relatedWarnings
  delete doc.relatedTags
  delete doc.examples
  delete doc.cover
  delete doc.profileImage

  if (collection === 'rules') {
    return {
      title: doc.title,
      slug: doc.slug,
      category: doc.category || 'principle',
      body: doc.body,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  if (collection === 'terms') {
    return {
      name: doc.name,
      slug: doc.slug,
      definition: doc.definition,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  if (collection === 'creators') {
    return {
      name: doc.name,
      slug: doc.slug,
      rank: doc.rank || 'unknown',
      notes: doc.notes,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  if (collection === 'works') {
    return {
      title: doc.title,
      slug: doc.slug,
      rank: doc.rank || 'unknown',
      originalTitle: doc.originalTitle,
      aliases: doc.aliases,
      summary: doc.summary,
      analysis: doc.analysis,
      sourceLinks: doc.sourceLinks,
      legacyXWikiPage: doc.legacyXWikiPage,
      status: doc.status || 'draft',
    }
  }

  return doc
}

function validateSeed(seed) {
  const errors = []
  for (const collection of COLLECTION_ORDER) {
    if (!Array.isArray(seed[collection])) {
      errors.push(`Missing or invalid array: ${collection}`)
    }
  }
  if (errors.length) {
    throw new Error(errors.join('\n'))
  }
}

async function importCollection({ baseUrl, token, collection, docs, dryRun, updateExisting }) {
  const summary = {
    collection,
    total: docs.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  }

  console.log(`\n${collection}: ${docs.length}`)

  for (const raw of docs) {
    const doc = cleanDoc(collection, raw)
    const label = doc.slug || doc.title || doc.name

    if (dryRun) {
      console.log(`  dry-run: ${label}`)
      continue
    }

    try {
      const existing = await findExistingBySlug(baseUrl, token, collection, doc.slug)
      if (existing) {
        if (updateExisting) {
          await updateDoc(baseUrl, token, collection, existing.id, doc)
          summary.updated += 1
          console.log(`  updated: ${label}`)
        } else {
          summary.skipped += 1
          console.log(`  skipped existing: ${label}`)
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.file) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const seed = readJson(String(args.file))
  validateSeed(seed)

  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const dryRun = Boolean(args['dry-run'])
  const updateExisting = Boolean(args['update-existing'])

  console.log('Direct clean seed import')
  console.log(JSON.stringify({
    file: path.resolve(String(args.file)),
    url: baseUrl,
    dryRun,
    updateExisting,
    counts: Object.fromEntries(COLLECTION_ORDER.map((key) => [key, seed[key].length])),
  }, null, 2))

  if (dryRun) {
    for (const collection of COLLECTION_ORDER) {
      await importCollection({
        baseUrl,
        token: null,
        collection,
        docs: seed[collection],
        dryRun,
        updateExisting,
      })
    }
    return
  }

  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) {
    throw new Error('Set PAYLOAD_SEED_EMAIL and PAYLOAD_SEED_PASSWORD before real import.')
  }

  const token = await login(baseUrl, email, password)
  console.log(`Logged in to ${baseUrl}`)

  const summaries = []
  for (const collection of COLLECTION_ORDER) {
    summaries.push(await importCollection({
      baseUrl,
      token,
      collection,
      docs: seed[collection],
      dryRun,
      updateExisting,
    }))
  }

  console.log('\nImport summary:')
  console.log(JSON.stringify(summaries, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
