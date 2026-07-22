import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const RUNNER = 'scripts/radar/run-ai-radar-wave5-priority35-results-v01.ps1'
const runner = fs.readFileSync(RUNNER, 'utf8')

test('Wave 5 priority-35 runner is bound to the verified package and source chain', () => {
  assert.match(runner, /\$PackageId = "RADAR-WAVE5-PRIORITY35-RESEARCH-RESULTS-v01"/u)
  assert.match(runner, /a09702bb94367ad3149b1b976309e70aef54e9ee2d3f245dbcfb77c1f089550f/u)
  assert.match(runner, /9d0f9f6002681b3851d1aaa3da9970af03396d222cfc1015cf4ee42f9e2c9be3/u)
  assert.match(runner, /c3c0f21cfe3a3c3c2f10a4d0393d8ecf5c0a79b1c0a3f04c85a97ab6f84c7f76/u)
})

test('Wave 5 priority-35 runner validates fixed row and grade counts', () => {
  assert.match(runner, /\$ExpectedRows = 35/u)
  assert.match(runner, /\$ExpectedPassedRows = 34/u)
  assert.match(runner, /\$ExpectedDeferredRows = 1/u)
  assert.match(runner, /\$ExpectedGradeA = 3/u)
  assert.match(runner, /\$ExpectedGradeD = 32/u)
})

test('Wave 5 priority-35 runner validates all calibrated rule counts', () => {
  assert.match(runner, /\$ExpectedRuleANearConfirmed = 2/u)
  assert.match(runner, /\$ExpectedRuleAYuriHarem = 1/u)
  assert.match(runner, /\$ExpectedRuleDABO = 1/u)
  assert.match(runner, /\$ExpectedRuleDMultiEnding = 15/u)
  assert.match(runner, /\$ExpectedRuleDGeneral = 15/u)
  assert.match(runner, /\$ExpectedRuleDUnclear = 1/u)
})

test('Wave 5 priority-35 runner verifies hashes and exact identity partitions', () => {
  assert.match(runner, /SHA256SUMS\.txt/u)
  assert.match(runner, /Assert-SafeRelativePath/u)
  assert.match(runner, /HashSet\[string\]/u)
  assert.match(runner, /Identity missing from passed\/deferred partitions/u)
  assert.match(runner, /Unexpected identity in passed\/deferred partitions/u)
})

test('Wave 5 priority-35 runner installs local queues and creates a checkpoint', () => {
  assert.match(runner, /wave5-priority35-results-v01/u)
  assert.match(runner, /RADAR-WAVE5-PRIORITY35-RESEARCH-RESULTS-checkpoint-v01/u)
  assert.match(runner, /priority35-all-v01\.jsonl/u)
  assert.match(runner, /Compress-Archive/u)
})

test('Wave 5 priority-35 runner preserves local-only safety boundaries', () => {
  assert.match(runner, /publicationReady = \$false/u)
  assert.match(runner, /payloadWrite = \$false/u)
  assert.match(runner, /directPostgresqlWrite = \$false/u)
  assert.match(runner, /humanTrackMutations = 0/u)
  assert.doesNotMatch(runner, /payload\.update|payload\.create|UPDATE\s+works|INSERT\s+INTO/iu)
  assert.doesNotMatch(runner, /[A-Za-z]:\\/u)
})
