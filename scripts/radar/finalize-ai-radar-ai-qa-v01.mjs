#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  AI_QA_FINAL_VERSION,
  loadAndValidateAiQaPackage,
  readJson,
  stableRowSha256,
  unique,
  writeJson,
  writeJsonl,
} from './lib/ai-qa-package-v01.mjs'
import {
  assertUnderDataLocal,
  readJsonl,
  sha256File,
  val,
} from './lib/assessment-handoff-v01.mjs'

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
function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : val(value)
  return `"${text.replace(/"/gu, '""')}"`
}
function countBy(rows, getter) {
  const out = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.publish || args.patch || args.gate || args['approval-token']) {
    throw new Error('AI QA finalization is local-only. Publish/patch/gate flags are rejected.')
  }
  const packageDir = val(args['package-dir'])
  const resolvedFile = val(args['resolved-file'])
  const assemblySummaryFile = val(args['assembly-summary'])
  const resolverSummaryFile = val(args['resolver-summary'])
  const outputDir = val(args['out-dir'])
  if (!packageDir || !resolvedFile || !assemblySummaryFile || !resolverSummaryFile || !outputDir) {
    throw new Error('--package-dir, --resolved-file, --assembly-summary, --resolver-summary and --out-dir are required')
  }

  const loaded = loadAndValidateAiQaPackage(packageDir)
  const safeResolvedFile = assertUnderDataLocal(resolvedFile)
  const safeAssemblySummaryFile = assertUnderDataLocal(assemblySummaryFile)
  const safeResolverSummaryFile = assertUnderDataLocal(resolverSummaryFile)
  const safeOutputDir = assertUnderDataLocal(outputDir)
  if (!fs.existsSync(safeResolvedFile)) throw new Error(`Corrected resolved JSONL not found: ${safeResolvedFile}`)
  if (!fs.existsSync(safeAssemblySummaryFile)) throw new Error(`Assembly summary not found: ${safeAssemblySummaryFile}`)
  if (!fs.existsSync(safeResolverSummaryFile)) throw new Error(`Resolver summary not found: ${safeResolverSummaryFile}`)
  const assemblySummary = readJson(safeAssemblySummaryFile)
  const resolverSummary = readJson(safeResolverSummaryFile)
  if (assemblySummary?.complete !== true || Number(assemblySummary?.assembledRows) !== Number(loaded.manifest.expectedRows)) {
    throw new Error('Corrected calibrated assembly is not complete')
  }
  if (Number(resolverSummary?.rowsRead) !== Number(loaded.manifest.expectedRows)) throw new Error('Corrected resolver row count mismatch')
  if (Number(resolverSummary?.safety?.humanTrackMutations ?? 0) !== 0) throw new Error('Resolver reported a human-track mutation')

  const resolvedRows = readJsonl(safeResolvedFile)
  if (resolvedRows.length !== Number(loaded.manifest.expectedRows)) throw new Error('Corrected resolved JSONL row count mismatch')
  const resolvedById = new Map(resolvedRows.map((row) => [val(row?.workId), row]))
  if (resolvedById.size !== resolvedRows.length) throw new Error('Corrected resolved JSONL contains duplicate workId values')
  const correctionByWorkId = new Map(loaded.corrections.map((item) => [val(item?.workId), item]))

  const finalRows = []
  for (const decision of loaded.decisions) {
    const workId = val(decision?.workId)
    const resolved = resolvedById.get(workId)
    if (!resolved) throw new Error(`Corrected resolved row missing for ${workId}`)
    if (val(resolved?.siteId) !== val(decision?.siteId)) throw new Error(`Corrected resolved siteId mismatch for ${workId}`)
    const originalDecision = val(decision?.decision)
    const correction = correctionByWorkId.get(workId)
    if (originalDecision === 'ai_qa_revise' && !correction) throw new Error(`Revise decision lacks correction for ${workId}`)
    if (originalDecision !== 'ai_qa_revise' && correction) throw new Error(`Unexpected correction for non-revise row ${workId}`)
    const finalStatus = originalDecision === 'ai_qa_deferred' ? 'ai_qa_deferred' : 'ai_qa_passed'
    finalRows.push({
      ...resolved,
      track: 'ai_review',
      aiQaStatus: finalStatus,
      aiQaOriginalDecision: originalDecision,
      aiQaCorrectionId: val(correction?.correctionId) || null,
      aiQaReasons: unique(decision?.reasons),
      aiQaSourceResolvedRowSha256: val(decision?.sourceResolvedRowSha256),
      aiQaFinalResolvedRowSha256: stableRowSha256(resolved),
      humanReviewStatus: 'not_started_separate_track',
      humanReviewRecordId: null,
      humanTrackAction: 'none_separate_track',
    })
  }

  const passed = finalRows.filter((row) => row.aiQaStatus === 'ai_qa_passed')
  const deferred = finalRows.filter((row) => row.aiQaStatus === 'ai_qa_deferred')
  const revised = finalRows.filter((row) => row.aiQaOriginalDecision === 'ai_qa_revise')
  if (passed.length !== 66 || deferred.length !== 2 || revised.length !== 3) {
    throw new Error(`Unexpected final AI QA counts: passed=${passed.length}, deferred=${deferred.length}, revised=${revised.length}`)
  }

  fs.mkdirSync(safeOutputDir, { recursive: true })
  const outputs = {
    all: path.join(safeOutputDir, 'ai-radar-ai-qa-final-v0.1.jsonl'),
    passed: path.join(safeOutputDir, 'ai-radar-ai-qa-passed-v0.1.jsonl'),
    deferred: path.join(safeOutputDir, 'ai-radar-ai-qa-deferred-v0.1.jsonl'),
    revised: path.join(safeOutputDir, 'ai-radar-ai-qa-corrections-applied-v0.1.jsonl'),
    decisionsCsv: path.join(safeOutputDir, 'ai-radar-ai-qa-decisions-v0.1.csv'),
    targetedResearch: path.join(safeOutputDir, 'ai-radar-ai-qa-targeted-research-v0.1.jsonl'),
    summary: path.join(safeOutputDir, 'ai-radar-ai-qa-final-summary-v0.1.json'),
    report: path.join(safeOutputDir, 'AI_RADAR_AI_QA_FINAL_REPORT_v0.1.md'),
  }
  writeJsonl(outputs.all, finalRows)
  writeJsonl(outputs.passed, passed)
  writeJsonl(outputs.deferred, deferred)
  writeJsonl(outputs.revised, revised)
  writeJsonl(outputs.targetedResearch, loaded.targetedResearch)

  const csvHeaders = [
    'workId', 'siteId', 'title', 'aiQaStatus', 'aiQaOriginalDecision', 'aiQaCorrectionId',
    'currentGradeSuggestion', 'decisiveRuleCode', 'confidencePercent', 'evidenceCoveragePercent',
    'aiQaReasons', 'humanReviewStatus', 'humanTrackAction',
  ]
  const csvLines = [csvHeaders.map(csvCell).join(',')]
  for (const row of finalRows) {
    csvLines.push([
      row.workId, row.siteId, row.title, row.aiQaStatus, row.aiQaOriginalDecision,
      row.aiQaCorrectionId, row.currentGradeSuggestion, row.decisiveRule?.code,
      row.confidencePercent, row.evidenceCoveragePercent, row.aiQaReasons,
      row.humanReviewStatus, row.humanTrackAction,
    ].map(csvCell).join(','))
  }
  fs.writeFileSync(outputs.decisionsCsv, `${csvLines.join('\n')}\n`, 'utf8')

  const summary = {
    generatedAt: new Date().toISOString(),
    version: AI_QA_FINAL_VERSION,
    packageId: val(loaded.manifest.packageId),
    batchId: val(loaded.manifest.batchId),
    rowsRead: finalRows.length,
    aiQaPassedRows: passed.length,
    aiQaDeferredRows: deferred.length,
    correctionsAppliedRows: revised.length,
    byGradePassed: countBy(passed, (row) => row.currentGradeSuggestion),
    deferredWorkIds: deferred.map((row) => row.workId),
    correctedWorkIds: revised.map((row) => row.workId),
    source: {
      resolvedFile: safeResolvedFile,
      resolvedFileSha256: sha256File(safeResolvedFile),
      assemblySummary: safeAssemblySummaryFile,
      resolverSummary: safeResolverSummaryFile,
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
    nextStep: 'Upload the generated prebatch2 checkpoint ZIP. The two deferred rows remain in targeted research; do not start batch 2 yet.',
  }
  writeJson(outputs.summary, summary)
  const report = [
    '# AI Radar 第一批 AI QA 最终报告 v0.1',
    '',
    `- 批次：${summary.batchId}`,
    `- AI QA 通过：${passed.length}`,
    `- 应用确定性修正：${revised.length}`,
    `- 暂缓并进入定向补研究：${deferred.length}`,
    '- 人工审核线创建或修改：0',
    '- Payload / PostgreSQL / Works 写入：0',
    '',
    '## 修正条目',
    '',
    ...revised.map((row) => `- ${row.workId}｜${row.title}｜${row.currentGradeSuggestion}/${val(row.decisiveRule?.code)}｜${row.aiQaCorrectionId}`),
    '',
    '## 暂缓条目',
    '',
    ...deferred.map((row) => `- ${row.workId}｜${row.title}｜等待定向补充研究`),
    '',
  ].join('\n')
  fs.writeFileSync(outputs.report, report, 'utf8')

  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
