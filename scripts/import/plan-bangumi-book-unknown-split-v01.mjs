#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'bangumi-book-unknown-split-plan-v0.1'
const INPUT = 'data_local/staging/work-source-metadata/bangumi-media-coverage-audit-v01.rows.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
const STATUSES = new Set(['external_id_matched', 'title_exact_unique'])

function clean(v) { return String(v ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').replace(/\s+/g, ' ').trim() }
function readJsonl(file) { const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))) }
function uniq(rows, key) { const s = new Set(); const out = []; for (const r of rows) { const k = key(r); if (!k || s.has(k)) continue; s.add(k); out.push(r) } return out }

function titleScore(text) {
  const t = clean(text).toLowerCase()
  let manga = 0, novel = 0
  if (/漫画|漫畫|コミック|まんが|manga|comic/.test(t)) manga += 3
  if (/小説|小说|小說|ノベル|novel|light novel|ライトノベル|文庫|bunko/.test(t)) novel += 3
  if (/第\d+巻|巻$|vol\.?\s*\d+/i.test(t)) manga += 1
  return { manga, novel }
}

function matchRows(row) {
  const matches = Array.isArray(row.matchedWorks) ? row.matchedWorks : []
  if (row.status === 'external_id_matched') return matches.filter((m) => clean(m.match) === 'external_id')
  if (row.status === 'title_exact_unique') return matches.filter((m) => clean(m.match) === 'title_exact')
  return []
}

function infer(row) {
  const titles = Array.isArray(row.titles) ? row.titles : []
  const matches = matchRows(row)
  const existingGroups = uniq(matches.map((m) => clean(m.mediaGroup || 'unknown')), (x) => x).filter((x) => ['manga','novel'].includes(x))
  let manga = 0, novel = 0
  for (const title of titles) { const s = titleScore(title); manga += s.manga; novel += s.novel }
  if (existingGroups.length === 1) {
    if (existingGroups[0] === 'manga') manga += 2
    if (existingGroups[0] === 'novel') novel += 2
  }
  const target = manga >= novel + 2 ? 'manga' : novel >= manga + 2 ? 'novel' : ''
  const confidence = target ? Math.abs(manga - novel) >= 4 ? 'high' : 'medium' : 'defer'
  return { target, confidence, mangaScore: manga, novelScore: novel, existingGroups }
}

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const input = String(args.input || INPUT)
const outDir = String(args['out-dir'] || OUT)
const rows = readJsonl(input)
const plans = []
const defer = []
const skipped = []
for (const row of rows) {
  if (clean(row.rawBucket) !== 'book_unknown') { skipped.push({ bangumiId: row.bangumiId, reason: 'not_book_unknown' }); continue }
  if (!STATUSES.has(row.status)) { skipped.push({ bangumiId: row.bangumiId, reason: 'unsupported_status', status: row.status }); continue }
  const matches = matchRows(row)
  if (!matches.length) { defer.push({ bangumiId: row.bangumiId, reason: 'no_selected_match', titles: row.titles }); continue }
  const inf = infer(row)
  const base = { bangumiId: row.bangumiId, status: row.status, titles: row.titles, targetMediaGroup: inf.target, targetMediaType: inf.target, confidence: inf.confidence, mangaScore: inf.mangaScore, novelScore: inf.novelScore, matchedWorks: matches.map((m) => ({ id: m.id, slug: m.slug, title: m.title, mediaGroup: m.mediaGroup, mediaType: m.mediaType, match: m.match })) }
  if (inf.target && inf.confidence === 'high') plans.push(base)
  else defer.push({ ...base, reason: 'low_or_no_confidence' })
}
const outputs = { plans: path.join(outDir, 'bangumi-book-unknown-split-v01-plans.jsonl'), defer: path.join(outDir, 'bangumi-book-unknown-split-v01-defer.jsonl'), skipped: path.join(outDir, 'bangumi-book-unknown-split-v01-skipped.jsonl'), summary: path.join(outDir, 'bangumi-book-unknown-split-v01-summary.json'), json: path.join(outDir, 'bangumi-book-unknown-split-v01.json') }
const summary = { generatedAt: new Date().toISOString(), version: VERSION, ok: true, inputFile: input, rowsRead: rows.length, plannedRawIds: plans.length, deferredRawIds: defer.length, skippedRows: skipped.length, byTarget: count(plans, 'targetMediaGroup'), byConfidence: count(plans, 'confidence'), byDeferReason: count(defer, 'reason'), bySkippedReason: count(skipped, 'reason'), outputs, safety: { readOnly: true, payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false } }
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputs.plans, plans.map((r) => JSON.stringify(r)).join('\n') + (plans.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.defer, defer.map((r) => JSON.stringify(r)).join('\n') + (defer.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.skipped, skipped.map((r) => JSON.stringify(r)).join('\n') + (skipped.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
fs.writeFileSync(outputs.json, JSON.stringify({ ok: true, summary, samples: { plans: plans.slice(0, 50), defer: defer.slice(0, 50) } }, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
