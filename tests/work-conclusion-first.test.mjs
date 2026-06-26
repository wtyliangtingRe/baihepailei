import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const detail = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')

test('detail page no longer renders the conclusion-first card', () => {
  assert.ok(!detail.includes("import WorkConclusionCard from './WorkConclusionCard'"))
  assert.ok(!detail.includes('<WorkConclusionCard'))
})

test('detail page puts basic info before risk matrix and personal list', () => {
  assert.ok(detail.includes("import WorkListControl from './WorkListControl'"))
  assert.ok(detail.indexOf('<BasicInfo item={item} />') < detail.indexOf('<WorkRiskMatrixCard item={item} />'))
  assert.ok(detail.indexOf('<BasicInfo item={item} />') < detail.indexOf('<WorkListControl item={item} />'))
})

test('creator detail rank chip is not shown from generic rank field', () => {
  assert.ok(detail.includes("const rank = item.collection === 'works' ? displayRank(item.rank) : ''"))
})
