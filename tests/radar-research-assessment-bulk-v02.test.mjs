import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  ASSESSMENT_INPUT_OWNED_FIELDS, ASSESSMENT_OUTCOME_FIELDS, archiveInventory, assessmentResponseSchema, assertRelative, filesUnder, jsonl, loadResearchPackage, normalizeContentProfile,
  sha256File, validateOutcome, validateResearchCompleteness, writeImmutableRootReceipt,
} from '../scripts/radar/lib/research-assessment-handoff-v02.mjs'

const repo = path.resolve('.')
const testRuns = path.join(repo, 'data_local', 'test-runs')
const assembler = path.join(repo, 'scripts/radar/assemble-radar-research-assessment-bulk-v02.mjs')
const version = 'ai-radar-research-assessment-handoff-v0.2'
const safety = {
  payloadRead: false, payloadWrite: false, directPostgresqlRead: false, directPostgresqlWrite: false,
  modifiesWorks: false, publishesRatings: false, productionApplyAuthorized: false,
  generatedDataConfinedToDataLocal: true, reviewArtifactsWrittenUnderExports: true, arbitraryOutputPathsAllowed: false,
}
const researchContract = {
  requiredResearchStringFields: ['sourceSummary', 'contentSummary', 'relationshipSummary', 'endingSummary'],
  researchArrayMinimumItems: { sources: 1, unresolvedQuestions: 0, researchNotes: 1 },
  requiredRiskFindingsKeys: ['femaleFemaleRelationship', 'maleInvolvement', 'ntrRisk', 'endingStatus', 'adultContent', 'settingProfiles'],
}

fs.mkdirSync(testRuns, { recursive: true })
const temporary = (prefix) => fs.mkdtempSync(path.join(testRuns, prefix))
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
const makeInput = (index, disposition) => ({
  workId: String(index), siteId: `work:${index}`, title: `title-${index}`, researchDisposition: disposition,
  allowedAssessmentModes: disposition === 'ready_for_ai_assessment' ? ['exact', 'bounded_range'] : disposition === 'needs_more_research' ? ['bounded_range', 'labels_only'] : ['labels_only'],
  identity: { identityStatus: disposition === 'identity_review' ? 'ambiguous' : 'confirmed' },
  writeProtection: { protected: disposition !== 'ready_for_ai_assessment', reasons: disposition === 'ready_for_ai_assessment' ? [] : ['review'] },
  research: { sourceSummary: 'source', contentSummary: 'content', relationshipSummary: 'relationship', endingSummary: 'ending', sources: [{ url: 'https://example.test' }], unresolvedQuestions: [], researchNotes: ['note'], riskFindings: { femaleFemaleRelationship: 'confirmed', maleInvolvement: 'unknown', ntrRisk: 'unknown', endingStatus: 'unknown', adultContent: 'unknown', settingProfiles: [] } },
  contentProfile: { sexualContent: 'unknown' }, riskLabels: ['sexual_content:unknown'],
  requiresHumanReview: true, publicationEligible: false, pageNotice: 'AI 综合，待复核',
})
const outcomeFor = (row) => row.researchDisposition === 'ready_for_ai_assessment'
  ? { assessmentMode: 'exact', exactGradeSuggestion: 'A', gradeRange: null }
  : row.researchDisposition === 'needs_more_research'
    ? { assessmentMode: 'bounded_range', exactGradeSuggestion: null, gradeRange: { best: 'A', likely: 'C', worst: 'F' } }
    : { assessmentMode: 'labels_only', exactGradeSuggestion: null, gradeRange: null }

