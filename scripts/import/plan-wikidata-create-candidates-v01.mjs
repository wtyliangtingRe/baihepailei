#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'wikidata-create-candidates-plan-v0.1'
const DEFAULT_INPUTS = [
  'data_local/staging/wikidata-work-integration/wikidata-work-integration-v01-create-candidates.jsonl',
  'data_local/staging/wikidata-adult-marked/wikidata-adult-marked-v01-create-candidates.jsonl',
]
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-create-candidates'
const PAGE_LIMIT = 200
const MAX_SEARCH_TEXT_ADDITIONS = 24
const TITLE_SEPARATOR_RE = /[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu
const INVISIBLE_TITLE_RE = /[\u200b\u200c\u200d\u2060\ufeff]/gu
const CJKISH_TITLE_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]/u
const ADULT_ADVISORIES = ['suggestive', 'erotica', 'pornographic', 'doujinshi_or_extra']
const RESTRICTED_ADVISORIES = ['restricted']

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function parseArgs(argv) {
  const args = { input: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = key === 'input' ? args.input : true
    else {
      if (key === 'input') args.input.push(next)
      else args[key] = next
      i += 1
    }
  }
  return args
}

function cleanLine(value) {
  return val(value)
    .normalize('NFKC')
    .replace(INVISIBLE_TITLE_RE, '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(TITLE_SEPARATOR_RE, ' ')
    .trim()
}

function repairInternalTitleSpaces(value) {
  let text = cleanLine(value)
  for (let i = 0; i < 8; i += 1) {
    const next = text
      .replace(/([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])/gu, '$1$2')
      .replace(/([～〜・《「『【（(])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])/gu, '$1$2')
      .replace(/([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([）》」』】、。！？：；,.!?])/gu, '$1$2')
      .replace(/([A-Za-z])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([級级])/gu, '$1$2')
      .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([!！?？])/gu, '$1')
      .replace(TITLE_SEPARATOR_RE, ' ')
      .trim()
    if (next === text) break
    text = next
  }
  return text
}

function suspiciousTitleSpaceScore(value) {
  const text = cleanLine(value)
  let score = 0
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]/gu) || []).length
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[）》」』】、。！？：；,.!?]/gu) || []).length
  score += (text.match(/[A-Za-z][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[級级]/gu) || []).length
  return score
}

function isInternalMediaKey(value) {
  return /^(ANIME|MANGA|NOVEL|GAME)-\d+$/iu.test(val(value))
}

function cleanTitleText(value) {
  const out = repairInternalTitleSpaces(value)
  if (!out || isInternalMediaKey(out)) return ''
  return out
}

