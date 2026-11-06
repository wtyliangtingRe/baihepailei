import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const before = 'data/public-release/v3', after = 'data/public-release/v4'
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const lines = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const old = readJson(join(before, 'manifest.json'))
const current = readJson(join(after, 'manifest.json'))
const tracked = key => {
  const m = current.sourceOfTruth[key], content = readFileSync(join(after, m.file))
  assert.equal(content.length, m.bytes)
  assert.equal(createHash('sha256').update(content).digest('hex'), m.sha256)
  const result = lines(join(after, m.file)); assert.equal(result.length, m.rows)
  return result
}
const additions = tracked('sourceAssessment20261107')
const revisions = tracked('ratingRevisions20261107')
const sourceById = new Map(additions.map(row => [row.workId, row]))
const revisionById = new Map(revisions.map(row => [row.workId, row.previousRating]))
assert.equal(sourceById.size, additions.length)
const previous = old.shards.flatMap(s => lines(join(before, s.file)))
const present = current.shards.flatMap(s => lines(join(after, s.file)))
assert.equal(previous.length, present.length)
let changed = 0
for (let i = 0; i < previous.length; i++) {
  const oldRecord = previous[i], now = present[i], a = sourceById.get(oldRecord.workId)
  if (!a) { assert.deepEqual(now, oldRecord); continue }
  changed++
  assert.equal(oldRecord.identity.state, 'exact')
  assert.equal(oldRecord.identity.provider, a.provider)
  assert.equal(oldRecord.identity.siteId, a.siteId)
  if (a.revision) assert.deepEqual(revisionById.get(a.workId), oldRecord.rating)
  else assert.equal(oldRecord.rating.state, 'not_assessed')
  assert.equal(now.rating.state, 'rated')
  assert.equal(now.rating.grade, a.grade)
  assert.ok(a.classes.includes(now.rating.class))
  assert.equal(now.rating.needsMoreResearch, true)
  assert.equal(a.fullWorkViewed, false)
  assert.ok(a.sources.length)
  for (const source of a.sources) {
    assert.ok(['official', 'community'].includes(source.kind))
    assert.equal(new URL(source.url).protocol, 'https:')
  }
  assert.deepEqual({...now, audited:oldRecord.audited, rating:oldRecord.rating}, oldRecord)
}
assert.equal(changed, additions.length)
assert.equal(revisionById.size, additions.filter(a => a.revision).length)
const details = new Map(lines(join(after, 'enrichment-rating-details.jsonl')).map(d => [d.workId, d]))
for (const a of additions) {
  const d = details.get(a.workId)
  assert.equal(d.grade, a.grade)
  assert.equal(d.reasoningSummary, a.rationale)
  assert.deepEqual(d.evidenceSources, a.sources)
}
console.log(JSON.stringify({status:'PASS', assessments:changed, revisions:revisions.length, existingRecordsPreserved:true}))
