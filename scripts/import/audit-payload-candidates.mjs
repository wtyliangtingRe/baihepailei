#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_EXPECTED_WORKS = 968
const DEFAULT_EXPECTED_RULES = 2
const PAGE_LIMIT = 100

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue

    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function usage() {
  console.log(`Usage:
  node scripts/import/audit-payload-candidates.mjs [--url http://localhost:3000] [--expected-works 968] [--expected-rules 2]

Required environment variables:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

This is a read-only audit. It checks candidate works remain draft/hidden and reports Bangumi enrichment coverage.
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

async function fetchCollectionDocs({ baseUrl, token, collection, limit = PAGE_LIMIT }) {
  const docs = []
  let page = 1
  let totalDocs = null
  let totalPages = null

  while (totalPages === null || page <= totalPages) {
    const result = await requestJson(`${baseUrl}/api/${collection}?limit=${limit}&page=${page}&depth=0`, {
      headers: authHeaders(token),
    })

    totalDocs = Number(result.totalDocs || 0)
    totalPages = Number(result.totalPages || 1)
    docs.push(...(Array.isArray(result.docs) ? result.docs : []))
    page += 1
  }

  return { totalDocs, docs }
}

function countWhere(items, predicate) {
  return items.filter(predicate).length
}

function nonEmpty(value) {
  return String(value || '').trim().length > 0
}

function duplicateValues(values) {
  const counts = new Map()
  for (const value of values.filter(nonEmpty)) {
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }))
}

function bangumiSubjectId(work) {
  return String(work?.externalIds?.bangumiSubjectId || '').trim()
}

export function auditPayloadCandidateData({ works, rulesTotal, expectedWorks = DEFAULT_EXPECTED_WORKS, expectedRules = DEFAULT_EXPECTED_RULES }) {
  const bangumiIds = works.map(bangumiSubjectId).filter(Boolean)
  const slugs = works.map((work) => String(work.slug || '').trim()).filter(Boolean)
  const duplicateBangumiIds = duplicateValues(bangumiIds)
  const duplicateSlugs = duplicateValues(slugs)
  const publishedOrVisible = works.filter((work) => work.status !== 'draft' || work.isLiteVisible !== false || work.isFullVisible !== false)
  const evidenceNoteCount = countWhere(works, (work) => nonEmpty(work.evidenceNote))
  const summaryHintCount = countWhere(works, (work) => String(work.evidenceNote || '').includes('Bangumi 简介候选'))
  const creatorHintCount = countWhere(works, (work) => String(work.evidenceNote || '').includes('Bangumi 创作者职位候选'))
  const organizationHintCount = countWhere(works, (work) => String(work.evidenceNote || '').includes('Bangumi 机构/制作候选'))
  const sourceBangumiCount = countWhere(works, (work) => Array.isArray(work.candidateSources) && work.candidateSources.some((source) => source?.source === 'bangumi'))

  const checks = [
    { name: 'expected works total', ok: works.length === expectedWorks, actual: works.length, expected: expectedWorks },
    { name: 'expected rules total', ok: rulesTotal === expectedRules, actual: rulesTotal, expected: expectedRules },
    { name: 'all works are draft', ok: countWhere(works, (work) => work.status === 'draft') === works.length, actual: countWhere(works, (work) => work.status === 'draft'), expected: works.length },
    { name: 'all works are Lite hidden', ok: countWhere(works, (work) => work.isLiteVisible === false) === works.length, actual: countWhere(works, (work) => work.isLiteVisible === false), expected: works.length },
    { name: 'all works are Full hidden', ok: countWhere(works, (work) => work.isFullVisible === false) === works.length, actual: countWhere(works, (work) => work.isFullVisible === false), expected: works.length },
    { name: 'Bangumi IDs are complete', ok: bangumiIds.length === works.length, actual: bangumiIds.length, expected: works.length },
    { name: 'Bangumi IDs are unique', ok: duplicateBangumiIds.length === 0, actual: duplicateBangumiIds.length, expected: 0 },
    { name: 'slugs are unique', ok: duplicateSlugs.length === 0, actual: duplicateSlugs.length, expected: 0 },
    { name: 'all works keep Bangumi candidate source', ok: sourceBangumiCount === works.length, actual: sourceBangumiCount, expected: works.length },
    { name: 'no published or visible works', ok: publishedOrVisible.length === 0, actual: publishedOrVisible.length, expected: 0 },
  ]

  return {
    summary: {
      worksTotal: works.length,
      rulesTotal,
      draft: countWhere(works, (work) => work.status === 'draft'),
      liteHidden: countWhere(works, (work) => work.isLiteVisible === false),
      fullHidden: countWhere(works, (work) => work.isFullVisible === false),
      evidenceNote: evidenceNoteCount,
      summaryHint: summaryHintCount,
      creatorHint: creatorHintCount,
      organizationHint: organizationHintCount,
      bangumiIds: bangumiIds.length,
      duplicateBangumiIds: duplicateBangumiIds.length,
      duplicateSlugs: duplicateSlugs.length,
    },
    checks,
    samples: {
      publishedOrVisible: publishedOrVisible.slice(0, 10).map((work) => ({ title: work.title, slug: work.slug, status: work.status, isLiteVisible: work.isLiteVisible, isFullVisible: work.isFullVisible })),
      duplicateBangumiIds: duplicateBangumiIds.slice(0, 10),
      duplicateSlugs: duplicateSlugs.slice(0, 10),
      enrichedWork: works.find((work) => nonEmpty(work.evidenceNote)) || null,
    },
  }
}

function formatCheck(check) {
  const icon = check.ok ? 'PASS' : 'FAIL'
  return `${icon} ${check.name}: ${check.actual} / ${check.expected}`
}

function formatAuditReport(audit) {
  const lines = [
    'Payload candidate audit',
    '',
    'Summary:',
    ...Object.entries(audit.summary).map(([key, value]) => `  ${key}: ${value}`),
    '',
    'Checks:',
    ...audit.checks.map(formatCheck),
  ]

  if (audit.samples.enrichedWork) {
    lines.push('', 'Sample enriched work:')
    lines.push(`  title: ${audit.samples.enrichedWork.title || ''}`)
    lines.push(`  slug: ${audit.samples.enrichedWork.slug || ''}`)
    lines.push(`  evidenceNote: ${String(audit.samples.enrichedWork.evidenceNote || '').slice(0, 240).replace(/\n/gu, ' / ')}`)
  }

  if (audit.samples.publishedOrVisible.length > 0) {
    lines.push('', 'Published or visible samples:')
    for (const sample of audit.samples.publishedOrVisible) {
      lines.push(`  ${sample.slug}: status=${sample.status} lite=${sample.isLiteVisible} full=${sample.isFullVisible}`)
    }
  }

  if (audit.samples.duplicateBangumiIds.length > 0) {
    lines.push('', 'Duplicate Bangumi ID samples:')
    for (const sample of audit.samples.duplicateBangumiIds) {
      lines.push(`  ${sample.value}: ${sample.count}`)
    }
  }

  if (audit.samples.duplicateSlugs.length > 0) {
    lines.push('', 'Duplicate slug samples:')
    for (const sample of audit.samples.duplicateSlugs) {
      lines.push(`  ${sample.value}: ${sample.count}`)
    }
  }

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return 0
  }

  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const expectedWorks = Number(args['expected-works'] || DEFAULT_EXPECTED_WORKS)
  const expectedRules = Number(args['expected-rules'] || DEFAULT_EXPECTED_RULES)
  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD

  if (!email || !password) {
    throw new Error('Set PAYLOAD_SEED_EMAIL and PAYLOAD_SEED_PASSWORD before audit.')
  }

  const token = await login(baseUrl, email, password)
  const worksResult = await fetchCollectionDocs({ baseUrl, token, collection: 'works' })
  const rulesResult = await fetchCollectionDocs({ baseUrl, token, collection: 'rules', limit: 1 })
  const audit = auditPayloadCandidateData({
    works: worksResult.docs,
    rulesTotal: rulesResult.totalDocs,
    expectedWorks,
    expectedRules,
  })

  console.log(formatAuditReport(audit))

  const failed = audit.checks.filter((check) => !check.ok)
  if (failed.length > 0) {
    console.error(`\nAudit failed: ${failed.length} check(s) failed.`)
    return 1
  }

  console.log('\nAudit passed.')
  return 0
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
