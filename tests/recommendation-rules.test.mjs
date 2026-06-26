import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const rules = fs.readFileSync(new URL('../src/app/(frontend)/_lib/recommendations.ts', import.meta.url), 'utf8')
const page = fs.readFileSync(new URL('../src/app/(frontend)/recommendations/page.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/recommendations.css', import.meta.url), 'utf8')
const docs = fs.readFileSync(new URL('../docs/recommendation-rules.md', import.meta.url), 'utf8')

test('recommendation scoring uses stable content signals', () => {
  assert.ok(rules.includes('rankScore'))
  assert.ok(rules.includes('reviewScore'))
  assert.ok(rules.includes('evidenceScore'))
  assert.ok(rules.includes('matrixScore'))
  assert.ok(rules.includes('hasEvidence'))
})

test('recommendations are grouped into buckets', () => {
  assert.ok(rules.includes("'priority'"))
  assert.ok(rules.includes("'cautious'"))
  assert.ok(rules.includes("'not-recommended'"))
  assert.ok(rules.includes('recommendationsByBucket'))
})

test('recommendations page reads detail index and shows groups', () => {
  assert.ok(page.includes('readDetailIndex'))
  assert.ok(page.includes('recommendationsByBucket'))
  assert.ok(page.includes('<h1>推荐</h1>'))
  assert.ok(!page.includes('<h1>简易推荐</h1>'))
  assert.ok(page.includes('优先推荐'))
  assert.ok(page.includes('谨慎尝试'))
  assert.ok(page.includes('暂不推荐'))
})

test('recommendations nav and styles are wired', () => {
  assert.ok(layout.includes("href: '/recommendations'"))
  assert.ok(layout.includes("import './recommendations.css'"))
  assert.ok(css.includes('.recommendations-page'))
  assert.ok(css.includes('.recommendation-card'))
})

test('recommendation docs describe limits', () => {
  assert.ok(docs.includes('public/detail-index.json'))
  assert.ok(docs.includes('personal work lists'))
  assert.ok(docs.includes('custom weights'))
})
