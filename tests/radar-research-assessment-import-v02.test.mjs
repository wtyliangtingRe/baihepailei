import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ASSESSMENT_INPUT_OWNED_FIELDS,
  VERSION,
  archiveInventory,
  jsonl,
  rejectWriteFlags,
  sha256File,
  writeImmutableRootReceipt,
} from '../scripts/radar/lib/research-assessment-handoff-v02.mjs'
import {
  IMPORT_SAFETY,
  PAGE_NOTICE,
  assertImportOutputPath,
  buildWebsiteRepresentationPlan,
  extractAssessmentPackage,
  normalizeImportRow,
  validateAssessmentPackageRoot,
  writeImportReviewOutputs,
} from '../scripts/radar/lib/research-assessment-import-v02.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testRuns = path.join(repo, 'data_local/test-runs/radar-research-assessment-import-v02')
fs.mkdirSync(testRuns, { recursive: true })
const temporary = (name) => fs.mkdtempSync(path.join(testRuns, name))
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`) }
const writeRows = (file, rows) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, jsonl(rows)) }
const safety = {
  payloadRead: false, payloadWrite: false, payloadPatchRequests: 0, directPostgresqlRead: false, directPostgresqlWrite: false,
  modifiesWorks: false, publishesRatings: false, productionApplyAuthorized: false, createsProductionApplyPackage: false,
  migrationOrSchemaPush: false, networkFetch: false, generatedDataConfinedToDataLocal: true,
  reviewArtifactsWrittenUnderExports: true, arbitraryOutputPathsAllowed: false,
}

function inputRow(index, disposition) {
  const workId = String(1000 + index)
  return {
    workId,
    siteId: `site-${workId}`,
    title: `Title ${workId}`,
    researchDisposition: disposition,
    identity: { identityStatus: disposition === 'identity_review' ? 'unresolved' : 'confirmed' },
    writeProtection: { protected: false, reasons: [] },
    research: {
      evidenceCoverage: 0.8,
      evidenceStatus: 'verified',
      sourceSummary: `source ${workId}`,
      contentSummary: `content ${workId}`,
      relationshipSummary: `relationship ${workId}`,
      endingSummary: `ending ${workId}`,
      sources: [{ url: `https://example.test/${workId}` }],
      contradictions: [],
      unresolvedQuestions: ['human review'],
      researchNotes: ['factual adult evidence retained'],
      riskFindings: {
        femaleFemaleRelationship: 'confirmed',
        maleInvolvement: index === 4 ? 'confirmed' : 'none_found',
        ntrRisk: index === 5 ? 'possible' : 'none_found',
        endingStatus: 'complete',
        adultContent: 'explicit',
        settingProfiles: index === 6 ? ['TS', 'futa', 'ABO', 'crossdressing'] : [],
      },
    },
    contentProfile: {
      sexualContent: 'explicit',
      sexualParticipants: 'female_female',
      violenceOrHorror: 'none_found',
      ageOrConsentRisk: 'none_found',
      coercionRisk: 'none_found',
      ts: index === 6,
      futa: index === 6,
      abo: index === 6,
      crossdressingOrOtokonoko: index === 6,
      ntrRisk: index === 5 ? 'possible' : 'none_found',
      maleInvolvement: index === 4 ? 'confirmed' : 'none_found',
      rawAdultContent: { adultContent: 'explicit' },
    },
    riskLabels: ['sexual_content:explicit', 'sexual_participants:female_female'],
    allowedAssessmentModes: disposition === 'ready_for_ai_assessment' ? ['exact', 'bounded_range'] : disposition === 'needs_more_research' ? ['bounded_range', 'labels_only'] : ['labels_only'],
    requiresHumanReview: true,
    publicationEligible: false,
    pageNotice: PAGE_NOTICE,
  }
}

function outcome(mode, severe = false) {
  const base = {
    assessmentMode: mode,
    exactGradeSuggestion: mode === 'exact' ? 'A' : null,
    gradeRange: mode === 'bounded_range' ? { best: 'B', likely: 'C', worst: 'D' } : null,
    ruleAssessments: [{ code: severe ? 'F-RISK' : 'A-EXAMPLE', grade: severe ? 'F' : 'A', matched: true }],
  }
  return base
}

