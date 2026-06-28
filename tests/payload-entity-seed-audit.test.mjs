import test from 'node:test'
import assert from 'node:assert/strict'

import { auditBangumiPayloadEntitySeed } from '../tools/source_import/scripts/audit-bangumi-payload-entity-seed.mjs'

function notes() {
  return { root: { children: [{ children: [{ text: 'Bangumi selected entity preview' }] }] } }
}

const validSeed = {
  meta: {
    mode: 'payload-seed-preview-only',
    sourceCreatorsTotal: 1,
    sourceOrganizationsTotal: 1,
    creatorsTotal: 1,
    organizationsTotal: 1,
  },
  creators: [{ name: 'Creator A', slug: 'creator-a', siteId: 'creator-a', notes: notes(), searchText: 'Creator A', isLiteVisible: false, isFullVisible: false, status: 'draft' }],
  organizations: [{ name: 'Org A', slug: 'org-a', siteId: 'org-a', type: 'other', notes: notes(), sourceLinks: [{ label: 'source', url: '' }], searchText: 'Org A', isLiteVisible: false, isFullVisible: false, status: 'draft' }],
}

test('Payload entity seed audit passes valid seed', () => {
  const audit = auditBangumiPayloadEntitySeed(validSeed)
  assert.equal(audit.ok, true)
  assert.equal(audit.meta.failedChecks, 0)
})

test('Payload entity seed audit catches unsafe seed rows', () => {
  const invalid = structuredClone(validSeed)
  invalid.meta.mode = 'import'
  invalid.organizations[0].type = 'broadcaster'
  invalid.organizations[0].sourceLinks[0].note = 'not in schema'
  invalid.creators[0].isLiteVisible = true
  invalid.creators[0].works = []

  const audit = auditBangumiPayloadEntitySeed(invalid)
  const failed = audit.checks.filter((check) => !check.pass).map((check) => check.name)

  assert.equal(audit.ok, false)
  assert.ok(failed.includes('preview mode'))
  assert.ok(failed.includes('organization types are valid'))
  assert.ok(failed.includes('source links match schema fields'))
  assert.ok(failed.includes('all rows are hidden'))
  assert.ok(failed.includes('no relationship fields are present'))
})
