import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const RUNNER = 'scripts/radar/run-ai-radar-wave3-complete-v01.ps1'
const FINALIZER = 'scripts/radar/finalize-ai-radar-wave3-v01.mjs'
const runner = fs.readFileSync(RUNNER, 'utf8')
const finalizer = fs.readFileSync(FINALIZER, 'utf8')

test('Wave 3 finalizer imports without executing CLI main', async () => {
  const previousExitCode = process.exitCode
  try {
    process.exitCode = undefined
    await import(`../${FINALIZER}?parse-test=${Date.now()}`)
    assert.equal(process.exitCode, undefined)
  } finally {
    process.exitCode = previousExitCode
  }
})

test('Wave 3 completion runner is repository-relative and fixed to verified counts', () => {
  assert.match(runner, /\$RepoRoot = \[System\.IO\.Path\]::GetFullPath/u)
  assert.doesNotMatch(runner, /[A-Za-z]:\\/u)
  assert.match(runner, /\$ExpectedResearchRows = 250/u)
  assert.match(runner, /\$ExpectedAssessmentRows = 83/u)
  assert.match(runner, /\$ExpectedAiQaPassed = 80/u)
  assert.match(runner, /\$ExpectedAiQaDeferred = 3/u)
})

test('Wave 3 completion validates package hashes and rebuilds the processing ledger', () => {
  assert.match(runner, /Get-FileHash/u)
  assert.match(runner, /build-ai-radar-processing-ledger-v01\.mjs/u)
  assert.match(runner, /catalog_snapshot_incremental/u)
  assert.match(runner, /ai-radar-processing-ledger-v01\.jsonl/u)
})

test('Wave 3 completion keeps formal writes and human track mutations at zero', () => {
  assert.match(runner, /HumanTrackMutations = 0/u)
  assert.match(runner, /PayloadWrite = \$false/u)
  assert.match(runner, /DirectPostgresqlWrite = \$false/u)
  assert.doesNotMatch(runner, /payload\/api\//u)
  assert.doesNotMatch(runner, /UPDATE\s+works/iu)
  assert.match(finalizer, /humanTrackAction: 'none_separate_track'/u)
})

test('Wave 3 finalizer validates AI QA expected suggestions and targeted research identities', () => {
  assert.match(finalizer, /Resolved grade mismatch/u)
  assert.match(finalizer, /Resolved decisive rule mismatch/u)
  assert.match(finalizer, /Targeted research identities do not exactly match deferred AI QA rows/u)
})
