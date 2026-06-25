import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const styles = read('src/app/(frontend)/styles.css')
const worksPage = read('src/app/(frontend)/works/page.tsx')
const detailIndexDetail = read('src/app/(frontend)/_components/DetailIndexDetail.tsx')
const searchIndexDetail = read('src/app/(frontend)/_components/SearchIndexDetail.tsx')
const searchClient = read('src/app/(frontend)/search/search-client.tsx')

test('works page includes a rank explanation section', () => {
  assert.match(worksPage, /aria-label="排雷分级说明"/)
  assert.match(worksPage, />\s*如何理解这些分级？\s*</)
  assert.match(worksPage, /rankDescriptions/)
  assert.match(styles, /\.rank-explainer\s*\{/)
  assert.match(styles, /\.rank-explainer-card\s*\{/)
})

test('search empty state includes suggestion chips', () => {
  assert.match(searchClient, /const searchSuggestions = \[/)
  assert.match(searchClient, /className="search-suggestions"/)
  assert.match(styles, /\.search-suggestions\s*\{/)
  assert.match(styles, /\.search-suggestions li\s*\{/)
})

test('detail pages use explicit collection back links', () => {
  assert.match(detailIndexDetail, /function collectionBackLabel\(collection: string\)/)
  assert.match(searchIndexDetail, /function collectionBackLabel\(collection: string\)/)
  assert.match(detailIndexDetail, /返回\$\{collectionLabel\(collection\)\}列表/)
  assert.match(searchIndexDetail, /返回\$\{collectionLabel\(collection\)\}列表/)
  assert.doesNotMatch(detailIndexDetail, />\s*浏览同类\s*</)
})
