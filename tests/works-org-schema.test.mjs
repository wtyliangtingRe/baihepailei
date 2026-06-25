import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const works = fs.readFileSync(new URL('../src/collections/Works.ts', import.meta.url), 'utf8')

test('works has related organization field', () => {
  assert.ok(works.includes("name: 'organizations'"))
  assert.ok(works.includes("label: '相关机构'"))
  assert.ok(works.includes("name: 'organization'"))
  assert.ok(works.includes("relationTo: 'organizations'"))
  assert.ok(works.includes("name: 'role'"))
  assert.ok(works.includes("name: 'note'"))
})

test('works organization role has common values', () => {
  assert.ok(works.includes("value: 'publisher'"))
  assert.ok(works.includes("value: 'production_company'"))
  assert.ok(works.includes("value: 'animation_studio'"))
  assert.ok(works.includes("value: 'distributor'"))
  assert.ok(works.includes("value: 'platform'"))
  assert.ok(works.includes("value: 'committee'"))
  assert.ok(works.includes("value: 'other'"))
})
