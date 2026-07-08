#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const VERSION = 'vndb-work-integration-plan-guard-v0.3'
const BASE_SCRIPT = 'scripts/import/plan-vndb-work-integration-v02.mjs'
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-work-integration'
const SENSITIVE_BLOCKER = 'vndb_sensitive_content_requires_separate_review'
const ADULT_BLOCKER = 'vndb_adult_content_requires_separate_review'
const VIOLENCE_BLOCKER = 'vndb_violent_content_requires_separate_review'
const SUGGESTIVE_BLOCKER = 'vndb_suggestive_content_requires_separate_review'

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
  fs.mkdirSync(path.dirname(file), { recursive: true })
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

function unique(values) {
  return [...new Set((values || []).filter(Boolean))]
}

function sensitiveBlockers(row) {
  const warnings = list(row?.warnings).map(val).filter(Boolean)
  const blockers = []
  if (warnings.some((item) => item === 'adultOrMarkedContent=true' || item === 'contentVisibility=adult' || item === 'contentRating=erotica')) {
    blockers.push(ADULT_BLOCKER)
  }
  if (warnings.some((item) => item === 'contentRating=suggestive')) blockers.push(SUGGESTIVE_BLOCKER)
  if (warnings.some((item) => item.startsWith('contentWarning=violence:'))) blockers.push(VIOLENCE_BLOCKER)
  if (blockers.length) blockers.unshift(SENSITIVE_BLOCKER)
  return unique(blockers)
}

function maybeGuard(row) {
  if (row?.planStatus !== 'ready_for_apply_review') return row
  const blockers = sensitiveBlockers(row)
  if (!blockers.length) return row
  return {
    ...row,
    planStatus: 'blocked_or_review_required',
    confidence: 'manual_review',
    blockers: unique([...(row.blockers || []), ...blockers]),
    guard: {
      ...(row.guard || {}),
      version: VERSION,
      reason: 'VNDB sensitive/adult/suggestive/violent rows are excluded from automatic apply until a dedicated content-visibility flow writes advisory fields safely.',
    },
  }
}

function rebuildSummary(summary, plans, outDir) {
  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const createCandidates = plans.filter((row) => row.action === 'vndb_create_candidate_preview')
  const changedFieldNames = plans.flatMap((row) => [
    ...Object.keys(row.fieldUpdates || {}),
    ...Object.entries(row.fieldAdditions || {})
      .filter(([, value]) => Array.isArray(value) ? value.length : Object.keys(value || {}).length)
      .map(([key]) => key),
  ])
  return {
    ...summary,
    generatedAt: new Date().toISOString(),
    version: `${summary?.version || 'vndb-work-integration-plan'}+${VERSION}`,
    readyRows: ready.length,
    blockedRows: blocked.length,
    createCandidateRows: createCandidates.length,
    byAction: countBy(plans, 'action'),
    byPlanStatus: countBy(plans, 'planStatus'),
    byMatchBy: countBy(plans, 'matchBy'),
    byBlocker: countBy(plans.flatMap((row) => row.blockers), (item) => item),
    byWarning: countBy(plans.flatMap((row) => row.warnings), (item) => item),
    byChangedField: countBy(changedFieldNames, (item) => item),
    outputs: {
      rows: `${outDir}/vndb-work-integration-v01.rows.jsonl`,
      ready: `${outDir}/vndb-work-integration-v01-ready.jsonl`,
      blocked: `${outDir}/vndb-work-integration-v01-blocked.jsonl`,
      createCandidates: `${outDir}/vndb-work-integration-v01-create-candidates.jsonl`,
      sample: `${outDir}/vndb-work-integration-v01-sample.jsonl`,
      summary: `${outDir}/vndb-work-integration-v01-summary.json`,
    },
    guard: {
      version: VERSION,
      sensitiveRowsExcludedFromReady: plans.filter((row) => list(row.blockers).includes(SENSITIVE_BLOCKER)).length,
      adultRowsExcludedFromReady: plans.filter((row) => list(row.blockers).includes(ADULT_BLOCKER)).length,
      suggestiveRowsExcludedFromReady: plans.filter((row) => list(row.blockers).includes(SUGGESTIVE_BLOCKER)).length,
      violentRowsExcludedFromReady: plans.filter((row) => list(row.blockers).includes(VIOLENCE_BLOCKER)).length,
      blocker: SENSITIVE_BLOCKER,
    },
    nextStep: 'Review guarded ready/blocked samples, then run guarded apply dry-run. Sensitive VNDB rows require a separate content-visibility flow before apply.',
  }
}

function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)

  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...argv], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)

  const rowsFile = `${outDir}/vndb-work-integration-v01.rows.jsonl`
  const summaryFile = `${outDir}/vndb-work-integration-v01-summary.json`
  const plans = readJsonl(rowsFile).map(maybeGuard)
  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_apply_review')
  const createCandidates = plans.filter((row) => row.action === 'vndb_create_candidate_preview')
  const oldSummary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : {}
  const summary = rebuildSummary(oldSummary, plans, outDir)

  writeJsonl(rowsFile, plans)
  writeJsonl(`${outDir}/vndb-work-integration-v01-ready.jsonl`, ready)
  writeJsonl(`${outDir}/vndb-work-integration-v01-blocked.jsonl`, blocked)
  writeJsonl(`${outDir}/vndb-work-integration-v01-create-candidates.jsonl`, createCandidates)
  writeJsonl(`${outDir}/vndb-work-integration-v01-sample.jsonl`, [...ready.slice(0, 80), ...createCandidates.slice(0, 50), ...blocked.slice(0, 80)])
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, guardApplied: summary.guard }, null, 2))
}

main()
