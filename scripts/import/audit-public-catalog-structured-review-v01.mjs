#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_URL = 'http://localhost:3000'
const DEFAULT_OUT_DIR = 'data_local/staging/public-catalog-import'
const PAGE_FILE = 'src/app/(frontend)/me/review/public-catalog/page.tsx'
const PAGE_LIMIT = 100

const EXPECTED = {
  totalWorks: 1241,
  publicCatalog: 1241,
  structuredQueue: 50,
  missingImportBatch: 0,
  missingRatingNotice: 0,
  missingChosenBaseSource: 0,
  byReason: {
    radar_seed_attached: 46,
    multi_source_or_variant: 4,
    source_conflict: 2,
  },
  byRatingNotice: {
    insufficient_information: 1194,
    ai_synthesized_pending_review: 47,
  },
  byChosenBaseSource: {
    mangadex: 993,
    steam: 164,
    yurizukan: 84,
  },
}

const formerlyOverrideSiteIds = [
  'work:mgv2-00326-身为女性向游戏的女主角挑战最强生存剧',
  'work:mgv2-00413-我亲爱的法医小姐',
]

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
  node scripts/import/audit-public-catalog-structured-review-v01.mjs [--url http://localhost:3000] [--out-dir <dir>]

Required environment variables:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

This is a read-only QA audit:
  - Reads Payload works through the HTTP API.
  - Checks Public Catalog structured review field coverage.
  - Checks review queue reason counts.
  - Checks the former hard-coded override rows are now represented by reviewReasons.
  - Checks the review page no longer contains the temporary override tokens.

Safety:
  - No Payload write.
  - No PostgreSQL write.
  - No importer apply.
  - No delete.
`)
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

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0

  while (page <= totalPages) {
    const result = await requestJson(`${baseUrl}/api/works?limit=${PAGE_LIMIT}&page=${page}&depth=0`, {
      headers: authHeaders(token),
    })

    totalPages = Number(result.totalPages || 1)
    totalDocs = Number(result.totalDocs || 0)
    docs.push(...(Array.isArray(result.docs) ? result.docs : []))
    page += 1
  }

  return { totalDocs, docs }
}

function asText(value) {
  return String(value || '').trim()
}

function reviewReasons(work) {
  const value = work?.reviewReasons

  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[;|,]/u)

  return [...new Set(values.map(asText).filter(Boolean))].sort()
}

function inc(map, key) {
  const normalized = String(key || 'missing')
  map[normalized] = (map[normalized] || 0) + 1
}

function sortCountObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  }))
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function checkEquals(name, actual, expected) {
  return {
    name,
    ok: sameJson(actual, expected),
    actual,
    expected,
  }
}

function checkBoolean(name, ok, detail = {}) {
  return {
    name,
    ok: Boolean(ok),
    ...detail,
  }
}

function readPageOverrideAudit() {
  const resolved = path.resolve(PAGE_FILE)

  if (!fs.existsSync(resolved)) {
    return {
      file: PAGE_FILE,
      exists: false,
      forbiddenTokens: ['page file missing'],
    }
  }

  const text = fs.readFileSync(resolved, 'utf8')
  const forbiddenTokens = [
    'v02ReviewQueueSiteIdOverrides',
    'work:mgv2-00326-身为女性向游戏的女主角挑战最强生存剧',
    'work:mgv2-00413-我亲爱的法医小姐',
  ].filter((token) => text.includes(token))

  return {
    file: PAGE_FILE,
    exists: true,
    forbiddenTokens,
  }
}

function formatMarkdown(report) {
  const lines = [
    '# Public Catalog Structured Review Audit v0.1',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer apply.',
    '- No delete.',
    '',
    '## Summary',
    '',
    ...Object.entries(report.summary).map(([key, value]) => {
      if (typeof value === 'object') return `- ${key}: ${JSON.stringify(value)}`
      return `- ${key}: ${value}`
    }),
    '',
    '## Checks',
    '',
    '| Check | Status | Actual | Expected |',
    '|---|---:|---|---|',
    ...report.checks.map((check) => {
      const actual = check.actual === undefined ? '' : JSON.stringify(check.actual)
      const expected = check.expected === undefined ? '' : JSON.stringify(check.expected)
      return `| ${check.name} | ${check.ok ? 'PASS' : 'FAIL'} | ${actual} | ${expected} |`
    }),
    '',
    '## Former override rows',
    '',
    '```json',
    JSON.stringify(report.formerlyOverrideRows, null, 2),
    '```',
    '',
    '## Samples',
    '',
    '```json',
    JSON.stringify(report.samples, null, 2),
    '```',
    '',
  ]

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || args.h) {
    usage()
    return
  }

  const baseUrl = args.url || DEFAULT_URL
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR
  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD

  if (!email || !password) {
    throw new Error('Missing PAYLOAD_SEED_EMAIL or PAYLOAD_SEED_PASSWORD.')
  }

  console.error(`[audit] logging in to ${baseUrl} ...`)
  const token = await login(baseUrl, email, password)

  console.error('[audit] fetching works from Payload ...')
  const { totalDocs, docs: allWorks } = await fetchAllWorks(baseUrl, token)

  const publicCatalog = allWorks.filter((work) => asText(work.importBatch).startsWith('public-catalog-import'))
  const structuredQueue = publicCatalog.filter((work) => reviewReasons(work).length > 0 || asText(work.sourceConflictNotes))

  const byReason = {}
  const byRatingNotice = {}
  const byChosenBaseSource = {}

  for (const work of publicCatalog) {
    inc(byRatingNotice, work.ratingNotice || 'missing')
    inc(byChosenBaseSource, work.chosenBaseSource || 'missing')

    for (const reason of reviewReasons(work)) {
      inc(byReason, reason)
    }
  }

  const formerlyOverrideRows = formerlyOverrideSiteIds.map((siteId) => {
    const work = publicCatalog.find((item) => item.siteId === siteId) || null

    return {
      expectedSiteId: siteId,
      found: Boolean(work),
      id: work?.id || null,
      title: work?.title || '',
      siteId: work?.siteId || '',
      reviewReasons: reviewReasons(work),
      sourceConflictNotes: work?.sourceConflictNotes || '',
      ratingNotice: work?.ratingNotice || '',
      chosenBaseSource: work?.chosenBaseSource || '',
    }
  })

  const pageOverrideAudit = readPageOverrideAudit()

  const summary = {
    generatedAt: new Date().toISOString(),
    totalDocs,
    totalWorks: allWorks.length,
    publicCatalog: publicCatalog.length,
    structuredQueue: structuredQueue.length,
    missingImportBatch: allWorks.filter((work) => !asText(work.importBatch)).length,
    missingRatingNotice: publicCatalog.filter((work) => !asText(work.ratingNotice)).length,
    missingChosenBaseSource: publicCatalog.filter((work) => !asText(work.chosenBaseSource)).length,
    byReason: sortCountObject(byReason),
    byRatingNotice: sortCountObject(byRatingNotice),
    byChosenBaseSource: sortCountObject(byChosenBaseSource),
    pageOverrideForbiddenTokens: pageOverrideAudit.forbiddenTokens.length,
    safety: {
      payloadWrite: false,
      postgresqlWrite: false,
      importerApply: false,
      delete: false,
    },
  }

  const checks = [
    checkEquals('total works', summary.totalWorks, EXPECTED.totalWorks),
    checkEquals('public catalog works', summary.publicCatalog, EXPECTED.publicCatalog),
    checkEquals('structured review queue', summary.structuredQueue, EXPECTED.structuredQueue),
    checkEquals('missing importBatch', summary.missingImportBatch, EXPECTED.missingImportBatch),
    checkEquals('missing ratingNotice', summary.missingRatingNotice, EXPECTED.missingRatingNotice),
    checkEquals('missing chosenBaseSource', summary.missingChosenBaseSource, EXPECTED.missingChosenBaseSource),
    checkEquals('by reason', summary.byReason, EXPECTED.byReason),
    checkEquals('by ratingNotice', summary.byRatingNotice, EXPECTED.byRatingNotice),
    checkEquals('by chosenBaseSource', summary.byChosenBaseSource, EXPECTED.byChosenBaseSource),
    checkEquals('page override forbidden tokens', pageOverrideAudit.forbiddenTokens, []),
    ...formerlyOverrideRows.map((row) =>
      checkBoolean(
        `former override row has structured reason: ${row.expectedSiteId}`,
        row.found && row.reviewReasons.includes('multi_source_or_variant'),
        { actual: row, expected: { found: true, includesReason: 'multi_source_or_variant' } }
      )
    ),
  ]

  const report = {
    ok: checks.every((check) => check.ok),
    summary,
    checks,
    pageOverrideAudit,
    formerlyOverrideRows,
    samples: {
      structuredQueue: structuredQueue.slice(0, 10).map((work) => ({
        id: work.id,
        title: work.title,
        siteId: work.siteId,
        ratingNotice: work.ratingNotice,
        chosenBaseSource: work.chosenBaseSource,
        reviewReasons: reviewReasons(work),
        sourceConflictNotes: work.sourceConflictNotes || '',
      })),
    },
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJson = path.join(outDir, 'public-catalog-structured-review-audit-v01.json')
  const outSummary = path.join(outDir, 'public-catalog-structured-review-audit-v01-summary.json')
  const outMd = path.join(outDir, 'public-catalog-structured-review-audit-v01.md')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(report.summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  console.log(JSON.stringify({
    ok: report.ok,
    summary: report.summary,
    failedChecks: checks.filter((check) => !check.ok),
    outputs: {
      json: outJson,
      summary: outSummary,
      md: outMd,
    },
  }, null, 2))

  if (!report.ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
