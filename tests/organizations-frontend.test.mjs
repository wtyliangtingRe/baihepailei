import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../src/app/(frontend)/page.tsx', import.meta.url), 'utf8')
const browse = fs.readFileSync(new URL('../src/app/(frontend)/browse/page.tsx', import.meta.url), 'utf8')
const orgIndex = fs.readFileSync(new URL('../src/app/(frontend)/organizations/page.tsx', import.meta.url), 'utf8')
const orgDetail = fs.readFileSync(new URL('../src/app/(frontend)/organizations/[slug]/page.tsx', import.meta.url), 'utf8')
const collectionPage = fs.readFileSync(new URL('../src/app/(frontend)/_components/CollectionIndexPage.tsx', import.meta.url), 'utf8')
const searchClient = fs.readFileSync(new URL('../src/app/(frontend)/search/search-client.tsx', import.meta.url), 'utf8')
const searchUtils = fs.readFileSync(new URL('../src/app/(frontend)/search/search-utils.mjs', import.meta.url), 'utf8')
const detailComponent = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')

test('frontend navigation and home include organizations', () => {
  assert.ok(layout.includes("href: '/organizations'"))
  assert.ok(home.includes("kind: 'organizations'"))
  assert.ok(home.includes('只搜机构'))
  assert.ok(browse.includes("href: '/organizations'"))
})

test('organizations pages are wired', () => {
  assert.ok(orgIndex.includes('CollectionIndexPage'))
  assert.ok(orgIndex.includes('collection="organizations"'))
  assert.ok(orgDetail.includes('OrganizationDetailPage'))
  assert.ok(orgDetail.includes('worksByOrganizationName'))
  assert.ok(orgDetail.includes('relatedWorks='))
})

test('collection and search support organizations', () => {
  assert.ok(collectionPage.includes("item.collection === 'organizations'"))
  assert.ok(searchClient.includes("'organizations'"))
  assert.ok(searchUtils.includes("organizations: '机构'"))
  assert.ok(searchUtils.includes('item.organizations'))
})

test('detail component labels organizations and related works', () => {
  assert.ok(detailComponent.includes("collection === 'organizations'"))
  assert.ok(detailComponent.includes('机构类型'))
  assert.ok(detailComponent.includes('相关作品'))
})
