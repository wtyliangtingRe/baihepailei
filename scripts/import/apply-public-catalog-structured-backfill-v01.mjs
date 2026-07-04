#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_PLAN = 'data_local/staging/public-catalog-import/public-catalog-structured-backfill-plan-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/public-catalog-import'
const DEFAULT_URL = 'http://localhost:3000'
const CONFIRM_TOKEN = 'public-catalog-structured-backfill-v01'
const PAGE_LIMIT = 100

const allowedPatchFields = new Set([
  'importBatch',
  'ratingNotice',
  'chosenBaseSource',
  'reviewReasons',
  'sourceConflictNotes',
])

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue

    const key = item.slice(2)
    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }

    args[key] = next
    index += 1
  }

  return args
}

function usage() {
  console.log(`Usage:
  node scripts/import/apply-public-catalog-structured-backfill-v01.mjs [--plan <plan.jsonl>] [--url http://localhost:3000] [--limit 10]
  node scripts/import/apply-public-catalog-structured-backfill-v01.mjs --apply --confirm ${CONFIRM_TOKEN}

Required environment variables:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

Default mode is dry-run. It does not write Payload.
Real writes require both:
  --apply
  --confirm ${CONFIRM_TOKEN}

Safety:
  - No direct PostgreSQL write.
  - No delete.
  - Only PATCH /api/works/:id for planned structured review fields.
`)
}

function readJsonl(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Plan file not found: ${resolved}`)
  }

  return fs.readFileSync(resolved, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`JSONL parse failed at ${resolved}:${index + 1}: ${error.message}`)
      }
    })
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
  return { Authorization: `JWT ${token}` }
}

function normalizeReviewReasons(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[;|,]/u)

  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))].sort()
}

function normalizeComparable(field, value) {
  if (field === 'reviewReasons') return normalizeReviewReasons(value)
  return String(value || '').trim()
}

function sameValue(field, left, right) {
  const normalizedLeft = normalizeComparable(field, left)
  const normalizedRight = normalizeComparable(field, right)

  if (Array.isArray(normalizedLeft) || Array.isArray(normalizedRight)) {
    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
  }

  return normalizedLeft === normalizedRight
}

function validatePatch(row) {
  const errors = []

  if (row.action !== 'backfill_structured_review_fields') {
    return errors
  }

  if (!row.id) {
    errors.push('missing row.id')
  }

  if (!row.patch || typeof row.patch !== 'object' || Array.isArray(row.patch)) {
    errors.push('missing row.patch')
    return errors
  }

  const patchFields = Object.keys(row.patch)
  if (!patchFields.length) {
    errors.push('empty patch')
  }

  for (const field of patchFields) {
    if (!allowedPatchFields.has(field)) {
      errors.push(`unsupported patch field: ${field}`)
    }
  }

  if ('reviewReasons' in row.patch && !Array.isArray(row.patch.reviewReasons)) {
    errors.push('reviewReasons patch must be an array')
  }

  return errors
}

function countBy(rows, getter) {
  const result = {}

  for (const row of rows) {
    const key = String(getter(row) || 'unknown')
    result[key] = (result[key] || 0) + 1
  }

  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]))
}

function selectRows(rows, { limit, siteId }) {
  let selected = rows.filter((row) => row.action === 'backfill_structured_review_fields')

  if (siteId) {
    selected = selected.filter((row) => row.siteId === siteId)
  }

  if (limit !== null && limit !== undefined) {
    selected = selected.slice(0, limit)
  }

  return selected
}

async function fetchWork(baseUrl, token, id) {
  return requestJson(`${baseUrl}/api/works/${id}?depth=0`, {
    headers: authHeaders(token),
  })
}

async function patchWork(baseUrl, token, id, patch) {
  return requestJson(`${baseUrl}/api/works/${id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  })
}

function remainingChanges(row, existing) {
  const result = {}

  for (const [field, after] of Object.entries(row.patch || {})) {
    if (!sameValue(field, existing?.[field], after)) {
      result[field] = {
        before: normalizeComparable(field, existing?.[field]),
        after: normalizeComparable(field, after),
      }
    }
  }

  return result
}

