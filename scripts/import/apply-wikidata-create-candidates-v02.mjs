#!/usr/bin/env node
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const VERSION = 'wikidata-create-candidates-apply-v0.2'
const OUT_DIR = 'data_local/staging/wikidata-create-candidates'
const DEFAULT_INPUT = `${OUT_DIR}/wikidata-create-candidates-v01-ready.jsonl`
const BASE_SCRIPT = 'scripts/import/apply-wikidata-create-candidates-v01.mjs'

function val(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row?.[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function writeBlockedSummary(input, outDir, rows, apply, confirmMatched) {
  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    rows: `${outDir}/wikidata-create-candidates-apply-v01.rows.jsonl`,
    wouldCreate: `${outDir}/wikidata-create-candidates-apply-v01-would-create.jsonl`,
    created: `${outDir}/wikidata-create-candidates-apply-v01-created.jsonl`,
    blocked: `${outDir}/wikidata-create-candidates-apply-v01-blocked.jsonl`,
    summary: `${outDir}/wikidata-create-candidates-apply-v01-summary.json`,
  }
  const blockedRows = rows.map((row) => ({
    key: val(row.key),
    qid: val(row.qid),
    title: val(row?.payload?.title),
    createType: val(row.createType),
    mode: apply ? 'apply' : 'dry-run',
    status: 'blocked',
    blockers: ['manual_create_approval_missing'],
  }))
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry-run',
    input,
    planRowsRead: rows.length,
    planRowsProcessed: rows.length,
    wouldCreate: 0,
    created: 0,
    alreadyExists: 0,
    blocked: blockedRows.length,
    failed: 0,
    byStatus: { blocked: blockedRows.length },
    byCreateType: countBy(blockedRows, 'createType'),
    byBlocker: { manual_create_approval_missing: blockedRows.length },
    outputs,
    safety: {
      applyRequested: apply,
      confirmMatched,
      payloadRead: false,
      payloadWrite: false,
      payloadPostRequests: 0,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      requiresManualCreateAllowlist: true,
      inputMustBeReadyPlannerOutput: true,
    },
  }
  writeJsonl(outputs.rows, blockedRows)
  writeJsonl(outputs.wouldCreate, [])
  writeJsonl(outputs.created, [])
  writeJsonl(outputs.blocked, blockedRows)
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || OUT_DIR)
  const rows = readJsonl(input)
  const unapproved = rows.filter((row) => row.manualCreateApproved !== true)
  const apply = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === 'apply-wikidata-create-candidates-v01'

  if (unapproved.length) {
    writeBlockedSummary(input, outDir, unapproved, apply, confirmMatched)
    return
  }

  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...process.argv.slice(2)], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)

  const summaryPath = `${outDir}/wikidata-create-candidates-apply-v01-summary.json`
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
    summary.version = VERSION
    summary.baseApplyVersion = summary.baseApplyVersion || 'wikidata-create-candidates-apply-v0.1'
    summary.safety = {
      ...(summary.safety || {}),
      requiresManualCreateAllowlist: true,
      requiresManualCreateApprovedRows: true,
    }
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  }
}

main()
