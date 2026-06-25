import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const organizations = read('src/collections/Organizations.ts')
const payloadConfig = read('payload.config.ts')

test('organizations collection defines the base content model', () => {
  assert.ok(organizations.includes("slug: 'organizations'"))
  assert.ok(organizations.includes("singular: '机构'"))
  assert.ok(organizations.includes("plural: '机构'"))
  assert.ok(organizations.includes("useAsTitle: 'name'"))

  const fields = [
    'name',
    'slug',
    'type',
    'aliases',
    'notes',
    'sourceLinks',
    'searchText',
    'isLiteVisible',
    'isFullVisible',
    'legacyXWikiPage',
    'status',
  ]

  for (const field of fields) {
    assert.ok(organizations.includes(`name: '${field}'`), `missing field ${field}`)
  }
})

test('organizations support expected organization types', () => {
  const types = [
    'publisher',
    'production_company',
    'animation_studio',
    'game_company',
    'distributor',
    'circle',
    'brand',
    'platform',
    'committee',
    'other',
  ]

  for (const type of types) {
    assert.ok(organizations.includes(`value: '${type}'`), `missing organization type ${type}`)
  }
})

test('organizations searchText remains a non-indexed long text field', () => {
  const searchTextPosition = organizations.indexOf("name: 'searchText'")
  assert.notEqual(searchTextPosition, -1)

  const block = organizations.slice(searchTextPosition, searchTextPosition + 500)

  assert.ok(block.includes("type: 'textarea'"))
  assert.equal(block.includes('index: true'), false)
})

test('organizations collection is registered in payload config', () => {
  assert.ok(payloadConfig.includes("import { Organizations } from './src/collections/Organizations'"))
  assert.ok(payloadConfig.includes('Collections') === false)
  assert.ok(payloadConfig.includes('Organizations'))
  assert.ok(payloadConfig.includes('collections: [Users, Media, Works, Creators, Organizations, Terms, Warnings, Tags, Rules]'))
})
