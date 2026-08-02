import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('./fixtures/radar-unified-rating-incremental-release-9988-v01/', import.meta.url)
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8')
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function checksumMap(text) {
  const out = {}
  for (const line of text.split('\n').filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/u)
    assert.ok(match, `Invalid checksum line: ${line}`)
    out[match[2]] = match[1]
  }
  return out
}

test('private Research acceptance fixture matches website lock', () => {
  const lock = JSON.parse(fs.readFileSync(new URL('../config/radar-unified-rating-incremental-release-9988-v01.lock.json', import.meta.url), 'utf8'))
  const acceptance = JSON.parse(read('research-acceptance.json'))
  const manifestText = read('manifest.json')
  const manifest = JSON.parse(manifestText)
  const sums = checksumMap(read('SHA256SUMS'))

  assert.equal(acceptance.accepted, true)
  assert.equal(acceptance.productionAuthorization, false)
  assert.equal(acceptance.researchMainHead, lock.researchCommitSha)
  assert.equal(acceptance.releaseId, lock.releaseId)
  assert.equal(acceptance.releasePath, lock.releasePath)
  assert.equal(acceptance.manifestSha256, lock.manifestSha256)
  assert.equal(acceptance.verifiedWorkflowArtifactZipSha256, 'c7ce4422d2e2e80f8a325859aebe8ac701e316cd8c238e186461c20858a09400')

  assert.equal(sha256(manifestText), lock.manifestSha256)
  assert.equal(sums['manifest.json'], lock.manifestSha256)
  assert.equal(sums['records.jsonl'], lock.recordsSha256)
  assert.equal(sums['ratings.jsonl'], lock.ratingsSha256)
  assert.equal(sums['release-index.jsonl'], lock.releaseIndexSha256)
  assert.equal(sums['identity-review-excluded.jsonl'], lock.identityReviewExcludedSha256)

  assert.equal(manifest.releaseId, lock.releaseId)
  assert.equal(manifest.previousRelease.releaseId, lock.previousRelease.releaseId)
  assert.equal(manifest.previousRelease.recordsSha256, lock.previousRelease.recordsSha256)
  assert.equal(manifest.previousRelease.recordCount, lock.previousRelease.recordCount)
  assert.deepEqual(manifest.gradeCounts, lock.gradeCounts)
  assert.deepEqual(manifest.classCounts, lock.classCounts)
  assert.equal(manifest.counts.records, lock.counts.records)
  assert.equal(manifest.counts.ratings, lock.counts.ratings)
  assert.equal(manifest.counts.identityReviewExcluded, lock.counts.identityReviewExcluded)
  assert.equal(manifest.counts.facts, lock.counts.facts)
  assert.equal(manifest.counts.evidence, lock.counts.evidence)
  assert.equal(manifest.counts.sourceRefs, lock.counts.sourceRefs)

  assert.equal(manifest.gates.closedWorldInventory, true)
  assert.equal(manifest.gates.identityReviewExcluded, true)
  assert.equal(manifest.gates.reviewedLowerGradeIdentitySetsLocked, true)
  assert.equal(manifest.gates.productionAuthorization, false)
  assert.equal(manifest.gates.automaticX, false)
  assert.equal(manifest.lowerGradeTriggerPolicy.maleEIdentityCount, 7)
  assert.equal(manifest.lowerGradeTriggerPolicy.ntrEIdentityCount, 3)
})
