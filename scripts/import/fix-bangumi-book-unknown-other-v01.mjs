#!/usr/bin/env node
import fs from 'node:fs'

const INPUT = 'data_local/staging/work-source-metadata/bangumi-book-unknown-other-v01-plans.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
const CONFIRM = 'apply-bangumi-book-other-v01'
const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
const apply = Boolean(args.apply)
if (apply && String(args.confirm || '') !== CONFIRM) throw new Error(`Need --apply --confirm ${CONFIRM}`)
const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
if (!email || !password) throw new Error('Missing Payload login env vars')
function clean(v) { return String(v ?? '').trim() }
function readJsonl(file) { const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return o }
async function json(url, opt = {}) { const res = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } }); const text = await res.text(); const data = text ? JSON.parse(text) : null; if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`); return data }
const login = await json(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
const auth = { Authorization: `JWT ${login.token}` }
const plans = readJsonl(String(args.input || INPUT))
const rows = []
let wouldPatch = 0, patched = 0, alreadyCurrent = 0, blocked = 0
for (const p of plans) {
  const row = { workId: p.workId, title: p.title, target: 'other', status: '', changedFields: [], blockers: [] }
  try {
    const work = await json(`${base}/api/works/${p.workId}?depth=0&draft=true`, { headers: auth })
    const group = clean(work.mediaGroup || 'unknown')
    const type = clean(work.mediaType || 'unknown')
    if (!['unknown', 'other'].includes(group) || !['unknown', 'other'].includes(type)) row.blockers.push('not_unknown_or_other')
    const body = {}
    if (!row.blockers.length && group !== 'other') body.mediaGroup = 'other'
    if (!row.blockers.length && type !== 'other') body.mediaType = 'other'
    row.changedFields = Object.keys(body)
    if (row.blockers.length) { row.status = 'blocked'; blocked += 1 }
    else if (!row.changedFields.length) { row.status = 'already_current'; alreadyCurrent += 1 }
    else if (apply) { await json(`${base}/api/works/${p.workId}?draft=true`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) }); row.status = 'patched'; patched += 1 }
    else { row.status = 'would_patch'; wouldPatch += 1 }
  } catch (e) { row.status = 'blocked'; row.blockers.push(String(e.message || e).slice(0, 200)); blocked += 1 }
  rows.push(row)
}
const outputs = { rows: `${OUT}/bangumi-book-other-fix-v01.rows.jsonl`, summary: `${OUT}/bangumi-book-other-fix-v01-summary.json` }
const summary = { version: 'bangumi-book-other-fix-v0.2', mode: apply ? 'apply' : 'dry-run', plansRead: plans.length, wouldPatch, patched, alreadyCurrent, blocked, byStatus: count(rows, 'status'), byChangedField: count(rows.flatMap((r) => r.changedFields), (x) => x), byBlocker: count(rows.flatMap((r) => r.blockers), (x) => x), safety: { payloadWrite: apply, fields: ['mediaGroup', 'mediaType'] }, outputs }
fs.writeFileSync(outputs.rows, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: blocked === 0, summary }, null, 2))
