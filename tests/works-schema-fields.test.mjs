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

test('works schema can store key creator credits with source role labels', () => {
  const source = readFileSync('src/collections/Works.ts', 'utf8')

  assert.match(source, /name: 'creatorCredits'/u)
  assert.match(source, /label: '关键创作者职位'/u)
  assert.match(source, /relationTo: 'creators'/u)
  assert.match(source, /value: 'director'/u)
  assert.match(source, /value: 'chief_director'/u)
  assert.match(source, /value: 'series_composition'/u)
  assert.match(source, /value: 'script'/u)
  assert.match(source, /name: 'originalRole'/u)
})

test('works schema supports production committee and broadcaster organization roles', () => {
  const source = readFileSync('src/collections/Works.ts', 'utf8')

  assert.match(source, /name: 'organizations'/u)
  assert.match(source, /value: 'committee'/u)
  assert.match(source, /value: 'committee_member'/u)
  assert.match(source, /value: 'broadcaster'/u)
  assert.match(source, /value: 'streaming_platform'/u)
  assert.match(source, /value: 'music_label'/u)
  assert.match(source, /value: 'investor'/u)
})

test('works schema separates Payload publication status from catalog lifecycle', () => {
  const source = readFileSync('src/collections/Works.ts', 'utf8')

  assert.match(source, /name: 'catalogStatus'/u)
  assert.match(source, /value: 'active'/u)
  assert.match(source, /value: 'archived'/u)
  assert.doesNotMatch(source, /name: 'status'[\s\S]{0,240}label: '状态'/u)
})