function normalizeText(value) {
  return cleanTitleText(value).normalize('NFKC').toLowerCase()
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

function uniqueTitleValues(values) {
  return uniqueBy((values || []).map(cleanTitleText).filter(Boolean), normalizeText)
}

function readJsonlIfExists(file) {
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => ({ ...JSON.parse(line), __inputFile: file }))
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

function qidOf(row) {
  return val(row.qid || row.wikidataQid || row.key).match(/^Q\d+$/iu)?.[0]?.toUpperCase() || ''
}

function dedupeKey(row) {
  const qid = qidOf(row)
  if (qid) return qid
  const title = titleOf(row)
  return title ? `title:${normalizeText(title)}` : val(row.key || JSON.stringify(row).slice(0, 300))
}

function wikidataUrl(qid) {
  return qid ? `https://www.wikidata.org/wiki/${qid}` : ''
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
    .filter((item) => item.source || item.externalId || item.url || item.note)
}

function advisoriesOf(row) {
  const values = [
    ...list(row?.contentAdvisories),
    ...list(row?.refinement?.contentAdvisories),
    ...list(row?.rawAuditRow?.contentAdvisories),
  ].map(cleanLine).filter(Boolean)
  const haystack = [
    values.join('\n'),
    list(row?.blockers).join('\n'),
    list(row?.warnings).join('\n'),
    list(row?.rawAuditRow?.blockers).join('\n'),
    list(row?.rawAuditRow?.warnings).join('\n'),
    JSON.stringify(row?.candidateFlags || {}),
    JSON.stringify(row?.rawAuditRow?.candidateFlags || {}),
    JSON.stringify(row?.fieldAdditions?.candidateSources || {}),
  ].join('\n').toLowerCase()
  if (/suggestive/u.test(haystack)) values.push('suggestive')
  if (/erotica/u.test(haystack)) values.push('erotica')
  if (/pornographic/u.test(haystack)) values.push('pornographic')
  if (/doujinshi|loose extra/u.test(haystack)) values.push('doujinshi_or_extra')
  if (/restricted|hidden|quarantine/u.test(haystack)) values.push('restricted')
  return uniqueBy(values, (item) => item)
}

function visibilityFromAdvisories(advisories) {
  if (advisories.some((item) => RESTRICTED_ADVISORIES.includes(item))) return 'restricted'
  if (advisories.some((item) => ADULT_ADVISORIES.includes(item))) return 'adult'
  return 'ordinary'
}

function previewOf(row) {
  return row?.createCandidatePreview || row?.rewriteCandidatePreview || row?.rawAuditRow?.createCandidatePreview || {}
}

function titleOf(row) {
  const preview = previewOf(row)
  return cleanTitleText(row?.fieldUpdates?.title || preview.proposedTitle || preview.title || row?.title || list(row?.titleCandidates)[0] || list(row?.fieldAdditions?.searchTextAdditions)[0])
}

function originalTitleOf(row, title) {
  const preview = previewOf(row)
  return cleanTitleText(row?.fieldUpdates?.originalTitle || preview.proposedOriginalTitle || preview.originalTitle || title)
}

function titleCandidatesOf(row) {
  const preview = previewOf(row)
  return uniqueTitleValues([
    titleOf(row),
    originalTitleOf(row, titleOf(row)),
    row?.fieldUpdates?.title,
    row?.fieldUpdates?.originalTitle,
    preview.proposedTitle,
    preview.proposedOriginalTitle,
    preview.title,
    preview.originalTitle,
    ...list(row?.fieldAdditions?.searchTextAdditions),
    ...list(preview.proposedSearchTextAdditions),
    ...list(row?.titleCandidates),
    ...list(row?.matchedTitles),
  ]).slice(0, MAX_SEARCH_TEXT_ADDITIONS)
}

function slugifyAscii(value) {
  return cleanLine(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 72)
}

function slugOf(row, title, qid) {
  if (qid) return `wikidata-${qid.toLowerCase()}`
  const base = slugifyAscii(title) || 'wikidata-create-candidate'
  return base.slice(0, 80)
}

function sourceLinksOf(row, qid) {
  return uniqueBy([
    ...sourceLinkRows({ sourceLinks: row?.fieldAdditions?.sourceLinks }),
    ...(qid ? [{ label: 'Wikidata', url: wikidataUrl(qid) }] : []),
  ], (item) => val(item.url).toLowerCase())
}

function candidateSourcesOf(row, qid, advisories, visibility) {
  const existing = candidateSourceRows({ candidateSources: row?.fieldAdditions?.candidateSources })
  const url = wikidataUrl(qid)
  const ratingText = advisories.map((item) => `contentRating=${item}`).join('; ')
  const note = [
    ratingText,
    visibility !== 'ordinary' ? `contentVisibility=${visibility}` : '',
    visibility !== 'ordinary' ? 'adultOrMarkedContent=true' : '',
    'Wikidata create candidate; created from local review-ready candidate row; manual review required',
  ].filter(Boolean).join('; ')
  return uniqueBy([
    ...existing,
    { source: 'wikidata', label: 'Wikidata', externalId: qid, url, note },
  ], (item) => [val(item.source).toLowerCase(), val(item.externalId).toUpperCase(), val(item.url).toLowerCase(), val(item.note)].join('|'))
}

function exactTitleSet(work) {
  return new Set([
    work?.title,
    work?.originalTitle,
    ...list(work?.aliases).map((item) => item?.value),
    ...(val(work?.searchText) ? val(work.searchText).split(/[\r\n|]+/u) : []),
  ].map(normalizeText).filter(Boolean))
}

function buildExistingIndexes(works) {
  const qid = new Map()
  const slug = new Map()
  const siteId = new Map()
  const title = new Map()
  for (const work of works) {
    const ids = externalIdsOf(work)
    if (ids.wikidataQid) qid.set(ids.wikidataQid.toUpperCase(), work)
    if (val(work.slug)) slug.set(val(work.slug).toLowerCase(), work)
    if (val(work.siteId)) siteId.set(val(work.siteId).toUpperCase(), work)
    for (const key of exactTitleSet(work)) {
      if (!title.has(key)) title.set(key, [])
      title.get(key).push(work)
    }
  }
  return { qid, slug, siteId, title }
}

function sourceType(row, visibility) {
  if (visibility !== 'ordinary') return 'adult'
  if (val(row.__inputFile).includes('adult')) return 'adult'
  return 'ordinary'
}

function buildPlan(row, indexes) {
  const qid = qidOf(row)
  const advisories = advisoriesOf(row)
  const visibility = visibilityFromAdvisories(advisories)
  const title = titleOf(row)
  const originalTitle = originalTitleOf(row, title)
  const slug = slugOf(row, title, qid)
  const siteId = qid ? `WIKIDATA-${qid}` : ''
  const searchTextAdditions = titleCandidatesOf(row)
  const sourceLinks = sourceLinksOf(row, qid)
  const candidateSources = candidateSourcesOf(row, qid, advisories, visibility)
  const blockers = []
  const matchedExisting = []

  if (!qid) blockers.push('missing_wikidata_qid')
  if (!title) blockers.push('missing_title')
  if (isInternalMediaKey(title) || searchTextAdditions.some(isInternalMediaKey)) blockers.push('internal_media_key_in_write_fields')
  for (const item of [title, originalTitle, ...searchTextAdditions]) {
    if (suspiciousTitleSpaceScore(item) > 0) blockers.push('suspicious_title_spacing_after_cleaning')
    if (CJKISH_TITLE_RE.test(item) && /^\s|\s$/u.test(item)) blockers.push('suspicious_title_edge_spacing_after_cleaning')
  }
  if (qid && indexes.qid.has(qid)) matchedExisting.push({ by: 'wikidataQid', id: indexes.qid.get(qid).id, title: indexes.qid.get(qid).title })
  if (slug && indexes.slug.has(slug.toLowerCase())) matchedExisting.push({ by: 'slug', id: indexes.slug.get(slug.toLowerCase()).id, title: indexes.slug.get(slug.toLowerCase()).title })
  if (siteId && indexes.siteId.has(siteId.toUpperCase())) matchedExisting.push({ by: 'siteId', id: indexes.siteId.get(siteId.toUpperCase()).id, title: indexes.siteId.get(siteId.toUpperCase()).title })
  const exactMatches = uniqueBy(searchTextAdditions.flatMap((item) => indexes.title.get(normalizeText(item)) || []), (work) => val(work.id))
  if (exactMatches.length) matchedExisting.push(...exactMatches.slice(0, 5).map((work) => ({ by: 'exact_title_or_search_text', id: work.id, title: work.title })))
  if (matchedExisting.length) blockers.push('possible_existing_work_match')

  const contentType = sourceType(row, visibility)
  if (contentType === 'adult' && visibility === 'ordinary') blockers.push('adult_input_missing_adult_visibility')
  if (contentType === 'adult') {
    const notes = candidateSources.map((item) => val(item.note).toLowerCase()).join('\n')
    if (!/contentrating=/u.test(notes) || !/adultormarkedcontent=true/u.test(notes)) blockers.push('missing_adult_marker_note')
  }

  const payload = {
    title,
    slug,
    siteId,
    originalTitle,
    chosenBaseSource: 'wikidata',
    reviewStatus: 'pending',
    reviewReasons: contentType === 'adult' ? ['wikidata_candidate_review', 'wikidata_quarantine'] : ['wikidata_candidate_review'],
    ratingNotice: 'ai_synthesized_pending_review',
    evidenceStrength: 'weak',
    importBatch: 'wikidata-create-candidates-v01',
    sourceConflictNotes: contentType === 'adult'
      ? 'Created from Wikidata adult/marked create candidate flow; hidden from ordinary mode by candidate source note until reviewed.'
      : 'Created from Wikidata create candidate flow; pending manual review.',
    externalIds: { wikidataQid: qid },
    sourceLinks,
    candidateSources,
    searchText: searchTextAdditions.join('\n'),
    evidenceNote: [
      `Wikidata create candidate ${qid}`,
      `contentVisibility=${visibility}`,
      `sourceInput=${row.__inputFile}`,
      'Created by guarded local create workflow; verify before public curation.',
    ].filter(Boolean).join('\n'),
    status: 'draft',
  }

  return {
    key: dedupeKey(row),
    qid,
    wikidataUrl: wikidataUrl(qid),
    contentVisibility: visibility,
    contentAdvisories: advisories,
    createType: contentType,
    action: contentType === 'adult' ? 'create_adult_wikidata_work_candidate' : 'create_wikidata_work_candidate',
    planStatus: blockers.length ? 'blocked_or_review_required' : 'ready_for_create_dry_run',
    blockers: uniqueBy(blockers, (item) => item),
    warnings: uniqueBy([
      ...list(row?.warnings),
      ...list(row?.rawAuditRow?.warnings),
      contentType === 'adult' ? 'adult_or_marked_create_candidate' : '',
    ].map(cleanLine).filter(Boolean), (item) => item),
    matchedExisting: uniqueBy(matchedExisting, (item) => `${item.by}:${item.id}`),
    payload,
    titleCandidates: searchTextAdditions,
    raw: {
      inputFile: row.__inputFile,
      originalKey: row.key,
      originalAction: row.action,
      originalPlanStatus: row.planStatus,
      originalBlockers: row.blockers,
      rawAuditRow: row.rawAuditRow,
    },
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      futureApplyMustBeGuarded: true,
      futureApplyWritableFields: Object.keys(payload),
      doesNotWriteDates: true,
      doesNotWriteMediaTypeOrRiskFields: true,
      createsOnlyDraftWorks: true,
    },
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return payload
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchAllWorks(baseUrl, token, depth = 0) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const inputs = args.input.length ? args.input : DEFAULT_INPUTS
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const limit = Number(args.limit || 0)
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars')

  const sourceRows = inputs.flatMap(readJsonlIfExists)
  const dedupedRows = uniqueBy(sourceRows, dedupeKey)
  const rowsToProcess = limit > 0 ? dedupedRows.slice(0, limit) : dedupedRows
  const login = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  const token = login?.token
  if (!token) throw new Error('Payload login did not return a token')
  const works = await fetchAllWorks(baseUrl, token, 0)
  const indexes = buildExistingIndexes(works.docs)

  const plans = rowsToProcess.map((row) => buildPlan(row, indexes))
  const ready = plans.filter((row) => row.planStatus === 'ready_for_create_dry_run')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_create_dry_run')

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    rows: `${outDir}/wikidata-create-candidates-v01.rows.jsonl`,
    ready: `${outDir}/wikidata-create-candidates-v01-ready.jsonl`,
    blocked: `${outDir}/wikidata-create-candidates-v01-blocked.jsonl`,
    ordinaryReady: `${outDir}/wikidata-create-candidates-v01-ordinary-ready.jsonl`,
    adultReady: `${outDir}/wikidata-create-candidates-v01-adult-ready.jsonl`,
    sample: `${outDir}/wikidata-create-candidates-v01-sample.jsonl`,
    summary: `${outDir}/wikidata-create-candidates-v01-summary.json`,
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    inputs,
    inputRowsRead: sourceRows.length,
    inputRowsDeduped: dedupedRows.length,
    rowsProcessed: rowsToProcess.length,
    payloadBaseUrl: baseUrl,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    readyRows: ready.length,
    blockedRows: blocked.length,
    byCreateType: countBy(plans, 'createType'),
    byAction: countBy(plans, 'action'),
    byPlanStatus: countBy(plans, 'planStatus'),
    byContentVisibility: countBy(plans, 'contentVisibility'),
    byContentAdvisory: countBy(plans.flatMap((row) => row.contentAdvisories), (item) => item),
    byBlocker: countBy(plans.flatMap((row) => row.blockers), (item) => item),
    byWarning: countBy(plans.flatMap((row) => row.warnings), (item) => item),
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      futureApplyMustBeGuarded: true,
      createsOnlyDraftWorks: true,
      blocksPossibleExistingWorkMatches: true,
      doesNotWriteDates: true,
      doesNotWriteMediaTypeOrRiskFields: true,
      adultRowsRequireAdultMarkerNote: true,
    },
    nextStep: 'Review ready and blocked samples. Then run guarded create dry-run before any --apply.',
  }

  writeJsonl(outputs.rows, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.ordinaryReady, ready.filter((row) => row.createType === 'ordinary'))
  writeJsonl(outputs.adultReady, ready.filter((row) => row.createType === 'adult'))
  writeJsonl(outputs.sample, [...ready.slice(0, 80), ...blocked.slice(0, 80)])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
