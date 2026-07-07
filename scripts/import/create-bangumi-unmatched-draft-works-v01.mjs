#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'bangumi-unmatched-draft-works-create-v0.1'
const INPUT = 'data_local/staging/work-source-metadata/bangumi-unmatched-draft-works-v01-plans.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
const CONFIRM = 'create-bangumi-unmatched-draft-works-v01'
const TARGETS = new Set(['anime', 'manga', 'novel', 'game', 'other'])

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
const input = String(args.input || INPUT)
const apply = Boolean(args.apply)
if (apply && String(args.confirm || '') !== CONFIRM) throw new Error(`Need --apply --confirm ${CONFIRM}`)
const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
if (!email || !password) throw new Error('Missing Payload login env vars')

function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return o }
async function json(url, opt = {}) { const res = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } }); const text = await res.text(); const data = text ? JSON.parse(text) : null; if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`); return data }
function sourceLink(id) { return { label: 'Bangumi', url: `https://bgm.tv/subject/${id}` } }
function candidateSource(plan) { return { source: 'bangumi', label: `Bangumi:${plan.bangumiId}`, externalId: String(plan.bangumiId), url: `https://bgm.tv/subject/${plan.bangumiId}`, note: plan.sourceNote || 'Bangumi unmatched draft work' } }
async function findByBangumi(token, id) { const p = new URLSearchParams(); p.set('depth','0'); p.set('draft','true'); p.set('limit','2'); p.set('where[externalIds.bangumiSubjectId][equals]', String(id)); const r = await json(`${base}/api/works?${p}`, { headers: { Authorization: `JWT ${token}` } }); return Array.isArray(r?.docs) ? r.docs : [] }
async function findBySlug(token, slug) { const p = new URLSearchParams(); p.set('depth','0'); p.set('draft','true'); p.set('limit','2'); p.set('where[slug][equals]', String(slug)); const r = await json(`${base}/api/works?${p}`, { headers: { Authorization: `JWT ${token}` } }); return Array.isArray(r?.docs) ? r.docs : [] }
function localizedTitles(plan) { const arr = Array.isArray(plan.titles) ? plan.titles.map(clean).filter(Boolean) : []; return [...new Set(arr)].slice(0, 12).map((title) => ({ title, language: 'unknown', kind: title === clean(plan.title) ? 'original' : 'alias', source: 'Bangumi' })) }
function body(plan) { const target = clean(plan.targetMediaGroup || 'other'); return { title: clean(plan.title), slug: clean(plan.slug), rank: 'unknown', reviewStatus: 'pending', reviewReasons: Array.isArray(plan.reviewReasons) && plan.reviewReasons.length ? plan.reviewReasons : ['manual_review'], evidenceStrength: 'unassessed', mediaGroup: target, mediaType: clean(plan.targetMediaType || target), localizedTitles: localizedTitles(plan), externalIds: { bangumiSubjectId: String(plan.bangumiId) }, candidateSources: [candidateSource(plan)], sourceLinks: [sourceLink(plan.bangumiId)], importBatch: 'bangumi-unmatched-draft-v01', isLiteVisible: true, isFullVisible: false, _status: 'draft' } }

const login = await json(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
const token = login.token
const auth = { Authorization: `JWT ${token}` }
const plans = readJsonl(input)
const rows = []
let wouldCreate = 0, created = 0, alreadyExists = 0, blocked = 0
for (const plan of plans) {
  const row = { bangumiId: plan.bangumiId, title: plan.title, slug: plan.slug, target: plan.targetMediaGroup, status: '', createdId: null, blockers: [] }
  try {
    if (!clean(plan.bangumiId)) row.blockers.push('missing_bangumi_id')
    if (!clean(plan.title)) row.blockers.push('missing_title')
    if (!clean(plan.slug)) row.blockers.push('missing_slug')
    if (!TARGETS.has(clean(plan.targetMediaGroup))) row.blockers.push('unsupported_target')
    if (!row.blockers.length) {
      const byId = await findByBangumi(token, plan.bangumiId)
      if (byId.length) { row.status = 'already_exists'; row.createdId = byId[0]?.id || null; alreadyExists += 1; rows.push(row); continue }
      const bySlug = await findBySlug(token, plan.slug)
      if (bySlug.length) row.blockers.push('slug_already_exists')
    }
    if (row.blockers.length) { row.status = 'blocked'; blocked += 1 }
    else if (apply) { const doc = await json(`${base}/api/works?draft=true`, { method: 'POST', headers: auth, body: JSON.stringify(body(plan)) }); row.status = 'created'; row.createdId = doc?.doc?.id || doc?.id || null; created += 1 }
    else { row.status = 'would_create'; wouldCreate += 1 }
  } catch (e) { row.status = 'blocked'; row.blockers.push(String(e?.message || e).slice(0, 400)); blocked += 1 }
  rows.push(row)
}
const outputs = { rows: `${OUT}/bangumi-unmatched-draft-works-create-v01.rows.jsonl`, summary: `${OUT}/bangumi-unmatched-draft-works-create-v01-summary.json` }
const summary = { generatedAt: new Date().toISOString(), version: VERSION, mode: apply ? 'apply' : 'dry-run', plansRead: plans.length, wouldCreate, created, alreadyExists, blocked, byStatus: count(rows, 'status'), byTarget: count(rows, 'target'), byBlocker: count(rows.flatMap((r) => r.blockers), (x) => x), safety: { payloadWrite: apply, createsWorks: true, directPostgresqlWrite: false, fields: ['title','slug','rank','reviewStatus','reviewReasons','evidenceStrength','mediaGroup','mediaType','localizedTitles','externalIds','candidateSources','sourceLinks','importBatch','isLiteVisible','isFullVisible','_status'] }, outputs }
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(outputs.rows, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: blocked === 0, summary, outputs }, null, 2))
