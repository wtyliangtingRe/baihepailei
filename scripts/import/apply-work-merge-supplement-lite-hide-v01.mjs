#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-supplement-disposition-preview-v01-ready.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-supplement-lite-hide-v0.1'
const CONFIRM_TOKEN = 'hide-strict-safe-supplements'
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

function sourceOf(doc) {
  const first = Array.isArray(doc?.candidateSources) ? doc.candidateSources[0] : null
  return val(first?.source || first?.label || doc?.originalSource || 'unknown').toLowerCase() || 'unknown'
}

async function updateWork(baseUrl, token, workId, patch) {
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(workId)}?draft=true`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  })
}

function validateRow(row, docsById) {
  const blockers = []
  const warnings = []
  const supplementId = val(row.supplement?.id)
  const supplement = docsById.get(supplementId)

  if (row.dispositionStatus !== 'ready_for_disposition_review') blockers.push('disposition_not_ready')
  if (!supplementId) blockers.push('missing_supplement_id')
  if (!supplement) blockers.push('supplement_not_found')
  if (supplement && sourceOf(supplement) !== 'anilist') blockers.push('supplement_source_not_anilist')

  if (supplement && supplement.isFullVisible !== false) blockers.push('supplement_full_visible_not_false')
  if (supplement && supplement.isLiteVisible === false) warnings.push('supplement_already_lite_hidden')
  if (supplement && supplement.isLiteVisible !== true && supplement.isLiteVisible !== false) blockers.push('supplement_lite_visibility_not_boolean')

  return { supplement, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] }
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
    '# Work Merge Supplement Lite Hide v0.1',
    '',
    'Controlled apply for hiding strict-safe AniList supplement records from lite/public list surfaces. Default mode is dry-run. Real writes require --apply --confirm hide-strict-safe-supplements.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- mode: ${summary.mode}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- worksRead: ${summary.worksRead}`,
    `- readyGroups: ${summary.readyGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    `- wouldHideSupplements: ${summary.wouldHideSupplements}`,
    `- hiddenSupplements: ${summary.hiddenSupplements}`,
    `- alreadyHiddenSupplements: ${summary.alreadyHiddenSupplements}`,
    '',
    '## Safety',
    '',
    `- applyRequested: ${summary.safety.applyRequested}`,
    `- confirmMatched: ${summary.safety.confirmMatched}`,
    `- payloadRead: ${summary.safety.payloadRead}`,
    `- payloadWrite: ${summary.safety.payloadWrite}`,
    '- Only isLiteVisible may be changed.',
    '- No delete/archive/status/reviewStatus/evidenceStrength changes.',
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

  if (!fs.existsSync(inputPath)) throw new Error(`supplement disposition ready file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)
  if (applyRequested && !confirmMatched) throw new Error(`Refusing to apply. Use --confirm ${CONFIRM_TOKEN}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = []

  for (const sourceRow of input.rows) {
    const validation = validateRow(sourceRow, docsById)
    const shouldHide = validation.supplement?.isLiteVisible === true && validation.blockers.length === 0
    const status = validation.blockers.length
      ? 'blocked'
      : shouldHide
        ? (applyRequested ? 'hidden' : 'would_hide')
        : 'already_hidden'

    const row = {
      mergeGroupId: val(sourceRow.mergeGroupId),
      status,
      blockers: validation.blockers,
      warnings: validation.warnings,
      master: sourceRow.master,
      supplement: {
        id: val(sourceRow.supplement?.id),
        title: val(sourceRow.supplement?.title),
        siteId: val(sourceRow.supplement?.siteId),
        source: val(sourceRow.supplement?.source),
        before: validation.supplement ? {
          status: validation.supplement.status,
          _status: validation.supplement._status,
          reviewStatus: validation.supplement.reviewStatus,
          evidenceStrength: validation.supplement.evidenceStrength,
          isLiteVisible: validation.supplement.isLiteVisible,
          isFullVisible: validation.supplement.isFullVisible,
        } : sourceRow.supplement?.visibilitySnapshot || {},
        afterPreview: validation.supplement ? {
          status: validation.supplement.status,
          _status: validation.supplement._status,
          reviewStatus: validation.supplement.reviewStatus,
          evidenceStrength: validation.supplement.evidenceStrength,
          isLiteVisible: shouldHide ? false : validation.supplement.isLiteVisible,
          isFullVisible: validation.supplement.isFullVisible,
        } : {},
      },
      patchPreview: shouldHide ? { isLiteVisible: false } : {},
      writeResult: null,
      safety: {
        applyRequested,
        confirmMatched,
        payloadRead: true,
        payloadWrite: Boolean(applyRequested && shouldHide),
        directPostgresqlWrite: false,
        onlyLiteVisibilityChanged: true,
        deleted: false,
        archived: false,
      },
    }

    if (applyRequested && shouldHide) {
      const result = await updateWork(baseUrl, token, val(sourceRow.supplement?.id), { isLiteVisible: false })
      row.writeResult = {
        id: val(result?.doc?.id || result?.id || sourceRow.supplement?.id),
        title: val(result?.doc?.title || result?.title || sourceRow.supplement?.title),
        isLiteVisible: result?.doc?.isLiteVisible ?? result?.isLiteVisible ?? null,
      }
    }

    rows.push(row)
  }

  const blocked = rows.filter((row) => row.status === 'blocked')
  const wouldHide = rows.filter((row) => row.status === 'would_hide')
  const hidden = rows.filter((row) => row.status === 'hidden')
  const alreadyHidden = rows.filter((row) => row.status === 'already_hidden')
  const warnings = rows.flatMap((row) => row.warnings || [])
  const blockers = rows.flatMap((row) => row.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-supplement-lite-hide-v01.rows.jsonl'),
    summary: path.join(outDir, 'work-merge-supplement-lite-hide-v01-summary.json'),
    json: path.join(outDir, 'work-merge-supplement-lite-hide-v01.json'),
    md: path.join(outDir, 'work-merge-supplement-lite-hide-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0 && blocked.length === 0,
    mode: applyRequested ? 'apply' : 'dry-run',
    payloadBaseUrl: baseUrl,
    inputFile: inputPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    readyGroups: rows.length - blocked.length,
    blockedGroups: blocked.length,
    wouldHideSupplements: wouldHide.length,
    hiddenSupplements: hidden.length,
    alreadyHiddenSupplements: alreadyHidden.length,
    byStatus: countBy(rows, 'status'),
    byWarning: countBy(warnings, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      applyRequested,
      confirmMatched,
      readOnly: !applyRequested,
      payloadRead: true,
      payloadWrite: applyRequested && hidden.length > 0,
      directPostgresqlWrite: false,
      onlyLiteVisibilityChanged: true,
      deleted: false,
      archived: false,
      statusChanged: false,
      reviewStatusChanged: false,
      evidenceStrengthChanged: false,
    },
  }

  const samples = { rows: rows.slice(0, 20), blocked: blocked.slice(0, 20) }
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
