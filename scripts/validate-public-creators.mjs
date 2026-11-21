import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { loadPublicRelease, loadPublicModule } from './lib/load-public-release.mjs'

const root = process.cwd()
const release = loadPublicRelease(root)
const { collectWorkReferences } = loadPublicModule(root, 'src/lib/publicWorkReferences.ts')
const directory = join(process.env.BAIHEPAILEI_RELEASE_DIR || join(root, 'data/public-release/v4'), 'creators-20260906-v01')
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
const entities = gunzipSync(readFileSync(join(directory, 'entities.jsonl.gz'))).toString('utf8').trim().split('\n').map(JSON.parse)
const keyOwners = new Map()
for (const entity of entities) {
  for (const key of entity.keys) {
    assert.ok(!keyOwners.has(key), `Duplicate identity key: ${key}`)
    keyOwners.set(key, entity.creatorId)
  }
  assert.ok(Number(entity.creatorId) < manifest.nextId)
  const byNamespace = new Map()
  for (const identity of entity.identities) {
    assert.ok(!byNamespace.has(identity.namespace) || byNamespace.get(identity.namespace) === identity.externalId,
      `Conflicting provider IDs in Creator ${entity.creatorId}`)
    byNamespace.set(identity.namespace, identity.externalId)
  }
}
const identityRoot = join(root, 'data/public-release/identity-20261121')
const currentReview = !process.env.BAIHEPAILEI_RELEASE_DIR?.trim()
const reviewCounts = currentReview ? JSON.parse(readFileSync(join(identityRoot, 'manifest.json'), 'utf8')).counts
  : { extraEntities: 0, releasedTitleMatches: 0, mergeGroups: 0, credits: 0, newlyCreditedWorks: 0, duplicateCreditedWorks: 0, removedEntities: 0 }
