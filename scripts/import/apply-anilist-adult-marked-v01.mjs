#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'anilist-adult-marked-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/anilist-adult-marked/anilist-adult-marked-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/anilist-adult-marked'
const CONFIRM = 'apply-anilist-adult-marked-v01'
const WRITABLE_PATCH_FIELDS = new Set(['externalIds', 'sourceLinks', 'candidateSources', 'searchText'])
const TITLE_SEPARATOR_PATTERN = '[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+'
const CJKISH_CHAR_CLASS = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}ー]'
const CJKISH_SPACING_RE = new RegExp(`(${CJKISH_CHAR_CLASS})${TITLE_SEPARATOR_PATTERN}(${CJKISH_CHAR_CLASS})`, 'gu')
const CJKISH_BEFORE_PUNCT_RE = new RegExp(`(${CJKISH_CHAR_CLASS})${TITLE_SEPARATOR_PATTERN}([）》」』】、。！？：；,.!?])`, 'gu')
const PUNCT_BEFORE_CJKISH_RE = new RegExp(`([（《「『【])${TITLE_SEPARATOR_PATTERN}(${CJKISH_CHAR_CLASS})`, 'gu')

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(new RegExp(TITLE_SEPARATOR_PATTERN, 'gu'), ' ').trim() }
function normalizeText(value) { return cleanLine(value).normalize('NFKC').toLowerCase() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return []; return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function splitSearchText(value) { return val(value).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) }
function suspiciousTitleSpaceScore(value) { const text = cleanLine(value); return (text.match(CJKISH_SPACING_RE) || []).length + (text.match(CJKISH_BEFORE_PUNCT_RE) || []).length + (text.match(PUNCT_BEFORE_CJKISH_RE) || []).length + (text.match(/\[object Object\]/u) || []).length }
function suspiciousSearchTextLines(value) { return splitSearchText(value).filter((line) => suspiciousTitleSpaceScore(line) > 0) }
function externalIdsOf(doc) { const ids = doc?.externalIds; if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}; return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value)) }
function normalizedSourceLinks(value) { return list(value).map((item) => ({ label: cleanLine(item?.label), url: val(item?.url).replace(/\s+/gu, '').replace(/\/+$/u, '') })).filter((item) => item.label || item.url).sort((a, b) => `${a.label}\n${a.url}`.localeCompare(`${b.label}\n${b.url}`)) }
function normalizedCandidateSources(value) { return list(value).map((item) => ({ source: val(item?.source), label: cleanLine(item?.label), externalId: val(item?.externalId), url: val(item?.url).replace(/\s+/gu, '').replace(/\/+$/u, ''), note: cleanLine(item?.note) })).filter((item) => item.source || item.label || item.externalId || item.url || item.note).sort((a, b) => `${a.source}\n${a.externalId}\n${a.url}\n${a.note}`.localeCompare(`${b.source}\n${b.externalId}\n${b.url}\n${b.note}`)) }
function shallowEqual(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) }
function exactTitleSet(work) { return new Set([work?.title, work?.originalTitle, ...splitSearchText(work?.searchText)].map(normalizeText).filter(Boolean)) }
function buildExistingIndexes(works) {
  const anilist = new Map(), mal = new Map(), slug = new Map(), siteId = new Map(), title = new Map()
  for (const work of works) {
    const ids = externalIdsOf(work)
    if (ids.anilistMediaId) anilist.set(ids.anilistMediaId, work)
    if (ids.malId) mal.set(ids.malId, work)
    if (val(work.slug)) slug.set(val(work.slug).toLowerCase(), work)
    if (val(work.siteId)) siteId.set(val(work.siteId).toUpperCase(), work)
    for (const key of exactTitleSet(work)) { if (!title.has(key)) title.set(key, []); title.get(key).push(work) }
  }
  return { anilist, mal, slug, siteId, title }
}
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchAllWorks(baseUrl, token) { const docs = []; let page = 1; let totalPages = 1; do { const params = new URLSearchParams(); params.set('limit', '200'); params.set('page', String(page)); params.set('depth', '0'); params.set('draft', 'true'); const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) }); docs.push(...(Array.isArray(result?.docs) ? result.docs : [])); totalPages = Number(result?.totalPages || 1); page += 1 } while (page <= totalPages); return docs }
async function fetchWork(baseUrl, token, id) { return requestJson(`${baseUrl}/api/works/${id}?depth=0&draft=true`, { headers: authHeaders(token) }) }
function hasAdultMarker(plan) { const text = [plan?.payload?.evidenceNote, plan?.payload?.searchText, plan?.fieldUpdates?.searchText, ...list(plan?.payload?.candidateSources).map((item) => item?.note), ...list(plan?.fieldUpdates?.candidateSources).map((item) => item?.note), ...list(plan?.warnings)].map((item) => val(item).toLowerCase()).join('\n'); return text.includes('contentvisibility=adult') || text.includes('contentvisibility:adult') || text.includes('adultormarkedcontent=true') || text.includes('adultormarkedcontent:true') }
function validatePatchPlan(plan) {
  const blockers = []
  if (val(plan?.action) !== 'anilist_adult_mark_existing_work') blockers.push('unexpected_patch_action')
  if (plan?.planStatus !== 'ready_for_apply_review') blockers.push('not_ready_for_apply_review')
  if (!val(plan?.work?.id)) blockers.push('missing_work_id')
  if (!val(plan?.anilistMediaId)) blockers.push('missing_anilist_media_id')
  if (!hasAdultMarker(plan)) blockers.push('missing_adult_marker')
  const keys = Object.keys(plan?.fieldUpdates || {})
  if (!keys.length) blockers.push('no_field_updates')
  for (const key of keys) if (!WRITABLE_PATCH_FIELDS.has(key)) blockers.push(`non_writable_field:${key}`)
  if ('summary' in (plan?.fieldUpdates || {})) blockers.push('summary_write_blocked_for_adult_rows')
  const ids = externalIdsOf(plan?.fieldUpdates)
  if (ids.anilistMediaId && ids.anilistMediaId !== val(plan?.anilistMediaId)) blockers.push('anilist_id_mismatch')
  if (suspiciousSearchTextLines(plan?.fieldUpdates?.searchText).length) blockers.push('suspicious_title_spacing_after_sanitize')
  if (/\[object Object\]/u.test(val(plan?.fieldUpdates?.searchText))) blockers.push('object_object_search_text_artifact')
  return [...new Set(blockers)]
}
function validateCreatePlan(plan) {
  const blockers = []
  const payload = plan?.payload || {}
  const ids = externalIdsOf(payload)
  if (val(plan?.action) !== 'anilist_adult_create_yuri_work_candidate') blockers.push('unexpected_create_action')
  if (plan?.planStatus !== 'ready_for_create_dry_run') blockers.push('not_ready_for_create_dry_run')
  if (!val(plan?.anilistMediaId || ids.anilistMediaId)) blockers.push('missing_anilist_media_id')
  if (!val(payload.title)) blockers.push('missing_title')
  if (!val(payload.slug)) blockers.push('missing_slug')
  if (!val(payload.siteId)) blockers.push('missing_site_id')
  if (payload.status !== 'draft') blockers.push('not_draft_status')
  if (!hasAdultMarker(plan)) blockers.push('missing_adult_marker')
  if (Array.isArray(plan?.blockers) && plan.blockers.length) blockers.push('plan_blockers_present')
  for (const key of ['firstPublishedAt', 'firstReleasedAt', 'publishedAt', 'creators', 'creatorCredits', 'organizations', 'tags']) if (key in payload) blockers.push(`non_writable_create_field:${key}`)
  for (const value of [payload.title, payload.originalTitle, ...splitSearchText(payload.searchText)]) { if (/\[object Object\]/u.test(value)) blockers.push('object_object_search_text_artifact'); if (suspiciousTitleSpaceScore(value) > 0) blockers.push('suspicious_title_spacing_after_sanitize') }
  return [...new Set(blockers)]
}
function changedFieldsForCurrent(work, patch) { const fields = []; if (patch.externalIds && !shallowEqual(externalIdsOf(work), externalIdsOf(patch))) fields.push('externalIds'); if (patch.sourceLinks && !shallowEqual(normalizedSourceLinks(work.sourceLinks), normalizedSourceLinks(patch.sourceLinks))) fields.push('sourceLinks'); if (patch.candidateSources && !shallowEqual(normalizedCandidateSources(work.candidateSources), normalizedCandidateSources(patch.candidateSources))) fields.push('candidateSources'); if ('searchText' in patch && val(work.searchText) !== val(patch.searchText)) fields.push('searchText'); return fields }
function minimalPatch(patch, fields) { const out = {}; for (const field of fields) if (field in patch) out[field] = patch[field]; return out }
function duplicateBlockers(plan, indexes) { const blockers = []; const payload = plan?.payload || {}; const ids = externalIdsOf(payload); if (ids.anilistMediaId && indexes.anilist.has(ids.anilistMediaId)) blockers.push('existing_anilist_media_id'); if (ids.malId && indexes.mal.has(ids.malId)) blockers.push('existing_mal_id'); if (payload.slug && indexes.slug.has(val(payload.slug).toLowerCase())) blockers.push('existing_slug'); if (payload.siteId && indexes.siteId.has(val(payload.siteId).toUpperCase())) blockers.push('existing_site_id'); const searchValues = [payload.title, payload.originalTitle, ...splitSearchText(payload.searchText)]; if (searchValues.some((item) => indexes.title.has(normalizeText(item)))) blockers.push('existing_exact_title_or_search_text'); return [...new Set(blockers)] }
async function processPatchPlan({ base, token, auth, plan, apply }) { const row = { key: val(plan?.key), anilistMediaId: val(plan?.anilistMediaId), workId: val(plan?.work?.id), title: val(plan?.title), action: val(plan?.action), mode: apply ? 'apply' : 'dry-run', status: '', blockers: validatePatchPlan(plan), changedFields: [], createdWorkId: '' }; if (!row.blockers.length) { const work = await fetchWork(base, token, row.workId); row.changedFields = changedFieldsForCurrent(work, plan.fieldUpdates); if (!row.changedFields.length) row.status = 'already_current' } if (!row.status && !row.blockers.length) { if (apply) { await requestJson(`${base}/api/works/${row.workId}?draft=true`, { method: 'PATCH', headers: auth, body: JSON.stringify(minimalPatch(plan.fieldUpdates, row.changedFields)) }); row.status = 'patched' } else row.status = 'would_patch' } if (!row.status && row.blockers.length) row.status = 'blocked'; return row }
async function processCreatePlan({ base, auth, plan, apply, indexes }) { const row = { key: val(plan?.key), anilistMediaId: val(plan?.anilistMediaId), workId: '', title: val(plan?.title || plan?.payload?.title), action: val(plan?.action), mode: apply ? 'apply' : 'dry-run', status: '', blockers: validateCreatePlan(plan), changedFields: [], createdWorkId: '' }; if (!row.blockers.length) { const duplicateBlockersNow = duplicateBlockers(plan, indexes); if (duplicateBlockersNow.length) { if (duplicateBlockersNow.includes('existing_anilist_media_id') || duplicateBlockersNow.includes('existing_mal_id') || duplicateBlockersNow.includes('existing_slug') || duplicateBlockersNow.includes('existing_site_id')) row.status = 'already_exists'; else row.blockers.push(...duplicateBlockersNow) } } if (!row.status && !row.blockers.length) { if (apply) { const createdDoc = await requestJson(`${base}/api/works?draft=true`, { method: 'POST', headers: auth, body: JSON.stringify(plan.payload) }); const doc = createdDoc?.doc || createdDoc; row.createdWorkId = val(doc?.id); row.status = 'created'; if (doc) { const ids = externalIdsOf(plan.payload); if (ids.anilistMediaId) indexes.anilist.set(ids.anilistMediaId, doc); if (ids.malId) indexes.mal.set(ids.malId, doc); if (plan.payload.slug) indexes.slug.set(val(plan.payload.slug).toLowerCase(), doc); if (plan.payload.siteId) indexes.siteId.set(val(plan.payload.siteId).toUpperCase(), doc); for (const key of exactTitleSet(doc)) { if (!indexes.title.has(key)) indexes.title.set(key, []); indexes.title.get(key).push(doc) } } } else row.status = 'would_create' } if (!row.status && row.blockers.length) row.status = 'blocked'; return row }

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const apply = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM
  const limit = Number(args.limit || 0)
  if (apply && !confirmMatched) throw new Error(`Need --apply --confirm ${CONFIRM}`)
  const allPlans = readJsonl(input)
  const plans = limit > 0 ? allPlans.slice(0, limit) : allPlans
  const token = await login(base)
  const auth = authHeaders(token)
  const indexes = buildExistingIndexes(await fetchAllWorks(base, token))
  const rows = []
  let payloadPatchRequests = 0, payloadPostRequests = 0
  for (const plan of plans) {
    try {
      let row
      if (val(plan?.action) === 'anilist_adult_mark_existing_work') { row = await processPatchPlan({ base, token, auth, plan, apply }); if (apply && row.status === 'patched') payloadPatchRequests += 1 }
      else if (val(plan?.action) === 'anilist_adult_create_yuri_work_candidate') { row = await processCreatePlan({ base, auth, plan, apply, indexes }); if (apply && row.status === 'created') payloadPostRequests += 1 }
      else row = { key: val(plan?.key), anilistMediaId: val(plan?.anilistMediaId), workId: val(plan?.work?.id), title: val(plan?.title || plan?.payload?.title), action: val(plan?.action), mode: apply ? 'apply' : 'dry-run', status: 'blocked', blockers: ['unexpected_action'], changedFields: [], createdWorkId: '' }
      rows.push(row)
    } catch (error) {
      rows.push({ key: val(plan?.key), anilistMediaId: val(plan?.anilistMediaId), workId: val(plan?.work?.id), title: val(plan?.title || plan?.payload?.title), action: val(plan?.action), mode: apply ? 'apply' : 'dry-run', status: 'failed', blockers: [String(error?.message || error).slice(0, 800)], changedFields: [], createdWorkId: '' })
    }
  }
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, mode: apply ? 'apply' : 'dry-run', payloadBaseUrl: base, input, planRowsRead: allPlans.length, planRowsProcessed: plans.length, wouldPatch: rows.filter((row) => row.status === 'would_patch').length, patched: rows.filter((row) => row.status === 'patched').length, wouldCreate: rows.filter((row) => row.status === 'would_create').length, created: rows.filter((row) => row.status === 'created').length, alreadyCurrent: rows.filter((row) => row.status === 'already_current').length, alreadyExists: rows.filter((row) => row.status === 'already_exists').length, blocked: rows.filter((row) => row.status === 'blocked').length, failed: rows.filter((row) => row.status === 'failed').length, byStatus: countBy(rows, 'status'), byAction: countBy(rows, 'action'), byChangedField: countBy(rows.flatMap((row) => row.changedFields), (x) => x), byBlocker: countBy(rows.flatMap((row) => row.blockers), (x) => x), outputs: { rows: `${outDir}/anilist-adult-marked-apply-v01.rows.jsonl`, wouldPatch: `${outDir}/anilist-adult-marked-apply-v01-would-patch.jsonl`, patched: `${outDir}/anilist-adult-marked-apply-v01-patched.jsonl`, wouldCreate: `${outDir}/anilist-adult-marked-apply-v01-would-create.jsonl`, created: `${outDir}/anilist-adult-marked-apply-v01-created.jsonl`, blocked: `${outDir}/anilist-adult-marked-apply-v01-blocked.jsonl`, summary: `${outDir}/anilist-adult-marked-apply-v01-summary.json` }, safety: { applyRequested: apply, confirmMatched, payloadRead: true, payloadWrite: apply, payloadPatchRequests, payloadPostRequests, directPostgresqlWrite: false, createsWorks: apply && payloadPostRequests > 0, deletesWorks: false, adultOrMarkedContentFlow: true, ordinaryModeMustHideMarkedRows: true, existingWorkPatchWritableFields: [...WRITABLE_PATCH_FIELDS], createsOnlyDraftWorks: true, blocksMissingAdultMarker: true, blocksAdultSummaryWrites: true, blocksAdultNoYuriCreateCandidatesInPlanner: true, doesNotWriteDates: true, doesNotDownloadImages: true, doesNotWriteCreatorsOrTags: true, confirmToken: CONFIRM } }
  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(summary.outputs.rows, rows)
  writeJsonl(summary.outputs.wouldPatch, rows.filter((row) => row.status === 'would_patch'))
  writeJsonl(summary.outputs.patched, rows.filter((row) => row.status === 'patched'))
  writeJsonl(summary.outputs.wouldCreate, rows.filter((row) => row.status === 'would_create'))
  writeJsonl(summary.outputs.created, rows.filter((row) => row.status === 'created'))
  writeJsonl(summary.outputs.blocked, rows.filter((row) => row.status === 'blocked' || row.status === 'failed'))
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: summary.failed === 0, summary, outputs: summary.outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
