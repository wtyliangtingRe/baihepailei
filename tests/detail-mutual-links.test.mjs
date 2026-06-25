import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const detail = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/covers.css', import.meta.url), 'utf8')

test('detail component resolves mutual relation links', () => {
  assert.ok(detail.includes('readDetailIndex'))
  assert.ok(detail.includes('function detailTarget'))
  assert.ok(detail.includes('function RelationChip'))
  assert.ok(detail.includes('function DetailRelations'))
  assert.ok(detail.includes('<DetailRelations item={item} />'))
})

test('detail relations cover key collections', () => {
  assert.ok(detail.includes("collection: 'creators'"))
  assert.ok(detail.includes("collection: 'organizations'"))
  assert.ok(detail.includes("collection: 'works'"))
  assert.ok(detail.includes("collection: 'terms'"))
})

test('detail mutual relation links have styles', () => {
  assert.ok(css.includes('.relation-links-card'))
  assert.ok(css.includes('.detail-relation-group'))
  assert.ok(css.includes('.detail-relation-chips'))
  assert.ok(css.includes('.detail-relation-chip'))
})
