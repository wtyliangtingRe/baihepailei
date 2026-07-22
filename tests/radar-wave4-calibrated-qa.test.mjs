import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const RUNNER = 'scripts/radar/run-ai-radar-wave4-calibrated-qa-v01.ps1'
const runner = fs.readFileSync(RUNNER, 'utf8')

test('Wave 4 calibrated QA runner is fixed to the verified package and source chain', () => {
  assert.match(runner, /RADAR-WAVE4-CALIBRATED-ASSESSMENT-AND-LEGACY-QA-v01/u)
  assert.match(runner, /eeebc2474a98e0c5e89348aabb8ceb1f038a076da0b46c16b827a40daf158ec6/u)
  assert.match(runner, /3a99ee6aad204bce0b26329b7543ea0b7eae92d862ce2db2aca0d156a113072d/u)
  assert.match(runner, /552b7f3e1ff3f7a3f909e0932dd972a92fd03ba64830d2d63619f54a77fcce66/u)
})

test('Wave 4 calibrated QA runner validates all assessment and legacy dispositions', () => {
  for (const pattern of [
    /\$ExpectedNewAssessmentRows = 10/u,
    /\$ExpectedGradeA = 6/u,
    /\$ExpectedGradeE = 4/u,
    /\$ExpectedNewQaPassed = 8/u,
    /\$ExpectedNewQaDeferred = 2/u,
    /\$ExpectedLegacyRows = 10223/u,
    /\$ExpectedLegacyPassed = 1200/u,
    /\$ExpectedLegacyPassedWithCaution = 839/u,
    /\$ExpectedLegacyDeferredEvidence = 8148/u,
    /\$ExpectedLegacyDeferredRouteReview = 32/u,
    /\$ExpectedLegacyDeferredRuleConflict = 4/u,
    /\$ExpectedLegacyValidated = 2039/u,
    /\$ExpectedLegacyDeferred = 8184/u,
  ]) assert.match(runner, pattern)
})

test('Wave 4 calibrated QA runner validates hashes and unique identities', () => {
  assert.match(runner, /SHA256SUMS\.txt/u)
  assert.match(runner, /Assert-SafeRelativePath/u)
  assert.match(runner, /Get-FileHash/u)
  assert.match(runner, /HashSet\[string\]/u)
  assert.match(runner, /Duplicate identity/u)
  assert.match(runner, /validationErrors/u)
})

test('Wave 4 calibrated QA runner installs separate queues and a compact checkpoint', () => {
  assert.match(runner, /ready10-ai-qa-passed-v01\.jsonl/u)
  assert.match(runner, /ready10-ai-qa-deferred-v01\.jsonl/u)
  assert.match(runner, /legacy-ai-qa-passed-with-caution-v01\.jsonl/u)
  assert.match(runner, /legacy-ai-qa-deferred-evidence-v01\.jsonl/u)
  assert.match(runner, /legacy-ai-qa-deferred-route-review-v01\.jsonl/u)
  assert.match(runner, /legacy-ai-qa-deferred-rule-conflict-v01\.jsonl/u)
  assert.match(runner, /RADAR-WAVE4-CALIBRATED-ASSESSMENT-AND-LEGACY-QA-checkpoint-v01/u)
})

test('Wave 4 calibrated QA runner preserves local-only safety boundaries', () => {
  assert.match(runner, /publicationReady = \$false/u)
  assert.match(runner, /PayloadWrite = \$false/u)
  assert.match(runner, /DirectPostgresqlWrite = \$false/u)
  assert.doesNotMatch(runner, /payload\.update|payload\.create|UPDATE\s+works|INSERT\s+INTO/iu)
  assert.doesNotMatch(runner, /[A-Za-z]:\\/u)
})