function assembledRow(input, response) {
  const blockers = []
  if (input.researchDisposition === 'needs_more_research') blockers.push(`needs_more_research_review_required:${input.workId}`)
  if (input.researchDisposition === 'identity_review') blockers.push(`identity_resolution_required:${input.workId}`)
  return {
    ...structuredClone(input),
    assessment: {
      assessmentMode: response.assessmentMode,
      exactGradeSuggestion: response.exactGradeSuggestion,
      gradeRange: response.gradeRange,
      riskLabels: structuredClone(response.riskLabels),
      ruleAssessments: structuredClone(response.ruleAssessments),
      requiresHumanReview: true,
      publicationEligible: false,
    },
    reviewOrReleaseBlockers: blockers,
    releaseEligible: false,
    normalPublicationGatePass: false,
  }
}

function packageFixture() {
  const root = temporary('package-')
  const waveSpecs = [
    ['exact', 'bounded_range', 'labels_only'],
    ['exact', 'bounded_range', 'labels_only'],
  ]
  const dispositionFor = { exact: 'ready_for_ai_assessment', bounded_range: 'needs_more_research', labels_only: 'identity_review' }
  const packageWaves = []
  const aggregateInputs = []
  const aggregateAssembled = []
  const responseSha256 = []
  const immutableFiles = ['aggregate/immutable-input-v02.jsonl', 'instructions/response-schema-v02.json']
  let rowIndex = 0
  for (let waveIndex = 0; waveIndex < waveSpecs.length; waveIndex += 1) {
    const wave = `wave-${String(waveIndex + 1).padStart(2, '0')}`
    const inputs = waveSpecs[waveIndex].map((mode) => inputRow(++rowIndex, dispositionFor[mode]))
    const responses = inputs.map((input, index) => ({ ...structuredClone(input), ...outcome(waveSpecs[waveIndex][index], input.workId === '1006'), riskLabels: structuredClone(input.riskLabels) }))
    const assembled = inputs.map((input, index) => assembledRow(input, responses[index]))
    const inputRelative = `handoffs/${wave}/inputs/${wave}-chunk-01.input.jsonl`
    const responseRelative = `handoffs/${wave}/responses/${wave}-chunk-01.output.jsonl`
    const immutableRelative = `handoffs/${wave}/immutable-input-v02.jsonl`
    const manifestRelative = `handoffs/${wave}/wave-manifest-v02.json`
    const assembledRelative = `handoffs/${wave}/assembled/assessment-results-v02.jsonl`
    const summaryRelative = `handoffs/${wave}/assembled/assembly-summary-v02.json`
    writeRows(path.join(root, inputRelative), inputs)
    writeRows(path.join(root, responseRelative), responses)
    writeRows(path.join(root, immutableRelative), inputs)
    writeRows(path.join(root, assembledRelative), assembled)
    const responseHash = sha256File(path.join(root, responseRelative))
    responseSha256.push({ file: responseRelative, sha256: responseHash })
    const waveManifest = {
      version: VERSION,
      wave,
      index: waveIndex + 1,
      rowCount: inputs.length,
      immutableInputFile: immutableRelative,
      immutableInputSha256: sha256File(path.join(root, immutableRelative)),
      responseSlotCount: 1,
      chunks: [{
        chunkId: `${wave}-chunk-01`,
        index: 1,
        rowCount: inputs.length,
        inputFile: inputRelative,
        inputSha256: sha256File(path.join(root, inputRelative)),
        responseFile: responseRelative,
        expectedOrder: inputs.map((row, index) => ({
          index: index + 1,
          workId: row.workId,
          siteId: row.siteId,
          title: row.title,
          researchDisposition: row.researchDisposition,
        })),
      }],
      outputs: { assembledResults: assembledRelative, assemblySummary: summaryRelative },
    }
    writeJson(path.join(root, manifestRelative), waveManifest)
    writeJson(path.join(root, summaryRelative), {
      version: VERSION,
      wave,
      status: 'complete',
      inputRows: inputs.length,
      responseRows: responses.length,
      assembledRows: assembled.length,
      technicallyAssembledRows: assembled.length,
      genuineAssessmentComplete: true,
      syntheticValidationComplete: false,
      identityOrderMismatches: 0,
      structuralBlockers: [],
      reviewOrReleaseBlockers: [`human_review_required:${inputs.length}`],
      releaseEligible: false,
      normalPublicationGatePass: false,
      warnings: [],
      responseSha256: [{ file: responseRelative, sha256: responseHash }],
      safety,
    })
    packageWaves.push({
      version: VERSION,
      wave,
      index: waveIndex + 1,
      rowCount: inputs.length,
      manifestFile: manifestRelative,
      manifestSha256: sha256File(path.join(root, manifestRelative)),
    })
    immutableFiles.push(inputRelative, immutableRelative, manifestRelative)
    aggregateInputs.push(...inputs)
    aggregateAssembled.push(...assembled)
  }
  writeRows(path.join(root, 'aggregate/immutable-input-v02.jsonl'), aggregateInputs)
  writeRows(path.join(root, 'aggregate/assembled-results-v02.jsonl'), aggregateAssembled)
  writeJson(path.join(root, 'instructions/response-schema-v02.json'), { version: VERSION, requiredInputOwnedFields: ASSESSMENT_INPUT_OWNED_FIELDS })
  const packageManifest = {
    version: VERSION,
    packageId: 'synthetic-import-test',
    sourceOuterSha256: 'a'.repeat(64),
    preparedResearchOuterSha256: 'a'.repeat(64),
    inputRows: aggregateInputs.length,
    waveCount: packageWaves.length,
    waves: packageWaves,
    safety,
  }
  writeJson(path.join(root, 'package-manifest.json'), packageManifest)
  immutableFiles.push('package-manifest.json')
  writeJson(path.join(root, 'aggregate/assembly-summary-v02.json'), {
    version: VERSION,
    complete: true,
    technicallyComplete: true,
    genuineAssessmentComplete: true,
    syntheticRehearsal: false,
    syntheticValidationComplete: false,
    inputRows: aggregateInputs.length,
    responseRows: aggregateInputs.length,
    assembledRows: aggregateInputs.length,
    technicallyAssembledRows: aggregateInputs.length,
    completedWaveCount: packageWaves.length,
    incompleteWaveCount: 0,
    invalidWaveCount: 0,
    laneCounts: { ready_for_ai_assessment: 2, needs_more_research: 2, identity_review: 2 },
    assessmentModeCounts: { exact: 2, bounded_range: 2, labels_only: 2 },
    identityOrderMismatches: 0,
    structuralBlockers: [],
    reviewOrReleaseBlockers: ['human_review_required:6', 'needs_more_research_review_required:2', 'identity_resolution_required:2'],
    releaseEligible: false,
    normalPublicationGatePass: false,
    responseSha256,
    warnings: [],
    safety,
  })
  writeImmutableRootReceipt(root, immutableFiles, { preparedResearchOuterSha256: 'a'.repeat(64) })
  const acceptance = {
    packageId: 'synthetic-import-test',
    preparedResearchOuterSha256: 'a'.repeat(64),
    waveCount: 2,
    rowCount: 6,
    outcomeCounts: { exact: 2, bounded_range: 2, labels_only: 2 },
    laneCounts: { ready_for_ai_assessment: 2, needs_more_research: 2, identity_review: 2 },
  }
  return {
    root,
    acceptance,
    validate: () => validateAssessmentPackageRoot(root, acceptance),
    responseFile: path.join(root, 'handoffs/wave-01/responses/wave-01-chunk-01.output.jsonl'),
    assembledFile: path.join(root, 'handoffs/wave-01/assembled/assessment-results-v02.jsonl'),
    aggregateAssembledFile: path.join(root, 'aggregate/assembled-results-v02.jsonl'),
    aggregateSummaryFile: path.join(root, 'aggregate/assembly-summary-v02.json'),
    waveSummaryFile: path.join(root, 'handoffs/wave-01/assembled/assembly-summary-v02.json'),
  }
}

