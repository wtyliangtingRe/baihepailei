#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'entity-anomaly-medium-rename-plan-v0.6'
const DEFAULT_INPUT = 'data_local/staging/entity-anomalies/entity-anomalies-v01-medium.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/entity-anomalies'
const PAGE_LIMIT = 200
const ROLE_PREFIXES = new Set(['仅有参加作品原作人物', '人物', '活动', '活動', '文案', '原案', '原作', '角色原画', '作画', '監督', '脚本', '製作協力', '出品', '出品人'])
const GENERIC_CANDIDATE_NAMES = new Set(['舞台', '月刊', '人物', '活动', '活動', '文案', '原案', '原作', '作者', '著者', '作', '作品', 'ステージ'])
const CJK_RANGES = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u309F\\u30A0-\\u30FF\\u31F0-\\u31FF'
const CJK_SPACE_RE = new RegExp(`([${CJK_RANGES}])[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+([${CJK_RANGES}])`, 'gu')
const NON_ASCII_SPACE_RE = /([^\x00-\x7F])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([^\x00-\x7F])/gu

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ').trim() }
function compactCjkSpaces(value) { let text = cleanLine(value); let prev = ''; while (prev !== text) { prev = text; text = text.replace(CJK_SPACE_RE, '$1$2').replace(NON_ASCII_SPACE_RE, '$1$2') } return text }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function loadEnvFile(file) { if (!fs.existsSync(file)) return; const raw = fs.readFileSync(file, 'utf8'); for (const line of raw.split(/\r?\n/u)) { const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue; const idx = trimmed.indexOf('='); const key = trimmed.slice(0, idx).trim(); let value = trimmed.slice(idx + 1).trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); if (key && process.env[key] == null) process.env[key] = value } }
function loadEnv() { loadEnvFile(path.resolve('.env.local')); loadEnvFile(path.resolve('.env')) }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return []; return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function normalizeName(value) { return cleanLine(value).normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/gu, '').replace(/[\-‐‑‒–—―~〜～・:：;；,，.。!！?？'"“”‘’「」『』【】《》\[\]（）()<>＜＞]/gu, '') }
function entityTitle(doc) { return cleanLine(doc?.title || doc?.name || doc?.displayName || doc?.originalName || doc?.label || doc?.slug || doc?.siteId) }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchAll(baseUrl, token, collection) { const docs = []; let page = 1, totalPages = 1; do { const params = new URLSearchParams(); params.set('limit', String(PAGE_LIMIT)); params.set('page', String(page)); params.set('depth', '0'); params.set('draft', 'true'); const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, { headers: authHeaders(token) }); docs.push(...(Array.isArray(result?.docs) ? result.docs : [])); totalPages = Number(result?.totalPages || 1); page += 1 } while (page <= totalPages); return docs }

function firstQuoteIndex(text) { const indexes = ['「', '『', '《', '“', '"'].map((ch) => text.indexOf(ch)).filter((idx) => idx >= 0); return indexes.length ? Math.min(...indexes) : -1 }
function normalizeCandidateName(value) { return compactCjkSpaces(value).replace(/\s*([・·])\s*/gu, '$1').replace(/^\s+|\s+$/gu, '') }
function stripTrailingNoise(value) {
  return normalizeCandidateName(value)
    .replace(/[\s:：;；,，.。\-—–()（）【】\[\]<>＜＞]+$/u, '')
    .replace(/^(?:原作|作者|著者|作)[:：]/u, '')
    .replace(/(?:\s*(?:月刊|連載|连载|掲載|掲載誌|シリーズ|より|から))$/u, '')
    .trim()
}
function hasWorkQuote(value) { return /[「『《“"].+[」』》”"]/u.test(value) || /[「『《]/u.test(value) }
function hasBadCharsForName(value) { return /[「」『』《》【】\[\]{}]/u.test(value) || /[:：;]/u.test(value) }
function looksMultiPersonOrRole(value) { return /(?:著|訳|译|原作|角色原案|脚本).*[・、,，].*(?:著|訳|译|原作|角色原案|脚本)/u.test(value) || /[;；]/u.test(value) }
function looksOrgLike(value) { return /(?:株式会社|有限会社|会社|製作|制作|委员会|委員会|出品|出版社|テレビ|アニメーション|ホールディングス|网络|網絡|Production|Productions|Studio|Studios|NETWORK|networks?|Games?|Soft|SOFT|Company|Inc\.?|LLC|\bPoint\b|\bTeam\b|\bProject\b|\bCircle\b|\bGroup\b)/iu.test(value) }
function looksGenericCandidate(value) { return GENERIC_CANDIDATE_NAMES.has(cleanLine(value)) }
function looksShortSymbolicLatin(value) { return /^[A-Za-z0-9+&._-]{1,4}$/u.test(cleanLine(value)) }
function looksEmptyOrWorkOnly(title, candidate) { return !candidate || normalizeName(title) === normalizeName(candidate) || candidate.length < 1 }
function inferCreatorRename(title, reasons) {
  const text = cleanLine(title)
  const notes = []
  if (!text) return { candidate: '', method: '', notes: ['empty_title'] }
  const colon = text.match(/^([^:：]{1,18})[:：]\s*(.+)$/u)
  if (colon && ROLE_PREFIXES.has(cleanLine(colon[1]))) return { candidate: normalizeCandidateName(stripTrailingNoise(colon[2])), method: 'role_prefix_after_colon', notes: [`role_prefix:${cleanLine(colon[1])}`, 'manual_by_default'] }
  const parenIdx = text.search(/[（(]/u)
  const quoteIdx = firstQuoteIndex(text)
  let candidate = ''
  let method = ''
  if (parenIdx > 0 && quoteIdx > parenIdx) { candidate = stripTrailingNoise(text.slice(0, parenIdx)); method = 'prefix_before_parenthesized_work_context' }
  else if (quoteIdx > 0) { candidate = stripTrailingNoise(text.slice(0, quoteIdx)); method = 'prefix_before_work_quote' }
  else if (quoteIdx === 0) { candidate = ''; method = 'pure_or_work_first_title'; notes.push('work_quote_at_start') }
  if (!candidate && /[)）]$/u.test(text) && /[（(]/u.test(text)) { candidate = stripTrailingNoise(text.replace(/[（(].*$/u, '')); method = method || 'prefix_before_parenthesis' }
  candidate = normalizeCandidateName(candidate)
  if (looksEmptyOrWorkOnly(text, candidate)) notes.push('no_clean_candidate')
  if (candidate && hasBadCharsForName(candidate)) notes.push('candidate_has_bad_chars')
  if (candidate && candidate.length > 64) notes.push('candidate_too_long')
  if (candidate && looksMultiPersonOrRole(candidate)) notes.push('candidate_multiperson_or_role_mixed')
  if (candidate && looksOrgLike(candidate)) notes.push('candidate_organization_like')
  if (candidate && looksGenericCandidate(candidate)) notes.push('candidate_generic_word')
  if (candidate && looksShortSymbolicLatin(candidate)) notes.push('candidate_short_symbolic_latin')
  if (!hasWorkQuote(text) && !reasons.includes('title_unbalanced_brackets')) notes.push('missing_work_quote_signal')
  return { candidate, method, notes }
}
function classify(row, duplicateTargets) {
  const notes = [...row.notes]
  if (row.collection !== 'creators') return { status: 'manual_review', blockers: ['not_creator_collection'], notes }
  if (row.method === 'role_prefix_after_colon') return { status: 'manual_review', blockers: ['role_prefix_needs_manual_review'], notes }
  if (!row.candidateName) return { status: 'manual_review', blockers: ['missing_candidate_name'], notes }
  const blockingNotes = notes.filter((x) => ['candidate_has_bad_chars', 'candidate_too_long', 'candidate_multiperson_or_role_mixed', 'candidate_organization_like', 'candidate_generic_word', 'candidate_short_symbolic_latin', 'no_clean_candidate'].includes(x))
  if (blockingNotes.length) return { status: 'manual_review', blockers: blockingNotes, notes }
  if (duplicateTargets.length) return { status: 'duplicate_target_review', blockers: ['existing_same_name_entity'], notes }
  return { status: 'safe_rename', blockers: [], notes }
}
function markPlanInternalDuplicateCandidates(rows) {
  const counts = new Map()
  for (const row of rows) { if (row.status !== 'safe_rename') continue; const key = normalizeName(row.candidateName); if (key) counts.set(key, (counts.get(key) || 0) + 1) }
  for (const row of rows) {
    if (row.status !== 'safe_rename') continue
    const key = normalizeName(row.candidateName)
    if (key && counts.get(key) > 1) { row.status = 'manual_review'; row.blockers = [...new Set([...row.blockers, 'candidate_duplicate_within_plan'])]; row.notes = [...new Set([...row.notes, 'candidate_duplicate_within_plan'])] }
  }
}

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const limit = Number(args.limit || 0)
  const allPlans = readJsonl(input)
  const plans = limit > 0 ? allPlans.slice(0, limit) : allPlans
  const token = await login(base)
  const [creators, organizations] = await Promise.all([fetchAll(base, token, 'creators'), fetchAll(base, token, 'organizations')])
  const creatorByNorm = new Map()
  for (const doc of creators) {
    const key = normalizeName(entityTitle(doc))
    if (!key) continue
    if (!creatorByNorm.has(key)) creatorByNorm.set(key, [])
    creatorByNorm.get(key).push({ id: doc.id, name: entityTitle(doc), slug: doc.slug, siteId: doc.siteId, isLiteVisible: doc.isLiteVisible, isFullVisible: doc.isFullVisible })
  }
  const rows = []
  for (const plan of plans) {
    const title = cleanLine(plan.title || plan.name || plan.rawTitle)
    const reasons = list(plan.reasons).map(cleanLine).filter(Boolean)
    const inferred = inferCreatorRename(title, reasons)
    const candidateName = normalizeCandidateName(inferred.candidate)
    const duplicateTargets = candidateName ? list(creatorByNorm.get(normalizeName(candidateName))).filter((x) => String(x.id) !== String(plan.id)) : []
    const baseRow = { collection: cleanLine(plan.collection), id: String(plan.id ?? ''), oldTitle: title, candidateName, method: inferred.method, severity: cleanLine(plan.severity), reasons, notes: inferred.notes, duplicateTargets, sourceSlug: cleanLine(plan.slug), siteId: cleanLine(plan.siteId), safety: { planOnly: true, payloadWrite: false, directPostgresqlWrite: false, deletesEntities: false } }
    const cls = classify(baseRow, duplicateTargets)
    rows.push({ ...baseRow, status: cls.status, blockers: cls.blockers, notes: cls.notes })
  }
  markPlanInternalDuplicateCandidates(rows)
  const outputs = { rows: `${outDir}/entity-anomaly-medium-rename-plan-v01.rows.jsonl`, safeRename: `${outDir}/entity-anomaly-medium-rename-plan-v01-safe-rename.jsonl`, duplicateTargetReview: `${outDir}/entity-anomaly-medium-rename-plan-v01-duplicate-target-review.jsonl`, manualReview: `${outDir}/entity-anomaly-medium-rename-plan-v01-manual-review.jsonl`, summary: `${outDir}/entity-anomaly-medium-rename-plan-v01-summary.json` }
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, payloadBaseUrl: base, input, planRowsRead: allPlans.length, planRowsProcessed: plans.length, creatorsRead: creators.length, organizationsRead: organizations.length, byStatus: countBy(rows, 'status'), byCollection: countBy(rows, 'collection'), byMethod: countBy(rows, 'method'), byBlocker: countBy(rows.flatMap((row) => row.blockers), (x) => x), safeRename: rows.filter((r) => r.status === 'safe_rename').length, duplicateTargetReview: rows.filter((r) => r.status === 'duplicate_target_review').length, manualReview: rows.filter((r) => r.status === 'manual_review').length, outputs, safety: { payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, deletesEntities: false, renamesEntities: false, planOnly: true } }
  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.safeRename, rows.filter((r) => r.status === 'safe_rename'))
  writeJsonl(outputs.duplicateTargetReview, rows.filter((r) => r.status === 'duplicate_target_review'))
  writeJsonl(outputs.manualReview, rows.filter((r) => r.status === 'manual_review'))
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
