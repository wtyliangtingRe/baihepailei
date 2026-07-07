#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const INPUT = 'data_local/staging/work-source-metadata/bangumi-book-unknown-split-v01-defer.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
function clean(v) { return String(v ?? '').trim() }
function readJsonl(file) { const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return o }
function selectedWorks(row) { return Array.isArray(row.matchedWorks) ? row.matchedWorks : [] }
const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const input = String(args.input || INPUT)
const outDir = String(args['out-dir'] || OUT)
const rows = readJsonl(input)
const plans = []
const skipped = []
for (const row of rows) {
  const works = selectedWorks(row)
  for (const work of works) {
    const group = clean(work.mediaGroup || 'unknown')
    const type = clean(work.mediaType || 'unknown')
    if (group !== 'unknown' && type !== 'unknown') { skipped.push({ bangumiId: row.bangumiId, workId: work.id, reason: 'already_classified', mediaGroup: group, mediaType: type }); continue }
    plans.push({ workId: work.id, slug: work.slug, title: work.title, bangumiId: row.bangumiId, targetMediaGroup: 'other', targetMediaType: 'other', reason: 'bangumi_book_unknown_unresolved', sourceStatus: row.status, currentMediaGroup: group, currentMediaType: type })
  }
}
const outputs = { plans: path.join(outDir, 'bangumi-book-unknown-other-v01-plans.jsonl'), skipped: path.join(outDir, 'bangumi-book-unknown-other-v01-skipped.jsonl'), summary: path.join(outDir, 'bangumi-book-unknown-other-v01-summary.json') }
const summary = { version: 'bangumi-book-unknown-other-plan-v0.2', inputFile: input, rowsRead: rows.length, plannedWorks: plans.length, skippedRows: skipped.length, byTarget: count(plans, 'targetMediaGroup'), bySkippedReason: count(skipped, 'reason'), safety: { readOnly: true, payloadWrite: false, dataChanged: false }, outputs }
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputs.plans, plans.map((r) => JSON.stringify(r)).join('\n') + (plans.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.skipped, skipped.map((r) => JSON.stringify(r)).join('\n') + (skipped.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, summary }, null, 2))
