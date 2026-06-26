import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/demo-linked-content.json', import.meta.url), 'utf8'))

function slugs(collection) {
  return new Set(fixture[collection].map((item) => item.slug))
}

function titlesBySlug(collection) {
  return new Map(fixture[collection].map((item) => [item.slug, item.title || item.name]))
}

test('linked demo fixture has enough relationship data', () => {
  assert.equal(fixture.creators.length, 5)
  assert.equal(fixture.organizations.length, 4)
  assert.equal(fixture.works.length, 5)
  assert.equal(fixture.evidence.length, 4)
})

test('all linked demo slugs are safe demo slugs', () => {
  for (const collection of ['creators', 'organizations', 'works', 'evidence']) {
    for (const item of fixture[collection]) {
      assert.ok(item.slug.startsWith('demo-linked-'))
    }
  }
})

test('works reference existing creators and organizations', () => {
  const creatorSlugs = slugs('creators')
  const organizationSlugs = slugs('organizations')

  for (const work of fixture.works) {
    assert.ok(work.creators.length > 0, `${work.slug} should have creators`)
    assert.ok(work.organizations.length > 0, `${work.slug} should have organizations`)
    for (const creator of work.creators) assert.ok(creatorSlugs.has(creator), `${work.slug} unknown creator ${creator}`)
    for (const item of work.organizations) assert.ok(organizationSlugs.has(item.organization), `${work.slug} unknown organization ${item.organization}`)
  }
})

test('evidence references existing works creators and organizations', () => {
  const workSlugs = slugs('works')
  const creatorSlugs = slugs('creators')
  const organizationSlugs = slugs('organizations')

  for (const evidence of fixture.evidence) {
    assert.ok(evidence.relatedWorks.length > 0, `${evidence.slug} should link works`)
    for (const work of evidence.relatedWorks) assert.ok(workSlugs.has(work), `${evidence.slug} unknown work ${work}`)
    for (const creator of evidence.relatedCreators) assert.ok(creatorSlugs.has(creator), `${evidence.slug} unknown creator ${creator}`)
    for (const organization of evidence.relatedOrganizations) assert.ok(organizationSlugs.has(organization), `${evidence.slug} unknown organization ${organization}`)
  }
})

test('fixture creates many-to-many creator and organization graph', () => {
  const workCountByCreator = new Map()
  const workCountByOrganization = new Map()

  for (const work of fixture.works) {
    for (const creator of work.creators) workCountByCreator.set(creator, (workCountByCreator.get(creator) || 0) + 1)
    for (const item of work.organizations) workCountByOrganization.set(item.organization, (workCountByOrganization.get(item.organization) || 0) + 1)
  }

  assert.ok([...workCountByCreator.values()].some((count) => count >= 3), 'at least one creator should connect to three works')
  assert.ok([...workCountByOrganization.values()].some((count) => count >= 3), 'at least one organization should connect to three works')
})

test('fixture includes concrete pages to inspect relationship cards', () => {
  const workTitles = titlesBySlug('works')
  const creatorTitles = titlesBySlug('creators')
  const organizationTitles = titlesBySlug('organizations')

  assert.equal(workTitles.get('demo-linked-work-cross-project'), 'Demo 联动作品：交叉企划')
  assert.equal(creatorTitles.get('demo-linked-creator-a'), 'Demo 联动作者 A')
  assert.equal(organizationTitles.get('demo-linked-org-platform'), 'Demo 联动发布平台')
})
