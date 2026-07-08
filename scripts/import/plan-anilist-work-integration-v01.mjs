#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'anilist-work-integration-plan-v0.1'
const DEFAULT_INPUTS = [
  'data_local/raw/anilist',
  'data_local/staging/anilist/anilist.json',
  'data_local/staging/anilist/anilist.jsonl',
  'data_local/staging/anilist/anilist-media.json',
  'data_local/staging/anilist/anilist-media.jsonl',
  'data_local/staging/anilist/media.json',
  'data_local/staging/anilist/media.jsonl',
]
const DEFAULT_OUT_DIR = 'data_local/staging/anilist-work-integration'
const PAGE_LIMIT = 200
const MAX_SEARCH_TEXT_ADDITIONS = 60
const MAX_DESCRIPTION_CHARS = 12000
const PROTECTED_MARKERS = ['bangumi', 'mangadex', 'ndl', 'wikidata', 'vndb', 'steam']
const YURI_TERMS = /\b(yuri|girls? love|shoujo ai|shojo ai|girl x girl|female homosexuality|lesbian)\b|百合|ガールズラブ|女性同士|女同士|レズビアン/iu

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ').trim() }
function normalizeText(value) { return cleanLine(value).normalize('NFKC').toLowerCase() }
function uniqueBy(values, getKey = normalizeText) { const seen = new Set(); const out = []; for (const item of values || []) { const clean = cleanLine(item); const key = getKey(clean); if (!key || seen.has(key)) continue; seen.add(key); out.push(clean) } return out }
function uniqueObjects(values, getKey) { const seen = new Set(); const out = []; for (const item of values || []) { const key = getKey(item); if (!key || seen.has(key)) continue; seen.add(key); out.push(item) } return out }
function parseArgs(argv) { const args = { input: [] }; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = key === 'input' ? args.input : true; else { if (key === 'input') args.input.push(next); else args[key] = next; i += 1 } } return args }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8') }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }

function scanFiles(inputs) {
  const files = []
  function visit(item) {
    if (!fs.existsSync(item)) return
    const stat = fs.statSync(item)
    if (stat.isDirectory()) for (const name of fs.readdirSync(item)) visit(path.join(item, name))
    else if (/\.(json|jsonl)$/iu.test(item)) files.push(item)
  }
  for (const item of inputs) visit(item)
  return files.sort()
}

function readFileRows(file) {
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  if (/\.jsonl$/iu.test(file) || !(raw.startsWith('{') || raw.startsWith('['))) return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  return [JSON.parse(raw)]
}

function looksLikeMedia(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && (Number.isFinite(Number(value.id)) || /^\d+$/u.test(val(value.id))) && (
    value.title && typeof value.title === 'object' || /anilist\.co\/anime|anilist\.co\/manga/iu.test(val(value.siteUrl)) || list(value.genres).length || list(value.tags).length
  )
}

function extractMedia(value, out = []) {
  if (!value) return out
  if (Array.isArray(value)) { for (const item of value) extractMedia(item, out); return out }
  if (typeof value !== 'object') return out
  if (looksLikeMedia(value)) out.push(value)
  for (const key of ['media', 'Media', 'results', 'items', 'docs']) extractMedia(value?.[key], out)
  extractMedia(value?.data?.Page?.media, out)
  extractMedia(value?.data?.Media, out)
  extractMedia(value?.response?.data?.Page?.media, out)
  extractMedia(value?.response?.data?.Media, out)
  extractMedia(value?.response?.Page?.media, out)
  extractMedia(value?.response?.Media, out)
  return out
}

