import test from 'node:test'
import assert from 'node:assert/strict'

import {
  auditBangumiSelectedEntitySeed,
  createBangumiSelectedEntitySeedAuditReport,
} from '../tools/source_import/scripts/audit-bangumi-selected-entity-seed.mjs'

const validSeed = {
  meta: {
    sourceWorksTotal: 10,
    sourceSelectedCreators: 2,
    sourceSelectedOrganizations: 1,
    creatorsTotal: 2,
    organizationsTotal: 1,
    mode: 'preview-only',
  },
  creators: [
    {
      name: '吉田玲子',
      slug: 'creator-a',
      source: 'bangumi-selected-preview',
      sourceKey: 'creator:a',
      status: 'draft',
      reviewStatus: 'pending',
      worksCount: 3,
      hintCount: 5,
    },
    {
      name: '新房昭之',
      slug: 'creator-b',
      source: 'bangumi-selected-preview',
      sourceKey: 'creator:b',
      status: 'draft',
      reviewStatus: 'pending',
      worksCount: 2,
      hintCount: 2,
    },
  ],
  organizations: [
    {
      name: 'TOKYO MX',
      slug: 'organization-a',
      source: 'bangumi-selected-preview',
      sourceKey: 'organization:a',
      status: 'draft',
      reviewStatus: 'pending',
      worksCount: 7,
      hintCount: 10,
    },
  ],
}

test('selected Bangumi entity seed audit passes a clean preview seed', () => {
  const audit = auditBangumiSelectedEntitySeed(validSeed)

  assert.equal(audit.ok, true)
  assert.equal(audit.meta.creatorsTotal, 2)
  assert.equal(audit.meta.organizationsTotal, 1)
  assert.equal(audit.meta.failedChecks, 0)
  assert.equal(audit.checks.every((check) => check.pass), true)
})

test('selected Bangumi entity seed audit catches unsafe or inconsistent rows', () => {
  const invalidSeed = structuredClone(validSeed)
  invalidSeed.meta.mode = 'import'
  invalidSeed.meta.creatorsTotal = 3
  invalidSeed.creators[1].slug = 'creator-a'
  invalidSeed.creators[1].sourceKey = 'creator:a'
  invalidSeed.creators[1].status = 'published'
  invalidSeed.creators[1].reviewStatus = 'approved'
  invalidSeed.creators[1].source = 'manual'
  invalidSeed.creators[1].reviewFlags = ['appears_in_both_lists']
  invalidSeed.creators[1].works = [{ slug: 'bangumi-1' }]

  const audit = auditBangumiSelectedEntitySeed(invalidSeed)
  const failedNames = audit.checks.filter((check) => !check.pass).map((check) => check.name)

  assert.equal(audit.ok, false)
  assert.ok(failedNames.includes('preview mode'))
  assert.ok(failedNames.includes('creator count matches meta'))
  assert.ok(failedNames.includes('slugs are unique across seed rows'))
  assert.ok(failedNames.includes('source keys are unique across seed rows'))
  assert.ok(failedNames.includes('all rows are draft'))
  assert.ok(failedNames.includes('all rows are pending review'))
  assert.ok(failedNames.includes('all rows keep selected preview source'))
  assert.ok(failedNames.includes('no review flags are carried into seed preview'))
  assert.ok(failedNames.includes('no work relationship fields are present'))
})

test('selected Bangumi entity seed audit report renders check table', () => {
  const audit = auditBangumiSelectedEntitySeed(validSeed)
  const report = createBangumiSelectedEntitySeedAuditReport(audit, { inputPath: 'seed.json' })

  assert.match(report, /Bangumi selected 实体 seed 审计报告/u)
  assert.match(report, /结果：PASS/u)
  assert.match(report, /creator rows：2/u)
  assert.match(report, /organization rows：1/u)
  assert.match(report, /preview mode/u)
  assert.match(report, /no work relationship fields are present/u)
})
