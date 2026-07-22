import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const SCRIPT = 'scripts/radar/run-ai-radar-wave3-start-v01.ps1'
const text = fs.readFileSync(SCRIPT, 'utf8')

test('wave 3 kickoff derives the repository root and contains no fixed drive path', () => {
  assert.match(text, /\$RepoRoot = \[System\.IO\.Path\]::GetFullPath/u)
  assert.doesNotMatch(text, /[A-Za-z]:\\/u)
})

test('wave 3 kickoff is fixed to 250 external-research rows from batch 0003 onward', () => {
  assert.match(text, /RADAR-RESEARCH-0003/u)
  assert.match(text, /RADAR-RESEARCH-WAVE-0003-0250/u)
  assert.match(text, /\$TargetRows -ne 250/u)
  assert.match(text, /external_research/u)
})

test('wave 3 kickoff preserves source-batch provenance and validates SHA-256', () => {
  assert.match(text, /sourceBatches/u)
  assert.match(text, /Get-FileHash/u)
  assert.match(text, /SourceSha256/u)
  assert.match(text, /wave-provenance\.json/u)
})

test('wave 3 kickoff creates 50 five-row chunks through the guarded research preparer', () => {
  assert.match(text, /\$ChunkSize = 5/u)
  assert.match(text, /prepare-ai-radar-research-handoff-v01\.mjs/u)
  assert.match(text, /ExpectedChunks/u)
})

test('wave 3 kickoff declares zero formal and human-track writes', () => {
  assert.match(text, /HumanTrackMutations = 0/u)
  assert.match(text, /PayloadWrite = \$false/u)
  assert.match(text, /DirectPostgresqlWrite = \$false/u)
  assert.doesNotMatch(text, /payload\/api\//u)
  assert.doesNotMatch(text, /UPDATE\s+works/iu)
})