function sealAssessmentPackage(root) {
  const immutable = filesUnder(root).filter((rel) => !/(^|\/)responses\//u.test(rel) && !/(^|\/)(?:assembled|synthetic-assembled)\//u.test(rel) && !rel.startsWith('aggregate/') && !rel.startsWith('review-lanes/assembled/') && !['SHA256SUMS', 'immutable-root-manifest-v02.json'].includes(rel))
  return writeImmutableRootReceipt(root, immutable, { preparedResearchOuterSha256: 'a'.repeat(64) })
}

function assessmentFixture(dispositionsByWave = [['ready_for_ai_assessment', 'needs_more_research', 'identity_review']]) {
  const root = temporary('radar-v02-')
  const waves = []
  const responsesByWave = []
  let rowIndex = 1
  for (let waveIndex = 0; waveIndex < dispositionsByWave.length; waveIndex += 1) {
    const wave = `wave-${String(waveIndex + 1).padStart(2, '0')}`
    const rows = dispositionsByWave[waveIndex].map((disposition) => makeInput(rowIndex++, disposition))
    const input = `handoffs/${wave}/inputs/${wave}-chunk-01.input.jsonl`
    const response = `handoffs/${wave}/responses/${wave}-chunk-01.output.jsonl`
    const immutable = `handoffs/${wave}/immutable-input-v02.jsonl`
    for (const rel of [input, response, immutable]) fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, input), jsonl(rows))
    fs.writeFileSync(path.join(root, immutable), jsonl(rows))
    const responses = rows.map((row) => ({ ...row, ...outcomeFor(row), ruleAssessments: [], syntheticRehearsal: true }))
    fs.writeFileSync(path.join(root, response), jsonl(responses))
    const waveManifest = {
      version, wave, rowCount: rows.length, immutableInputFile: immutable, immutableInputSha256: sha256File(path.join(root, immutable)),
      chunks: [{ chunkId: `${wave}-chunk-01`, rowCount: rows.length, inputFile: input, inputSha256: sha256File(path.join(root, input)), responseFile: response, expectedOrder: rows.map((row, index) => ({ index: index + 1, workId: row.workId, siteId: row.siteId, title: row.title, researchDisposition: row.researchDisposition })) }],
    }
    const waveFile = `handoffs/${wave}/wave-manifest-v02.json`
    writeJson(path.join(root, waveFile), waveManifest)
    waves.push({ ...waveManifest, manifestFile: waveFile, manifestSha256: sha256File(path.join(root, waveFile)) })
    responsesByWave.push({ rows, responses, response: path.join(root, response), responseRel: response })
  }
  const manifest = {
    version, sourceOuterSha256: 'a'.repeat(64), preparedResearchOuterSha256: 'a'.repeat(64),
    inputRows: responsesByWave.reduce((sum, item) => sum + item.rows.length, 0), waveCount: waves.length, waves, safety,
  }
  writeJson(path.join(root, 'package-manifest.json'), manifest)
  sealAssessmentPackage(root)
  return { root, waves, responsesByWave, manifest }
}

const run = (root, synthetic = false) => spawnSync(process.execPath, [assembler, '--package-dir', root, ...(synthetic ? ['--synthetic-rehearsal'] : [])], { encoding: 'utf8' })

const researchRow = () => ({
  workId: '1', siteId: 'work:1', title: 'one', identityStatus: 'confirmed', researchStatus: 'ready_for_ai_assessment',
  evidenceCoverage: 0.8, evidenceStatus: 'official_confirmed', sourceSummary: 'source', contentSummary: 'content',
  relationshipSummary: 'relationship', endingSummary: 'ending',
  riskFindings: { femaleFemaleRelationship: 'confirmed', maleInvolvement: 'none_found', ntrRisk: 'none_found', endingStatus: 'complete', adultContent: 'none_found', settingProfiles: [] },
  sources: [{ label: 'official', url: 'https://example.test' }], contradictions: [], unresolvedQuestions: [], researchNotes: ['complete'],
})

function rewriteResearchReview(root) {
  const files = filesUnder(root).filter((rel) => rel !== 'review-manifest.json')
  writeJson(path.join(root, 'review-manifest.json'), files.map((file) => ({ file, bytes: fs.statSync(path.join(root, file)).size, sha256: sha256File(path.join(root, file)) })))
}

