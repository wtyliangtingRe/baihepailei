#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import { stableRowSha256 } from './lib/ai-qa-package-v01.mjs'
import {
  assertUnderDataLocal,
  readJsonl,
  sha256File,
  val,
} from './lib/assessment-handoff-v01.mjs'

const VERSION = 'ai-radar-batch2-ai-qa-final-v0.1'
const ALLOWED_DECISIONS = new Set(['ai_qa_passed', 'ai_qa_deferred'])

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

function list(value) { return Array.isArray(value) ? value : [] }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')) }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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
  return Object.fromEntries(Object.entries(output).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}
function requiredInteger(args, name) {
  const value = Number(args[name])
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`)
  return value
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.publish || args.patch || args.gate || args['approval-token']) {
    throw new Error('Batch 2 AI QA finalization is local-only. Publish/patch/gate flags are rejected.')
  }

  const decisionsFile = val(args.decisions)
  const targetedResearchFile = val(args['targeted-research'])
  const resolvedFile = val(args['resolved-file'])
  const assemblySummaryFile = val(args['assembly-summary'])
  const resolverSummaryFile = val(args['resolver-summary'])
  const outputDir = val(args['out-dir'])
  if (!decisionsFile || !targetedResearchFile || !resolvedFile || !assemblySummaryFile || !resolverSummaryFile || !outputDir) {
    throw new Error('--decisions, --targeted-research, --resolved-file, --assembly-summary, --resolver-summary and --out-dir are required')
  }

  const expectedRows = requiredInteger(args, 'expected-rows')
  const expectedPassed = requiredInteger(args, 'expected-passed')
  const expectedDeferred = requiredInteger(args, 'expected-deferred')
  if (expectedPassed + expectedDeferred !== expectedRows) throw new Error('Expected passed + deferred must equal expected rows')

  const safeDecisionsFile = assertUnderDataLocal(decisionsFile)
  const safeTargetedResearchFile = assertUnderDataLocal(targetedResearchFile)
  const safeResolvedFile = assertUnderDataLocal(resolvedFile)
  const safeAssemblySummaryFile = assertUnderDataLocal(assemblySummaryFile)
  const safeResolverSummaryFile = assertUnderDataLocal(resolverSummaryFile)
  const safeOutputDir = assertUnderDataLocal(outputDir)
  for (const file of [safeDecisionsFile, safeTargetedResearchFile, safeResolvedFile, safeAssemblySummaryFile, safeResolverSummaryFile]) {
    if (!fs.existsSync(file)) throw new Error(`Required Batch 2 finalization input not found: ${file}`)
  }

  const assemblySummary = readJson(safeAssemblySummaryFile)
  const resolverSummary = readJson(safeResolverSummaryFile)
  if (assemblySummary?.complete !== true || Number(assemblySummary?.assembledRows) !== expectedRows) {
    throw new Error('Batch 2 calibrated assembly is incomplete or has the wrong row count')
  }
  if (Number(resolverSummary?.rowsRead) !== expectedRows) throw new Error('Batch 2 resolver row count mismatch')
  if (Number(resolverSummary?.safety?.humanTrackMutations ?? 0) !== 0) throw new Error('Batch 2 resolver reported a human-track mutation')

  const decisions = readJsonl(safeDecisionsFile)
  const targetedResearch = readJsonl(safeTargetedResearchFile)
  const resolvedRows = readJsonl(safeResolvedFile)
  if (decisions.length !== expectedRows) throw new Error(`Expected ${expectedRows} AI QA decisions, received ${decisions.length}`)
  if (resolvedRows.length !== expectedRows) throw new Error(`Expected ${expectedRows} resolved rows, received ${resolvedRows.length}`)

  const resolvedById = new Map()
  for (const row of resolvedRows) {
    const workId = val(row?.workId)
    if (!workId) throw new Error('Resolved row is missing workId')
    if (resolvedById.has(workId)) throw new Error(`Duplicate resolved workId: ${workId}`)
    resolvedById.set(workId, row)
  }

  const seenDecisionIds = new Set()
  const finalRows = []
  for (const decision of decisions) {
    const workId = val(decision?.workId)
    const siteId = val(decision?.siteId)
    const decisionStatus = val(decision?.decision)
    if (!workId || !siteId) throw new Error('AI QA decision is missing workId or siteId')
    if (seenDecisionIds.has(workId)) throw new Error(`Duplicate AI QA decision workId: ${workId}`)
    seenDecisionIds.add(workId)
    if (!ALLOWED_DECISIONS.has(decisionStatus)) throw new Error(`Unsupported AI QA decision for ${workId}: ${decisionStatus}`)
    if (decision?.humanTrackMutation === true || val(decision?.humanTrackAction) !== 'none_separate_track') {
      throw new Error(`AI QA decision attempted a human-track mutation for ${workId}`)
    }

    const resolved = resolvedById.get(workId)
    if (!resolved) throw new Error(`Resolved row missing for AI QA decision: ${workId}`)
    if (val(resolved?.siteId) !== siteId) throw new Error(`Resolved siteId mismatch for ${workId}`)
    const expected = decision?.expectedSuggestion || {}
    if (val(resolved?.currentGradeSuggestion) !== val(expected?.grade)) throw new Error(`Resolved grade mismatch for ${workId}`)
    if (val(resolved?.decisiveRule?.code) !== val(expected?.decisiveRuleCode)) throw new Error(`Resolved decisive rule mismatch for ${workId}`)
    if (Math.round(Number(resolved?.evidenceCoveragePercent)) !== Math.round(Number(expected?.evidenceCoveragePercent))) {
      throw new Error(`Resolved evidence coverage mismatch for ${workId}`)
    }
    if (val(resolved?.evidenceStatus) !== val(expected?.evidenceStatus)) throw new Error(`Resolved evidence status mismatch for ${workId}`)

    finalRows.push({
      ...resolved,
      track: 'ai_review',
      aiQaStatus: decisionStatus,
      aiQaOriginalDecision: decisionStatus,
      aiQaCorrectionId: null,
      aiQaReasons: [...new Set(list(decision?.reasons).map(val).filter(Boolean))],
      aiQaFinalResolvedRowSha256: stableRowSha256(resolved),
      humanReviewStatus: 'not_started_separate_track',
      humanReviewRecordId: null,
      humanTrackAction: 'none_separate_track',
    })
  }

  if (resolvedById.size !== seenDecisionIds.size) throw new Error('AI QA decision and resolved identity sets differ')
  const passed = finalRows.filter((row) => row.aiQaStatus === 'ai_qa_passed')
  const deferred = finalRows.filter((row) => row.aiQaStatus === 'ai_qa_deferred')
  if (passed.length !== expectedPassed || deferred.length !== expectedDeferred) {
    throw new Error(`Unexpected Batch 2 AI QA counts: passed=${passed.length}, deferred=${deferred.length}`)
  }

  const deferredIds = new Set(deferred.map((row) => val(row?.workId)))
  const targetedIds = new Set()
  for (const request of targetedResearch) {
    const workId = val(request?.workId)
    if (!workId || targetedIds.has(workId)) throw new Error(`Invalid or duplicate targeted research workId: ${workId}`)
    targetedIds.add(workId)
    if (val(request?.queue) !== 'ai_qa_targeted_research') throw new Error(`Invalid targeted research queue for ${workId}`)
    if (val(request?.humanTrackAction) !== 'none_separate_track') throw new Error(`Targeted research attempted human-track action for ${workId}`)
  }
  if (targetedIds.size !== deferredIds.size || [...targetedIds].some((id) => !deferredIds.has(id))) {
    throw new Error('Targeted research identities do not exactly match deferred AI QA rows')
  }

  fs.mkdirSync(safeOutputDir, { recursive: true })
  const outputs = {
    all: path.join(safeOutputDir, 'ai-radar-batch2-ai-qa-final-v0.1.jsonl'),
    passed: path.join(safeOutputDir, 'ai-radar-batch2-ai-qa-passed-v0.1.jsonl'),
    deferred: path.join(safeOutputDir, 'ai-radar-batch2-ai-qa-deferred-v0.1.jsonl'),
    decisionsCsv: path.join(safeOutputDir, 'ai-radar-batch2-ai-qa-decisions-v0.1.csv'),
    targetedResearch: path.join(safeOutputDir, 'ai-radar-batch2-targeted-research-v0.1.jsonl'),
    summary: path.join(safeOutputDir, 'ai-radar-batch2-ai-qa-final-summary-v0.1.json'),
    report: path.join(safeOutputDir, 'AI_RADAR_BATCH2_AI_QA_FINAL_REPORT_v0.1.md'),
  }
  writeJsonl(outputs.all, finalRows)
  writeJsonl(outputs.passed, passed)
  writeJsonl(outputs.deferred, deferred)
  writeJsonl(outputs.targetedResearch, targetedResearch)

  const csvHeaders = [
    'workId', 'siteId', 'title', 'aiQaStatus', 'currentGradeSuggestion', 'decisiveRuleCode',
    'confidencePercent', 'evidenceCoveragePercent', 'evidenceStatus', 'aiQaReasons',
    'humanReviewStatus', 'humanTrackAction',
  ]
  const csvLines = [csvHeaders.map(csvCell).join(',')]
  for (const row of finalRows) {
    csvLines.push([
      row.workId, row.siteId, row.title, row.aiQaStatus, row.currentGradeSuggestion,
      row.decisiveRule?.code, row.confidencePercent, row.evidenceCoveragePercent,
      row.evidenceStatus, row.aiQaReasons, row.humanReviewStatus, row.humanTrackAction,
    ].map(csvCell).join(','))
  }
  fs.writeFileSync(outputs.decisionsCsv, `${csvLines.join('\n')}\n`, 'utf8')

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    batchId: 'RADAR-ASSESS-RESEARCH-0002',
    rowsRead: finalRows.length,
    aiQaPassedRows: passed.length,
    aiQaDeferredRows: deferred.length,
    correctionsAppliedRows: 0,
    byGradePassed: countBy(passed, (row) => row.currentGradeSuggestion),
    byDecisiveRulePassed: countBy(passed, (row) => row.decisiveRule?.code),
    deferredWorkIds: deferred.map((row) => row.workId),
    source: {
      resolvedFile: safeResolvedFile,
      resolvedFileSha256: sha256File(safeResolvedFile),
      assemblySummary: safeAssemblySummaryFile,
      resolverSummary: safeResolverSummaryFile,
      decisionsFile: safeDecisionsFile,
      decisionsFileSha256: sha256File(safeDecisionsFile),
    },
    outputs,
    trackIsolation: {
      aiTrackRows: finalRows.length,
      humanTrackRowsCreated: 0,
      humanTrackMutations: 0,
      humanReviewStatus: 'not_started_separate_track',
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      publishesRatings: false,
      onlyWritesUnderDataLocal: true,
    },
    nextStep: 'Upload the Batch 2 checkpoint ZIP. Deferred AI rows remain in targeted research; the human-review track is untouched.',
  }
  writeJson(outputs.summary, summary)

  const report = [
    '# AI Radar 第二批 AI QA 最终报告 v0.1',
    '',
    `- 批次：${summary.batchId}`,
    `- AI QA 通过：${passed.length}`,
    `- 暂缓并进入定向补研究：${deferred.length}`,
    '- 确定性修正：0',
    '- 人工审核线创建或修改：0',
    '- Payload / PostgreSQL / Works 写入：0',
    '',
    '## 暂缓条目',
    '',
    ...(deferred.length
      ? deferred.map((row) => `- ${row.workId}｜${row.title}｜${row.currentGradeSuggestion}/${val(row.decisiveRule?.code)}｜等待定向补充研究`)
      : ['- none']),
    '',
  ].join('\n')
  fs.writeFileSync(outputs.report, report, 'utf8')

  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
