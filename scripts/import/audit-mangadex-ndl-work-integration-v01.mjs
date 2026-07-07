#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'mangadex-ndl-work-integration-audit-v0.2'
const PAGE_LIMIT = 200
const DEFAULT_OUT_DIR = 'data_local/staging/mangadex-ndl-integration'
const DEFAULT_MANGADEX_REVIEW = 'data_local/raw/mangadex/index/mangadex-bangumi-books-review.jsonl'
const DEFAULT_MANGADEX_BEST = 'data_local/raw/mangadex/index/mangadex-bangumi-books-best.jsonl'
const DEFAULT_NDL_REVIEW = 'data_local/raw/ndl/index/ndl-opensearch-review.jsonl'
const DEFAULT_NDL_MANIFEST = 'data_local/raw/ndl/index/ndl-bangumi-books-manifest.jsonl'
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

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
}

function compactLine(value) {
  return val(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ')
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

function isUsefulTitle(value) {
  const text = compactLine(value)
  if (!text) return false
  if (/^https?:\/\//iu.test(text)) return false
  if (/^\d+$/u.test(text)) return false
  if (/^(unknown|null|undefined)$/iu.test(text)) return false
  return true
}

function splitLooseList(value) {
  const text = compactLine(value)
  if (!text) return []
  return text
    .split(/\s+[\/／]\s+|[|；;]+/u)
    .map((item) => compactLine(item))
    .filter(isUsefulTitle)
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
    out.push(...splitLooseList(value))
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextDeep(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectTextDeep(item, out)
  }
  return out
}

async function readJsonlIfExists(file) {
  if (!fs.existsSync(file)) return { rows: [], read: 0, failed: 0, exists: false }
  return readJsonl(file)
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
  return { rows, read, failed, exists: true }
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
  const sources = candidateSourceRows(doc).map((item) => val(item.source || item.label).toLowerCase()).filter(Boolean)
  if (sources.includes('bangumi')) return 'bangumi'
  if (sources[0]) return sources[0]
  if (externalIdsOf(doc).bangumiSubjectId) return 'bangumi'
  const siteId = val(doc?.siteId).toLowerCase()
  if (siteId.includes('bangumi')) return 'bangumi'
  const links = sourceLinkRows(doc).map((item) => item.url.toLowerCase())
  if (links.some((url) => url.includes('bgm.tv/subject') || url.includes('bangumi.tv/subject'))) return 'bangumi'
  if (siteId.includes('mangadex')) return 'mangadex'
  return val(doc?.originalSource || doc?.source || 'unknown').toLowerCase() || 'unknown'
}

function buildWorkIndexes(works) {
  const byBangumiId = new Map()
  const titleIndex = new Map()
  const byId = new Map()

  for (const work of works) {
    const id = val(work?.id)
    if (id) byId.set(id, work)
    const bangumiId = externalIdsOf(work).bangumiSubjectId
    if (bangumiId && !byBangumiId.has(bangumiId)) byBangumiId.set(bangumiId, work)
    for (const name of searchableWorkNames(work)) {
      const key = normalizeText(name)
      if (!key) continue
      if (!titleIndex.has(key)) titleIndex.set(key, [])
      titleIndex.get(key).push(work)
    }
  }

  return { byId, byBangumiId, titleIndex }
}

function validBangumiSubjectId(value) {
  const text = val(value)
  return /^\d+$/u.test(text) ? text : ''
}

function rawSourceIdOf(row) {
  return val(row?.sourceId || row?.source?.sourceId || row?.source?.id)
}

function bangumiSubjectIdOf(row) {
  return validBangumiSubjectId(row?.bangumiId || row?.bangumiSubjectId || row?.source?.bangumiId || row?.source?.subjectId || row?.sourceId)
}

function mangaDexId(row) {
  return val(row?.mangaDexId || row?.bestMangaDexId)
}

function mangaDexUrl(row) {
  const id = mangaDexId(row)
  return id ? `https://mangadex.org/title/${id}` : ''
}

function externalLinkUrl(label, value) {
  const text = normalizeUrl(value)
  if (!text) return ''
  if (/^https?:\/\//iu.test(text)) return text
  if (label === 'AniList via MangaDex' && /^\d+$/u.test(text)) return `https://anilist.co/manga/${text}`
  if (label === 'MyAnimeList via MangaDex' && /^\d+$/u.test(text)) return `https://myanimelist.net/manga/${text}`
  return ''
}

function selectedMangaDexRows(group) {
  const bestIds = new Set(group.mangaDexBestRows.map(mangaDexId).filter(Boolean))
  const detailRows = bestIds.size
    ? group.mangaDexRows.filter((row) => bestIds.has(mangaDexId(row)))
    : []
  return {
    bestRows: group.mangaDexBestRows,
    detailRows,
    evidenceRows: [...group.mangaDexBestRows, ...detailRows],
    selectedIds: [...bestIds],
  }
}

function selectedNdlRows(group) {
  const acceptedMaterialTypes = new Set(['', 'manga', 'novel_or_light_novel', 'book', 'unknown'])
  const bibliographicRows = group.ndlRows.filter((row) => acceptedMaterialTypes.has(val(row?.materialType)))
  const nonBookRows = group.ndlRows.filter((row) => !acceptedMaterialTypes.has(val(row?.materialType)))
  return {
    manifestRows: group.ndlManifestRows,
    bibliographicRows,
    nonBookRows,
  }
}

function collectMangaDexTitles(row) {
  return uniqueBy([
    row?.query,
    row?.sourceTitle,
    row?.sourceTitleCn,
    row?.bestMatchedTitle,
    row?.bestTitle,
    row?.titleMain,
    ...collectTextDeep(row?.allTitles),
  ].map(compactLine).filter(isUsefulTitle), normalizeText)
}

function collectNdlManifestTitles(row) {
  return uniqueBy([
    row?.query,
    row?.source?.title,
    row?.source?.titleCn,
    ...collectTextDeep(row?.source?.aliases),
  ].map(compactLine).filter(isUsefulTitle), normalizeText)
}

function collectNdlBibliographicTitles(row) {
  return uniqueBy([
    row?.query,
    row?.ndlTitle,
  ].map(compactLine).filter(isUsefulTitle), normalizeText)
}

function primaryTitlesForGroup(group) {
  const md = selectedMangaDexRows(group)
  const ndl = selectedNdlRows(group)
  return uniqueBy([
    ...md.bestRows.flatMap((row) => [row?.query, row?.sourceTitle, row?.sourceTitleCn, row?.bestMatchedTitle].map(compactLine).filter(isUsefulTitle)),
    ...ndl.manifestRows.flatMap(collectNdlManifestTitles),
  ], normalizeText)
}

function titlesForGroup(group) {
  const md = selectedMangaDexRows(group)
  const ndl = selectedNdlRows(group)
  return uniqueBy([
    ...md.evidenceRows.flatMap(collectMangaDexTitles),
    ...ndl.manifestRows.flatMap(collectNdlManifestTitles),
  ].map(compactLine).filter(isUsefulTitle), normalizeText)
}

function ndlReviewTitlesForReport(group) {
  const ndl = selectedNdlRows(group)
  return uniqueBy(ndl.bibliographicRows.flatMap(collectNdlBibliographicTitles), normalizeText)
}

function incomingCreatorNames(group) {
  const md = selectedMangaDexRows(group)
  const ndl = selectedNdlRows(group)
  return uniqueBy([
    ...md.evidenceRows.flatMap((row) => [...collectTextDeep(row?.authors), ...collectTextDeep(row?.artists), ...collectTextDeep(row?.bestAuthors), ...collectTextDeep(row?.bestArtists)]),
    ...ndl.bibliographicRows.flatMap((row) => collectTextDeep(row?.author)),
  ].map(compactLine).filter(Boolean), normalizeText)
}

function incomingPublishers(group) {
  const ndl = selectedNdlRows(group)
  return uniqueBy(ndl.bibliographicRows.flatMap((row) => collectTextDeep(row?.publisher)).map(compactLine).filter(Boolean), normalizeText)
}

function incomingYears(group) {
  const md = selectedMangaDexRows(group)
  const ndl = selectedNdlRows(group)
  return uniqueBy([
    ...md.evidenceRows.flatMap((row) => [row?.year, row?.bestYear]),
    ...ndl.bibliographicRows.flatMap((row) => collectTextDeep(row?.publicationYear)),
  ].map((item) => val(item).match(/\d{4}/u)?.[0] || '').filter(Boolean), (item) => item)
}

function workCreatorNames(work) {
  const names = []
  for (const item of Array.isArray(work?.creators) ? work.creators : []) {
    names.push(typeof item === 'string' ? '' : item?.name)
  }
  for (const item of Array.isArray(work?.creatorCredits) ? work.creatorCredits : []) {
    const creator = item?.creator
    names.push(typeof creator === 'string' ? '' : creator?.name)
  }
  return uniqueBy(names.map(compactLine).filter(Boolean), normalizeText)
}

function workPublisherNames(work) {
  const names = []
  for (const item of Array.isArray(work?.organizations) ? work.organizations : []) {
    const role = val(item?.role)
    if (role && role !== 'publisher') continue
    const org = item?.organization
    names.push(typeof org === 'string' ? '' : org?.name)
  }
  return uniqueBy(names.map(compactLine).filter(Boolean), normalizeText)
}

function workYearLabels(work) {
  return uniqueBy([
    val(work?.firstPublishedLabel).match(/\d{4}/u)?.[0] || '',
    val(work?.firstPublishedAt).match(/\d{4}/u)?.[0] || '',
  ].filter(Boolean), (item) => item)
}

function differenceNormalized(incoming, existing) {
  const existingKeys = new Set(existing.map(normalizeText).filter(Boolean))
  return incoming.filter((item) => !existingKeys.has(normalizeText(item)))
}

function linksForGroup(group) {
  const md = selectedMangaDexRows(group)
  const ndl = selectedNdlRows(group)
  const links = []

  for (const row of md.detailRows) {
    const url = mangaDexUrl(row)
    if (url) links.push({ label: 'MangaDex', url })
    for (const [label, value] of [
      ['AniList via MangaDex', row?.linkAniList],
      ['MyAnimeList via MangaDex', row?.linkMAL],
      ['MangaUpdates via MangaDex', row?.linkMangaUpdates],
      ['Raw link via MangaDex', row?.linkRaw],
    ]) {
      const link = externalLinkUrl(label, value)
      if (link) links.push({ label, url: link })
    }
  }

  for (const row of md.bestRows) {
    const url = mangaDexUrl(row)
    if (url) links.push({ label: 'MangaDex', url })
  }

  for (const row of ndl.bibliographicRows) {
    if (normalizeUrl(row?.link)) links.push({ label: 'NDL', url: normalizeUrl(row.link) })
  }

  return uniqueBy(links, (item) => normalizeUrl(item.url))
}

function candidateSourcesForGroup(group) {
  const md = selectedMangaDexRows(group)
  const ndl = selectedNdlRows(group)
  const sources = []

  for (const row of md.evidenceRows) {
    const id = mangaDexId(row)
    const url = mangaDexUrl(row)
    if (!id && !url) continue
    sources.push({
      source: 'mangadex',
      label: 'MangaDex',
      externalId: id,
      url,
      note: [
        'MangaDex + Bangumi books integration audit',
        row?.contentRating || row?.bestContentRating ? `contentRating=${val(row.contentRating || row.bestContentRating)}` : '',
        row?.hasGirlsLove ? 'hasGirlsLove=true' : '',
      ].filter(Boolean).join('; '),
    })
  }

  for (const row of ndl.bibliographicRows) {
    const externalId = val(row?.identifier || row?.isbn || row?.link)
    const url = normalizeUrl(row?.link)
    if (!externalId && !url) continue
    sources.push({
      source: 'ndl',
      label: 'NDL',
      externalId,
      url,
      note: [
        'NDL OpenSearch bibliographic integration audit',
        row?.isbn ? `isbn=${compactLine(row.isbn)}` : '',
        row?.materialType ? `materialType=${compactLine(row.materialType)}` : '',
      ].filter(Boolean).join('; '),
    })
  }

  return uniqueBy(sources, (item) => [item.source, item.externalId, normalizeUrl(item.url)].join('|'))
}

function groupRawRows({ mangaDexReviewRows, mangaDexBestRows, ndlReviewRows, ndlManifestRows }) {
  const groups = new Map()
  const queryToRawSourceIds = new Map()

  function ensure(rawSourceId, bangumiSubjectId = '', fallbackKey = '') {
    const key = bangumiSubjectId ? `bangumi:${bangumiSubjectId}` : rawSourceId ? `raw:${rawSourceId}` : fallbackKey
    if (!groups.has(key)) {
      groups.set(key, { key, rawSourceId: rawSourceId || '', bangumiSubjectId: bangumiSubjectId || '', mangaDexRows: [], mangaDexBestRows: [], ndlRows: [], ndlManifestRows: [] })
    }
    const group = groups.get(key)
    if (!group.bangumiSubjectId && bangumiSubjectId) group.bangumiSubjectId = bangumiSubjectId
    if (!group.rawSourceId && rawSourceId) group.rawSourceId = rawSourceId
    return group
  }

  for (const row of ndlManifestRows) {
    const rawSourceId = rawSourceIdOf(row)
    const bangumiSubjectId = bangumiSubjectIdOf(row)
    const query = normalizeText(row?.query)
    if (rawSourceId && query) {
      if (!queryToRawSourceIds.has(query)) queryToRawSourceIds.set(query, new Set())
      queryToRawSourceIds.get(query).add(rawSourceId)
    }
    ensure(rawSourceId, bangumiSubjectId, `ndl-manifest:${query || groups.size}`).ndlManifestRows.push(row)
  }

  for (const row of mangaDexReviewRows) {
    const rawSourceId = rawSourceIdOf(row)
    const bangumiSubjectId = bangumiSubjectIdOf(row)
    ensure(rawSourceId, bangumiSubjectId, `mangadex:${mangaDexId(row) || normalizeText(row?.query) || groups.size}`).mangaDexRows.push(row)
  }

  for (const row of mangaDexBestRows) {
    const rawSourceId = rawSourceIdOf(row)
    const bangumiSubjectId = bangumiSubjectIdOf(row)
    ensure(rawSourceId, bangumiSubjectId, `mangadex-best:${mangaDexId(row) || normalizeText(row?.query) || groups.size}`).mangaDexBestRows.push(row)
  }

  for (const row of ndlReviewRows) {
    const queryKey = normalizeText(row?.query)
    const candidates = [...(queryToRawSourceIds.get(queryKey) || [])]
    const rawSourceId = candidates.length === 1 ? candidates[0] : rawSourceIdOf(row)
    const bangumiSubjectId = bangumiSubjectIdOf(row)
    ensure(rawSourceId, bangumiSubjectId, `ndl:${queryKey || normalizeUrl(row?.link) || groups.size}`).ndlRows.push(row)
  }

  return [...groups.values()]
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

function matchGroup(group, indexes) {
  if (group.bangumiSubjectId && indexes.byBangumiId.has(group.bangumiSubjectId)) {
    return { status: 'matched_by_bangumi_id', work: indexes.byBangumiId.get(group.bangumiSubjectId), matchedTitles: [], candidates: [] }
  }

  const primary = candidatesFromTitles(primaryTitlesForGroup(group), indexes)
  if (primary.candidates.length === 1) {
    const work = primary.candidates[0]
    const source = sourceOf(work)
    return {
      status: source === 'bangumi' ? 'matched_by_primary_title_with_bangumi_source' : 'matched_by_primary_title_without_bangumi_source',
      work,
      matchedTitles: primary.matchedTitles,
      candidates: primary.candidates,
    }
  }
  if (primary.candidates.length > 1) return { status: 'primary_title_multi_match', work: null, matchedTitles: primary.matchedTitles, candidates: primary.candidates }

  const fallback = candidatesFromTitles(titlesForGroup(group), indexes)
  if (fallback.candidates.length === 1) {
    const work = fallback.candidates[0]
    const source = sourceOf(work)
    return {
      status: source === 'bangumi' ? 'matched_by_title_with_bangumi_source' : 'matched_by_title_without_bangumi_source',
      work,
      matchedTitles: fallback.matchedTitles,
      candidates: fallback.candidates,
    }
  }
  if (fallback.candidates.length > 1) return { status: 'title_multi_match', work: null, matchedTitles: fallback.matchedTitles, candidates: fallback.candidates }
  return { status: 'no_match', work: null, matchedTitles: [], candidates: [] }
}

function buildPlan(group, indexes) {
  const match = matchGroup(group, indexes)
  const work = match.work
  const warnings = []
  const blockers = []
  const md = selectedMangaDexRows(group)
  const ndl = selectedNdlRows(group)
  const incomingTitles = titlesForGroup(group)
  const incomingCreators = incomingCreatorNames(group)
  const incomingPublisherNames = incomingPublishers(group)
  const incomingYearLabels = incomingYears(group)
  const hasMangaDex = md.bestRows.length > 0 || md.detailRows.length > 0
  const hasNdl = ndl.manifestRows.length > 0 || ndl.bibliographicRows.length > 0

  if (group.rawSourceId && !group.bangumiSubjectId && /^row-\d+$/u.test(group.rawSourceId)) warnings.push('raw_source_id_not_bangumi_subject_id')
  if (group.bangumiSubjectId && !indexes.byBangumiId.has(group.bangumiSubjectId)) warnings.push('bangumi_id_not_found_in_works')
  if (ndl.nonBookRows.length) warnings.push('ndl_non_book_material_deferred')
  if (match.status === 'title_multi_match' || match.status === 'primary_title_multi_match') blockers.push(match.status)
  if (match.status === 'matched_by_title_without_bangumi_source' || match.status === 'matched_by_primary_title_without_bangumi_source') blockers.push('matched_work_without_bangumi_source_review_required')
  if (match.status === 'no_match' && !hasMangaDex) blockers.push('ndl_only_no_work_match')

  let action = 'defer'
  if (match.status === 'matched_by_bangumi_id') action = 'enrich_existing_bangumi_work'
  else if (match.status === 'matched_by_primary_title_with_bangumi_source') action = 'enrich_primary_title_matched_bangumi_work'
  else if (match.status === 'matched_by_title_with_bangumi_source') action = 'enrich_title_matched_bangumi_work'
  else if (match.status === 'matched_by_title_without_bangumi_source' || match.status === 'matched_by_primary_title_without_bangumi_source') action = 'propose_merge_existing_non_bangumi_work'
  else if (match.status === 'title_multi_match' || match.status === 'primary_title_multi_match') action = 'defer_title_ambiguous'
  else if (match.status === 'no_match' && hasMangaDex) action = 'create_mangadex_draft_candidate'
  else if (match.status === 'no_match' && hasNdl) action = 'defer_ndl_bibliographic_candidate'

  const existingSearchableNames = work ? searchableWorkNames(work) : []
  const searchTextAdditions = differenceNormalized(incomingTitles, existingSearchableNames)
  if (searchTextAdditions.length) warnings.push('has_search_text_additions')

  const beforeLinks = work ? sourceLinkRows(work) : []
  const beforeSources = work ? candidateSourceRows(work) : []
  const sourceLinks = linksForGroup(group)
  const candidateSources = candidateSourcesForGroup(group)
  const sourceLinkAdditions = work ? sourceLinks.filter((item) => !beforeLinks.some((existing) => normalizeUrl(existing.url) === normalizeUrl(item.url))) : sourceLinks
  const candidateSourceAdditions = work ? candidateSources.filter((item) => !beforeSources.some((existing) => [val(existing.source), val(existing.externalId), normalizeUrl(existing.url)].join('|') === [val(item.source), val(item.externalId), normalizeUrl(item.url)].join('|'))) : candidateSources

  const existingCreators = work ? workCreatorNames(work) : []
  const existingPublishers = work ? workPublisherNames(work) : []
  const existingYears = work ? workYearLabels(work) : []
  const creatorDiff = incomingCreators.length && work ? differenceNormalized(incomingCreators, existingCreators) : incomingCreators
  const publisherDiff = incomingPublisherNames.length && work ? differenceNormalized(incomingPublisherNames, existingPublishers) : incomingPublisherNames
  const yearDiff = incomingYearLabels.length && work && existingYears.length ? incomingYearLabels.filter((item) => !existingYears.includes(item)) : []

  if (creatorDiff.length) warnings.push('creator_diff_or_missing')
  if (publisherDiff.length) warnings.push('publisher_diff_or_missing')
  if (yearDiff.length) warnings.push('year_diff_or_missing')
  if (!sourceLinkAdditions.length && !candidateSourceAdditions.length && !searchTextAdditions.length && !creatorDiff.length && !publisherDiff.length && !yearDiff.length) warnings.push('no_new_information_detected')

  const changedFields = []
  if (searchTextAdditions.length) changedFields.push('searchText')
  if (sourceLinkAdditions.length) changedFields.push('sourceLinks')
  if (candidateSourceAdditions.length) changedFields.push('candidateSources')
  if (creatorDiff.length) changedFields.push('creatorDiffReport')
  if (publisherDiff.length) changedFields.push('publisherDiffReport')
  if (yearDiff.length) changedFields.push('yearDiffReport')

  return {
    key: group.key,
    sourceId: group.bangumiSubjectId,
    rawSourceId: group.rawSourceId,
    action,
    matchStatus: match.status,
    planStatus: blockers.length ? 'blocked_or_review_required' : 'ready_for_apply_review',
    confidence: match.status === 'matched_by_bangumi_id' ? 'high' : match.status.includes('primary_title') ? 'medium' : match.status === 'matched_by_title_with_bangumi_source' ? 'medium_low' : 'review',
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    changedFields,
    counts: {
      mangaDexRows: group.mangaDexRows.length,
      selectedMangaDexRows: md.evidenceRows.length,
      mangaDexBestRows: group.mangaDexBestRows.length,
      ndlRows: group.ndlRows.length,
      ndlBibliographicRows: ndl.bibliographicRows.length,
      ndlNonBookRows: ndl.nonBookRows.length,
      ndlManifestRows: group.ndlManifestRows.length,
      incomingTitles: incomingTitles.length,
    },
    work: work ? {
      id: val(work.id),
      title: val(work.title),
      slug: val(work.slug),
      siteId: val(work.siteId),
      source: sourceOf(work),
      bangumiSubjectId: externalIdsOf(work).bangumiSubjectId || '',
    } : null,
    titleCandidates: incomingTitles,
    ndlReviewTitlesForReport: ndlReviewTitlesForReport(group),
    matchedTitles: match.matchedTitles,
    matchedCandidates: match.candidates.map((item) => ({ id: val(item.id), title: val(item.title), slug: val(item.slug), source: sourceOf(item), bangumiSubjectId: externalIdsOf(item).bangumiSubjectId || '' })),
    fieldAdditions: {
      searchTextAdditions,
      sourceLinks: sourceLinkAdditions,
      candidateSources: candidateSourceAdditions,
    },
    diffReport: {
      incomingCreators,
      existingCreators,
      missingIncomingCreators: creatorDiff,
      incomingPublishers: incomingPublisherNames,
      existingPublishers,
      missingIncomingPublishers: publisherDiff,
      incomingYears: incomingYearLabels,
      existingYears,
      differingIncomingYears: yearDiff,
    },
    createCandidatePreview: !work && hasMangaDex ? {
      title: incomingTitles[0] || '',
      originalTitle: incomingTitles[0] || '',
      mediaGroup: 'manga',
      mediaType: 'manga',
      reviewStatus: 'pending',
      ratingNotice: 'insufficient_information',
      searchTextAdditions: incomingTitles,
      candidateSources,
      sourceLinks,
    } : null,
    selectionPolicy: {
      mangaDexSearchCandidatesUsedForSearchText: false,
      mangaDexOnlyBestMatchAndSelectedDetailUsed: true,
      ndlNonBookMaterialsDeferredFromPatchPlan: true,
      rawRowSourceIdTreatedAsBangumiId: false,
    },
    searchTextPolicy: {
      allIncomingLanguageTitlesIncludedFromSelectedSourceRecords: true,
      duplicateTitlesRemovedByNormalizedText: true,
      titleOverwrite: false,
      localizedTitlesWrite: false,
      appendToSearchTextOnly: true,
    },
    safety: {
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
    '# MangaDex + NDL Work Integration Audit v0.2',
    '',
    'Read-only integration audit for MangaDex and NDL rows aligned from Bangumi books.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- worksRead: ${summary.worksRead}`,
    `- groupsBuilt: ${summary.groupsBuilt}`,
    `- readyForApplyReview: ${summary.readyForApplyReview}`,
    `- blockedOrReviewRequired: ${summary.blockedOrReviewRequired}`,
    `- rowsWithSearchTextAdditions: ${summary.rowsWithSearchTextAdditions}`,
    `- totalSearchTextAdditions: ${summary.totalSearchTextAdditions}`,
    '',
    '## Selection policy',
    '',
    '- Raw `row-*` source ids are not treated as Bangumi subject ids.',
    '- MangaDex search candidates are not used as work titles or patch-plan links.',
    '- Only the MangaDex best row and its selected detail row are used for `searchText`, `sourceLinks`, and `candidateSources` proposals.',
    '- NDL non-book materials are kept in the report but are deferred from patch-plan links and sources.',
    '- New names are proposed only as `searchText` additions; `title`, `originalTitle`, `aliases`, and `localizedTitles` are not overwritten.',
    '',
    '## Safety',
    '',
    '- Payload read only.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No data change.',
    '- Patch plans are proposals only.',
    '',
    '## Actions',
    '',
    '| Action | Count |',
    '|---|---:|',
    ...Object.entries(summary.byAction).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Match status',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...Object.entries(summary.byMatchStatus).map(([key, count]) => `| ${key} | ${count} |`),
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
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const depth = Number(args.depth || 1)
  const mangaDexReviewPath = String(args['mangadex-review'] || DEFAULT_MANGADEX_REVIEW)
  const mangaDexBestPath = String(args['mangadex-best'] || DEFAULT_MANGADEX_BEST)
  const ndlReviewPath = String(args['ndl-review'] || DEFAULT_NDL_REVIEW)
  const ndlManifestPath = String(args['ndl-manifest'] || DEFAULT_NDL_MANIFEST)
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const mangaDexReview = await readJsonlIfExists(mangaDexReviewPath)
  const mangaDexBest = await readJsonlIfExists(mangaDexBestPath)
  const ndlReview = await readJsonlIfExists(ndlReviewPath)
  const ndlManifest = await readJsonlIfExists(ndlManifestPath)

  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token, depth)
  const indexes = buildWorkIndexes(works.docs)
  const groups = groupRawRows({
    mangaDexReviewRows: mangaDexReview.rows,
    mangaDexBestRows: mangaDexBest.rows,
    ndlReviewRows: ndlReview.rows,
    ndlManifestRows: ndlManifest.rows,
  })
  const plans = groups.map((group) => buildPlan(group, indexes))
  const ready = plans.filter((item) => item.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((item) => item.planStatus !== 'ready_for_apply_review')
  const conflicts = plans.filter((item) => item.blockers.length || item.diffReport.missingIncomingCreators.length || item.diffReport.missingIncomingPublishers.length || item.diffReport.differingIncomingYears.length)
  const createCandidates = plans.filter((item) => item.action === 'create_mangadex_draft_candidate')
  const patchPlan = plans.filter((item) => item.fieldAdditions.searchTextAdditions.length || item.fieldAdditions.sourceLinks.length || item.fieldAdditions.candidateSources.length)
  const changedFields = plans.flatMap((item) => item.changedFields || [])
  const warnings = plans.flatMap((item) => item.warnings || [])
  const blockers = plans.flatMap((item) => item.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'mangadex-ndl-work-integration-v01.rows.jsonl'),
    ready: path.join(outDir, 'mangadex-ndl-work-integration-v01-ready.jsonl'),
    blocked: path.join(outDir, 'mangadex-ndl-work-integration-v01-blocked.jsonl'),
    conflicts: path.join(outDir, 'mangadex-ndl-work-integration-v01-conflicts.jsonl'),
    createCandidates: path.join(outDir, 'mangadex-ndl-work-integration-v01-create-candidates.jsonl'),
    patchPlan: path.join(outDir, 'mangadex-ndl-work-integration-v01-patch-plan.jsonl'),
    summary: path.join(outDir, 'mangadex-ndl-work-integration-v01-summary.json'),
    preview: path.join(outDir, 'mangadex-ndl-work-integration-v01-preview.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: mangaDexReview.failed === 0 && mangaDexBest.failed === 0 && ndlReview.failed === 0 && ndlManifest.failed === 0,
    payloadBaseUrl: baseUrl,
    payloadDepth: depth,
    inputs: {
      mangaDexReview: { file: mangaDexReviewPath, exists: mangaDexReview.exists, read: mangaDexReview.read, loaded: mangaDexReview.rows.length, failed: mangaDexReview.failed },
      mangaDexBest: { file: mangaDexBestPath, exists: mangaDexBest.exists, read: mangaDexBest.read, loaded: mangaDexBest.rows.length, failed: mangaDexBest.failed },
      ndlReview: { file: ndlReviewPath, exists: ndlReview.exists, read: ndlReview.read, loaded: ndlReview.rows.length, failed: ndlReview.failed },
      ndlManifest: { file: ndlManifestPath, exists: ndlManifest.exists, read: ndlManifest.read, loaded: ndlManifest.rows.length, failed: ndlManifest.failed },
    },
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    groupsBuilt: groups.length,
    readyForApplyReview: ready.length,
    blockedOrReviewRequired: blocked.length,
    conflictRows: conflicts.length,
    createCandidateRows: createCandidates.length,
    patchPlanRows: patchPlan.length,
    rowsWithSearchTextAdditions: plans.filter((item) => item.fieldAdditions.searchTextAdditions.length).length,
    totalSearchTextAdditions: plans.reduce((sum, item) => sum + item.fieldAdditions.searchTextAdditions.length, 0),
    byAction: countBy(plans, 'action'),
    byMatchStatus: countBy(plans, 'matchStatus'),
    byPlanStatus: countBy(plans, 'planStatus'),
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
      patchPlanOnly: true,
    },
  }

  const samples = {
    ready: ready.slice(0, 20),
    blocked: blocked.slice(0, 20),
    createCandidates: createCandidates.slice(0, 20),
    searchTextAdditions: plans.filter((item) => item.fieldAdditions.searchTextAdditions.length).slice(0, 20),
  }

  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(outputs.rows, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.conflicts, conflicts)
  writeJsonl(outputs.createCandidates, createCandidates)
  writeJsonl(outputs.patchPlan, patchPlan)
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.preview, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