function researchPackageFixture() {
  const root = temporary('radar-research-package-')
  const waveRoot = path.join(root, 'waves', 'wave-01')
  const sourceRel = 'waves/wave-01/sample.source.jsonl'
  const responseRel = 'waves/wave-01/responses/sample-chunk-0001.output.jsonl'
  const assembledRel = 'waves/wave-01/assembled/research-results-v01.jsonl'
  const source = { workId: '1', siteId: 'work:1', title: 'one', sourceOnly: true }
  const response = researchRow()
  const assembled = { researchBatch: 'research-wave-01', ...response, assembledOnly: true }
  fs.mkdirSync(path.join(waveRoot, 'responses'), { recursive: true })
  fs.mkdirSync(path.join(waveRoot, 'assembled'), { recursive: true })
  fs.writeFileSync(path.join(root, sourceRel), jsonl([source]))
  fs.writeFileSync(path.join(root, responseRel), jsonl([response]))
  fs.writeFileSync(path.join(root, assembledRel), jsonl([assembled]))
  writeJson(path.join(waveRoot, 'handoff-manifest.json'), { chunks: [{ rowCount: 1, responseFile: 'D:\\legacy\\responses\\sample-chunk-0001.output.jsonl', expectedRows: [{ workId: '1', siteId: 'work:1', title: 'one' }] }] })
  writeJson(path.join(waveRoot, 'assembled', 'assembly-summary.json'), { complete: true, inputRows: 1, responseRows: 1, assembledRows: 1 })
  rewriteResearchReview(root)
  const acceptance = { waveCount: 1, rowsPerWave: 1, rowCount: 1, researchResponseFilesPerWave: 1, laneCounts: { ready_for_ai_assessment: 1 }, ...researchContract }
  return { root, acceptance, sourceRel, responseRel, assembledRel }
}

test('mode contract, range order, and automatic X rejection', () => {
  assert.doesNotThrow(() => validateOutcome({ assessmentMode: 'exact', exactGradeSuggestion: 'A', gradeRange: null, riskLabels: [], ruleAssessments: [], requiresHumanReview: true, publicationEligible: false }, 'ready_for_ai_assessment'))
  assert.doesNotThrow(() => validateOutcome({ assessmentMode: 'labels_only', exactGradeSuggestion: null, gradeRange: null, riskLabels: [], ruleAssessments: [], requiresHumanReview: true, publicationEligible: false }, 'identity_review'))
  assert.throws(() => validateOutcome({ assessmentMode: 'bounded_range', exactGradeSuggestion: null, gradeRange: { best: 'D', likely: 'A', worst: 'F' }, riskLabels: [], ruleAssessments: [], requiresHumanReview: true, publicationEligible: false }, 'needs_more_research'))
  assert.throws(() => validateOutcome({ assessmentMode: 'exact', exactGradeSuggestion: 'X', gradeRange: null, riskLabels: [], ruleAssessments: [], requiresHumanReview: true, publicationEligible: false }, 'ready_for_ai_assessment'))
})

test('generated response schema exactly matches the assembler input-owned validation contract', () => {
  const schema = assessmentResponseSchema()
  assert.deepEqual(schema.requiredInputOwnedFields, ['workId', 'siteId', 'title', 'researchDisposition', 'identity', 'writeProtection', 'research', 'contentProfile', 'riskLabels', 'allowedAssessmentModes', 'requiresHumanReview', 'publicationEligible', 'pageNotice'])
  assert.deepEqual(schema.requiredInputOwnedFields, [...ASSESSMENT_INPUT_OWNED_FIELDS])
  assert.deepEqual(schema.requiredAssessmentFields, ['assessmentMode', 'exactGradeSuggestion', 'gradeRange', 'ruleAssessments'])
  assert.deepEqual(schema.requiredAssessmentFields, [...ASSESSMENT_OUTCOME_FIELDS])
  const assemblerSource = fs.readFileSync(assembler, 'utf8')
  assert.match(assemblerSource, /for \(const key of ASSESSMENT_INPUT_OWNED_FIELDS\)/u)
})

test('content normalization keeps factual dimensions separate and participants unknown', () => {
  const profile = normalizeContentProfile({ riskFindings: { adultContent: 'explicit', maleInvolvement: 'none_found', ntrRisk: 'possible', violenceOrHorror: 'severe', ageOrConsentRisk: 'possible', coercionRisk: 'confirmed', settingProfiles: ['TS', 'futa', 'ABO', 'otokonoko'] } })
  assert.equal(profile.sexualParticipants, 'unknown')
  assert.deepEqual([profile.ts, profile.futa, profile.abo, profile.crossdressingOrOtokonoko], [true, true, true, true])
  assert.equal(normalizeContentProfile({ riskFindings: { adultContent: 'none_found' } }).sexualParticipants, 'none')
})

