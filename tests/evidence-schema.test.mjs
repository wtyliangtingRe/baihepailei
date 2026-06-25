import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const evidence = fs.readFileSync(new URL('../src/collections/Evidence.ts', import.meta.url), 'utf8')
const payloadConfig = fs.readFileSync(new URL('../payload.config.ts', import.meta.url), 'utf8')

test('evidence collection defines the base model', () => {
  assert.ok(evidence.includes("slug: 'evidence'"))
  assert.ok(evidence.includes("singular: '证据材料'"))
  assert.ok(evidence.includes("plural: '证据材料'"))
  assert.ok(evidence.includes("useAsTitle: 'title'"))

  for (const field of [
    'title',
    'slug',
    'evidenceType',
    'relatedWorks',
    'relatedCreators',
    'relatedOrganizations',
    'image',
    'description',
    'sourceLinks',
    'capturedAt',
    'isPublic',
    'searchText',
    'legacyXWikiPage',
    'status',
  ]) {
    assert.ok(evidence.includes(`name: '${field}'`), `missing field ${field}`)
  }
})

test('evidence collection links to existing content models', () => {
  assert.ok(evidence.includes("relationTo: 'works'"))
  assert.ok(evidence.includes("relationTo: 'creators'"))
  assert.ok(evidence.includes("relationTo: 'organizations' as CollectionSlug"))
  assert.ok(evidence.includes("relationTo: 'media'"))
})

test('evidence collection supports expected evidence types', () => {
  for (const type of [
    'work_screenshot',
    'official_page',
    'interview',
    'social_media',
    'legacy_wiki',
    'platform_page',
    'other',
  ]) {
    assert.ok(evidence.includes(`value: '${type}'`), `missing evidence type ${type}`)
  }
})

test('evidence searchText remains a non-indexed long text field', () => {
  const searchTextPosition = evidence.indexOf("name: 'searchText'")
  assert.notEqual(searchTextPosition, -1)

  const block = evidence.slice(searchTextPosition, searchTextPosition + 500)

  assert.ok(block.includes("type: 'textarea'"))
  assert.equal(block.includes('index: true'), false)
})

test('evidence collection is registered in payload config', () => {
  assert.ok(payloadConfig.includes("import { Evidence } from './src/collections/Evidence'"))
  assert.ok(payloadConfig.includes('Evidence'))
})