function mediaIdOf(row) { const id = Number(row?.id || row?.mediaId || row?.anilistMediaId); return Number.isFinite(id) && id > 0 ? String(Math.trunc(id)) : '' }
function malIdOf(row) { const id = Number(row?.idMal || row?.malId || row?.externalIds?.malId); return Number.isFinite(id) && id > 0 ? String(Math.trunc(id)) : '' }
function titleValues(row) { return uniqueBy([row?.title?.romaji, row?.title?.english, row?.title?.native, row?.title?.userPreferred, ...list(row?.synonyms), row?.romaji, row?.english, row?.native, row?.name, row?.title]) }
function primaryTitle(row) { return titleValues(row)[0] || `AniList ${mediaIdOf(row)}` }
function originalTitle(row) { return row?.title?.native ? cleanLine(row.title.native) : primaryTitle(row) }
function anilistUrl(row) { const direct = val(row?.siteUrl || row?.url); if (direct) return direct; const type = val(row?.type).toUpperCase() === 'MANGA' ? 'manga' : 'anime'; return mediaIdOf(row) ? `https://anilist.co/${type}/${mediaIdOf(row)}` : '' }
function tagRows(row) { return list(row?.tags).map((tag) => ({ name: cleanLine(tag?.name || tag), rank: Number(tag?.rank || 0), category: cleanLine(tag?.category), isMediaSpoiler: Boolean(tag?.isMediaSpoiler), isGeneralSpoiler: Boolean(tag?.isGeneralSpoiler) })).filter((tag) => tag.name) }
function yuriMatches(row) { const matches = []; for (const genre of list(row?.genres).map(cleanLine).filter(Boolean)) if (YURI_TERMS.test(genre)) matches.push({ source: 'genre', name: genre, rank: 100 }); for (const tag of tagRows(row)) if (YURI_TERMS.test(tag.name)) matches.push({ source: 'tag', name: tag.name, rank: tag.rank, category: tag.category, isMediaSpoiler: tag.isMediaSpoiler, isGeneralSpoiler: tag.isGeneralSpoiler }); return matches }
function isAdult(row) { return row?.isAdult === true || /adult|hentai|erotica|pornographic/iu.test([row?.rating, row?.contentRating, ...list(row?.genres), ...tagRows(row).map((t) => t.name)].join('\n')) }
function plainDescription(row) { return cleanLine(val(row?.description).replace(/<br\s*\/?\s*>/giu, '\n').replace(/<[^>]+>/gu, ' ')).slice(0, MAX_DESCRIPTION_CHARS) }
function mediaShape(row) { const type = val(row?.type).toUpperCase(); const format = val(row?.format).toUpperCase(); if (type === 'ANIME') { const fmt = format === 'MOVIE' ? 'anime_movie' : format === 'OVA' ? 'ova' : format === 'ONA' ? 'ona' : 'tv_anime'; return { mediaGroup: 'anime', mediaType: 'anime', format: fmt } } if (type === 'MANGA') { if (/NOVEL/iu.test(format)) return { mediaGroup: 'novel', mediaType: format === 'LIGHT_NOVEL' ? 'light_novel' : 'novel', format: format === 'LIGHT_NOVEL' ? 'light_novel_series' : 'novel_series' }; if (format === 'ONE_SHOT') return { mediaGroup: 'manga', mediaType: 'manga', format: 'manga_oneshot' }; return { mediaGroup: 'manga', mediaType: 'manga', format: 'manga_series' } } return { mediaGroup: 'unknown', mediaType: 'unknown', format: 'unknown' } }
function dateLabel(row) { const d = row?.startDate || row?.start_date || {}; const y = Number(d.year || row?.startYear); const m = Number(d.month); const day = Number(d.day); if (!y) return ''; if (m && day) return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`; if (m) return `${y}-${String(m).padStart(2, '0')}`; return String(y) }
function sourceNote(row) { const yuri = yuriMatches(row).map((m) => `${m.source}:${m.name}:${m.rank || ''}`).join(', '); return cleanLine([`AniList media candidate ${mediaIdOf(row)}`, `type=${val(row.type) || 'unknown'}`, `format=${val(row.format) || 'unknown'}`, `status=${val(row.status) || 'unknown'}`, malIdOf(row) ? `malId=${malIdOf(row)}` : '', dateLabel(row) ? `startDate=${dateLabel(row)}` : '', `isAdult=${row?.isAdult === true}`, yuri ? `yuriMatches=${yuri}` : '', 'sourcePolicy=AniList enriches existing works; no Work creation in this planner'].filter(Boolean).join('; ')) }
function sourceLink(row) { return { label: 'AniList', url: anilistUrl(row) } }
function candidateSource(row) { return { source: 'anilist', label: 'AniList', externalId: mediaIdOf(row), url: anilistUrl(row), note: sourceNote(row) } }
function sourceLinkRows(doc) { return list(doc?.sourceLinks).map((item) => ({ label: cleanLine(item?.label), url: val(item?.url).replace(/\/+$/u, '') })).filter((item) => item.url) }
function candidateSourceRows(doc) { return list(doc?.candidateSources).map((item) => ({ source: val(item?.source), label: cleanLine(item?.label), externalId: val(item?.externalId), url: val(item?.url).replace(/\/+$/u, ''), fetchedAt: item?.fetchedAt, note: val(item?.note) })).filter((item) => item.source || item.externalId || item.url || item.note) }
function externalIdsOf(doc) { const ids = doc?.externalIds; if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}; return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value)) }
function existingSearchValues(work) { return val(work?.searchText) ? val(work.searchText).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) : [] }
function exactTitleSet(work) { return new Set([work?.title, work?.originalTitle, ...existingSearchValues(work)].map(normalizeText).filter(Boolean)) }
function markerText(work) { return [work?.siteId, ...sourceLinkRows(work).flatMap((x) => [x.label, x.url]), ...candidateSourceRows(work).flatMap((x) => [x.source, x.label, x.externalId, x.url, x.note])].map((x) => val(x).toLowerCase()).join('\n') }
function markersOf(work) { const text = markerText(work); return ['bangumi','mangadex','ndl','wikidata','vndb','steam','anilist'].filter((m) => text.includes(m) || (m === 'anilist' && externalIdsOf(work).anilistMediaId)) }
function hasSourceLink(work, url) { const clean = val(url).replace(/\/+$/u, ''); return sourceLinkRows(work).some((item) => item.url.replace(/\/+$/u, '') === clean) }
function hasCandidateSource(work, externalId) { return candidateSourceRows(work).some((item) => item.source === 'anilist' && val(item.externalId) === val(externalId)) }
function mergeSourceLinks(work, row) { const values = sourceLinkRows(work); const add = sourceLink(row); if (add.url && !values.some((x) => x.url.replace(/\/+$/u, '') === add.url.replace(/\/+$/u, ''))) values.push(add); return values }
function mergeCandidateSources(work, row) { const values = candidateSourceRows(work); const add = candidateSource(row); if (!values.some((x) => x.source === 'anilist' && val(x.externalId) === val(add.externalId))) values.push(add); return values }
function searchTextAdditions(work, row) { const existing = new Set([work?.title, work?.originalTitle, ...existingSearchValues(work)].map(normalizeText).filter(Boolean)); return titleValues(row).filter((title) => !existing.has(normalizeText(title))).slice(0, MAX_SEARCH_TEXT_ADDITIONS) }
function mergedSearchText(work, row) { return uniqueBy([...existingSearchValues(work), ...searchTextAdditions(work, row)]).join('\n') }
function buildIndexes(works) { const anilist = new Map(), mal = new Map(), title = new Map(); for (const work of works) { const ids = externalIdsOf(work); if (ids.anilistMediaId) anilist.set(ids.anilistMediaId, work); if (ids.malId) mal.set(ids.malId, work); for (const key of exactTitleSet(work)) { if (!title.has(key)) title.set(key, []); title.get(key).push(work) } } return { anilist, mal, title } }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchAllWorks(baseUrl, token) { const docs = []; let page = 1, totalPages = 1; do { const params = new URLSearchParams(); params.set('limit', String(PAGE_LIMIT)); params.set('page', String(page)); params.set('depth', '0'); params.set('draft', 'true'); const result = await requestJson(`${baseUrl}/api/works?${params}`, { headers: authHeaders(token) }); docs.push(...(result?.docs || [])); totalPages = Number(result?.totalPages || 1); page += 1 } while (page <= totalPages); return docs }
function buildPatch(work, row) { const ids = { ...externalIdsOf(work) }; const mediaId = mediaIdOf(row); const malId = malIdOf(row); if (mediaId && !ids.anilistMediaId) ids.anilistMediaId = mediaId; if (malId && !ids.malId) ids.malId = malId; const patch = { externalIds: ids, sourceLinks: mergeSourceLinks(work, row), candidateSources: mergeCandidateSources(work, row) }; const added = searchTextAdditions(work, row); if (added.length) patch.searchText = mergedSearchText(work, row); if (!work?.summary && plainDescription(row)) patch.summary = plainDescription(row); return patch }
function changedFields(work, patch) { const fields = []; const ids = externalIdsOf(work); if (patch.externalIds?.anilistMediaId && ids.anilistMediaId !== patch.externalIds.anilistMediaId) fields.push('externalIds.anilistMediaId'); if (patch.externalIds?.malId && ids.malId !== patch.externalIds.malId) fields.push('externalIds.malId'); if (patch.sourceLinks?.length !== sourceLinkRows(work).length) fields.push('sourceLinks'); if (patch.candidateSources?.length !== candidateSourceRows(work).length) fields.push('candidateSources'); if ('searchText' in patch && val(patch.searchText) !== val(work.searchText)) fields.push('searchText'); if ('summary' in patch) fields.push('summary'); return fields }
function buildPlan(row, indexes) { const blockers = []; const warnings = []; const mediaId = mediaIdOf(row); const malId = malIdOf(row); const titles = titleValues(row); const yuri = yuriMatches(row); let work = null, matchBy = 'no_match', matchedExisting = [];
  if (!mediaId) blockers.push('missing_anilist_media_id')
  if (mediaId && indexes.anilist.has(mediaId)) { work = indexes.anilist.get(mediaId); matchBy = 'anilistMediaId' }
  else if (malId && indexes.mal.has(malId)) { work = indexes.mal.get(malId); matchBy = 'malId' }
  else { const hits = uniqueObjects(titles.flatMap((t) => indexes.title.get(normalizeText(t)) || []), (x) => String(x.id)); if (hits.length === 1) { work = hits[0]; matchBy = 'exact_title' } else if (hits.length > 1) { matchedExisting = hits.map((x) => ({ id: x.id, title: x.title, slug: x.slug })); blockers.push('ambiguous_existing_title_match'); matchBy = 'ambiguous_title' } }
  if (isAdult(row)) warnings.push('anilist_isAdult=true')
  if (!yuri.length) warnings.push('no_yuri_genre_or_tag_detected')
  const base = { key: mediaId ? `anilist-${mediaId}` : `anilist-missing-${primaryTitle(row)}`, anilistMediaId: mediaId, malId, anilistUrl: anilistUrl(row), titleCandidates: titles, mediaType: val(row.type), format: val(row.format), isAdult: isAdult(row), yuriMatches: yuri, matchBy, warnings, raw: { inputFile: row.__inputFile, id: row.id, idMal: row.idMal, type: row.type, format: row.format, status: row.status, genres: row.genres, tags: row.tags, isAdult: row.isAdult } }
  if (work) { const markers = markersOf(work); const protectedMarkers = markers.filter((m) => PROTECTED_MARKERS.includes(m)); const patchPayload = buildPatch(work, row); const changed = changedFields(work, patchPayload); if (!changed.length) warnings.push('already_current'); if (isAdult(row)) blockers.push('anilist_adult_content_requires_separate_review'); return { ...base, action: 'anilist_enrich_existing_work', planStatus: blockers.length ? 'blocked_or_review_required' : 'ready_for_apply_review', confidence: matchBy === 'anilistMediaId' || matchBy === 'malId' ? 'high' : 'manual_review', blockers, work: { id: work.id, title: work.title, slug: work.slug, sourceMarkers: markers, protectedSourceMarkers: protectedMarkers }, matchedExisting, fieldUpdates: patchPayload, changedFields: changed, safety: safetyBase() } }
  const createCandidatePreview = { title: primaryTitle(row), originalTitle: originalTitle(row), anilistMediaId: mediaId, malId, ...mediaShape(row), searchTextAdditions: titles, sourceLinks: [sourceLink(row)], candidateSources: [candidateSource(row)], descriptionAvailable: Boolean(plainDescription(row)), yuriCandidateScore: yuri.length ? Math.max(0.1, Math.min(1, Math.max(...yuri.map((x) => Number(x.rank || 0))) / 100)) : 0 }
  if (!yuri.length) blockers.push('no_yuri_genre_or_tag_detected')
  if (isAdult(row)) blockers.push('anilist_adult_content_requires_separate_review')
  if (!mediaId) blockers.push('missing_anilist_media_id')
  return { ...base, action: 'anilist_create_candidate_preview', planStatus: 'blocked_or_review_required', confidence: 'manual_review', blockers: uniqueBy(blockers, (x) => x), work: null, matchedExisting, fieldUpdates: {}, createCandidatePreview, safety: safetyBase() }
}
function safetyBase() { return { payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, createsWorks: false, deletesWorks: false, reportOnly: true, futureApplyMustBeGuarded: true, existingWorksOnlyInApply: true, createsRequireSeparateAllowlistFlow: true, adultRowsRequireSeparateReview: true, doesNotDownloadImages: true, doesNotWriteTagsOrCreators: true } }

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const inputs = args.input.length ? args.input : DEFAULT_INPUTS
  const files = scanFiles(inputs)
  const media = []
  const fileStats = []
  for (const file of files) { try { const rows = readFileRows(file); const extracted = extractMedia(rows).map((row) => ({ ...row, __inputFile: file })); fileStats.push({ file, rows: extracted.length, error: '' }); media.push(...extracted) } catch (error) { fileStats.push({ file, rows: 0, error: String(error?.message || error).slice(0, 500) }) } }
  const deduped = uniqueObjects(media, (row) => mediaIdOf(row))
  const token = await login(base)
  const works = await fetchAllWorks(base, token)
  const indexes = buildIndexes(works)
  const plans = deduped.map((row) => buildPlan(row, indexes))
  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const createCandidates = plans.filter((row) => row.action === 'anilist_create_candidate_preview')
  const yuriCreateCandidates = createCandidates.filter((row) => row.yuriMatches?.length)
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, inputs, filesScanned: files.length, filesWithRows: fileStats.filter((x) => x.rows).length, inputRowsExtractedBeforeDedupe: media.length, inputRowsDeduped: deduped.length, rowsProcessed: plans.length, payloadBaseUrl: base, worksRead: works.length, readyRows: ready.length, blockedRows: blocked.length, createCandidateRows: createCandidates.length, yuriCreateCandidateRows: yuriCreateCandidates.length, byAction: countBy(plans, 'action'), byPlanStatus: countBy(plans, 'planStatus'), byMatchBy: countBy(plans, 'matchBy'), byBlocker: countBy(blocked.flatMap((r) => r.blockers), (x) => x), byWarning: countBy(plans.flatMap((r) => r.warnings), (x) => x), byChangedField: countBy(ready.flatMap((r) => r.changedFields), (x) => x), sampleFilesWithRows: fileStats.filter((x) => x.rows).slice(0, 20), outputs: { rows: `${outDir}/anilist-work-integration-v01.rows.jsonl`, ready: `${outDir}/anilist-work-integration-v01-ready.jsonl`, blocked: `${outDir}/anilist-work-integration-v01-blocked.jsonl`, createCandidates: `${outDir}/anilist-work-integration-v01-create-candidates.jsonl`, yuriCreateCandidates: `${outDir}/anilist-work-integration-v01-yuri-create-candidates.jsonl`, sample: `${outDir}/anilist-work-integration-v01-sample.jsonl`, summary: `${outDir}/anilist-work-integration-v01-summary.json` }, safety: safetyBase(), nextStep: 'Review ready/blocked/create samples, then run guarded apply dry-run. Work creation requires a separate allowlist flow.' }
  writeJsonl(summary.outputs.rows, plans)
  writeJsonl(summary.outputs.ready, ready)
  writeJsonl(summary.outputs.blocked, blocked)
  writeJsonl(summary.outputs.createCandidates, createCandidates)
  writeJsonl(summary.outputs.yuriCreateCandidates, yuriCreateCandidates)
  writeJsonl(summary.outputs.sample, [...ready.slice(0, 80), ...yuriCreateCandidates.slice(0, 80), ...blocked.slice(0, 80)])
  writeJson(summary.outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary, outputs: summary.outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
