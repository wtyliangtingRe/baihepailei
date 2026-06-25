import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const detailIndexDetail = read('src/app/(frontend)/_components/DetailIndexDetail.tsx')
const searchIndexDetail = read('src/app/(frontend)/_components/SearchIndexDetail.tsx')
const searchClient = read('src/app/(frontend)/search/search-client.tsx')
const collectionIndexPage = read('src/app/(frontend)/_components/CollectionIndexPage.tsx')

test('detail pages do not show raw slug chips in the hero area', () => {
  assert.doesNotMatch(detailIndexDetail, /<span>\{item\.slug\}<\/span>/)
  assert.doesNotMatch(searchIndexDetail, /<span>\{item\.slug\}<\/span>/)
})

test('detail pages do not expose legacy XWiki page fields', () => {
  assert.doesNotMatch(detailIndexDetail, /旧 XWiki 页面/)
  assert.doesNotMatch(searchIndexDetail, /旧 XWiki 页面/)
})

test('search results do not expose internal score values', () => {
  assert.doesNotMatch(searchClient, /score \{item\.score\}/)
  assert.doesNotMatch(searchClient, /<span>score/)
})

test('collection index controls use user-facing Chinese labels', () => {
  assert.match(collectionIndexPage, />\s*搜索\s*</)
  assert.match(collectionIndexPage, />\s*浏览全部\s*</)
  assert.match(collectionIndexPage, /\{items\.length\} 条/)
  assert.doesNotMatch(collectionIndexPage, />\s*Search\s*</)
  assert.doesNotMatch(collectionIndexPage, />\s*Browse all\s*</)
  assert.doesNotMatch(collectionIndexPage, /\{items\.length\} entries/)
})
