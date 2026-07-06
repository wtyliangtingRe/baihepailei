#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-apply-precheck-v01-ready.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-master-field-apply-v0.1'
const CONFIRM_TOKEN = 'strict-safe-18'
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

function normalizeUrl(value) {
  return val(value).replace(/\/$/u, '')
}

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase()
}

function indexBy(docs, field) {
  const out = new Map()
  for (const doc of docs) {
    const key = val(doc[field])
    if (key) out.set(key, doc)
  }
  return out
}

function localizedTitleRows(doc) {
  return (Array.isArray(doc?.localizedTitles) ? doc.localizedTitles : [])
    .map((item) => ({ title: val(typeof item === 'string' ? item : item?.title) }))
    .filter((item) => item.title)
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

function uniqueBy(values, getKey) {
  const seen = new Set()
  const out = []
  for (const item of values) {
    const key = getKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function buildPatch(master, fieldAdditions) {
  const externalIds = {
    ...(master.externalIds || {}),
    ...(fieldAdditions.externalIds || {}),
  }

  const localizedTitles = uniqueBy(
    [
      ...localizedTitleRows(master),
      ...(Array.isArray(fieldAdditions.titles) ? fieldAdditions.titles : []).map((title) => ({ title: val(title) })),
    ].filter((item) => item.title),
    (item) => normalizeText(item.title),
  )

  const sourceLinks = uniqueBy(
    [
      ...sourceLinkRows(master),
      ...(Array.isArray(fieldAdditions.sourceLinks) ? fieldAdditions.sourceLinks : [])
        .map((item) => ({ label: val(item?.label), url: normalizeUrl(item?.url) }))
        .filter((item) => item.url),
    ],
    (item) => item.url,
  )

  const candidateSources = uniqueBy(
    [
      ...candidateSourceRows(master),
      ...(Array.isArray(fieldAdditions.candidateSources) ? fieldAdditions.candidateSources : [])
        .map((item) => ({
          source: val(item?.source),
          label: val(item?.label),
          externalId: val(item?.externalId),
          url: normalizeUrl(item?.url),
          note: val(item?.note),
        }))
        .filter((item) => item.source || item.externalId || item.url),
    ],
    (item) => [item.source, item.externalId, item.url].join('|'),
  )

  return { externalIds, localizedTitles, sourceLinks, candidateSources }
}

function patchChanged(master, patch) {
  const before = JSON.stringify({
    externalIds: master.externalIds || {},
    localizedTitles: localizedTitleRows(master),
    sourceLinks: sourceLinkRows(master),
    candidateSources: candidateSourceRows(master),
  })
  const after = JSON.stringify(patch)
  return before !== after
}

function validatePlan(plan, master) {
  const blockers = []
  const warnings = []
  if (plan.precheckStatus !== 'ready_for_apply_review') blockers.push('precheck_not_ready')
  if (!master) blockers.push('master_not_found')
  if ((plan.supplements || []).length !== 1) blockers.push('expected_one_supplement')

  const additions = plan.fieldAdditions || {}
  for (const [field, value] of Object.entries(additions.externalIds || {})) {
    const existing = val(master?.externalIds?.[field])
    const incoming = val(value)
    if (existing && existing !== incoming) blockers.push(`external_id_conflict:${field}`)
  }

  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] }
}

async function updateWork(baseUrl, token, workId, patch) {
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(workId)}?draft=true`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  })
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
    '# Work Merge Master Field Apply v0.1',
    '',
    'Controlled apply for strict-safe master field additions. Default mode is dry-run. Real writes require --apply --confirm strict-safe-18.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- mode: ${summary.mode}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- plansRead: ${summary.plansRead}`,
    `- plansLoaded: ${summary.plansLoaded}`,
    `- worksRead: ${summary.worksRead}`,
    `- readyGroups: ${summary.readyGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    `- wouldUpdateMasters: ${summary.wouldUpdateMasters}`,
    `- updatedMasters: ${summary.updatedMasters}`,
    '',
    '## Safety',
    '',
    `- applyRequested: ${summary.safety.applyRequested}`,
    `- confirmMatched: ${summary.safety.confirmMatched}`,
    `- payloadRead: ${summary.safety.payloadRead}`,
    `- payloadWrite: ${summary.safety.payloadWrite}`,
    '- No supplement delete/hide/archive in this step.',
    '- No PostgreSQL direct write.',
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
  const applyRequested = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM_TOKEN
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(inputPath)) throw new Error(`apply precheck ready file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)
  if (applyRequested && !confirmMatched) throw new Error(`Refusing to apply. Use --confirm ${CONFIRM_TOKEN}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = []

  for (const plan of input.rows) {
    const masterId = val(plan.master?.id)
    const master = docsById.get(masterId)
    const validation = validatePlan(plan, master)
    const patch = master ? buildPatch(master, plan.fieldAdditions || {}) : null
    const hasChanges = master && patch ? patchChanged(master, patch) : false
    const status = validation.blockers.length
      ? 'blocked'
      : hasChanges
        ? (applyRequested ? 'updated' : 'would_update')
        : 'no_change'

    const row = {
      mergeGroupId: val(plan.mergeGroupId),
      status,
      blockers: validation.blockers,
      warnings: validation.warnings,
      master: plan.master,
      supplements: plan.supplements || [],
      fieldAdditions: plan.fieldAdditions || {},
      patchPreview: patch,
      writeResult: null,
      safety: {
        applyRequested,
        confirmMatched,
        payloadRead: true,
        payloadWrite: Boolean(applyRequested && !validation.blockers.length && hasChanges),
        directPostgresqlWrite: false,
        supplementChanged: false,
      },
    }

    if (applyRequested && !validation.blockers.length && hasChanges) {
      const result = await updateWork(baseUrl, token, masterId, patch)
      row.writeResult = {
        id: val(result?.doc?.id || result?.id || masterId),
        title: val(result?.doc?.title || result?.title || plan.master?.title),
      }
    }

    rows.push(row)
  }

  const blocked = rows.filter((row) => row.status === 'blocked')
  const wouldUpdate = rows.filter((row) => row.status === 'would_update')
  const updated = rows.filter((row) => row.status === 'updated')
  const warnings = rows.flatMap((row) => row.warnings || [])
  const blockers = rows.flatMap((row) => row.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-master-field-apply-v01.rows.jsonl'),
    summary: path.join(outDir, 'work-merge-master-field-apply-v01-summary.json'),
    json: path.join(outDir, 'work-merge-master-field-apply-v01.json'),
    md: path.join(outDir, 'work-merge-master-field-apply-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0 && blocked.length === 0,
    mode: applyRequested ? 'apply' : 'dry-run',
    payloadBaseUrl: baseUrl,
    inputFile: inputPath,
    plansRead: input.read,
    plansLoaded: input.rows.length,
    parseFailures: input.failed,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    readyGroups: rows.length - blocked.length,
    blockedGroups: blocked.length,
    wouldUpdateMasters: wouldUpdate.length,
    updatedMasters: updated.length,
    byStatus: countBy(rows, 'status'),
    byChangedField: countBy(rows.flatMap((row) => Object.keys(row.fieldAdditions || {}).filter((field) => {
      const value = row.fieldAdditions[field]
      return Array.isArray(value) ? value.length : Object.keys(value || {}).length
    })), (value) => value),
    byWarning: countBy(warnings, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      applyRequested,
      confirmMatched,
      readOnly: !applyRequested,
      payloadRead: true,
      payloadWrite: applyRequested && updated.length > 0,
      directPostgresqlWrite: false,
      supplementChanged: false,
      applyExecuted: applyRequested,
    },
  }

  const samples = {
    rows: rows.slice(0, 20),
    blocked: blocked.slice(0, 20),
  }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
