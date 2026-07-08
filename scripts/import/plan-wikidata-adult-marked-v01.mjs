#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'wikidata-adult-marked-plan-v0.2'
const DEFAULT_INPUTS = [
  'data_local/staging/wikidata-work-integration/wikidata-work-integration-v01-adult-or-marked-candidates.jsonl',
  'data_local/staging/wikidata-rewrite-candidates/wikidata-rewrite-candidates-v01-adult-or-marked.jsonl',
]
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-adult-marked'
const PAGE_LIMIT = 200
const SOURCE_MARKERS = ['bangumi', 'mangadex', 'ndl', 'wikidata']
const ADULT_ADVISORIES = ['suggestive', 'erotica', 'pornographic', 'doujinshi_or_extra']
const RESTRICTED_ADVISORIES = ['restricted']
const MAX_SEARCH_TEXT_ADDITIONS = 20

function val(value) {
  return String(value ?? '').trim()
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

function list(value) {
  return Array.isArray(value) ? value : []
}

function cleanLine(value) {
  return val(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function repairInternalTitleSpaces(value) {
  return cleanLine(value)
    .replace(/[\u200b\u200c\u200d\ufeff]/gu, '')
    .replace(/([\u3040-\u30ff\u31f0-\u31ffー])\s+([\u3040-\u30ff\u31f0-\u31ffー])/gu, '$1$2')
    .replace(/([\u3400-\u9fff\uf900-\ufaff])\s+([\u3400-\u9fff\uf900-\ufaff])/gu, '$1$2')
    .replace(/([\uac00-\ud7af])\s+([\uac00-\ud7af])/gu, '$1$2')
    .replace(/([～〜・《「『【（(])\s+([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])/gu, '$1$2')
    .replace(/([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])\s+([）》」』】、。！？：；,.!?])/gu, '$1$2')
    .replace(/([A-Za-z])\s+([級级])/gu, '$1$2')
    .replace(/\s+([!！?？])/gu, '$1')
    .trim()
}

function suspiciousTitleSpaceScore(value) {
  const text = cleanLine(value)
  let score = 0
  score += (text.match(/[\u3040-\u30ff\u31f0-\u31ffー]\s+[\u3040-\u30ff\u31f0-\u31ffー]/gu) || []).length
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff]\s+[\u3400-\u9fff\uf900-\ufaff]/gu) || []).length
  score += (text.match(/[\uac00-\ud7af]\s+[\uac00-\ud7af]/gu) || []).length
  score += (text.match(/[～〜・《「『【（(]\s+[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]/gu) || []).length
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]\s+[）》」』】、。！？：；,.!?]/gu) || []).length
  score += (text.match(/[A-Za-z]\s+[級级]/gu) || []).length
  return score
}

