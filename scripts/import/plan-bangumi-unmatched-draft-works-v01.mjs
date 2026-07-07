#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'bangumi-unmatched-draft-works-plan-v0.1'
const INPUT = 'data_local/staging/work-source-metadata/bangumi-media-coverage-audit-v01-unmatched.rows.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
const TARGETS = new Set(['anime', 'manga', 'novel', 'game', 'other'])

function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))) }
function titleOf(row) { const list = Array.isArray(row.titles) ? row.titles.map(clean).filter(Boolean) : []; return list[0] || clean(row.title) }
function targetOf(bucket) { const b = clean(bucket); if (['anime','manga','novel','game'].includes(b)) return b; if (b === 'book_unknown' || b === 'unknown') return 'other'; return '' }
function slugify(input) { const s = clean(input).toLowerCase().normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|#%&{}$!`'@+=,.;，。！？、（）()\[\]]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return s || 'bangumi-subject' }

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const input = String(args.input || INPUT)
const outDir = String(args['out-dir'] || OUT)
const rows = readJsonl(input)
const plans = []
const blocked = []
const skipped = []
const seen = new Set()
for (const row of rows) {
  const id = clean(row.bangumiId)
  const title = titleOf(row)
  const target = targetOf(row.rawBucket)
  if (clean(row.status) && clean(row.status) !== 'unmatched') { skipped.push({ bangumiId: id, reason: 'not_unmatched', status: row.status }); continue }
  if (!id) { blocked.push({ bangumiId: id, reason: 'missing_bangumi_id', row }); continue }
  if (!title) { blocked.push({ bangumiId: id, reason: 'missing_title', row }); continue }
  if (!TARGETS.has(target)) { blocked.push({ bangumiId: id, title, reason: 'unsupported_target', rawBucket: row.rawBucket }); continue }
  if (seen.has(id)) { blocked.push({ bangumiId: id, title, reason: 'duplicate_bangumi_id_in_input' }); continue }
  seen.add(id)
  plans.push({ bangumiId: id, title, slug: `${slugify(title)}-bangumi-${id}`, targetMediaGroup: target, targetMediaType: target, rawBucket: clean(row.rawBucket), titles: Array.isArray(row.titles) ? row.titles : [title], reason: 'bangumi_unmatched_draft', reviewReasons: ['manual_review'], sourceNote: 'Bangumi unmatched raw subject imported as a separate draft work for later review.' })
}
const outputs = { plans: path.join(outDir, 'bangumi-unmatched-draft-works-v01-plans.jsonl'), blocked: path.join(outDir, 'bangumi-unmatched-draft-works-v01-blocked.jsonl'), skipped: path.join(outDir, 'bangumi-unmatched-draft-works-v01-skipped.jsonl'), summary: path.join(outDir, 'bangumi-unmatched-draft-works-v01-summary.json') }
const summary = { generatedAt: new Date().toISOString(), version: VERSION, ok: blocked.length === 0, inputFile: input, rowsRead: rows.length, plannedWorks: plans.length, blockedRows: blocked.length, skippedRows: skipped.length, byTarget: count(plans, 'targetMediaGroup'), byBlocker: count(blocked, 'reason'), bySkippedReason: count(skipped, 'reason'), outputs, safety: { readOnly: true, payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false } }
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputs.plans, plans.map((r) => JSON.stringify(r)).join('\n') + (plans.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.blocked, blocked.map((r) => JSON.stringify(r)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.skipped, skipped.map((r) => JSON.stringify(r)).join('\n') + (skipped.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