test('research completeness rejects missing or empty required summaries', () => {
  for (const key of researchContract.requiredResearchStringFields) {
    const row = researchRow(); delete row[key]
    assert.throws(() => validateResearchCompleteness(row, researchContract), new RegExp(key))
    const empty = researchRow(); empty[key] = ' '
    assert.throws(() => validateResearchCompleteness(empty, researchContract), new RegExp(key))
  }
})

test('research completeness validates every required riskFindings key', () => {
  for (const key of researchContract.requiredRiskFindingsKeys) {
    const row = researchRow(); delete row.riskFindings[key]
    assert.throws(() => validateResearchCompleteness(row, researchContract), new RegExp(key))
  }
})

test('research arrays are required and enforce package-bound minimum items', () => {
  for (const key of Object.keys(researchContract.researchArrayMinimumItems)) {
    const row = researchRow(); delete row[key]
    assert.throws(() => validateResearchCompleteness(row, researchContract), new RegExp(key))
  }
  const row = researchRow(); row.sources = []
  assert.throws(() => validateResearchCompleteness(row, researchContract), /sources/u)
  assert.doesNotThrow(() => validateResearchCompleteness(researchRow(), researchContract))
})

test('accepted research package verifies source, response, and assembled layers exactly', () => {
  const fixture = researchPackageFixture()
  const result = loadResearchPackage(fixture.root, '', path.join(testRuns, 'unused-scratch'), fixture.acceptance)
  assert.deepEqual(result.researchVerification, { sourceRows: 1, responseRows: 1, assembledRows: 1, verifiedRows: 1, expectedResponseFiles: 1, verifiedResponseFiles: 1, sourceResponseIdentityMismatches: 0, responseAssembledIdentityMismatches: 0, responseAssembledFieldMismatches: 0, perWave: [{ wave: 'wave-01', sourceRows: 1, responseRows: 1, assembledRows: 1, verifiedResponseFiles: 1 }] })
})

test('research package rejects source-to-response and response-to-assembled mismatches', () => {
  const sourceMismatch = researchPackageFixture()
  const response = researchRow(); response.title = 'changed'
  fs.writeFileSync(path.join(sourceMismatch.root, sourceMismatch.responseRel), jsonl([response]))
  fs.writeFileSync(path.join(sourceMismatch.root, sourceMismatch.assembledRel), jsonl([{ ...response }]))
  writeJson(path.join(sourceMismatch.root, 'waves/wave-01/handoff-manifest.json'), { chunks: [{ rowCount: 1, responseFile: 'sample-chunk-0001.output.jsonl', expectedRows: [{ workId: '1', siteId: 'work:1', title: 'changed' }] }] })
  rewriteResearchReview(sourceMismatch.root)
  assert.throws(() => loadResearchPackage(sourceMismatch.root, '', path.join(testRuns, 'unused-scratch'), sourceMismatch.acceptance), /Source-response-assembled mismatch/u)
  const assembledMismatch = researchPackageFixture()
  const assembled = { ...researchRow(), contentSummary: 'rewritten' }
  fs.writeFileSync(path.join(assembledMismatch.root, assembledMismatch.assembledRel), jsonl([assembled]))
  rewriteResearchReview(assembledMismatch.root)
  assert.throws(() => loadResearchPackage(assembledMismatch.root, '', path.join(testRuns, 'unused-scratch'), assembledMismatch.acceptance), /Source-response-assembled mismatch/u)
})

test('accepted research package rejects missing summaries and required risk data', () => {
  for (const key of ['contentSummary', 'relationshipSummary', 'endingSummary']) {
    const fixture = researchPackageFixture(), row = researchRow(); delete row[key]
    fs.writeFileSync(path.join(fixture.root, fixture.responseRel), jsonl([row])); fs.writeFileSync(path.join(fixture.root, fixture.assembledRel), jsonl([row])); rewriteResearchReview(fixture.root)
    assert.throws(() => loadResearchPackage(fixture.root, '', path.join(testRuns, 'unused-scratch'), fixture.acceptance), new RegExp(key))
  }
  for (const key of researchContract.requiredRiskFindingsKeys) {
    const fixture = researchPackageFixture(), row = researchRow(); delete row.riskFindings[key]
    fs.writeFileSync(path.join(fixture.root, fixture.responseRel), jsonl([row])); fs.writeFileSync(path.join(fixture.root, fixture.assembledRel), jsonl([row])); rewriteResearchReview(fixture.root)
    assert.throws(() => loadResearchPackage(fixture.root, '', path.join(testRuns, 'unused-scratch'), fixture.acceptance), new RegExp(key))
  }
})

