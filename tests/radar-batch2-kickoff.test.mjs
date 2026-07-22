import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const file = 'scripts/radar/run-ai-radar-batch2-start-v01.ps1'
const text = fs.readFileSync(file, 'utf8')

test('batch 2 kickoff uses repository-relative data_local paths', () => {
  assert.match(text, /\$RepoRoot\s*=\s*\[System\.IO\.Path\]::GetFullPath\(\(Join-Path \$PSScriptRoot/u)
  assert.match(text, /\$DataLocal\s*=.*Join-Path \$RepoRoot "data_local"/u)
  assert.doesNotMatch(text, /[A-Za-z]:\\(?:0GitHubtest|Users|data_local)/u)
})

test('batch 2 kickoff is fixed to the 100-row second external research batch', () => {
  assert.match(text, /\$BatchId\s*=\s*"RADAR-RESEARCH-0002"/u)
  assert.match(text, /\$ExpectedRows\s*=\s*100/u)
  assert.match(text, /\$ChunkSize\s*=\s*5/u)
  assert.match(text, /\$ExpectedChunks\s*=\s*20/u)
  assert.match(text, /queue -eq "external_research"/u)
})

test('batch 2 kickoff validates source and chunk hashes before packaging', () => {
  assert.match(text, /Get-FileHash -LiteralPath \$SourceFile -Algorithm SHA256/u)
  assert.match(text, /Get-FileHash -LiteralPath \$InputFile -Algorithm SHA256/u)
  assert.match(text, /研究块 SHA-256 不匹配/u)
  assert.match(text, /SHA256SUMS\.txt/u)
})

test('batch 2 kickoff invokes only the local research preparer and creates one upload zip', () => {
  assert.match(text, /prepare-ai-radar-research-handoff-v01\.mjs/u)
  assert.match(text, /--batch-id \$BatchId/u)
  assert.match(text, /--manifest \$CatalogManifestFile/u)
  assert.match(text, /--out-dir \$ResearchRoot/u)
  assert.match(text, /--chunk-size \$ChunkSize/u)
  assert.match(text, /RADAR-RESEARCH-0002-input-v01/u)
  assert.match(text, /UploadZip = \$PackageZip/u)
})

test('batch 2 kickoff declares zero formal and human-track writes', () => {
  assert.match(text, /payloadWrite = \$false/u)
  assert.match(text, /directPostgresqlWrite = \$false/u)
  assert.match(text, /modifiesWorks = \$false/u)
  assert.match(text, /publishesRatings = \$false/u)
  assert.match(text, /humanTrackMutations = 0/u)
  assert.doesNotMatch(text, /Invoke-RestMethod[\s\S]*PATCH/iu)
  assert.doesNotMatch(text, /\bpsql\b|UPDATE\s+works|INSERT\s+INTO/iu)
})