const extraEntities = currentReview ? readFileSync(join(identityRoot, 'entities.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : []
assert.equal(extraEntities.length, reviewCounts.extraEntities)
const bibliographyRoot = join(root, 'data/public-release/bibliography-20261121')
const bookCounts = currentReview ? JSON.parse(readFileSync(join(bibliographyRoot, 'credits-manifest.json'), 'utf8'))
  : { entities: 0, credits: 0, newlyCreditedWorks: 0 }
const staffCounts = currentReview ? JSON.parse(readFileSync(join(identityRoot, 'staff-manifest.json'), 'utf8'))
  : { entities: 0, credits: 0, newlyCreditedWorks: 0 }
if (currentReview) {
  const bookEntities = gunzipSync(readFileSync(join(bibliographyRoot, 'book-entities.jsonl.gz'))).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  assert.equal(bookEntities.length, bookCounts.entities)
  extraEntities.push(...bookEntities)
  const staffEntities = gunzipSync(readFileSync(join(identityRoot, 'staff-entities.jsonl.gz'))).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  assert.equal(staffEntities.length, staffCounts.entities)
  extraEntities.push(...staffEntities)
}
if (currentReview) {
  const corrections = readFileSync(join(identityRoot, 'corrections.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  for (const correction of corrections.filter(row => row.releaseCredits)) {
    const work = release.getPublicWorkById(correction.workId)
    assert.equal(work.title, correction.catalogTitle)
    for (const credit of correction.releaseCredits) {
      const rows = credit.creditKind === 'person' ? work.creators : work.organizations
      assert.ok(rows.some(row => row.creatorId === credit.creatorId && row.role === credit.role &&
        row.sourceUrls.includes(credit.sourceUrl || correction.url)))
    }
  }
  for (const correction of corrections.filter(row => row.edition)) {
    const work = release.getPublicWorkById(correction.workId)
    assert.equal(work.title, correction.edition.catalogTitle)
    assert.ok(work.sources.some(source => source.url === correction.url && source.title.includes(correction.edition.isbn)))
    for (const credit of correction.edition.credits) {
      const rows = credit.creditKind === 'person' ? work.creators : work.organizations
      assert.ok(rows.some(row => row.creatorId === credit.creatorId && row.role === credit.role &&
        row.sourceUrls.includes(credit.sourceUrl || correction.url)), `Missing edition credit: ${work.workId} ${credit.name}`)
    }
  }
}
const records = release.getPublicCreatorGraphInput()
assert.equal(records.length, manifest.counts.publicWorks + reviewCounts.releasedTitleMatches - (reviewCounts.mergedSourceRows ?? reviewCounts.mergeGroups))
const publicIds = new Set(records.map(work => work.workId))
let linkedCredits = 0, references = 0
const expectedWorks = new Map()
for (const record of records) {
  const work = release.getPublicWorkById(record.workId)
  const refs = collectWorkReferences(work)
  const urls = new Set(refs.map(ref => ref.url))
  const oldUrls = new Set([
    ...record.sources.map(source => source.url), record.summary?.sourceUrl, record.rating.evidenceUrl,
    ...(record.rating.sourceFindings || []).flatMap(finding => finding.urls),
    ...(record.rating.evidenceSources || []).map(source => source.url),
    ...[...record.creators, ...record.organizations].flatMap(credit => [credit.sourceUrl, ...(credit.sourceUrls || [])]),
  ].filter(Boolean))
  assert.equal(urls.size, oldUrls.size, `External links preserved without additions: ${record.workId}`)
  for (const url of oldUrls) assert.ok(urls.has(url), `Lost source ${url}`)
  for (const field of ['creators', 'organizations']) {
    for (const credit of record[field]) {
      assert.ok(work[field].some(item => item.originalNames.includes(credit.name) && item.role === credit.role),
        `Lost original credit ${record.workId}: ${credit.name}`)
    }
    for (const credit of work[field]) {
      const creator = release.getPublicCreatorById(credit.creatorId)
      assert.ok(creator)
      assert.equal(creator.kind, credit.creatorKind)
      const ids = expectedWorks.get(creator.creatorId) || new Set()
      ids.add(record.workId); expectedWorks.set(creator.creatorId, ids)
      linkedCredits++
    }
  }
  references += refs.length
}
let relatedWorks = 0
for (const entity of [...entities, ...extraEntities]) {
  const result = release.getPublicCreatorWorks(entity.creatorId, { limit: 100 })
  const rows = [...result.items]
  for (let offset = 100; offset < result.total; offset += 100) rows.push(...release.getPublicCreatorWorks(entity.creatorId, { offset, limit: 100 }).items)
  const ids = new Set(rows.map(entry => entry.work.workId))
  assert.equal(ids.size, rows.length, 'A work must not repeat under multiple roles')
  assert.deepEqual([...ids].sort(), [...(expectedWorks.get(entity.creatorId) || [])].sort())
  for (const id of ids) assert.ok(publicIds.has(id))
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].year === 'unknown' || (rows[i - 1].year !== 'unknown' && rows[i - 1].year >= rows[i].year), 'Years must descend, unknown last')
  }
  relatedWorks += ids.size
}
assert.equal(release.getPublicCreatorById('not-an-id'), null)
assert.equal(release.getPublicCreatorById(String(manifest.nextId)), null)
const creditedWorks = records.filter(work => work.creators.length || work.organizations.length).length
assert.equal(creditedWorks, manifest.counts.creditedWorks + reviewCounts.newlyCreditedWorks - reviewCounts.duplicateCreditedWorks +
  bookCounts.newlyCreditedWorks + staffCounts.newlyCreditedWorks)
if (currentReview) assert.equal(release.getPublicCreatorById('1010974'), null, 'Retired null Steam organization')
console.log(JSON.stringify({ creators: entities.length + extraEntities.length - reviewCounts.removedEntities, publicWorks: records.length,
  creditedWorks, supplementaryCredits: reviewCounts.credits + bookCounts.credits + staffCounts.credits, linkedCredits, relatedWorks, references,
  uniqueIds: true, originalCreditsPreserved: true, existingLinksPreserved: true, publicWorkIdsOnly: true, status: 'PASS' }, null, 2))