test('path confinement rejects traversal and absolute paths', () => {
  for (const value of ['../x', '/x', 'C:\\x']) assert.throws(() => assertRelative(value))
})

test('synthetic fixture technically assembles all modes but remains release-ineligible', () => {
  const fixture = assessmentFixture()
  const result = run(fixture.root, true)
  assert.equal(result.status, 0, result.stderr)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.genuineAssessmentComplete, false)
  assert.equal(summary.syntheticValidationComplete, true)
  assert.equal(summary.syntheticAssembledRows, 3)
  assert.equal(summary.technicallyAssembledRows, 3)
  assert.equal(summary.releaseEligible, false)
  assert.deepEqual(summary.structuralBlockers, [])
  assert.ok(summary.reviewOrReleaseBlockers.includes('identity_resolution_required:1'))
  assert.ok(summary.reviewOrReleaseBlockers.includes('needs_more_research_review_required:1'))
})

test('synthetic responses are forbidden outside explicit synthetic mode', () => {
  const fixture = assessmentFixture(), result = run(fixture.root)
  assert.equal(result.status, 2)
  assert.match(result.stdout, /synthetic_response_forbidden/u)
})

test('missing declared response remains incomplete and unassembled', () => {
  const fixture = assessmentFixture()
  fs.rmSync(fixture.responsesByWave[0].response)
  const result = run(fixture.root)
  assert.equal(result.status, 2)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.incompleteWaveCount, 1)
  assert.equal(summary.invalidWaveCount, 0)
  assert.ok(summary.structuralBlockers.some((item) => item.startsWith('response_missing:')))
})

test('duplicate and count-mismatched responses are blocked', () => {
  const fixture = assessmentFixture(), responses = fixture.responsesByWave[0].responses
  fs.writeFileSync(fixture.responsesByWave[0].response, jsonl([responses[0], responses[0], responses[2], responses[2]]))
  const result = run(fixture.root, true)
  assert.equal(result.status, 2)
  assert.match(result.stdout, /response_count_mismatch|duplicate_response_identity/u)
})

test('reordered response identity and order is blocked', () => {
  const fixture = assessmentFixture(), responses = fixture.responsesByWave[0].responses
  fs.writeFileSync(fixture.responsesByWave[0].response, jsonl([responses[1], responses[0], responses[2]]))
  const result = run(fixture.root, true)
  assert.equal(result.status, 2)
  assert.match(result.stdout, /workId_or_order_mismatch/u)
})

test('input-owned identity, protection, research, profile, and labels rewrites are blocked', () => {
  for (const key of ['identity', 'writeProtection', 'research', 'contentProfile', 'riskLabels']) {
    const fixture = assessmentFixture(), rows = structuredClone(fixture.responsesByWave[0].responses)
    rows[0][key] = key === 'riskLabels' ? ['rewritten'] : { rewritten: true }
    fs.writeFileSync(fixture.responsesByWave[0].response, jsonl(rows))
    const result = run(fixture.root, true)
    assert.equal(result.status, 2)
    assert.match(result.stdout, new RegExp(`input_owned_${key}_rewrite`))
  }
})

test('title and disposition rewrites are blocked', () => {
  for (const key of ['title', 'researchDisposition']) {
    const fixture = assessmentFixture(), rows = structuredClone(fixture.responsesByWave[0].responses)
    rows[0][key] = 'rewritten'
    fs.writeFileSync(fixture.responsesByWave[0].response, jsonl(rows))
    const result = run(fixture.root, true)
    assert.equal(result.status, 2)
    assert.match(result.stdout, new RegExp(`${key}_or_order_mismatch`))
  }
})

