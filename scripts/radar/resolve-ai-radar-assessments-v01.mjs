#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import { resolveRadarAssessment } from './lib/resolve-radar-assessment-v01.mjs'

const VERSION = 'ai-radar-assessment-resolve-v0.1'
const DEFAULT_INPUT = 'data_local/staging/ai-radar/ai-radar-raw-assessments-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar'

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

function readRows(file) {
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  if (/\.jsonl$/iu.test(file)) return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['rows', 'records', 'items', 'assessments', 'data']) {
    if (Array.isArray(parsed?.[key])) return parsed[key]
  }
  return [parsed]
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function countBy(rows, getter) {
  const out = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : val(value)
  return `"${text.replace(/"/gu, '""')}"`
}

function writeReviewCsv(file, rows) {
  const headers = [
    'workId',
    'siteId',
    'title',
    'currentGradeSuggestion',
    'decisiveRuleCode',
    'decisiveRuleLabel',
    'confidencePercent',
    'evidenceCoveragePercent',
    'evidenceStatus',
    'planStatus',
    'matchedRuleCodes',
    'blockers',
    'warnings',
  ]
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.workId,
      row.siteId,
      row.title,
      row.currentGradeSuggestion,
      row.decisiveRule?.code,
      row.decisiveRule?.label,
      row.confidencePercent,
      row.evidenceCoveragePercent,
      row.evidenceStatus,
      row.planStatus,
      list(row.matchedRules).map((item) => item.code),
      row.blockers,
      row.warnings,
    ].map(csvCell).join(','))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}

function buildSummary(rows, input, outputs, options) {
  const ready = rows.filter((row) => !row.planStatus.startsWith('blocked'))
  const blocked = rows.filter((row) => row.planStatus.startsWith('blocked'))
  return {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    policyVersion: rows[0]?.policyVersion || 'radar-rating-policy-v0.4-draft',
    input,
    rowsRead: rows.length,
    readyRows: ready.length,
    blockedRows: blocked.length,
    humanReviewRequiredRows: rows.filter((row) => row.requiresHumanReview).length,
    protectedRows: rows.filter((row) => row.writeProtection?.protected).length,
    syntheticUnclearFallbackRows: rows.filter((row) => list(row.matchedRules).some((item) => item.syntheticFallback)).length,
    byGrade: countBy(rows, (row) => row.currentGradeSuggestion),
    byDecisiveRule: countBy(rows, (row) => row.decisiveRule?.code),
    byPlanStatus: countBy(rows, (row) => row.planStatus),
    byEvidenceStatus: countBy(rows, (row) => row.evidenceStatus),
    byBlocker: countBy(rows.flatMap((row) => row.blockers || []), (item) => item),
    byWarning: countBy(rows.flatMap((row) => row.warnings || []), (item) => item),
    options,
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      autoPublishes: false,
      autoAssignsX: false,
      overwritesHumanVerified: false,
      preservesConflictingEvidence: true,
    },
    nextStep: 'Review the CSV and blocked rows. A separate guarded Payload patch planner/apply workflow is required before any database write.',
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = val(args.input) || DEFAULT_INPUT
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  const minimumMatchConfidence = args['minimum-match-confidence'] ?? 0.5
  const positiveCoverageThreshold = args['positive-coverage-threshold'] ?? 0.5
  const options = { minimumMatchConfidence, positiveCoverageThreshold }

  if (!fs.existsSync(input)) throw new Error(`Assessment input not found: ${input}`)
  const sourceRows = readRows(input)
  const rows = sourceRows.map((row) => resolveRadarAssessment(row, options))

  const outputs = {
    resolved: path.join(outDir, 'ai-radar-resolved-v01.jsonl'),
    ready: path.join(outDir, 'ai-radar-ready-v01.jsonl'),
    blocked: path.join(outDir, 'ai-radar-blocked-v01.jsonl'),
    lowConfidence: path.join(outDir, 'ai-radar-low-confidence-v01.jsonl'),
    conflicts: path.join(outDir, 'ai-radar-conflicts-v01.jsonl'),
    reviewCsv: path.join(outDir, 'ai-radar-review-v01.csv'),
    summary: path.join(outDir, 'ai-radar-resolve-v01-summary.json'),
  }

  const ready = rows.filter((row) => !row.planStatus.startsWith('blocked'))
  const blocked = rows.filter((row) => row.planStatus.startsWith('blocked'))
  const lowConfidence = rows.filter((row) => row.overallConfidence < 0.7 || row.evidenceCoverage < 0.3)
  const conflicts = rows.filter((row) => row.contradictions.length || row.evidenceStatus === 'conflicting_evidence')

  writeJsonl(outputs.resolved, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.lowConfidence, lowConfidence)
  writeJsonl(outputs.conflicts, conflicts)
  writeReviewCsv(outputs.reviewCsv, rows)

  const summary = buildSummary(rows, input, outputs, options)
  fs.mkdirSync(path.dirname(outputs.summary), { recursive: true })
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
