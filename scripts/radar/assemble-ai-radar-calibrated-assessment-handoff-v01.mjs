#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  CALIBRATED_HANDOFF_VERSION,
  validateCalibrationResponse,
} from './lib/calibration-profile-v01.mjs'
import {
  assertUnderDataLocal,
  jsonlText,
  readJsonl,
  sha256File,
  sha256Text,
  val,
  validateAndMergeResponses,
} from './lib/assessment-handoff-v01.mjs'

const DEFAULT_OUTPUT_ROOT = 'data_local/staging/ai-radar/calibrated-assessment-handoffs-v01'

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value, 'utf8')
}

function safeSlug(value) {
  const slug = val(value).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
  if (!slug) throw new Error('Batch id could not be converted to a safe directory name')
  return slug
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('Calibrated assessment handoff assembly is local-only. Execute/apply/write/gate flags are rejected.')
  }

  const batchId = val(args['batch-id'])
  if (!batchId) throw new Error('--batch-id is required')
  const outputRoot = val(args['out-dir']) || DEFAULT_OUTPUT_ROOT
  assertUnderDataLocal(outputRoot)
  const handoffDir = path.join(outputRoot, safeSlug(batchId))
  const handoffManifestFile = path.join(handoffDir, 'handoff-manifest.json')
  assertUnderDataLocal(handoffManifestFile)
  if (!fs.existsSync(handoffManifestFile)) throw new Error(`Calibrated handoff manifest not found: ${handoffManifestFile}`)

  const handoff = readJson(handoffManifestFile)
  const blockers = []
  const warnings = []
  if (val(handoff?.version) !== CALIBRATED_HANDOFF_VERSION) blockers.push('calibrated_handoff_version_mismatch')
  if (val(handoff?.batchId) !== batchId) blockers.push('calibrated_handoff_batch_id_mismatch')
  if (val(handoff?.queue) !== 'ready_for_ai_assessment') blockers.push('calibrated_handoff_queue_not_assessment')
  if (!val(handoff?.calibration?.profileId)) blockers.push('calibrated_handoff_profile_missing')
  if (!fs.existsSync(val(handoff?.copiedSourceFile))) blockers.push('calibrated_handoff_source_copy_missing')
  else if (sha256File(val(handoff.copiedSourceFile)) !== val(handoff?.copiedSourceSha256)) blockers.push('calibrated_handoff_source_copy_sha256_mismatch')

  const assembledRoot = val(handoff?.outputs?.assembledRoot) || path.join(handoffDir, 'assembled')
  assertUnderDataLocal(assembledRoot)
  fs.mkdirSync(assembledRoot, { recursive: true })

  const allMergedRows = []
  const chunkResults = []
  let totalCalibrationSignals = 0
  let rowsWithoutCalibrationSignals = 0

  for (const chunk of Array.isArray(handoff?.chunks) ? handoff.chunks : []) {
    const inputFile = val(chunk?.inputFile)
    const responseFile = val(chunk?.responseFile)
    const chunkBlockers = []
    const chunkWarnings = []

    if (!inputFile || !fs.existsSync(inputFile)) chunkBlockers.push('chunk_input_missing')
    else if (sha256File(inputFile) !== val(chunk?.inputSha256)) chunkBlockers.push('chunk_input_sha256_mismatch')
    if (!responseFile || !fs.existsSync(responseFile)) chunkBlockers.push('chunk_response_missing')

    let inputRows = []
    let responseRows = []
    if (!chunkBlockers.includes('chunk_input_missing') && !chunkBlockers.includes('chunk_input_sha256_mismatch')) {
      inputRows = readJsonl(inputFile)
      if (inputRows.length !== Number(chunk?.rowCount)) chunkBlockers.push('chunk_input_row_count_mismatch')
    }
    if (!chunkBlockers.includes('chunk_response_missing')) responseRows = readJsonl(responseFile)

    if (!chunkBlockers.length) {
      const validated = validateAndMergeResponses(inputRows, responseRows, batchId)
      chunkBlockers.push(...validated.blockers)
      chunkWarnings.push(...validated.warnings)
      const inputById = new Map(inputRows.map((row) => [val(row?.workId), row]))
      const responseById = new Map(responseRows.map((row) => [val(row?.workId), row]))
      const calibratedRows = []
      for (const merged of validated.mergedRows) {
        const input = inputById.get(merged.workId)
        const response = responseById.get(merged.workId)
        const calibrationValidation = validateCalibrationResponse(input, response, merged.workId)
        chunkBlockers.push(...calibrationValidation.blockers)
        chunkWarnings.push(...calibrationValidation.warnings)
        const calibration = calibrationValidation.calibration
        totalCalibrationSignals += calibration.signals.length
        if (!calibration.signals.length) rowsWithoutCalibrationSignals += 1
        calibratedRows.push({
          ...merged,
          calibrationProfileId: calibration.profileId,
          calibrationProfileVersion: calibration.profileVersion,
          calibrationPolicyVersion: calibration.policyVersion,
          calibrationMode: calibration.mode,
          calibrationSignals: calibration.signals,
          calibrationNotes: calibration.notes,
          calibrationContext: calibration.context,
        })
      }
      if (!chunkBlockers.length) allMergedRows.push(...calibratedRows)
    }

    blockers.push(...chunkBlockers.map((item) => `${val(chunk?.chunkId)}:${item}`))
    warnings.push(...chunkWarnings.map((item) => `${val(chunk?.chunkId)}:${item}`))
    chunkResults.push({
      chunkId: val(chunk?.chunkId),
      inputFile,
      responseFile,
      expectedRows: Number(chunk?.rowCount),
      receivedRows: responseRows.length,
      blockers: [...new Set(chunkBlockers)],
      warnings: [...new Set(chunkWarnings)],
      responseSha256: responseFile && fs.existsSync(responseFile) ? sha256File(responseFile) : null,
    })
  }

  if (!Array.isArray(handoff?.chunks) || handoff.chunks.length !== Number(handoff?.chunkCount)) blockers.push('calibrated_handoff_chunk_count_mismatch')
  if (!blockers.length && allMergedRows.length !== Number(handoff?.rowCount)) blockers.push('calibrated_assembled_row_count_mismatch')

  const uniqueBlockers = [...new Set(blockers)]
  const uniqueWarnings = [...new Set(warnings)]
  const partialFile = path.join(assembledRoot, `${safeSlug(batchId)}.raw-assessments.partial.jsonl`)
  const completeFile = path.join(assembledRoot, `${safeSlug(batchId)}.raw-assessments.jsonl`)
  const partialText = jsonlText(allMergedRows)
  writeText(partialFile, partialText)

  const complete = uniqueBlockers.length === 0
  if (complete) writeText(completeFile, partialText)
  else fs.rmSync(completeFile, { force: true })

  const resolverOutDir = path.join(assembledRoot, 'resolved')
  const summary = {
    generatedAt: new Date().toISOString(),
    version: CALIBRATED_HANDOFF_VERSION,
    mode: 'local_calibrated_read_only_assembly',
    batchId,
    complete,
    expectedRows: Number(handoff?.rowCount),
    assembledRows: allMergedRows.length,
    chunkCount: Number(handoff?.chunkCount),
    completedChunks: chunkResults.filter((item) => item.blockers.length === 0).length,
    calibrationProfileId: val(handoff?.calibration?.profileId),
    totalCalibrationSignals: complete ? totalCalibrationSignals : 0,
    rowsWithoutCalibrationSignals: complete ? rowsWithoutCalibrationSignals : 0,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    chunks: chunkResults,
    outputs: {
      partialRawAssessments: partialFile,
      completeRawAssessments: complete ? completeFile : null,
      summary: path.join(assembledRoot, 'assembly-summary.json'),
      resolverOutDir,
    },
    hashes: {
      handoffManifestSha256: sha256File(handoffManifestFile),
      partialRawAssessmentsSha256: sha256Text(partialText),
      completeRawAssessmentsSha256: complete ? sha256Text(partialText) : null,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      canonicalIdentityAndProtectionFromInputOnly: true,
      calibrationIsAdvisory: true,
      publishesRatings: false,
    },
    nextStep: complete
      ? `node scripts/radar/resolve-ai-radar-calibrated-assessments-v01.mjs --input "${completeFile}" --out-dir "${resolverOutDir}"`
      : 'Complete or correct the response files listed in blockers, then rerun calibrated assembly.',
  }

  writeJson(summary.outputs.summary, summary)
  console.log(JSON.stringify({ ok: complete, summary }, null, 2))
  if (!complete) process.exitCode = 2
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
