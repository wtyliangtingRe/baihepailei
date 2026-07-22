#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import { resolveRadarAssessment } from './lib/resolve-radar-assessment-v01.mjs'

const VERSION = 'ai-radar-calibrated-assessment-resolve-v0.1'
const DEFAULT_INPUT = 'data_local/staging/ai-radar/calibrated-assessment-handoffs-v01/raw-assessments.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/calibrated-assessment-resolved-v01'

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}
function readRows(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  if (/\.jsonl$/iu.test(file)) return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['rows', 'records', 'items', 'assessments', 'data']) if (Array.isArray(parsed?.[key])) return parsed[key]
  return [parsed]
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}
function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : val(value)
  return `"${text.replace(/"/gu, '""')}"`
}
function countBy(rows, getter) {
  const output = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    output[key] = (output[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(output).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])))
}
function writeReviewCsv(file, rows) {
  const headers = [
    'workId', 'siteId', 'title', 'currentGradeSuggestion', 'decisiveRuleCode',
    'confidencePercent', 'evidenceCoveragePercent', 'evidenceStatus', 'planStatus',
    'calibrationProfileId', 'calibrationSignalIds', 'calibrationNotes',
    'matchedRuleCodes', 'blockers', 'warnings',
  ]
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.workId,
      row.siteId,
      row.title,
      row.currentGradeSuggestion,
      row.decisiveRule?.code,
      row.confidencePercent,
      row.evidenceCoveragePercent,
      row.evidenceStatus,
      row.planStatus,
      row.calibration?.profileId,
      list(row.calibration?.signals).map((item) => `${val(item?.type)}:${val(item?.id)}`),
      row.calibration?.notes,
      list(row.matchedRules).map((item) => item.code),
      row.blockers,
      row.warnings,
    ].map(csvCell).join(','))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('Calibrated resolver is local-only. Execute/apply/write/gate flags are rejected.')
  }
  const input = val(args.input) || DEFAULT_INPUT
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  const minimumMatchConfidence = args['minimum-match-confidence'] ?? 0.5
  const positiveCoverageThreshold = args['positive-coverage-threshold'] ?? 0.5
  if (!fs.existsSync(input)) throw new Error(`Calibrated assessment input not found: ${input}`)

  const sourceRows = readRows(input)
  const rows = sourceRows.map((source) => {
    const resolved = resolveRadarAssessment(source, { minimumMatchConfidence, positiveCoverageThreshold })
    return {
      ...resolved,
      calibration: {
        profileId: val(source?.calibrationProfileId),
        profileVersion: val(source?.calibrationProfileVersion),
        policyVersion: val(source?.calibrationPolicyVersion),
        mode: val(source?.calibrationMode) || 'advisory',
        signals: list(source?.calibrationSignals),
        notes: list(source?.calibrationNotes).map(val).filter(Boolean),
      },
    }
  })

  const outputs = {
    resolved: path.join(outDir, 'ai-radar-calibrated-resolved-v01.jsonl'),
    ready: path.join(outDir, 'ai-radar-calibrated-ready-v01.jsonl'),
    blocked: path.join(outDir, 'ai-radar-calibrated-blocked-v01.jsonl'),
    reviewCsv: path.join(outDir, 'ai-radar-calibrated-review-v01.csv'),
    summary: path.join(outDir, 'ai-radar-calibrated-resolve-v01-summary.json'),
  }
  const ready = rows.filter((row) => !row.planStatus.startsWith('blocked'))
  const blocked = rows.filter((row) => row.planStatus.startsWith('blocked'))
  writeJsonl(outputs.resolved, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeReviewCsv(outputs.reviewCsv, rows)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    policyVersion: rows[0]?.policyVersion || 'radar-rating-policy-v0.4-draft',
    calibrationProfileId: rows[0]?.calibration?.profileId || null,
    input,
    rowsRead: rows.length,
    readyRows: ready.length,
    blockedRows: blocked.length,
    humanReviewRequiredRows: rows.filter((row) => row.requiresHumanReview).length,
    rowsWithCalibrationSignals: rows.filter((row) => list(row.calibration?.signals).length > 0).length,
    rowsWithoutCalibrationSignals: rows.filter((row) => list(row.calibration?.signals).length === 0).length,
    byGrade: countBy(rows, (row) => row.currentGradeSuggestion),
    byDecisiveRule: countBy(rows, (row) => row.decisiveRule?.code),
    byPlanStatus: countBy(rows, (row) => row.planStatus),
    byCalibrationSignal: countBy(rows.flatMap((row) => list(row.calibration?.signals)), (item) => `${val(item?.type)}:${val(item?.id)}`),
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      autoPublishes: false,
      autoAssignsX: false,
      overwritesHumanVerified: false,
      calibrationIsAdvisory: true,
      factsOverrideCalibration: true,
    },
    nextStep: 'Review the calibrated CSV and all blocked/human-review rows. No database write is included in this workflow.',
  }
  fs.mkdirSync(path.dirname(outputs.summary), { recursive: true })
  fs.writeFileSync(outputs.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
