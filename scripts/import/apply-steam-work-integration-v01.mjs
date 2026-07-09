#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'steam-work-integration-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/steam-work-integration/steam-work-integration-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/steam-work-integration'
const CONFIRM = 'apply-steam-work-integration-v01'
const ALLOWED_ACTIONS = new Set(['steam_enrich_existing_work'])
const WRITABLE_FIELDS = new Set(['sourceLinks', 'candidateSources', 'searchText'])
const TITLE_SEPARATOR_PATTERN = '[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+'
const CJKISH_CHAR_CLASS = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}ー]'
const CJKISH_SPACING_RE = new RegExp(`(${CJKISH_CHAR_CLASS})${TITLE_SEPARATOR_PATTERN}(${CJKISH_CHAR_CLASS})`, 'gu')
const CJKISH_BEFORE_PUNCT_RE = new RegExp(`(${CJKISH_CHAR_CLASS})${TITLE_SEPARATOR_PATTERN}([）》」』】、。！？：；,.!?])`, 'gu')
const PUNCT_BEFORE_CJKISH_RE = new RegExp(`([（《「『【])${TITLE_SEPARATOR_PATTERN}(${CJKISH_CHAR_CLASS})`, 'gu')

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(new RegExp(TITLE_SEPARATOR_PATTERN, 'gu'), ' ').trim() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return []; return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function normalizeUrl(value) { return val(value).replace(/\s+/gu, '').replace(/\/+$/u, '') }
function normalizedSourceLinks(value) { return list(value).map((item) => ({ label: cleanLine(item?.label), url: normalizeUrl(item?.url) })).filter((item) => item.label || item.url).sort((a, b) => `${a.label}\n${a.url}`.localeCompare(`${b.label}\n${b.url}`)) }
function normalizedCandidateSources(value) { return list(value).map((item) => ({ source: val(item?.source), label: cleanLine(item?.label), externalId: val(item?.externalId), url: normalizeUrl(item?.url), note: cleanLine(item?.note) })).filter((item) => item.source || item.label || item.externalId || item.url || item.note).sort((a, b) => `${a.source}\n${a.externalId}\n${a.url}\n${a.note}`.localeCompare(`${b.source}\n${b.externalId}\n${b.url}\n${b.note}`)) }
function shallowEqual(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) }
function searchTextLines(value) { return val(value).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) }
function suspiciousTitleSpaceScore(value) { const text = cleanLine(value); return (text.match(CJKISH_SPACING_RE) || []).length + (text.match(CJKISH_BEFORE_PUNCT_RE) || []).length + (text.match(PUNCT_BEFORE_CJKISH_RE) || []).length + (text.match(/\[object Object\]/u) || []).length }
function suspiciousSearchTextLines(value) { return searchTextLines(value).filter((line) => suspiciousTitleSpaceScore(line) > 0) }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchWork(baseUrl, token, id) { return requestJson(`${baseUrl}/api/works/${id}?depth=0&draft=true`, { headers: authHeaders(token) }) }
function validatePlan(plan) {
  const blockers = []
  if (!val(plan?.steamAppId)) blockers.push('missing_steam_appid')
  if (!ALLOWED_ACTIONS.has(val(plan?.action))) blockers.push('unexpected_action')
  if (plan?.planStatus !== 'ready_for_apply_review') blockers.push('not_ready_for_apply_review')
  if (list(plan?.blockers).length) blockers.push('plan_blockers_present')
  if (!plan?.work?.id) blockers.push('missing_work_id')
  const keys = Object.keys(plan?.fieldUpdates || {})
  if (!keys.length) blockers.push('no_field_updates')
  for (const key of keys) if (!WRITABLE_FIELDS.has(key)) blockers.push(`non_writable_field:${key}`)
  const searchText = val(plan?.fieldUpdates?.searchText)
  if (/\[object Object\]/u.test(searchText)) blockers.push('object_object_search_text_artifact')
  if (suspiciousSearchTextLines(searchText).length) blockers.push('suspicious_title_spacing_after_sanitize')
  if (!list(plan?.fieldUpdates?.candidateSources).some((item) => item?.source === 'steam' && val(item?.externalId) === val(plan?.steamAppId))) blockers.push('missing_matching_steam_candidate_source')
  return [...new Set(blockers)]
}
function changedFieldsForCurrent(work, patch) {
  const fields = []
  if (patch.sourceLinks && !shallowEqual(normalizedSourceLinks(work.sourceLinks), normalizedSourceLinks(patch.sourceLinks))) fields.push('sourceLinks')
  if (patch.candidateSources && !shallowEqual(normalizedCandidateSources(work.candidateSources), normalizedCandidateSources(patch.candidateSources))) fields.push('candidateSources')
  if ('searchText' in patch && val(work.searchText) !== val(patch.searchText)) fields.push('searchText')
  return fields
}
function minimalPatch(patch, fields) { const out = {}; for (const field of fields) if (field in patch) out[field] = patch[field]; return out }

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
  const rows = []
  let payloadPatchRequests = 0
  for (const plan of plans) {
    const row = { key: val(plan?.key), steamAppId: val(plan?.steamAppId), workId: val(plan?.work?.id), workTitle: val(plan?.work?.title), mode: apply ? 'apply' : 'dry-run', action: val(plan?.action), status: '', blockers: validatePlan(plan), changedFields: [] }
    try {
      let work = null
      if (!row.blockers.length) {
        work = await fetchWork(base, token, row.workId)
        row.changedFields = changedFieldsForCurrent(work, plan.fieldUpdates)
        if (!row.changedFields.length) row.status = 'already_current'
      }
      if (!row.status && !row.blockers.length) {
        if (apply) {
          payloadPatchRequests += 1
          await requestJson(`${base}/api/works/${row.workId}?draft=true`, { method: 'PATCH', headers: auth, body: JSON.stringify(minimalPatch(plan.fieldUpdates, row.changedFields)) })
          row.status = 'patched'
        } else row.status = 'would_patch'
      }
      if (!row.status && row.blockers.length) row.status = 'blocked'
    } catch (error) {
      row.status = 'failed'
      row.blockers.push(String(error?.message || error).slice(0, 800))
    }
    rows.push(row)
  }
  const outputs = { rows: `${outDir}/steam-work-integration-apply-v01.rows.jsonl`, wouldPatch: `${outDir}/steam-work-integration-apply-v01-would-patch.jsonl`, patched: `${outDir}/steam-work-integration-apply-v01-patched.jsonl`, blocked: `${outDir}/steam-work-integration-apply-v01-blocked.jsonl`, summary: `${outDir}/steam-work-integration-apply-v01-summary.json` }
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, mode: apply ? 'apply' : 'dry-run', payloadBaseUrl: base, input, planRowsRead: allPlans.length, planRowsProcessed: plans.length, wouldPatch: rows.filter((r) => r.status === 'would_patch').length, patched: rows.filter((r) => r.status === 'patched').length, alreadyCurrent: rows.filter((r) => r.status === 'already_current').length, blocked: rows.filter((r) => r.status === 'blocked').length, failed: rows.filter((r) => r.status === 'failed').length, byStatus: countBy(rows, 'status'), byAction: countBy(rows, 'action'), byChangedField: countBy(rows.flatMap((r) => r.changedFields), (x) => x), byBlocker: countBy(rows.flatMap((r) => r.blockers), (x) => x), outputs, safety: { applyRequested: apply, confirmMatched, payloadRead: true, payloadWrite: apply, payloadPatchRequests, directPostgresqlWrite: false, createsWorks: false, deletesWorks: false, existingWorksOnly: true, writableFields: [...WRITABLE_FIELDS], writesOnlyChangedFields: true, createsNoWorks: true, doesNotWriteDates: true, doesNotDownloadImages: true, doesNotWriteCreatorsOrTags: true, doesNotWriteSummary: true, confirmToken: CONFIRM } }
  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldPatch, rows.filter((r) => r.status === 'would_patch'))
  writeJsonl(outputs.patched, rows.filter((r) => r.status === 'patched'))
  writeJsonl(outputs.blocked, rows.filter((r) => r.status === 'blocked' || r.status === 'failed'))
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: summary.failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
