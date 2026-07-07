#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'bangumi-conflict-split-works-plan-v0.1'
const INPUT = 'data_local/staging/work-source-metadata/bangumi-residual-title-exact-fix-v01.rows.jsonl'
const OUT = 'data_local/staging/work-source-metadata'
const TARGETS = new Set(['anime', 'manga', 'novel', 'game', 'other'])

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); return raw ? raw.split(/\r?\n/).map((line) => JSON.parse(line)) : [] }
function count(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row[key] || 'missing'; out[value] = (out[value] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))) }
function slugify(input) {
  const base = clean(input).toLowerCase()
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=,.;，。！？、（）()\[\]]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'bangumi-subject'
}
function blockersOf(row) { return Array.isArray(row.blockers) ? row.blockers.map(clean).filter(Boolean) : [] }
function isConflictSplitCandidate(row) {
  const blockers = blockersOf(row)
  return row.status === 'blocked' && blockers.includes('bangumi_id_conflict') && clean(row.bangumiId) && clean(row.title) && clean(row.workId)
}

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v.slice(2), a[i + 1]?.startsWith('--') ? true : a[i + 1] ?? true] : []).filter(Boolean))
const input = String(args.input || INPUT)
const outDir = String(args['out-dir'] || OUT)
const rows = readJsonl(input)
const plans = []
const blocked = []
const skipped = []
const seen = new Set()
for (const row of rows) {
  if (!isConflictSplitCandidate(row)) { skipped.push({ bangumiId: row.bangumiId, workId: row.workId, status: row.status, blockers: blockersOf(row), reason: 'not_conflict_split_candidate' }); continue }
  const target = clean(row.target || 'other')
  if (!TARGETS.has(target)) { blocked.push({ ...row, reason: 'unsupported_target' }); continue }
  const key = clean(row.bangumiId)
  if (seen.has(key)) { blocked.push({ ...row, reason: 'duplicate_bangumi_id_in_plan' }); continue }
  seen.add(key)
  const title = clean(row.title)
  const oldWorkId = clean(row.workId)
  plans.push({
    bangumiId: key,
    title,
    slug: `${slugify(title)}-bangumi-${key}`,
    targetMediaGroup: target,
    targetMediaType: target,
    oldWorkId,
    oldTitle: title,
    rawBucket: clean(row.rawBucket),
    reason: 'bangumi_id_conflict_split',
    reviewReasons: ['source_conflict', 'multi_source_or_variant'],
    sourceConflictNotes: `Split from old work ${oldWorkId}: residual Bangumi subject ${key} matched the same title but the existing work already has another Bangumi subject id. Created as a separate draft work for media/version review.`,
  })
}
const outputs = {
  plans: path.join(outDir, 'bangumi-conflict-split-works-v01-plans.jsonl'),
  blocked: path.join(outDir, 'bangumi-conflict-split-works-v01-blocked.jsonl'),
  skipped: path.join(outDir, 'bangumi-conflict-split-works-v01-skipped.jsonl'),
  summary: path.join(outDir, 'bangumi-conflict-split-works-v01-summary.json'),
}
const summary = {
  generatedAt: new Date().toISOString(),
  version: VERSION,
  ok: blocked.length === 0,
  inputFile: input,
  rowsRead: rows.length,
  plannedWorks: plans.length,
  blockedRows: blocked.length,
  skippedRows: skipped.length,
  byTarget: count(plans, 'targetMediaGroup'),
  byBlocker: count(blocked, 'reason'),
  bySkippedReason: count(skipped, 'reason'),
  outputs,
  safety: { readOnly: true, payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
}
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputs.plans, plans.map((row) => JSON.stringify(row)).join('\n') + (plans.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.blocked, blocked.map((row) => JSON.stringify(row)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.skipped, skipped.map((row) => JSON.stringify(row)).join('\n') + (skipped.length ? '\n' : ''), 'utf8')
fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
