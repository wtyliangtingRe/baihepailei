#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION = 'ai-radar-coverage-audit-v0.1'
const FIXED_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])

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
  if (/\.jsonl$/iu.test(file)) {
    return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  }
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['docs', 'rows', 'records', 'items', 'works', 'data']) {
    if (Array.isArray(parsed?.[key])) return parsed[key]
  }
  return [parsed]
}

function countBy(values) {
  const out = {}
  for (const raw of values) {
    const key = val(raw) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

function radarOf(row) {
  return row?.existingState?.radarAssessment && typeof row.existingState.radarAssessment === 'object'
    ? row.existingState.radarAssessment
    : row?.radarAssessment && typeof row.radarAssessment === 'object'
      ? row.radarAssessment
      : null
}

function existingStateOf(row) {
  return row?.existingState && typeof row.existingState === 'object' ? row.existingState : row
}

function isValidGrade(value) {
  return FIXED_GRADES.has(val(value))
}

function hasMeaningfulAssessmentSignal(radar) {
  if (!radar || typeof radar !== 'object') return false

  return Boolean(
    isValidGrade(radar.suggestedGrade)
    || val(radar.assessedAt)
    || val(radar.assessmentBatch)
    || val(radar.policyVersion)
    || val(radar.sourceSummary)
    || val(radar.decisiveRuleCode)
    || val(radar.decisiveRuleReason)
    || list(radar.matchedRules).length
    || list(radar.contradictions).length
    || Number(radar.sourceCount) > 0
    || Number.isFinite(Number(radar.confidencePercent)) && radar.confidencePercent !== null && radar.confidencePercent !== ''
    || Number.isFinite(Number(radar.evidenceCoveragePercent)) && radar.evidenceCoveragePercent !== null && radar.evidenceCoveragePercent !== ''
    || (val(radar.evidenceStatus) && val(radar.evidenceStatus) !== 'unassessed')
    || val(radar.conclusionMode)
    || val(radar.bestGrade)
    || val(radar.likelyGrade)
    || val(radar.worstGrade)
  )
}

function hasValidBoundedRange(radar) {
  if (!radar || typeof radar !== 'object') return false
  const mode = val(radar.conclusionMode)
  const best = radar.bestGrade ?? radar.proposedBestGrade
  const likely = radar.likelyGrade ?? radar.proposedLikelyGrade
  const worst = radar.worstGrade ?? radar.proposedWorstGrade
  return mode === 'bounded_range' && isValidGrade(best) && isValidGrade(likely) && isValidGrade(worst)
}

export function classifyRadarCoverage(row) {
  const radar = radarOf(row)
  if (isValidGrade(radar?.suggestedGrade)) return 'fixed_grade'
  if (hasValidBoundedRange(radar)) return 'bounded_range'
  if (hasMeaningfulAssessmentSignal(radar)) return 'scanned_without_valid_conclusion'
  return 'unscanned'
}

export function auditRadarCoverage(rows, input = null) {
  const coverageModes = rows.map(classifyRadarCoverage)
  const radarRows = rows.map(radarOf)
  const states = rows.map(existingStateOf)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    rowsRead: rows.length,
    byCoverageMode: countBy(coverageModes),
    fixedGradeRows: coverageModes.filter((value) => value === 'fixed_grade').length,
    boundedRangeRows: coverageModes.filter((value) => value === 'bounded_range').length,
    scannedWithoutValidConclusionRows: coverageModes.filter((value) => value === 'scanned_without_valid_conclusion').length,
    unscannedRows: coverageModes.filter((value) => value === 'unscanned').length,
    radarGroupObjects: radarRows.filter(Boolean).length,
    radarGroupObjectsWithoutMeaningfulSignal: radarRows.filter((radar) => radar && !hasMeaningfulAssessmentSignal(radar)).length,
    bySuggestedGrade: countBy(radarRows.map((radar) => radar?.suggestedGrade)),
    byConclusionMode: countBy(radarRows.map((radar) => radar?.conclusionMode)),
    byEvidenceStrength: countBy(states.map((state) => state?.evidenceStrength)),
    byRatingNotice: countBy(states.map((state) => state?.ratingNotice)),
    withAssessedAt: radarRows.filter((radar) => val(radar?.assessedAt)).length,
    withAssessmentBatch: radarRows.filter((radar) => val(radar?.assessmentBatch)).length,
    withPolicyVersion: radarRows.filter((radar) => val(radar?.policyVersion)).length,
    coverageGuaranteeSatisfied: coverageModes.filter((value) => value === 'scanned_without_valid_conclusion').length === 0,
    notes: [
      'Works.evidenceStrength is not an AI completion flag.',
      'A Payload group object with only empty/default fields is counted as unscanned.',
      'A completed AI scan must produce either fixed_grade or bounded_range.',
    ],
  }

  return summary
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = val(args.file)
  if (!file) throw new Error('Use --file <works-or-packets.jsonl>')
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)

  const rows = readRows(file)
  const summary = auditRadarCoverage(rows, file)
  const output = val(args.output)

  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, JSON.stringify(summary, null, 2), 'utf8')
  }

  console.log(JSON.stringify({ ok: true, summary }, null, 2))

  if (args.strict && !summary.coverageGuaranteeSatisfied) {
    process.exitCode = 2
  }
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
