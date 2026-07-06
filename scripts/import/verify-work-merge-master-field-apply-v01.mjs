#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-apply-precheck-v01-ready.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-master-field-apply-verify-v0.1'
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

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase()
}

function normalizeUrl(value) {
  return val(value).replace(/\/$/u, '')
}

function localizedTitleKeys(doc) {
  return new Set((Array.isArray(doc?.localizedTitles) ? doc.localizedTitles : [])
    .map((item) => normalizeText(typeof item === 'string' ? item : item?.title))
    .filter(Boolean))
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

function sourceOf(doc) {
  const first = Array.isArray(doc?.candidateSources) ? doc.candidateSources[0] : null
  return val(first?.source || first?.label || doc?.originalSource || 'unknown').toLowerCase() || 'unknown'
}

function checkApplied(plan, docsById) {
  const blockers = []
  const missing = []
  const warnings = []
  const master = docsById.get(val(plan.master?.id))
  const supplementRefs = Array.isArray(plan.supplements) ? plan.supplements : []
  const supplements = supplementRefs.map((item) => docsById.get(val(item.id))).filter(Boolean)

  if (!master) blockers.push('master_not_found')
  if (supplements.length !== supplementRefs.length) blockers.push('supplement_not_found')
  if (supplementRefs.length !== 1) blockers.push('expected_one_supplement')
  if (master && sourceOf(master) !== 'bangumi') blockers.push('master_source_not_bangumi')
  for (const supplement of supplements) {
    if (sourceOf(supplement) !== 'anilist') blockers.push('supplement_source_not_anilist')
  }

  if (master) {
    for (const [field, expected] of Object.entries(plan.fieldAdditions?.externalIds || {})) {
      const actual = val(master.externalIds?.[field])
      if (actual !== val(expected)) missing.push(`externalIds.${field}`)
    }

    const titleKeys = localizedTitleKeys(master)
    for (const title of plan.fieldAdditions?.titles || []) {
      if (!titleKeys.has(normalizeText(title))) missing.push('localizedTitles.title')
    }

    const linkUrls = sourceLinkUrls(master)
    for (const link of plan.fieldAdditions?.sourceLinks || []) {
      if (!linkUrls.has(normalizeUrl(link.url))) missing.push('sourceLinks.url')
    }

    const sourceKeys = candidateSourceKeys(master)
    for (const source of plan.fieldAdditions?.candidateSources || []) {
      const key = [val(source.source), val(source.externalId), normalizeUrl(source.url)].join('|')
      if (!sourceKeys.has(key)) missing.push('candidateSources.source_externalId_url')
    }
  }

  const status = blockers.length ? 'blocked' : missing.length ? 'pending_apply' : 'applied'

  return {
    mergeGroupId: val(plan.mergeGroupId),
    verificationStatus: status,
    blockers: [...new Set(blockers)],
    missingFields: [...new Set(missing)],
    warnings: [...new Set(warnings)],
    master: plan.master,
    supplements: plan.supplements || [],
    fieldAdditions: plan.fieldAdditions || {},
    supplementStillPresent: supplementRefs.length > 0 && supplements.length === supplementRefs.length,
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
    '# Work Merge Master Field Apply Verification v0.1',
    '',
    'Read-only verification for strict-safe master field apply. It checks whether planned master additions are present in current Payload data and whether supplement records still exist.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- plansRead: ${summary.plansRead}`,
    `- plansLoaded: ${summary.plansLoaded}`,
    `- worksRead: ${summary.worksRead}`,
    `- appliedGroups: ${summary.appliedGroups}`,
    `- pendingGroups: ${summary.pendingGroups}`,
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
    '## Missing fields',
    '',
    '| Missing field | Count |',
    '|---|---:|',
    ...Object.entries(summary.byMissingField).map(([key, count]) => `| ${key} | ${count} |`),
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

  if (!fs.existsSync(inputPath)) throw new Error(`apply precheck ready file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = input.rows.map((plan) => checkApplied(plan, docsById))
  const applied = rows.filter((row) => row.verificationStatus === 'applied')
  const pending = rows.filter((row) => row.verificationStatus === 'pending_apply')
  const blocked = rows.filter((row) => row.verificationStatus === 'blocked')
  const blockers = rows.flatMap((row) => row.blockers || [])
  const missingFields = rows.flatMap((row) => row.missingFields || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-master-field-apply-verify-v01.rows.jsonl'),
    applied: path.join(outDir, 'work-merge-master-field-apply-verify-v01-applied.groups.jsonl'),
    pending: path.join(outDir, 'work-merge-master-field-apply-verify-v01-pending.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-master-field-apply-verify-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-master-field-apply-verify-v01-summary.json'),
    json: path.join(outDir, 'work-merge-master-field-apply-verify-v01.json'),
    md: path.join(outDir, 'work-merge-master-field-apply-verify-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0 && blocked.length === 0,
    payloadBaseUrl: baseUrl,
    inputFile: inputPath,
    plansRead: input.read,
    plansLoaded: input.rows.length,
    parseFailures: input.failed,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    appliedGroups: applied.length,
    pendingGroups: pending.length,
    blockedGroups: blocked.length,
    byStatus: countBy(rows, 'verificationStatus'),
    byMissingField: countBy(missingFields, (value) => value),
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

  const samples = { applied: applied.slice(0, 20), pending: pending.slice(0, 20), blocked: blocked.slice(0, 20) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.applied, applied.map((item) => JSON.stringify(item)).join('\n') + (applied.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.pending, pending.map((item) => JSON.stringify(item)).join('\n') + (pending.length ? '\n' : ''), 'utf8')
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