function updateResponseHashes(fixture) {
  const summary = JSON.parse(fs.readFileSync(fixture.aggregateSummaryFile, 'utf8'))
  const relative = 'handoffs/wave-01/responses/wave-01-chunk-01.output.jsonl'
  const hash = sha256File(fixture.responseFile)
  summary.responseSha256.find((entry) => entry.file === relative).sha256 = hash
  writeJson(fixture.aggregateSummaryFile, summary)
  const wave = JSON.parse(fs.readFileSync(fixture.waveSummaryFile, 'utf8'))
  wave.responseSha256[0].sha256 = hash
  writeJson(fixture.waveSummaryFile, wave)
}

test('all three outcome shapes remain distinct', () => {
  const fixture = packageFixture()
  const validated = fixture.validate()
  const normalized = validated.assembledRows.map((row) => normalizeImportRow(row))
  assert.deepEqual([...new Set(normalized.map((row) => row.outcome.type))], ['exact', 'bounded_range', 'labels_only'])
  assert.equal(normalized[0].outcome.provisionalExactSuggestion, 'A')
  assert.deepEqual(normalized[1].outcome.boundedRange, { best: 'B', likely: 'C', worst: 'D' })
  assert.equal(normalized[2].outcome.insufficientCertainty, true)
})

test('bounded ranges are never coerced into one grade', () => {
  const bounded = normalizeImportRow(packageFixture().validate().assembledRows[1])
  assert.equal('finalGrade' in bounded, false)
  assert.equal('finalGrade' in bounded.outcome, false)
  assert.equal('provisionalExactSuggestion' in bounded.outcome, false)
  assert.deepEqual(bounded.outcome.boundedRange, { best: 'B', likely: 'C', worst: 'D' })
})