function hasSuspiciousTitleSpacing(value) {
  return suspiciousTitleSpaceScore(value) > 0
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

function aliasValues(doc) {
  return list(doc?.aliases).map((item) => cleanTitleText(item?.value)).filter(Boolean)
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

function qidOf(row) {
  return val(row.qid || row.wikidataQid || row.key).match(/^Q\d+$/iu)?.[0]?.toUpperCase() || ''
}

function workIdOf(row) {
  return val(row?.work?.id || row?.matchedWork?.id || row?.rewriteCandidatePreview?.existingWorkId)
}

function planKey(row) {
  const workId = workIdOf(row)
  const qid = qidOf(row)
  return `${workId || 'no-work'}|${qid || row.key || 'no-qid'}|${row.__inputFile}`
}

function candidateTitleValues(row) {
  const preview = row?.rewriteCandidatePreview || {}
  return uniqueTitleValues([
    row?.fieldUpdates?.title,
    row?.fieldUpdates?.originalTitle,
    preview.proposedTitle,
    preview.proposedOriginalTitle,
    ...list(row?.fieldAdditions?.searchTextAdditions),
    ...list(preview.proposedSearchTextAdditions),
    ...list(row?.titleCandidates),
    ...list(row?.matchedTitles),
  ])
}

function proposedPrimaryUpdates(row, work) {
  const preview = row?.rewriteCandidatePreview || {}
  const proposedTitle = cleanTitleText(row?.fieldUpdates?.title || preview.proposedTitle)
  const proposedOriginalTitle = cleanTitleText(row?.fieldUpdates?.originalTitle || preview.proposedOriginalTitle || preview.proposedTitle)
  const updates = {}
  if (proposedTitle && normalizeText(proposedTitle) !== normalizeText(work?.title)) updates.title = proposedTitle
  if (proposedOriginalTitle && normalizeText(proposedOriginalTitle) !== normalizeText(work?.originalTitle)) updates.originalTitle = proposedOriginalTitle
  updates.chosenBaseSource = 'wikidata'
  return updates
}

function searchTextAdditions(row, work) {
  return uniqueTitleValues([
    ...candidateTitleValues(row),
    work?.title,
    work?.originalTitle,
    ...aliasValues(work),
  ]).slice(0, MAX_SEARCH_TEXT_ADDITIONS)
}

function buildWikiSourceLink(qid) {
  const url = wikidataUrl(qid)
  return url ? [{ label: 'Wikidata', url }] : []
}

function buildWikiCandidateSource(qid, advisories, visibility) {
  const url = wikidataUrl(qid)
  const ratingText = advisories.map((item) => `contentRating=${item}`).join('; ')
  return [{
    source: 'wikidata',
    label: 'Wikidata',
    externalId: qid,
    url,
    note: [
      ratingText,
      `contentVisibility=${visibility}`,
      'adultOrMarkedContent=true',
      'Wikidata adult/marked candidate; must be hidden from ordinary mode by content visibility rules',
    ].filter(Boolean).join('; '),
  }]
}

function blockersFor(row, work, advisories, markers) {
  const blockers = []
  const qid = qidOf(row)
  const ids = work ? externalIdsOf(work) : {}
  const flags = row?.candidateFlags || row?.rawAuditRow?.candidateFlags || {}
  const alignment = val(flags.alignmentStatus || row?.candidateFlags?.alignmentStatus)

  if (!advisories.length || visibilityFromAdvisories(advisories) === 'ordinary') blockers.push('missing_adult_or_restricted_advisory')
  if (!qid) blockers.push('missing_wikidata_qid')
  if (flags.bestMaybeCompany) blockers.push('candidate_maybe_company')
  if (flags.bestMaybeRealPersonOrLiveAction) blockers.push('candidate_maybe_real_person_or_live_action')
  if (flags.bestMaybeWork === false) blockers.push('candidate_not_marked_as_work')
  if (alignment && alignment !== 'high') blockers.push(`alignment_status_not_high:${alignment}`)
  if (ids.wikidataQid && qid && ids.wikidataQid.toUpperCase() !== qid.toUpperCase()) blockers.push('current_wikidata_qid_conflict')

  return uniqueBy(blockers, (item) => item)
}

function spacingBlockersForWriteFields(fieldUpdates, additions) {
  const blockers = []
  for (const item of [fieldUpdates.title, fieldUpdates.originalTitle, ...additions]) {
    if (hasSuspiciousTitleSpacing(item)) blockers.push('suspicious_title_spacing_after_cleaning')
  }
  return uniqueBy(blockers, (item) => item)
}

function actionFor(row, work, markers, blockers) {
  if (!work?.id) return 'adult_create_candidate_preview'
  if (blockers.length) return 'adult_manual_review'
  if (markers.length) return 'adult_enrich_marked_existing_work'
  return 'adult_overwrite_unmarked_existing_work'
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

function planRow(row, work) {
  const qid = qidOf(row)
  const advisories = advisoriesOf(row)
  const visibility = visibilityFromAdvisories(advisories)
  const markers = work ? sourceMarkersOf(work) : []
  const existingIds = work ? externalIdsOf(work) : {}
  const additions = work ? searchTextAdditions(row, work) : candidateTitleValues(row)
  const fieldUpdates = work && !markers.length ? proposedPrimaryUpdates(row, work) : {}
  const blockers = uniqueBy([
    ...blockersFor(row, work, advisories, markers),
    ...spacingBlockersForWriteFields(fieldUpdates, additions),
  ], (item) => item)
  const action = actionFor(row, work, markers, blockers)
  const ready = !blockers.length && work?.id && action !== 'adult_create_candidate_preview'

  return {
    key: planKey(row),
    qid,
    wikidataUrl: wikidataUrl(qid),
    contentAdvisories: advisories,
    contentVisibility: visibility,
    action,
    planStatus: ready ? 'ready_for_apply_review' : 'blocked_or_review_required',
    confidence: ready ? 'adult_marked_review_ready' : 'manual_review',
    blockers,
    warnings: uniqueBy([
      ...list(row?.warnings),
      ...list(row?.rawAuditRow?.warnings),
    ].map(cleanLine).filter(Boolean), (item) => item),
    work: work ? {
      id: val(work.id),
      title: val(work.title),
      originalTitle: val(work.originalTitle),
      slug: val(work.slug),
      sourceMarkers: markers,
      currentWikidataQid: existingIds.wikidataQid || '',
    } : row.work || null,
    matchedTitles: uniqueTitleValues(list(row?.matchedTitles)),
    titleCandidates: candidateTitleValues(row),
    fieldUpdates,
    fieldAdditions: {
      searchTextAdditions: additions,
      externalIds: qid && !existingIds.wikidataQid ? { wikidataQid: qid } : {},
      sourceLinks: buildWikiSourceLink(qid),
      candidateSources: buildWikiCandidateSource(qid, advisories, visibility),
    },
    createCandidatePreview: !work?.id ? (row.createCandidatePreview || row.rewriteCandidatePreview || null) : null,
    adultMarkedPolicy: {
      ordinaryModeMustHide: true,
      visibilityDerivedByCandidateSourceNote: true,
      noteMustContainContentRating: advisories.map((item) => `contentRating=${item}`),
      sourceMarkersRecognized: SOURCE_MARKERS,
    },
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      futureApplyWritableFields: ['title', 'originalTitle', 'chosenBaseSource', 'searchText', 'externalIds.wikidataQid', 'sourceLinks', 'candidateSources'],
      doesNotWriteDates: true,
      doesNotWriteMediaTypeOrRiskFields: true,
      adultOrRestrictedMarkerRequired: true,
      rejectsSuspiciousTitleSpacingAfterCleaning: true,
    },
    raw: {
      inputFile: row.__inputFile,
      originalAction: row.action,
      originalPlanStatus: row.planStatus,
      originalMatchStatus: row.matchStatus,
      originalBlockers: row.blockers,
      rawAuditRow: row.rawAuditRow,
    },
  }
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
  const dedupedRows = uniqueBy(sourceRows, planKey)
  const rowsToProcess = limit > 0 ? dedupedRows.slice(0, limit) : dedupedRows

  const login = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  const token = login?.token
  if (!token) throw new Error('Payload login did not return a token')
  const works = await fetchAllWorks(baseUrl, token, 1)
  const workById = new Map(works.docs.map((work) => [val(work.id), work]))

  const plans = rowsToProcess.map((row) => planRow(row, workById.get(workIdOf(row))))
  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const createCandidates = plans.filter((row) => row.action === 'adult_create_candidate_preview')
  const restricted = plans.filter((row) => row.contentVisibility === 'restricted')

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    rows: `${outDir}/wikidata-adult-marked-v01.rows.jsonl`,
    ready: `${outDir}/wikidata-adult-marked-v01-ready.jsonl`,
    blocked: `${outDir}/wikidata-adult-marked-v01-blocked.jsonl`,
    createCandidates: `${outDir}/wikidata-adult-marked-v01-create-candidates.jsonl`,
    restricted: `${outDir}/wikidata-adult-marked-v01-restricted.jsonl`,
    sample: `${outDir}/wikidata-adult-marked-v01-sample.jsonl`,
    summary: `${outDir}/wikidata-adult-marked-v01-summary.json`,
  }
  const changedFieldNames = plans.flatMap((row) => [
    ...Object.keys(row.fieldUpdates || {}),
    ...Object.entries(row.fieldAdditions || {})
      .filter(([, value]) => Array.isArray(value) ? value.length : Object.keys(value || {}).length)
      .map(([key]) => key),
  ])
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
    createCandidateRows: createCandidates.length,
    restrictedRows: restricted.length,
    byAction: countBy(plans, 'action'),
    byPlanStatus: countBy(plans, 'planStatus'),
    byContentVisibility: countBy(plans, 'contentVisibility'),
    byContentAdvisory: countBy(plans.flatMap((row) => row.contentAdvisories), (item) => item),
    bySourceMarker: countBy(plans.flatMap((row) => row.work?.sourceMarkers || []), (item) => item),
    byBlocker: countBy(plans.flatMap((row) => row.blockers), (item) => item),
    byChangedField: countBy(changedFieldNames, (item) => item),
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      ordinaryModeMustHide: true,
      visibilityDerivedByCandidateSourceNote: true,
      sourceMarkersRecognizedForFutureImports: SOURCE_MARKERS,
      futureApplyMustBeGuarded: true,
      rejectsSuspiciousTitleSpacingAfterCleaning: true,
    },
    nextStep: 'Review v0.2 ready/create/blocked samples. Future guarded apply must re-clean titles and block suspicious spacing again.',
  }

  writeJsonl(outputs.rows, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.createCandidates, createCandidates)
  writeJsonl(outputs.restricted, restricted)
  writeJsonl(outputs.sample, [...ready.slice(0, 50), ...createCandidates.slice(0, 30), ...blocked.slice(0, 50)])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
