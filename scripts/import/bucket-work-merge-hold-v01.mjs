#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-plan-v02-blocked.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const VERSION = 'work-merge-hold-bucket-v0.1'

const val = (v) => String(v ?? '').trim()

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]
    if (!k.startsWith('--')) continue
    const n = argv[i + 1]
    if (!n || n.startsWith('--')) args[k.slice(2)] = true
    else { args[k.slice(2)] = n; i += 1 }
  }
  return args
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    read += 1
    try { rows.push(JSON.parse(body)) } catch { failed += 1 }
  }
  return { rows, read, failed }
}

function arr(v) {
  return Array.isArray(v) ? v : v ? [v] : []
}

function reasonsOf(row) {
  return [
    ...arr(row.blockers),
    ...arr(row.reasons),
    ...arr(row.reviewReasons),
    ...arr(row.deferReasons),
    ...arr(row.autoReasons),
  ].map((x) => val(typeof x === 'string' ? x : x?.reason || x?.code || x?.type)).filter(Boolean)
}

function supplementsOf(row) {
  if (Array.isArray(row.supplements)) return row.supplements
  if (Array.isArray(row.supplementRows)) return row.supplementRows
  return row.supplement ? [row.supplement] : []
}

function classify(row) {
  const reasons = reasonsOf(row)
  const reasonText = reasons.join(' ').toLowerCase()
  const supplements = supplementsOf(row)
  const labels = []

  if (reasonText.includes('missing') || reasonText.includes('not_found')) labels.push('missing_record')
  if (reasonText.includes('conflict')) labels.push('id_conflict')
  if (supplements.length > 1 || reasonText.includes('multiple') || reasonText.includes('expected_one')) labels.push('multi_member')
  if (reasonText.includes('source')) labels.push('source_mismatch')
  if (reasonText.includes('title') || reasonText.includes('generic') || reasonText.includes('short')) labels.push('title_weak')
  if (reasonText.includes('visibility') || reasonText.includes('status')) labels.push('state_check')
  if (!labels.length) labels.push('other_hold')

  const primaryBucket = labels.includes('missing_record') ? 'missing_record'
    : labels.includes('id_conflict') ? 'id_conflict'
    : labels.includes('multi_member') ? 'multi_member'
    : labels.includes('source_mismatch') ? 'source_mismatch'
    : labels.includes('title_weak') ? 'title_weak'
    : labels.includes('state_check') ? 'state_check'
    : 'other_hold'

  return {
    mergeGroupId: val(row.mergeGroupId || row.groupId || row.id),
    bucket: primaryBucket,
    labels: [...new Set(labels)],
    reasons,
    master: row.master || row.canonical || row.base || null,
    supplementCount: supplements.length,
    supplements: supplements.slice(0, 10),
    safety: { localReportReadOnly: true, payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
  }
}

function countBy(list, fn) {
  const out = {}
  for (const x of list) {
    const k = val(typeof fn === 'function' ? fn(x) : x[fn]) || 'missing'
    out[k] = (out[k] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  if (!fs.existsSync(inputPath)) throw new Error(`input file not found: ${inputPath}\nUse --input <path> if needed.`)

  const input = await readJsonl(inputPath)
  const rows = input.rows.map(classify)
  const outputs = {
    rows: path.join(outDir, 'work-merge-hold-bucket-v01.rows.jsonl'),
    summary: path.join(outDir, 'work-merge-hold-bucket-v01-summary.json'),
    json: path.join(outDir, 'work-merge-hold-bucket-v01.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0,
    inputFile: inputPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    byBucket: countBy(rows, 'bucket'),
    byLabel: countBy(rows.flatMap((r) => r.labels), (x) => x),
    byReason: countBy(rows.flatMap((r) => r.reasons), (x) => x),
    outputs,
    safety: { localReportReadOnly: true, payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
  }
  const report = { ok: summary.ok, summary, samples: Object.fromEntries(Object.keys(summary.byBucket).map((k) => [k, rows.filter((r) => r.bucket === k).slice(0, 10)])) }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
