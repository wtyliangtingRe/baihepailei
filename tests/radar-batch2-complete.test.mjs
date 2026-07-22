import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const finalizer = 'scripts/radar/finalize-ai-radar-batch2-v01.mjs'
const runner = 'scripts/radar/run-ai-radar-batch2-complete-v01.ps1'

test('Batch 2 finalizer parses successfully', () => {
  const result = spawnSync(process.execPath, ['--check', finalizer], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('Batch 2 complete runner derives the repository root and contains no fixed drive path', () => {
  const text = fs.readFileSync(runner, 'utf8')
  assert.match(text, /\$PSScriptRoot/)
  assert.match(text, /GetRelativePath/)
  assert.doesNotMatch(text, /[A-Za-z]:\\/)
})

test('Batch 2 complete workflow keeps AI and human review tracks separate', () => {
  const finalizerText = fs.readFileSync(finalizer, 'utf8')
  const runnerText = fs.readFileSync(runner, 'utf8')
  assert.match(finalizerText, /humanReviewStatus: 'not_started_separate_track'/)
  assert.match(finalizerText, /humanTrackAction: 'none_separate_track'/)
  assert.match(runnerText, /HumanTrackMutations = 0/)
  assert.doesNotMatch(`${finalizerText}\n${runnerText}`, /Payload.*PATCH|UPDATE\s+works|INSERT\s+INTO/iu)
})

test('Batch 2 complete runner validates fixed batch counts and package hashes', () => {
  const text = fs.readFileSync(runner, 'utf8')
  assert.match(text, /\$ExpectedResearchRows = 100/)
  assert.match(text, /\$ExpectedAssessmentRows = 75/)
  assert.match(text, /\$ExpectedAiQaPassed = 69/)
  assert.match(text, /\$ExpectedAiQaDeferred = 6/)
  assert.match(text, /Get-FileHash/)
  assert.match(text, /SHA-256 不匹配/)
})
