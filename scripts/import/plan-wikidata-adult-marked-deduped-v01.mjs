#!/usr/bin/env node
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const VERSION = 'wikidata-adult-marked-plan-v0.4'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-adult-marked'
const BASE_SCRIPT = 'scripts/import/plan-wikidata-adult-marked-v01.mjs'

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
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

function rowQid(row) {
  return val(row?.qid || row?.wikidataQid || row?.key).match(/^Q\d+$/iu)?.[0]?.toUpperCase() || ''
}

function rowWorkId(row) {
  return val(row?.work?.id || row?.workId || row?.matchedWork?.id || row?.rewriteCandidatePreview?.existingWorkId)
}

function dedupeKey(row) {
  const workId = rowWorkId(row)
  const qid = rowQid(row)
  if (workId || qid) return `${workId || 'no-work'}|${qid || 'no-qid'}`
  return val(row?.key) || JSON.stringify(row).slice(0, 500)
}

function betterRow(current, next) {
  if (!current) return next
  const currentReady = current.planStatus === 'ready_for_apply_review'
  const nextReady = next.planStatus === 'ready_for_apply_review'
  if (nextReady && !currentReady) return next
  if (list(next.blockers).length < list(current.blockers).length) return next
  return current
}

function dedupeRows(rows) {
  const byKey = new Map()
  const order = []
  for (const row of rows) {
    const key = dedupeKey(row)
    if (!byKey.has(key)) order.push(key)
    byKey.set(key, betterRow(byKey.get(key), row))
  }
  return order.map((key) => byKey.get(key)).filter(Boolean)
}

function recomputeSummary(summary, rows, outputs) {
  const ready = rows.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = rows.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const createCandidates = rows.filter((row) => row.action === 'adult_create_candidate_preview')
  const restricted = rows.filter((row) => row.contentVisibility === 'restricted')
  const changedFieldNames = rows.flatMap((row) => [
    ...Object.keys(row.fieldUpdates || {}),
    ...Object.entries(row.fieldAdditions || {})
      .filter(([, value]) => Array.isArray(value) ? value.length : Object.keys(value || {}).length)
      .map(([key]) => key),
  ])

  return {
    ...summary,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    basePlannerVersion: summary.version,
    inputRowsDedupedByBasePlanner: summary.inputRowsDeduped,
    inputRowsDeduped: rows.length,
    rowsProcessed: rows.length,
    readyRows: ready.length,
    blockedRows: blocked.length,
    createCandidateRows: createCandidates.length,
    restrictedRows: restricted.length,
    byAction: countBy(rows, 'action'),
    byPlanStatus: countBy(rows, 'planStatus'),
    byContentVisibility: countBy(rows, 'contentVisibility'),
    byContentAdvisory: countBy(rows.flatMap((row) => row.contentAdvisories), (item) => item),
    bySourceMarker: countBy(rows.flatMap((row) => row.work?.sourceMarkers || []), (item) => item),
    byBlocker: countBy(rows.flatMap((row) => row.blockers), (item) => item),
    byChangedField: countBy(changedFieldNames, (item) => item),
    outputs,
    safety: {
      ...(summary.safety || {}),
      dedupesAcrossInputFilesByWorkAndQid: true,
    },
    nextStep: 'Review v0.4 deduped outputs. Future guarded apply should process unique Work/QID rows only.',
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)

  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...process.argv.slice(2)], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)

  const outputs = {
    rows: `${outDir}/wikidata-adult-marked-v01.rows.jsonl`,
    ready: `${outDir}/wikidata-adult-marked-v01-ready.jsonl`,
    blocked: `${outDir}/wikidata-adult-marked-v01-blocked.jsonl`,
    createCandidates: `${outDir}/wikidata-adult-marked-v01-create-candidates.jsonl`,
    restricted: `${outDir}/wikidata-adult-marked-v01-restricted.jsonl`,
    sample: `${outDir}/wikidata-adult-marked-v01-sample.jsonl`,
    summary: `${outDir}/wikidata-adult-marked-v01-summary.json`,
  }
  const rows = dedupeRows(readJsonl(outputs.rows))
  const ready = rows.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = rows.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const createCandidates = rows.filter((row) => row.action === 'adult_create_candidate_preview')
  const restricted = rows.filter((row) => row.contentVisibility === 'restricted')
  const summary = fs.existsSync(outputs.summary) ? JSON.parse(fs.readFileSync(outputs.summary, 'utf8')) : {}
  const nextSummary = recomputeSummary(summary, rows, outputs)

  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.createCandidates, createCandidates)
  writeJsonl(outputs.restricted, restricted)
  writeJsonl(outputs.sample, [...ready.slice(0, 50), ...createCandidates.slice(0, 30), ...blocked.slice(0, 50)])
  fs.writeFileSync(outputs.summary, JSON.stringify(nextSummary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, deduped: true, summary: nextSummary, outputs }, null, 2))
}

main()
