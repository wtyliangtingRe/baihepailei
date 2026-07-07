#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'bangumi-credit-entities-create-v0.1'
const IN_DIR = 'data_local/staging/work-source-metadata'
const CREATOR_IN = `${IN_DIR}/bangumi-credit-entities-v01-creators.jsonl`
const ORG_IN = `${IN_DIR}/bangumi-credit-entities-v01-organizations.jsonl`
const OUT = IN_DIR
const CONFIRM = 'create-bangumi-credit-entities-v01'

function clean(v) { return String(v ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').replace(/\s+/g, ' ').trim() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return o }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { const v = argv[i]; if (!v.startsWith('--')) continue; const k = v.slice(2), n = argv[i + 1]; if (!n || n.startsWith('--')) out[k] = true; else { out[k] = n; i++ } } return out }
async function json(url, opt = {}) { const res = await fetch(url, { ...opt, headers:{ 'Content-Type':'application/json', ...(opt.headers || {}) } }); const text = await res.text(); const data = text ? JSON.parse(text) : null; if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`); return data }
async function findOne(base, token, collection, field, value) { const p = new URLSearchParams(); p.set('depth','0'); p.set('draft','true'); p.set('limit','2'); p.set(`where[${field}][equals]`, String(value)); const r = await json(`${base}/api/${collection}?${p}`, { headers:{ Authorization:`JWT ${token}` } }); return Array.isArray(r?.docs) ? r.docs : [] }
function creatorBody(p) { return { name:clean(p.name), slug:clean(p.slug), siteId:clean(p.siteId), rank:'unknown', aliases:[], searchText:clean(p.searchText), isLiteVisible:true, isFullVisible:false, status:'draft', _status:'draft' } }
function orgBody(p) { return { name:clean(p.name), slug:clean(p.slug), siteId:clean(p.siteId), type:clean(p.type || 'other'), aliases:[], sourceLinks:Array.isArray(p.sourceLinks) ? p.sourceLinks : [], searchText:clean(p.searchText), isLiteVisible:true, isFullVisible:false, status:'draft', _status:'draft' } }
async function processPlans(kind, collection, plans, base, token, auth, apply) {
  const rows = []
  let wouldCreate = 0, created = 0, alreadyExists = 0, blocked = 0
  for (const plan of plans) {
    const row = { kind, name:plan.name, slug:plan.slug, siteId:plan.siteId, status:'', entityId:null, blockers:[] }
    try {
      if (!clean(plan.name)) row.blockers.push('missing_name')
      if (!clean(plan.slug)) row.blockers.push('missing_slug')
      if (!clean(plan.siteId)) row.blockers.push('missing_siteId')
      if (!row.blockers.length) {
        const byName = await findOne(base, token, collection, 'name', plan.name)
        if (byName.length) { row.status = 'already_exists_by_name'; row.entityId = byName[0]?.id || null; alreadyExists += 1; rows.push(row); continue }
        const bySlug = await findOne(base, token, collection, 'slug', plan.slug)
        if (bySlug.length) { row.status = 'already_exists_by_slug'; row.entityId = bySlug[0]?.id || null; alreadyExists += 1; rows.push(row); continue }
        const bySiteId = await findOne(base, token, collection, 'siteId', plan.siteId)
        if (bySiteId.length) { row.status = 'already_exists_by_siteId'; row.entityId = bySiteId[0]?.id || null; alreadyExists += 1; rows.push(row); continue }
      }
      if (row.blockers.length) { row.status = 'blocked'; blocked += 1 }
      else if (apply) { const doc = await json(`${base}/api/${collection}?draft=true`, { method:'POST', headers:auth, body:JSON.stringify(kind === 'creator' ? creatorBody(plan) : orgBody(plan)) }); row.status = 'created'; row.entityId = doc?.doc?.id || doc?.id || null; created += 1 }
      else { row.status = 'would_create'; wouldCreate += 1 }
    } catch (e) { row.status = 'blocked'; row.blockers.push(String(e?.message || e).slice(0, 400)); blocked += 1 }
    rows.push(row)
  }
  return { rows, wouldCreate, created, alreadyExists, blocked }
}

const args = parseArgs(process.argv.slice(2))
const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
const apply = Boolean(args.apply)
if (apply && String(args.confirm || '') !== CONFIRM) throw new Error(`Need --apply --confirm ${CONFIRM}`)
const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
if (!email || !password) throw new Error('Missing Payload login env vars')
const creators = readJsonl(String(args.creators || CREATOR_IN))
const organizations = readJsonl(String(args.organizations || ORG_IN))
const login = await json(`${base}/api/users/login`, { method:'POST', body:JSON.stringify({ email, password }) })
const token = login.token
const auth = { Authorization:`JWT ${token}` }
const c = await processPlans('creator', 'creators', creators, base, token, auth, apply)
const o = await processPlans('organization', 'organizations', organizations, base, token, auth, apply)
const rows = [...c.rows, ...o.rows]
const outputs = { rows:`${OUT}/bangumi-credit-entities-create-v01.rows.jsonl`, summary:`${OUT}/bangumi-credit-entities-create-v01-summary.json` }
const summary = { generatedAt:new Date().toISOString(), version:VERSION, mode:apply?'apply':'dry-run', creatorPlans:creators.length, organizationPlans:organizations.length, wouldCreate:c.wouldCreate + o.wouldCreate, created:c.created + o.created, alreadyExists:c.alreadyExists + o.alreadyExists, blocked:c.blocked + o.blocked, creators:{ wouldCreate:c.wouldCreate, created:c.created, alreadyExists:c.alreadyExists, blocked:c.blocked }, organizations:{ wouldCreate:o.wouldCreate, created:o.created, alreadyExists:o.alreadyExists, blocked:o.blocked }, byStatus:count(rows, 'status'), byKind:count(rows, 'kind'), byBlocker:count(rows.flatMap((r)=>r.blockers), (x)=>x), outputs, safety:{ payloadWrite:apply, createsCollections:['creators','organizations'], directPostgresqlWrite:false, attachesToWorks:false } }
fs.mkdirSync(OUT, { recursive:true })
fs.writeFileSync(outputs.rows, rows.map((x)=>JSON.stringify(x)).join('\n') + (rows.length?'\n':''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: summary.blocked === 0, summary, outputs }, null, 2))
