import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const works = fs.readFileSync(new URL('../src/collections/Works.ts', import.meta.url), 'utf8')
const evidence = fs.readFileSync(new URL('../src/collections/Evidence.ts', import.meta.url), 'utf8')
const searchWrapper = fs.readFileSync(new URL('../scripts/export/build-and-enrich-lite-search-index.mjs', import.meta.url), 'utf8')
const detailWrapper = fs.readFileSync(new URL('../scripts/export/build-and-enrich-lite-detail-index.mjs', import.meta.url), 'utf8')
const reviewEnricher = fs.readFileSync(new URL('../scripts/export/enrich-lite-review-fields.mjs', import.meta.url), 'utf8')
const detailIndex = fs.readFileSync(new URL('../src/app/(frontend)/_lib/detail-index.ts', import.meta.url), 'utf8')
const searchIndex = fs.readFileSync(new URL('../src/app/(frontend)/_lib/search-index.ts', import.meta.url), 'utf8')
const detailComponent = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const searchDetail = fs.readFileSync(new URL('../src/app/(frontend)/_components/SearchIndexDetail.tsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('works and evidence include review fields', () => {
  for (const source of [works, evidence]) {
    assert.ok(source.includes("name: 'reviewStatus'"))
    assert.ok(source.includes("name: 'evidenceStrength'"))
    assert.ok(source.includes("value: 'pending'"))
    assert.ok(source.includes("value: 'reviewed'"))
    assert.ok(source.includes("value: 'disputed'"))
    assert.ok(source.includes("value: 'deprecated'"))
    assert.ok(source.includes("value: 'unassessed'"))
    assert.ok(source.includes("value: 'weak'"))
    assert.ok(source.includes("value: 'medium'"))
    assert.ok(source.includes("value: 'strong'"))
  }
})

test('lite export enriches review fields', () => {
  assert.equal(packageJson.scripts['export:lite-search'], 'node scripts/export/build-and-enrich-lite-search-index.mjs')
  assert.equal(packageJson.scripts['export:lite-review-fields'], 'node scripts/export/enrich-lite-review-fields.mjs')
  assert.ok(searchWrapper.includes('enrich-lite-review-fields.mjs'))
  assert.ok(detailWrapper.includes('enrich-lite-review-fields.mjs'))
  assert.ok(reviewEnricher.includes('reviewStatus'))
  assert.ok(reviewEnricher.includes('evidenceStrength'))
  assert.ok(reviewEnricher.includes("fetchCollection(baseUrl, token, 'works'"))
  assert.ok(reviewEnricher.includes("fetchCollection(baseUrl, token, 'evidence'"))
})

test('frontend index types include review fields', () => {
  assert.ok(detailIndex.includes('reviewStatus?: string'))
  assert.ok(detailIndex.includes('evidenceStrength?: string'))
  assert.ok(searchIndex.includes('reviewStatus?: string'))
  assert.ok(searchIndex.includes('evidenceStrength?: string'))
})

test('detail pages display review fields', () => {
  assert.ok(detailComponent.includes('reviewStatusLabels'))
  assert.ok(detailComponent.includes('evidenceStrengthLabels'))
  assert.ok(detailComponent.includes('复核状态'))
  assert.ok(detailComponent.includes('证据强度'))
  assert.ok(detailComponent.includes('待复核'))
  assert.ok(detailComponent.includes('证据强'))
  assert.ok(searchDetail.includes('reviewStatusLabels'))
  assert.ok(searchDetail.includes('evidenceStrengthLabels'))
})
