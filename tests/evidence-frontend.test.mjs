import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const workDetail = fs.readFileSync(new URL('../src/app/(frontend)/works/[slug]/page.tsx', import.meta.url), 'utf8')
const evidenceIndex = fs.readFileSync(new URL('../src/app/(frontend)/evidence/page.tsx', import.meta.url), 'utf8')
const evidenceDetail = fs.readFileSync(new URL('../src/app/(frontend)/evidence/[slug]/page.tsx', import.meta.url), 'utf8')
const detailComponent = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const collectionPage = fs.readFileSync(new URL('../src/app/(frontend)/_components/CollectionIndexPage.tsx', import.meta.url), 'utf8')
const searchIndex = fs.readFileSync(new URL('../src/app/(frontend)/_lib/search-index.ts', import.meta.url), 'utf8')
const searchClient = fs.readFileSync(new URL('../src/app/(frontend)/search/search-client.tsx', import.meta.url), 'utf8')
const searchUtils = fs.readFileSync(new URL('../src/app/(frontend)/search/search-utils.mjs', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../src/app/(frontend)/page.tsx', import.meta.url), 'utf8')
const browse = fs.readFileSync(new URL('../src/app/(frontend)/browse/page.tsx', import.meta.url), 'utf8')
const coverCss = fs.readFileSync(new URL('../src/app/(frontend)/covers.css', import.meta.url), 'utf8')

test('work detail page passes related evidence', () => {
  assert.ok(workDetail.includes('evidenceByWorkTitle'))
  assert.ok(workDetail.includes("item.collection === 'evidence'"))
  assert.ok(workDetail.includes('relatedEvidence={evidenceByWorkTitle(detailItem.title)}'))
})

test('evidence pages are wired', () => {
  assert.ok(evidenceIndex.includes('EvidenceIndexPage'))
  assert.ok(evidenceIndex.includes('collection="evidence"'))
  assert.ok(evidenceDetail.includes('EvidenceDetailPage'))
  assert.ok(evidenceDetail.includes("findDetailItem('evidence' as never"))
  assert.ok(evidenceDetail.includes("findSearchItem('evidence'"))
})

test('detail component renders evidence screenshots', () => {
  assert.ok(detailComponent.includes('function EvidenceImage'))
  assert.ok(detailComponent.includes('function RelatedEvidence'))
  assert.ok(detailComponent.includes('证据材料'))
  assert.ok(detailComponent.includes('暂无截图'))
  assert.ok(detailComponent.includes('relatedEvidence = []'))
})

test('collection, search, home and browse support evidence', () => {
  assert.ok(collectionPage.includes("item.collection === 'evidence'"))
  assert.ok(searchIndex.includes("'evidence'"))
  assert.ok(searchClient.includes("'evidence'"))
  assert.ok(searchUtils.includes("evidence: '证据材料'"))
  assert.ok(home.includes("kind: 'evidence'"))
  assert.ok(browse.includes("kind: 'evidence'"))
})

test('evidence screenshots have dedicated styles', () => {
  assert.ok(coverCss.includes('.evidence-image'))
  assert.ok(coverCss.includes('.evidence-card-list'))
  assert.ok(coverCss.includes('.evidence-item'))
})
