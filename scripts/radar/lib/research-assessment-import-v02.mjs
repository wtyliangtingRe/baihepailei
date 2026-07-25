import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  ASSESSMENT_INPUT_OWNED_FIELDS,
  ASSESSMENT_OUTCOME_FIELDS,
  GRADE_ORDER,
  VERSION,
  archiveInventory,
  assertConfined,
  filesUnder,
  jsonl,
  readJsonl,
  sameJson,
  sha256File,
  validateOutcome,
  val,
  verifyImmutableRootReceipt,
} from './research-assessment-handoff-v02.mjs'

export const IMPORT_VERSION = 'ai-radar-research-assessment-import-v0.2'
export const PAGE_NOTICE = 'AI 综合，待复核'
export const IMPORT_SAFETY = Object.freeze({
  networkFetch: false,
  payloadRead: false,
  payloadWrite: false,
  payloadPatchRequests: 0,
  directPostgresqlRead: false,
  directPostgresqlWrite: false,
  postgresqlStatements: 0,
  modifiesWorks: false,
  worksMutations: 0,
  publishesRatings: false,
  publicationActions: 0,
  productionApplyAuthorized: false,
  createsProductionApplyPackage: false,
  migrationOrSchemaPush: false,
  automaticXAllowed: false,
  generatedDataConfinedToDataLocal: true,
  reviewArtifactsWrittenUnderExports: true,
  arbitraryOutputPathsAllowed: false,
  dryRunOnly: true,
})

const identityFields = ['workId', 'siteId', 'title', 'researchDisposition']
const harmlessRiskValues = new Set(['', 'none', 'none_found', 'false', 'unknown', 'not_found'])
const clone = (value) => structuredClone(value)
const unique = (values) => [...new Set(values)]
const countBy = (rows, key) => rows.reduce((counts, row) => {
  const value = typeof key === 'function' ? key(row) : row[key]
  counts[value] = (counts[value] || 0) + 1
  return counts
}, {})

