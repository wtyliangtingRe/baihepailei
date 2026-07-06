#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-supplement-lite-hide-verify-v01-verified.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-public-visibility-verify-v0.1'
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')

function val(value) {
  return String(value ?? '').trim()
}

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

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    read += 1
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
  }
  return { rows, read, failed }
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
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0

  do {
    const params = new URLSearchParams()
    params.set('limit', String(PAGE_LIMIT))
    params.set('page', String(page))
    params.set('depth', '0')
    params.set('draft', 'true')

    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, {
      headers: authHeaders(token),
    })

    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    totalDocs = Number(result?.totalDocs || docs.length)
    page += 1
  } while (page <= totalPages)

  return { docs, totalDocs }
}

function indexBy(docs, field) {
  const out = new Map()
  for (const doc of docs) {
    const key = val(doc[field])
    if (key) out.set(key, doc)
  }
  return out
}

function normalizeUrl(value) {
  return val(value).replace(/\/$/u, '')
}

function sourceOf(doc) {
  const first = Array.isArray(doc?.candidateSources) ? doc.candidateSources[0] : null
  return val(first?.source || first?.label || doc?.originalSource || 'unknown').toLowerCase() || 'unknown'
}

function sourceLinkUrls(doc) {
  return new Set((Array.isArray(doc?.sourceLinks) ? doc.sourceLinks : [])
    .map((item) => normalizeUrl(typeof item === 'string' ? item : item?.url))
    .filter(Boolean))
}

function candidateSourceKeys(doc) {
  return new Set((Array.isArray(doc?.candidateSources) ? doc.candidateSources : [])
    .map((item) => [val(item?.source), val(item?.externalId), normalizeUrl(item?.url)].join('|'))
    .filter((key) => key !== '||'))
}

function masterHasAnilistSource(master, row) {
  if (!master) return false
  const supplement = row.supplement || {}
  const anilistId = val(String(supplement.siteId || '').replace(/^catalog-anilist-/u, ''))
  if (anilistId && val(master.externalIds?.anilistMediaId) === anilistId) return true
  const sourceKeys = [...candidateSourceKeys(master)]
  if (sourceKeys.some((key) => key.startsWith('anilist|'))) return true
  const urls = [...sourceLinkUrls(master)]
  return urls.some((url) => url.toLowerCase().includes('anilist'))
}

