import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const worksPage = fs.readFileSync(new URL('../src/app/(frontend)/works/page.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../src/app/(frontend)/works-filters.css', import.meta.url), 'utf8')

test('works page accepts URL search params for filters', () => {
  assert.ok(worksPage.includes('searchParams'))
  assert.ok(worksPage.includes('parseFilters'))
  assert.ok(worksPage.includes('normalizeRank'))
  assert.ok(worksPage.includes("rank.toUpperCase() === 'S'"))
})

test('works filter form includes core filter controls', () => {
  assert.ok(worksPage.includes('function WorksFilterForm'))
  assert.ok(worksPage.includes('action="/works"'))
  assert.ok(worksPage.includes('name="q"'))
  assert.ok(worksPage.includes('name="rank"'))
  assert.ok(worksPage.includes('name="creator"'))
  assert.ok(worksPage.includes('name="organization"'))
  assert.ok(worksPage.includes('name="evidence"'))
  assert.ok(worksPage.includes('筛选作品'))
  assert.ok(worksPage.includes('清除筛选'))
})

test('works page can filter by creator organization and evidence', () => {
  assert.ok(worksPage.includes('uniqueValues(allItems, \'creators\')'))
  assert.ok(worksPage.includes('uniqueValues(allItems, \'organizations\')'))
  assert.ok(worksPage.includes('filters.creator'))
  assert.ok(worksPage.includes('filters.organization'))
  assert.ok(worksPage.includes("filters.evidence === 'with'"))
  assert.ok(worksPage.includes("filters.evidence === 'without'"))
  assert.ok(worksPage.includes('function hasEvidence'))
})

test('works cards show creator organization and evidence hints', () => {
  assert.ok(worksPage.includes('创作者：'))
  assert.ok(worksPage.includes('机构：'))
  assert.ok(worksPage.includes('有证据材料'))
  assert.ok(worksPage.includes('没有符合条件的作品'))
})

test('works filter styles are loaded', () => {
  assert.ok(layout.includes("import './works-filters.css'"))
  assert.ok(styles.includes('.works-filter-panel'))
  assert.ok(styles.includes('.works-filter-grid'))
  assert.ok(styles.includes('.works-filter-actions'))
  assert.ok(styles.includes('.active-filter-list'))
})