function readJson(file, label = path.basename(file)) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`)
  }
}

function assertCount(actual, expected, label) {
  if (!Number.isInteger(Number(expected)) || Number(expected) < 0) throw new Error(`Acceptance binding requires ${label}`)
  if (actual !== Number(expected)) throw new Error(`${label} mismatch: ${actual}/${expected}`)
}

function assertSafety(safety, label) {
  const requiredFalse = [
    'payloadRead', 'payloadWrite', 'directPostgresqlRead', 'directPostgresqlWrite', 'modifiesWorks',
    'publishesRatings', 'productionApplyAuthorized', 'createsProductionApplyPackage', 'migrationOrSchemaPush', 'networkFetch',
  ]
  for (const key of requiredFalse) if (safety?.[key] !== false) throw new Error(`${label} safety mismatch: ${key}`)
  if (Number(safety?.payloadPatchRequests) !== 0) throw new Error(`${label} safety mismatch: payloadPatchRequests`)
  if (safety?.generatedDataConfinedToDataLocal !== true || safety?.reviewArtifactsWrittenUnderExports !== true || safety?.arbitraryOutputPathsAllowed !== false) {
    throw new Error(`${label} output-path safety mismatch`)
  }
}

function identityMatches(left, right) {
  return identityFields.every((key) => val(left?.[key]) === val(right?.[key]))
}

function responseOutcome(row) {
  return Object.fromEntries(ASSESSMENT_OUTCOME_FIELDS.map((key) => [key, row?.[key] ?? null]))
}

function assembledOutcome(row) {
  return Object.fromEntries(ASSESSMENT_OUTCOME_FIELDS.map((key) => [key, row?.assessment?.[key] ?? null]))
}

function ruleAssessments(row) {
  if (Array.isArray(row?.outcome?.ruleAssessments)) return row.outcome.ruleAssessments
  if (Array.isArray(row?.assessment?.ruleAssessments)) return row.assessment.ruleAssessments
  return Array.isArray(row?.ruleAssessments) ? row.ruleAssessments : []
}

function matchedRule(rule) {
  return rule?.matched !== false
}

function ruleCodePrefix(rule) {
  return /^([XEF])-/iu.exec(val(rule?.code))?.[1]?.toUpperCase() || null
}

export function ruleCodeGradeWarnings(row) {
  const workId = val(row?.workId) || '<unknown>'
  const warnings = []
  for (const rule of ruleAssessments(row).filter(matchedRule)) {
    const prefix = ruleCodePrefix(rule)
    const grade = val(rule?.grade).toUpperCase()
    if (prefix && grade !== prefix) warnings.push(`rule_code_grade_conflict:${workId}:${val(rule?.code)}:${grade || 'missing'}`)
  }
  return warnings
}

function automaticXFinding(row) {
  const values = [
    row?.assessmentMode === 'exact' ? row?.exactGradeSuggestion : null,
    row?.gradeRange?.best,
    row?.gradeRange?.likely,
    row?.gradeRange?.worst,
    row?.outcome?.type === 'exact' ? row?.outcome?.provisionalExactSuggestion : null,
    row?.outcome?.boundedRange?.best,
    row?.outcome?.boundedRange?.likely,
    row?.outcome?.boundedRange?.worst,
  ]
  if (values.some((value) => val(value).toUpperCase() === 'X')) return `automatic_x_grade:${val(row?.workId) || '<unknown>'}`
  for (const rule of ruleAssessments(row)) {
    const grade = val(rule?.grade).toUpperCase()
    const prefix = ruleCodePrefix(rule)
    if (grade === 'X' || (matchedRule(rule) && prefix === 'X')) {
      const conflict = prefix === 'X' && grade !== 'X' ? `:code_grade_conflict:${grade || 'missing'}` : ''
      return `automatic_x_rule:${val(row?.workId) || '<unknown>'}:${val(rule?.code) || '<missing-code>'}:${grade || 'missing'}${conflict}`
    }
  }
  return null
}

function assertRowReleaseState(input, response, assembled) {
  if (input.requiresHumanReview !== true || response.requiresHumanReview !== true || assembled.requiresHumanReview !== true || assembled.assessment?.requiresHumanReview !== true) {
    throw new Error(`Human-review requirement missing: ${input.workId}`)
  }
  if (input.publicationEligible !== false || response.publicationEligible !== false || assembled.publicationEligible !== false || assembled.assessment?.publicationEligible !== false) {
    throw new Error(`Publication-ineligible state missing: ${input.workId}`)
  }
  if (assembled.releaseEligible !== false || assembled.normalPublicationGatePass !== false) throw new Error(`Release gate opened: ${input.workId}`)
  if (input.pageNotice !== PAGE_NOTICE || response.pageNotice !== PAGE_NOTICE || assembled.pageNotice !== PAGE_NOTICE) throw new Error(`Page wording mismatch: ${input.workId}`)
  const blockers = Array.isArray(assembled.reviewOrReleaseBlockers) ? assembled.reviewOrReleaseBlockers : []
  if (input.researchDisposition === 'needs_more_research' && !blockers.some((item) => item === `needs_more_research_review_required:${input.workId}`)) {
    throw new Error(`Needs-more-research release blocker missing: ${input.workId}`)
  }
  if (input.researchDisposition === 'identity_review' && !blockers.some((item) => item === `identity_resolution_required:${input.workId}`)) {
    throw new Error(`Identity-resolution release blocker missing: ${input.workId}`)
  }
}

function assertExpectedCounts(actual, expected, label) {
  for (const [key, count] of Object.entries(expected || {})) if (Number(actual[key] || 0) !== Number(count)) throw new Error(`${label} mismatch: ${key}:${actual[key] || 0}/${count}`)
}

function canonicalFilesAreConfined(root) {
  const canonicalRoot = fs.realpathSync(root)
  for (const relative of filesUnder(root)) {
    const canonical = fs.realpathSync(assertConfined(root, relative, 'extracted package path'))
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error(`Canonical path escaped package root: ${relative}`)
  }
}

export function assertUnderRoot(root, target, label) {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(target)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`${label} must remain under ${resolvedRoot}`)
  return resolved
}

export function assertImportOutputPath(target, dataLocalRoot = path.resolve('data_local')) {
  return assertUnderRoot(dataLocalRoot, target, 'Import output')
}

export function extractAssessmentPackage(input, expectedSha256, stagingRoot, options = {}) {
  const source = path.resolve(input)
  if (!fs.existsSync(source)) throw new Error(`Assessment ZIP not found: ${input}`)
  const sourceIsFile = fs.statSync(source).isFile()
  if (!sourceIsFile) {
    if (!options.allowExtractedDirectory) throw new Error('Assessment input must be a ZIP')
    canonicalFilesAreConfined(source)
    return { root: source, outerSha256: null, inventory: new Set(filesUnder(source)) }
  }
  if (!/\.zip$/iu.test(source)) throw new Error('Assessment input must be a ZIP')
  if (!val(expectedSha256)) throw new Error('Expected outer SHA-256 is required')
  const outerSha256 = sha256File(source)
  if (outerSha256.toUpperCase() !== val(expectedSha256).toUpperCase()) throw new Error('Outer assessment ZIP SHA-256 mismatch')
  const inventory = archiveInventory(source)
  const scratch = assertImportOutputPath(stagingRoot, options.dataLocalRoot)
  fs.rmSync(scratch, { recursive: true, force: true })
  fs.mkdirSync(scratch, { recursive: true })
  execFileSync('tar', ['-xf', source, '-C', scratch])
  canonicalFilesAreConfined(scratch)
  const actual = filesUnder(scratch)
  for (const relative of actual) if (!inventory.has(relative)) throw new Error(`Extracted file absent from ZIP inventory: ${relative}`)
  for (const relative of inventory) if (!actual.includes(relative)) throw new Error(`ZIP entry missing after extraction: ${relative}`)
  return { root: scratch, outerSha256, inventory }
}

export function validateAssessmentPackageRoot(root, acceptance = {}, outerSha256 = null) {
  const integrity = verifyImmutableRootReceipt(root)
  const manifestFile = path.join(root, 'package-manifest.json')
  const manifest = readJson(manifestFile, 'package-manifest.json')
  if (manifest.version !== VERSION) throw new Error('Package version mismatch')
  if (acceptance.packageId && manifest.packageId !== acceptance.packageId) throw new Error('Package ID mismatch')
  if (acceptance.preparedResearchOuterSha256 && val(manifest.preparedResearchOuterSha256).toUpperCase() !== val(acceptance.preparedResearchOuterSha256).toUpperCase()) {
    throw new Error('Prepared research SHA-256 evidence mismatch')
  }
  if (manifest.preparedResearchOuterSha256 !== integrity.manifest.preparedResearchOuterSha256 || manifest.sourceOuterSha256 !== integrity.manifest.preparedResearchOuterSha256) {
    throw new Error('Prepared research integrity evidence mismatch')
  }
  assertSafety(manifest.safety, 'Package manifest')
  const expectedWaveCount = Number(acceptance.waveCount)
  const expectedRows = Number(acceptance.rowCount)
  assertCount(Number(manifest.waveCount), expectedWaveCount, 'waveCount')
  assertCount(Number(manifest.inputRows), expectedRows, 'rowCount')
  if (!Array.isArray(manifest.waves) || manifest.waves.length !== expectedWaveCount) throw new Error('Package Wave inventory mismatch')
  for (const requiredImmutable of ['aggregate/immutable-input-v02.jsonl', 'instructions/response-schema-v02.json', 'package-manifest.json']) {
    if (!integrity.files.has(requiredImmutable)) throw new Error(`Required immutable file is not anchored: ${requiredImmutable}`)
  }

  const aggregateSummary = readJson(path.join(root, 'aggregate/assembly-summary-v02.json'), 'aggregate assembly summary')
  if (aggregateSummary.version !== VERSION || aggregateSummary.complete !== true || aggregateSummary.technicallyComplete !== true || aggregateSummary.genuineAssessmentComplete !== true) {
    throw new Error('Aggregate assessment package is not genuinely complete')
  }
  if (aggregateSummary.syntheticRehearsal === true || aggregateSummary.syntheticValidationComplete === true) throw new Error('Synthetic assessment package forbidden')
  if ((aggregateSummary.structuralBlockers || []).length !== 0) throw new Error(`Structural blockers present: ${(aggregateSummary.structuralBlockers || []).join(',')}`)
  if (aggregateSummary.releaseEligible !== false || aggregateSummary.normalPublicationGatePass !== false) throw new Error('Aggregate release gate must remain closed')
  assertSafety(aggregateSummary.safety, 'Aggregate summary')
  for (const [key, expected] of [['inputRows', expectedRows], ['responseRows', expectedRows], ['assembledRows', expectedRows], ['technicallyAssembledRows', expectedRows], ['completedWaveCount', expectedWaveCount], ['incompleteWaveCount', 0], ['invalidWaveCount', 0], ['identityOrderMismatches', 0]]) {
    assertCount(Number(aggregateSummary[key]), expected, key)
  }
  if (outerSha256 && acceptance.outerSha256 && outerSha256.toUpperCase() !== val(acceptance.outerSha256).toUpperCase()) throw new Error('Acceptance-bound outer SHA-256 mismatch')

  const declaredResponses = new Set()
  const responseHashes = new Map((aggregateSummary.responseSha256 || []).map((entry) => [val(entry?.file).replace(/\\/gu, '/'), val(entry?.sha256).toLowerCase()]))
  const allInputs = []
  const allResponses = []
  const allAssembled = []
  const waves = []
  let identityOrderMismatches = 0
  let inputOwnedRewriteMismatches = 0
  let outcomeMismatches = 0
  let automaticXGrades = 0
  const automaticXFindings = []
  const seenWaves = new Set()

  for (let waveIndex = 0; waveIndex < manifest.waves.length; waveIndex += 1) {
    const waveEntry = manifest.waves[waveIndex]
    const wave = val(waveEntry.wave)
    if (seenWaves.has(wave)) throw new Error(`Duplicate Wave declaration: ${wave}`)
    seenWaves.add(wave)
    if (Number(waveEntry.index) !== waveIndex + 1) throw new Error(`Wave order mismatch: ${wave}`)
    const manifestRelative = val(waveEntry.manifestFile).replace(/\\/gu, '/')
    if (!integrity.files.has(manifestRelative)) throw new Error(`Wave manifest is not immutable: ${wave}`)
    const waveManifestFile = assertConfined(root, manifestRelative, 'Wave manifest path')
    if (sha256File(waveManifestFile) !== val(waveEntry.manifestSha256).toLowerCase()) throw new Error(`Wave manifest hash mismatch: ${wave}`)
    const waveManifest = readJson(waveManifestFile, `${wave} manifest`)
    if (waveManifest.version !== VERSION || waveManifest.wave !== wave || !Array.isArray(waveManifest.chunks) || waveManifest.chunks.length === 0) throw new Error(`Invalid Wave manifest: ${wave}`)
    assertCount(Number(waveManifest.rowCount), Number(waveEntry.rowCount), `${wave} rowCount`)

    const waveSummary = readJson(assertConfined(root, waveManifest.outputs?.assemblySummary || `handoffs/${wave}/assembled/assembly-summary-v02.json`, 'Wave summary path'), `${wave} assembly summary`)
    if (waveSummary.status !== 'complete' || waveSummary.genuineAssessmentComplete !== true || (waveSummary.structuralBlockers || []).length !== 0) throw new Error(`Wave is incomplete or invalid: ${wave}`)
    if (waveSummary.releaseEligible !== false || waveSummary.normalPublicationGatePass !== false || Number(waveSummary.identityOrderMismatches) !== 0) throw new Error(`Wave release or mismatch state invalid: ${wave}`)
    assertSafety(waveSummary.safety, `${wave} summary`)
    const waveResponseHashes = new Map((waveSummary.responseSha256 || []).map((entry) => [val(entry?.file).replace(/\\/gu, '/'), val(entry?.sha256).toLowerCase()]))

    const waveInputRows = []
    const waveResponseRows = []
    for (const chunk of waveManifest.chunks) {
      const inputRelative = val(chunk.inputFile).replace(/\\/gu, '/')
      const responseRelative = val(chunk.responseFile).replace(/\\/gu, '/')
      if (!integrity.files.has(inputRelative)) throw new Error(`Chunk input is not immutable: ${chunk.chunkId}`)
      const inputFile = assertConfined(root, inputRelative, 'Chunk input path')
      if (sha256File(inputFile) !== val(chunk.inputSha256).toLowerCase()) throw new Error(`Chunk input hash mismatch: ${chunk.chunkId}`)
      if (declaredResponses.has(responseRelative)) throw new Error(`Duplicate response declaration: ${responseRelative}`)
      declaredResponses.add(responseRelative)
      const responseFile = assertConfined(root, responseRelative, 'Response path')
      if (!fs.existsSync(responseFile)) throw new Error(`Declared response missing: ${responseRelative}`)
      if (!responseHashes.has(responseRelative) || sha256File(responseFile) !== responseHashes.get(responseRelative)) throw new Error(`Response SHA-256 mismatch: ${responseRelative}`)
      if (!waveResponseHashes.has(responseRelative) || waveResponseHashes.get(responseRelative) !== responseHashes.get(responseRelative)) throw new Error(`Wave response SHA-256 mismatch: ${responseRelative}`)
      const inputs = readJsonl(inputFile)
      const responses = readJsonl(responseFile)
      assertCount(inputs.length, Number(chunk.rowCount), `${chunk.chunkId} input rows`)
      assertCount(responses.length, inputs.length, `${chunk.chunkId} response rows`)
      if (!Array.isArray(chunk.expectedOrder) || chunk.expectedOrder.length !== inputs.length) throw new Error(`Expected-order contract mismatch: ${chunk.chunkId}`)
      for (let index = 0; index < inputs.length; index += 1) {
        if (!identityMatches(inputs[index], chunk.expectedOrder[index])) throw new Error(`Input manifest identity/order mismatch: ${chunk.chunkId}:${index + 1}`)
      }
      waveInputRows.push(...inputs)
      waveResponseRows.push(...responses)
    }
    if (waveResponseHashes.size !== waveManifest.chunks.length) throw new Error(`Wave response hash inventory mismatch: ${wave}`)
    const waveImmutableRelative = val(waveManifest.immutableInputFile).replace(/\\/gu, '/')
    if (!integrity.files.has(waveImmutableRelative)) throw new Error(`Wave immutable input is not anchored: ${wave}`)
    const waveImmutableFile = assertConfined(root, waveImmutableRelative, 'Wave immutable input path')
    if (sha256File(waveImmutableFile) !== val(waveManifest.immutableInputSha256).toLowerCase()) throw new Error(`Wave immutable input hash mismatch: ${wave}`)
    const waveImmutableRows = readJsonl(waveImmutableFile)
    if (!sameJson(waveImmutableRows, waveInputRows)) throw new Error(`Wave immutable/chunk input equality mismatch: ${wave}`)

    const assembledRelative = waveManifest.outputs?.assembledResults || `handoffs/${wave}/assembled/assessment-results-v02.jsonl`
    const waveAssembledRows = readJsonl(assertConfined(root, assembledRelative, 'Wave assembled path'))
    for (const [label, rows] of [['input', waveInputRows], ['response', waveResponseRows], ['assembled', waveAssembledRows]]) assertCount(rows.length, Number(waveManifest.rowCount), `${wave} ${label} rows`)
    for (let index = 0; index < waveInputRows.length; index += 1) {
      const input = waveInputRows[index]
      const response = waveResponseRows[index]
      const assembled = waveAssembledRows[index]
      if (!identityMatches(input, response) || !identityMatches(response, assembled)) identityOrderMismatches += 1
      for (const key of ASSESSMENT_INPUT_OWNED_FIELDS) {
        if (!sameJson(input[key], response[key]) || !sameJson(input[key], assembled[key])) inputOwnedRewriteMismatches += 1
      }
      validateOutcome(response, input.researchDisposition)
      if (!sameJson(responseOutcome(response), assembledOutcome(assembled)) || !sameJson(response.riskLabels, assembled.assessment?.riskLabels)) outcomeMismatches += 1
      const automaticX = automaticXFinding(response)
      if (automaticX) {
        automaticXGrades += 1
        automaticXFindings.push(automaticX)
      }
      assertRowReleaseState(input, response, assembled)
    }
    allInputs.push(...waveInputRows)
    allResponses.push(...waveResponseRows)
    allAssembled.push(...waveAssembledRows)
    waves.push({ wave, manifest: waveManifest, summary: waveSummary, inputRows: waveInputRows, responseRows: waveResponseRows, assembledRows: waveAssembledRows })
  }

  const actualResponses = filesUnder(root).filter((relative) => /(^|\/)responses\/|\.output\.jsonl$/u.test(relative))
  if (actualResponses.length !== declaredResponses.size || actualResponses.some((relative) => !declaredResponses.has(relative))) throw new Error('Closed-world response inventory mismatch')
  if (responseHashes.size !== declaredResponses.size || [...responseHashes.keys()].some((relative) => !declaredResponses.has(relative))) throw new Error('Aggregate response hash inventory mismatch')

  const aggregateInput = readJsonl(path.join(root, 'aggregate/immutable-input-v02.jsonl'))
  const aggregateAssembled = readJsonl(path.join(root, 'aggregate/assembled-results-v02.jsonl'))
  if (!sameJson(aggregateInput, allInputs)) throw new Error('Aggregate/Wave input identity and order mismatch')
  if (!sameJson(aggregateAssembled, allAssembled)) throw new Error('Aggregate/Wave assembled identity and order mismatch')
  for (const [label, rows] of [['input', allInputs], ['response', allResponses], ['assembled', allAssembled]]) assertCount(rows.length, expectedRows, `${label}Rows`)
  if (identityOrderMismatches !== 0) throw new Error(`Input-response-assembled identity/order mismatches: ${identityOrderMismatches}`)
  if (inputOwnedRewriteMismatches !== 0) throw new Error(`Input-owned field rewrite mismatches: ${inputOwnedRewriteMismatches}`)
  if (outcomeMismatches !== 0) throw new Error(`Response-assembled outcome mismatches: ${outcomeMismatches}`)
  if (automaticXGrades !== 0) throw new Error(`Automatic X grades forbidden: ${automaticXGrades}; ${automaticXFindings[0]}`)

  const outcomeCounts = countBy(allResponses, 'assessmentMode')
  const laneCounts = countBy(allInputs, 'researchDisposition')
  assertExpectedCounts(outcomeCounts, acceptance.outcomeCounts, 'Outcome count')
  assertExpectedCounts(laneCounts, acceptance.laneCounts, 'Research lane count')
  assertExpectedCounts(aggregateSummary.assessmentModeCounts, acceptance.outcomeCounts, 'Aggregate outcome count')
  assertExpectedCounts(aggregateSummary.laneCounts, acceptance.laneCounts, 'Aggregate research lane count')

  return {
    root,
    manifest,
    aggregateSummary,
    integrity,
    waves,
    inputRows: allInputs,
    responseRows: allResponses,
    assembledRows: allAssembled,
    counts: { outcome: outcomeCounts, researchLane: laneCounts },
    verification: {
      inputRows: allInputs.length,
      responseRows: allResponses.length,
      assembledRows: allAssembled.length,
      verifiedRows: allAssembled.length,
      completedWaves: waves.length,
      incompleteWaves: 0,
      invalidWaves: 0,
      declaredResponseFiles: declaredResponses.size,
      verifiedResponseFiles: responseHashes.size,
      identityOrderMismatches,
      inputOwnedRewriteMismatches,
      outcomeMismatches,
      automaticXGrades,
      structuralBlockers: [],
      warnings: aggregateSummary.warnings || [],
    },
  }
}

export function loadAssessmentImportPackage({ input, expectedSha256, stagingRoot, acceptance, dataLocalRoot, allowExtractedDirectory = false }) {
  const extracted = extractAssessmentPackage(input, expectedSha256, stagingRoot, { dataLocalRoot, allowExtractedDirectory })
  return { ...validateAssessmentPackageRoot(extracted.root, acceptance, extracted.outerSha256), outerSha256: extracted.outerSha256 }
}

export function normalizeImportRow(assembled, trace = {}) {
  const mode = assembled.assessment.assessmentMode
  const common = {
    riskLabels: clone(assembled.assessment.riskLabels),
    ruleAssessments: clone(assembled.assessment.ruleAssessments),
  }
  let outcome
  if (mode === 'exact') {
    outcome = { type: 'exact', provisionalExactSuggestion: assembled.assessment.exactGradeSuggestion, ...common }
  } else if (mode === 'bounded_range') {
    outcome = { type: 'bounded_range', boundedRange: clone(assembled.assessment.gradeRange), ...common }
  } else if (mode === 'labels_only') {
    outcome = { type: 'labels_only', insufficientCertainty: true, ...common }
  } else {
    throw new Error(`Unknown assembled outcome: ${mode}`)
  }
  const inputOwned = Object.fromEntries(ASSESSMENT_INPUT_OWNED_FIELDS.map((key) => [key, clone(assembled[key])]))
  const releaseBlockers = [
    `human_review_required:${assembled.workId}`,
    ...(assembled.reviewOrReleaseBlockers || []),
  ]
  const reviewWarnings = ruleCodeGradeWarnings(assembled)
  return {
    ...inputOwned,
    importTrace: clone(trace),
    outcome,
    reviewOrReleaseBlockers: unique(releaseBlockers),
    reviewWarnings,
    requiresHumanReview: true,
    publicationEligible: false,
    releaseEligible: false,
    normalPublicationGatePass: false,
    pageNotice: PAGE_NOTICE,
  }
}

function isMaterialRisk(value) {
  if (typeof value === 'boolean') return value
  return !harmlessRiskValues.has(val(value).toLowerCase())
}

function severeRule(row) {
  return ruleAssessments(row).some((rule) => matchedRule(rule) && (
    ['E', 'F'].includes(val(rule?.grade).toUpperCase()) || ['E', 'F'].includes(ruleCodePrefix(rule))
  ))
}

function csv(value) {
  const text = value == null ? '' : Array.isArray(value) ? value.join('|') : String(value)
  return `"${text.replace(/"/gu, '""')}"`
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, jsonl(rows))
}

