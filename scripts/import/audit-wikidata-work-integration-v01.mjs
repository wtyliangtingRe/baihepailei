#!/usr/bin/env node
import fs from 'node:fs'
import readline from 'node:readline'

const VERSION = 'wikidata-work-integration-audit-v0.3'
const PAGE_LIMIT = 200
const DEFAULT_INPUT = 'data_local/raw/wikidata/index/anilist-tagged-wikidata-best-candidates.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-work-integration'
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')
const SOURCE_PRIORITY_NOTE = 'Source priority: Yurizukan > Bangumi > MangaDex > NDL > Steam > Wikidata > AniList'
const HIGHER_PRIORITY_MARKERS = new Set(['bangumi', 'mangadex', 'ndl'])

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

function compactLine(value) {
  return val(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ')
}

function normalizeText(value) {
  return compactLine(value).normalize('NFKC').toLowerCase()
}

function normalizeUrl(value) {
  return val(value).replace(/\/+$/u, '')
}

function uniqueBy(values, getKey = normalizeText) {
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

function maybeJson(value) {
  const text = val(value)
  if (!text || !/^[\[{]/u.test(text)) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function collectTextDeep(value, out = []) {
  if (value === undefined || value === null) return out
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const parsed = typeof value === 'string' ? maybeJson(value) : null
    if (parsed !== null) return collectTextDeep(parsed, out)
    const text = compactLine(value)
    if (text) out.push(text)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextDeep(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const key of ['title', 'name', 'value', 'text', 'label', 'native', 'romaji', 'english', 'chinese', 'japanese', 'zh', 'ja', 'en', 'description']) {
      if (key in value) collectTextDeep(value[key], out)
    }
  }
  return out
}

function collectMapValues(value) {
  const out = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const entry of Object.values(value)) collectTextDeep(entry, out)
  return out.map(compactLine).filter(Boolean)
}

function splitLooseList(value) {
  return collectTextDeep(value)
    .flatMap((item) => item.split(/[|；;\n]+|\s+[／/]\s+/u))
    .map(compactLine)
    .filter(isUsefulTitle)
}

function isUsefulTitle(value) {
  const text = compactLine(value)
  if (!text) return false
  if (/^https?:\/\//iu.test(text)) return false
  if (/^Q\d+$/iu.test(text)) return false
  if (/^\d+$/u.test(text)) return false
  if (/^(unknown|null|undefined)$/iu.test(text)) return false
  return true
}

async function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
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

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
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

function qidOf(row) {
  const values = [
    row?.bestQid,
    row?.qid,
    row?.wikidataQid,
    row?.entityId,
    row?.entity?.id,
    row?.wikidata?.id,
    row?.wikidataConceptUri,
    row?.claims?.wikidataQid,
  ]
  for (const item of values) {
    const text = val(item).toUpperCase()
    const match = text.match(/^Q\d+$/u) || text.match(/wikidata\.org\/(?:entity|wiki)\/(Q\d+)/iu)
    if (match) return match[1] || match[0]
  }
  return ''
}

function wikidataUrl(qid) {
  return qid ? `https://www.wikidata.org/wiki/${qid}` : ''
}

function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function aliasRows(doc) {
  return (Array.isArray(doc?.aliases) ? doc.aliases : [])
    .map((item) => val(typeof item === 'string' ? item : item?.value || item?.title || item?.name))
    .filter(Boolean)
}

function localizedTitleRows(doc) {
  return (Array.isArray(doc?.localizedTitles) ? doc.localizedTitles : [])
    .map((item) => val(typeof item === 'string' ? item : item?.title || item?.value || item?.text || item?.name))
    .filter(Boolean)
}

function searchTextRows(doc) {
  return splitLooseList(String(doc?.searchText || '').replace(/[\r\n]+/gu, '|'))
}

function searchableWorkNames(doc) {
  return uniqueBy([
    doc?.title,
    doc?.originalTitle,
    ...aliasRows(doc),
    ...localizedTitleRows(doc),
    ...searchTextRows(doc),
  ].map(compactLine).filter(Boolean), normalizeText)
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

function sourceOf(doc) {
  const ids = externalIdsOf(doc)
  if (ids.bangumiSubjectId) return 'bangumi'
  if (ids.wikidataQid) return 'wikidata'
  const sources = candidateSourceRows(doc).map((item) => val(item.source || item.label).toLowerCase()).filter(Boolean)
  for (const source of ['bangumi', 'mangadex', 'ndl', 'steam', 'wikidata']) {
    if (sources.includes(source)) return source
  }
  if (sources[0]) return sources[0]
  return val(doc?.originalSource || doc?.source || doc?.siteId || 'unknown').toLowerCase() || 'unknown'
}

function higherPriorityMarkersOf(work) {
  const markers = new Set()
  const ids = externalIdsOf(work)
  if (ids.bangumiSubjectId) markers.add('bangumi')
  const sourceText = [
    work?.siteId,
    work?.originalSource,
    work?.source,
    ...candidateSourceRows(work).flatMap((item) => [item.source, item.label, item.externalId, item.url, item.note]),
    ...sourceLinkRows(work).flatMap((item) => [item.label, item.url]),
  ].map((item) => val(item).toLowerCase()).join('\n')

  if (/bangumi|bgm\.tv|bangumi\.tv/u.test(sourceText)) markers.add('bangumi')
  if (/mangadex/u.test(sourceText)) markers.add('mangadex')
  if (/ndl|iss\.ndl\.go\.jp|id\.ndl\.go\.jp/u.test(sourceText)) markers.add('ndl')
  return [...markers].filter((marker) => HIGHER_PRIORITY_MARKERS.has(marker))
}

function workYearLabels(work) {
  return uniqueBy([
    val(work?.firstPublishedLabel).match(/\d{4}/u)?.[0] || '',
    val(work?.firstPublishedAt).match(/\d{4}/u)?.[0] || '',
  ].filter(Boolean), (item) => item)
}

function incomingYears(row) {
  return uniqueBy([
    row?.year,
    row?.publicationYear,
    row?.inceptionYear,
    row?.firstPublishedYear,
    row?.date,
    row?.publicationDate,
    row?.firstPublishedAt,
    row?.startDate?.year,
    row?.claims?.publicationDate,
    row?.claims?.inception,
    ...collectTextDeep(row?.years),
    ...collectTextDeep(row?.dates),
  ].map((item) => val(item).match(/\d{4}/u)?.[0] || '').filter(Boolean), (item) => item)
}

function officialUrlOf(row) {
  for (const item of [row?.officialUrl, row?.officialWebsite, row?.website, row?.urlOfficial, row?.claims?.officialWebsite, row?.claims?.P856].flatMap((value) => collectTextDeep(value))) {
    const text = normalizeUrl(item)
    if (/^https?:\/\//iu.test(text)) return text
  }
  return ''
}

function bangumiSubjectIdOf(row) {
  const values = [row?.bangumiSubjectId, row?.bangumiId, row?.source?.bangumiSubjectId, row?.source?.bangumiId, row?.claims?.bangumiSubjectId]
  for (const item of values) {
    const text = val(item)
    if (/^\d+$/u.test(text)) return text
  }
  return ''
}

function titleLanguageBuckets(row) {
  return {
    zh: uniqueBy([
      row?.sourceTitleCn,
      row?.labels?.zh?.value,
      row?.labels?.['zh-cn']?.value,
      row?.labels?.['zh-hans']?.value,
      ...collectTextDeep(row?.titles?.zh),
      ...collectTextDeep(row?.names?.zh),
    ].map(compactLine).filter(isUsefulTitle), normalizeText),
    ja: uniqueBy([
      row?.titleNative,
      row?.labels?.ja?.value,
      row?.labels?.jp?.value,
      row?.japaneseTitle,
      row?.titleJa,
      ...collectTextDeep(row?.titles?.ja),
      ...collectTextDeep(row?.names?.ja),
      ...collectTextDeep(row?.sitelinks?.jawiki),
    ].map(compactLine).filter(isUsefulTitle), normalizeText),
    en: uniqueBy([
      row?.titleEnglish,
      row?.titleRomaji,
      row?.titleUserPreferred,
      row?.labels?.en?.value,
      row?.englishTitle,
      row?.titleEn,
      ...collectTextDeep(row?.titles?.en),
      ...collectTextDeep(row?.names?.en),
    ].map(compactLine).filter(isUsefulTitle), normalizeText),
  }
}

function titlesForRow(row) {
  const buckets = titleLanguageBuckets(row)
  return uniqueBy([
    row?.query,
    row?.sourceTitle,
    row?.sourceTitleCn,
    row?.title,
    row?.name,
    row?.label,
    row?.bestLabel,
    row?.secondLabel,
    row?.wikidataTitle,
    row?.wikidataLabel,
    row?.searchTerm,
    row?.mediaKey,
    ...buckets.ja,
    ...buckets.zh,
    ...buckets.en,
    ...splitLooseList(row?.synonyms),
    ...splitLooseList(row?.bestSearchTerms),
    ...collectMapValues(row?.labels),
    ...collectMapValues(row?.sitelinks),
    ...collectTextDeep(row?.aliases),
    ...collectTextDeep(row?.altLabels),
    ...collectTextDeep(row?.titles),
    ...collectTextDeep(row?.names),
  ].map(compactLine).filter(isUsefulTitle), normalizeText)
}

function descriptionCandidates(row) {
  return uniqueBy([
    row?.bestDescription,
    row?.secondDescription,
    row?.wikidataDescription,
    row?.description,
    row?.summary,
    row?.abstract,
    row?.extract,
    ...collectMapValues(row?.descriptions),
  ].map(compactLine).filter(Boolean), normalizeText)
}

function adultAdvisories(row) {
  const haystack = [
    row?.contentRating,
    row?.rating,
    row?.ageRating,
    row?.isAdult ? 'isAdult' : '',
    row?.adult ? 'adult' : '',
    row?.nsfw ? 'nsfw' : '',
    ...collectTextDeep(row?.tags),
    ...collectTextDeep(row?.genres),
    ...collectTextDeep(row?.sourceTags),
    ...collectTextDeep(row?.claims),
  ].map((item) => val(item).toLowerCase()).join('\n')
  const out = []
  if (/suggestive|暗示性|擦边/u.test(haystack)) out.push('suggestive')
  if (/erotica|adult|成人向|nsfw|isadult/u.test(haystack)) out.push('erotica')
  if (/pornographic|pornography|色情|18禁|r-?18/u.test(haystack)) out.push('pornographic')
  if (/doujinshi|同人志|同人本/u.test(haystack)) out.push('doujinshi_or_extra')
  return uniqueBy(out, (item) => item)
}

function candidateFlags(row) {
  return {
    alignmentStatus: val(row?.alignmentStatus),
    candidatesCount: Number(row?.candidatesCount || 0),
    bestScore: Number(row?.bestScore || row?.matchScore || 0),
    bestRank: Number(row?.bestRank || row?.rank || 0),
    bestMaybeWork: row?.bestMaybeWork ?? row?.maybeWork,
    bestMaybeCompany: row?.bestMaybeCompany ?? row?.maybeCompany,
    bestMaybeRealPersonOrLiveAction: row?.bestMaybeRealPersonOrLiveAction ?? row?.maybeRealPersonOrLiveAction,
  }
}

function buildWorkIndexes(works) {
  const byWikidataQid = new Map()
  const byBangumiId = new Map()
  const titleIndex = new Map()
  for (const work of works) {
    const ids = externalIdsOf(work)
    if (ids.wikidataQid && !byWikidataQid.has(ids.wikidataQid.toUpperCase())) byWikidataQid.set(ids.wikidataQid.toUpperCase(), work)
    if (ids.bangumiSubjectId && !byBangumiId.has(ids.bangumiSubjectId)) byBangumiId.set(ids.bangumiSubjectId, work)
    for (const name of searchableWorkNames(work)) {
      const key = normalizeText(name)
      if (!key) continue
      if (!titleIndex.has(key)) titleIndex.set(key, [])
      titleIndex.get(key).push(work)
    }
  }
  return { byWikidataQid, byBangumiId, titleIndex }
}

function candidatesFromTitles(titles, indexes) {
  const candidateMap = new Map()
  const matchedTitles = []
  for (const title of titles) {
    const matches = indexes.titleIndex.get(normalizeText(title)) || []
    for (const work of matches) {
      candidateMap.set(val(work.id), work)
      matchedTitles.push(title)
    }
  }
  return { candidates: [...candidateMap.values()], matchedTitles: uniqueBy(matchedTitles, normalizeText) }
}

function matchRow(row, indexes) {
  const qid = qidOf(row)
  const bangumiSubjectId = bangumiSubjectIdOf(row)
  if (qid && indexes.byWikidataQid.has(qid)) return { status: 'matched_by_wikidata_qid', work: indexes.byWikidataQid.get(qid), candidates: [], matchedTitles: [], higherPriorityMarkers: [] }
  if (bangumiSubjectId && indexes.byBangumiId.has(bangumiSubjectId)) return { status: 'matched_by_bangumi_id', work: indexes.byBangumiId.get(bangumiSubjectId), candidates: [], matchedTitles: [], higherPriorityMarkers: [] }

  const titleMatch = candidatesFromTitles(titlesForRow(row), indexes)
  if (titleMatch.candidates.length === 1) {
    const work = titleMatch.candidates[0]
    const markers = higherPriorityMarkersOf(work)
    return {
      status: markers.length ? 'matched_by_title_with_higher_priority_marker' : 'matched_by_title_without_higher_priority_marker',
      work,
      candidates: titleMatch.candidates,
      matchedTitles: titleMatch.matchedTitles,
      higherPriorityMarkers: markers,
    }
  }
  if (titleMatch.candidates.length > 1) return { status: 'title_multi_match', work: null, candidates: titleMatch.candidates, matchedTitles: titleMatch.matchedTitles, higherPriorityMarkers: [] }
  return { status: 'no_match', work: null, candidates: [], matchedTitles: [], higherPriorityMarkers: [] }
}

function differenceNormalized(incoming, existing) {
  const existingKeys = new Set(existing.map(normalizeText).filter(Boolean))
  return incoming.filter((item) => !existingKeys.has(normalizeText(item)))
}

function sourceLinkAdditionsFor(work, qid) {
  const beforeLinks = work ? sourceLinkRows(work) : []
  const url = wikidataUrl(qid)
  if (!url) return []
  const item = { label: 'Wikidata', url }
  return beforeLinks.some((existing) => normalizeUrl(existing.url) === normalizeUrl(item.url)) ? [] : [item]
}

function candidateSourceAdditionsFor(work, qid) {
  const beforeSources = work ? candidateSourceRows(work) : []
  const url = wikidataUrl(qid)
  if (!qid && !url) return []
  const item = {
    source: 'wikidata',
    label: 'Wikidata',
    externalId: qid,
    url,
    note: ['Wikidata work integration audit', SOURCE_PRIORITY_NOTE].join('; '),
  }
  const key = [item.source, item.externalId, normalizeUrl(item.url)].join('|')
  return beforeSources.some((existing) => [val(existing.source), val(existing.externalId), normalizeUrl(existing.url)].join('|') === key) ? [] : [item]
}

function primaryTitleForCreate(titles, buckets) {
  return buckets.zh[0] || buckets.ja[0] || buckets.en[0] || titles[0] || ''
}

function buildPlan(row, indexes) {
  const qid = qidOf(row)
  const buckets = titleLanguageBuckets(row)
  const titles = titlesForRow(row)
  const descriptions = descriptionCandidates(row)
  const match = matchRow(row, indexes)
  const work = match.work
  const markers = match.higherPriorityMarkers || (work ? higherPriorityMarkersOf(work) : [])
  const flags = candidateFlags(row)
  const warnings = []
  const blockers = []
  const notes = []
  const advisories = adultAdvisories(row)

  if (!qid) blockers.push('missing_wikidata_qid')
  if (!titles.length) blockers.push('missing_title_candidates')
  if (match.status === 'title_multi_match') blockers.push('title_multi_match')
  if (flags.bestMaybeCompany) blockers.push('best_candidate_maybe_company')
  if (flags.bestMaybeRealPersonOrLiveAction) blockers.push('best_candidate_maybe_real_person_or_live_action')
  if (flags.bestMaybeWork === false) warnings.push('best_candidate_not_marked_as_work')
  if (flags.alignmentStatus && !/^high|exact|single/i.test(flags.alignmentStatus)) warnings.push(`alignment_status_review:${flags.alignmentStatus}`)
  if (advisories.length) warnings.push('content_advisory_present')
  if (descriptions.length) notes.push('wikidata_description_available_preview_only')
  if (markers.length) notes.push(`higher_priority_marker_present:${markers.join(',')}`)

  const existingNames = work ? searchableWorkNames(work) : []
  const searchTextAdditions = work ? differenceNormalized(titles, existingNames) : titles
  if (searchTextAdditions.length) warnings.push('has_search_text_additions')

  const ids = work ? externalIdsOf(work) : {}
  const externalIds = {}
  if (qid && work && !ids.wikidataQid) externalIds.wikidataQid = qid
  else if (qid && ids.wikidataQid && ids.wikidataQid.toUpperCase() !== qid) blockers.push('existing_wikidata_qid_conflict')

  const officialUrl = officialUrlOf(row)
  if (officialUrl && work && !ids.officialUrl) externalIds.officialUrl = officialUrl
  else if (officialUrl && ids.officialUrl && normalizeUrl(ids.officialUrl) !== normalizeUrl(officialUrl)) warnings.push('official_url_diff_or_missing')

  const sourceLinks = work ? sourceLinkAdditionsFor(work, qid) : []
  const candidateSources = work ? candidateSourceAdditionsFor(work, qid) : []
  if (sourceLinks.length || candidateSources.length) warnings.push('has_source_metadata_additions')

  const incomingYearLabels = incomingYears(row)
  const existingYears = work ? workYearLabels(work) : []
  const sharedYear = incomingYearLabels.some((year) => existingYears.includes(year))
  const yearDiff = incomingYearLabels.length && existingYears.length && !sharedYear ? incomingYearLabels : []
  if (yearDiff.length) blockers.push('year_diff_requires_manual_review')
  if (incomingYearLabels.length && existingYears.length && sharedYear) notes.push('same_year_date_difference_merge_compatible_keep_existing_date')

  let action = 'defer'
  let planStatus = blockers.length ? 'blocked_or_review_required' : 'ready_for_apply_review'
  let confidence = 'review'
  let rewriteCandidatePreview = null
  let createCandidatePreview = null

  if (work && (match.status === 'matched_by_wikidata_qid' || match.status === 'matched_by_bangumi_id' || match.status === 'matched_by_title_with_higher_priority_marker')) {
    action = 'enrich_search_text_for_marked_existing_work'
    confidence = match.status === 'matched_by_title_with_higher_priority_marker' ? 'medium' : 'high'
  } else if (work && match.status === 'matched_by_title_without_higher_priority_marker') {
    action = 'propose_wikidata_rewrite_existing_unmarked_work'
    confidence = 'manual_rewrite_candidate'
    planStatus = 'blocked_or_review_required'
    blockers.push('matched_existing_work_without_higher_priority_marker_rewrite_review_required')
    rewriteCandidatePreview = {
      currentTitle: val(work.title),
      proposedTitle: primaryTitleForCreate(titles, buckets),
      proposedOriginalTitle: buckets.ja[0] || titles[0] || '',
      proposedSearchTextAdditions: searchTextAdditions,
      descriptionPreview: descriptions.slice(0, 5),
      note: 'Preview only. A separate guarded rewrite plan is required before changing primary fields.',
    }
  } else if (!work && match.status === 'no_match') {
    action = 'propose_create_wikidata_work_candidate'
    confidence = 'manual_create_candidate'
    planStatus = 'blocked_or_review_required'
    blockers.push('no_existing_work_match_create_review_required')
    createCandidatePreview = {
      title: primaryTitleForCreate(titles, buckets),
      originalTitle: buckets.ja[0] || titles[0] || '',
      localizedTitles: uniqueBy([...buckets.zh, ...buckets.en], normalizeText),
      searchText: titles.join('\n'),
      externalIds: Object.fromEntries(Object.entries({ wikidataQid: qid, officialUrl }).filter(([, value]) => value)),
      sourceLinks: qid ? [{ label: 'Wikidata', url: wikidataUrl(qid) }] : [],
      candidateSources: qid ? [{ source: 'wikidata', label: 'Wikidata', externalId: qid, url: wikidataUrl(qid), note: ['Wikidata work candidate preview', SOURCE_PRIORITY_NOTE].join('; ') }] : [],
      descriptionPreview: descriptions.slice(0, 5),
      note: 'Preview only. No Work is created by this audit.',
    }
  }

  const changedFields = []
  if (searchTextAdditions.length) changedFields.push('searchText')
  if (Object.keys(externalIds).length) changedFields.push('externalIds')
  if (sourceLinks.length) changedFields.push('sourceLinks')
  if (candidateSources.length) changedFields.push('candidateSources')
  if (rewriteCandidatePreview) changedFields.push('rewriteCandidatePreview')
  if (createCandidatePreview) changedFields.push('createCandidatePreview')
  if (!changedFields.length && !blockers.length) warnings.push('no_new_information_detected')

  if (blockers.length) planStatus = 'blocked_or_review_required'

  return {
    key: qid || `row:${normalizeText(titles[0] || '')}`,
    qid,
    wikidataUrl: wikidataUrl(qid),
    action,
    matchStatus: match.status,
    planStatus,
    confidence,
    candidateFlags: flags,
    higherPriorityMarkers: markers,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    notes: [...new Set(notes)],
    changedFields,
    contentAdvisories: advisories,
    titleCandidates: titles,
    titleLanguageBuckets: buckets,
    descriptionCandidates: descriptions,
    matchedTitles: match.matchedTitles,
    matchedCandidates: match.candidates.map((item) => ({ id: val(item.id), title: val(item.title), slug: val(item.slug), source: sourceOf(item), higherPriorityMarkers: higherPriorityMarkersOf(item), wikidataQid: externalIdsOf(item).wikidataQid || '', bangumiSubjectId: externalIdsOf(item).bangumiSubjectId || '' })),
    work: work ? {
      id: val(work.id),
      title: val(work.title),
      slug: val(work.slug),
      source: sourceOf(work),
      higherPriorityMarkers: markers,
      bangumiSubjectId: ids.bangumiSubjectId || '',
      wikidataQid: ids.wikidataQid || '',
    } : null,
    fieldAdditions: {
      searchTextAdditions,
      externalIds,
      sourceLinks,
      candidateSources,
    },
    rewriteCandidatePreview,
    createCandidatePreview,
    diffReport: {
      incomingYears: incomingYearLabels,
      existingYears,
      differingIncomingYears: yearDiff,
      yearRule: 'If extracted four-digit year matches, merge-compatible; keep existing firstPublished fields unchanged.',
    },
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      proposedWritableFieldsForFutureLowRiskPass: ['searchText', 'externalIds.wikidataQid', 'externalIds.officialUrl', 'sourceLinks', 'candidateSources'],
      rewriteAndCreateArePreviewOnly: true,
      doesNotWriteDateFields: true,
      sameYearDateDiffDoesNotBlock: true,
      differentYearRequiresManualReview: true,
    },
  }
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const limit = Number(args.limit || 0)
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]
  if (!email || !password) throw new Error('Missing Payload login env vars')

  const source = await readJsonl(input)
  const rawRows = limit > 0 ? source.rows.slice(0, limit) : source.rows
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token, 1)
  const indexes = buildWorkIndexes(works.docs)
  const plans = rawRows.map((row) => buildPlan(row, indexes))

  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const rewriteCandidates = plans.filter((row) => row.rewriteCandidatePreview)
  const createCandidates = plans.filter((row) => row.createCandidatePreview)
  fs.mkdirSync(outDir, { recursive: true })

  const outputs = {
    rows: `${outDir}/wikidata-work-integration-v01.rows.jsonl`,
    ready: `${outDir}/wikidata-work-integration-v01-ready.jsonl`,
    blocked: `${outDir}/wikidata-work-integration-v01-blocked.jsonl`,
    rewriteCandidates: `${outDir}/wikidata-work-integration-v01-rewrite-candidates.jsonl`,
    createCandidates: `${outDir}/wikidata-work-integration-v01-create-candidates.jsonl`,
    sample: `${outDir}/wikidata-work-integration-v01-sample.jsonl`,
    summary: `${outDir}/wikidata-work-integration-v01-summary.json`,
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    payloadBaseUrl: baseUrl,
    rawRowsRead: source.read,
    rawRowsFailed: source.failed,
    rowsProcessed: rawRows.length,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    readyRows: ready.length,
    blockedRows: blocked.length,
    rewriteCandidateRows: rewriteCandidates.length,
    createCandidateRows: createCandidates.length,
    byPlanStatus: countBy(plans, 'planStatus'),
    byAction: countBy(plans, 'action'),
    byMatchStatus: countBy(plans, 'matchStatus'),
    byConfidence: countBy(plans, 'confidence'),
    byAlignmentStatus: countBy(plans, (row) => row.candidateFlags?.alignmentStatus || 'missing'),
    byHigherPriorityMarker: countBy(plans.flatMap((row) => row.higherPriorityMarkers), (item) => item),
    byChangedField: countBy(plans.flatMap((row) => row.changedFields), (item) => item),
    byBlocker: countBy(plans.flatMap((row) => row.blockers), (item) => item),
    byWarning: countBy(plans.flatMap((row) => row.warnings), (item) => item),
    byNote: countBy(plans.flatMap((row) => row.notes), (item) => item),
    byContentAdvisory: countBy(plans.flatMap((row) => row.contentAdvisories), (item) => item),
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      proposedWritableFieldsForFutureLowRiskPass: ['searchText', 'externalIds.wikidataQid', 'externalIds.officialUrl', 'sourceLinks', 'candidateSources'],
      rewriteAndCreateArePreviewOnly: true,
      doesNotWriteDateFields: true,
      sameYearDateDiffDoesNotBlock: true,
      differentYearRequiresManualReview: true,
      defaultInput: DEFAULT_INPUT,
      sourcePriority: SOURCE_PRIORITY_NOTE,
    },
    nextStep: 'Review ready rows first for safe searchText/title-alias enrichment. Review rewrite/create candidates separately; this audit never rewrites or creates Works directly.',
  }

  writeJsonl(outputs.rows, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.rewriteCandidates, rewriteCandidates)
  writeJsonl(outputs.createCandidates, createCandidates)
  writeJsonl(outputs.sample, [...ready.slice(0, 20), ...rewriteCandidates.slice(0, 20), ...createCandidates.slice(0, 20), ...blocked.slice(0, 20)])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: source.failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
