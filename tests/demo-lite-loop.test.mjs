import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const demoContent = JSON.parse(fs.readFileSync(new URL('../fixtures/demo-content.json', import.meta.url), 'utf8'))
const demoSearch = JSON.parse(fs.readFileSync(new URL('../fixtures/demo-search-index.json', import.meta.url), 'utf8'))
const demoDetail = JSON.parse(fs.readFileSync(new URL('../fixtures/demo-detail-index.json', import.meta.url), 'utf8'))

function byCollection(index, collection) {
  return index.items.filter((item) => item.collection === collection)
}

function byId(index) {
  return new Map(index.items.map((item) => [item.id, item]))
}

function titles(index, collection) {
  return new Set(byCollection(index, collection).map((item) => item.title))
}

test('demo fixture covers frontend content collections', () => {
  assert.equal(demoContent.works.length, 3)
  assert.equal(demoContent.creators.length, 3)
  assert.equal(demoContent.organizations.length, 3)
  assert.equal(demoContent.evidence.length, 2)

  for (const collection of ['works', 'creators', 'organizations', 'evidence']) {
    for (const item of demoContent[collection]) {
      assert.ok(item.slug.startsWith('demo-'))
    }
  }
})

test('demo search index matches demo collection counts', () => {
  assert.equal(demoSearch.schemaVersion, 2)
  assert.equal(demoSearch.counts.works, demoContent.works.length)
  assert.equal(demoSearch.counts.creators, demoContent.creators.length)
  assert.equal(demoSearch.counts.organizations, demoContent.organizations.length)
  assert.equal(demoSearch.counts.evidence, demoContent.evidence.length)
  assert.equal(demoSearch.total, demoSearch.items.length)
})

test('demo detail index matches demo search index ids', () => {
  assert.equal(demoDetail.schemaVersion, 2)
  assert.equal(demoDetail.total, demoDetail.items.length)

  const searchIds = new Set(demoSearch.items.map((item) => item.id))
  const detailIds = new Set(demoDetail.items.map((item) => item.id))

  for (const id of searchIds) assert.ok(detailIds.has(id), `${id} missing from detail index`)
  for (const id of detailIds) assert.ok(searchIds.has(id), `${id} missing from search index`)
})

test('demo works link to creators and organizations by display title', () => {
  const creatorTitles = titles(demoDetail, 'creators')
  const organizationTitles = titles(demoDetail, 'organizations')

  for (const work of byCollection(demoDetail, 'works')) {
    assert.ok(work.url.startsWith('/works/demo-'))
    for (const creator of work.creators || []) assert.ok(creatorTitles.has(creator), `${creator} missing creator detail`)
    for (const organization of work.organizations || []) assert.ok(organizationTitles.has(organization), `${organization} missing organization detail`)
  }
})

test('demo evidence links back to works, creators and organizations', () => {
  const workTitles = titles(demoDetail, 'works')
  const creatorTitles = titles(demoDetail, 'creators')
  const organizationTitles = titles(demoDetail, 'organizations')

  for (const evidence of byCollection(demoDetail, 'evidence')) {
    assert.ok(evidence.url.startsWith('/evidence/demo-'))
    assert.ok(evidence.evidenceType)
    for (const work of evidence.relatedWorks || []) assert.ok(workTitles.has(work), `${work} missing work detail`)
    for (const creator of evidence.relatedCreators || []) assert.ok(creatorTitles.has(creator), `${creator} missing creator detail`)
    for (const organization of evidence.relatedOrganizations || []) assert.ok(organizationTitles.has(organization), `${organization} missing organization detail`)
  }
})

test('demo index supports frontend routes and search scopes', () => {
  const items = byId(demoSearch)

  assert.equal(items.get('works:demo-work-garden-promise').url, '/works/demo-work-garden-promise')
  assert.equal(items.get('creators:demo-creator-a').url, '/creators/demo-creator-a')
  assert.equal(items.get('organizations:demo-org-publisher').url, '/organizations/demo-org-publisher')
  assert.equal(items.get('evidence:demo-evidence-garden-a').url, '/evidence/demo-evidence-garden-a')

  assert.ok(byCollection(demoSearch, 'works').some((item) => item.organizations?.includes('Demo 百合出版社')))
  assert.ok(byCollection(demoSearch, 'evidence').some((item) => item.relatedWorks?.includes('Demo 百合花园的约定')))
})

test('demo lite indexes do not contain old wiki tracking fields', () => {
  const searchText = JSON.stringify(demoSearch)
  const detailText = JSON.stringify(demoDetail)

  assert.equal(searchText.includes('legacyXWikiPage'), false)
  assert.equal(detailText.includes('legacyXWikiPage'), false)
})
