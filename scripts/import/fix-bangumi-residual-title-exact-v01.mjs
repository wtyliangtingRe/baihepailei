#!/usr/bin/env node
import fs from 'node:fs'

const INPUT = 'data_local/staging/work-source-metadata/bangumi-media-coverage-audit-v01.rows.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
const CONFIRM = 'apply-bangumi-residual-title-exact-v01'
const MEDIA = new Set(['anime', 'manga', 'novel', 'game', 'other'])

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
const input = String(args.input || INPUT)
const apply = Boolean(args.apply)
if (apply && String(args.confirm || '') !== CONFIRM) throw new Error(`Need --apply --confirm ${CONFIRM}`)
const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
if (!email || !password) throw new Error('Missing Payload login env vars')

function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim() }
function readJsonl(file) { const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return o }
async function json(url, opt = {}) { const res = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } }); const text = await res.text(); const data = text ? JSON.parse(text) : null; if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`); return data }
function targetFromBucket(bucket) { const b = clean(bucket); if (MEDIA.has(b)) return b; if (b === 'book_unknown' || b === 'unknown') return 'other'; return '' }
function sourceLink(id) { return { label: 'Bangumi', url: `https://bgm.tv/subject/${id}` } }
function sourceRow(id) { return { source: 'bangumi', label: `Bangumi:${id}`, externalId: String(id), url: `https://bgm.tv/subject/${id}`, note: 'residual title_exact_unique match' } }
function hasSourceLink(work, id) { return Array.isArray(work.sourceLinks) && work.sourceLinks.some((x) => clean(x.url) === `https://bgm.tv/subject/${id}`) }
function hasCandidate(work, id) { return Array.isArray(work.candidateSources) && work.candidateSources.some((x) => clean(x.source) === 'bangumi' && clean(x.externalId) === String(id)) }
function titleMatches(row, work) { const titles = Array.isArray(row.titles) ? row.titles.map(clean).filter(Boolean) : []; const title = clean(work.title); return titles.some((x) => x.toLowerCase() === title.toLowerCase()) }

const login = await json(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
const auth = { Authorization: `JWT ${login.token}` }
const auditRows = readJsonl(input).filter((r) => clean(r.status) === 'title_exact_unique')
const rows = []
let wouldPatch = 0, patched = 0, alreadyCurrent = 0, blocked = 0
for (const r of auditRows) {
  const match = (Array.isArray(r.matchedWorks) ? r.matchedWorks : []).find((w) => clean(w.match) === 'title_exact')
  const row = { bangumiId: r.bangumiId, rawBucket: r.rawBucket, workId: match?.id, title: match?.title, target: targetFromBucket(r.rawBucket), status: '', changedFields: [], blockers: [] }
  try {
    if (!match?.id) row.blockers.push('missing_title_exact_match')
    if (!row.target) row.blockers.push('unsupported_raw_bucket')
    const work = match?.id ? await json(`${base}/api/works/${match.id}?depth=0&draft=true`, { headers: auth }) : null
    if (work && !titleMatches(r, work)) row.blockers.push('title_no_longer_matches')
    const externalIds = { ...(work?.externalIds || {}) }
    if (externalIds.bangumiSubjectId && clean(externalIds.bangumiSubjectId) !== clean(r.bangumiId)) row.blockers.push('bangumi_id_conflict')
    const body = {}
    if (!row.blockers.length) {
      if (!externalIds.bangumiSubjectId) body.externalIds = { ...externalIds, bangumiSubjectId: String(r.bangumiId) }
      if (!hasCandidate(work, r.bangumiId)) body.candidateSources = [...(Array.isArray(work.candidateSources) ? work.candidateSources : []), sourceRow(r.bangumiId)]
      if (!hasSourceLink(work, r.bangumiId)) body.sourceLinks = [...(Array.isArray(work.sourceLinks) ? work.sourceLinks : []), sourceLink(r.bangumiId)]
      const group = clean(work.mediaGroup || 'unknown')
      const type = clean(work.mediaType || 'unknown')
      if ((group === 'unknown' || group === 'other') && group !== row.target) body.mediaGroup = row.target
      if ((type === 'unknown' || type === 'other') && type !== row.target) body.mediaType = row.target
    }
    row.changedFields = Object.keys(body)
    if (row.blockers.length) { row.status = 'blocked'; blocked += 1 }
    else if (!row.changedFields.length) { row.status = 'already_current'; alreadyCurrent += 1 }
    else if (apply) { await json(`${base}/api/works/${match.id}?draft=true`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) }); row.status = 'patched'; patched += 1 }
    else { row.status = 'would_patch'; wouldPatch += 1 }
  } catch (e) { row.status = 'blocked'; row.blockers.push(String(e.message || e).slice(0, 200)); blocked += 1 }
  rows.push(row)
}
const outputs = { rows: `${OUT}/bangumi-residual-title-exact-fix-v01.rows.jsonl`, summary: `${OUT}/bangumi-residual-title-exact-fix-v01-summary.json` }
const summary = { version: 'bangumi-residual-title-exact-fix-v0.1', mode: apply ? 'apply' : 'dry-run', plansRead: auditRows.length, wouldPatch, patched, alreadyCurrent, blocked, byStatus: count(rows, 'status'), byTarget: count(rows, 'target'), byChangedField: count(rows.flatMap((r) => r.changedFields), (x) => x), byBlocker: count(rows.flatMap((r) => r.blockers), (x) => x), safety: { payloadWrite: apply, fields: ['externalIds', 'candidateSources', 'sourceLinks', 'mediaGroup', 'mediaType'] }, outputs }
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(outputs.rows, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: blocked === 0, summary }, null, 2))
