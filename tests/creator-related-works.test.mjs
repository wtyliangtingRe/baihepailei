import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const detailIndex = fs.readFileSync(new URL('../src/app/(frontend)/_lib/detail-index.ts', import.meta.url), 'utf8')
const creatorPage = fs.readFileSync(new URL('../src/app/(frontend)/creators/[slug]/page.tsx', import.meta.url), 'utf8')
const detailComponent = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const coverCss = fs.readFileSync(new URL('../src/app/(frontend)/covers.css', import.meta.url), 'utf8')

test('detail index can find works by creator name', () => {
  assert.ok(detailIndex.includes('findWorksByCreatorName'))
  assert.ok(detailIndex.includes("item.collection === 'works'"))
  assert.ok(detailIndex.includes('(item.creators || []).includes(creatorName)'))
})

test('creator detail page passes related works to detail component', () => {
  assert.ok(creatorPage.includes('findWorksByCreatorName'))
  assert.ok(creatorPage.includes('relatedWorks={findWorksByCreatorName(detailItem.title)}'))
})

test('detail component renders related works card', () => {
  assert.ok(detailComponent.includes('function RelatedWorks'))
  assert.ok(detailComponent.includes('相关作品'))
  assert.ok(detailComponent.includes('relatedWorks = []'))
  assert.ok(detailComponent.includes('<RelatedWorks works={relatedWorks} />'))
})

test('related works have dedicated styles', () => {
  assert.ok(coverCss.includes('.related-works-card'))
  assert.ok(coverCss.includes('.related-work-list'))
  assert.ok(coverCss.includes('.related-work-item'))
})