function relativeFiles(root) {
  return filesUnder(root).filter((relative) => relative !== 'SHA256SUMS')
}

export function writeImportReviewOutputs(validated, outputRoot, dataLocalRoot = path.resolve('data_local')) {
  const root = assertImportOutputPath(outputRoot, dataLocalRoot)
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })
  const rows = []
  let offset = 0
  for (const wave of validated.waves) {
    for (let index = 0; index < wave.assembledRows.length; index += 1) {
      rows.push(normalizeImportRow(wave.assembledRows[index], { wave: wave.wave, waveIndex: index + 1, packageIndex: offset + index + 1 }))
    }
    offset += wave.assembledRows.length
  }
  const outcomes = {
    exact: rows.filter((row) => row.outcome.type === 'exact'),
    bounded_range: rows.filter((row) => row.outcome.type === 'bounded_range'),
    labels_only: rows.filter((row) => row.outcome.type === 'labels_only'),
  }
  const lanes = {
    ready_for_ai_assessment: rows.filter((row) => row.researchDisposition === 'ready_for_ai_assessment'),
    needs_more_research: rows.filter((row) => row.researchDisposition === 'needs_more_research'),
    identity_review: rows.filter((row) => row.researchDisposition === 'identity_review'),
  }
  const risks = {
    severe_e_f_rule: rows.filter(severeRule),
    male_involvement: rows.filter((row) => isMaterialRisk(row.contentProfile.maleInvolvement)),
    ntr: rows.filter((row) => isMaterialRisk(row.contentProfile.ntrRisk)),
    ts: rows.filter((row) => row.contentProfile.ts === true),
    futa: rows.filter((row) => row.contentProfile.futa === true),
    abo: rows.filter((row) => row.contentProfile.abo === true),
    crossdressing_or_otokonoko: rows.filter((row) => row.contentProfile.crossdressingOrOtokonoko === true),
  }
  writeJsonl(path.join(root, 'rows/all-imported-review-v02.jsonl'), rows)
  for (const [mode, selected] of Object.entries(outcomes)) writeJsonl(path.join(root, `outcomes/${mode.replace(/_/gu, '-')}-v02.jsonl`), selected)
  for (const [lane, selected] of Object.entries(lanes)) writeJsonl(path.join(root, `lanes/${lane.replace(/_/gu, '-')}-v02.jsonl`), selected)
  for (const [risk, selected] of Object.entries(risks)) writeJsonl(path.join(root, `risks/${risk.replace(/_/gu, '-')}-rows-v02.jsonl`), selected)

  const waveSummaries = validated.waves.map((wave) => {
    const selected = rows.filter((row) => row.importTrace.wave === wave.wave)
    const waveWarnings = selected.flatMap((row) => row.reviewWarnings)
    const summary = {
      version: IMPORT_VERSION,
      wave: wave.wave,
      status: 'complete',
      importedRows: selected.length,
      outcomeCounts: countBy(selected, (row) => row.outcome.type),
      researchLaneCounts: countBy(selected, 'researchDisposition'),
      identityOrderMismatches: 0,
      inputOwnedRewriteMismatches: 0,
      structuralBlockers: [],
      warnings: waveWarnings,
      reviewOrReleaseBlockerCounts: {
        humanReviewRequired: selected.length,
        needsMoreResearchReviewRequired: selected.filter((row) => row.researchDisposition === 'needs_more_research').length,
        identityResolutionRequired: selected.filter((row) => row.researchDisposition === 'identity_review').length,
      },
      releaseEligible: false,
      normalPublicationGatePass: false,
      safety: IMPORT_SAFETY,
    }
    writeJson(path.join(root, `waves/${wave.wave}/import-summary-v02.json`), summary)
    return summary
  })
  const blockerWarningIndex = {
    structuralBlockers: [],
    reviewOrReleaseBlockers: [
      `human_review_required:${rows.length}`,
      ...(lanes.needs_more_research.length ? [`needs_more_research_review_required:${lanes.needs_more_research.length}`] : []),
      ...(lanes.identity_review.length ? [`identity_resolution_required:${lanes.identity_review.length}`] : []),
    ],
    warnings: unique([...validated.verification.warnings, ...rows.flatMap((row) => row.reviewWarnings)]),
  }
  writeJson(path.join(root, 'aggregate/blocker-warning-index-v02.json'), blockerWarningIndex)
  const summary = {
    version: IMPORT_VERSION,
    packageId: validated.manifest.packageId,
    sourceOuterSha256: validated.outerSha256,
    immutableRootSha256: validated.integrity.rootSha256,
    importedRows: rows.length,
    inputRows: validated.verification.inputRows,
    responseRows: validated.verification.responseRows,
    assembledRows: validated.verification.assembledRows,
    outcomeCounts: Object.fromEntries(Object.entries(outcomes).map(([key, value]) => [key, value.length])),
    researchLaneCounts: Object.fromEntries(Object.entries(lanes).map(([key, value]) => [key, value.length])),
    riskReviewCounts: Object.fromEntries(Object.entries(risks).map(([key, value]) => [key, value.length])),
    completedWaveCount: waveSummaries.length,
    incompleteWaveCount: 0,
    invalidWaveCount: 0,
    identityOrderMismatches: 0,
    inputOwnedRewriteMismatches: 0,
    outcomeMismatches: 0,
    automaticXGrades: 0,
    structuralBlockers: [],
    reviewOrReleaseBlockers: blockerWarningIndex.reviewOrReleaseBlockers,
    warnings: blockerWarningIndex.warnings,
    requiresHumanReview: true,
    publicationEligible: false,
    releaseEligible: false,
    normalPublicationGatePass: false,
    dryRunOnly: true,
    pageNotice: PAGE_NOTICE,
    safety: IMPORT_SAFETY,
  }
  writeJson(path.join(root, 'aggregate/import-summary-v02.json'), summary)
  const header = ['packageIndex', 'wave', 'workId', 'siteId', 'title', 'researchLane', 'outcomeType', 'provisionalExactSuggestion', 'best', 'likely', 'worst', 'identityResolutionRequired', 'pageNotice']
  const lines = [header.map(csv).join(',')]
  for (const row of rows) {
    const values = [
      row.importTrace.packageIndex, row.importTrace.wave, row.workId, row.siteId, row.title, row.researchDisposition, row.outcome.type,
      row.outcome.provisionalExactSuggestion || '', row.outcome.boundedRange?.best || '', row.outcome.boundedRange?.likely || '',
      row.outcome.boundedRange?.worst || '', row.researchDisposition === 'identity_review', row.pageNotice,
    ]
    lines.push(values.map(csv).join(','))
  }
  fs.writeFileSync(path.join(root, 'aggregate/human-review-index-v02.csv'), `${lines.join('\n')}\n`)
  const checksums = relativeFiles(root).map((relative) => `${sha256File(path.join(root, relative))}  ${relative}`).join('\n')
  fs.writeFileSync(path.join(root, 'SHA256SUMS'), `${checksums}\n`)
  return { root, rows, outcomes, lanes, risks, waveSummaries, summary }
}

