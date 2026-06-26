import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const detail = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const conclusion = fs.readFileSync(new URL('../src/app/(frontend)/_components/WorkConclusionCard.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/work-conclusion.css', import.meta.url), 'utf8')

test('work conclusion card exists and is work-only', () => {
  assert.ok(conclusion.includes('WorkConclusionCard'))
  assert.ok(conclusion.includes("item.collection !== 'works'"))
  assert.ok(conclusion.includes('先看结论'))
  assert.ok(conclusion.includes('当前结论：'))
})

test('work conclusion card summarizes important fields', () => {
  assert.ok(conclusion.includes('等级'))
  assert.ok(conclusion.includes('复核状态'))
  assert.ok(conclusion.includes('证据强度'))
  assert.ok(conclusion.includes('材料留存'))
  assert.ok(conclusion.includes('创作者'))
  assert.ok(conclusion.includes('相关机构'))
})

test('work conclusion card links creators and organizations', () => {
  assert.ok(conclusion.includes('LinkedNames'))
  assert.ok(conclusion.includes("collection: 'creators' | 'organizations'"))
  assert.ok(conclusion.includes('detailTarget(collection, name)'))
})

test('detail page renders conclusion before basic info', () => {
  assert.ok(detail.includes("import WorkConclusionCard from './WorkConclusionCard'"))
  assert.ok(detail.indexOf('<WorkConclusionCard item={item} relatedEvidence={relatedEvidence} />') < detail.indexOf('<BasicInfo item={item} />'))
})

test('work conclusion styles are loaded', () => {
  assert.ok(layout.includes("import './work-conclusion.css'"))
  assert.ok(css.includes('.work-conclusion-card'))
  assert.ok(css.includes('.work-conclusion-grid'))
  assert.ok(css.includes('.work-conclusion-meta'))
  assert.ok(css.includes("[data-theme='light'] .work-conclusion-card"))
})
