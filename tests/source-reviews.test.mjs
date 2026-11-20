import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPublicModule, loadPublicRelease } from '../scripts/lib/load-public-release.mjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const { resolveReview, matchesReviewEdition } = loadPublicModule(process.cwd(), 'src/lib/sourceReview.ts')
const { PUBLIC_GRADES, getPublicWorkById, getPublicWorkList, getPublicReleaseManifest } = loadPublicRelease(process.cwd())
const finding = (kind, grade, code) => ({ kind, grade, classes: [code], urls: [`https://example.org/${kind}`] })
const resolve = findings => resolveReview({workId:'1', rationale:'test', findings}, {state:'not_assessed',classes:[]}, PUBLIC_GRADES)
const official = finding('official', 'S', 'S-RELATIONSHIP')
const community = finding('community', 'E', 'E-PAST-MALE-ROMANCE')
test('a lower supported grade intercepts from either source, independently of input order', () => {
  for (const findings of [[official, community], [community, official]]) {
    const result = resolve(findings)
    assert.equal(result.grade, 'E')
    assert.equal(result.decidingSource, 'community')
    assert.equal(result.evidenceUrl, community.urls[0])
  }
  assert.equal(resolve([finding('official','F','F-MALE-ROMANTIC-AXIS'),community]).decidingSource, 'official')
})
test('equal decisions prefer official evidence and community evidence can stand alone', () => {
  assert.equal(resolve([community, {...community, kind:'official'}]).decidingSource, 'official')
  assert.equal(resolve([community]).decidingSource, 'community')
})
test('a recovered book must match its original title, valid ISBN and edition page', () => {
  const edition = { catalogTitle: '青い花 (01)', isbn: '9784778320058', media: 'manga',
    sourceUrl: 'https://www.ohtabooks.com/publish/2005/12/15202731.html' }
  const row = { siteId: null, edition }
  assert.ok(matchesReviewEdition(row, edition.catalogTitle, null))
  assert.equal(matchesReviewEdition(row, '青い花 (02)', null), false)
  assert.equal(matchesReviewEdition(row, edition.catalogTitle, 'different-edition'), false)
  for (const changes of [{ isbn: '9784778320059' }, { sourceUrl: 'invalid' }, { sourceUrl: 'https://www.ohtabooks.com' }]) {
    assert.equal(matchesReviewEdition({ ...row, edition: { ...edition, ...changes } }, edition.catalogTitle, null), false)
  }
  const book = getPublicWorkById('32740')
  assert.equal(book.media.format, '漫画单行本')
  assert.equal(book.rating.grade, 'F')
  assert.ok(book.sources.some(s => s.url === edition.sourceUrl && s.title.includes(edition.isbn)))
})
test('every reviewed source identity resolves to a visible grade at least as conservative as its findings', () => {
  const readRows = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse)
  const reviews = readRows('data/public-release/review-20261121/reviews.jsonl')
  const manifest = JSON.parse(readFileSync('data/public-release/review-20261121/manifest.json', 'utf8'))
  const payload = readFileSync('data/public-release/review-20261121/reviews.jsonl')
  assert.equal(createHash('sha256').update(payload).digest('hex'), manifest.sha256)
  assert.equal(reviews.length, manifest.publishedReviewRows)
  const baseDir = 'data/public-release/v4/'
  const base = JSON.parse(readFileSync(baseDir+'manifest.json', 'utf8'))
  const catalog = new Map(base.shards.flatMap(s => readRows(baseDir+s.file)).map(w => [w.workId, w]))
  const grades = {...base.gradeCounts}
  const covered = new Set()
  const canonicalFindings = new Map()
  for (const row of reviews) {
    const before = catalog.get(row.workId)
    assert.ok(matchesReviewEdition(row, before.title, before.identity.siteId), row.workId)
    assert.ok(!covered.has(row.workId))
    covered.add(row.workId)
    const expected = [...row.findings].sort((a,b) => PUBLIC_GRADES.indexOf(b.grade)-PUBLIC_GRADES.indexOf(a.grade) ||
      Number(b.kind === 'official')-Number(a.kind === 'official'))[0]
    if (before.rating.grade) grades[before.rating.grade]--
    grades[expected.grade]++
    const shown = getPublicWorkById(row.workId)
    assert.ok(PUBLIC_GRADES.indexOf(shown.rating.grade) >= PUBLIC_GRADES.indexOf(expected.grade), row.workId)
    const tags = shown.publicTags.filter(t => t.group === '评级来源')
    assert.ok(tags.length <= 1)
    if (!canonicalFindings.has(shown.workId)) canonicalFindings.set(shown.workId, [])
    canonicalFindings.get(shown.workId).push(...row.findings)
  }
  for (const [workId, findings] of canonicalFindings) {
    const work = getPublicWorkById(workId)
    const winning = findings.filter(f => f.grade === work.rating.grade)
    if (!winning.length) continue // A more conservative historical member can decide the merged grade.
    const kind = winning.some(f => f.kind === 'official') ? 'official' : 'community'
    assert.equal(work.rating.decidingSource, kind, workId)
    assert.deepEqual(work.publicTags.filter(t => t.group === '评级来源').map(t => t.key), ['source-'+kind], workId)
  }
  assert.equal(reviews.filter(row => !catalog.get(row.workId).rating.grade).length, manifest.newlyRatedSourceRecords)
  assert.equal(getPublicReleaseManifest().counts.ratedWorks, manifest.ratedSourceRecords)
  assert.deepEqual(JSON.parse(JSON.stringify(getPublicReleaseManifest().gradeCounts)), grades)
})

test('source filters retain the deciding source when combined with grade and pagination', () => {
  for (const source of ['official', 'community']) {
    const samples = getPublicWorkList({ source, limit: 5, offset: 2 })
    assert.ok(samples.total > samples.items.length)
    assert.ok(samples.items.every(work => work.rating.decidingSource === source))
    const grade = samples.items[0].rating.grade
    const filtered = getPublicWorkList({ source, grade, limit: 3 })
    assert.ok(filtered.items.length)
    assert.ok(filtered.items.every(work => work.rating.decidingSource === source && work.rating.grade === grade))
  }
})
