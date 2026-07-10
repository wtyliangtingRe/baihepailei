#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'entity-anomaly-medium-rename-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/entity-anomalies/entity-anomaly-medium-rename-plan-v01-safe-rename.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/entity-anomalies'
const CONFIRM = 'apply-entity-anomaly-medium-rename-v01'
const PATCH_FIELDS = new Set(['name', 'searchText'])
const PAGE_LIMIT = 200

function val(value) { return String(value ?? '').trim() }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ').trim() }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function loadEnvFile(file) { if (!fs.existsSync(file)) return; const raw = fs.readFileSync(file, 'utf8'); for (const line of raw.split(/\r?\n/u)) { const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue; const idx = trimmed.indexOf('='); const key = trimmed.slice(0, idx).trim(); let value = trimmed.slice(idx + 1).trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); if (key && process.env[key] == null) process.env[key] = value } }
function loadEnv() { loadEnvFile(path.resolve('.env.local')); loadEnvFile(path.resolve('.env')) }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return []; return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function normalizeName(value) { return cleanLine(value).normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/gu, '').replace(/[\-‐‑‒–—―~〜～・:：;；,，.。!！?？'"“”‘’「」『』【】《》\[\]（）()<>＜＞]/gu, '') }
function searchTextLines(value) { return val(value).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) }
function uniqueLines(values) { const out = []; const seen = new Set(); for (const raw of values.flatMap(searchTextLines)) { const line = cleanLine(raw); if (!line) continue; const key = line.toLowerCase(); if (seen.has(key)) continue; seen.add(key); out.push(line) } return out.join('\n') }
function shallowEqual(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) }
function candidateUnsafe(value) { const text = cleanLine(value); return /[^\x00-\x7F]/u.test(text) && /[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/u.test(text) }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchEntity(baseUrl, token, collection, id) { return requestJson(`${baseUrl}/api/${collection}/${id}?depth=0&draft=true`, { headers: authHeaders(token) }) }
async function fetchAll(baseUrl, token, collection) { const docs = []; let page = 1, totalPages = 1; do { const params = new URLSearchParams(); params.set('limit', String(PAGE_LIMIT)); params.set('page', String(page)); params.set('depth', '0'); params.set('draft', 'true'); const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, { headers: authHeaders(token) }); docs.push(...(Array.isArray(result?.docs) ? result.docs : [])); totalPages = Number(result?.totalPages || 1); page += 1 } while (page <= totalPages); return docs }
function entityTitle(doc) { return cleanLine(doc?.name || doc?.title || doc?.displayName || doc?.originalName || doc?.label || doc?.slug || doc?.siteId) }
function validateRow(row) { const blockers = []; if (cleanLine(row?.collection) !== 'creators') blockers.push('not_creator_collection'); if (cleanLine(row?.status) !== 'safe_rename') blockers.push('not_safe_rename'); if (cleanLine(row?.severity) !== 'medium') blockers.push('not_medium_severity'); if (!row?.id) blockers.push('missing_entity_id'); if (!cleanLine(row?.oldTitle)) blockers.push('missing_old_title'); if (!cleanLine(row?.candidateName)) blockers.push('missing_candidate_name'); if (Array.isArray(row?.blockers) && row.blockers.length) blockers.push('plan_has_blockers'); if (Array.isArray(row?.duplicateTargets) && row.duplicateTargets.length) blockers.push('plan_has_duplicate_targets'); if (candidateUnsafe(row?.candidateName)) blockers.push('candidate_nonascii_contains_space'); return blockers }
function makePatch(doc, row) { const oldName = cleanLine(row.oldTitle); const newName = cleanLine(row.candidateName); const marker = `entityAnomalyRenamed=true; renamedBy=${VERSION}; oldName=${oldName}; newName=${newName}; auditId=${row.id}.`; return { name: newName, searchText: uniqueLines([doc.searchText, oldName, marker]) } }
function changedFields(current, patch) { const fields = []; for (const key of Object.keys(patch)) { if (!PATCH_FIELDS.has(key)) continue; if (!shallowEqual(current[key], patch[key])) fields.push(key) } return fields }
function minimalPatch(patch, fields) { const out = {}; for (const field of fields) out[field] = patch[field]; return out }

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const apply = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM
  const limit = Number(args.limit || 0)
  if (apply && !confirmMatched) throw new Error(`Need --apply --confirm ${CONFIRM}`)

  const allRows = readJsonl(input)
  const plans = limit > 0 ? allRows.slice(0, limit) : allRows
  const token = await login(base)
  const creators = await fetchAll(base, token, 'creators')
  const creatorByNorm = new Map()
  for (const doc of creators) {
    const key = normalizeName(entityTitle(doc))
    if (!key) continue
    if (!creatorByNorm.has(key)) creatorByNorm.set(key, [])
    creatorByNorm.get(key).push({ id: doc.id, name: entityTitle(doc), slug: doc.slug, siteId: doc.siteId, isLiteVisible: doc.isLiteVisible, isFullVisible: doc.isFullVisible })
  }

  const rows = []
  let payloadPatchRequests = 0
  for (const plan of plans) {
    const row = { collection: cleanLine(plan.collection), id: val(plan.id), oldTitle: cleanLine(plan.oldTitle), candidateName: cleanLine(plan.candidateName), mode: apply ? 'apply' : 'dry-run', status: '', severity: cleanLine(plan.severity), reasons: Array.isArray(plan.reasons) ? plan.reasons : [], blockers: validateRow(plan), changedFields: [], patched: false }
    try {
      if (!row.blockers.length) {
        const duplicates = (creatorByNorm.get(normalizeName(row.candidateName)) || []).filter((x) => String(x.id) !== String(row.id))
        if (duplicates.length) row.blockers.push('current_duplicate_candidate')
        const current = await fetchEntity(base, token, row.collection, row.id)
        const currentName = entityTitle(current)
        if (![normalizeName(row.oldTitle), normalizeName(row.candidateName)].includes(normalizeName(currentName))) row.blockers.push('current_name_mismatch')
        if (!row.blockers.length) {
          const patch = makePatch(current, row)
          row.changedFields = changedFields(current, patch)
          if (!row.changedFields.length) row.status = 'already_current'
          else if (!apply) row.status = 'would_rename'
          else {
            payloadPatchRequests += 1
            await requestJson(`${base}/api/${row.collection}/${row.id}?draft=true`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(minimalPatch(patch, row.changedFields)) })
            row.patched = true
            row.status = 'renamed'
          }
        }
      }
      if (!row.status && row.blockers.length) row.status = 'blocked'
    } catch (error) {
      row.status = 'failed'
      row.blockers.push(String(error?.message || error).slice(0, 1200))
    }
    rows.push(row)
  }

  const outputs = { rows: `${outDir}/entity-anomaly-medium-rename-apply-v01.rows.jsonl`, wouldRename: `${outDir}/entity-anomaly-medium-rename-apply-v01-would-rename.jsonl`, renamed: `${outDir}/entity-anomaly-medium-rename-apply-v01-renamed.jsonl`, blocked: `${outDir}/entity-anomaly-medium-rename-apply-v01-blocked.jsonl`, failed: `${outDir}/entity-anomaly-medium-rename-apply-v01-failed.jsonl`, summary: `${outDir}/entity-anomaly-medium-rename-apply-v01-summary.json` }
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, mode: apply ? 'apply' : 'dry-run', payloadBaseUrl: base, input, planRowsRead: allRows.length, planRowsProcessed: plans.length, wouldRename: rows.filter((r) => r.status === 'would_rename').length, renamed: rows.filter((r) => r.status === 'renamed').length, alreadyCurrent: rows.filter((r) => r.status === 'already_current').length, blocked: rows.filter((r) => r.status === 'blocked').length, failed: rows.filter((r) => r.status === 'failed').length, byStatus: countBy(rows, 'status'), byBlocker: countBy(rows.flatMap((row) => row.blockers), (x) => x), byChangedField: countBy(rows.flatMap((row) => row.changedFields), (x) => x), outputs, safety: { applyRequested: apply, confirmMatched, payloadRead: true, payloadWrite: apply, payloadPatchRequests, directPostgresqlWrite: false, deletesEntities: false, physicallyMergesOrDeletesEntities: false, renamesEntities: true, migratesRelations: false, updatesSlugOrSiteId: false, patchFields: [...PATCH_FIELDS], confirmToken: CONFIRM } }
  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldRename, rows.filter((r) => r.status === 'would_rename'))
  writeJsonl(outputs.renamed, rows.filter((r) => r.status === 'renamed'))
  writeJsonl(outputs.blocked, rows.filter((r) => r.status === 'blocked'))
  writeJsonl(outputs.failed, rows.filter((r) => r.status === 'failed'))
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
