#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'wikidata-rewrite-candidates-plan-v0.1'
const DEFAULT_INPUT = 'data_local/staging/wikidata-work-integration/wikidata-work-integration-v01-rewrite-candidates.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-rewrite-candidates'
const PAGE_LIMIT = 200
const SOURCE_MARKERS = ['bangumi', 'mangadex', 'ndl', 'wikidata']
const TARGET_ACTION = 'propose_wikidata_rewrite_existing_unmarked_work'
const TARGET_MATCH_STATUS = 'matched_by_title_without_higher_priority_marker'
const ALLOWED_ORIGINAL_BLOCKERS = new Set([
  'matched_existing_work_without_higher_priority_marker_rewrite_review_required',
])
const ALLOWED_ORIGINAL_WARNINGS = new Set([
  'has_search_text_additions',
  'has_source_metadata_additions',
])
const MAX_SEARCH_TEXT_ADDITIONS = 12

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

function list(value) {
  return Array.isArray(value) ? value : []
}

function cleanLine(value) {
  return val(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ')
}

function normalizeText(value) {
  return cleanLine(value).normalize('NFKC').toLowerCase()
}

function uniqueBy(values, getKey = normalizeText) {
  const seen = new Set()
  const out = []
  for (const item of values || []) {
    const key = getKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row?.[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function sourceLinkRows(doc) {
  return list(doc?.sourceLinks)
    .map((item) => ({ label: val(item?.label), url: val(item?.url).replace(/\/+$/u, '') }))
    .filter((item) => item.url)
}

function candidateSourceRows(doc) {
  return list(doc?.candidateSources)
    .map((item) => ({
      source: val(item?.source),
      label: val(item?.label),
      externalId: val(item?.externalId),
      url: val(item?.url).replace(/\/+$/u, ''),
      note: val(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url)
}

function sourceMarkerText(work) {
  return [
    work?.siteId,
    work?.originalSource,
    work?.source,
    ...sourceLinkRows(work).flatMap((item) => [item.label, item.url]),
    ...candidateSourceRows(work).flatMap((item) => [item.source, item.label, item.externalId, item.url, item.note]),
  ].map((item) => val(item).toLowerCase()).join('\n')
}

function sourceMarkersOf(work) {
  const ids = externalIdsOf(work)
  const haystack = sourceMarkerText(work)
  const markers = new Set()
  if (ids.bangumiSubjectId || /bangumi|bgm\.tv|bangumi\.tv/u.test(haystack)) markers.add('bangumi')
  if (/mangadex/u.test(haystack)) markers.add('mangadex')
  if (/\bndl\b|iss\.ndl\.go\.jp|id\.ndl\.go\.jp/u.test(haystack)) markers.add('ndl')
  if (ids.wikidataQid || /wikidata|wikidata\.org/u.test(haystack)) markers.add('wikidata')
  return SOURCE_MARKERS.filter((marker) => markers.has(marker))
}

function wikidataUrl(qid) {
  return qid ? `https://www.wikidata.org/wiki/${qid}` : ''
}

function isInternalMediaKey(value) {
  return /^(ANIME|MANGA|NOVEL|GAME)-\d+$/iu.test(val(value))
}

function cleanSearchTextAdditions(row) {
  return uniqueBy(list(row?.fieldAdditions?.searchTextAdditions).map(cleanLine).filter((item) => item && !isInternalMediaKey(item)), normalizeText)
}

function buildWikiSourceLink(row) {
  const url = wikidataUrl(row.qid)
  return url ? [{ label: 'Wikidata', url }] : []
}

function buildWikiCandidateSource(row) {
  const url = wikidataUrl(row.qid)
  if (!row.qid && !url) return []
  return [{
    source: 'wikidata',
    label: 'Wikidata',
    externalId: row.qid,
    url,
    note: 'Wikidata rewrite candidate marker; source priority marker for future imports',
  }]
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
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return payload
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchAllWorks(baseUrl, token, depth = 1) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0
  do {
    const params = new URLSearchParams()
    params.set('limit', String(PAGE_LIMIT))
    params.set('page', String(page))
    params.set('depth', String(depth))
    params.set('draft', 'true')
    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    totalDocs = Number(result?.totalDocs || docs.length)
    page += 1
  } while (page <= totalPages)
  return { docs, totalDocs }
}

function validatePlan(row, work) {
  const blockers = []
  const warnings = []
  const originalBlockers = list(row.blockers)
  const originalWarnings = list(row.warnings)
  const disallowedOriginalBlockers = originalBlockers.filter((item) => !ALLOWED_ORIGINAL_BLOCKERS.has(item))
  const disallowedOriginalWarnings = originalWarnings.filter((item) => !ALLOWED_ORIGINAL_WARNINGS.has(item) && !String(item).startsWith('alignment_status_review:'))
  const additions = cleanSearchTextAdditions(row)
  const currentMarkers = work ? sourceMarkersOf(work) : []
  const ids = work ? externalIdsOf(work) : {}

  if (val(row.action) !== TARGET_ACTION) blockers.push('unexpected_action')
  if (val(row.matchStatus) !== TARGET_MATCH_STATUS) blockers.push('unexpected_match_status')
  if (!val(row.qid)) blockers.push('missing_wikidata_qid')
  if (!val(row.work?.id)) blockers.push('missing_audit_work_id')
  if (!work?.id) blockers.push('current_work_not_found')
  if (work?.id && val(work.id) !== val(row.work?.id)) blockers.push('current_work_id_mismatch')
  if (disallowedOriginalBlockers.length) blockers.push(...disallowedOriginalBlockers.map((item) => `original_blocker:${item}`))
  if (disallowedOriginalWarnings.length) warnings.push(...disallowedOriginalWarnings.map((item) => `original_warning:${item}`))
  if (list(row.contentAdvisories).length) blockers.push('content_advisory_requires_marked_content_flow')
  if (row.candidateFlags?.bestMaybeCompany) blockers.push('candidate_maybe_company')
  if (row.candidateFlags?.bestMaybeRealPersonOrLiveAction) blockers.push('candidate_maybe_real_person_or_live_action')
  if (row.candidateFlags?.bestMaybeWork === false) blockers.push('candidate_not_marked_as_work')
  if (val(row.candidateFlags?.alignmentStatus) !== 'high') blockers.push(`alignment_status_not_high:${val(row.candidateFlags?.alignmentStatus) || 'missing'}`)
  if (!list(row.matchedTitles).length) blockers.push('missing_exact_matched_title')
  if (!additions.length) blockers.push('no_clean_search_text_additions')
  if (additions.length > MAX_SEARCH_TEXT_ADDITIONS) blockers.push('too_many_search_text_additions')
  if (ids.wikidataQid && ids.wikidataQid.toUpperCase() !== val(row.qid).toUpperCase()) blockers.push('current_wikidata_qid_conflict')

  if (currentMarkers.length) {
    if (currentMarkers.includes('wikidata') && ids.wikidataQid?.toUpperCase() === val(row.qid).toUpperCase()) warnings.push('current_work_already_has_same_wikidata_marker')
    else blockers.push(`current_work_already_has_source_marker:${currentMarkers.join(',')}`)
  }

  return {
    blockers: uniqueBy(blockers, (item) => item),
    warnings: uniqueBy(warnings, (item) => item),
    currentMarkers,
    searchTextAdditions: additions,
  }
}

function planRow(row, work) {
  const qid = val(row.qid)
  const validation = validatePlan(row, work)
  const ids = work ? externalIdsOf(work) : {}
  const sourceLinks = buildWikiSourceLink({ qid })
  const candidateSources = buildWikiCandidateSource({ qid })
  const externalIds = qid && !ids.wikidataQid ? { wikidataQid: qid } : {}

  return {
    key: qid || row.key,
    qid,
    wikidataUrl: wikidataUrl(qid),
    work: work ? {
      id: val(work.id),
      title: val(work.title),
      slug: val(work.slug),
      sourceMarkers: validation.currentMarkers,
      currentWikidataQid: ids.wikidataQid || '',
    } : row.work || null,
    action: 'attach_wikidata_marker_to_rewrite_candidate',
    planStatus: validation.blockers.length ? 'blocked_or_review_required' : 'ready_for_apply_review',
    confidence: validation.blockers.length ? 'manual_review' : 'high',
    blockers: validation.blockers,
    warnings: validation.warnings,
    matchedTitles: list(row.matchedTitles),
    titleCandidates: list(row.titleCandidates),
    descriptionCandidates: list(row.descriptionCandidates),
    rewriteCandidatePreview: row.rewriteCandidatePreview || null,
    fieldAdditions: {
      searchTextAdditions: validation.searchTextAdditions,
      externalIds,
      sourceLinks,
      candidateSources,
    },
    sourceMarkerPolicy: {
      currentImportRecognizesMarkers: SOURCE_MARKERS,
      attachesMarker: 'wikidata',
      markerFields: ['externalIds.wikidataQid', 'sourceLinks[label=Wikidata]', 'candidateSources[source=wikidata]'],
    },
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      futureApplyWrites: ['searchText', 'externalIds.wikidataQid', 'sourceLinks', 'candidateSources'],
      doesNotWritePrimaryFields: true,
      primaryRewritePreviewOnly: true,
    },
    rawAuditRow: {
      key: row.key,
      action: row.action,
      matchStatus: row.matchStatus,
      candidateFlags: row.candidateFlags,
      blockers: row.blockers,
      warnings: row.warnings,
      contentAdvisories: row.contentAdvisories,
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const limit = Number(args.limit || 0)
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars')

  const allRows = readJsonl(input)
  const rowsToProcess = limit > 0 ? allRows.slice(0, limit) : allRows
  const login = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  const token = login?.token
  if (!token) throw new Error('Payload login did not return a token')
  const works = await fetchAllWorks(baseUrl, token, 1)
  const workById = new Map(works.docs.map((work) => [val(work.id), work]))
  const plans = rowsToProcess.map((row) => planRow(row, workById.get(val(row.work?.id))))
  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const adultOrMarked = plans.filter((row) => list(row.rawAuditRow?.contentAdvisories).length)

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    rows: `${outDir}/wikidata-rewrite-candidates-v01.rows.jsonl`,
    ready: `${outDir}/wikidata-rewrite-candidates-v01-ready.jsonl`,
    blocked: `${outDir}/wikidata-rewrite-candidates-v01-blocked.jsonl`,
    adultOrMarked: `${outDir}/wikidata-rewrite-candidates-v01-adult-or-marked.jsonl`,
    sample: `${outDir}/wikidata-rewrite-candidates-v01-sample.jsonl`,
    summary: `${outDir}/wikidata-rewrite-candidates-v01-summary.json`,
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    payloadBaseUrl: baseUrl,
    sourceRowsRead: allRows.length,
    rowsProcessed: rowsToProcess.length,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    readyRows: ready.length,
    blockedRows: blocked.length,
    adultOrMarkedRows: adultOrMarked.length,
    byPlanStatus: countBy(plans, 'planStatus'),
    byConfidence: countBy(plans, 'confidence'),
    byBlocker: countBy(plans.flatMap((row) => row.blockers), (item) => item),
    byWarning: countBy(plans.flatMap((row) => row.warnings), (item) => item),
    byCurrentSourceMarker: countBy(plans.flatMap((row) => row.work?.sourceMarkers || []), (item) => item),
    byChangedField: countBy(plans.flatMap((row) => Object.entries(row.fieldAdditions).filter(([, value]) => Array.isArray(value) ? value.length : Object.keys(value || {}).length).map(([key]) => key)), (item) => item),
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      futureApplyWritableFields: ['searchText', 'externalIds.wikidataQid', 'sourceLinks', 'candidateSources'],
      primaryRewritePreviewOnly: true,
      sourceMarkersRecognizedForFutureImports: SOURCE_MARKERS,
    },
    nextStep: 'Review ready rows. Future guarded apply should attach Wikidata marker and searchText only; primary title rewrite remains preview-only.',
  }

  writeJsonl(outputs.rows, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.adultOrMarked, adultOrMarked)
  writeJsonl(outputs.sample, [...ready.slice(0, 50), ...blocked.slice(0, 50)])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