test('one invalid Wave does not suppress another valid Wave output', () => {
  const fixture = assessmentFixture([['ready_for_ai_assessment'], ['ready_for_ai_assessment']])
  const invalid = structuredClone(fixture.responsesByWave[1].responses)
  invalid[0].assessmentMode = 'labels_only'; invalid[0].exactGradeSuggestion = null
  fs.writeFileSync(fixture.responsesByWave[1].response, jsonl(invalid))
  const result = run(fixture.root, true)
  assert.equal(result.status, 2)
  const summary = JSON.parse(result.stdout)
  assert.deepEqual([summary.completedWaveCount, summary.incompleteWaveCount, summary.invalidWaveCount], [1, 0, 1])
  assert.equal(fs.existsSync(path.join(fixture.root, 'handoffs/wave-01/synthetic-assembled/assessment-results-v02.jsonl')), true)
  assert.equal(fs.existsSync(path.join(fixture.root, 'handoffs/wave-02/synthetic-assembled/assessment-results-v02.jsonl')), false)
  assert.equal(fs.existsSync(path.join(fixture.root, 'aggregate/synthetic-rehearsal/assembled-results-v02.jsonl')), false)
})

test('identity and order mismatch counts are Wave-local and package-aggregate', () => {
  const fixture = assessmentFixture([['ready_for_ai_assessment'], ['ready_for_ai_assessment']])
  const mismatched = structuredClone(fixture.responsesByWave[0].responses)
  mismatched[0].title = 'mismatched-title'
  fs.writeFileSync(fixture.responsesByWave[0].response, jsonl(mismatched))
  const result = run(fixture.root, true)
  assert.equal(result.status, 2)
  const rootSummary = JSON.parse(result.stdout)
  const waveOne = JSON.parse(fs.readFileSync(path.join(fixture.root, 'handoffs/wave-01/synthetic-assembled/assembly-summary-v02.json')))
  const waveTwo = JSON.parse(fs.readFileSync(path.join(fixture.root, 'handoffs/wave-02/synthetic-assembled/assembly-summary-v02.json')))
  assert.equal(waveOne.identityOrderMismatches, 1)
  assert.equal(waveTwo.identityOrderMismatches, 0)
  assert.equal(rootSummary.identityOrderMismatches, 1)
})

test('closed-world response inventory rejects unexpected and misplaced files', () => {
  for (const extra of ['handoffs/wave-01/responses/unlisted.output.jsonl', 'misplaced.output.jsonl']) {
    const fixture = assessmentFixture(), file = path.join(fixture.root, extra)
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}\n')
    const result = run(fixture.root, true)
    assert.equal(result.status, 2)
    assert.match(result.stdout, /unexpected_response_file|misplaced_or_unlisted_response_file/u)
  }
})

test('identity-review labels-only response is technically assembled with explicit release blocker', () => {
  const fixture = assessmentFixture([['identity_review']])
  const result = run(fixture.root, true)
  assert.equal(result.status, 0, result.stderr)
  const output = path.join(fixture.root, 'handoffs/wave-01/synthetic-assembled/assessment-results-v02.jsonl')
  const row = JSON.parse(fs.readFileSync(output, 'utf8').trim())
  assert.deepEqual(row.reviewOrReleaseBlockers, ['identity_resolution_required:1'])
  assert.equal(row.releaseEligible, false)
  assert.equal(row.normalPublicationGatePass, false)
})

test('package manifest, root manifest, Wave manifest, and immutable input tampering are rejected', () => {
  const cases = [
    ['package-manifest.json', /Immutable root file mismatch/u],
    ['immutable-root-manifest-v02.json', /Immutable root manifest SHA-256 mismatch/u],
    ['handoffs/wave-01/wave-manifest-v02.json', /Immutable root file mismatch/u],
    ['handoffs/wave-01/inputs/wave-01-chunk-01.input.jsonl', /Immutable root file mismatch/u],
  ]
  for (const [relative, expected] of cases) {
    const fixture = assessmentFixture()
    fs.appendFileSync(path.join(fixture.root, relative), ' ')
    const result = run(fixture.root, true)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, expected)
  }
})

