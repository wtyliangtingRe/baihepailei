#!/usr/bin/env node
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const VERSION = 'wikidata-create-candidates-plan-v0.2'
const OUT_DIR = 'data_local/staging/wikidata-create-candidates'
const BASE_SCRIPT = 'scripts/import/plan-wikidata-create-candidates-v01.mjs'
const CJKISH = '[\\u3400-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff\\u31f0-\\u31ffー\\uac00-\\ud7af]'
const SEP = '[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+'
const SUSPICIOUS_RE = new RegExp(`${CJKISH}${SEP}${CJKISH}|${CJKISH}${SEP}[）》」』】、。！？：；,.!?]`, 'u')

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

function qidOf(row) {
  return val(row?.qid || row?.payload?.externalIds?.wikidataQid).toUpperCase()
}

function loadAllowlist(file) {
  const allowed = new Set()
  if (!file || file === true || !fs.existsSync(String(file))) return allowed
  const raw = fs.readFileSync(String(file), 'utf8')
  for (const line of raw.split(/\r?\n/u)) {
    const item = line.trim()
    if (!item || item.startsWith('#')) continue
    try {
      const parsed = JSON.parse(item)
      for (const value of [parsed.qid, parsed.key, parsed.wikidataQid, parsed?.payload?.externalIds?.wikidataQid]) {
        const qid = val(value).toUpperCase()
        if (/^Q\d+$/u.test(qid)) allowed.add(qid)
      }
    } catch {
      const qid = item.match(/Q\d+/iu)?.[0]?.toUpperCase()
      if (qid) allowed.add(qid)
    }
  }
  return allowed
}

function outputValues(row) {
  const payload = row?.payload || {}
  return [
    payload.title,
    payload.originalTitle,
    ...(val(payload.searchText) ? val(payload.searchText).split(/[\r\n|]+/u) : []),
    ...list(row.titleCandidates),
  ].map((item) => String(item ?? '')).filter(Boolean)
}

function hasSuspiciousOutputSpacing(row) {
  return outputValues(row).some((item) => SUSPICIOUS_RE.test(item) || /^\s|\s$/u.test(item))
}

function postProcessRow(row, allowlist) {
  const next = { ...row }
  const blockers = new Set(list(row.blockers).map(val).filter(Boolean))
  const qid = qidOf(row)
  const approved = Boolean(qid && allowlist.has(qid))

  if (hasSuspiciousOutputSpacing(row)) blockers.add('suspicious_title_spacing_in_final_payload')
  if (!approved) blockers.add('manual_create_allowlist_required')

  next.manualCreateApproved = approved
  next.blockers = [...blockers]
  next.planStatus = next.blockers.length ? 'blocked_or_review_required' : 'ready_for_create_dry_run'
  next.safety = {
    ...(next.safety || {}),
    payloadWrite: false,
    createsWorks: false,
    requiresManualCreateAllowlist: true,
    blocksSuspiciousTitleSpacingInFinalPayload: true,
  }
  return next
}

function recomputeSummary(summary, rows, outputs, allowlistPath, allowlist) {
  const ready = rows.filter((row) => row.planStatus === 'ready_for_create_dry_run')
  const blocked = rows.filter((row) => row.planStatus !== 'ready_for_create_dry_run')
  return {
    ...summary,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    basePlannerVersion: summary.version,
    readyRows: ready.length,
    blockedRows: blocked.length,
    byCreateType: countBy(rows, 'createType'),
    byAction: countBy(rows, 'action'),
    byPlanStatus: countBy(rows, 'planStatus'),
    byContentVisibility: countBy(rows, 'contentVisibility'),
    byContentAdvisory: countBy(rows.flatMap((row) => list(row.contentAdvisories)), (item) => item),
    byBlocker: countBy(rows.flatMap((row) => list(row.blockers)), (item) => item),
    byWarning: countBy(rows.flatMap((row) => list(row.warnings)), (item) => item),
    manualAllowlist: allowlistPath || null,
    manualAllowlistQids: allowlist.size,
    outputs,
    safety: {
      ...(summary.safety || {}),
      payloadWrite: false,
      createsWorks: false,
      requiresManualCreateAllowlist: true,
      blocksSuspiciousTitleSpacingInFinalPayload: true,
      applyWithoutAllowlistExpectedCreates: 0,
    },
    nextStep: 'Review blocked/manual candidates. Add explicit QIDs to an allowlist only after manual review, then rerun planner with --allowlist <file>.',
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = String(args['out-dir'] || OUT_DIR)
  const allowlistPath = args.allowlist ? String(args.allowlist) : ''
  const allowlist = loadAllowlist(allowlistPath)

  const baseArgs = process.argv.slice(2).filter((arg, index, all) => {
    if (arg === '--allowlist') return false
    if (index > 0 && all[index - 1] === '--allowlist') return false
    return true
  })
  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...baseArgs], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)

  const outputs = {
    rows: `${outDir}/wikidata-create-candidates-v01.rows.jsonl`,
    ready: `${outDir}/wikidata-create-candidates-v01-ready.jsonl`,
    blocked: `${outDir}/wikidata-create-candidates-v01-blocked.jsonl`,
    ordinaryReady: `${outDir}/wikidata-create-candidates-v01-ordinary-ready.jsonl`,
    adultReady: `${outDir}/wikidata-create-candidates-v01-adult-ready.jsonl`,
    sample: `${outDir}/wikidata-create-candidates-v01-sample.jsonl`,
    summary: `${outDir}/wikidata-create-candidates-v01-summary.json`,
  }

  const rows = readJsonl(outputs.rows).map((row) => postProcessRow(row, allowlist))
  const ready = rows.filter((row) => row.planStatus === 'ready_for_create_dry_run')
  const blocked = rows.filter((row) => row.planStatus !== 'ready_for_create_dry_run')
  const summary = fs.existsSync(outputs.summary) ? JSON.parse(fs.readFileSync(outputs.summary, 'utf8')) : {}
  const nextSummary = recomputeSummary(summary, rows, outputs, allowlistPath, allowlist)

  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.ordinaryReady, ready.filter((row) => row.createType === 'ordinary'))
  writeJsonl(outputs.adultReady, ready.filter((row) => row.createType === 'adult'))
  writeJsonl(outputs.sample, [...ready.slice(0, 80), ...blocked.slice(0, 80)])
  fs.writeFileSync(outputs.summary, JSON.stringify(nextSummary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary: nextSummary, outputs }, null, 2))
}

main()
