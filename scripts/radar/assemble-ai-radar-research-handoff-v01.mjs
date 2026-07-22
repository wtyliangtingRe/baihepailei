#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  RESEARCH_HANDOFF_VERSION,
  buildAssessmentManifest,
  buildAssessmentReadyRows,
  researchAssessmentBatchId,
  validateAndMergeResearchResponses,
} from './lib/research-handoff-v01.mjs'
import {
  assertUnderDataLocal,
  jsonlText,
  readJsonl,
  sha256File,
  val,
} from './lib/assessment-handoff-v01.mjs'

const DEFAULT_OUTPUT_ROOT = 'data_local/staging/ai-radar/research-handoffs-v01'

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
function safeSlug(value) {
  const slug = val(value).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
  if (!slug) throw new Error('Batch id could not be converted to a safe directory name')
  return slug
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')) }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, jsonlText(rows), 'utf8')
}
function countBy(rows, field) {
  const output = {}
  for (const row of rows) {
    const key = val(row?.[field]) || 'missing'
    output[key] = (output[key] || 0) + 1
  }
  return output
}
function safeManifestPath(value, missingCode, outsideCode, blockers) {
  const file = val(value)
  if (!file) { blockers.push(missingCode); return '' }
  try { return assertUnderDataLocal(file) } catch { blockers.push(outsideCode); return '' }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('Research handoff assembly is local-only. Execute/apply/write/gate flags are rejected.')
  }
  const batchId = val(args['batch-id'])
  if (!batchId) throw new Error('--batch-id is required')
  const outputRoot = val(args['out-dir']) || DEFAULT_OUTPUT_ROOT
  assertUnderDataLocal(outputRoot)
  const handoffDir = assertUnderDataLocal(path.join(outputRoot, safeSlug(batchId)))
  const handoffManifestFile = assertUnderDataLocal(path.join(handoffDir, 'handoff-manifest.json'))
  if (!fs.existsSync(handoffManifestFile)) throw new Error(`Research handoff manifest not found: ${handoffManifestFile}`)

  const manifest = readJson(handoffManifestFile)
  const blockers = []
  const warnings = []
  if (val(manifest?.version) !== RESEARCH_HANDOFF_VERSION) blockers.push('research_handoff_version_mismatch')
  if (val(manifest?.batchId) !== batchId) blockers.push('research_handoff_batch_id_mismatch')
  if (val(manifest?.queue) !== 'external_research') blockers.push('research_handoff_queue_mismatch')

  const copiedSourceFile = safeManifestPath(
    manifest?.copiedSourceFile,
    'research_copied_source_missing',
    'research_copied_source_outside_data_local',
    blockers,
  )
  if (copiedSourceFile && !fs.existsSync(copiedSourceFile)) blockers.push('research_copied_source_missing')
  else if (copiedSourceFile && sha256File(copiedSourceFile) !== val(manifest?.copiedSourceSha256)) blockers.push('research_copied_source_sha256_mismatch')

  const inputRows = []
  const responseRows = []
  for (const chunk of Array.isArray(manifest?.chunks) ? manifest.chunks : []) {
    const chunkId = val(chunk?.chunkId)
    const chunkBlockers = []
    const inputFile = safeManifestPath(chunk?.inputFile, 'research_chunk_input_missing', 'research_chunk_input_outside_data_local', chunkBlockers)
    const responseFile = safeManifestPath(chunk?.responseFile, 'research_chunk_response_missing', 'research_chunk_response_outside_data_local', chunkBlockers)
    if (inputFile && !inputFile.startsWith(`${handoffDir}${path.sep}`)) chunkBlockers.push('research_chunk_input_outside_handoff_directory')
    if (responseFile && !responseFile.startsWith(`${handoffDir}${path.sep}`)) chunkBlockers.push('research_chunk_response_outside_handoff_directory')
    if (inputFile && !fs.existsSync(inputFile)) chunkBlockers.push('research_chunk_input_missing')
    else if (inputFile && sha256File(inputFile) !== val(chunk?.inputSha256)) chunkBlockers.push('research_chunk_input_sha256_mismatch')
    if (responseFile && !fs.existsSync(responseFile)) chunkBlockers.push('research_chunk_response_missing')

    if (inputFile && !chunkBlockers.some((item) => ['research_chunk_input_missing', 'research_chunk_input_sha256_mismatch', 'research_chunk_input_outside_data_local', 'research_chunk_input_outside_handoff_directory'].includes(item))) {
      const chunkInputs = readJsonl(inputFile)
      if (chunkInputs.length !== Number(chunk?.rowCount)) chunkBlockers.push('research_chunk_input_row_count_mismatch')
      inputRows.push(...chunkInputs)
    }
    if (responseFile && !chunkBlockers.some((item) => ['research_chunk_response_missing', 'research_chunk_response_outside_data_local', 'research_chunk_response_outside_handoff_directory'].includes(item))) {
      responseRows.push(...readJsonl(responseFile))
    }
    blockers.push(...chunkBlockers.map((item) => `${item}:${chunkId}`))
  }

  if (inputRows.length !== Number(manifest?.rowCount)) blockers.push('research_handoff_input_total_mismatch')
  const validation = validateAndMergeResearchResponses(inputRows, responseRows, batchId)
  blockers.push(...validation.blockers)
  warnings.push(...validation.warnings)

  const assembledRoot = assertUnderDataLocal(val(manifest?.outputs?.assembledRoot) || path.join(handoffDir, 'assembled'))
  fs.mkdirSync(assembledRoot, { recursive: true })
  const researchResultsFile = assertUnderDataLocal(path.join(assembledRoot, 'research-results-v01.jsonl'))
  const readyResearchFile = assertUnderDataLocal(path.join(assembledRoot, 'research-ready-for-ai-assessment-v01.jsonl'))
  const needsMoreResearchFile = assertUnderDataLocal(path.join(assembledRoot, 'research-needs-more-research-v01.jsonl'))
  const identityReviewFile = assertUnderDataLocal(path.join(assembledRoot, 'research-identity-review-v01.jsonl'))
  const assessmentReadyInputFile = assertUnderDataLocal(path.join(assembledRoot, 'assessment-ready-input-v01.jsonl'))
  const assessmentManifestFile = assertUnderDataLocal(path.join(assembledRoot, 'assessment-ready-manifest-v01.json'))
  const assemblySummaryFile = assertUnderDataLocal(path.join(assembledRoot, 'assembly-summary.json'))

  const uniqueBlockers = [...new Set(blockers)]
  const uniqueWarnings = [...new Set(warnings)]
  const complete = uniqueBlockers.length === 0
  let readyResearch = []
  let needsMoreResearch = []
  let identityReview = []
  let assessmentReadyRows = []
  const assessmentBatchId = researchAssessmentBatchId(batchId)

  if (complete) {
    readyResearch = validation.mergedRows.filter((row) => row.researchStatus === 'ready_for_ai_assessment')
    needsMoreResearch = validation.mergedRows.filter((row) => row.researchStatus === 'needs_more_research')
    identityReview = validation.mergedRows.filter((row) => row.researchStatus === 'identity_review')
    assessmentReadyRows = buildAssessmentReadyRows(inputRows, validation.mergedRows, batchId)
    const built = buildAssessmentManifest(assessmentReadyRows, assessmentBatchId, assessmentReadyInputFile, val(manifest?.sourceCatalogInputSha256))
    writeJsonl(researchResultsFile, validation.mergedRows)
    writeJsonl(readyResearchFile, readyResearch)
    writeJsonl(needsMoreResearchFile, needsMoreResearch)
    writeJsonl(identityReviewFile, identityReview)
    fs.writeFileSync(assessmentReadyInputFile, built.text, 'utf8')
    writeJson(assessmentManifestFile, built.manifest)
  }

  const summary = {
    generatedAt: new Date().toISOString(), version: RESEARCH_HANDOFF_VERSION, batchId, complete,
    expectedRows: Number(manifest?.rowCount) || 0, inputRows: inputRows.length, responseRows: responseRows.length,
    assembledRows: complete ? validation.mergedRows.length : 0,
    byResearchStatus: complete ? countBy(validation.mergedRows, 'researchStatus') : {},
    byIdentityStatus: complete ? countBy(validation.mergedRows, 'identityStatus') : {},
    assessmentBatchId, assessmentReadyRows: assessmentReadyRows.length,
    blockers: uniqueBlockers, warnings: uniqueWarnings,
    outputs: {
      researchResults: researchResultsFile, readyForAiAssessment: readyResearchFile,
      needsMoreResearch: needsMoreResearchFile, identityReview: identityReviewFile,
      assessmentReadyInput: assessmentReadyInputFile, assessmentManifest: assessmentManifestFile,
    },
    safety: {
      payloadRead: false, payloadWrite: false, payloadPatchRequests: 0, directPostgresqlWrite: false,
      modifiesWorks: false, onlyWritesUnderDataLocal: true, onlyReadsManifestFilesUnderDataLocal: true,
      publishesRatings: false,
    },
    nextStep: complete && assessmentReadyRows.length
      ? `Run the existing assessment handoff preparer with batch ${assessmentBatchId} and manifest ${assessmentManifestFile}.`
      : complete
        ? 'No rows are ready for AI assessment yet. Continue external research or identity review.'
        : 'Fix all blockers and rerun the local research assembler.',
  }
  writeJson(assemblySummaryFile, summary)
  console.log(JSON.stringify({ ok: complete, summary }, null, 2))
  if (!complete) process.exitCode = 2
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
