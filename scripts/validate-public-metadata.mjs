import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { loadPublicRelease } from './lib/load-public-release.mjs'

const root = process.cwd()
const release = process.env.BAIHEPAILEI_RELEASE_DIR || join(root,'data/public-release/v4')
const directory = join(release,'metadata-20260905-v01')
const readJson = path => JSON.parse(readFileSync(path,'utf8'))
const manifest = readJson(join(directory,'manifest.json'))
const baseManifest = readJson(join(release,'manifest.json'))
const readLines = path => readFileSync(path,'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
const base = baseManifest.shards.flatMap(shard => readLines(join(release,shard.file)))
const identities = new Map(base.map(row => [row.workId,row.identity.siteId || '']))
const allowed = new Set(['schemaVersion','workId','siteId','aliases','localizedTitles','creators','organizations','sources','media','format','firstPublished','firstPublishedLabel','firstPublishedPrecision','summary'])
const all = []
for (const shard of manifest.shards) {
  assert.match(shard.file,/^metadata-\d{4}\.jsonl\.gz$/)
  const bytes=readFileSync(join(directory,shard.file))
  assert.equal(bytes.length,shard.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),shard.sha256)
  const raw=gunzipSync(bytes,{maxOutputLength:10_000_000})
  assert.equal(raw.length,shard.uncompressedBytes)
  assert.equal(createHash('sha256').update(raw).digest('hex'),shard.uncompressedSha256)
  const rows=raw.toString('utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));assert.equal(rows.length,shard.rows);all.push(...rows)
}
assert.equal(all.length,base.length)
assert.equal(new Set(all.map(row=>row.workId)).size,base.length)
function url(value) {
  const parsed=new URL(value);assert.equal(parsed.protocol,'https:');assert.equal(parsed.username,'');assert.equal(parsed.password,'')
}
for (const row of all) {
  for (const field of Object.keys(row)) assert.ok(allowed.has(field),`Metadata may not write ${field}`)
  assert.equal(row.schemaVersion,'baihepailei-public-metadata-v1')
  assert.equal(row.siteId || '',identities.get(row.workId),`Exact identity ${row.workId}`)
  for (const list of ['aliases','localizedTitles','creators','organizations','sources']) assert.ok(Array.isArray(row[list]))
  if (row.summary) {
    assert.ok(['source_summary','identity_summary'].includes(row.summary.kind))
    assert.ok(row.summary.text.length>=(row.summary.kind==='identity_summary' ? 8 : 16) && row.summary.text.length<=500,`Short introduction ${row.workId}`)
    assert.doesNotMatch(row.summary.text,/<[^>]*>|accepted catalogue|no supported plot|externally identifiable|简介待补充/i)
    if(row.summary.sourceUrl)url(row.summary.sourceUrl)
  }
  for (const credit of [...row.creators,...row.organizations]) {
    assert.ok(credit.name && credit.role)
    assert.doesNotMatch(credit.name,/<[^>]*>|^(unknown|n\/a|none|不详|未知)$/i)
    if(credit.sourceUrl)url(credit.sourceUrl)
  }
  for (const source of row.sources)url(source.url)
}
// This baseline was exported from main 19a6885 BEFORE any runtime edits.
// A change to deduplication itself cannot silently redefine this expectation.
const baselineBytes=readFileSync(join(directory,'baseline-bindings.json.gz'))
assert.equal(createHash('sha256').update(baselineBytes).digest('hex'),manifest.baseline.sha256)
assert.equal(manifest.baseline.sourceCommit,'19a6885d250f6c54c1722002798912ac08f3ddb3')
const baselineRows=JSON.parse(gunzipSync(baselineBytes).toString('utf8'))
const baseline=new Map(baselineRows.map(row=>[row.sourceWorkId,row]))
const ratingAdditions=baseManifest.displayIdentityBaseline
  ? new Set(readLines(join(release,'pack-reuse-20260908-v01.jsonl')).map(row=>baseline.get(row.workId)?.primaryWorkId))
  : new Set()
const officialAssessmentFile = baseManifest.sourceOfTruth?.officialSourceAssessment?.file
if (officialAssessmentFile) for (const row of readLines(join(release, officialAssessmentFile))) ratingAdditions.add(baseline.get(row.workId)?.primaryWorkId)
const newerAssessmentFile = baseManifest.sourceOfTruth?.sourceAssessment20261107?.file
const ratingRevisions = new Set()
if (newerAssessmentFile) for (const row of readLines(join(release, newerAssessmentFile))) {
  const primaryId = baseline.get(row.workId)?.primaryWorkId
  ratingAdditions.add(primaryId)
  if (row.revision) ratingRevisions.add(primaryId)
}
assert.equal(baseline.size,base.length)
const current=loadPublicRelease(root)
const identityRoot=join(root,'data/public-release/identity-20261121')
const currentReview=!process.env.BAIHEPAILEI_RELEASE_DIR?.trim()
const reviewedMedia=new Map()
if (currentReview) {
  for (const review of readLines(join(root, 'data/public-release/review-20261121/reviews.jsonl'))) {
    const row = baseline.get(review.workId)
    assert.ok(row, `Missing review identity ${review.workId}`)
    ratingRevisions.add(row.primaryWorkId)
    if (review.edition) reviewedMedia.set(row.primaryWorkId,review.edition.media)
  }
}
const recovered = new Map(currentReview ? readLines(join(identityRoot,'recovered-bangumi.jsonl')).map(row => [row.workId,row]) : [])
const bangumiCorrections = new Map(currentReview ? readLines(join(identityRoot,'bangumi-corrections.jsonl')).map(row => [row.workId,row]) : [])
const legacyBindings = new Map(currentReview ? readLines(join(identityRoot,'legacy-bindings.jsonl')).map(row => [row.workId,row]) : [])
const groupTargets=new Map()
if(currentReview) for(const group of readLines(join(identityRoot,'groups.jsonl'))) {
  for(const id of group.workIds) {
    groupTargets.set(id,group.primaryWorkId)
    if(group.resolvedMedia) reviewedMedia.set(id,group.resolvedMedia.group)
  }
}
const correctedUrls=new Map(currentReview ? readLines(join(identityRoot,'corrections.jsonl')).filter(row=>row.wrongUrl)
  .map(row=>[row.workId,row]) : [])
if (currentReview) for (const row of readLines(join(identityRoot,'corrections.jsonl'))) {
  if (row.media) reviewedMedia.set(row.workId,row.media.group)
  if (!row.firstPublished) continue
  const work=current.getPublicWorkById(row.workId)
  assert.equal(work.firstPublished,row.firstPublished)
  assert.equal(work.firstPublishedLabel,row.firstPublished)
  assert.equal(work.firstPublishedPrecision,'day')
  assert.ok(work.sources.some(source=>source.url===row.url))
}
const publicWorks=new Map()
for(const record of base){
  const before=baseline.get(record.workId),after=current.getPublicWorkById(record.workId)
  const restored = recovered.get(record.workId)
  const basePrimary = restored || recovered.has(before.primaryWorkId) ? record.workId : before.primaryWorkId
  const expectedPrimary = groupTargets.get(basePrimary) || basePrimary
  assert.equal(after.workId,expectedPrimary,`Stable canonical route ${record.workId}`)
  const corrected=correctedUrls.get(before.primaryWorkId)
  if(corrected && before.rating.evidenceUrl===corrected.wrongUrl) before.rating.evidenceUrl=corrected.url
  if (!restored && !recovered.has(before.primaryWorkId) && !groupTargets.has(before.primaryWorkId) && !ratingRevisions.has(before.primaryWorkId) && (before.rating.state!=='not_assessed' || !ratingAdditions.has(before.primaryWorkId))) {
    assert.equal(JSON.stringify(after.rating),JSON.stringify(before.rating),`Stable rating ${record.workId}`)
  }
  const correctedCatalog = bangumiCorrections.get(record.workId)
  const legacy = legacyBindings.get(record.workId)
  if (legacy) {
    assert.equal(record.identity.siteId,legacy.catalogSiteId)
    assert.equal(record.title,legacy.catalogTitle)
    assert.ok(after.catalogIdentifiers.some(id => id.siteId === legacy.siteId && id.url === legacy.url))
    assert.ok([after.title,...after.aliases,...after.localizedTitles.map(item => item.title)].includes(legacy.originalTitle))
  }
  if (correctedCatalog) {
    assert.equal(record.identity.siteId,correctedCatalog.siteId)
    assert.ok(after.sources.some(source => source.url === correctedCatalog.url))
    if (correctedCatalog.title) {
      assert.ok([after.title,...after.aliases,...after.localizedTitles.map(item => item.title)].includes(correctedCatalog.originalTitle))
      assert.ok(!/[\u0080-\u009f\ufffd]/u.test(after.title))
    }
  }
  if (restored) {
    assert.ok(after.catalogIdentifiers.some(id => id.siteId === restored.siteId && id.url === restored.url))
    assert.ok(after.sources.some(source => source.url === restored.url))
    assert.ok([after.title,...after.aliases,...after.localizedTitles.map(item => item.title)].includes(restored.originalTitle))
  }
  const previousMedia = restored?.media.group || correctedCatalog?.media?.group || reviewedMedia.get(basePrimary) || before.media
  assert.equal(after.media.group,previousMedia === 'unknown' && legacy?.media ? legacy.media.group : previousMedia,`Stable media identity ${record.workId}`)
  publicWorks.set(after.workId,after)
}
if (bangumiCorrections.has('31834')) {
  const book = current.getPublicWorkById('31834')
  assert.equal(book.title, '星降り坂一丁目三番地')
  assert.ok(book.aliases.includes('星振り坂一丁目三番地'))
  assert.ok(book.sources.some(s => s.title === '出版社书目' && s.url === 'https://data.ichijinsha.co.jp/detail/75807274'))
}
const recent = current.getPublicRecentWorks()
for (const { work, releasedOn } of recent) {
  assert.equal(work.rating.gradeReviewed, true)
  assert.match(releasedOn, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(work.rating.sourceFindings.length && work.rating.decidingSource)
  if (!publicWorks.has(work.workId)) {
    assert.equal(work.workId, current.getPublicWorkById(work.workId).workId)
    assert.equal(work.firstPublished, releasedOn)
    assert.ok(work.sources.length && work.summary?.text)
    publicWorks.set(work.workId, work)
  }
}
const works=[...publicWorks.values()]
const count=fn=>works.filter(fn).length
const report={sourceWorks:current.getPublicCatalogMergeStats().sourceWorks,visibleWorks:works.length,stableCanonicalIds:true,unreviewedRatingsPreserved:true,
  aliases:count(row=>row.aliases.length || row.localizedTitles.some(t=>t.title!==row.title)),
  knownMedia:count(row=>row.media.group!=='unknown'),creatorCredits:count(row=>row.creators.length),
  organizationCredits:count(row=>row.organizations.length),anyCredits:count(row=>row.creators.length || row.organizations.length),
  publicationDates:count(row=>row.firstPublished),plotSummaries:count(row=>row.summary?.kind==='source_summary'),
  identityIntroductions:count(row=>row.summary?.kind==='identity_summary'),missingIntroductions:count(row=>!row.summary),
  missingCredits:count(row=>!row.creators.length && !row.organizations.length),status:'PASS'}
assert.equal(works.length,current.getPublicCatalogMergeStats().visibleWorks)
const reportPath=process.argv.indexOf('--report')
if(reportPath>=0)writeFileSync(process.argv[reportPath+1],JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
