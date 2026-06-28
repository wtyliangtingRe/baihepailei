import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBangumiPayloadEntitySeed } from '../tools/source_import/scripts/build-bangumi-payload-entity-seed.mjs'

test('entity seed package preview builds hidden draft collections', () => {
  const seed = buildBangumiPayloadEntitySeed({
    meta: { creatorsTotal: 1, organizationsTotal: 1 },
    creators: [{ name: 'Creator A', slug: 'creator-a', sourceKey: 'creator-a', worksCount: 2, hintCount: 3, roles: [] }],
    organizations: [{ name: 'Org A', slug: 'org-a', sourceKey: 'org-a', worksCount: 3, hintCount: 4, roles: [{ role: 'broadcaster', count: 4 }] }],
  })

  assert.equal(seed.meta.mode, 'payload-seed-preview-only')
  assert.equal(seed.creators.length, 1)
  assert.equal(seed.organizations.length, 1)
  assert.equal(seed.creators[0].status, 'draft')
  assert.equal(seed.creators[0].isLiteVisible, false)
  assert.equal(seed.creators[0].isFullVisible, false)
  assert.equal(seed.organizations[0].type, 'broadcaster')
})
