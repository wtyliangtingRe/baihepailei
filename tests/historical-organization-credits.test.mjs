import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadPublicRelease } from '../scripts/lib/load-public-release.mjs'

test('historical company names and project memberships retain references and reverse links', {
  skip: Boolean(process.env.BAIHEPAILEI_RELEASE_DIR?.trim()),
}, () => {
  const data = JSON.parse(readFileSync('data/public-release/identity-20261121/historical-organization-credits.json', 'utf8'))
  const release = loadPublicRelease(process.cwd())
  for (const [oldId, id] of Object.entries(data.redirects)) {
    assert.equal(release.getPublicCreatorById(oldId).creatorId, id)
    assert.equal(release.getPublicCreatorById(oldId).kind, 'organization')
    assert.equal(release.getPublicCreatorWorks(oldId).total, release.getPublicCreatorWorks(id).total)
  }
  for (const row of data.credits) {
    const work = release.getPublicWorkById(row.workId)
    assert.ok(!work.creators.some(c => c.creatorId === row.oldId || c.creatorId === row.creatorId))
    const target = work.organizations.filter(c => c.creatorId === row.creatorId && c.role === row.role)
    assert.equal(target.length, 1, work.title + ' / ' + row.name + ' / ' + row.role)
    const edition = 'https://bgm.tv/subject/' + row.subject + (row.source === 'staff' ? '/persons' : '')
    for (const url of [edition, ...row.urls]) assert.ok(target[0].sourceUrls.includes(url), work.title + ' / ' + url)
    if (row.person) assert.ok(target[0].sourceUrls.includes('https://bgm.tv/person/' + row.person))
  }
  const kemono = release.getPublicWorkById('15580')
  assert.deepEqual(kemono.organizations.filter(c => c.role === '原作').map(c => c.name), ['けものフレンズプロジェクト'])
  assert.deepEqual(kemono.organizations.filter(c => c.role === '原作项目成员').map(c => c.name).sort(),
    ['ブシロード', 'クロックワークス', 'KADOKAWA', 'クランチロールSCアニメファンド', 'ドコモ・アニメストア'].sort())
  const milky = release.getPublicWorkById('32045')
  assert.ok(milky.organizations.some(c => c.name === 'ブシロード' && c.role === '原作'))
  assert.ok(milky.organizations.some(c => c.name === 'クロノギアクリエイティヴ' && c.role === '原作'))
  assert.equal(release.getPublicCreatorById('1002070').name, 'ブシロードクリエイティブ')
  assert.equal(release.getPublicCreatorById('1002070').creatorId, '1002070')
})
