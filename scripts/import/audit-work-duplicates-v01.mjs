#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'work-duplicates-audit-v0.4'
const DEFAULT_OUT_DIR = 'data_local/staging/work-duplicates'
const PAGE_LIMIT = 200
const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2, review: 3 }
const HIGH_SOURCE_PREFIXES = new Set(['bangumiSubjectId', 'anilistMediaId', 'anilist', 'vndbId', 'vndb', 'steam', 'yurizukan'])
const REVIEW_SOURCE_PREFIXES = new Set(['wikidataQid', 'wikidata'])
const ENV_FILES = ['.env.local', '.env']

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function loadDotenv() {
  for (const file of ENV_FILES) {
    const full = path.resolve(process.cwd(), file)
    if (!fs.existsSync(full)) continue
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u)
      if (!match) continue
      const key = match[1]
      if (process.env[key]) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      process.env[key] = value
    }
  }
}
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ').trim() }
function normalizedTitle(value) { return cleanLine(value).toLowerCase().replace(/[\s\u3000]+/gu, '').replace(/[\-‐‑‒–—―~〜～・:：;；,，.。!！?？'"“”‘’「」『』【】\[\]（）()<>＜＞]/gu, '') }
function searchLines(value) { return val(value).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8') }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function normalizeUrl(value) { return val(value).replace(/\s+/gu, '').replace(/\/+$/u, '') }
function sourceRows(work) { return [...list(work.sourceLinks), ...list(work.candidateSources)].filter(Boolean) }
function candidateSourceRows(work) { return list(work.candidateSources).filter(Boolean) }
function sourceText(work) { return JSON.stringify({ externalIds: work.externalIds || {}, sourceLinks: work.sourceLinks || [], candidateSources: work.candidateSources || [], searchText: work.searchText || '' }) }
function pushSourceKey(out, key, raw) {
  const value = val(raw)
  if (!value) return
  if (key === 'malId' || key === 'idMal') return
  out.push(`${key}:${value}`)
}
function sourceKeys(work) {
  const out = []
  const externalIds = work.externalIds || {}
  for (const [key, raw] of Object.entries(externalIds)) pushSourceKey(out, key, raw)
  for (const source of candidateSourceRows(work)) {
    const sourceName = val(source?.source)
    const externalId = val(source?.externalId)
    if (sourceName && externalId && sourceName !== 'malId' && sourceName !== 'idMal') out.push(`${sourceName}:${externalId}`)
    const url = normalizeUrl(source?.url)
    if (/bgm\.tv\/subject\/(\d+)/iu.test(url)) out.push(`bangumiSubjectId:${url.match(/bgm\.tv\/subject\/(\d+)/iu)[1]}`)
    if (/anilist\.co\/(?:anime|manga)\/(\d+)/iu.test(url)) out.push(`anilistMediaId:${url.match(/anilist\.co\/(?:anime|manga)\/(\d+)/iu)[1]}`)
    if (/vndb\.org\/v(\d+)/iu.test(url)) out.push(`vndbId:v${url.match(/vndb\.org\/v(\d+)/iu)[1]}`)
    if (/yurizukan\.com\/articles\/articleDetail\/(\d+)/iu.test(url)) out.push(`yurizukan:${url.match(/articleDetail\/(\d+)/iu)[1]}`)
    if (/store\.steampowered\.com\/app\/(\d+)/iu.test(url)) out.push(`steam:${url.match(/\/app\/(\d+)/iu)[1]}`)
    if (/wikidata\.org\/wiki\/(Q\d+)/iu.test(url)) out.push(`wikidataQid:${url.match(/wikidata\.org\/wiki\/(Q\d+)/iu)[1].toUpperCase()}`)
  }
  for (const link of sourceRows(work)) {
    const url = normalizeUrl(link?.url)
    if (/bgm\.tv\/subject\/(\d+)/iu.test(url)) out.push(`bangumiSubjectId:${url.match(/bgm\.tv\/subject\/(\d+)/iu)[1]}`)
    if (/anilist\.co\/(?:anime|manga)\/(\d+)/iu.test(url)) out.push(`anilistMediaId:${url.match(/anilist\.co\/(?:anime|manga)\/(\d+)/iu)[1]}`)
    if (/vndb\.org\/v(\d+)/iu.test(url)) out.push(`vndbId:v${url.match(/vndb\.org\/v(\d+)/iu)[1]}`)
    if (/yurizukan\.com\/articles\/articleDetail\/(\d+)/iu.test(url)) out.push(`yurizukan:${url.match(/articleDetail\/(\d+)/iu)[1]}`)
    if (/store\.steampowered\.com\/app\/(\d+)/iu.test(url)) out.push(`steam:${url.match(/\/app\/(\d+)/iu)[1]}`)
    if (/wikidata\.org\/wiki\/(Q\d+)/iu.test(url)) out.push(`wikidataQid:${url.match(/wikidata\.org\/wiki\/(Q\d+)/iu)[1].toUpperCase()}`)
  }
  return [...new Set(out.filter(Boolean))]
}
function sourcePrefix(sourceKey) { return val(sourceKey).split(':', 1)[0] }
function isHighSourceKey(sourceKey) { return HIGH_SOURCE_PREFIXES.has(sourcePrefix(sourceKey)) }
function isReviewSourceKey(sourceKey) { return REVIEW_SOURCE_PREFIXES.has(sourcePrefix(sourceKey)) }
function usefulSearchTitleLine(line) {
  if (!line || line.length > 120) return false
  if (/^https?:\/\//iu.test(line)) return false
  if (/^(bangumi|anilist|vndb|steam|wikidata|yurizukan)(:|$)/iu.test(line)) return false
  if (/^(sourcepolicy|contentrating|contentvisibility|yurisource|trustedyurisource|yurimarked|groupkey|groupsize|yurizukanids)=/iu.test(line)) return false
  if (/^[a-z]+[A-Za-z]*Id:\s*\d+/u.test(line)) return false
  if (/^\d+$/.test(line)) return false
  return true
}
function titleKeys(work) {
  const raw = [
    work.title,
    work.originalTitle,
    ...list(work.localizedTitles),
    ...list(work.localizedNames),
    ...list(work.aliases).map((x) => typeof x === 'string' ? x : x?.value),
    ...searchLines(work.searchText).filter(usefulSearchTitleLine),
  ]
  return [...new Set(raw.map(normalizedTitle).filter((key) => key.length >= 2))]
}
function primaryTitleKey(work) { return normalizedTitle(work.title || work.originalTitle || '') }
function hasBangumi(work) { return sourceKeys(work).some((key) => key.startsWith('bangumiSubjectId:') || key.startsWith('bangumi:')) || /bangumi|bgm\.tv/iu.test(sourceText(work)) }
function workSummary(work) { return { id: work.id, title: work.title, originalTitle: work.originalTitle, slug: work.slug, siteId: work.siteId, status: work.status, rank: work.rank, mediaGroup: work.mediaGroup, mediaType: work.mediaType, format: work.format, hasBangumi: hasBangumi(work), titleKeys: titleKeys(work).slice(0, 20), sourceKeyCount: sourceKeys(work).length, sourceKeys: sourceKeys(work).slice(0, 30), createdAt: work.createdAt, updatedAt: work.updatedAt } }
function statusScore(status) { if (status === 'published') return 40; if (status === 'review') return 30; if (status === 'draft') return 20; return 0 }
function keepScore(work) { return statusScore(work.status) + (hasBangumi(work) ? 25 : 0) + Math.min(sourceKeys(work).length, 15) + (work.rank && work.rank !== 'unknown' ? 5 : 0) + (work.hasEvidence ? 5 : 0) }
function chooseKeep(works) { return [...works].sort((a, b) => keepScore(b) - keepScore(a) || Number(a.id) - Number(b.id))[0] }
function confidenceFor(kind, works, key) {
  if (kind === 'source_key') {
    if (isHighSourceKey(key)) return 'high'
    if (isReviewSourceKey(key)) return 'review'
    return 'review'
  }
  const mediaTypes = new Set(works.map((w) => val(w.mediaType || 'unknown')))
  const mediaGroups = new Set(works.map((w) => val(w.mediaGroup || 'unknown')))
  if (kind === 'alias_title_media' && mediaTypes.size === 1 && mediaGroups.size === 1) return 'medium'
  if (kind === 'primary_title_media' && mediaTypes.size === 1 && mediaGroups.size === 1) return 'medium'
  if (kind === 'alias_title_only' && key && key.length >= 6) return 'low'
  if (kind === 'primary_title_only' && key && key.length >= 6) return 'low'
  return 'review'
}
function groupRow(kind, key, works) { const keep = chooseKeep(works); const confidence = confidenceFor(kind, works, key); return { key: `${kind}:${key}`, kind, confidence, duplicateCount: works.length, keepCandidate: workSummary(keep), mergeCandidates: works.filter((w) => w.id !== keep.id).map(workSummary), all: works.map(workSummary), safety: { payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, deletesWorks: false, mergesWorks: false, auditOnly: true } } }
function addGroup(map, key, work) { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(work) }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars. Set PAYLOAD_EXPORT_EMAIL/PAYLOAD_EXPORT_PASSWORD or PAYLOAD_SEED_EMAIL/PAYLOAD_SEED_PASSWORD, or put them in .env.local/.env.'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchAllWorks(baseUrl, token) { const docs = []; let page = 1, totalPages = 1; do { const params = new URLSearchParams(); params.set('limit', String(PAGE_LIMIT)); params.set('page', String(page)); params.set('depth', '0'); params.set('draft', 'true'); const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) }); docs.push(...(Array.isArray(result?.docs) ? result.docs : [])); totalPages = Number(result?.totalPages || 1); page += 1 } while (page <= totalPages); return docs }
async function main() {
  loadDotenv()
  const args = parseArgs(process.argv.slice(2)); const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, ''); const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR); const token = await login(base); const works = await fetchAllWorks(base, token)
  const bySource = new Map(); const byPrimaryTitleMedia = new Map(); const byPrimaryTitleOnly = new Map(); const byAliasTitleMedia = new Map(); const byAliasTitleOnly = new Map()
  for (const work of works) {
    for (const key of sourceKeys(work)) addGroup(bySource, key, work)
    const primary = primaryTitleKey(work)
    if (primary) { addGroup(byPrimaryTitleMedia, `${work.mediaGroup || 'unknown'}|${work.mediaType || 'unknown'}|${primary}`, work); addGroup(byPrimaryTitleOnly, primary, work) }
    for (const key of titleKeys(work)) {
      addGroup(byAliasTitleMedia, `${work.mediaGroup || 'unknown'}|${work.mediaType || 'unknown'}|${key}`, work)
      addGroup(byAliasTitleOnly, key, work)
    }
  }
  const rows = []
  for (const [key, group] of bySource) if (group.length > 1) rows.push(groupRow('source_key', key, group))
  for (const [key, group] of byPrimaryTitleMedia) if (group.length > 1) rows.push(groupRow('primary_title_media', key, group))
  for (const [key, group] of byAliasTitleMedia) if (group.length > 1) rows.push(groupRow('alias_title_media', key, group))
  for (const [key, group] of byPrimaryTitleOnly) if (group.length > 1) rows.push(groupRow('primary_title_only', key, group))
  for (const [key, group] of byAliasTitleOnly) if (group.length > 1) rows.push(groupRow('alias_title_only', key, group))
  const deduped = []; const seen = new Set()
  for (const row of rows.sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] || b.duplicateCount - a.duplicateCount)) {
    const signature = row.all.map((x) => x.id).sort((a, b) => Number(a) - Number(b)).join(',')
    const key = `${row.kind}:${signature}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }
  const outputs = { rows: `${outDir}/work-duplicates-v02.rows.jsonl`, high: `${outDir}/work-duplicates-v02-high.jsonl`, medium: `${outDir}/work-duplicates-v02-medium.jsonl`, low: `${outDir}/work-duplicates-v02-low.jsonl`, review: `${outDir}/work-duplicates-v02-review.jsonl`, summary: `${outDir}/work-duplicates-v02-summary.json` }
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, payloadBaseUrl: base, worksRead: works.length, duplicateGroups: deduped.length, duplicateRows: deduped.reduce((sum, row) => sum + row.duplicateCount, 0), byKind: countBy(deduped, 'kind'), byConfidence: countBy(deduped, 'confidence'), sourceKeyPolicy: { ignored: ['malId', 'idMal'], highPrefixes: [...HIGH_SOURCE_PREFIXES], reviewPrefixes: [...REVIEW_SOURCE_PREFIXES] }, outputs, safety: { payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, deletesWorks: false, mergesWorks: false, auditOnly: true } }
  writeJsonl(outputs.rows, deduped); writeJsonl(outputs.high, deduped.filter((row) => row.confidence === 'high')); writeJsonl(outputs.medium, deduped.filter((row) => row.confidence === 'medium')); writeJsonl(outputs.low, deduped.filter((row) => row.confidence === 'low')); writeJsonl(outputs.review, deduped.filter((row) => row.confidence === 'review')); writeJson(outputs.summary, summary)
  console.log(JSON.stringify(summary, null, 2)); console.log('\n==== high confidence sample ===='); for (const row of deduped.filter((r) => r.confidence === 'high').slice(0, 40)) console.log(JSON.stringify({ key: row.key, duplicateCount: row.duplicateCount, keep: row.keepCandidate.title, merge: row.mergeCandidates.map((x) => x.title) })); console.log('\n==== medium confidence sample ===='); for (const row of deduped.filter((r) => r.confidence === 'medium').slice(0, 40)) console.log(JSON.stringify({ key: row.key, duplicateCount: row.duplicateCount, keep: row.keepCandidate.title, merge: row.mergeCandidates.map((x) => x.title) }))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
