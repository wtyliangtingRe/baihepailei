#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-safe-strict-v01-safe.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-strict-safe-verify-v0.1'
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

function pickDoc(ref, byId, bySiteId) {
  return byId.get(val(ref?.id)) || bySiteId.get(val(ref?.siteId)) || null
}

function sourceOf(doc) {
  const first = Array.isArray(doc?.candidateSources) ? doc.candidateSources[0] : null
  return val(first?.source || first?.label || doc?.originalSource || 'unknown').toLowerCase() || 'unknown'
}

function relationValues(values, field) {
  if (!Array.isArray(values)) return []
  return values.map((item) => val(typeof item === 'string' ? item : item?.[field])).filter(Boolean)
}

function externalIds(doc) {
  const ids = doc?.externalIds || {}
  return Object.fromEntries(Object.entries(ids).filter(([, value]) => val(value)))
}

function urlsOf(values) {
  if (!Array.isArray(values)) return []
  return values.map((item) => val(item?.url).replace(/\/$/u, '')).filter(Boolean)
}

function sourcePairs(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => ({ source: val(item?.source), externalId: val(item?.externalId), url: val(item?.url).replace(/\/$/u, '') }))
    .filter((item) => item.source || item.externalId || item.url)
}

function compactDoc(doc) {
  return {
    id: val(doc?.id),
    title: val(doc?.title),
    slug: val(doc?.slug),
    siteId: val(doc?.siteId),
    source: sourceOf(doc),
    status: val(doc?.status),
    reviewStatus: val(doc?.reviewStatus),
    mediaGroup: val(doc?.mediaGroup),
    mediaType: val(doc?.mediaType),
    externalIds: externalIds(doc),
    localizedTitles: relationValues(doc?.localizedTitles, 'title'),
    aliases: relationValues(doc?.aliases, 'value'),
    sourceLinks: urlsOf(doc?.sourceLinks),
    candidateSources: sourcePairs(doc?.candidateSources),
  }
}

function verifyGroup(group, byId, bySiteId) {
  const blockers = []
  const warnings = []
  const masterRef = group.master
  const supplementRefs = Array.isArray(group.supplements) ? group.supplements : []
  const master = pickDoc(masterRef, byId, bySiteId)
  const supplements = supplementRefs.map((ref) => pickDoc(ref, byId, bySiteId)).filter(Boolean)

  if (group.strictBucket !== 'safe') blockers.push('not_strict_safe')
  if (!masterRef?.id && !masterRef?.siteId) blockers.push('missing_master_reference')
  if (supplementRefs.length !== 1) blockers.push('expected_one_supplement')
  if (!master) blockers.push('master_not_found')
  if (supplements.length !== supplementRefs.length) blockers.push('supplement_not_found')

  if (master && sourceOf(master) !== 'bangumi') blockers.push('master_source_not_bangumi')
  for (const doc of supplements) {
    if (sourceOf(doc) !== 'anilist') blockers.push('supplement_source_not_anilist')
  }

  if (master && supplements.some((doc) => val(doc.id) === val(master.id))) blockers.push('same_payload_doc')

  const mediaGroups = new Set([master, ...supplements].filter(Boolean).map((doc) => val(doc.mediaGroup)))
  const mediaTypes = new Set([master, ...supplements].filter(Boolean).map((doc) => val(doc.mediaType)))
  if (mediaGroups.size > 1) blockers.push('media_group_mismatch')
  if (mediaTypes.size > 1) warnings.push('media_type_mismatch')

  if (!Object.keys(externalIds(master)).length) warnings.push('master_missing_external_ids')
  for (const doc of supplements) {
    if (!Object.keys(externalIds(doc)).length) warnings.push('supplement_missing_external_ids')
  }

  const preserved = group.preservedDataPreview || {}
  const preservedIds = preserved.externalIds || {}
  if (!preservedIds.bangumiSubjectId) warnings.push('preview_missing_bangumi_id')
  if (!preservedIds.anilistMediaId) warnings.push('preview_missing_anilist_id')

  return {
    mergeGroupId: val(group.mergeGroupId || group.groupId),
    verificationStatus: blockers.length ? 'blocked' : 'verified',
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    master: master ? compactDoc(master) : masterRef,
    supplements: supplements.length ? supplements.map(compactDoc) : supplementRefs,
    preservedDataPreview: preserved,
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
    '# Strict Safe Work Merge Verification v0.1',
    '',
    'Read-only Payload verification for strict safe same-work groups. This report checks that referenced Payload works still exist and match expected source/media constraints.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- parseFailures: ${summary.parseFailures}`,
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

  if (!fs.existsSync(inputPath)) throw new Error(`strict safe file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const byId = indexBy(works.docs, 'id')
  const bySiteId = indexBy(works.docs, 'siteId')
  const rows = input.rows.map((group) => verifyGroup(group, byId, bySiteId))
  const verified = rows.filter((row) => row.verificationStatus === 'verified')
  const blocked = rows.filter((row) => row.verificationStatus === 'blocked')
  const warnings = rows.flatMap((row) => row.warnings || [])
  const blockers = rows.flatMap((row) => row.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-strict-safe-verify-v01.rows.jsonl'),
    verified: path.join(outDir, 'work-merge-strict-safe-verify-v01-verified.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-strict-safe-verify-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-strict-safe-verify-v01-summary.json'),
    json: path.join(outDir, 'work-merge-strict-safe-verify-v01.json'),
    md: path.join(outDir, 'work-merge-strict-safe-verify-v01.md'),
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
  fs.writeFileSync(outputs.rows, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.verified, verified.map((row) => JSON.stringify(row)).join('\n') + (verified.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((row) => JSON.stringify(row)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