function formatMarkdown(summary, samples) {
  return [
    '# Public Catalog Structured Backfill Apply v0.1',
    '',
    '## Safety',
    '',
    `- apply: ${summary.apply}`,
    '- No direct PostgreSQL write.',
    '- No delete.',
    '- Only PATCH /api/works/:id when apply=true.',
    '',
    '## Summary',
    '',
    ...Object.entries(summary).map(([key, value]) => {
      if (typeof value === 'object') return `- ${key}: ${JSON.stringify(value)}`
      return `- ${key}: ${value}`
    }),
    '',
    '## Sample rows',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || args.h) {
    usage()
    return
  }

  const planPath = args.plan || DEFAULT_PLAN
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR
  const baseUrl = args.url || DEFAULT_URL
  const apply = Boolean(args.apply)
  const confirm = String(args.confirm || '')
  const siteId = args['site-id'] || null
  const limit = args.limit === undefined ? null : Number(args.limit)

  if (Number.isNaN(limit)) {
    throw new Error(`Invalid --limit value: ${args.limit}`)
  }

  if (apply && confirm !== CONFIRM_TOKEN) {
    throw new Error(`Real apply requires --confirm ${CONFIRM_TOKEN}`)
  }

  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD

  if (!email || !password) {
    throw new Error('Missing PAYLOAD_SEED_EMAIL or PAYLOAD_SEED_PASSWORD.')
  }

  const rows = readJsonl(planPath)
  const selectedRows = selectRows(rows, { limit, siteId })

  const validationErrors = rows.flatMap((row, index) =>
    validatePatch(row).map((message) => ({ line: index + 1, title: row.title, siteId: row.siteId, message }))
  )

  if (validationErrors.length) {
    throw new Error(`Plan validation failed:\n${JSON.stringify(validationErrors.slice(0, 20), null, 2)}`)
  }

  console.error(`[apply] mode: ${apply ? 'APPLY' : 'DRY_RUN'}`)
  console.error(`[apply] selected rows: ${selectedRows.length}`)
  console.error(`[apply] logging in to ${baseUrl} ...`)

  const token = await login(baseUrl, email, password)
  const results = []

  for (let index = 0; index < selectedRows.length; index += 1) {
    const row = selectedRows[index]

    if ((index + 1) % PAGE_LIMIT === 0 || index === 0 || index + 1 === selectedRows.length) {
      console.error(`[apply] processing ${index + 1}/${selectedRows.length}`)
    }

    const existing = await fetchWork(baseUrl, token, row.id)
    const changes = remainingChanges(row, existing)
    const changeFields = Object.keys(changes)

    if (!changeFields.length) {
      results.push({
        action: 'already_current',
        id: row.id,
        title: row.title,
        slug: row.slug,
        siteId: row.siteId,
        patch: {},
      })
      continue
    }

    if (!apply) {
      results.push({
        action: 'would_update',
        id: row.id,
        title: row.title,
        slug: row.slug,
        siteId: row.siteId,
        changes,
        patch: row.patch,
      })
      continue
    }

    await patchWork(baseUrl, token, row.id, row.patch)

    results.push({
      action: 'updated',
      id: row.id,
      title: row.title,
      slug: row.slug,
      siteId: row.siteId,
      changes,
      patch: row.patch,
    })
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    apply,
    confirm: apply ? confirm : '',
    planRows: rows.length,
    selectedRows: selectedRows.length,
    resultRows: results.length,
    byAction: countBy(results, (row) => row.action),
    byPatchField: countBy(
      results.flatMap((row) => Object.keys(row.patch || {}).map((field) => ({ field }))),
      (row) => row.field
    ),
    safety: {
      payloadWrite: apply,
      postgresqlWrite: false,
      importerApply: false,
      delete: false,
    },
  }

  const suffix = apply ? 'apply' : 'dry-run'
  const outJson = path.join(outDir, `public-catalog-structured-backfill-${suffix}-v01.json`)
  const outJsonl = path.join(outDir, `public-catalog-structured-backfill-${suffix}-v01.jsonl`)
  const outSummary = path.join(outDir, `public-catalog-structured-backfill-${suffix}-v01-summary.json`)
  const outMd = path.join(outDir, `public-catalog-structured-backfill-${suffix}-v01.md`)

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outJson, JSON.stringify({ summary, results }, null, 2), 'utf8')
  fs.writeFileSync(outJsonl, results.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(summary, results.slice(0, 20)), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    apply,
    selectedRows: summary.selectedRows,
    resultRows: summary.resultRows,
    byAction: summary.byAction,
    byPatchField: summary.byPatchField,
    safety: summary.safety,
    outputs: {
      json: outJson,
      jsonl: outJsonl,
      summary: outSummary,
      md: outMd,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
