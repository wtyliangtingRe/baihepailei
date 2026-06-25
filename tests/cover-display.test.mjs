import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const worksPage = fs.readFileSync(new URL('../src/app/(frontend)/works/page.tsx', import.meta.url), 'utf8')
const detailPage = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const searchIndex = fs.readFileSync(new URL('../src/app/(frontend)/_lib/search-index.ts', import.meta.url), 'utf8')
const detailIndex = fs.readFileSync(new URL('../src/app/(frontend)/_lib/detail-index.ts', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const coverCss = fs.readFileSync(new URL('../src/app/(frontend)/covers.css', import.meta.url), 'utf8')

test('works page renders cover thumbnails with placeholder fallback', () => {
  assert.ok(worksPage.includes('function CoverThumb'))
  assert.ok(worksPage.includes('item.cover'))
  assert.ok(worksPage.includes('work-cover-thumb'))
  assert.ok(worksPage.includes('work-cover-placeholder'))
  assert.ok(worksPage.includes('暂无封面'))
})

test('detail page renders work cover with placeholder fallback', () => {
  assert.ok(detailPage.includes('function WorkCover'))
  assert.ok(detailPage.includes('item.collection === \'works\''))
  assert.ok(detailPage.includes('detail-cover'))
  assert.ok(detailPage.includes('detail-cover-placeholder'))
})

test('cover metadata types are available in indexes', () => {
  assert.ok(searchIndex.includes('SearchCoverImage'))
  assert.ok(searchIndex.includes('cover?: SearchCoverImage'))
  assert.ok(detailIndex.includes('DetailCoverImage'))
  assert.ok(detailIndex.includes('cover?: DetailCoverImage'))
})

test('cover styles are loaded by the frontend layout', () => {
  assert.ok(layout.includes("import './covers.css'"))
  assert.ok(coverCss.includes('.work-cover-thumb'))
  assert.ok(coverCss.includes('.detail-cover'))
})
