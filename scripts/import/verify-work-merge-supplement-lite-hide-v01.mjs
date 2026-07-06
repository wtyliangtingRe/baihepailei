#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-supplement-disposition-preview-v01-ready.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-supplement-lite-hide-verify-v0.1'
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

function masterHasSupplementFields(master, row) {
  if (!master) return false
  const policy = row.dispositionPolicyPreview || {}
  if (policy.masterAlreadyCarriesSupplementSource === true) return true

  const urls = sourceLinkUrls(master)
  const sourceKeys = candidateSourceKeys(master)
  const supplement = row.supplement || {}
  const anilistId = val(String(supplement.siteId || '').replace(/^catalog-anilist-/u, ''))
  const hasAnilistId = val(master.externalIds?.anilistMediaId) === anilistId
  const hasAnilistSource = [...sourceKeys].some((key) => key.startsWith('anilist|'))
  const hasAnilistLink = [...urls].some((url) => url.toLowerCase().includes('anilist'))
  return hasAnilistId || hasAnilistSource || hasAnilistLink
}

function verifyRow(row, docsById) {
  const blockers = []
  const warnings = []
  const master = docsById.get(val(row.master?.id))
  const supplement = docsById.get(val(row.supplement?.id))

  if (!master) blockers.push('master_not_found')
  if (!supplement) blockers.push('supplement_not_found')
  if (master && sourceOf(master) !== 'bangumi') blockers.push('master_source_not_bangumi')
  if (supplement && sourceOf(supplement) !== 'anilist') blockers.push('supplement_source_not_anilist')

  if (supplement) {
    if (supplement.isLiteVisible !== false) blockers.push('supplement_lite_visible_not_false')
    if (supplement.isFullVisible !== false) blockers.push('supplement_full_visible_not_false')
    if (supplement.status !== 'draft') warnings.push('supplement_status_changed')
    if (supplement._status !== 'draft') warnings.push('supplement_payload_status_changed')
    if (supplement.reviewStatus !== 'pending') warnings.push('supplement_review_status_changed')
    if (supplement.evidenceStrength !== 'unassessed') warnings.push('supplement_evidence_strength_changed')
  }

  if (!masterHasSupplementFields(master, row)) blockers.push('master_missing_supplement_source_fields')

  const status = blockers.length ? 'blocked' : 'verified'
  return {
    mergeGroupId: val(row.mergeGroupId),
    verificationStatus: status,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    master: {
      id: val(master?.id || row.master?.id),
      title: val(master?.title || row.master?.title),
      siteId: val(master?.siteId || row.master?.siteId),
      source: sourceOf(master || row.master),
    },
    supplement: {
      id: val(supplement?.id || row.supplement?.id),
      title: val(supplement?.title || row.supplement?.title),
      siteId: val(supplement?.siteId || row.supplement?.siteId),
      source: sourceOf(supplement || row.supplement),
      status: supplement?.status ?? null,
      _status: supplement?._status ?? null,
      reviewStatus: supplement?.reviewStatus ?? null,
      evidenceStrength: supplement?.evidenceStrength ?? null,
      isLiteVisible: supplement?.isLiteVisible ?? null,
      isFullVisible: supplement?.isFullVisible ?? null,
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

function markdown(summary, samples) {
  return [
    '# Work Merge Supplement Lite Hide Verification v0.1',
    '',
    'Read-only verification after supplement lite visibility update. It checks that strict-safe AniList supplement records are no longer lite-visible and that master records still carry supplement source data.',
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

  if (!fs.existsSync(inputPath)) throw new Error(`supplement disposition ready file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = input.rows.map((row) => verifyRow(row, docsById))
  const verified = rows.filter((row) => row.verificationStatus === 'verified')
  const blocked = rows.filter((row) => row.verificationStatus === 'blocked')
  const warnings = rows.flatMap((row) => row.warnings || [])
  const blockers = rows.flatMap((row) => row.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-supplement-lite-hide-verify-v01.rows.jsonl'),
    verified: path.join(outDir, 'work-merge-supplement-lite-hide-verify-v01-verified.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-supplement-lite-hide-verify-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-supplement-lite-hide-verify-v01-summary.json'),
    json: path.join(outDir, 'work-merge-supplement-lite-hide-verify-v01.json'),
    md: path.join(outDir, 'work-merge-supplement-lite-hide-verify-v01.md'),
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
    byStatus: countBy(rows, 'verificationStatus'),
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
