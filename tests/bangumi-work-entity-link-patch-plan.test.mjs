import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiWorkEntityLinkPatchPlan,
  createBangumiWorkEntityLinkPatchPlanReport,
} from '../tools/source_import/scripts/build-bangumi-work-entity-link-patch-plan.mjs'

function link(collection, name, role = 'writer') {
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

function preview(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-work-entity-link-preview',
      mode: 'preview-only-no-payload-write',
    },
    works: [
      {
        work: { title: 'Work A', slug: 'work-a', siteId: 'bangumi:1', bangumiSubjectId: '1' },
        creators: [link('creators', 'Creator A', 'writer')],
        organizations: [link('organizations', 'Studio A', 'animation_studio')],
        unmatchedCreatorHints: [{ name: 'Missing Person', role: 'director' }],
        unmatchedOrganizationHints: [],
        ambiguousCreatorHints: [],
        ambiguousOrganizationHints: [],
      },
      {
        work: { title: 'Work B', slug: 'work-b', siteId: 'bangumi:2', bangumiSubjectId: '2' },
        creators: [],
        organizations: [],
        unmatchedCreatorHints: [],
        unmatchedOrganizationHints: [],
        ambiguousCreatorHints: [],
        ambiguousOrganizationHints: [],
      },
    ],
    ...overrides,
  }
}

function audit(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-work-entity-link-audit',
      mode: 'audit-only-no-payload-write',
      status: 'pass',
      errors: 0,
    },
    ...overrides,
  }
}

test('patch plan converts matched links into planned relationship candidates', () => {
  const plan = buildBangumiWorkEntityLinkPatchPlan(preview(), audit(), {
    previewInputPath: 'preview.json',
    auditInputPath: 'audit.json',
  })

  assert.equal(plan.meta.mode, 'plan-only-no-payload-write')
  assert.equal(plan.meta.status, 'ready')
  assert.equal(plan.stats.worksTotal, 2)
  assert.equal(plan.stats.worksPlanned, 1)
  assert.equal(plan.stats.worksSkipped, 1)
  assert.equal(plan.stats.creatorRelationsTotal, 1)
  assert.equal(plan.stats.organizationRelationsTotal, 1)
  assert.equal(plan.stats.unmatchedCreatorHintsIgnored, 1)
  assert.equal(plan.works[0].status, 'planned')
  assert.equal(plan.works[0].relationships.creators[0].name, 'Creator A')
  assert.equal(plan.works[0].relationships.organizations[0].name, 'Studio A')
  assert.equal(plan.works[1].status, 'skipped')
  assert.ok(plan.works[1].skipReasons.includes('no-linked-relations'))
})

test('patch plan is blocked when audit is not pass', () => {
  const plan = buildBangumiWorkEntityLinkPatchPlan(preview(), audit({ meta: { ...audit().meta, status: 'fail', errors: 1 } }))

  assert.equal(plan.meta.status, 'blocked')
  assert.equal(plan.blockedReasons.auditNotPass, true)
  assert.equal(plan.stats.worksPlanned, 0)
  assert.equal(plan.works[0].status, 'skipped')
  assert.ok(plan.works[0].skipReasons.includes('audit-not-pass'))
})

test('patch plan skips ambiguous work rows', () => {
  const data = preview()
  data.works[0].ambiguousCreatorHints.push({ hint: { name: 'Creator A' }, matches: [] })
  const plan = buildBangumiWorkEntityLinkPatchPlan(data, audit())

  assert.equal(plan.meta.status, 'ready')
  assert.equal(plan.stats.worksPlanned, 0)
  assert.equal(plan.stats.ambiguousCreatorHintsBlocked, 1)
  assert.ok(plan.works[0].skipReasons.includes('ambiguous-creator-hints'))
})

test('patch plan blocks invalid preview shape', () => {
  const plan = buildBangumiWorkEntityLinkPatchPlan({ meta: { source: 'other' }, works: [] }, audit())

  assert.equal(plan.meta.status, 'blocked')
  assert.equal(plan.blockedReasons.previewInvalid, true)
})

test('patch plan report includes safety summary', () => {
  const plan = buildBangumiWorkEntityLinkPatchPlan(preview(), audit())
  const report = createBangumiWorkEntityLinkPatchPlanReport(plan)

  assert.match(report, /Bangumi work\/entity link patch plan/u)
  assert.match(report, /本地 patch plan/u)
  assert.match(report, /不调用 Payload API/u)
  assert.match(report, /unmatched hints 被统计为 ignored/u)
})
