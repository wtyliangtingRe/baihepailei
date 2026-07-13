#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_GATE = 'config/ai-radar-release-gate-v01.json'
const DEFAULT_SUMMARY = 'data_local/staging/ai-radar/ai-radar-final-batch-summary-v01.json'

function val(value) { return String(value ?? '').trim() }

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; i += 1 }
  }
  return args
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function requirementValue(summary, key) {
  if (summary?.requirements && key in summary.requirements) return summary.requirements[key]
  if (summary?.checks && key in summary.checks) return summary.checks[key]
  if (summary?.completeness && key in summary.completeness) return summary.completeness[key]

  const aliases = {
    allIdentityConflictsReviewedOrExplicitlyBlocked: summary?.completeness?.identityConflictsBlocked,
    allRuleConflictsAudited: summary?.reviewAndSafety?.allRuleConflictsAudited,
    humanVerifiedRowsRemainProtected: summary?.reviewAndSafety?.humanVerifiedRowsRemainProtected,
    xRowsRequireHumanAdjudication: summary?.reviewAndSafety?.xRowsRequireHumanAdjudication,
    payloadPatchPlanReviewed: summary?.releaseGate?.payloadPatchPlanReviewed,
    payloadApplyDryRunReviewed: summary?.releaseGate?.payloadApplyDryRunReviewed,
  }
  return aliases[key]
}

export function evaluateReleaseGate(gate, summary = null) {
  const blockers = []
  const warnings = []

  if (gate.writeEnabled !== true) blockers.push('release_gate_write_disabled')
  if (gate.userApprovalRequired !== false && !val(gate.approvalToken)) {
    blockers.push('explicit_user_approval_token_missing')
  }

  if (!summary) {
    blockers.push('final_batch_summary_missing')
  } else {
    const rows = Number(summary?.rows ?? summary?.totalRows ?? 0)
    if (rows !== Number(gate.expectedRows)) blockers.push(`expected_${gate.expectedRows}_rows_received_${rows}`)

    for (const [key, required] of Object.entries(gate.requirements || {})) {
      if (required !== true) continue
      const actual = requirementValue(summary, key)
      if (actual !== true) blockers.push(`requirement_not_met:${key}`)
    }

    const summaryApprovalToken = val(summary?.approvalToken)
    if (val(gate.approvalToken) && summaryApprovalToken !== val(gate.approvalToken)) {
      blockers.push('approval_token_mismatch')
    }

    if (summary?.payloadWrite === true || summary?.directPostgresqlWrite === true) {
      blockers.push('unexpected_write_detected_in_summary')
    }

    const writeEligibleRows = Number(summary?.writeEligibleRows ?? summary?.reviewAndSafety?.writeEligibleRows ?? 0)
    if (gate.writeEnabled !== true && writeEligibleRows > 0) {
      blockers.push('write_eligible_rows_present_while_gate_disabled')
    }
  }

  return {
    releaseReady: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const gateFile = val(args.gate) || DEFAULT_GATE
  const summaryFile = val(args.summary) || DEFAULT_SUMMARY

  if (!fs.existsSync(gateFile)) throw new Error(`Release gate not found: ${gateFile}`)
  const gate = readJson(gateFile)
  const summary = fs.existsSync(summaryFile) ? readJson(summaryFile) : null
  const evaluation = evaluateReleaseGate(gate, summary)

  const result = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-release-readiness-check-v0.2',
    batchId: gate.batchId,
    gateFile,
    summaryFile,
    expectedRows: gate.expectedRows,
    writeEnabled: gate.writeEnabled === true,
    releaseReady: evaluation.releaseReady,
    blockers: evaluation.blockers,
    warnings: evaluation.warnings,
    safety: {
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      checkerOnly: true,
    },
  }

  const output = val(args.output) || 'data_local/staging/ai-radar/ai-radar-release-readiness-v01.json'
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, result, output }, null, 2))

  const expectBlocked = args['expect-blocked'] === true
  if (args['require-ready'] === true && !result.releaseReady) process.exitCode = 2
  if (expectBlocked && result.releaseReady) process.exitCode = 3
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  try {
    main()
  } catch (error) {
    console.error(error?.stack || error)
    process.exitCode = 1
  }
}
