#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {
  VERSION, assertConfined, filesUnder, jsonl, parseArgs, readJsonl, rejectWriteFlags, sameJson,
  sha256File, validateOutcome, val, verifyImmutableRootReceipt,
} from './lib/research-assessment-handoff-v02.mjs'

const args = parseArgs(process.argv.slice(2))
rejectWriteFlags(args)
const root = path.resolve(val(args['package-dir']) || 'data_local/outputs/ai-radar/research-assessment-v02')
const dataLocal = path.resolve('data_local')
if (root !== dataLocal && !root.startsWith(`${dataLocal}${path.sep}`)) throw new Error('Package and generated assembly data must remain under data_local')
const confined = (relative) => assertConfined(root, relative, 'package path')
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
const unique = (values) => [...new Set(values)]
const integrity = verifyImmutableRootReceipt(root)
const manifestFile = path.join(root, 'package-manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
if (manifest.version !== VERSION) throw new Error('Package version mismatch')
if (manifest.sourceOuterSha256 !== integrity.manifest.preparedResearchOuterSha256) throw new Error('Prepared research outer SHA evidence mismatch')
if (manifest.safety?.generatedDataConfinedToDataLocal !== true || manifest.safety?.reviewArtifactsWrittenUnderExports !== true || manifest.safety?.arbitraryOutputPathsAllowed !== false) throw new Error('Package safety model mismatch')
if (!Array.isArray(manifest.waves) || manifest.waves.length !== Number(manifest.waveCount)) throw new Error('Package Wave manifest inventory mismatch')

const syntheticMode = args['synthetic-rehearsal'] === true
const waveContexts = []
const packageStructuralBlockers = []
const declaredResponses = new Map()
for (const waveEntry of manifest.waves) {
  const blockers = []
  const waveManifestFile = confined(waveEntry.manifestFile)
  if (!integrity.files.has(waveEntry.manifestFile)) throw new Error(`Wave manifest absent from immutable root: ${waveEntry.wave}`)
  if (sha256File(waveManifestFile) !== waveEntry.manifestSha256) throw new Error(`Wave manifest hash conflicts with package manifest: ${waveEntry.wave}`)
  const waveManifest = JSON.parse(fs.readFileSync(waveManifestFile, 'utf8'))
  if (waveManifest.version !== VERSION || waveManifest.wave !== waveEntry.wave || !Array.isArray(waveManifest.chunks)) throw new Error(`Invalid Wave manifest: ${waveEntry.wave}`)
  for (const chunk of waveManifest.chunks) {
    const rel = val(chunk.responseFile).replace(/\\/gu, '/')
    if (declaredResponses.has(rel)) {
      blockers.push(`duplicate_response_path_declaration:${rel}`)
      declaredResponses.get(rel).blockers.push(`duplicate_response_path_declaration:${rel}`)
    } else declaredResponses.set(rel, { wave: waveEntry.wave, chunkId: chunk.chunkId, blockers })
  }
  waveContexts.push({ waveEntry, waveManifest, blockers })
}

const responseInventory = filesUnder(root).filter((rel) => /(^|\/)responses\/|\.output\.jsonl$/u.test(rel))
for (const rel of responseInventory) {
  if (declaredResponses.has(rel)) continue
  const waveMatch = /^handoffs\/(wave-\d+)\//u.exec(rel)
  const context = waveMatch && waveContexts.find((item) => item.waveEntry.wave === waveMatch[1])
  if (context) context.blockers.push(`unexpected_response_file:${rel}`)
  else packageStructuralBlockers.push(`misplaced_or_unlisted_response_file:${rel}`)
}

const seenResponseIdentities = new Set()
const waveResults = []
const laneCounts = {}
const modeCounts = {}
let responseRows = 0
let identityOrderMismatches = 0
let syntheticRows = 0
for (const context of waveContexts) {
  const { waveEntry, waveManifest } = context
  const structuralBlockers = context.blockers
  const rows = []
  const waveReviewCounts = { humanReviewRequired: 0, needsMoreResearchReviewRequired: 0, identityResolutionRequired: 0 }
  const immutableFile = confined(waveManifest.immutableInputFile)
  if (!integrity.files.has(waveManifest.immutableInputFile)) throw new Error(`Immutable Wave input absent from root: ${waveEntry.wave}`)
  if (sha256File(immutableFile) !== waveManifest.immutableInputSha256) throw new Error(`Immutable Wave input hash mismatch: ${waveEntry.wave}`)
  const immutableRows = readJsonl(immutableFile)
  if (immutableRows.length !== Number(waveManifest.rowCount)) structuralBlockers.push(`immutable_input_count_mismatch:${waveEntry.wave}`)
  for (const chunk of waveManifest.chunks) {
    const inputFile = confined(chunk.inputFile)
    const responseFile = confined(chunk.responseFile)
    if (!integrity.files.has(chunk.inputFile)) throw new Error(`Chunk input absent from immutable root: ${chunk.chunkId}`)
    if (sha256File(inputFile) !== chunk.inputSha256) throw new Error(`Chunk input hash mismatch: ${chunk.chunkId}`)
    const inputs = readJsonl(inputFile)
    if (inputs.length !== Number(chunk.rowCount) || !Array.isArray(chunk.expectedOrder) || chunk.expectedOrder.length !== inputs.length) structuralBlockers.push(`input_count_or_order_contract_mismatch:${chunk.chunkId}`)
    for (let index = 0; index < Math.min(inputs.length, chunk.expectedOrder?.length || 0); index += 1) {
      for (const key of ['workId', 'siteId', 'title', 'researchDisposition']) if (val(inputs[index][key]) !== val(chunk.expectedOrder[index][key])) structuralBlockers.push(`input_manifest_${key}_mismatch:${chunk.chunkId}:${index + 1}`)
    }
    for (const input of inputs) {
      waveReviewCounts.humanReviewRequired += 1
      if (input.researchDisposition === 'needs_more_research') waveReviewCounts.needsMoreResearchReviewRequired += 1
      if (input.researchDisposition === 'identity_review') waveReviewCounts.identityResolutionRequired += 1
    }
    if (!fs.existsSync(responseFile)) {
      structuralBlockers.push(`response_missing:${chunk.chunkId}`)
      continue
    }
    let responses
    try { responses = readJsonl(responseFile) } catch (error) {
      structuralBlockers.push(`response_invalid_jsonl:${chunk.chunkId}:${error.message}`)
      continue
    }
    if (responses.length !== inputs.length) structuralBlockers.push(`response_count_mismatch:${chunk.chunkId}:${responses.length}/${inputs.length}`)
    const limit = Math.min(inputs.length, responses.length)
    for (let index = 0; index < limit; index += 1) {
      const input = inputs[index], response = responses[index]
      responseRows += 1
      const responseKey = `${val(response.workId)}|${val(response.siteId)}`
      if (seenResponseIdentities.has(responseKey)) structuralBlockers.push(`duplicate_response_identity:${responseKey}`)
      seenResponseIdentities.add(responseKey)
      for (const key of ['workId', 'siteId', 'title', 'researchDisposition']) {
        if (val(response[key]) !== val(input[key])) {
          identityOrderMismatches += 1
          structuralBlockers.push(`${key}_or_order_mismatch:${chunk.chunkId}:${index + 1}`)
        }
      }
      for (const key of ['identity', 'writeProtection', 'research', 'contentProfile', 'riskLabels', 'allowedAssessmentModes', 'requiresHumanReview', 'publicationEligible', 'pageNotice']) {
        if (!sameJson(response[key], input[key])) structuralBlockers.push(`input_owned_${key}_rewrite:${input.workId}`)
      }
      try { validateOutcome(response, input.researchDisposition) } catch (error) { structuralBlockers.push(`invalid_outcome:${input.workId}:${error.message}`) }
      const synthetic = response.syntheticRehearsal === true
      if (synthetic) syntheticRows += 1
      if (synthetic && !syntheticMode) structuralBlockers.push(`synthetic_response_forbidden:${input.workId}`)
      if (!synthetic && syntheticMode) structuralBlockers.push(`non_synthetic_response_in_synthetic_rehearsal:${input.workId}`)
      const rowReleaseBlockers = []
      if (input.researchDisposition === 'needs_more_research') rowReleaseBlockers.push(`needs_more_research_review_required:${input.workId}`)
      if (input.researchDisposition === 'identity_review') rowReleaseBlockers.push(`identity_resolution_required:${input.workId}`)
      rows.push({
        ...input,
        assessment: {
          assessmentMode: response.assessmentMode, exactGradeSuggestion: response.exactGradeSuggestion ?? null,
          gradeRange: response.gradeRange ?? null, riskLabels: response.riskLabels, ruleAssessments: response.ruleAssessments,
          requiresHumanReview: true, publicationEligible: false,
        },
        reviewOrReleaseBlockers: rowReleaseBlockers,
        releaseEligible: false,
        normalPublicationGatePass: false,
        syntheticRehearsal: synthetic || undefined,
      })
      laneCounts[input.researchDisposition] = (laneCounts[input.researchDisposition] || 0) + 1
      modeCounts[response.assessmentMode] = (modeCounts[response.assessmentMode] || 0) + 1
    }
  }
  const uniqueStructuralBlockers = unique(structuralBlockers)
  const technicallyAssembled = uniqueStructuralBlockers.length === 0 && rows.length === Number(waveManifest.rowCount)
  const onlyMissing = uniqueStructuralBlockers.length > 0 && uniqueStructuralBlockers.every((item) => item.startsWith('response_missing:'))
  const status = technicallyAssembled ? 'complete' : onlyMissing ? 'incomplete' : 'invalid'
  const outputRoot = confined(`handoffs/${waveEntry.wave}/${syntheticMode ? 'synthetic-assembled' : 'assembled'}`)
  fs.mkdirSync(outputRoot, { recursive: true })
  const resultsFile = path.join(outputRoot, 'assessment-results-v02.jsonl')
  if (fs.existsSync(resultsFile)) fs.rmSync(resultsFile, { force: true })
  if (technicallyAssembled) fs.writeFileSync(resultsFile, jsonl(rows))
  const reviewOrReleaseBlockers = [
    `human_review_required:${waveReviewCounts.humanReviewRequired}`,
    ...(waveReviewCounts.needsMoreResearchReviewRequired ? [`needs_more_research_review_required:${waveReviewCounts.needsMoreResearchReviewRequired}`] : []),
    ...(waveReviewCounts.identityResolutionRequired ? [`identity_resolution_required:${waveReviewCounts.identityResolutionRequired}`] : []),
    ...(syntheticMode ? ['synthetic_response_not_real_assessment'] : []),
  ]
  const waveResult = {
    wave: waveEntry.wave, status, inputRows: waveManifest.rowCount, responseRows: rows.length,
    technicallyAssembledRows: technicallyAssembled ? rows.length : 0, rows, structuralBlockers: uniqueStructuralBlockers,
    reviewOrReleaseBlockers, releaseEligible: false, waveReviewCounts, technicallyAssembled,
  }
  waveResults.push(waveResult)
  writeJson(path.join(outputRoot, 'assembly-summary-v02.json'), {
    version: VERSION, wave: waveEntry.wave, status, inputRows: waveManifest.rowCount, responseRows: rows.length,
    assembledRows: !syntheticMode && technicallyAssembled ? rows.length : 0,
    syntheticAssembledRows: syntheticMode && technicallyAssembled ? rows.length : 0,
    technicallyAssembledRows: technicallyAssembled ? rows.length : 0,
    genuineAssessmentComplete: !syntheticMode && technicallyAssembled,
    syntheticValidationComplete: syntheticMode && technicallyAssembled,
    identityOrderMismatches, structuralBlockers: uniqueStructuralBlockers, reviewOrReleaseBlockers,
    releaseEligible: false, normalPublicationGatePass: false, warnings: syntheticMode ? ['synthetic_rehearsal_outputs_are_test_only'] : [], safety: manifest.safety,
  })
}

const completedWaveCount = waveResults.filter((wave) => wave.status === 'complete').length
const incompleteWaveCount = waveResults.filter((wave) => wave.status === 'incomplete').length
const invalidWaveCount = waveResults.filter((wave) => wave.status === 'invalid').length
const structuralBlockers = unique([...packageStructuralBlockers, ...waveResults.flatMap((wave) => wave.structuralBlockers)])
const structurallyValid = structuralBlockers.length === 0 && completedWaveCount === manifest.waveCount && responseRows === manifest.inputRows
const genuineComplete = structurallyValid && !syntheticMode && syntheticRows === 0
const syntheticValidationComplete = structurallyValid && syntheticMode && syntheticRows === manifest.inputRows
const technicallyAssembledRows = waveResults.reduce((sum, wave) => sum + (wave.technicallyAssembled ? wave.rows.length : 0), 0)
const allRows = waveResults.flatMap((wave) => wave.rows)
const reviewCounts = waveResults.reduce((sum, wave) => ({
  humanReviewRequired: sum.humanReviewRequired + wave.waveReviewCounts.humanReviewRequired,
  needsMoreResearchReviewRequired: sum.needsMoreResearchReviewRequired + wave.waveReviewCounts.needsMoreResearchReviewRequired,
  identityResolutionRequired: sum.identityResolutionRequired + wave.waveReviewCounts.identityResolutionRequired,
}), { humanReviewRequired: 0, needsMoreResearchReviewRequired: 0, identityResolutionRequired: 0 })
const reviewOrReleaseBlockers = [
  `human_review_required:${reviewCounts.humanReviewRequired}`,
  ...(reviewCounts.needsMoreResearchReviewRequired ? [`needs_more_research_review_required:${reviewCounts.needsMoreResearchReviewRequired}`] : []),
  ...(reviewCounts.identityResolutionRequired ? [`identity_resolution_required:${reviewCounts.identityResolutionRequired}`] : []),
  ...(syntheticMode ? ['synthetic_response_not_real_assessment'] : []),
]
const aggregateRoot = confined(syntheticMode ? 'aggregate/synthetic-rehearsal' : 'aggregate')
fs.mkdirSync(aggregateRoot, { recursive: true })
const aggregateResults = path.join(aggregateRoot, 'assembled-results-v02.jsonl')
if (fs.existsSync(aggregateResults)) fs.rmSync(aggregateResults, { force: true })
if (genuineComplete || syntheticValidationComplete) {
  fs.writeFileSync(aggregateResults, jsonl(allRows))
  const reviewRoot = confined(syntheticMode ? 'review-lanes/synthetic-rehearsal' : 'review-lanes/assembled')
  fs.mkdirSync(reviewRoot, { recursive: true })
  for (const lane of Object.keys(laneCounts)) fs.writeFileSync(path.join(reviewRoot, `${lane}-v02.jsonl`), jsonl(allRows.filter((row) => row.researchDisposition === lane)))
}
const responseSha256 = [...declaredResponses.keys()].filter((rel) => fs.existsSync(confined(rel))).map((file) => ({ file, sha256: sha256File(confined(file)) }))
const summary = {
  version: VERSION, complete: genuineComplete, technicallyComplete: structurallyValid,
  genuineAssessmentComplete: genuineComplete, syntheticRehearsal: syntheticMode, syntheticValidationComplete,
  inputRows: manifest.inputRows, responseRows, assembledRows: genuineComplete ? allRows.length : 0,
  syntheticAssembledRows: syntheticValidationComplete ? allRows.length : 0, technicallyAssembledRows,
  completedWaveCount, incompleteWaveCount, invalidWaveCount, laneCounts, assessmentModeCounts: modeCounts,
  identityOrderMismatches, structuralBlockers, reviewOrReleaseBlockers, reviewOrReleaseBlockerCounts: reviewCounts,
  releaseEligible: false, normalPublicationGatePass: false, responseSha256,
  immutableRootSha256: integrity.rootSha256, preparedResearchOuterSha256: integrity.manifest.preparedResearchOuterSha256,
  warnings: syntheticMode ? ['synthetic_rehearsal_outputs_are_test_only'] : [], safety: manifest.safety,
}
writeJson(path.join(aggregateRoot, 'assembly-summary-v02.json'), summary)
console.log(JSON.stringify(summary, null, 2))
if (!genuineComplete && !syntheticValidationComplete) process.exitCode = 2
