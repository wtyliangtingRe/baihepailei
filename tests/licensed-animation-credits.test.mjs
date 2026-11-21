import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadPublicRelease } from '../scripts/lib/load-public-release.mjs'

test('licensed animation credits appear on the edition and the existing creator page', {
  skip: Boolean(process.env.BAIHEPAILEI_RELEASE_DIR?.trim()),
}, () => {
  const { credits } = JSON.parse(readFileSync('data/public-release/identity-20261121/licensed-animation-credits.json', 'utf8'))
  const release = loadPublicRelease(process.cwd())
  const roleKeys = new Set()
  for (const row of credits) {
    const work = release.getPublicWorkById(row.sourceWorkId)
    const creator = release.getPublicCreatorById(row.creatorId)
    assert.equal(creator?.kind, row.kind)
    const key = [work.workId, row.creatorId, row.role].join('/')
    assert.ok(!roleKeys.has(key), `Repeated licensed credit ${key}`)
    roleKeys.add(key)
    const entries = row.kind === 'person' ? work.creators : work.organizations
    const matches = entries.filter(entry => entry.creatorId === row.creatorId && entry.role === row.role)
    assert.equal(matches.length, 1, `Missing or repeated work credit ${key}`)
    assert.ok(matches[0].sourceUrls.includes(row.programUrl) && matches[0].sourceUrls.includes(row.productionUrl))
    const year = work.firstPublished?.slice(0, 4) || 'unknown'
    let offset = 0
    let found = false
    do {
      const page = release.getPublicCreatorWorks(row.creatorId, { year, offset, limit: 100 })
      found = page.items.some(entry => entry.work.workId === work.workId && entry.roles.includes(row.role))
      offset += page.items.length
      if (offset >= page.total || !page.items.length) break
    } while (!found)
    assert.ok(found, `Missing reverse work credit ${key}`)
  }
  assert.ok(roleKeys.size >= 4)
})

test('historical animation credits keep episode ranges on the work and the named person', {
  skip: Boolean(process.env.BAIHEPAILEI_RELEASE_DIR?.trim()),
}, () => {
  const { rows, redirects } = JSON.parse(readFileSync('data/public-release/identity-20261121/animation-credit-names.json', 'utf8'))
  const release = loadPublicRelease(process.cwd())
  for (const edit of rows) {
    const work = release.getPublicWorkById(edit.workId)
    for (const target of edit.targets) {
      const edge = work.creators.find(item => item.creatorId === target.creatorId && item.role === edit.role)
      assert.equal(edge?.name, target.name)
      if (target.scope) assert.equal(edge.scope, target.scope)
      assert.ok(edge.sourceUrls.includes(`https://bgm.tv/person/${target.person}`))
    }
  }
  for (const [oldId, canonical] of Object.entries(redirects)) {
    assert.equal(release.getPublicCreatorById(oldId)?.creatorId, canonical)
    assert.equal(release.getPublicCreatorWorks(oldId).total, release.getPublicCreatorWorks(canonical).total)
  }
  const maria = release.getPublicWorkById('18556')
  assert.ok(maria.creators.some(row => row.name === '遠藤海成' && row.role === '原作'))
  assert.ok(maria.creators.some(row => row.name === '大嶋実句' && row.scope === '第5、7–8、11集'))
  const writer = release.getPublicCreatorWorks('1015958', { year: '2009', limit: 100 }).items.find(item => item.work.workId === maria.workId)
  assert.ok(writer?.roleScopes['脚本'].includes('第5、7–8、11集'))
})
