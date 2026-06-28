import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectionsForEntitySeed,
  entityLookupPlan,
} from '../scripts/import/direct-seed-entities.mjs'

test('entity importer accepts creator and organization collections', () => {
  const seed = { creators: [{}], organizations: [{}] }
  assert.deepEqual(collectionsForEntitySeed(seed), ['creators', 'organizations'])
  assert.deepEqual(collectionsForEntitySeed(seed, 'organizations'), ['organizations'])
})

test('entity importer rejects unsupported collections', () => {
  assert.throws(() => collectionsForEntitySeed({ works: [] }, 'works'), /Unsupported entity collection/u)
  assert.throws(() => collectionsForEntitySeed({ creators: [] }, 'organizations'), /Missing or invalid array/u)
})

test('entity importer lookup plan prefers siteId then slug', () => {
  assert.deepEqual(entityLookupPlan({ siteId: 'creator-a', slug: 'creator-a-slug' }), [
    { type: 'siteId', field: 'siteId', value: 'creator-a' },
    { type: 'slug', field: 'slug', value: 'creator-a-slug' },
  ])
})
