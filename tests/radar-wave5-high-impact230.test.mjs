import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const RUNNER = 'scripts/radar/run-ai-radar-wave5-high-impact230-start-v01.ps1'
const runner = fs.readFileSync(RUNNER, 'utf8')

test('Wave 5 high-impact runner is bound to the fixed package and source chain', () => {
  assert.match(runner, /RADAR-WAVE5-HIGH-IMPACT-230-input-v01/u)
  assert.match(runner, /323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3/u)
  assert.match(runner, /9d0f9f6002681b3851d1aaa3da9970af03396d222cfc1015cf4ee42f9e2c9be3/u)
  assert.match(runner, /c3c0f21cfe3a3c3c2f10a4d0393d8ecf5c0a79b1c0a3f04c85a97ab6f84c7f76/u)
  assert.match(runner, /a09702bb94367ad3149b1b976309e70aef54e9ee2d3f245dbcfb77c1f089550f/u)
  assert.match(runner, /ea126e8039a7879ddd38e05de5ff4edb369395407ed9849c61f5744743b6a224/u)
})

test('Wave 5 high-impact runner validates fixed grade and chunk counts', () => {
  assert.match(runner, /\$ExpectedRows = 230/u)
  assert.match(runner, /\$ExpectedChunks = 46/u)
  assert.match(runner, /\$ExpectedS = 1/u)
  assert.match(runner, /\$ExpectedA = 122/u)
  assert.match(runner, /\$ExpectedE = 99/u)
  assert.match(runner, /\$ExpectedF = 8/u)
})

test('Wave 5 high-impact runner validates all nested hashes', () => {
  assert.match(runner, /SHA256SUMS\.txt/u)
  assert.match(runner, /aggregateFileSha256/u)
  assert.match(runner, /Chunk SHA-256 mismatch/u)
})

test('Wave 5 high-impact runner validates exact aggregate and chunk identity equality', () => {
  assert.match(runner, /Aggregate identity missing from chunk union/u)
  assert.match(runner, /Chunk identity missing from aggregate/u)
  assert.match(runner, /Cross-chunk duplicate identity/u)
  assert.match(runner, /priority35Overlap/u)
})

test('Wave 5 high-impact runner preserves row-level and package-level safety', () => {
  assert.match(runner, /publicationStatus -ne "do_not_publish"/u)
  assert.match(runner, /requiresHumanReview -ne \$true/u)
  assert.match(runner, /PayloadWrite = \$false/u)
  assert.match(runner, /DirectPostgresqlWrite = \$false/u)
  assert.doesNotMatch(runner, /payload\.update|payload\.create|UPDATE\s+works|INSERT\s+INTO/iu)
  assert.doesNotMatch(runner, /[A-Za-z]:\\/u)
})

test('Wave 5 high-impact runner installs only under data_local and creates a checkpoint', () => {
  assert.match(runner, /data_local/u)
  assert.match(runner, /wave5-high-impact230-input-v01/u)
  assert.match(runner, /input-checkpoint-v01/u)
  assert.match(runner, /Compress-Archive/u)
})
