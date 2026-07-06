#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-stage2-supplement-lite-hide-v01-ready.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-stage2-visibility-verify-v0.1'
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
  const fromCandidate = val(first?.source || first?.label).toLowerCase()
  if (fromCandidate) return fromCandidate
  const siteId = val(doc?.siteId).toLowerCase()
  if (siteId.includes('bangumi')) return 'bangumi'
  if (siteId.includes('anilist')) return 'anilist'
  return val(doc?.originalSource || doc?.source || 'unknown').toLowerCase() || 'unknown'
}

function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function sourceLinkRows(doc) {
  return (Array.isArray(doc?.sourceLinks) ? doc.sourceLinks : [])
    .map((item) => ({ label: val(typeof item === 'string' ? '' : item?.label), url: normalizeUrl(typeof item === 'string' ? item : item?.url) }))
    .filter((item) => item.url)
}

function candidateSourceRows(doc) {
  return (Array.isArray(doc?.candidateSources) ? doc.candidateSources : [])
    .map((item) => ({
      source: val(item?.source),
      label: val(item?.label),
      externalId: val(item?.externalId),
      url: normalizeUrl(item?.url),
      note: val(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url)
}

function hasAniListTrace(master) {
  const ids = externalIdsOf(master)
  if (ids.anilistMediaId || ids.anilistId || ids.anilist) return true
  if (sourceLinkRows(master).some((item) => item.url.toLowerCase().includes('anilist'))) return true
  if (candidateSourceRows(master).some((item) => `${item.source} ${item.label} ${item.url}`.toLowerCase().includes('anilist'))) return true
  return false
}

function collectWorkIds(row) {
  const ids = []
  const masterId = val(row?.master?.id)
  const supplementId = val(row?.supplement?.id)
  if (masterId) ids.push(masterId)
  if (supplementId) ids.push(supplementId)
  return [...new Set(ids)]
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function markdown(summary, samples) {
  return [
    '# Work Merge Stage 2 Visibility Verify v0.1',
    '',
    'Read-only verification for stage 2 work merge visibility after master field merge and supplement lite visibility update.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- worksRead: ${summary.worksRead}`,
    `- verifiedGroups: ${summary.verifiedGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    `- liteVisibleWorks: ${summary.visibilityTotals.liteVisibleWorks}`,
    `- liteHiddenWorks: ${summary.visibilityTotals.liteHiddenWorks}`,
    '',
    '## Safety',
    '',
    '- Payload read only.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No data change.',
    '',
    '## Status',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...Object.entries(summary.byStatus).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Group lite-visible count',
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

  if (!fs.existsSync(inputPath)) throw new Error(`stage 2 supplement visibility input file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = []

  for (const row of input.rows) {
    const blockers = []
    const warnings = []
    const ids = collectWorkIds(row)
    const master = docsById.get(val(row?.master?.id))
    const supplement = docsById.get(val(row?.supplement?.id))
    const groupDocs = ids.map((id) => docsById.get(id)).filter(Boolean)
    const liteVisibleDocs = groupDocs.filter((doc) => doc.isLiteVisible !== false)
    const fullVisibleDocs = groupDocs.filter((doc) => doc.isFullVisible !== false)

    if (!master) blockers.push('master_not_found')
    if (!supplement) blockers.push('supplement_not_found')
    if (master && sourceOf(master) !== 'bangumi') blockers.push('master_source_not_bangumi')
    if (supplement && sourceOf(supplement) !== 'anilist') blockers.push('supplement_source_not_anilist')
    if (master && !hasAniListTrace(master)) blockers.push('master_missing_anilist_trace')
    if (master && master.isLiteVisible === false) blockers.push('master_not_lite_visible')
    if (supplement && supplement.isLiteVisible !== false) blockers.push('supplement_still_lite_visible')
    if (supplement && supplement.isFullVisible !== false) warnings.push('supplement_not_full_hidden')
    if (supplement && val(supplement.status) && val(supplement.status) !== 'draft') warnings.push('supplement_status_changed')
    if (supplement && val(supplement._status) && val(supplement._status) !== 'draft') warnings.push('supplement_draft_status_changed')
    if (supplement && val(supplement.reviewStatus) && val(supplement.reviewStatus) !== 'pending') warnings.push('supplement_review_status_changed')
    if (supplement && val(supplement.evidenceStrength) && val(supplement.evidenceStrength) !== 'unassessed') warnings.push('supplement_evidence_strength_changed')
    if (liteVisibleDocs.length !== 1) blockers.push('group_lite_visible_count_not_one')
    if (liteVisibleDocs.length === 1 && master && liteVisibleDocs[0]?.id !== master.id) blockers.push('group_lite_visible_doc_not_master')
    if (fullVisibleDocs.length !== 0) warnings.push('group_has_full_visible_member')

    const status = blockers.length ? 'blocked' : 'verified'
    rows.push({
      mergeGroupId: val(row.mergeGroupId),
      status,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      liteVisibleCount: liteVisibleDocs.length,
      fullVisibleCount: fullVisibleDocs.length,
      master: master ? {
        id: val(master.id),
        title: val(master.title),
        slug: val(master.slug),
        source: sourceOf(master),
        isLiteVisible: master.isLiteVisible ?? null,
        isFullVisible: master.isFullVisible ?? null,
        hasAniListTrace: hasAniListTrace(master),
        externalIds: externalIdsOf(master),
      } : null,
      supplement: supplement ? {
        id: val(supplement.id),
        title: val(supplement.title),
        slug: val(supplement.slug),
        source: sourceOf(supplement),
        isLiteVisible: supplement.isLiteVisible ?? null,
        isFullVisible: supplement.isFullVisible ?? null,
        status: val(supplement.status),
        draftStatus: val(supplement._status),
        reviewStatus: val(supplement.reviewStatus),
        evidenceStrength: val(supplement.evidenceStrength),
      } : null,
      safety: {
        readOnly: true,
        payloadRead: true,
        payloadWrite: false,
        directPostgresqlWrite: false,
        dataChanged: false,
      },
    })
  }

  const verified = rows.filter((row) => row.status === 'verified')
  const blocked = rows.filter((row) => row.status === 'blocked')
  const blockers = rows.flatMap((row) => row.blockers || [])
  const warnings = rows.flatMap((row) => row.warnings || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-stage2-visibility-verify-v01.rows.jsonl'),
    verified: path.join(outDir, 'work-merge-stage2-visibility-verify-v01-verified.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-stage2-visibility-verify-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-stage2-visibility-verify-v01-summary.json'),
    json: path.join(outDir, 'work-merge-stage2-visibility-verify-v01.json'),
    md: path.join(outDir, 'work-merge-stage2-visibility-verify-v01.md'),
  }

  const visibilityTotals = {
    totalWorks: works.docs.length,
    liteVisibleWorks: works.docs.filter((doc) => doc.isLiteVisible !== false).length,
    fullVisibleWorks: works.docs.filter((doc) => doc.isFullVisible !== false).length,
    liteHiddenWorks: works.docs.filter((doc) => doc.isLiteVisible === false).length,
    fullHiddenWorks: works.docs.filter((doc) => doc.isFullVisible === false).length,
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
    visibilityTotals,
    byStatus: countBy(rows, 'status'),
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

  const samples = { verified: verified.slice(0, 30), blocked: blocked.slice(0, 30) }
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
