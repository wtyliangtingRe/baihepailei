import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const RUNNER = 'scripts/radar/run-ai-radar-wave4-2500-results-v01.ps1'
const runner = fs.readFileSync(RUNNER, 'utf8')

test('Wave 4 result runner is fixed to the verified input and result packages', () => {
  assert.match(runner, /RADAR-INCREMENTAL-WAVE-0004-2500-input-v02/u)
  assert.match(runner, /RADAR-INCREMENTAL-WAVE-0004-2500-complete-results-v01/u)
  assert.match(runner, /1a7b880c14c2a1c609306598b71ed313711c637663ea75b76a28eb647bbe5966/u)
  assert.match(runner, /3a99ee6aad204bce0b26329b7543ea0b7eae92d862ce2db2aca0d156a113072d/u)
})

test('Wave 4 result runner validates all fixed row and subwave counts', () => {
  assert.match(runner, /\$ExpectedResearchRows = 2500/u)
  assert.match(runner, /\$ExpectedReadyRows = 10/u)
  assert.match(runner, /\$ExpectedNeedsMoreRows = 2191/u)
  assert.match(runner, /\$ExpectedIdentityReviewRows = 299/u)
  assert.match(runner, /\$ExpectedLegacyReassessmentRows = 10223/u)
  assert.match(runner, /\$ExpectedSubwaves = 10/u)
  assert.match(runner, /resultUniqueIdentities/u)
  assert.match(runner, /schemaErrors/u)
})

test('Wave 4 result runner validates nested hashes and recovery manifests', () => {
  assert.match(runner, /SHA256SUMS\.txt/u)
  assert.match(runner, /manifestSha256/u)
  assert.match(runner, /complete_first_pass/u)
  assert.match(runner, /chunkCount -ne 50/u)
  assert.match(runner, /HashSet\[string\]/u)
})

test('Wave 4 result runner partitions queues without formal writes', () => {
  assert.match(runner, /ready_for_ai_assessment/u)
  assert.match(runner, /needs_more_research/u)
  assert.match(runner, /identity_review/u)
  assert.match(runner, /publicationReady = \$false/u)
  assert.match(runner, /PayloadWrite = \$false/u)
  assert.match(runner, /DirectPostgresqlWrite = \$false/u)
  assert.doesNotMatch(runner, /payload\.update|payload\.create|UPDATE\s+works|INSERT\s+INTO/iu)
  assert.doesNotMatch(runner, /[A-Za-z]:\\/u)
})
