import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiWorkEntityLinkImportDryRun,
  createBangumiWorkEntityLinkImportDryRunReport,
} from '../tools/source_import/scripts/import-bangumi-work-entity-links.mjs'

function relation(collection, name, role = 'writer') {
  return {
    collection,
    siteId: `${collection}:${name}`,
    slug: name.toLowerCase().replace(/\s+/gu, '-'),
    name,
    role,
    originalRole: role,
    matchedBy: 'name',
    source: {
      type: 'bangumi-credit-hint',
      role,
      originalRole: role,
      source: 'bangumi',
      rawLine: `- ${name} | role=${role} | source=bangumi`,
    },
  }
}

function plan(overrides = {}) {
  return {
    meta: {
      mode: 'plan-only-no-payload-write',
      auditCheck: 'audit-pass',
    },
    works: [
      {
        work: { siteId: 'bangumi:1', slug: 'work-a', title: 'Work A' },
        operation: 'patch-work-relationships',
        mode: 'plan-only-no-payload-write',
        relationships: {
          creators: [relation('creators', 'Creator A')],
          organizations: [relation('organizations', 'Studio A', 'animation_studio')],
        },
        skippedHints: {
          unmatchedCreatorHints: 1,
          unmatchedOrganizationHints: 0,
          ambiguousCreatorHints: 0,
          ambiguousOrganizationHints: 0,
        },
      },
    ],
    skippedWorks: [
      {
        work: { siteId: 'bangumi:2', slug: 'work-b', title: 'Work B' },
        reasons: ['no-matched-links'],
        matchedCreatorLinks: 0,
        matchedOrganizationLinks: 0,
      },
    ],
    ...overrides,
  }
}

test('dry-run importer creates simulated patch actions from a valid plan', () => {
  const result = buildBangumiWorkEntityLinkImportDryRun(plan())

  assert.equal(result.meta.mode, 'dry-run-only-no-payload-write')
  assert.equal(result.meta.status, 'pass')
  assert.equal(result.meta.dryRun, true)
  assert.equal(result.meta.worksTotal, 1)
  assert.equal(result.meta.wouldPatchWorksTotal, 1)
  assert.equal(result.meta.creatorLinksTotal, 1)
  assert.equal(result.meta.organizationLinksTotal, 1)
  assert.equal(result.actions[0].action, 'dry-run-patch-work-relationships')
  assert.equal(result.actions[0].dryRun, true)
  assert.equal(result.actions[0].wouldPatch, true)
  assert.equal(result.actions[0].patchPreview.creators[0].name, 'Creator A')
  assert.ok(result.issues.some((issue) => issue.code === 'plan-skipped-works-present'))
})

test('dry-run importer fails when write mode is requested', () => {
  const result = buildBangumiWorkEntityLinkImportDryRun(plan(), { dryRun: false })

  assert.equal(result.meta.status, 'fail')
  assert.ok(result.issues.some((issue) => issue.code === 'write-mode-disabled'))
})

test('dry-run importer fails invalid plan mode or failed audit marker', () => {
  const result = buildBangumiWorkEntityLinkImportDryRun(plan({
    meta: {
      mode: 'write-plan',
      auditCheck: 'audit-not-pass',
    },
  }))

  assert.equal(result.meta.status, 'fail')
  assert.ok(result.issues.some((issue) => issue.code === 'invalid-plan-mode'))
  assert.ok(result.issues.some((issue) => issue.code === 'audit-not-pass'))
})

test('dry-run importer validates relation shape', () => {
  const input = plan()
  input.works[0].relationships.creators[0].source = {}

  const result = buildBangumiWorkEntityLinkImportDryRun(input)

  assert.equal(result.meta.status, 'fail')
  assert.ok(result.issues.some((issue) => issue.code === 'invalid-relation-shape'))
  assert.equal(result.actions[0].wouldPatch, false)
})

test('dry-run report includes safety summary', () => {
  const result = buildBangumiWorkEntityLinkImportDryRun(plan())
  const report = createBangumiWorkEntityLinkImportDryRunReport(result, { planInputPath: 'plan.json' })

  assert.match(report, /Bangumi work\/entity link import dry-run/u)
  assert.match(report, /dry-run importer skeleton/u)
  assert.match(report, /不调用 Payload API/u)
  assert.match(report, /不写入 relationships/u)
})
