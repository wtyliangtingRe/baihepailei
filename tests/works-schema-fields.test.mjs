import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('works schema contains review-only work group metadata fields', () => {
  const source = readFileSync('src/collections/Works.ts', 'utf8')

  assert.match(source, /name: 'workGroup'/u)
  assert.match(source, /label: '候选系列分组'/u)
  assert.match(source, /name: 'key'/u)
  assert.match(source, /name: 'title'/u)
  assert.match(source, /name: 'relation'/u)
  assert.match(source, /name: 'confidence'/u)
})