export function validatePlannerRow(row, index = 0) {
  const label = val(row?.workId) || `row-${index + 1}`
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid planner row: ${label}`)
  if (row.requiresHumanReview !== true || row.publicationEligible !== false || row.releaseEligible !== false || row.normalPublicationGatePass !== false) {
    throw new Error(`Planner row release/publication gate opened: ${label}`)
  }
  if (row.pageNotice !== PAGE_NOTICE) throw new Error(`Planner row page wording mismatch: ${label}`)
  const type = val(row?.outcome?.type)
  if (!['exact', 'bounded_range', 'labels_only'].includes(type)) throw new Error(`Invalid planner outcome type: ${label}:${type || 'missing'}`)
  if (!Array.isArray(row.outcome.riskLabels) || !Array.isArray(row.outcome.ruleAssessments)) throw new Error(`Invalid planner outcome evidence: ${label}`)
  const automaticX = automaticXFinding(row)
  if (automaticX) throw new Error(`Automatic X grades forbidden in planner row: ${automaticX}`)
  const hasFinalGrade = Object.prototype.hasOwnProperty.call(row, 'finalGrade') || Object.prototype.hasOwnProperty.call(row.outcome, 'finalGrade')
  if (type === 'exact') {
    const exact = val(row.outcome.provisionalExactSuggestion).toUpperCase()
    if (!GRADE_ORDER.includes(exact) || exact === 'X' || row.outcome.boundedRange != null) throw new Error(`Invalid exact planner outcome: ${label}`)
  } else if (type === 'bounded_range') {
    const range = row.outcome.boundedRange
    const grades = range && [val(range.best).toUpperCase(), val(range.likely).toUpperCase(), val(range.worst).toUpperCase()]
    const indexes = grades?.map((grade) => GRADE_ORDER.indexOf(grade))
    if (hasFinalGrade || row.outcome.provisionalExactSuggestion != null || !grades || grades.some((grade) => !GRADE_ORDER.includes(grade) || grade === 'X') || indexes[0] > indexes[1] || indexes[1] > indexes[2]) {
      throw new Error(`Invalid bounded-range planner outcome: ${label}`)
    }
  } else if (hasFinalGrade || row.outcome.provisionalExactSuggestion != null || row.outcome.boundedRange != null || row.outcome.insufficientCertainty !== true) {
    throw new Error(`Invalid labels-only planner outcome: ${label}`)
  }
  return ruleCodeGradeWarnings(row)
}

function checksumEntries(root) {
  const receiptFile = path.join(root, 'SHA256SUMS')
  if (!fs.existsSync(receiptFile)) throw new Error('Importer SHA256SUMS missing')
  const entries = new Map()
  const lines = fs.readFileSync(receiptFile, 'utf8').trim().split(/\r?\n/u).filter(Boolean)
  if (lines.length === 0) throw new Error('Importer SHA256SUMS is empty')
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/iu.exec(line)
    if (!match) throw new Error(`Invalid importer SHA256SUMS entry: ${line}`)
    const relative = match[2].replace(/\\/gu, '/')
    const file = assertConfined(root, relative, 'import checksum path')
    if (entries.has(relative)) throw new Error(`Duplicate importer SHA256SUMS entry: ${relative}`)
    entries.set(relative, { file, sha256: match[1].toLowerCase() })
  }
  return entries
}

function verifyChecksumEntry(entries, relative, label) {
  const entry = entries.get(relative)
  if (!entry) throw new Error(`${label} is not listed in importer SHA256SUMS: ${relative}`)
  if (!fs.existsSync(entry.file) || sha256File(entry.file) !== entry.sha256) throw new Error(`${label} SHA-256 mismatch: ${relative}`)
  return entry.file
}

export function loadValidatedPlannerInput(outputRoot, rowsFile, dataLocalRoot = path.resolve('data_local')) {
  const root = assertImportOutputPath(outputRoot, dataLocalRoot)
  const canonicalRowsRelative = 'rows/all-imported-review-v02.jsonl'
  const canonicalRowsFile = path.join(root, canonicalRowsRelative)
  const requestedRowsFile = assertImportOutputPath(rowsFile, dataLocalRoot)
  if (path.resolve(requestedRowsFile) !== path.resolve(canonicalRowsFile)) throw new Error('Planner rows must be the canonical completed importer output')
  const entries = checksumEntries(root)
  const verifiedRowsFile = verifyChecksumEntry(entries, canonicalRowsRelative, 'Importer rows file')
  const summaryRelative = 'aggregate/import-summary-v02.json'
  const summaryFile = verifyChecksumEntry(entries, summaryRelative, 'Importer aggregate summary')
  const summary = readJson(summaryFile, 'import aggregate summary')
  const rows = readJsonl(verifiedRowsFile)
  if (Number(summary.importedRows) !== rows.length) throw new Error(`Importer summary row count mismatch: ${summary.importedRows}/${rows.length}`)
  if (!Array.isArray(summary.structuralBlockers) || summary.structuralBlockers.length !== 0) throw new Error('Importer summary has structural blockers')
  for (const key of ['identityOrderMismatches', 'inputOwnedRewriteMismatches', 'outcomeMismatches', 'automaticXGrades']) {
    if (Number(summary[key]) !== 0) throw new Error(`Importer summary ${key} must be zero`)
  }
  if (summary.releaseEligible !== false || summary.normalPublicationGatePass !== false || summary.dryRunOnly !== true || summary.safety?.dryRunOnly !== true) {
    throw new Error('Importer summary release or dry-run safety state invalid')
  }
  const rowWarnings = rows.flatMap((row, index) => validatePlannerRow(row, index))
  return {
    root,
    rows,
    summary,
    rowWarnings,
    integrity: {
      rowsRelative: canonicalRowsRelative,
      rowsSha256: entries.get(canonicalRowsRelative).sha256,
      summarySha256: entries.get(summaryRelative).sha256,
    },
  }
}

export function buildWebsiteRepresentationPlan(rows) {
  const rowWarnings = rows.flatMap((row, index) => validatePlannerRow(row, index))
  const records = rows.map((row) => {
    const common = {
      representationKind: row.researchDisposition === 'identity_review' ? 'identity_unresolved' : row.outcome.type,
      workId: row.workId,
      siteId: row.siteId,
      title: row.title,
      pageNotice: PAGE_NOTICE,
      requiresHumanReview: true,
      publicationEligible: false,
      releaseEligible: false,
      normalPublicationGatePass: false,
      riskLabels: clone(row.outcome.riskLabels),
      ruleAssessments: clone(row.outcome.ruleAssessments),
      identityResolutionRequired: row.researchDisposition === 'identity_review',
    }
    if (row.outcome.type === 'exact') return { ...common, provisionalExactSuggestion: row.outcome.provisionalExactSuggestion }
    if (row.outcome.type === 'bounded_range') return { ...common, boundedRange: clone(row.outcome.boundedRange) }
    return { ...common, insufficientCertainty: true }
  })
  const counts = {
    records: records.length,
    provisionalExact: rows.filter((row) => row.outcome.type === 'exact').length,
    boundedRange: rows.filter((row) => row.outcome.type === 'bounded_range').length,
    labelsOnly: rows.filter((row) => row.outcome.type === 'labels_only').length,
    needsMoreResearch: rows.filter((row) => row.researchDisposition === 'needs_more_research').length,
    identityUnresolved: rows.filter((row) => row.researchDisposition === 'identity_review').length,
    payloadPatchRequests: 0,
    postgresqlStatements: 0,
    worksMutations: 0,
    publicationActions: 0,
  }
  return {
    records,
    summary: {
      version: IMPORT_VERSION,
      dryRun: true,
      counts,
      structuralBlockers: [],
      reviewOrReleaseBlockers: [
        `human_review_required:${records.length}`,
        ...(counts.needsMoreResearch ? [`needs_more_research_review_required:${counts.needsMoreResearch}`] : []),
        ...(counts.identityUnresolved ? [`identity_resolution_required:${counts.identityUnresolved}`] : []),
      ],
      warnings: unique(rowWarnings),
      releaseEligible: false,
      normalPublicationGatePass: false,
      safety: IMPORT_SAFETY,
    },
  }
}

export function writeWebsiteRepresentationPlan(rows, outputRoot, dataLocalRoot = path.resolve('data_local')) {
  const root = assertImportOutputPath(outputRoot, dataLocalRoot)
  fs.mkdirSync(root, { recursive: true })
  const plan = buildWebsiteRepresentationPlan(rows)
  writeJsonl(path.join(root, 'website-plan/representation-records-v02.jsonl'), plan.records)
  writeJson(path.join(root, 'website-plan/representation-summary-v02.json'), plan.summary)
  const checksumFile = path.join(root, 'SHA256SUMS')
  const checksums = relativeFiles(root).map((relative) => `${sha256File(path.join(root, relative))}  ${relative}`).join('\n')
  fs.writeFileSync(checksumFile, `${checksums}\n`)
  return plan
}