test('archive inventory rejects duplicate ZIP entries', () => {
  const dir = temporary('radar-zip-'), zip = path.join(dir, 'duplicate.zip')
  const ps = `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('${zip.replace(/'/gu, "''")}',[System.IO.Compression.ZipArchiveMode]::Create); 1..2|%{$e=$z.CreateEntry('same.txt');$w=[IO.StreamWriter]::new($e.Open());$w.Write('x');$w.Dispose()};$z.Dispose()`
  execFileSync('powershell', ['-NoProfile', '-Command', ps])
  assert.throws(() => archiveInventory(zip), /Duplicate ZIP entry/u)
})

test('archive inventory rejects symlink entries', () => {
  const dir = temporary('radar-zip-'), zip = path.join(dir, 'symlink.zip')
  const ps = `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('${zip.replace(/'/gu, "''")}',[System.IO.Compression.ZipArchiveMode]::Create);$e=$z.CreateEntry('link');$e.ExternalAttributes=([int]0xA000 -shl 16);$w=[IO.StreamWriter]::new($e.Open());$w.Write('target');$w.Dispose();$z.Dispose()`
  execFileSync('powershell', ['-NoProfile', '-Command', ps])
  assert.throws(() => archiveInventory(zip), /symlink/u)
})

test('ZIP traversal entries are rejected', () => {
  const dir = temporary('radar-zip-'), zip = path.join(dir, 'traversal.zip')
  const ps = `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('${zip.replace(/'/gu, "''")}',[System.IO.Compression.ZipArchiveMode]::Create);$e=$z.CreateEntry('../escape.txt');$w=[IO.StreamWriter]::new($e.Open());$w.Write('x');$w.Dispose();$z.Dispose()`
  execFileSync('powershell', ['-NoProfile', '-Command', ps])
  assert.throws(() => archiveInventory(zip), /Unsafe ZIP entry/u)
})

test('write-like flags are rejected by committed scripts', () => {
  for (const script of ['prepare-radar-research-assessment-bulk-v02.mjs', 'assemble-radar-research-assessment-bulk-v02.mjs']) {
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/radar', script), '--apply'], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /rejects --apply/u)
  }
})

test('committed code has no Payload, PostgreSQL, Works mutation, or production apply path', () => {
  const files = ['lib/research-assessment-handoff-v02.mjs', 'prepare-radar-research-assessment-bulk-v02.mjs', 'assemble-radar-research-assessment-bulk-v02.mjs']
  const text = files.map((file) => fs.readFileSync(path.join(repo, 'scripts/radar', file), 'utf8')).join('\n')
  assert.doesNotMatch(text, /getPayload|payload\.update|UPDATE\s+works|productionApplyAuthorized:\s*true/iu)
})

test('closed-world research package rejects missing manifests, unlisted files, and bad hashes', () => {
  const acceptance = { waveCount: 1, rowsPerWave: 1, rowCount: 1, researchResponseFilesPerWave: 1, laneCounts: {}, ...researchContract }
  const missing = temporary('radar-package-')
  assert.throws(() => loadResearchPackage(missing, '', path.join(testRuns, 'scratch'), acceptance), /review-manifest.json missing/u)
  const unlisted = temporary('radar-package-'); fs.writeFileSync(path.join(unlisted, 'review-manifest.json'), '[]'); fs.writeFileSync(path.join(unlisted, 'extra.txt'), 'x')
  assert.throws(() => loadResearchPackage(unlisted, '', path.join(testRuns, 'scratch'), acceptance), /Unlisted payload file/u)
  const bad = temporary('radar-package-'); fs.writeFileSync(path.join(bad, 'payload.txt'), 'x'); fs.writeFileSync(path.join(bad, 'review-manifest.json'), JSON.stringify([{ file: 'payload.txt', bytes: 1, sha256: '0'.repeat(64) }]))
  assert.throws(() => loadResearchPackage(bad, '', path.join(testRuns, 'scratch'), acceptance), /Review manifest mismatch/u)
})

test('outer ZIP SHA mismatch is rejected before extraction', () => {
  const dir = temporary('radar-zip-'), zip = path.join(dir, 'one.zip')
  fs.writeFileSync(path.join(dir, 'one.txt'), 'x')
  execFileSync('tar', ['-a', '-cf', zip, '-C', dir, 'one.txt'])
  assert.throws(() => loadResearchPackage(zip, '0'.repeat(64), path.join(testRuns, 'scratch'), { waveCount: 1 }), /Outer research ZIP SHA-256 mismatch/u)
})