test('labels-only rows receive no fallback grade', () => {
  const labelsOnly = normalizeImportRow(packageFixture().validate().assembledRows[2])
  assert.equal('finalGrade' in labelsOnly.outcome, false)
  assert.equal('provisionalExactSuggestion' in labelsOnly.outcome, false)
  assert.equal('boundedRange' in labelsOnly.outcome, false)
  assert.equal(labelsOnly.outcome.insufficientCertainty, true)
})

test('automatic X is rejected', () => {
  const fixture = packageFixture()
  const responses = fs.readFileSync(fixture.responseFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
  responses[0].exactGradeSuggestion = 'X'
  writeRows(fixture.responseFile, responses)
  updateResponseHashes(fixture)
  assert.throws(() => fixture.validate(), /non-X|Automatic X/u)
})

test('immutable receipt and package manifest tampering are rejected', () => {
  for (const relative of ['immutable-root-manifest-v02.json', 'package-manifest.json']) {
    const fixture = packageFixture()
    fs.appendFileSync(path.join(fixture.root, relative), ' ')
    assert.throws(() => fixture.validate(), /Immutable root manifest SHA-256 mismatch|Immutable root file mismatch/u)
  }
})

test('input-response-assembled identity and order equality is enforced', () => {
  const fixture = packageFixture()
  const responses = fs.readFileSync(fixture.responseFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
  responses[0].workId = 'wrong-order'
  writeRows(fixture.responseFile, responses)
  updateResponseHashes(fixture)
  assert.throws(() => fixture.validate(), /identity\/order mismatches/u)
})

test('input-owned field rewrites are rejected', () => {
  const fixture = packageFixture()
  const responses = fs.readFileSync(fixture.responseFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
  responses[0].research.contentSummary = 'rewritten'
  writeRows(fixture.responseFile, responses)
  updateResponseHashes(fixture)
  assert.throws(() => fixture.validate(), /Input-owned field rewrite mismatches/u)
})

test('incomplete and invalid Waves are rejected', () => {
  for (const status of ['incomplete', 'invalid']) {
    const fixture = packageFixture()
    const summary = JSON.parse(fs.readFileSync(fixture.waveSummaryFile, 'utf8'))
    summary.status = status
    summary.genuineAssessmentComplete = false
    writeJson(fixture.waveSummaryFile, summary)
    assert.throws(() => fixture.validate(), /Wave is incomplete or invalid/u)
  }
})

test('release blockers and closed gates are retained', () => {
  const fixture = packageFixture()
  const assembled = fs.readFileSync(fixture.assembledFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
  assembled[2].reviewOrReleaseBlockers = []
  writeRows(fixture.assembledFile, assembled)
  const aggregate = fs.readFileSync(fixture.aggregateAssembledFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
  aggregate[2].reviewOrReleaseBlockers = []
  writeRows(fixture.aggregateAssembledFile, aggregate)
  assert.throws(() => fixture.validate(), /Identity-resolution release blocker missing/u)
})

test('review outputs preserve evidence and produce all required lanes and indexes', () => {
  const fixture = packageFixture()
  const validated = fixture.validate()
  const output = path.join(temporary('outputs-'), 'review')
  const written = writeImportReviewOutputs(validated, output, path.resolve(repo, 'data_local'))
  assert.deepEqual(written.rows[0].research, validated.inputRows[0].research)
  assert.equal(written.rows[0].contentProfile.sexualContent, 'explicit')
  assert.equal(written.summary.importedRows, 6)
  assert.equal(written.summary.riskReviewCounts.severe_e_f_rule, 1)
  assert.equal(written.summary.riskReviewCounts.male_involvement, 1)
  assert.equal(written.summary.riskReviewCounts.ntr, 1)
  assert.equal(written.summary.riskReviewCounts.ts, 1)
  for (const relative of [
    'rows/all-imported-review-v02.jsonl', 'outcomes/exact-v02.jsonl', 'outcomes/bounded-range-v02.jsonl',
    'outcomes/labels-only-v02.jsonl', 'lanes/ready-for-ai-assessment-v02.jsonl',
    'lanes/needs-more-research-v02.jsonl', 'lanes/identity-review-v02.jsonl',
    'aggregate/import-summary-v02.json', 'aggregate/blocker-warning-index-v02.json',
    'aggregate/human-review-index-v02.csv', 'SHA256SUMS',
  ]) assert.equal(fs.existsSync(path.join(output, relative)), true, relative)
})

test('website representation plan has four review views and zero mutation actions', () => {
  const fixture = packageFixture()
  const rows = fixture.validate().assembledRows.map((row) => normalizeImportRow(row))
  const plan = buildWebsiteRepresentationPlan(rows)
  assert.deepEqual(plan.summary.counts, {
    records: 6, provisionalExact: 2, boundedRange: 2, labelsOnly: 2, needsMoreResearch: 2, identityUnresolved: 2,
    payloadPatchRequests: 0, postgresqlStatements: 0, worksMutations: 0, publicationActions: 0,
  })
  assert.equal(plan.records.some((record) => 'finalGrade' in record), false)
  assert.equal(plan.records.filter((record) => record.representationKind === 'identity_unresolved').length, 2)
  assert.equal(plan.records.every((record) => record.releaseEligible === false && record.normalPublicationGatePass === false), true)
})

test('output paths are confined to data_local', () => {
  const dataLocal = path.resolve(repo, 'data_local')
  assert.equal(assertImportOutputPath(path.join(dataLocal, 'outputs/ok'), dataLocal), path.join(dataLocal, 'outputs/ok'))
  assert.throws(() => assertImportOutputPath(path.resolve(repo, 'exports/not-ok'), dataLocal), /must remain under/u)
})

test('execute, apply, write, publish, and confirm flags are rejected', () => {
  for (const flag of ['execute', 'apply', 'write', 'publish', 'confirm']) assert.throws(() => rejectWriteFlags({ [flag]: true }), new RegExp(`rejects --${flag}`, 'u'))
  for (const script of ['import-radar-research-assessment-v02.mjs', 'plan-radar-research-assessment-v02-dryrun.mjs']) {
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/radar', script), '--apply'], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /rejects --apply/u)
  }
})

test('import code has no Payload, PostgreSQL, Works mutation, or publication code path', () => {
  const files = [
    'lib/research-assessment-import-v02.mjs',
    'import-radar-research-assessment-v02.mjs',
    'plan-radar-research-assessment-v02-dryrun.mjs',
  ]
  const text = files.map((file) => fs.readFileSync(path.join(repo, 'scripts/radar', file), 'utf8')).join('\n')
  assert.doesNotMatch(text, /getPayload|payload\.update|payload\.create|UPDATE\s+works|INSERT\s+INTO|DELETE\s+FROM|productionApplyAuthorized:\s*true|publishesRatings:\s*true/iu)
  assert.deepEqual(IMPORT_SAFETY, {
    networkFetch: false, payloadRead: false, payloadWrite: false, payloadPatchRequests: 0,
    directPostgresqlRead: false, directPostgresqlWrite: false, postgresqlStatements: 0,
    modifiesWorks: false, worksMutations: 0, publishesRatings: false, publicationActions: 0,
    productionApplyAuthorized: false, createsProductionApplyPackage: false, migrationOrSchemaPush: false,
    automaticXAllowed: false, generatedDataConfinedToDataLocal: true, reviewArtifactsWrittenUnderExports: true,
    arbitraryOutputPathsAllowed: false, dryRunOnly: true,
  })
})

test('ZIP inventory rejects traversal, absolute, duplicate, and symlink entries', () => {
  const cases = [
    ['traversal.zip', '../escape.txt', 0, /Unsafe ZIP entry/u],
    ['absolute.zip', 'C:/escape.txt', 0, /Unsafe ZIP entry/u],
    ['symlink.zip', 'link', 0xA000, /symlink/u],
  ]
  for (const [name, entry, mode, expected] of cases) {
    const zip = path.join(temporary('zip-'), name)
    const escaped = zip.replace(/'/gu, "''")
    const entryEscaped = entry.replace(/'/gu, "''")
    const attributes = mode ? `$e.ExternalAttributes=([int]0x${mode.toString(16)} -shl 16);` : ''
    const ps = `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('${escaped}',[System.IO.Compression.ZipArchiveMode]::Create);$e=$z.CreateEntry('${entryEscaped}');${attributes}$w=[IO.StreamWriter]::new($e.Open());$w.Write('x');$w.Dispose();$z.Dispose()`
    execFileSync('powershell', ['-NoProfile', '-Command', ps])
    assert.throws(() => archiveInventory(zip), expected)
  }
  const duplicate = path.join(temporary('zip-'), 'duplicate.zip')
  const escaped = duplicate.replace(/'/gu, "''")
  const ps = `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('${escaped}',[System.IO.Compression.ZipArchiveMode]::Create);1..2|%{$e=$z.CreateEntry('same.txt');$w=[IO.StreamWriter]::new($e.Open());$w.Write('x');$w.Dispose()};$z.Dispose()`
  execFileSync('powershell', ['-NoProfile', '-Command', ps])
  assert.throws(() => archiveInventory(duplicate), /Duplicate ZIP entry/u)
})

test('outer ZIP SHA-256 mismatch is rejected before archive parsing or row acceptance', () => {
  const zip = path.join(temporary('zip-'), 'not-yet-trusted.zip')
  fs.writeFileSync(zip, 'untrusted bytes')
  assert.throws(() => extractAssessmentPackage(zip, '0'.repeat(64), path.join(testRuns, 'sha-mismatch'), { dataLocalRoot: path.resolve(repo, 'data_local') }), /Outer assessment ZIP SHA-256 mismatch/u)
})

test('real 2,500-row assembled ZIP validates and rehearses locally', { skip: !process.env.RADAR_ASSESSMENT_IMPORT_ZIP }, () => {
  const zip = path.resolve(process.env.RADAR_ASSESSMENT_IMPORT_ZIP)
  const expectedSha256 = process.env.RADAR_ASSESSMENT_IMPORT_SHA
  const acceptance = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/radar/fixtures/radar-research-assessment-import-accepted-0001-v02.json'), 'utf8'))
  assert.equal(sha256File(zip).toUpperCase(), expectedSha256.toUpperCase())
  const staging = path.join(testRuns, 'real-package')
  const result = spawnSync(process.execPath, [
    path.join(repo, 'scripts/radar/import-radar-research-assessment-v02.mjs'),
    '--input', zip,
    '--expected-sha256', expectedSha256,
    '--acceptance', path.join(repo, 'scripts/radar/fixtures/radar-research-assessment-import-accepted-0001-v02.json'),
    '--staging-dir', staging,
    '--out-dir', path.join(testRuns, 'real-output'),
  ], { cwd: repo, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.importedRows, acceptance.rowCount)
  assert.deepEqual(summary.outcomeCounts, acceptance.outcomeCounts)
  assert.deepEqual(summary.researchLaneCounts, acceptance.laneCounts)
  assert.equal(summary.identityOrderMismatches, 0)
  assert.equal(summary.inputOwnedRewriteMismatches, 0)
  assert.deepEqual(summary.structuralBlockers, [])
})
