#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-apply-precheck-v01-ready.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-supplement-disposition-preview-v0.1'
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')
const VISIBILITY_FIELDS = [
  'status',
  '_status',
  'reviewStatus',
  'evidenceStrength',
  'isPublic',
  'isVisible',
  'isLiteVisible',
  'isFullVisible',
  'hidden',
  'archived',
  'noindex',
]

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

function visibilitySnapshot(doc) {
  const out = {}
  for (const field of VISIBILITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(doc || {}, field)) out[field] = doc[field]
  }
  return out
}

function boolishPublicFlags(snapshot) {
  const flags = []
  for (const [field, value] of Object.entries(snapshot)) {
    if (value === true) flags.push(`${field}:true`)
    if (value === false) flags.push(`${field}:false`)
    if (typeof value === 'string' && ['public', 'published', 'approved', 'visible', 'active'].includes(value.toLowerCase())) flags.push(`${field}:${value}`)
  }
  return flags
}

function hasMasterCoveredSupplement(master, plan) {
  if (!master) return false
  const additions = plan.fieldAdditions || {}
  for (const [field, expected] of Object.entries(additions.externalIds || {})) {
    if (val(master.externalIds?.[field]) !== val(expected)) return false
  }
  const links = sourceLinkUrls(master)
  for (const link of additions.sourceLinks || []) {
    if (!links.has(normalizeUrl(link.url))) return false
  }
  const sourceKeys = candidateSourceKeys(master)
  for (const source of additions.candidateSources || []) {
    const key = [val(source.source), val(source.externalId), normalizeUrl(source.url)].join('|')
    if (!sourceKeys.has(key)) return false
  }
  return true
}

function inspectPlan(plan, docsById) {
  const blockers = []
  const warnings = []
  const master = docsById.get(val(plan.master?.id))
  const supplementRefs = Array.isArray(plan.supplements) ? plan.supplements : []
  const supplements = supplementRefs.map((item) => docsById.get(val(item.id))).filter(Boolean)

  if (!master) blockers.push('master_not_found')
  if (supplementRefs.length !== 1) blockers.push('expected_one_supplement')
  if (supplements.length !== supplementRefs.length) blockers.push('supplement_not_found')
  if (master && sourceOf(master) !== 'bangumi') blockers.push('master_source_not_bangumi')
  for (const supplement of supplements) {
    if (sourceOf(supplement) !== 'anilist') blockers.push('supplement_source_not_anilist')
  }
  if (!hasMasterCoveredSupplement(master, plan)) blockers.push('master_not_covering_supplement_source')

  const supplement = supplements[0]
  const snapshot = visibilitySnapshot(supplement)
  const publicLikeFlags = boolishPublicFlags(snapshot)
  if (!Object.keys(snapshot).length) warnings.push('no_known_visibility_fields_found')

  const dispositionStatus = blockers.length ? 'blocked' : 'ready_for_disposition_review'

  return {
    mergeGroupId: val(plan.mergeGroupId),
    dispositionStatus,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    master: {
      id: val(master?.id || plan.master?.id),
      title: val(master?.title || plan.master?.title),
      siteId: val(master?.siteId || plan.master?.siteId),
      source: sourceOf(master || plan.master),
    },
    supplement: {
      id: val(supplement?.id || supplementRefs[0]?.id),
      title: val(supplement?.title || supplementRefs[0]?.title),
      siteId: val(supplement?.siteId || supplementRefs[0]?.siteId),
      source: sourceOf(supplement || supplementRefs[0]),
      visibilitySnapshot: snapshot,
      publicLikeFlags,
    },
    dispositionPolicyPreview: {
      goal: 'remove_or_deduplicate_supplement_from_public_work_surfaces_without_deleting_source_data',
      masterAlreadyCarriesSupplementSource: hasMasterCoveredSupplement(master, plan),
      supplementShouldRemainStoredForAudit: true,
      nextStepRequiresExplicitApplyScript: true,
      possibleStrategies: [
        'hide_supplement_from_public_indexes_if_visibility_fields_exist',
        'mark_supplement_as_merged_duplicate_if_schema_has_review_status',
        'export_index_level_dedup_if_payload_visibility_fields_are_not_available',
      ],
    },
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      supplementChanged: false,
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
    '# Work Merge Supplement Disposition Preview v0.1',
    '',
    'Read-only preview for how strict-safe AniList supplement records could be handled after master fields were applied. This report does not hide, archive, delete, or update any record.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- worksRead: ${summary.worksRead}`,
    `- readyGroups: ${summary.readyGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    '',
    '## Safety',
    '',
    '- Payload read only.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No supplement changed.',
    '- No data change.',
    '',
    '## Status',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...Object.entries(summary.byStatus).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Visibility fields found',
    '',
    '| Field | Count |',
    '|---|---:|',
    ...Object.entries(summary.byVisibilityField).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Public-like flags',
    '',
    '| Flag | Count |',
    '|---|---:|',
    ...Object.entries(summary.byPublicLikeFlag).map(([key, count]) => `| ${key} | ${count} |`),
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

  if (!fs.existsSync(inputPath)) throw new Error(`apply precheck ready file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = input.rows.map((plan) => inspectPlan(plan, docsById))
  const ready = rows.filter((row) => row.dispositionStatus === 'ready_for_disposition_review')
  const blocked = rows.filter((row) => row.dispositionStatus === 'blocked')
  const visibilityFields = rows.flatMap((row) => Object.keys(row.supplement?.visibilitySnapshot || {}))
  const publicLikeFlags = rows.flatMap((row) => row.supplement?.publicLikeFlags || [])
  const warnings = rows.flatMap((row) => row.warnings || [])
  const blockers = rows.flatMap((row) => row.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-supplement-disposition-preview-v01.rows.jsonl'),
    ready: path.join(outDir, 'work-merge-supplement-disposition-preview-v01-ready.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-supplement-disposition-preview-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-supplement-disposition-preview-v01-summary.json'),
    json: path.join(outDir, 'work-merge-supplement-disposition-preview-v01.json'),
    md: path.join(outDir, 'work-merge-supplement-disposition-preview-v01.md'),
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
    readyGroups: ready.length,
    blockedGroups: blocked.length,
    byStatus: countBy(rows, 'dispositionStatus'),
    byVisibilityField: countBy(visibilityFields, (value) => value),
    byPublicLikeFlag: countBy(publicLikeFlags, (value) => value),
    byWarning: countBy(warnings, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      supplementChanged: false,
      dataChanged: false,
    },
  }

  const samples = { ready: ready.slice(0, 20), blocked: blocked.slice(0, 20) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.ready, ready.map((item) => JSON.stringify(item)).join('\n') + (ready.length ? '\n' : ''), 'utf8')
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
