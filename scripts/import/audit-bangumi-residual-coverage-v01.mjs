#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const IN_DIR = 'data_local/staging/work-source-metadata'
const OUT_DIR = 'data_local/staging/work-source-metadata'
const VERSION = 'bangumi-residual-coverage-audit-v0.1'

function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null }
function readJsonl(file) { if (!fs.existsSync(file)) return []; const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((x) => JSON.parse(x)) : [] }
function count(rows, key) { const o = {}; for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key] || 'missing'; o[k] = (o[k] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))) }
function clean(v) { return String(v ?? '').trim() }

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const inDir = String(args['in-dir'] || IN_DIR)
const outDir = String(args['out-dir'] || OUT_DIR)
const auditSummary = readJson(path.join(inDir, 'bangumi-media-coverage-audit-v01-summary.json'))
const auditRows = readJsonl(path.join(inDir, 'bangumi-media-coverage-audit-v01.rows.jsonl'))
const mediaConflicts = readJsonl(path.join(inDir, 'bangumi-media-type-repair-v01-blocked.jsonl'))
const bookOtherSummary = readJson(path.join(inDir, 'bangumi-book-other-fix-v01-summary.json'))
const bookOtherRows = readJsonl(path.join(inDir, 'bangumi-book-other-fix-v01.rows.jsonl'))

const residualRows = []
for (const row of auditRows) {
  const status = clean(row.status)
  if (['unmatched', 'title_exact_multi', 'title_exact_unique'].includes(status)) residualRows.push({ kind: status, bangumiId: row.bangumiId, rawBucket: row.rawBucket, titles: row.titles, matchedWorks: row.matchedWorks || [] })
}
for (const row of mediaConflicts) residualRows.push({ kind: 'media_conflict', workId: row.workId, title: row.title, slug: row.slug, targets: row.targets, rows: row.rows })

const byStatus = auditSummary?.rawCoverageByStatus || count(auditRows, 'status')
const byRawBucket = count(auditRows, 'rawBucket')
const byResidualKind = count(residualRows, 'kind')
const byResidualBucket = count(residualRows, 'rawBucket')
const bookOtherPatched = bookOtherSummary?.patched || 0
const bookOtherCurrent = bookOtherSummary?.alreadyCurrent || 0
const outputs = {
  rows: path.join(outDir, 'bangumi-residual-coverage-v01.rows.jsonl'),
  summary: path.join(outDir, 'bangumi-residual-coverage-v01-summary.json'),
  markdown: path.join(outDir, 'bangumi-residual-coverage-v01.md'),
}
const nextActions = [
  { step: 'residual_title_exact_unique', count: byResidualKind.title_exact_unique || 0, action: 'prepare a guarded metadata plan for unique exact title matches not covered by the earlier v04 plan' },
  { step: 'unmatched_raw_subjects', count: byResidualKind.unmatched || 0, action: 'group into safe draft-work candidates vs blocked rows; no create without explicit apply' },
  { step: 'title_exact_multi', count: byResidualKind.title_exact_multi || 0, action: 'keep deferred until a disambiguation rule or another source resolves the match' },
  { step: 'media_conflict', count: byResidualKind.media_conflict || 0, action: 'keep deferred; may move only true unresolved items to other after review' },
]
const summary = {
  generatedAt: new Date().toISOString(),
  version: VERSION,
  ok: true,
  inputs: { auditSummary: Boolean(auditSummary), auditRows: auditRows.length, mediaConflicts: mediaConflicts.length, bookOtherRows: bookOtherRows.length },
  rawCoverageByStatus: byStatus,
  rawRowsByBucket: byRawBucket,
  residualRows: residualRows.length,
  byResidualKind,
  byResidualBucket,
  bookOther: { patched: bookOtherPatched, alreadyCurrent: bookOtherCurrent, rows: bookOtherRows.length },
  nextActions,
  outputs,
  safety: { readOnly: true, payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
}
const md = [
  '# Bangumi residual coverage v0.1', '',
  `- generatedAt: ${summary.generatedAt}`,
  `- raw unique ids: ${auditSummary?.bangumiUniqueIds ?? 'unknown'}`,
  `- external_id_matched: ${byStatus.external_id_matched || 0}`,
  `- title_exact_unique: ${byStatus.title_exact_unique || 0}`,
  `- title_exact_multi: ${byStatus.title_exact_multi || 0}`,
  `- unmatched: ${byStatus.unmatched || 0}`,
  `- book_other patched/current: ${bookOtherPatched}/${bookOtherCurrent}`,
  '', '## Residual kinds', '',
  ...Object.entries(byResidualKind).map(([k, v]) => `- ${k}: ${v}`),
  '', '## Next actions', '',
  ...nextActions.map((x) => `- ${x.step}: ${x.count} — ${x.action}`),
  '', '## Safety', '',
  '- Read-only report only.',
  '- No Payload write.',
  '- No direct PostgreSQL write.',
].join('\n')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputs.rows, residualRows.map((r) => JSON.stringify(r)).join('\n') + (residualRows.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
fs.writeFileSync(outputs.markdown, md, 'utf8')
console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
