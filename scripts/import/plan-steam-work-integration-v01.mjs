#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'steam-work-integration-plan-v0.1'
const DEFAULT_APPDETAILS_DIR = 'data_local/raw/steam/appdetails/schinese'
const DEFAULT_VNDB_APPIDS = 'data_local/raw/steam/index/steam-appid-from-vndb-urls-summary.jsonl'
const DEFAULT_BANGUMI_HIGH_MEDIUM = 'data_local/raw/steam/index/steam-bangumi-games-import-candidates-high-medium.csv'
const DEFAULT_OUT_DIR = 'data_local/staging/steam-work-integration'
const PAGE_LIMIT = 200
const MAX_SEARCH_TEXT_ADDITIONS = 50
const PROTECTED_MARKERS = ['bangumi', 'mangadex', 'ndl', 'wikidata', 'vndb', 'anilist']

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function cleanLine(value) {
  return val(value)
    .normalize('NFKC')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ')
    .trim()
}
function normalizeText(value) { return cleanLine(value).normalize('NFKC').toLowerCase() }
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
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
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
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  if (!rows.length) return []
  const header = rows[0].map((item) => cleanLine(item))
  return rows.slice(1).filter((items) => items.some((item) => val(item))).map((items) => Object.fromEntries(header.map((key, index) => [key || `col${index}`, items[index] ?? ''])))
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}
function readCsv(file) {
  if (!fs.existsSync(file)) return []
  return parseCsv(fs.readFileSync(file, 'utf8'))
}
function walkJsonFiles(input) {
  if (!fs.existsSync(input)) return []
  const stat = fs.statSync(input)
  if (stat.isFile()) return /\.json$/iu.test(input) ? [input] : []
  const out = []
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const full = path.join(input, entry.name)
    if (entry.isDirectory()) out.push(...walkJsonFiles(full))
    else if (/\.json$/iu.test(entry.name)) out.push(full)
  }
  return out.sort()
}
function flatPrimitiveEntries(value, prefix = '') {
  const out = []
  if (value == null) return out
  if (typeof value !== 'object') return [[prefix, val(value)]]
  if (Array.isArray(value)) {
    value.forEach((item, index) => out.push(...flatPrimitiveEntries(item, `${prefix}[${index}]`)))
    return out
  }
  for (const [key, item] of Object.entries(value)) out.push(...flatPrimitiveEntries(item, prefix ? `${prefix}.${key}` : key))
  return out
}
function steamAppIdFromText(value) {
  const text = val(value)
  return text.match(/store\.steampowered\.com\/app\/(\d+)/iu)?.[1]
    || text.match(/steam(?:_?app(?:lication)?_?id|_?appid|\s*app\s*id)?\D{0,12}(\d{2,10})/iu)?.[1]
    || (/^\d{2,10}$/u.test(text) ? text : '')
}
function steamAppIdsFromAny(row) {
  const ids = []
  for (const [key, value] of flatPrimitiveEntries(row)) {
    const lowerKey = key.toLowerCase()
    const fromUrl = val(value).match(/store\.steampowered\.com\/app\/(\d+)/iu)?.[1]
    if (fromUrl) ids.push(fromUrl)
    else if (/steam|appid|app_id|steam_appid/u.test(lowerKey)) {
      const id = steamAppIdFromText(value)
      if (id) ids.push(id)
    }
  }
  return [...new Set(ids)]
}
function vndbIdsFromAny(row) {
  const ids = []
  for (const [key, value] of flatPrimitiveEntries(row)) {
    const text = val(value)
    const lowerKey = key.toLowerCase()
    const url = text.match(/vndb\.org\/(v\d+)/iu)?.[1]
    if (url) ids.push(url.toLowerCase())
    else if (/vndb|vnid|vn_id|\bvn\b/u.test(lowerKey)) {
      const hit = text.match(/^v?\d+$/iu)?.[0]
      if (hit) ids.push(`v${hit.replace(/^v/iu, '')}`.toLowerCase())
    }
  }
  return [...new Set(ids)]
}
function bangumiIdsFromAny(row) {
  const ids = []
  for (const [key, value] of flatPrimitiveEntries(row)) {
    const text = val(value)
    const lowerKey = key.toLowerCase()
    const url = text.match(/(?:bgm\.tv|bangumi\.tv)\/subject\/(\d+)/iu)?.[1]
    if (url) ids.push(url)
    else if (/bangumi|bgm|subject/u.test(lowerKey) && /^\d+$/u.test(text)) ids.push(text)
  }
  return [...new Set(ids)]
}
function loadAppdetails(dir, limit = 0) {
  const files = walkJsonFiles(dir)
  const rows = []
  const errors = []
  for (const file of files) {
    if (limit > 0 && rows.length >= limit) break
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const key = Object.keys(parsed || {})[0]
      const wrapper = parsed?.success !== undefined ? parsed : parsed?.[key]
      const data = wrapper?.data || null
      if (wrapper?.success === true && data?.type === 'game' && data?.steam_appid) rows.push({ ...data, __inputFile: file })
    } catch (error) {
      errors.push({ file, error: String(error?.message || error).slice(0, 300) })
    }
  }
  return { rows, filesScanned: files.length, errors }
}
function steamUrl(appid) { return appid ? `https://store.steampowered.com/app/${appid}` : '' }
function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}
function sourceLinkRows(doc) {
  return list(doc?.sourceLinks).map((item) => ({ label: cleanLine(item?.label), url: val(item?.url).replace(/\/+$/u, '') })).filter((item) => item.url)
}
function candidateSourceRows(doc) {
  return list(doc?.candidateSources).map((item) => ({ source: val(item?.source), label: cleanLine(item?.label), externalId: val(item?.externalId), url: val(item?.url).replace(/\/+$/u, ''), fetchedAt: item?.fetchedAt, note: val(item?.note) })).filter((item) => item.source || item.externalId || item.url || item.note)
}
function aliasValues(doc) { return list(doc?.aliases).map((item) => cleanLine(item?.value)).filter(Boolean) }
function existingSearchTextValues(work) { return val(work?.searchText) ? val(work.searchText).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) : [] }
function exactTitleSet(work) { return new Set([work?.title, work?.originalTitle, ...aliasValues(work), ...existingSearchTextValues(work)].map(normalizeText).filter(Boolean)) }
function steamIdsOfWork(work) {
  const ids = []
  const ext = externalIdsOf(work)
  if (ext.steamAppId) ids.push(ext.steamAppId)
  for (const item of candidateSourceRows(work)) {
    if (item.source === 'steam' && /^\d+$/u.test(item.externalId)) ids.push(item.externalId)
    const fromUrl = item.url.match(/store\.steampowered\.com\/app\/(\d+)/iu)?.[1]
    if (fromUrl) ids.push(fromUrl)
  }
  for (const item of sourceLinkRows(work)) {
    const fromUrl = item.url.match(/store\.steampowered\.com\/app\/(\d+)/iu)?.[1]
    if (fromUrl) ids.push(fromUrl)
  }
  return [...new Set(ids)]
}
function vndbIdsOfWork(work) {
  const ids = []
  const ext = externalIdsOf(work)
  if (ext.vndbId) ids.push(ext.vndbId.toLowerCase())
  for (const item of [...candidateSourceRows(work), ...sourceLinkRows(work)]) {
    const fromUrl = item.url?.match(/vndb\.org\/(v\d+)/iu)?.[1]
    if (fromUrl) ids.push(fromUrl.toLowerCase())
    if (item.source === 'vndb' && /^v\d+$/iu.test(item.externalId)) ids.push(item.externalId.toLowerCase())
  }
  return [...new Set(ids)]
}
function bangumiIdsOfWork(work) {
  const ids = []
  const ext = externalIdsOf(work)
  if (ext.bangumiSubjectId) ids.push(ext.bangumiSubjectId)
  for (const item of [...candidateSourceRows(work), ...sourceLinkRows(work)]) {
    const fromUrl = item.url?.match(/(?:bgm\.tv|bangumi\.tv)\/subject\/(\d+)/iu)?.[1]
    if (fromUrl) ids.push(fromUrl)
    if (item.source === 'bangumi' && /^\d+$/u.test(item.externalId)) ids.push(item.externalId)
  }
  return [...new Set(ids)]
}
function sourceMarkersOf(work) {
  const text = [work?.siteId, ...sourceLinkRows(work).flatMap((x) => [x.label, x.url]), ...candidateSourceRows(work).flatMap((x) => [x.source, x.label, x.externalId, x.url, x.note])].map((x) => val(x).toLowerCase()).join('\n')
  const ids = externalIdsOf(work)
  const out = []
  if (ids.bangumiSubjectId || /bangumi|bgm\.tv|bangumi\.tv/u.test(text)) out.push('bangumi')
  if (/mangadex/u.test(text)) out.push('mangadex')
  if (/\bndl\b|iss\.ndl\.go\.jp|id\.ndl\.go\.jp/u.test(text)) out.push('ndl')
  if (ids.wikidataQid || /wikidata|wikidata\.org/u.test(text)) out.push('wikidata')
  if (ids.vndbId || /vndb|vndb\.org/u.test(text)) out.push('vndb')
  if (/anilist|anilist\.co/u.test(text)) out.push('anilist')
  if (steamIdsOfWork(work).length) out.push('steam')
  return [...new Set(out)]
}
function buildIndexes(works) {
  const bySteam = new Map(), byVndb = new Map(), byBangumi = new Map(), byTitle = new Map()
  for (const work of works) {
    for (const id of steamIdsOfWork(work)) bySteam.set(id, work)
    for (const id of vndbIdsOfWork(work)) byVndb.set(id.toLowerCase(), work)
    for (const id of bangumiIdsOfWork(work)) byBangumi.set(id, work)
    for (const key of exactTitleSet(work)) {
      if (!byTitle.has(key)) byTitle.set(key, [])
      byTitle.get(key).push(work)
    }
  }
  return { bySteam, byVndb, byBangumi, byTitle }
}
function mergeRelation(map, appid, patch) {
  if (!appid) return
  const current = map.get(appid) || { steamAppId: appid, vndbIds: [], bangumiIds: [], sourceKinds: [], sourceFiles: [], rawRows: 0, adultCandidate: false }
  current.vndbIds = uniqueBy([...current.vndbIds, ...list(patch.vndbIds)], (x) => x)
  current.bangumiIds = uniqueBy([...current.bangumiIds, ...list(patch.bangumiIds)], (x) => x)
  current.sourceKinds = uniqueBy([...current.sourceKinds, ...list(patch.sourceKinds)], (x) => x)
  current.sourceFiles = uniqueBy([...current.sourceFiles, ...list(patch.sourceFiles)], (x) => x)
  current.rawRows += Number(patch.rawRows || 0)
  current.adultCandidate ||= Boolean(patch.adultCandidate)
  map.set(appid, current)
}
function loadRelations(vndbFile, bangumiFile) {
  const map = new Map()
  const vndbRows = readJsonl(vndbFile)
  for (const row of vndbRows) {
    for (const appid of steamAppIdsFromAny(row)) mergeRelation(map, appid, { vndbIds: vndbIdsFromAny(row), sourceKinds: ['vndb-url'], sourceFiles: [vndbFile], rawRows: 1 })
  }
  const bangumiRows = readCsv(bangumiFile)
  for (const row of bangumiRows) {
    for (const appid of steamAppIdsFromAny(row)) mergeRelation(map, appid, { bangumiIds: bangumiIdsFromAny(row), sourceKinds: ['bangumi-alignment-high-medium'], sourceFiles: [bangumiFile], rawRows: 1 })
  }
  return { map, stats: { vndbRows: vndbRows.length, bangumiRows: bangumiRows.length, relationAppIds: map.size } }
}
async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return payload
}
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) {
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars')
  const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  if (!result?.token) throw new Error('Payload login did not return a token')
  return result.token
}
async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1, totalPages = 1, totalDocs = 0
  do {
    const params = new URLSearchParams()
    params.set('limit', String(PAGE_LIMIT))
    params.set('page', String(page))
    params.set('depth', '0')
    params.set('draft', 'true')
    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    totalDocs = Number(result?.totalDocs || docs.length)
    page += 1
  } while (page <= totalPages)
  return { docs, totalDocs }
}
function steamTitleValues(row) { return uniqueBy([row?.name].map(cleanLine).filter(Boolean)) }
function adultWarnings(row, relation) {
  const warnings = []
  const requiredAge = Number(row?.required_age || 0)
  const descriptorText = [row?.content_descriptors?.notes, ...list(row?.content_descriptors?.ids).map((x) => `descriptorId:${x}`), JSON.stringify(row?.ratings || {})].join('\n')
  if (requiredAge >= 18) warnings.push('steam_required_age_18_plus')
  if (/sexual|nudity|adult|mature|erotic|porn/iu.test(descriptorText)) warnings.push('steam_content_descriptor_adult_or_sexual_text')
  if (relation?.adultCandidate) warnings.push('steam_relation_adult_candidate')
  return warnings
}
function mediaShape(row, relation) {
  const text = [row?.name, row?.short_description, row?.about_the_game, row?.detailed_description, ...list(row?.genres).map((x) => x?.description)].map(val).join('\n')
  if (relation?.vndbIds?.length || /visual novel|视觉小说|ビジュアルノベル/iu.test(text)) return { mediaGroup: 'game', mediaType: 'visual_novel', format: 'visual_novel' }
  return { mediaGroup: 'game', mediaType: 'game', format: 'pc_game' }
}
function sourceLink(row) { return { label: 'Steam', url: steamUrl(row.steam_appid) } }
function candidateSource(row, relation) {
  const noteParts = [
    `Steam app candidate ${row.steam_appid}`,
    `name=${cleanLine(row.name) || 'missing'}`,
    `type=${val(row.type) || 'missing'}`,
    `developers=${list(row.developers).map(cleanLine).join(', ') || 'missing'}`,
    `publishers=${list(row.publishers).map(cleanLine).join(', ') || 'missing'}`,
    `genres=${list(row.genres).map((g) => cleanLine(g?.description)).filter(Boolean).join(', ') || 'missing'}`,
    `releaseDate=${cleanLine(row?.release_date?.date) || 'missing'}`,
    `requiredAge=${val(row.required_age) || '0'}`,
    relation?.vndbIds?.length ? `vndbIds=${relation.vndbIds.join(',')}` : '',
    relation?.bangumiIds?.length ? `bangumiSubjectIds=${relation.bangumiIds.join(',')}` : '',
    relation?.sourceKinds?.length ? `relationSources=${relation.sourceKinds.join(',')}` : '',
    ...adultWarnings(row, relation),
    'sourcePolicy=Steam metadata-only enrichment; no dates/images/creators/tags written by v0.1',
  ]
  return { source: 'steam', label: 'Steam', externalId: String(row.steam_appid), url: steamUrl(row.steam_appid), note: noteParts.filter(Boolean).join('; ') }
}
function mergeSourceLinks(work, row) {
  return uniqueBy([...sourceLinkRows(work), sourceLink(row)], (item) => val(item.url).replace(/\/+$/u, '').toLowerCase())
}
function mergeCandidateSources(work, row, relation) {
  return uniqueBy([...candidateSourceRows(work), candidateSource(row, relation)], (item) => `${val(item.source)}|${val(item.externalId)}|${val(item.url).toLowerCase()}`)
}
function mergedSearchText(work, row) {
  const values = uniqueBy([...existingSearchTextValues(work), ...steamTitleValues(row)]).slice(0, MAX_SEARCH_TEXT_ADDITIONS)
  return values.join('\n')
}
function findMatch(row, relation, indexes) {
  const appid = String(row.steam_appid)
  if (indexes.bySteam.has(appid)) return { work: indexes.bySteam.get(appid), matchBy: 'steamAppId' }
  const relationHits = []
  for (const id of relation?.vndbIds || []) if (indexes.byVndb.has(id.toLowerCase())) relationHits.push({ work: indexes.byVndb.get(id.toLowerCase()), by: 'vndbId' })
  for (const id of relation?.bangumiIds || []) if (indexes.byBangumi.has(id)) relationHits.push({ work: indexes.byBangumi.get(id), by: 'bangumiSubjectId' })
  const uniqueHits = uniqueBy(relationHits, (hit) => val(hit.work?.id))
  if (uniqueHits.length === 1) return { work: uniqueHits[0].work, matchBy: uniqueHits[0].by }
  if (uniqueHits.length > 1) return { work: null, matchBy: 'ambiguous_relation', blockers: ['ambiguous_existing_relation_match'], matchedExisting: uniqueHits.slice(0, 10).map((hit) => ({ id: hit.work.id, title: hit.work.title, slug: hit.work.slug, matchBy: hit.by })) }
  const titleHits = uniqueBy(steamTitleValues(row).flatMap((title) => indexes.byTitle.get(normalizeText(title)) || []), (work) => val(work.id))
  if (titleHits.length === 1) return { work: titleHits[0], matchBy: 'exact_title' }
  if (titleHits.length > 1) return { work: null, matchBy: 'ambiguous_title', blockers: ['ambiguous_existing_title_match'], matchedExisting: titleHits.slice(0, 10).map((work) => ({ id: work.id, title: work.title, slug: work.slug })) }
  return { work: null, matchBy: 'no_match' }
}
function slugify(value) {
  const slug = cleanLine(value).normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/&/gu, ' and ').replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').replace(/-{2,}/gu, '-')
  return slug || 'steam-work'
}
function createCandidatePreview(row, relation) {
  const shape = mediaShape(row, relation)
  const title = cleanLine(row.name) || `Steam ${row.steam_appid}`
  return {
    title,
    originalTitle: title,
    steamAppId: String(row.steam_appid),
    steamUrl: steamUrl(row.steam_appid),
    ...shape,
    searchTextAdditions: steamTitleValues(row),
    sourceLinks: [sourceLink(row)],
    candidateSources: [candidateSource(row, relation)],
    payloadPreview: {
      title,
      slug: `${slugify(title)}-steam-${row.steam_appid}`,
      siteId: `STEAM-${row.steam_appid}`,
      rank: 'unknown',
      reviewStatus: 'pending',
      reviewReasons: ['manual_review'],
      evidenceStrength: 'unassessed',
      ratingNotice: 'ai_synthesized_pending_review',
      importBatch: 'steam-work-integration-v01',
      chosenBaseSource: 'steam',
      originalTitle: title,
      ...shape,
      yuriCandidateScore: relation?.sourceKinds?.includes('bangumi-alignment-high-medium') ? 0.5 : 0.1,
      sourceLinks: [sourceLink(row)],
      candidateSources: [candidateSource(row, relation)],
      searchText: steamTitleValues(row).join('\n'),
      evidenceNote: 'Draft candidate generated from Steam metadata only. Human review required before publish.',
      status: 'draft',
    },
  }
}
function planRow(row, relation, indexes) {
  const match = findMatch(row, relation, indexes)
  const work = match.work
  const blockers = [...list(match.blockers)]
  const warnings = adultWarnings(row, relation)
  const title = cleanLine(row.name)
  if (!row.steam_appid) blockers.push('missing_steam_appid')
  if (!title) blockers.push('missing_title')

  if (work?.id && !blockers.length) {
    const fieldUpdates = {
      sourceLinks: mergeSourceLinks(work, row),
      candidateSources: mergeCandidateSources(work, row, relation),
    }
    const searchText = mergedSearchText(work, row)
    if (searchText) fieldUpdates.searchText = searchText
    const markers = sourceMarkersOf(work)
    return {
      key: `steam-${row.steam_appid}`,
      steamAppId: String(row.steam_appid),
      steamUrl: steamUrl(row.steam_appid),
      title,
      action: 'steam_enrich_existing_work',
      matchBy: match.matchBy,
      planStatus: 'ready_for_apply_review',
      confidence: match.matchBy === 'steamAppId' || match.matchBy === 'vndbId' || match.matchBy === 'bangumiSubjectId' ? 'high' : 'manual_review',
      blockers,
      warnings,
      work: { id: val(work.id), title: val(work.title), slug: val(work.slug), sourceMarkers: markers, protectedSourceMarkers: markers.filter((m) => PROTECTED_MARKERS.includes(m)) },
      matchedExisting: match.matchedExisting || [],
      relation: relation || null,
      fieldUpdates,
      createCandidatePreview: null,
      raw: { inputFile: row.__inputFile, steam_appid: row.steam_appid, name: row.name, required_age: row.required_age, genres: row.genres, categories: row.categories, content_descriptors: row.content_descriptors, ratings: row.ratings },
    }
  }
  return {
    key: `steam-${row.steam_appid}`,
    steamAppId: String(row.steam_appid),
    steamUrl: steamUrl(row.steam_appid),
    title,
    action: 'steam_create_candidate_preview',
    matchBy: match.matchBy,
    planStatus: blockers.length ? 'blocked_or_review_required' : 'create_candidate_review',
    confidence: 'manual_review',
    blockers: uniqueBy([...blockers, 'no_existing_work_match'], (x) => x),
    warnings,
    work: null,
    matchedExisting: match.matchedExisting || [],
    relation: relation || null,
    fieldUpdates: {},
    createCandidatePreview: createCandidatePreview(row, relation),
    raw: { inputFile: row.__inputFile, steam_appid: row.steam_appid, name: row.name, required_age: row.required_age, genres: row.genres, categories: row.categories, content_descriptors: row.content_descriptors, ratings: row.ratings },
  }
}
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const appdetailsDir = String(args['appdetails-dir'] || DEFAULT_APPDETAILS_DIR)
  const vndbAppids = String(args['vndb-appids'] || DEFAULT_VNDB_APPIDS)
  const bangumiHighMedium = String(args['bangumi-high-medium'] || DEFAULT_BANGUMI_HIGH_MEDIUM)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const limit = Number(args.limit || 0)
  const loaded = loadAppdetails(appdetailsDir, limit)
  const { map: relations, stats: relationStats } = loadRelations(vndbAppids, bangumiHighMedium)
  const token = await login(base)
  const { docs: works, totalDocs } = await fetchAllWorks(base, token)
  const indexes = buildIndexes(works)
  const plans = loaded.rows.map((row) => planRow(row, relations.get(String(row.steam_appid)) || null, indexes))
  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const createCandidates = plans.filter((row) => row.action === 'steam_create_candidate_preview')
  const blocked = plans.filter((row) => row.planStatus === 'blocked_or_review_required')
  const adultReview = plans.filter((row) => list(row.warnings).some((warning) => /adult|sexual|18/iu.test(warning)))
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    payloadBaseUrl: base,
    appdetailsDir,
    vndbAppids,
    bangumiHighMedium,
    appdetailFilesScanned: loaded.filesScanned,
    appdetailRows: loaded.rows.length,
    appdetailErrors: loaded.errors.length,
    relationStats,
    worksRead: works.length,
    worksTotalDocs: totalDocs,
    planRows: plans.length,
    readyRows: ready.length,
    createCandidateRows: createCandidates.length,
    blockedRows: blocked.length,
    adultReviewRows: adultReview.length,
    byAction: countBy(plans, 'action'),
    byPlanStatus: countBy(plans, 'planStatus'),
    byMatchBy: countBy(plans, 'matchBy'),
    byWarning: countBy(plans.flatMap((row) => row.warnings), (x) => x),
    byBlocker: countBy(plans.flatMap((row) => row.blockers), (x) => x),
    outputs: {
      rows: `${outDir}/steam-work-integration-v01.rows.jsonl`,
      ready: `${outDir}/steam-work-integration-v01-ready.jsonl`,
      createCandidates: `${outDir}/steam-work-integration-v01-create-candidates.jsonl`,
      blocked: `${outDir}/steam-work-integration-v01-blocked.jsonl`,
      adultReview: `${outDir}/steam-work-integration-v01-adult-review.jsonl`,
      sample: `${outDir}/steam-work-integration-v01-sample.jsonl`,
      summary: `${outDir}/steam-work-integration-v01-summary.json`,
    },
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      existingWorksOnlyInApply: true,
      createCandidatesArePreviewOnly: true,
      writesSteamOnlyToSourceLinksCandidateSourcesSearchText: true,
      doesNotWriteDates: true,
      doesNotDownloadImages: true,
      doesNotWriteCreatorsOrTags: true,
      doesNotWriteSummary: true,
    },
    nextStep: 'Review ready/create/blocked samples, then run guarded apply dry-run for existing Work enrichment only.',
  }
  writeJsonl(summary.outputs.rows, plans)
  writeJsonl(summary.outputs.ready, ready)
  writeJsonl(summary.outputs.createCandidates, createCandidates)
  writeJsonl(summary.outputs.blocked, blocked)
  writeJsonl(summary.outputs.adultReview, adultReview)
  writeJsonl(summary.outputs.sample, [...ready.slice(0, 80), ...createCandidates.slice(0, 80), ...blocked.slice(0, 80)])
  writeJson(summary.outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary, outputs: summary.outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
