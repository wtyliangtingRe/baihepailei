import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const layout = read('src/app/(frontend)/layout.tsx')
const homePage = read('src/app/(frontend)/page.tsx')
const browsePage = read('src/app/(frontend)/browse/page.tsx')
const legacyBrowsePage = read('src/app/(frontend)/browse/[kind]/page.tsx')
const searchPage = read('src/app/(frontend)/search/page.tsx')
const worksPage = read('src/app/(frontend)/works/page.tsx')
const creatorsPage = read('src/app/(frontend)/creators/page.tsx')
const termsPage = read('src/app/(frontend)/terms/page.tsx')
const rulesPage = read('src/app/(frontend)/rules/page.tsx')
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

test('home cards use Chinese section labels', () => {
  for (const label of ['作品', '创作者', '名词解释', '排雷规则']) {
    assert.match(homePage, new RegExp(`eyebrow: '${label}'`))
  }

  assert.match(homePage, /aria-label="轻量资料分类"/)
  assert.match(homePage, />\s*浏览资料库\s*</)
  assert.doesNotMatch(homePage, /eyebrow: 'Works'/)
  assert.doesNotMatch(homePage, /eyebrow: 'Creators'/)
  assert.doesNotMatch(homePage, /eyebrow: 'Terms'/)
  assert.doesNotMatch(homePage, /eyebrow: 'Rules'/)
  assert.doesNotMatch(homePage, /aria-label="Lite archive sections"/)
})

test('frontend pages use Chinese wording for lightweight mode instead of raw Lite labels', () => {
  assert.match(homePage, /百合排雷 · 轻量版/)
  assert.match(homePage, /浏览轻量索引里的作品条目/)
  assert.match(browsePage, /当前轻量索引共收录/)
  assert.match(worksPage, /浏览轻量搜索索引中的作品条目/)
  assert.match(searchIndexDetail, />\s*搜索文本预览\s*</)

  assert.doesNotMatch(homePage, /Baihepailei Lite/)
  assert.doesNotMatch(homePage, /Lite 索引/)
  assert.doesNotMatch(browsePage, /Lite 索引/)
  assert.doesNotMatch(worksPage, /Lite 搜索索引/)
  assert.doesNotMatch(searchIndexDetail, /Lite 搜索文本预览/)
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

test('legacy browse collection routes redirect to canonical short routes', () => {
  assert.match(legacyBrowsePage, /import \{ notFound, redirect \} from 'next\/navigation'/)
  assert.match(legacyBrowsePage, /works: '\/works'/)
  assert.match(legacyBrowsePage, /creators: '\/creators'/)
  assert.match(legacyBrowsePage, /terms: '\/terms'/)
  assert.match(legacyBrowsePage, /rules: '\/rules'/)
  assert.match(legacyBrowsePage, /redirect\(path\)/)

  assert.doesNotMatch(legacyBrowsePage, />\s*Search\s*</)
  assert.doesNotMatch(legacyBrowsePage, />\s*Works\s*</)
  assert.doesNotMatch(legacyBrowsePage, /entries/)
  assert.doesNotMatch(legacyBrowsePage, />\s*\{item\.url\}\s*</)
})

test('collection page eyebrows use Chinese labels', () => {
  assert.match(worksPage, />\s*作品\s*</)
  assert.match(creatorsPage, /eyebrow="创作者"/)
  assert.match(termsPage, /eyebrow="名词解释"/)
  assert.match(rulesPage, /eyebrow="排雷规则"/)

  assert.doesNotMatch(worksPage, />\s*works\s*</)
  assert.doesNotMatch(creatorsPage, /eyebrow="creators"/)
  assert.doesNotMatch(termsPage, /eyebrow="terms"/)
  assert.doesNotMatch(rulesPage, /eyebrow="rules"/)
})

test('search page and result links use user-facing Chinese labels', () => {
  assert.match(searchPage, />\s*搜索\s*</)
  assert.doesNotMatch(searchPage, />\s*Search\s*</)

  assert.match(searchClient, /模式：\{indexModeLabel\(index\.mode\)\}/)
  assert.match(searchClient, /if \(mode === 'include-drafts'\) return '含草稿'/)
  assert.match(searchClient, /if \(mode === 'published'\) return '仅已发布'/)
  assert.match(searchClient, />\s*查看详情\s*</)
  assert.doesNotMatch(searchClient, />\s*\{item\.url\}\s*</)
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
