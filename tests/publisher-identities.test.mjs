import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { loadPublicRelease } from '../scripts/lib/load-public-release.mjs'

test('publisher staff appear as organizations on the edition and their original profile links still resolve', {
  skip: Boolean(process.env.BAIHEPAILEI_RELEASE_DIR?.trim()),
}, () => {
  const directory = 'data/public-release/identity-20261121/'
  const publishers = JSON.parse(readFileSync(directory + 'publisher-identities.json', 'utf8')).publishers
  const reviewed = new Map(publishers.map(row => [row.sourceId, row]))
  const credits = gunzipSync(readFileSync(directory + 'staff-credits.jsonl.gz')).toString('utf8').trim().split('\n').map(JSON.parse)
  const release = loadPublicRelease(process.cwd())
  const reverse = new Map()
  for (const publisher of publishers) {
    const entity = release.getPublicCreatorById(publisher.sourceId)
    assert.equal(entity.kind, 'organization')
    assert.equal(entity.creatorId, publisher.organizationId)
    assert.equal(release.getPublicCreatorWorks(publisher.sourceId).total, release.getPublicCreatorWorks(entity.creatorId).total)
    const ids = new Set()
    let offset = 0
    for (;;) {
      const page = release.getPublicCreatorWorks(entity.creatorId, { offset, limit: 100 })
      for (const row of page.items) ids.add(row.work.workId)
      offset += page.items.length
      if (!page.items.length || offset >= page.total) break
    }
    reverse.set(publisher.sourceId, ids)
  }
  for (const credit of credits.filter(row => reviewed.has(row.creatorId))) {
    const publisher = reviewed.get(credit.creatorId)
    const work = release.getPublicWorkById(credit.sourceWorkId)
    const reference = `https://bgm.tv/subject/${credit.subject}/persons`
    const roles = credit.role === '出版社' ? ['出版社', '原版出版社', '译本出版社', '中文版出版社', '英文版出版社'] : [credit.role]
    assert.ok(!work.creators.some(item => item.creatorId === publisher.sourceId || item.creatorId === publisher.organizationId))
    assert.ok(work.organizations.some(item => item.creatorId === publisher.organizationId && roles.includes(item.role) &&
      item.sourceUrls.includes(reference) && item.sourceUrls.includes(`https://bgm.tv/person/${publisher.person}`) &&
      item.sourceUrls.includes(publisher.authority)), `Missing published source for ${credit.sourceWorkId}/${credit.person}`)
    assert.ok(reverse.get(publisher.sourceId).has(work.workId))
  }
  const manga = release.getPublicWorkById('5221')
  const publisher = manga.organizations.filter(row => row.creatorId === '1002019')
  assert.deepEqual(publisher.map(row => row.role), ['原版出版社'])
  assert.equal(release.getPublicCreatorById('815000007097').creatorId, '1002019')
})
