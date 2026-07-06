#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-strict-review-rerank-v01-auto-ready.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-stage2-plan-v0.1'
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

function differenceBy(before, after, getKey) {
  const beforeKeys = new Set(before.map(getKey).filter(Boolean))
  return after.filter((item) => !beforeKeys.has(getKey(item)))
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

function plannedExternalIds(row) {
  const ids = row?.preservedDataPreview?.externalIds || row?.stage2Evidence?.plannedExternalIds || {}
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function plannedTitles(row) {
  const values = [
    row?.master?.title,
    ...(Array.isArray(row?.master?.titles) ? row.master.titles : []),
    ...((row?.supplements || []).flatMap((doc) => [doc.title, ...(Array.isArray(doc.titles) ? doc.titles : [])])),
    ...(Array.isArray(row?.preservedDataPreview?.titles) ? row.preservedDataPreview.titles : []),
  ]
  return uniqueBy(values.map(val).filter(Boolean), normalizeText)
}

function plannedSourceLinks(row) {
  const preserved = Array.isArray(row?.preservedDataPreview?.sourceLinks) ? row.preservedDataPreview.sourceLinks : []
  return uniqueBy(
    preserved
      .map((item) => ({ label: val(item?.label), url: normalizeUrl(item?.url) }))
      .filter((item) => item.url),
    (item) => item.url,
  )
}

function plannedCandidateSources(row) {
  const preserved = Array.isArray(row?.preservedDataPreview?.candidateSources) ? row.preservedDataPreview.candidateSources : []
  return uniqueBy(
    preserved
      .map((item) => ({
        source: val(item?.source),
        label: val(item?.label),
        externalId: val(item?.externalId),
        url: normalizeUrl(item?.url),
        note: val(item?.note),
      }))
      .filter((item) => item.source || item.externalId || item.url),
    (item) => [item.source, item.externalId, item.url].join('|'),
  )
}

function externalIdPlan(masterDoc, plannedIds) {
  const merged = { ...externalIdsOf(masterDoc) }
  const additions = {}
  const conflicts = []
  for (const [field, rawValue] of Object.entries(plannedIds)) {
    const value = val(rawValue)
    if (!value) continue
    const existing = val(merged[field])
    if (!existing) {
      merged[field] = value
      additions[field] = value
    } else if (existing !== value) {
      conflicts.push({ field, existing, incoming: value })
    }
  }
  return { merged, additions, conflicts }
}

function buildPlan(row, docsById) {
  const blockers = []
  const warnings = []
  const supplementRows = Array.isArray(row?.supplements) ? row.supplements : []
  const supplementRow = supplementRows[0] || null
  const masterDoc = docsById.get(val(row?.master?.id))
  const supplementDoc = docsById.get(val(supplementRow?.id))

  if (row.stage2Bucket !== 'auto_ready') blockers.push('not_stage2_auto_ready')
  if (!masterDoc) blockers.push('master_not_found')
  if (!supplementDoc) blockers.push('supplement_not_found')
  if (supplementRows.length !== 1) blockers.push('expected_one_supplement')
  if (masterDoc && sourceOf(masterDoc) !== 'bangumi') blockers.push('master_source_not_bangumi')
  if (supplementDoc && sourceOf(supplementDoc) !== 'anilist') blockers.push('supplement_source_not_anilist')

  const plannedIds = plannedExternalIds(row)
  const ids = externalIdPlan(masterDoc, plannedIds)
  if (ids.conflicts.length) blockers.push('external_id_conflict')
  if (!ids.merged.bangumiSubjectId) warnings.push('missing_bangumi_id')
  if (!ids.merged.anilistMediaId) warnings.push('missing_anilist_id')
  if (supplementDoc && supplementDoc.isLiteVisible === false) warnings.push('supplement_already_lite_hidden')

  const beforeTitles = [masterDoc?.title, ...localizedTitleRows(masterDoc).map((item) => item.title)].map(val).filter(Boolean)
  const beforeLinks = sourceLinkRows(masterDoc)
  const beforeSources = candidateSourceRows(masterDoc)
  const titles = plannedTitles(row)
  const links = plannedSourceLinks(row)
  const sources = plannedCandidateSources(row)

  const fieldAdditions = {
    externalIds: ids.additions,
    titles: differenceBy(beforeTitles, titles, normalizeText),
    sourceLinks: differenceBy(beforeLinks, links, (item) => normalizeUrl(item.url)),
    candidateSources: differenceBy(beforeSources, sources, (item) => [val(item.source), val(item.externalId), normalizeUrl(item.url)].join('|')),
  }

  const changedFields = []
  if (Object.keys(fieldAdditions.externalIds).length) changedFields.push('externalIds')
  if (fieldAdditions.titles.length) changedFields.push('titles')
  if (fieldAdditions.sourceLinks.length) changedFields.push('sourceLinks')
  if (fieldAdditions.candidateSources.length) changedFields.push('candidateSources')
  if (!changedFields.length) warnings.push('no_new_master_fields')

  const precheckStatus = blockers.length ? 'blocked' : 'ready_for_apply_review'

  return {
    mergeGroupId: val(row.mergeGroupId || row.groupId),
    stage2Bucket: val(row.stage2Bucket),
    precheckStatus,
    planStatus: precheckStatus,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    changedFields,
    master: {
      id: val(masterDoc?.id || row?.master?.id),
      title: val(masterDoc?.title || row?.master?.title),
      slug: val(masterDoc?.slug || row?.master?.slug),
      siteId: val(masterDoc?.siteId || row?.master?.siteId),
      source: sourceOf(masterDoc || row?.master),
      isLiteVisible: masterDoc?.isLiteVisible ?? null,
      isFullVisible: masterDoc?.isFullVisible ?? null,
    },
    supplements: supplementRows.map((item) => {
      const current = docsById.get(val(item.id))
      return {
        id: val(current?.id || item.id),
        title: val(current?.title || item.title),
        slug: val(current?.slug || item.slug),
        siteId: val(current?.siteId || item.siteId),
        source: sourceOf(current || item),
        isLiteVisible: current?.isLiteVisible ?? null,
        isFullVisible: current?.isFullVisible ?? null,
      }
    }),
    fieldAdditions,
    mergedFieldPreview: {
      externalIds: ids.merged,
      titles: uniqueBy([...beforeTitles, ...fieldAdditions.titles], normalizeText),
      sourceLinks: uniqueBy([...beforeLinks, ...fieldAdditions.sourceLinks], (item) => normalizeUrl(item.url)),
      candidateSources: uniqueBy([...beforeSources, ...fieldAdditions.candidateSources], (item) => [val(item.source), val(item.externalId), normalizeUrl(item.url)].join('|')),
    },
    followUpPolicyPreview: {
      keepMasterAsCanonical: true,
      keepSupplementAsLowerPrioritySourceRecordUntilSeparateVisibilityStep: true,
      doNotDeleteAnyRecordInThisStep: true,
      requireSeparateApplyApproval: true,
      likelyNextAfterApply: 'hide_stage2_supplement_lite_visibility',
    },
    safety: {
      localReportReadOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
      executableOperation: false,
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
    '# Work Merge Stage 2 Plan v0.1',
    '',
    'Read-only master field plan and Payload precheck for stage 2 auto-ready work merge groups.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
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
    '- No data change.',
    '- No executable operation generated.',
    '',
    '## Precheck status',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...Object.entries(summary.byStatus).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Changed fields',
    '',
    '| Field | Count |',
    '|---|---:|',
    ...Object.entries(summary.byChangedField).map(([key, count]) => `| ${key} | ${count} |`),
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

  if (!fs.existsSync(inputPath)) throw new Error(`stage 2 auto-ready file not found: ${inputPath}`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const docsById = indexBy(works.docs, 'id')
  const plans = input.rows.map((row) => buildPlan(row, docsById))
  const ready = plans.filter((item) => item.precheckStatus === 'ready_for_apply_review')
  const blocked = plans.filter((item) => item.precheckStatus === 'blocked')
  const changedFields = plans.flatMap((item) => item.changedFields || [])
  const warnings = plans.flatMap((item) => item.warnings || [])
  const blockers = plans.flatMap((item) => item.blockers || [])

  const outputs = {
    plans: path.join(outDir, 'work-merge-stage2-plan-v01.plans.jsonl'),
    ready: path.join(outDir, 'work-merge-stage2-plan-v01-ready.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-stage2-plan-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-stage2-plan-v01-summary.json'),
    json: path.join(outDir, 'work-merge-stage2-plan-v01.json'),
    md: path.join(outDir, 'work-merge-stage2-plan-v01.md'),
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
    byStatus: countBy(plans, 'precheckStatus'),
    byChangedField: countBy(changedFields, (value) => value),
    byWarning: countBy(warnings, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      localReportReadOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
      executableOperation: false,
    },
  }

  const samples = { ready: ready.slice(0, 30), blocked: blocked.slice(0, 30) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.plans, plans.map((item) => JSON.stringify(item)).join('\n') + (plans.length ? '\n' : ''), 'utf8')
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
