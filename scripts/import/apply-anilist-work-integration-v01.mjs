#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'anilist-work-integration-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/anilist-work-integration/anilist-work-integration-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/anilist-work-integration'
const CONFIRM = 'apply-anilist-work-integration-v01'
const ALLOWED_ACTIONS = new Set(['anilist_enrich_existing_work'])
const WRITABLE_FIELDS = new Set(['externalIds', 'sourceLinks', 'candidateSources', 'searchText', 'summary'])

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return []; return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ').trim() }
function externalIdsOf(doc) { const ids = doc?.externalIds; if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}; return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value)) }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchWork(baseUrl, token, id) { return requestJson(`${baseUrl}/api/works/${id}?depth=0&draft=true`, { headers: authHeaders(token) }) }
function validatePlan(plan) {
  const blockers = []
  if (!val(plan?.anilistMediaId)) blockers.push('missing_anilist_media_id')
  if (!ALLOWED_ACTIONS.has(val(plan?.action))) blockers.push('unexpected_action')
  if (plan?.planStatus !== 'ready_for_apply_review') blockers.push('not_ready_for_apply_review')
  if (list(plan?.blockers).length) blockers.push('plan_blockers_present')
  if (!plan?.work?.id) blockers.push('missing_work_id')
  if (plan?.isAdult === true) blockers.push('anilist_adult_content_requires_separate_review')
  const keys = Object.keys(plan?.fieldUpdates || {})
  if (!keys.length) blockers.push('no_field_updates')
  for (const key of keys) if (!WRITABLE_FIELDS.has(key)) blockers.push(`non_writable_field:${key}`)
  const ids = externalIdsOf(plan?.fieldUpdates)
  if (ids.anilistMediaId && ids.anilistMediaId !== val(plan?.anilistMediaId)) blockers.push('anilist_id_mismatch')
  return [...new Set(blockers)]
}
function shallowEqual(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) }
function changedFieldsForCurrent(work, patch) {
  const fields = []
  if (patch.externalIds && !shallowEqual(externalIdsOf(work), externalIdsOf(patch))) fields.push('externalIds')
  if (patch.sourceLinks && !shallowEqual(list(work.sourceLinks), list(patch.sourceLinks))) fields.push('sourceLinks')
  if (patch.candidateSources && !shallowEqual(list(work.candidateSources), list(patch.candidateSources))) fields.push('candidateSources')
  if ('searchText' in patch && val(work.searchText) !== val(patch.searchText)) fields.push('searchText')
  if ('summary' in patch && !work.summary) fields.push('summary')
  return fields
}

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
  let wouldPatch = 0, patched = 0, alreadyCurrent = 0, blocked = 0, failed = 0, payloadPatchRequests = 0
  for (const plan of plans) {
    const row = { key: val(plan?.key), anilistMediaId: val(plan?.anilistMediaId), workId: val(plan?.work?.id), workTitle: val(plan?.work?.title), mode: apply ? 'apply' : 'dry-run', action: val(plan?.action), status: '', blockers: validatePlan(plan), changedFields: [] }
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
          await requestJson(`${base}/api/works/${row.workId}?draft=true`, { method: 'PATCH', headers: auth, body: JSON.stringify(plan.fieldUpdates) })
          row.status = 'patched'
          patched += 1
        } else {
          row.status = 'would_patch'
          wouldPatch += 1
        }
      } else if (row.status === 'already_current') alreadyCurrent += 1
      if (!row.status && row.blockers.length) { row.status = 'blocked'; blocked += 1 }
    } catch (error) {
      row.status = 'failed'
      row.blockers.push(String(error?.message || error).slice(0, 800))
      failed += 1
    }
    rows.push(row)
  }
  fs.mkdirSync(outDir, { recursive: true })
  const outputs = { rows: `${outDir}/anilist-work-integration-apply-v01.rows.jsonl`, wouldPatch: `${outDir}/anilist-work-integration-apply-v01-would-patch.jsonl`, patched: `${outDir}/anilist-work-integration-apply-v01-patched.jsonl`, blocked: `${outDir}/anilist-work-integration-apply-v01-blocked.jsonl`, summary: `${outDir}/anilist-work-integration-apply-v01-summary.json` }
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, mode: apply ? 'apply' : 'dry-run', payloadBaseUrl: base, input, planRowsRead: allPlans.length, planRowsProcessed: plans.length, wouldPatch, patched, alreadyCurrent, blocked, failed, byStatus: countBy(rows, 'status'), byAction: countBy(rows, 'action'), byChangedField: countBy(rows.flatMap((r) => r.changedFields), (x) => x), byBlocker: countBy(rows.flatMap((r) => r.blockers), (x) => x), outputs, safety: { applyRequested: apply, confirmMatched, payloadRead: true, payloadWrite: apply, payloadPatchRequests, directPostgresqlWrite: false, createsWorks: false, deletesWorks: false, inputMustBeReadyPlannerOutput: true, writableFields: [...WRITABLE_FIELDS], existingWorksOnly: true, adultRowsRequireSeparateReview: true, doesNotDownloadImages: true, doesNotWriteTagsOrCreators: true, confirmToken: CONFIRM } }
  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldPatch, rows.filter((r) => r.status === 'would_patch'))
  writeJsonl(outputs.patched, rows.filter((r) => r.status === 'patched'))
  writeJsonl(outputs.blocked, rows.filter((r) => r.status === 'blocked' || r.status === 'failed'))
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
