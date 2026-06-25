import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const styles = read('src/app/(frontend)/styles.css')
const homePage = read('src/app/(frontend)/page.tsx')
const worksPage = read('src/app/(frontend)/works/page.tsx')
const collectionIndexPage = read('src/app/(frontend)/_components/CollectionIndexPage.tsx')
const detailIndexDetail = read('src/app/(frontend)/_components/DetailIndexDetail.tsx')
const searchIndexDetail = read('src/app/(frontend)/_components/SearchIndexDetail.tsx')
const searchClient = read('src/app/(frontend)/search/search-client.tsx')

test('homepage shows search index counts when available', () => {
  assert.match(homePage, /import \{ readSearchIndex \} from '\.\/_lib\/search-index'/)
  assert.match(homePage, /const index = readSearchIndex\(\)/)
  assert.match(homePage, /当前收录 \$\{index\.total\} 条/)
  assert.match(homePage, /生成索引后显示条目数/)
  assert.match(homePage, /countLabel\(index\?\.counts\?\.\[section\.kind\]\)/)
  assert.match(styles, /\.home-stats\s*\{/)
  assert.match(styles, /\.home-section-card-header\s*\{/)
})

test('homepage quick search submits to the search page', () => {
  assert.match(homePage, /<form action="\/search" className="search-box" role="search">/)
  assert.match(homePage, /<span>快速搜索<\/span>/)
  assert.match(homePage, /name="q"/)
  assert.match(homePage, /type="search"/)
  assert.match(homePage, />搜索资料<\/button>/)
})

test('search page initializes from URL query parameters', () => {
  assert.match(searchClient, /new URLSearchParams\(window\.location\.search\)/)
  assert.match(searchClient, /params\.get\('q'\)/)
  assert.match(searchClient, /params\.get\('collection'\)/)
  assert.match(searchClient, /if \(initialQuery\) setQuery\(initialQuery\)/)
  assert.match(searchClient, /validCollections\.has\(initialCollection\)/)
})

test('collection search links preserve collection scope', () => {
  assert.match(collectionIndexPage, /href=\{`\/search\?collection=\$\{collection\}`\}/)
  assert.match(collectionIndexPage, />\s*搜索\{title\}\s*</)
  assert.match(worksPage, /href="\/search\?collection=works"/)
  assert.match(worksPage, />搜索作品<\/Link>/)
})

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
