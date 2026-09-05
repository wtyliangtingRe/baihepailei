import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { loadPublicRelease } from './lib/load-public-release.mjs'

const root = process.cwd()
const release = process.env.BAIHEPAILEI_RELEASE_DIR || join(root,'data/public-release/v1')
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
// Compare the actual runtime with the same code before its metadata overlay.
// No hand-maintained copy of deduplication or rating selection is involved.
const entry=join(root,'src/lib/publicRelease.ts')
const source=readFileSync(entry,'utf8')
const start=source.indexOf('  const metadata = readPublicMetadata(')
const end=source.indexOf('  globalThis.__baihepaileiPublicRelease = {',start)
assert.ok(start>=0 && end>start)
const baselineSource=source.slice(0,start)+'  const records = merged.records\n  const byWorkId = merged.byWorkId\n'+source.slice(end)
const baseline=loadPublicRelease(root,{[entry]:baselineSource})
const current=loadPublicRelease(root)
const publicWorks=new Map()
for(const record of base){
  const before=baseline.getPublicWorkById(record.workId),after=current.getPublicWorkById(record.workId)
  assert.equal(after.workId,before.workId,`Stable canonical route ${record.workId}`)
  assert.equal(JSON.stringify(after.rating),JSON.stringify(before.rating),`Stable rating ${record.workId}`)
  assert.equal(after.media.group,before.media.group,`Stable media identity ${record.workId}`)
  publicWorks.set(after.workId,after)
}
const works=[...publicWorks.values()]
const count=fn=>works.filter(fn).length
const report={sourceWorks:base.length,visibleWorks:works.length,stableCanonicalIds:true,stableRatings:true,
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