function verifyGroup(row, docsById) {
  const blockers = []
  const warnings = []
  const master = docsById.get(val(row.master?.id))
  const supplement = docsById.get(val(row.supplement?.id))
  const groupDocs = [master, supplement].filter(Boolean)
  const liteVisibleCount = groupDocs.filter((doc) => doc.isLiteVisible === true).length
  const fullVisibleCount = groupDocs.filter((doc) => doc.isFullVisible === true).length

  if (!master) blockers.push('master_not_found')
  if (!supplement) blockers.push('supplement_not_found')
  if (master && sourceOf(master) !== 'bangumi') blockers.push('master_source_not_bangumi')
  if (supplement && sourceOf(supplement) !== 'anilist') blockers.push('supplement_source_not_anilist')
  if (supplement && supplement.isLiteVisible !== false) blockers.push('supplement_lite_visible_not_false')
  if (supplement && supplement.isFullVisible !== false) blockers.push('supplement_full_visible_not_false')
  if (liteVisibleCount > 1) blockers.push('group_has_multiple_lite_visible_docs')
  if (fullVisibleCount > 1) blockers.push('group_has_multiple_full_visible_docs')
  if (!masterHasAnilistSource(master, row)) blockers.push('master_missing_anilist_source')
  if (master && master.isLiteVisible !== true) warnings.push('master_not_lite_visible')
  if (master && master.isFullVisible !== true) warnings.push('master_not_full_visible')

  return {
    mergeGroupId: val(row.mergeGroupId),
    verificationStatus: blockers.length ? 'blocked' : 'verified',
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    liteVisibleCount,
    fullVisibleCount,
    master: {
      id: val(master?.id || row.master?.id),
      title: val(master?.title || row.master?.title),
      siteId: val(master?.siteId || row.master?.siteId),
      source: sourceOf(master || row.master),
      isLiteVisible: master?.isLiteVisible ?? null,
      isFullVisible: master?.isFullVisible ?? null,
      hasAnilistSource: masterHasAnilistSource(master, row),
    },
    supplement: {
      id: val(supplement?.id || row.supplement?.id),
      title: val(supplement?.title || row.supplement?.title),
      siteId: val(supplement?.siteId || row.supplement?.siteId),
      source: sourceOf(supplement || row.supplement),
      isLiteVisible: supplement?.isLiteVisible ?? null,
      isFullVisible: supplement?.isFullVisible ?? null,
      status: supplement?.status ?? null,
      reviewStatus: supplement?.reviewStatus ?? null,
    },
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function countVisibility(docs) {
  return {
    totalWorks: docs.length,
    liteVisibleWorks: docs.filter((doc) => doc.isLiteVisible === true).length,
    fullVisibleWorks: docs.filter((doc) => doc.isFullVisible === true).length,
    liteHiddenWorks: docs.filter((doc) => doc.isLiteVisible === false).length,
    fullHiddenWorks: docs.filter((doc) => doc.isFullVisible === false).length,
  }
}

function markdown(summary, samples) {
  return [
    '# Work Merge Public Visibility Verification v0.1',
    '',
    'Read-only visibility-level verification after strict-safe master field merge and supplement lite visibility update.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- worksRead: ${summary.worksRead}`,
    `- verifiedGroups: ${summary.verifiedGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    '',
    '## Visibility totals',
    '',
    '| Metric | Count |',
    '|---|---:|',
    ...Object.entries(summary.visibilityTotals).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Status',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...Object.entries(summary.byStatus).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Group lite-visible counts',
    '',
    '| Count | Groups |',
    '|---|---:|',
    ...Object.entries(summary.byGroupLiteVisibleCount).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Warnings',
    '',
    '| Warning | Count |',
    '|---|---:|',
    ...Object.entries(summary.byWarning).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Blockers',
    '',
    '| Blocker | Count |',
    '|---|---:|',
    ...Object.entries(summary.byBlocker).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(inputPath)) throw new Error(`verified supplement file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = input.rows.map((row) => verifyGroup(row, docsById))
  const verified = rows.filter((row) => row.verificationStatus === 'verified')
  const blocked = rows.filter((row) => row.verificationStatus === 'blocked')
  const warnings = rows.flatMap((row) => row.warnings || [])
  const blockers = rows.flatMap((row) => row.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-public-visibility-verify-v01.rows.jsonl'),
    verified: path.join(outDir, 'work-merge-public-visibility-verify-v01-verified.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-public-visibility-verify-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-public-visibility-verify-v01-summary.json'),
    json: path.join(outDir, 'work-merge-public-visibility-verify-v01.json'),
    md: path.join(outDir, 'work-merge-public-visibility-verify-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0 && blocked.length === 0,
    payloadBaseUrl: baseUrl,
    inputFile: inputPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    verifiedGroups: verified.length,
    blockedGroups: blocked.length,
    visibilityTotals: countVisibility(works.docs),
    byStatus: countBy(rows, 'verificationStatus'),
    byGroupLiteVisibleCount: countBy(rows, (row) => String(row.liteVisibleCount)),
    byGroupFullVisibleCount: countBy(rows, (row) => String(row.fullVisibleCount)),
    byWarning: countBy(warnings, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }

  const samples = { verified: verified.slice(0, 20), blocked: blocked.slice(0, 20) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.verified, verified.map((item) => JSON.stringify(item)).join('\n') + (verified.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((item) => JSON.stringify(item)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
