#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-stage2-master-fields-v01-ready.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-stage2-supplement-lite-hide-v0.1'
const CONFIRM_TOKEN = 'hide-stage2-supplements'
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

async function fetchWork(baseUrl, token, workId) {
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(workId)}?draft=true&depth=0`, {
    headers: authHeaders(token),
  })
}

async function updateWork(baseUrl, token, workId, patch) {
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(workId)}?draft=true`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  })
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

function supplementFromPlan(plan) {
  const supplements = Array.isArray(plan?.supplements) ? plan.supplements : []
  return supplements[0] || null
}

function validatePlan(plan, master, supplement) {
  const blockers = []
  const warnings = []
  const supplements = Array.isArray(plan?.supplements) ? plan.supplements : []

  if (!['already_current', 'updated', 'would_update'].includes(val(plan.status))) warnings.push('unexpected_stage2_master_status')
  if (!master) blockers.push('master_not_found')
  if (!supplement) blockers.push('supplement_not_found')
  if (supplements.length !== 1) blockers.push('expected_one_supplement')
  if (master && sourceOf(master) !== 'bangumi') blockers.push('master_source_not_bangumi')
  if (supplement && sourceOf(supplement) !== 'anilist') blockers.push('supplement_source_not_anilist')
  if (master && !hasAniListTrace(master)) blockers.push('master_missing_anilist_trace')
  if (supplement && supplement.isFullVisible !== false) warnings.push('supplement_not_full_hidden')

  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] }
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
    '# Work Merge Stage 2 Supplement Lite Hide v0.1',
    '',
    'Controlled dry-run-first update for stage 2 AniList supplement lite visibility. Real writes require --apply --confirm hide-stage2-supplements.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- mode: ${summary.mode}`,
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
    `- payloadPatchRequests: ${summary.safety.payloadPatchRequests}`,
    '- No PostgreSQL write.',
    '- No delete/archive/status/review/evidence changes.',
    '- Only supplement isLiteVisible may change.',
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

  if (!fs.existsSync(inputPath)) throw new Error(`stage 2 master field ready file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)
  if (applyRequested && !confirmMatched) throw new Error(`Refusing to write. Use --confirm ${CONFIRM_TOKEN}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const rows = []

  for (const plan of input.rows) {
    const plannedSupplement = supplementFromPlan(plan)
    const master = docsById.get(val(plan.master?.id))
    let supplement = docsById.get(val(plannedSupplement?.id))
    const validation = validatePlan(plan, master, supplement)
    const blockers = [...validation.blockers]
    let status = 'blocked'
    let patchSent = false
    let beforeIsLiteVisible = supplement?.isLiteVisible ?? null
    let afterIsLiteVisible = supplement?.isLiteVisible ?? null

    if (!blockers.length && supplement.isLiteVisible === false) {
      status = 'already_hidden'
    } else if (!blockers.length && !applyRequested) {
      status = 'would_hide'
    } else if (!blockers.length && applyRequested) {
      await updateWork(baseUrl, token, supplement.id, { isLiteVisible: false })
      patchSent = true
      supplement = await fetchWork(baseUrl, token, supplement.id)
      afterIsLiteVisible = supplement?.isLiteVisible ?? null
      if (supplement?.isLiteVisible === false) status = 'hidden'
      else {
        blockers.push('supplement_lite_visibility_still_true_after_patch')
        status = 'blocked'
      }
    }

    rows.push({
      mergeGroupId: val(plan.mergeGroupId),
      mode: applyRequested ? 'apply' : 'dry-run',
      status,
      blockers: [...new Set(blockers)],
      warnings: validation.warnings,
      master: {
        id: val(master?.id || plan.master?.id),
        title: val(master?.title || plan.master?.title),
        slug: val(master?.slug || plan.master?.slug),
        source: sourceOf(master || plan.master),
        hasAniListTrace: Boolean(master && hasAniListTrace(master)),
      },
      supplement: {
        id: val(supplement?.id || plannedSupplement?.id),
        title: val(supplement?.title || plannedSupplement?.title),
        slug: val(supplement?.slug || plannedSupplement?.slug),
        siteId: val(supplement?.siteId || plannedSupplement?.siteId),
        source: sourceOf(supplement || plannedSupplement),
        beforeIsLiteVisible,
        afterIsLiteVisible,
        isFullVisible: supplement?.isFullVisible ?? null,
        status: val(supplement?.status),
        draftStatus: val(supplement?._status),
        reviewStatus: val(supplement?.reviewStatus),
        evidenceStrength: val(supplement?.evidenceStrength),
      },
      patchSent,
      safety: {
        payloadRead: true,
        payloadWrite: patchSent,
        directPostgresqlWrite: false,
        onlyLiteVisibilityChanged: true,
        deleted: false,
        archived: false,
        statusChanged: false,
        reviewStatusChanged: false,
        evidenceStrengthChanged: false,
      },
    })
  }

  const ready = rows.filter((row) => ['would_hide', 'hidden', 'already_hidden'].includes(row.status))
  const blocked = rows.filter((row) => row.status === 'blocked')
  const warnings = rows.flatMap((row) => row.warnings || [])
  const blockers = rows.flatMap((row) => row.blockers || [])
  const patchSentSupplements = rows.filter((row) => row.patchSent).length

  const outputs = {
    rows: path.join(outDir, 'work-merge-stage2-supplement-lite-hide-v01.rows.jsonl'),
    ready: path.join(outDir, 'work-merge-stage2-supplement-lite-hide-v01-ready.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-stage2-supplement-lite-hide-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-stage2-supplement-lite-hide-v01-summary.json'),
    json: path.join(outDir, 'work-merge-stage2-supplement-lite-hide-v01.json'),
    md: path.join(outDir, 'work-merge-stage2-supplement-lite-hide-v01.md'),
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
    readyGroups: ready.length,
    blockedGroups: blocked.length,
    wouldHideSupplements: rows.filter((row) => row.status === 'would_hide').length,
    hiddenSupplements: rows.filter((row) => row.status === 'hidden').length,
    alreadyHiddenSupplements: rows.filter((row) => row.status === 'already_hidden').length,
    patchSentSupplements,
    byStatus: countBy(rows, 'status'),
    byWarning: countBy(warnings, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      applyRequested,
      confirmMatched,
      readOnly: !applyRequested,
      payloadRead: true,
      payloadWrite: patchSentSupplements > 0,
      payloadPatchRequests: patchSentSupplements,
      directPostgresqlWrite: false,
      onlyLiteVisibilityChanged: true,
      deleted: false,
      archived: false,
      statusChanged: false,
      reviewStatusChanged: false,
      evidenceStrengthChanged: false,
    },
  }

  const samples = { ready: ready.slice(0, 30), blocked: blocked.slice(0, 30) }
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
