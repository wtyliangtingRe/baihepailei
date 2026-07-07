#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'bangumi-conflict-split-works-create-v0.1'
const INPUT = 'data_local/staging/work-source-metadata/bangumi-conflict-split-works-v01-plans.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
const CONFIRM = 'create-bangumi-conflict-split-works-v01'
const TARGETS = new Set(['anime', 'manga', 'novel', 'game', 'other'])

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
const input = String(args.input || INPUT)
const apply = Boolean(args.apply)
if (apply && String(args.confirm || '') !== CONFIRM) throw new Error(`Need --apply --confirm ${CONFIRM}`)
const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
if (!email || !password) throw new Error('Missing Payload login env vars')

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((line) => JSON.parse(line)) : [] }
function count(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row[key] || 'missing'; out[value] = (out[value] || 0) + 1 } return out }
async function json(url, opt = {}) { const res = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } }); const text = await res.text(); const data = text ? JSON.parse(text) : null; if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`); return data }
function sourceLink(id) { return { label: 'Bangumi', url: `https://bgm.tv/subject/${id}` } }
function candidateSource(plan) { return { source: 'bangumi', label: `Bangumi:${plan.bangumiId}`, externalId: String(plan.bangumiId), url: `https://bgm.tv/subject/${plan.bangumiId}`, note: `conflict split from work ${plan.oldWorkId}` } }
async function findExistingByBangumi(token, id) {
  const params = new URLSearchParams()
  params.set('depth', '0')
  params.set('draft', 'true')
  params.set('limit', '2')
  params.set('where[externalIds.bangumiSubjectId][equals]', String(id))
  const result = await json(`${base}/api/works?${params.toString()}`, { headers: { Authorization: `JWT ${token}` } })
  return Array.isArray(result?.docs) ? result.docs : []
}
async function findExistingBySlug(token, slug) {
  const params = new URLSearchParams()
  params.set('depth', '0')
  params.set('draft', 'true')
  params.set('limit', '2')
  params.set('where[slug][equals]', String(slug))
  const result = await json(`${base}/api/works?${params.toString()}`, { headers: { Authorization: `JWT ${token}` } })
  return Array.isArray(result?.docs) ? result.docs : []
}
function buildBody(plan) {
  const target = clean(plan.targetMediaGroup || 'other')
  return {
    title: clean(plan.title),
    slug: clean(plan.slug),
    rank: 'unknown',
    reviewStatus: 'pending',
    reviewReasons: Array.isArray(plan.reviewReasons) && plan.reviewReasons.length ? plan.reviewReasons : ['source_conflict', 'multi_source_or_variant'],
    sourceConflictNotes: clean(plan.sourceConflictNotes),
    evidenceStrength: 'unassessed',
    mediaGroup: target,
    mediaType: clean(plan.targetMediaType || target),
    externalIds: { bangumiSubjectId: String(plan.bangumiId) },
    candidateSources: [candidateSource(plan)],
    sourceLinks: [sourceLink(plan.bangumiId)],
    importBatch: 'bangumi-conflict-split-v01',
    isLiteVisible: true,
    isFullVisible: false,
    _status: 'draft',
  }
}

const login = await json(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
const token = login.token
const auth = { Authorization: `JWT ${token}` }
const plans = readJsonl(input)
const rows = []
let wouldCreate = 0, created = 0, alreadyExists = 0, blocked = 0
for (const plan of plans) {
  const row = { bangumiId: plan.bangumiId, title: plan.title, slug: plan.slug, target: plan.targetMediaGroup, oldWorkId: plan.oldWorkId, status: '', createdId: null, blockers: [] }
  try {
    if (!clean(plan.bangumiId)) row.blockers.push('missing_bangumi_id')
    if (!clean(plan.title)) row.blockers.push('missing_title')
    if (!clean(plan.slug)) row.blockers.push('missing_slug')
    if (!TARGETS.has(clean(plan.targetMediaGroup))) row.blockers.push('unsupported_target')
    if (!row.blockers.length) {
      const existingByBangumi = await findExistingByBangumi(token, plan.bangumiId)
      if (existingByBangumi.length) {
        row.status = 'already_exists'
        row.createdId = existingByBangumi[0]?.id || null
        alreadyExists += 1
        rows.push(row)
        continue
      }
      const existingBySlug = await findExistingBySlug(token, plan.slug)
      if (existingBySlug.length) row.blockers.push('slug_already_exists')
    }
    if (row.blockers.length) { row.status = 'blocked'; blocked += 1 }
    else if (apply) {
      const createdDoc = await json(`${base}/api/works?draft=true`, { method: 'POST', headers: auth, body: JSON.stringify(buildBody(plan)) })
      row.status = 'created'
      row.createdId = createdDoc?.doc?.id || createdDoc?.id || null
      created += 1
    } else {
      row.status = 'would_create'
      wouldCreate += 1
    }
  } catch (error) {
    row.status = 'blocked'
    row.blockers.push(String(error?.message || error).slice(0, 400))
    blocked += 1
  }
  rows.push(row)
}
const outputs = { rows: `${OUT}/bangumi-conflict-split-works-create-v01.rows.jsonl`, summary: `${OUT}/bangumi-conflict-split-works-create-v01-summary.json` }
const summary = { generatedAt: new Date().toISOString(), version: VERSION, mode: apply ? 'apply' : 'dry-run', plansRead: plans.length, wouldCreate, created, alreadyExists, blocked, byStatus: count(rows, 'status'), byTarget: count(rows, 'target'), byBlocker: count(rows.flatMap((r) => r.blockers), (x) => x), safety: { payloadWrite: apply, createsWorks: true, directPostgresqlWrite: false, fields: ['title','slug','rank','reviewStatus','reviewReasons','sourceConflictNotes','evidenceStrength','mediaGroup','mediaType','externalIds','candidateSources','sourceLinks','importBatch','isLiteVisible','isFullVisible','_status'] }, outputs }
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(outputs.rows, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: blocked === 0, summary, outputs }, null, 2))
