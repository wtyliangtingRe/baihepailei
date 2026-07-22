import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const script = 'scripts/radar/run-ai-radar-batch2-start-v02.ps1'

test('portable Batch 2 kickoff rewrites manifest paths as repository-relative', () => {
  const text = fs.readFileSync(script, 'utf8')
  assert.match(text, /To-RepoRelative/)
  assert.match(text, /sourceCatalogManifest = To-RepoRelative/)
  assert.match(text, /sourceBatchFile = To-RepoRelative/)
  assert.match(text, /copiedSourceFile = To-RepoRelative/)
  assert.match(text, /ManifestPathsAreRepoRelative = \$true/)
})

test('portable Batch 2 kickoff contains no fixed drive path or database write path', () => {
  const text = fs.readFileSync(script, 'utf8')
  assert.doesNotMatch(text, /[A-Za-z]:\\/)
  assert.doesNotMatch(text, /Payload.*PATCH|UPDATE\s+works|INSERT\s+INTO/iu)
  assert.match(text, /HumanTrackMutations = 0/)
})
