import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadPublicRelease, loadPublicModule } from './lib/load-public-release.mjs'

const root = process.cwd()
const beforeDir = join(root, 'data/public-release/v1')
const afterDir = join(root, 'data/public-release/v2')
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const lines = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse)
const readCatalog = dir => json(join(dir,'manifest.json')).shards.flatMap(s => lines(join(dir,s.file)))
const before = readCatalog(beforeDir), after = readCatalog(afterDir)
const byId = new Map(after.map(r => [r.workId,r]))
const assessments = lines(join(afterDir,'pack-reuse-20260908-v01.jsonl'))
const additions = new Map(assessments.map(r => [r.workId,r]))
const policy = loadPublicModule(root, 'src/lib/radar/ratingPolicy.ts')
assert.equal(additions.size,633)
assert.equal(before.length,after.length)
for (const old of before) {
  const now=byId.get(old.workId), a=additions.get(old.workId)
  assert.ok(now)
  if (!a) assert.deepEqual(now,old,`Unselected record changed: ${old.workId}`)
  else {
    assert.equal(old.rating.state,'not_assessed')
    assert.equal(a.siteId,old.identity.siteId)
    assert.equal(now.rating.grade,a.grade)
    assert.deepEqual({...now,rating:old.rating,audited:old.audited},old)
    assert.ok(a.sources.length)
    assert.equal(a.externalResearchPerformedThisRun,false)
    assert.equal(a.humanReviewed,false)
    for (const c of a.classes) {
      assert.equal(policy.radarClassDefinitions[c]?.grade,a.grade)
      assert.equal(policy.radarClassDefinitions[c].doNotAutoPublish,false)
    }
  }
}
assert.ok(readFileSync(join(beforeDir,'creators-20260906-v01/entities.jsonl.gz')).equals(readFileSync(join(afterDir,'creators-20260906-v01/entities.jsonl.gz'))),'Creator identities changed')
for (const folder of ['metadata-20260905-v01','creators-20260906-v01','equivalence']) {
  function check(relative='') {
    for (const item of readdirSync(join(beforeDir,folder,relative),{withFileTypes:true})) {
      const sub=join(relative,item.name)
      if (item.isDirectory()) check(sub)
      else assert.ok(readFileSync(join(beforeDir,folder,sub)).equals(readFileSync(join(afterDir,folder,sub))),`Historical metadata changed: ${folder}/${sub}`)
    }
  }
  check()
}
for (const file of ['enrichment-rating-details.jsonl','enrichment-work-assets.jsonl']) {
  const current=new Map(lines(join(afterDir,file)).map(r=>[r.workId,r]))
  for (const old of lines(join(beforeDir,file))) {
    const now=current.get(old.workId)
    for (const [key,value] of Object.entries(old)) {
      if (Array.isArray(value)) for (const item of value) assert.ok(now[key].some(x=>JSON.stringify(x)===JSON.stringify(item)),`Lost ${old.workId}/${key}`)
      else assert.deepEqual(now[key],value,`Lost ${old.workId}/${key}`)
    }
  }
}
process.env.BAIHEPAILEI_RELEASE_DIR=beforeDir
const base=loadPublicRelease(root)
const oldRecords=base.getPublicCreatorGraphInput()
const oldById=new Map(before.map(r=>[r.workId,base.getPublicWorkById(r.workId)]))
process.env.BAIHEPAILEI_RELEASE_DIR=afterDir
const release=loadPublicRelease(root), records=release.getPublicCreatorGraphInput()
assert.equal(records.length,oldRecords.length)
let changedPrimary=0
for (const old of before) {
  const a=oldById.get(old.workId), b=release.getPublicWorkById(old.workId)
  assert.ok(b,`Lost route for ${old.workId}`)
  if(a.workId!==b.workId) changedPrimary++
  assert.equal(b.workId,a.workId,`Published primary WorkId changed: ${old.workId}`)
  assert.deepEqual(JSON.parse(JSON.stringify(b.media)),JSON.parse(JSON.stringify(a.media)))
  if(old.audited) assert.deepEqual(JSON.parse(JSON.stringify(b.rating)),JSON.parse(JSON.stringify(a.rating)),`Existing conclusion changed: ${old.workId}`)
  for (const field of ['creators','organizations']) {
    for(const credit of a[field]) assert.ok(b[field].some(c=>c.creatorId===credit.creatorId && c.role===credit.role),`Lost creator ${old.workId}`)
  }
  const newTitles=new Set([b.title,...b.aliases,...b.localizedTitles.map(x=>x.title)])
  for(const name of [a.title,...a.aliases,...a.localizedTitles.map(x=>x.title)]) assert.ok(newTitles.has(name),`Lost title ${old.workId}`)
  if(a.summary?.kind==='source_summary') assert.equal(b.summary?.text,a.summary.text,`Lost source summary ${old.workId}`)
}
const stats=rows=>({visibleWorks:rows.length,concludedWorks:rows.filter(r=>r.rating.state!=='not_assessed').length,ratedWorks:rows.filter(r=>r.rating.state==='rated').length,nonratingTerminalWorks:rows.filter(r=>!['rated','not_assessed'].includes(r.rating.state)).length})
assert.deepEqual(stats(records),{visibleWorks:34940,concludedWorks:4750,ratedWorks:4633,nonratingTerminalWorks:117})
console.log(JSON.stringify({status:'PASS',newRawRatings:additions.size,before:stats(oldRecords),after:stats(records),changedPrimaryRoutes:changedPrimary,allWorkIdRoutesPreserved:true,allExistingConclusionsPreserved:true},null,2))
