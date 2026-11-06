import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const before = join(root, 'data/public-release/v2')
const after = join(root, 'data/public-release/v3')
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const rows = path => readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse)
const currentManifest = json(join(after, 'manifest.json'))
const record = currentManifest.sourceOfTruth.officialSourceAssessment
const bytes = readFileSync(join(after, record.file))
assert.equal(bytes.length, record.bytes)
assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256)
const additions = rows(join(after, record.file))
assert.equal(additions.length, record.rows)
assert.equal(new Set(additions.map(row => row.workId)).size, additions.length)
const byId = new Map(additions.map(row => [row.workId, row]))
const oldManifest = json(join(before, 'manifest.json'))
const oldRecords = oldManifest.shards.flatMap(shard => rows(join(before, shard.file)))
const newRecords = currentManifest.shards.flatMap(shard => rows(join(after, shard.file)))
assert.equal(oldRecords.length, newRecords.length)
let changed = 0
for (let i = 0; i < oldRecords.length; i++) {
  const old = oldRecords[i], now = newRecords[i], added = byId.get(old.workId)
  if (!added) { assert.deepEqual(now, old); continue }
  changed++
  assert.equal(old.identity.state, 'exact')
  assert.equal(old.identity.provider, added.provider)
  assert.equal(old.identity.siteId, added.siteId)
  assert.equal(old.rating.state, 'not_assessed')
  assert.equal(now.audited, true)
  assert.equal(now.rating.state, 'rated')
  assert.equal(now.rating.grade, added.grade)
  assert.ok(added.classes.includes(now.rating.class))
  assert.equal(now.rating.needsMoreResearch, true)
  assert.equal(added.fullWorkViewed, false)
  assert.ok(added.sources.length >= 2)
  for (const source of added.sources) {
    assert.equal(source.kind, 'official')
    assert.equal(new URL(source.url).protocol, 'https:')
  }
  assert.deepEqual({ ...now, audited: old.audited, rating: old.rating }, old)
}
assert.equal(changed, additions.length)
console.log(JSON.stringify({status:'PASS', added:changed, identityAndExistingRecordsPreserved:true}))
