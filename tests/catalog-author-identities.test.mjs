import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { loadPublicRelease } from '../scripts/lib/load-public-release.mjs'

test('individual staff have the credited roles and retain links to each edition from their old profile', {
  skip: Boolean(process.env.BAIHEPAILEI_RELEASE_DIR?.trim()),
}, () => {
  const base = 'data/public-release/identity-20261121/'
  const authors = JSON.parse(readFileSync(base + 'author-identities.json', 'utf8')).authors
  const credits = gunzipSync(readFileSync(base + 'staff-credits.jsonl.gz')).toString('utf8').trim().split('\n').map(JSON.parse)
  const release = loadPublicRelease(process.cwd())
  for (const author of authors) {
    const profile = release.getPublicCreatorById(author.sourceId)
    assert.equal(profile.kind, 'person')
    assert.equal(profile.creatorId, author.creatorId)
    const works = new Set()
    const first = release.getPublicCreatorWorks(author.sourceId, { limit: 100 })
    for (let offset = 0; offset < first.total; offset += 100) {
      const page = offset ? release.getPublicCreatorWorks(author.sourceId, { offset, limit: 100 }) : first
      for (const item of page.items) works.add(item.work.workId)
    }
    const signed = credits.filter(row => row.person === author.person && row.creatorId === author.sourceId)
    assert.ok(signed.length)
    for (const row of signed) {
      const work = release.getPublicWorkById(row.sourceWorkId)
      const matching = work.creators.filter(credit => credit.creatorId === author.creatorId && credit.role === row.role)
      assert.equal(matching.length, 1, work.title + ' / ' + author.name + ' / ' + row.role)
      for (const url of ['https://bgm.tv/subject/' + row.subject + '/persons', 'https://bgm.tv/person/' + row.person, author.authority, author.additionalAuthority]) {
        assert.ok(matching[0].sourceUrls.includes(url), work.title + ' / ' + url)
      }
      assert.ok(!work.organizations.some(credit => credit.creatorId === author.sourceId || credit.creatorId === author.creatorId))
      assert.ok(works.has(work.workId))
    }
  }
  for (const [id, group] of [['815000001783', 'PEACH-PIT'], ['815000001959', '藤子不二雄'], ['815000026057', '가지']]) {
    assert.equal(release.getPublicCreatorById(id).name, group)
    assert.equal(release.getPublicCreatorById(id).kind, 'organization')
    assert.equal(release.getPublicCreatorById(id).creatorId, id)
  }
  const joint = release.getPublicWorkById('31257')
  assert.ok(joint.creators.some(credit => credit.creatorId === '1007204' && credit.name === 'サトウナンキ'))
  assert.ok(release.getPublicCreatorById('541715575304').names.includes('ユキムラ'))
})
