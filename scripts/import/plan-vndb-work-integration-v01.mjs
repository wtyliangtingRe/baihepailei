#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'vndb-work-integration-plan-v0.1'
const DEFAULT_INPUTS = [
  'data_local/staging/vndb/vndb.json',
  'data_local/staging/vndb/vndb.jsonl',
  'data_local/staging/vndb/vndb-vn.json',
  'data_local/staging/vndb/vndb-vn.jsonl',
  'data_local/staging/vndb/vns.json',
  'data_local/staging/vndb/vns.jsonl',
]
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-work-integration'
const PAGE_LIMIT = 200
const SOURCE_MARKERS = ['bangumi', 'mangadex', 'ndl', 'wikidata', 'vndb']
const PROTECTED_MARKERS = ['bangumi', 'mangadex', 'ndl', 'wikidata']
const MAX_SEARCH_TEXT_ADDITIONS = 40
const MAX_HIDDEN_DESCRIPTION_CHARS = 12000
const TITLE_SEPARATOR_RE = /[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu
const INVISIBLE_TITLE_RE = /[\u200b\u200c\u200d\u2060\ufeff]/gu
const CJKISH_TITLE_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]/u

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

function cleanTitleText(value) {
  return repairInternalTitleSpaces(value)
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

function readJsonOrJsonl(file) {
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  if (raw.startsWith('[') || raw.startsWith('{')) {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((row) => ({ ...row, __inputFile: file }))
    for (const key of ['results', 'items', 'docs', 'data', 'vns']) {
      if (Array.isArray(parsed?.[key])) return parsed[key].map((row) => ({ ...row, __inputFile: file }))
    }
    return [{ ...parsed, __inputFile: file }]
  }
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

function vndbIdOf(row) {
  const raw = val(row?.id || row?.vndbId || row?.vnid)
  const hit = raw.match(/^v?\d+$/iu)?.[0]
  return hit ? `v${hit.replace(/^v/iu, '')}`.toLowerCase() : ''
}

function qidFromUrl(value) {
  return val(value).match(/Q\d+/iu)?.[0]?.toUpperCase() || ''
}

function qidOf(row) {
  for (const item of list(row?.extlinks)) {
    if (val(item?.name).toLowerCase() === 'wikidata' || /wikidata\.org/u.test(val(item?.url))) {
      const qid = qidFromUrl(item?.url) || qidFromUrl(item?.id)
      if (qid) return qid
    }
  }
  return qidFromUrl(row?.wikidataQid || row?.qid || row?.wikidata)
}

function vndbUrl(id) {
  return id ? `https://vndb.org/${id}` : ''
}

function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function sourceLinkRows(doc) {
  return list(doc?.sourceLinks)
    .map((item) => ({ label: cleanLine(item?.label), url: val(item?.url).replace(/\/+$/u, '') }))
    .filter((item) => item.url)
}

function candidateSourceRows(doc) {
  return list(doc?.candidateSources)
    .map((item) => ({
      source: val(item?.source),
      label: cleanLine(item?.label),
      externalId: val(item?.externalId),
      url: val(item?.url).replace(/\/+$/u, ''),
      fetchedAt: item?.fetchedAt,
      note: val(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url || item.note)
}

function aliasValues(doc) {
  return list(doc?.aliases).map((item) => cleanTitleText(item?.value)).filter(Boolean)
}

function existingSearchTextValues(work) {
  return val(work?.searchText) ? val(work.searchText).split(/[\r\n|]+/u).map(cleanTitleText).filter(Boolean) : []
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
  if (ids.vndbId || /vndb|vndb\.org/u.test(haystack)) markers.add('vndb')
  return SOURCE_MARKERS.filter((marker) => markers.has(marker))
}

function titleCandidatesOf(row) {
  const titles = []
  titles.push(row?.title, row?.alttitle)
  for (const item of list(row?.titles)) {
    titles.push(item?.title, item?.latin)
  }
  titles.push(...list(row?.aliases))
  return uniqueTitleValues(titles).slice(0, MAX_SEARCH_TEXT_ADDITIONS)
}

function baseTitleOf(row) {
  const title = cleanTitleText(row?.title)
  return title || titleCandidatesOf(row)[0] || ''
}

function originalTitleOf(row) {
  const officialOriginal = list(row?.titles).find((item) => item?.official && item?.main && item?.title)?.title
  return cleanTitleText(row?.alttitle || officialOriginal || list(row?.titles).find((item) => item?.lang === row?.olang)?.title || baseTitleOf(row))
}

function descriptionOf(row) {
  return val(row?.description)
    .replace(/\[url=([^\]]+)\]([^\[]+)\[\/url\]/giu, '$2 ($1)')
    .replace(/\[url\]([^\[]+)\[\/url\]/giu, '$1')
    .replace(/\[(?:b|i|u|spoiler)\]/giu, '')
    .replace(/\[\/(?:b|i|u|spoiler)\]/giu, '')
    .trim()
}

function hasSummary(work) {
  if (!work?.summary) return false
  if (typeof work.summary === 'string') return Boolean(val(work.summary))
  return JSON.stringify(work.summary).length > 80
}

function lexicalParagraphs(text) {
  const paragraphs = val(text).split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean).slice(0, 12)
  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      children: paragraphs.map((paragraph) => ({
        type: 'paragraph',
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
        children: [{ type: 'text', version: 1, text: paragraph, detail: 0, format: 0, mode: 'normal', style: '' }],
      })),
      direction: 'ltr',
    },
  }
}

function extSourceLinks(row, id, qid) {
  const links = [{ label: 'VNDB', url: vndbUrl(id) }]
  for (const item of list(row?.extlinks)) {
    const url = val(item?.url).replace(/\/+$/u, '')
    if (!url) continue
    links.push({ label: cleanLine(item?.label || item?.name || url), url })
  }
  if (qid) links.push({ label: 'Wikidata', url: `https://www.wikidata.org/wiki/${qid}` })
  return uniqueBy(links, (item) => val(item.url).toLowerCase())
}

function developersText(row) {
  return list(row?.developers).map((item) => [cleanLine(item?.name), cleanLine(item?.original)].filter(Boolean).join(' / ')).filter(Boolean).join(', ')
}

function contentNotes(row) {
  const sexual = Number(row?.image?.sexual ?? 0)
  const violence = Number(row?.image?.violence ?? 0)
  const notes = []
  if (sexual >= 2) notes.push('contentRating=erotica', 'contentVisibility=adult', 'adultOrMarkedContent=true')
  else if (sexual >= 1) notes.push('contentRating=suggestive')
  if (violence >= 1) notes.push(`contentWarning=violence:${violence}`)
  return notes
}

function candidateSourcesOf(row, id, qid, hasExistingSummary) {
  const noteParts = [
    `VNDB work candidate ${id}`,
    `rating=${val(row?.rating || row?.average) || 'missing'}`,
    `votecount=${val(row?.votecount) || 'missing'}`,
    `released=${val(row?.released) || 'missing'}`,
    `olang=${val(row?.olang) || 'missing'}`,
    `languages=${list(row?.languages).join(',') || 'missing'}`,
    `platforms=${list(row?.platforms).join(',') || 'missing'}`,
    `developers=${developersText(row) || 'missing'}`,
    `length=${val(row?.length) || 'missing'}`,
    `lengthMinutes=${val(row?.length_minutes) || 'missing'}`,
    `imageSexual=${val(row?.image?.sexual) || '0'}`,
    `imageViolence=${val(row?.image?.violence) || '0'}`,
    descriptionOf(row) ? `description=${hasExistingSummary ? 'hidden_existing_summary_present' : 'used_when_summary_empty'}` : 'description=missing',
    ...contentNotes(row),
    'sourcePolicy=VNDB enriches marked works and may overwrite unmarked matched works',
  ]
  return [{ source: 'vndb', label: 'VNDB', externalId: id, url: vndbUrl(id), note: noteParts.filter(Boolean).join('; ') }]
}

function mergeSearchTextAdditions(row, work) {
  const values = uniqueTitleValues([
    ...titleCandidatesOf(row),
    work?.title,
    work?.originalTitle,
    ...aliasValues(work),
    ...existingSearchTextValues(work),
  ])
  const existingKeys = new Set(existingSearchTextValues(work).map(normalizeText).filter(Boolean))
  return values.filter((item) => !existingKeys.has(normalizeText(item))).slice(0, MAX_SEARCH_TEXT_ADDITIONS)
}

function buildIndexes(works) {
  const byVndb = new Map()
  const byQid = new Map()
  const byTitle = new Map()
  for (const work of works) {
    const ids = externalIdsOf(work)
    if (ids.vndbId) byVndb.set(ids.vndbId.toLowerCase(), work)
    if (ids.wikidataQid) byQid.set(ids.wikidataQid.toUpperCase(), work)
    for (const item of candidateSourceRows(work)) {
      const vndb = val(item.externalId).match(/^v\d+$/iu)?.[0]?.toLowerCase()
      if ((item.source === 'vndb' || /vndb\.org/u.test(item.url)) && vndb) byVndb.set(vndb, work)
      const urlVndb = val(item.url).match(/vndb\.org\/v(\d+)/iu)?.[1]
      if (urlVndb) byVndb.set(`v${urlVndb}`.toLowerCase(), work)
    }
    for (const item of sourceLinkRows(work)) {
      const urlVndb = val(item.url).match(/vndb\.org\/v(\d+)/iu)?.[1]
      if (urlVndb) byVndb.set(`v${urlVndb}`.toLowerCase(), work)
    }
    for (const title of uniqueTitleValues([work.title, work.originalTitle, ...aliasValues(work), ...existingSearchTextValues(work)])) {
      const key = normalizeText(title)
      if (!key) continue
      if (!byTitle.has(key)) byTitle.set(key, [])
      byTitle.get(key).push(work)
    }
  }
  return { byVndb, byQid, byTitle }
}

function findMatch(row, indexes) {
  const id = vndbIdOf(row)
  const qid = qidOf(row)
  if (id && indexes.byVndb.has(id)) return { work: indexes.byVndb.get(id), matchBy: 'vndbId' }
  if (qid && indexes.byQid.has(qid)) return { work: indexes.byQid.get(qid), matchBy: 'wikidataQid' }
  const matches = uniqueBy(titleCandidatesOf(row).flatMap((title) => indexes.byTitle.get(normalizeText(title)) || []), (work) => val(work.id))
  if (matches.length === 1) return { work: matches[0], matchBy: 'exact_title' }
  if (matches.length > 1) return { work: null, matchBy: 'ambiguous_title', blockers: ['ambiguous_existing_title_match'], matchedExisting: matches.slice(0, 8).map((work) => ({ id: work.id, title: work.title, slug: work.slug })) }
  return { work: null, matchBy: 'no_match' }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
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

function planRow(row, indexes) {
  const id = vndbIdOf(row)
  const qid = qidOf(row)
  const match = findMatch(row, indexes)
  const work = match.work
  const markers = work ? sourceMarkersOf(work) : []
  const protectedMarkers = markers.filter((marker) => PROTECTED_MARKERS.includes(marker))
  const existingIds = work ? externalIdsOf(work) : {}
  const desc = descriptionOf(row)
  const currentHasSummary = work ? hasSummary(work) : false
  const title = baseTitleOf(row)
  const originalTitle = originalTitleOf(row)
  const searchTextAdditions = work ? mergeSearchTextAdditions(row, work) : titleCandidatesOf(row)
  const blockers = [...list(match.blockers)]
  const fieldUpdates = {}
  const fieldAdditions = {
    searchTextAdditions,
    externalIds: {},
    sourceLinks: extSourceLinks(row, id, qid),
    candidateSources: candidateSourcesOf(row, id, qid, currentHasSummary),
  }

  if (!id) blockers.push('missing_vndb_id')
  if (!title) blockers.push('missing_title')
  if (existingIds.vndbId && id && existingIds.vndbId.toLowerCase() !== id) blockers.push('current_vndb_id_conflict')
  if (existingIds.wikidataQid && qid && existingIds.wikidataQid.toUpperCase() !== qid) blockers.push('current_wikidata_qid_conflict')
  for (const item of [title, originalTitle, ...searchTextAdditions]) {
    if (suspiciousTitleSpaceScore(item) > 0) blockers.push('suspicious_title_spacing_after_cleaning')
    if (CJKISH_TITLE_RE.test(item) && /^\s|\s$/u.test(item)) blockers.push('suspicious_title_edge_spacing_after_cleaning')
  }

  if (id && !existingIds.vndbId) fieldAdditions.externalIds.vndbId = id
  if (qid && !existingIds.wikidataQid) fieldAdditions.externalIds.wikidataQid = qid

  let action = 'vndb_create_candidate_preview'
  if (work?.id && !blockers.length) {
    action = protectedMarkers.length || markers.includes('vndb') ? 'vndb_enrich_marked_existing_work' : 'vndb_overwrite_unmarked_existing_work'
    if (action === 'vndb_overwrite_unmarked_existing_work') {
      if (title && normalizeText(title) !== normalizeText(work.title)) fieldUpdates.title = title
      if (originalTitle && normalizeText(originalTitle) !== normalizeText(work.originalTitle)) fieldUpdates.originalTitle = originalTitle
      if (work.chosenBaseSource !== 'vndb') fieldUpdates.chosenBaseSource = 'vndb'
    }
    if (desc && !currentHasSummary) fieldUpdates.summary = lexicalParagraphs(desc)
    if (desc && currentHasSummary && !val(work.evidenceNote).includes(`VNDB hidden description ${id}`)) {
      const hidden = desc.slice(0, MAX_HIDDEN_DESCRIPTION_CHARS)
      fieldUpdates.evidenceNote = [val(work.evidenceNote), `VNDB hidden description ${id}:\n${hidden}`].filter(Boolean).join('\n\n')
    }
  } else if (!work?.id) {
    blockers.push('no_existing_work_match')
  }

  const ready = Boolean(work?.id && !blockers.length)
  return {
    key: id || qid || title,
    vndbId: id,
    vndbUrl: vndbUrl(id),
    wikidataQid: qid,
    titleCandidates: titleCandidatesOf(row),
    action,
    matchBy: match.matchBy,
    planStatus: ready ? 'ready_for_apply_review' : 'blocked_or_review_required',
    confidence: ready ? (action === 'vndb_overwrite_unmarked_existing_work' ? 'ready_overwrite_unmarked' : 'ready_enrich_marked') : 'manual_review',
    blockers: uniqueBy(blockers, (item) => item),
    warnings: uniqueBy([
      desc && currentHasSummary ? 'description_hidden_existing_summary_present' : '',
      ...contentNotes(row),
    ].map(cleanLine).filter(Boolean), (item) => item),
    work: work ? {
      id: val(work.id),
      title: val(work.title),
      originalTitle: val(work.originalTitle),
      slug: val(work.slug),
      sourceMarkers: markers,
      protectedSourceMarkers: protectedMarkers,
      currentVndbId: existingIds.vndbId || '',
      currentWikidataQid: existingIds.wikidataQid || '',
      hasSummary: currentHasSummary,
    } : null,
    matchedExisting: match.matchedExisting || [],
    fieldUpdates,
    fieldAdditions,
    createCandidatePreview: !work?.id ? {
      title,
      originalTitle,
      vndbId: id,
      wikidataQid: qid,
      searchTextAdditions,
      sourceLinks: fieldAdditions.sourceLinks,
      candidateSources: fieldAdditions.candidateSources,
      descriptionAvailable: Boolean(desc),
    } : null,
    raw: {
      inputFile: row.__inputFile,
      released: row.released,
      languages: row.languages,
      platforms: row.platforms,
      developers: row.developers,
      image: row.image,
      tags: row.tags,
    },
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      futureApplyMustBeGuarded: true,
      protectedMarkedWorksAreEnrichedOnly: true,
      unmarkedMatchedWorksMayBeOverwritten: true,
      alwaysAddsVndbMarkerWhenMissing: true,
      allVndbTitlesGoToSearchText: true,
      writesSummaryOnlyWhenMissing: true,
      hidesDescriptionWhenSummaryExists: true,
      doesNotWriteDates: true,
      doesNotWriteMediaTypeOrRiskFields: true,
      doesNotDownloadImages: true,
      doesNotWriteTagsOrCreators: true,
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

  const sourceRows = inputs.flatMap(readJsonOrJsonl)
  const dedupedRows = uniqueBy(sourceRows, (row) => vndbIdOf(row) || normalizeText(baseTitleOf(row)))
  const rowsToProcess = limit > 0 ? dedupedRows.slice(0, limit) : dedupedRows
  const login = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  const token = login?.token
  if (!token) throw new Error('Payload login did not return a token')
  const works = await fetchAllWorks(baseUrl, token, 1)
  const indexes = buildIndexes(works.docs)
  const plans = rowsToProcess.map((row) => planRow(row, indexes))
  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const createCandidates = plans.filter((row) => row.action === 'vndb_create_candidate_preview')

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    rows: `${outDir}/vndb-work-integration-v01.rows.jsonl`,
    ready: `${outDir}/vndb-work-integration-v01-ready.jsonl`,
    blocked: `${outDir}/vndb-work-integration-v01-blocked.jsonl`,
    createCandidates: `${outDir}/vndb-work-integration-v01-create-candidates.jsonl`,
    sample: `${outDir}/vndb-work-integration-v01-sample.jsonl`,
    summary: `${outDir}/vndb-work-integration-v01-summary.json`,
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
    byAction: countBy(plans, 'action'),
    byPlanStatus: countBy(plans, 'planStatus'),
    byMatchBy: countBy(plans, 'matchBy'),
    byBlocker: countBy(plans.flatMap((row) => row.blockers), (item) => item),
    byWarning: countBy(plans.flatMap((row) => row.warnings), (item) => item),
    byChangedField: countBy(changedFieldNames, (item) => item),
    bySourceMarker: countBy(plans.flatMap((row) => row.work?.sourceMarkers || []), (item) => item),
    byProtectedSourceMarker: countBy(plans.flatMap((row) => row.work?.protectedSourceMarkers || []), (item) => item),
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      futureApplyMustBeGuarded: true,
      protectedMarkedWorksAreEnrichedOnly: true,
      unmarkedMatchedWorksMayBeOverwritten: true,
      alwaysAddsVndbMarkerWhenMissing: true,
      allVndbTitlesGoToSearchText: true,
      writesSummaryOnlyWhenMissing: true,
      hidesDescriptionWhenSummaryExists: true,
      doesNotWriteDates: true,
      doesNotWriteMediaTypeOrRiskFields: true,
      doesNotDownloadImages: true,
      doesNotWriteTagsOrCreators: true,
    },
    nextStep: 'Review ready/blocked/create samples, then run guarded apply dry-run. Do not apply until dry-run is clean.',
  }

  writeJsonl(outputs.rows, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.createCandidates, createCandidates)
  writeJsonl(outputs.sample, [...ready.slice(0, 80), ...createCandidates.slice(0, 50), ...blocked.slice(0, 80)])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