test('safety reporting distinguishes data_local generation from exports review artifacts', () => {
  const fixture = assessmentFixture(), manifest = JSON.parse(fs.readFileSync(path.join(fixture.root, 'package-manifest.json')))
  assert.equal(manifest.safety.generatedDataConfinedToDataLocal, true)
  assert.equal(manifest.safety.reviewArtifactsWrittenUnderExports, true)
  assert.equal(manifest.safety.arbitraryOutputPathsAllowed, false)
  assert.equal('onlyWritesUnderDataLocal' in manifest.safety, false)
  const wrapper = fs.readFileSync(path.join(repo, 'scripts/radar/run-and-package-radar-research-assessment-bulk-v02.ps1'), 'utf8')
  assert.match(wrapper, /Assert-ChildPath \$OutDir 'data_local'/u)
  assert.match(wrapper, /Assert-ChildPath \$PreparedZip 'exports'/u)
})

test('arbitrary Node and wrapper output paths are rejected', () => {
  const nodeResult = spawnSync(process.execPath, [assembler, '--package-dir', path.join(repo, 'exports')], { encoding: 'utf8' })
  assert.notEqual(nodeResult.status, 0)
  assert.match(nodeResult.stderr, /must remain under data_local/u)
  const wrapper = path.join(repo, 'scripts/radar/run-and-package-radar-research-assessment-bulk-v02.ps1')
  const wrapperResult = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper, '-ResearchInput', 'missing.zip', '-ExpectedSha256', '0'.repeat(64), '-PreparedZip', 'data_local/not-an-export.zip'], { encoding: 'utf8' })
  assert.notEqual(wrapperResult.status, 0)
  assert.match(`${wrapperResult.stdout}\n${wrapperResult.stderr}`, /PreparedZip must remain under exports/u)
})

test('real accepted ZIP preparation is deterministic when explicitly supplied', { skip: !process.env.RADAR_RESEARCH_REVIEW_ZIP }, () => {
  const prepare = path.join(repo, 'scripts/radar/prepare-radar-research-assessment-bulk-v02.mjs')
  const acceptance = path.join(repo, 'scripts/radar/fixtures/radar-research-assessment-accepted-0001-v02.json')
  const base = path.join(testRuns, 'radar-v02-determinism'), outputs = [`${base}-a`, `${base}-b`]
  for (const output of outputs) {
    fs.rmSync(output, { recursive: true, force: true })
    const result = spawnSync(process.execPath, [prepare, '--input', process.env.RADAR_RESEARCH_REVIEW_ZIP, '--expected-sha256', process.env.RADAR_RESEARCH_REVIEW_SHA, '--acceptance', acceptance, '--out-dir', output], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const a = JSON.parse(fs.readFileSync(path.join(outputs[0], 'package-manifest.json'))), b = JSON.parse(fs.readFileSync(path.join(outputs[1], 'package-manifest.json')))
  assert.deepEqual(a, b)
  assert.equal(a.waveCount, 10); assert.equal(a.chunkCount, 100); assert.equal(a.responseSlotCount, 100)
  assert.deepEqual({ ...a.researchVerification, perWave: undefined }, { sourceRows: 2500, responseRows: 2500, assembledRows: 2500, verifiedRows: 2500, expectedResponseFiles: 500, verifiedResponseFiles: 500, sourceResponseIdentityMismatches: 0, responseAssembledIdentityMismatches: 0, responseAssembledFieldMismatches: 0, perWave: undefined })
  assert.equal(a.researchVerification.perWave.length, 10)
  assert.ok(a.researchVerification.perWave.every((wave) => wave.sourceRows === 250 && wave.responseRows === 250 && wave.assembledRows === 250 && wave.verifiedResponseFiles === 50))
  assert.equal(sha256File(path.join(outputs[0], 'immutable-root-manifest-v02.json')), sha256File(path.join(outputs[1], 'immutable-root-manifest-v02.json')))
  for (const output of outputs) fs.rmSync(output, { recursive: true, force: true })
})
