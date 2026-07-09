#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'steam-create-candidates-plan-v0.2'
const DEFAULT_INPUT = 'data_local/staging/steam-work-integration/steam-work-integration-v01-create-candidates.jsonl'
const DEFAULT_APPDETAILS_DIR = 'data_local/raw/steam/appdetails/schinese'
const DEFAULT_OUT_DIR = 'data_local/staging/steam-work-integration/create-v02'
const PAGE_LIMIT = 200

const STRONG_YURI_PATTERNS = [
  /\byuri\b/iu,
  /\bgirls?\s*love\b/iu,
  /\blesbian\b/iu,
  /\bsapphic\b/iu,
  /\bgirl\s*[x×]\s*girl\b/iu,
  /\bGL\b/u,
  /百合/u,
  /女同/u,
]
const FEMALE_ROMANCE_PATTERNS = [
  /\bromance\b/iu,
  /\bdating\b/iu,
  /\blove\b/iu,
  /恋爱|戀愛|恋愛|爱情|愛情|恋|愛/u,
]
const FEMALE_SUBJECT_PATTERNS = [
  /\bgirls?\b/iu,
  /\bwomen\b|\bwoman\b|\bfemale\b/iu,
  /少女|女孩|女生|女性|女主|女孩子|女の子|女子/u,
]
const EXPLICIT_SENSITIVE_PATTERNS = [
  /\badult\b/iu,
  /\bsexual\b|\bsex\b|\bexplicit\b|\berotic\b|\bporn\b|\bnudity\b|\bnude\b/iu,
  /sexo|sexuelle|sexuell|conteúdo sexual|contenido sexual/iu,
  /性内容|性暗示|性爱|裸露|裸体|露骨|成人向|成人内容|成人群体|性侵犯|非自愿/u,
]
const VIOLENCE_SENSITIVE_PATTERNS = [
  /suicide|self harm|self-harm|murder|gore|violence|blood|abuse|harassment|depression/iu,
  /自杀|自殘|自残|血腥|暴力|杀戮|謀殺|谋杀|虐待|骚扰|性骚扰/u,
]

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ').trim() }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return []; return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function sourceLinkRows(doc) { return list(doc?.sourceLinks).map((item) => ({ label: cleanLine(item?.label), url: val(item?.url).replace(/\s+/gu, '').replace(/\/+$/u, '') })).filter((item) => item.url) }
function candidateSourceRows(doc) { return list(doc?.candidateSources).map((item) => ({ source: val(item?.source), label: cleanLine(item?.label), externalId: val(item?.externalId), url: val(item?.url).replace(/\s+/gu, '').replace(/\/+$/u, ''), note: cleanLine(item?.note) })).filter((item) => item.source || item.externalId || item.url || item.note) }
function steamIdsOfWork(work) { const ids = []; for (const item of [...sourceLinkRows(work), ...candidateSourceRows(work)]) { const fromUrl = item.url?.match(/store\.steampowered\.com\/app\/(\d+)/iu)?.[1]; if (fromUrl) ids.push(fromUrl); if (item.source === 'steam' && /^\d+$/u.test(item.externalId)) ids.push(item.externalId) } return [...new Set(ids)] }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchAllWorks(baseUrl, token) { const docs = []; let page = 1, totalPages = 1; do { const params = new URLSearchParams(); params.set('limit', String(PAGE_LIMIT)); params.set('page', String(page)); params.set('depth', '0'); params.set('draft', 'true'); const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) }); docs.push(...(Array.isArray(result?.docs) ? result.docs : [])); totalPages = Number(result?.totalPages || 1); page += 1 } while (page <= totalPages); return docs }
function buildExistingSteamSet(works) { const out = new Set(); for (const work of works) for (const id of steamIdsOfWork(work)) out.add(id); return out }
function loadAppdetail(appdetailsDir, steamAppId, inputFile) {
  const candidates = [inputFile, path.join(appdetailsDir, `${steamAppId}.json`)].filter(Boolean)
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const key = Object.keys(parsed || {})[0]
      const wrapper = parsed?.success !== undefined ? parsed : parsed?.[key]
      return wrapper?.data || null
    } catch {}
  }
  return null
}
function collectText(row, app) {
  const payload = row?.createCandidatePreview?.payloadPreview || {}
  const steamSourceNotes = list(row?.createCandidatePreview?.candidateSources).map((x) => x?.note)
  const titleText = [row?.title, row?.raw?.name, payload.title, payload.originalTitle, payload.searchText].map(cleanLine).filter(Boolean).join('\n')
  const descriptionText = [app?.short_description, app?.about_the_game, app?.detailed_description].map(cleanLine).filter(Boolean).join('\n')
  const descriptorText = [row?.raw?.content_descriptors?.notes, app?.content_descriptors?.notes].map(cleanLine).filter(Boolean).join('\n')
  const genreText = [...list(row?.raw?.genres).map((x) => x?.description), ...list(app?.genres).map((x) => x?.description), ...list(app?.categories).map((x) => x?.description)].map(cleanLine).filter(Boolean).join('\n')
  const noteText = steamSourceNotes.map(cleanLine).filter(Boolean).join('\n')
  return { titleText, descriptionText, descriptorText, genreText, noteText, searchText: [titleText, descriptionText, descriptorText, genreText, noteText].join('\n') }
}
function matchPatterns(text, patterns) { const hits = []; for (const pattern of patterns) { const match = text.match(pattern); if (match?.[0]) hits.push(match[0]) } return [...new Set(hits.map(cleanLine).filter(Boolean))] }
function topLevelRequiredAge(row, app) { const values = [row?.raw?.required_age, app?.required_age].map((x) => Number(x || 0)).filter(Number.isFinite); return Math.max(0, ...values) }
function classify(row, existingSteamIds, appdetailsDir) {
  const steamAppId = val(row?.steamAppId)
  const app = loadAppdetail(appdetailsDir, steamAppId, row?.raw?.inputFile)
  const text = collectText(row, app)
  const strongYuriHits = matchPatterns([text.titleText, text.descriptionText, text.descriptorText, text.noteText].join('\n'), STRONG_YURI_PATTERNS)
  const femaleRomanceHits = [...matchPatterns([text.titleText, text.descriptionText].join('\n'), FEMALE_ROMANCE_PATTERNS), ...matchPatterns([text.titleText, text.descriptionText].join('\n'), FEMALE_SUBJECT_PATTERNS)]
  const explicitSensitiveHits = matchPatterns(text.descriptorText, EXPLICIT_SENSITIVE_PATTERNS)
  const violenceSensitiveHits = matchPatterns(text.descriptorText, VIOLENCE_SENSITIVE_PATTERNS)
  const age = topLevelRequiredAge(row, app)
  const hasTopAdultAge = age >= 18
  const hasStrongYuri = strongYuriHits.length > 0
  const hasFemaleRomance = matchPatterns([text.titleText, text.descriptionText].join('\n'), FEMALE_ROMANCE_PATTERNS).length > 0 && matchPatterns([text.titleText, text.descriptionText].join('\n'), FEMALE_SUBJECT_PATTERNS).length > 0
  const hasVisualNovel = /visual novel|视觉小说|視覺小說|ビジュアルノベル/iu.test([text.titleText, text.descriptionText, text.genreText].join('\n')) || row?.createCandidatePreview?.mediaType === 'visual_novel' || row?.createCandidatePreview?.format === 'visual_novel'
  const explicitSensitive = explicitSensitiveHits.length > 0 || hasTopAdultAge
  const anySensitive = explicitSensitive || violenceSensitiveHits.length > 0
  let bucket = 'p9-other-review'
  if (existingSteamIds.has(steamAppId)) bucket = 'p0-already-existing-steam'
  else if (hasStrongYuri && !explicitSensitive) bucket = 'p1-strong-yuri-nonadult'
  else if (hasStrongYuri && explicitSensitive) bucket = 'p2-strong-yuri-sensitive'
  else if (hasFemaleRomance && !explicitSensitive) bucket = 'p3-female-romance-nonadult'
  else if (hasFemaleRomance && explicitSensitive) bucket = 'p4-female-romance-sensitive'
  else if (hasVisualNovel && !anySensitive) bucket = 'p5-visual-novel-neutral-review'
  else if (anySensitive) bucket = 'p8-sensitive-review'
  return { bucket, steamAppId, title: cleanLine(row?.title || row?.raw?.name || app?.name), steamUrl: row?.steamUrl || `https://store.steampowered.com/app/${steamAppId}`, requiredAge: age, hasTopAdultAge, hasStrongYuri, hasFemaleRomance, hasVisualNovel, explicitSensitive, anySensitive, strongYuriHits, femaleRomanceHits, explicitSensitiveHits, violenceSensitiveHits, appdetailLoaded: Boolean(app), row }
}
function compact(item) { return { key: item.row.key, steamAppId: item.steamAppId, title: item.title, steamUrl: item.steamUrl, bucket: item.bucket, requiredAge: item.requiredAge, strongYuriHits: item.strongYuriHits, femaleRomanceHits: item.femaleRomanceHits, explicitSensitiveHits: item.explicitSensitiveHits, violenceSensitiveHits: item.violenceSensitiveHits, media: item.row.createCandidatePreview ? { mediaGroup: item.row.createCandidatePreview.mediaGroup, mediaType: item.row.createCandidatePreview.mediaType, format: item.row.createCandidatePreview.format, yuriCandidateScore: item.row.createCandidatePreview.payloadPreview?.yuriCandidateScore } : null, sourceKinds: item.row.relation?.sourceKinds || [] } }
function outputRows(items) { return items.map((item) => item.row) }
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const appdetailsDir = String(args['appdetails-dir'] || DEFAULT_APPDETAILS_DIR)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const token = await login(base)
  const works = await fetchAllWorks(base, token)
  const existingSteamIds = buildExistingSteamSet(works)
  const rows = readJsonl(input).filter((row) => row?.action === 'steam_create_candidate_preview' && row?.planStatus === 'create_candidate_review')
  const items = rows.map((row) => classify(row, existingSteamIds, appdetailsDir))
  const buckets = Object.groupBy ? Object.groupBy(items, (item) => item.bucket) : items.reduce((acc, item) => { (acc[item.bucket] ||= []).push(item); return acc }, {})
  const outputMap = {
    alreadyExisting: 'p0-already-existing-steam',
    strongYuriNonAdult: 'p1-strong-yuri-nonadult',
    strongYuriSensitive: 'p2-strong-yuri-sensitive',
    femaleRomanceNonAdult: 'p3-female-romance-nonadult',
    femaleRomanceSensitive: 'p4-female-romance-sensitive',
    visualNovelNeutralReview: 'p5-visual-novel-neutral-review',
    sensitiveReview: 'p8-sensitive-review',
    otherReview: 'p9-other-review',
  }
  const outputs = { summary: `${outDir}/steam-create-candidates-v02-summary.json` }
  for (const [key, bucket] of Object.entries(outputMap)) {
    outputs[key] = `${outDir}/${bucket}.jsonl`
    outputs[`${key}Compact`] = `${outDir}/${bucket}.compact.jsonl`
    writeJsonl(outputs[key], outputRows(buckets[bucket] || []))
    writeJsonl(outputs[`${key}Compact`], (buckets[bucket] || []).map(compact))
  }
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, payloadBaseUrl: base, input, appdetailsDir, worksRead: works.length, existingSteamIds: existingSteamIds.size, inputCreateCandidateRows: rows.length, bucketCounts: countBy(items, 'bucket'), appdetailLoaded: items.filter((x) => x.appdetailLoaded).length, outputs, safety: { payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, createsWorks: false, reportOnly: true, excludesAlreadyExistingSteamIds: true, doesNotScanFieldNamesForYuri: true, adultSensitiveSignalUsesTopLevelRequiredAgeAndExplicitDescriptorText: true, doesNotUseRegionalRatingsAgeAsAdultSignal: true } }
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify(summary, null, 2))
  console.log('\n==== strong yuri non-adult sample ====')
  for (const row of (buckets['p1-strong-yuri-nonadult'] || []).slice(0, 80).map(compact)) console.log(JSON.stringify(row))
  console.log('\n==== strong yuri sensitive sample ====')
  for (const row of (buckets['p2-strong-yuri-sensitive'] || []).slice(0, 80).map(compact)) console.log(JSON.stringify(row))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
