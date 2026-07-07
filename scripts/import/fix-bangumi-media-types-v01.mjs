#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const INPUT = 'data_local/staging/work-source-metadata/bangumi-media-type-repair-v01-plans.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
const OK = 'apply-bangumi-media-type-v01'
const TARGETS = new Set(['anime', 'manga', 'novel', 'game'])

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
const apply = Boolean(args.apply)
if (apply && String(args.confirm || '') !== OK) throw new Error(`Need --apply --confirm ${OK}`)

const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
const secret = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
if (!email || !secret) throw new Error('Missing Payload login env vars')

function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').trim()
  return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : []
}
function clean(x) { return String(x ?? '').trim() }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return o }
async function json(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${res.status} ${url} ${text.slice(0, 300)}`)
  return data
}
const login = await json(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password: secret }) })
const token = login.token
const auth = { Authorization: `JWT ${token}` }

let plans = readJsonl(String(args.input || INPUT))
if (Number(args.limit || 0) > 0) plans = plans.slice(0, Number(args.limit))
const rows = []
let wouldPatch = 0, patched = 0, alreadyCurrent = 0, blocked = 0
for (const p of plans) {
  const row = { workId: p.workId, title: p.title, slug: p.slug, target: p.targetMediaGroup, status: '', changedFields: [], blockers: [] }
  try {
    const target = clean(p.targetMediaGroup)
    if (!TARGETS.has(target)) row.blockers.push('unsupported_target')
    const work = await json(`${base}/api/works/${p.workId}?depth=0&draft=true`, { headers: auth })
    const body = {}
    if (!row.blockers.length && clean(work.mediaGroup || 'unknown') !== target) body.mediaGroup = target
    if (!row.blockers.length && clean(work.mediaType || 'unknown') !== target) body.mediaType = target
    row.changedFields = Object.keys(body)
    if (row.blockers.length) { row.status = 'blocked'; blocked += 1 }
    else if (!row.changedFields.length) { row.status = 'already_current'; alreadyCurrent += 1 }
    else if (apply) { await json(`${base}/api/works/${p.workId}?draft=true`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) }); row.status = 'patched'; patched += 1 }
    else { row.status = 'would_patch'; wouldPatch += 1 }
  } catch (e) { row.status = 'blocked'; row.blockers.push(String(e.message || e).slice(0, 300)); blocked += 1 }
  rows.push(row)
}
const outputs = { rows: path.join(OUT, 'bangumi-media-type-fix-v01.rows.jsonl'), summary: path.join(OUT, 'bangumi-media-type-fix-v01-summary.json') }
const summary = { version: 'bangumi-media-type-fix-v0.1', mode: apply ? 'apply' : 'dry-run', plansRead: plans.length, wouldPatch, patched, alreadyCurrent, blocked, byStatus: count(rows, 'status'), byTarget: count(rows, 'target'), byChangedField: count(rows.flatMap((r) => r.changedFields), (x) => x), byBlocker: count(rows.flatMap((r) => r.blockers), (x) => x), safety: { payloadWrite: apply, fields: ['mediaGroup', 'mediaType'] }, outputs }
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(outputs.rows, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: blocked === 0, summary }, null, 2))
