#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const VERSION = 'vndb-work-integration-apply-preflight-v0.3'
const BASE_SCRIPT = 'scripts/import/apply-vndb-work-integration-v01.mjs'
const DEFAULT_INPUT = 'data_local/staging/vndb-work-integration/vndb-work-integration-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-work-integration'
const SAFE_INPUT = 'data_local/staging/vndb-work-integration/vndb-work-integration-v01-ready-apply-safe.jsonl'
const PREFLIGHT_BLOCKED = 'data_local/staging/vndb-work-integration/vndb-work-integration-apply-v01-preflight-blocked.jsonl'
const PREFLIGHT_SKIPPED = 'data_local/staging/vndb-work-integration/vndb-work-integration-apply-v01-preflight-skipped-idempotent.jsonl'
const PREFLIGHT_SUMMARY = 'data_local/staging/vndb-work-integration/vndb-work-integration-apply-v01-preflight-summary.json'
const SENSITIVE_BLOCKER = 'vndb_sensitive_content_requires_separate_review'
const ADULT_BLOCKER = 'vndb_adult_content_requires_separate_review'
const VIOLENCE_BLOCKER = 'vndb_violent_content_requires_separate_review'
const SUGGESTIVE_BLOCKER = 'vndb_suggestive_content_requires_separate_review'
const IDEMPOTENT_SKIP_REASON = 'vndb_description_already_written_to_summary_skip_hidden_duplicate'

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

function stripInputArgs(argv) {
  const out = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') {
      i += 1
      continue
    }
    out.push(argv[i])
  }
  return out
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
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
  const blockers = [...list(row?.blockers).map(val).filter(Boolean)]
  if (warnings.some((item) => item === 'adultOrMarkedContent=true' || item === 'contentVisibility=adult' || item === 'contentRating=erotica')) blockers.push(ADULT_BLOCKER)
  if (warnings.some((item) => item === 'contentRating=suggestive')) blockers.push(SUGGESTIVE_BLOCKER)
  if (warnings.some((item) => item.startsWith('contentWarning=violence:'))) blockers.push(VIOLENCE_BLOCKER)
  if (blockers.some((item) => item === ADULT_BLOCKER || item === SUGGESTIVE_BLOCKER || item === VIOLENCE_BLOCKER)) blockers.push(SENSITIVE_BLOCKER)
  return unique(blockers)
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []
}

function isIdempotentHiddenDescriptionDuplicate(row) {
  const markers = list(row?.work?.sourceMarkers)
  const updates = row?.fieldUpdates || {}
  const additions = row?.fieldAdditions || {}
  const updateKeys = objectKeys(updates)
  const externalIdKeys = objectKeys(additions.externalIds)
  const searchTextAdditions = list(additions.searchTextAdditions)
  if (row?.matchBy !== 'vndbId') return false
  if (!markers.includes('vndb')) return false
  if (!updates.evidenceNote) return false
  if (updateKeys.some((key) => key !== 'evidenceNote')) return false
  if (externalIdKeys.length) return false
  if (searchTextAdditions.length) return false
  return true
}

function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const safeInput = outDir === DEFAULT_OUT_DIR ? SAFE_INPUT : `${outDir}/vndb-work-integration-v01-ready-apply-safe.jsonl`
  const preflightBlocked = outDir === DEFAULT_OUT_DIR ? PREFLIGHT_BLOCKED : `${outDir}/vndb-work-integration-apply-v01-preflight-blocked.jsonl`
  const preflightSkipped = outDir === DEFAULT_OUT_DIR ? PREFLIGHT_SKIPPED : `${outDir}/vndb-work-integration-apply-v01-preflight-skipped-idempotent.jsonl`
  const preflightSummary = outDir === DEFAULT_OUT_DIR ? PREFLIGHT_SUMMARY : `${outDir}/vndb-work-integration-apply-v01-preflight-summary.json`

  const rows = readJsonl(input)
  const safe = []
  const blocked = []
  const skipped = []
  for (const row of rows) {
    const blockers = sensitiveBlockers(row)
    if (blockers.length) blocked.push({ ...row, preflightBlockers: blockers, planStatus: 'blocked_or_review_required' })
    else if (isIdempotentHiddenDescriptionDuplicate(row)) skipped.push({ ...row, preflightSkipReason: IDEMPOTENT_SKIP_REASON })
    else safe.push(row)
  }
  writeJsonl(safeInput, safe)
  writeJsonl(preflightBlocked, blocked)
  writeJsonl(preflightSkipped, skipped)
  fs.writeFileSync(preflightSummary, JSON.stringify({
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    safeInput,
    rowsRead: rows.length,
    rowsSafeForBaseApply: safe.length,
    rowsBlockedByPreflight: blocked.length,
    rowsSkippedAsIdempotent: skipped.length,
    byPreflightBlocker: countBy(blocked.flatMap((row) => row.preflightBlockers), (item) => item),
    bySkipReason: countBy(skipped, 'preflightSkipReason'),
    note: 'Sensitive rows are excluded from base apply. VNDB rows whose description was already written to summary are skipped instead of appending the same text again to evidenceNote on the next run.',
  }, null, 2), 'utf8')
  console.log(JSON.stringify({
    ok: true,
    preflight: {
      rowsRead: rows.length,
      rowsSafeForBaseApply: safe.length,
      rowsBlockedByPreflight: blocked.length,
      rowsSkippedAsIdempotent: skipped.length,
      preflightSummary,
    },
  }, null, 2))

  const nextArgs = [...stripInputArgs(argv), '--input', safeInput]
  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...nextArgs], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)
}

main()
