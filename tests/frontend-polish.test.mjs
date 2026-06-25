import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const layout = read('src/app/(frontend)/layout.tsx')
const browsePage = read('src/app/(frontend)/browse/page.tsx')
const detailIndexDetail = read('src/app/(frontend)/_components/DetailIndexDetail.tsx')
const searchIndexDetail = read('src/app/(frontend)/_components/SearchIndexDetail.tsx')
const searchClient = read('src/app/(frontend)/search/search-client.tsx')
const collectionIndexPage = read('src/app/(frontend)/_components/CollectionIndexPage.tsx')

test('global navigation uses user-facing Chinese labels', () => {
  for (const label of ['资料库', '作品', '创作者', '名词解释', '规则', '搜索', '后台']) {
    assert.match(layout, new RegExp(`label: '${label}'`))
  }

  assert.match(layout, /aria-label="主导航"/)
  assert.doesNotMatch(layout, /label: 'Browse'/)
  assert.doesNotMatch(layout, /label: 'Works'/)
  assert.doesNotMatch(layout, /label: 'Search'/)
  assert.doesNotMatch(layout, /label: 'Admin'/)
})

test('browse cards use Chinese labels and actions instead of route text', () => {
  for (const label of ['作品', '创作者', '名词解释', '排雷规则']) {
    assert.match(browsePage, new RegExp(`eyebrow: '${label}'`))
  }

  for (const action of ['浏览作品', '浏览创作者', '浏览名词解释', '浏览排雷规则']) {
    assert.match(browsePage, new RegExp(`actionLabel: '${action}'`))
  }

  assert.match(browsePage, />\s*\{section\.actionLabel\}\s*</)
  assert.doesNotMatch(browsePage, /eyebrow: 'Works'/)
  assert.doesNotMatch(browsePage, /eyebrow: 'Creators'/)
  assert.doesNotMatch(browsePage, /eyebrow: 'Terms'/)
  assert.doesNotMatch(browsePage, /eyebrow: 'Rules'/)
  assert.doesNotMatch(browsePage, />\s*\{section\.href\}\s*</)
})

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
