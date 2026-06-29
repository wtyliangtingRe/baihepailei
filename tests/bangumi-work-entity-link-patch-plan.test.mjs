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
      note: 'sample',
      rawLine: `- ${name} | role=${role} | source=bangumi`,
    },
  }
}

const passingAudit = {
  meta: {
    mode: 'audit-only-no-payload-write',
    status: 'pass',
    errors: 0,
  },
}

function preview() {
  return {
    meta: {
      mode: 'preview-only-no-payload-write',
    },
    works: [
      {
        work: { siteId: 'bangumi:1', slug: 'work-a', title: 'Work A' },
        creators: [link('creators', 'Creator A'), link('creators', 'Creator A')],
        organizations: [link('organizations', 'Studio A', 'animation_studio')],
        unmatchedCreatorHints: [{ name: 'Missing Person' }],
        unmatchedOrganizationHints: [],
        ambiguousCreatorHints: [],
        ambiguousOrganizationHints: [],
      },
      {
        work: { siteId: 'bangumi:2', slug: 'work-b', title: 'Work B' },
        creators: [],
        organizations: [],
        unmatchedCreatorHints: [],
        unmatchedOrganizationHints: [],
        ambiguousCreatorHints: [],
        ambiguousOrganizationHints: [],
      },
    ],
  }
}

test('patch plan builds only matched relationship candidates after passing audit', () => {
  const plan = buildBangumiWorkEntityLinkPatchPlan(preview(), passingAudit)

  assert.equal(plan.meta.mode, 'plan-only-no-payload-write')
  assert.equal(plan.meta.auditCheck, 'audit-pass')
  assert.equal(plan.meta.worksTotal, 2)
  assert.equal(plan.meta.plannedWorksTotal, 1)
  assert.equal(plan.meta.skippedWorksTotal, 1)
  assert.equal(plan.meta.plannedCreatorLinksTotal, 1)
  assert.equal(plan.meta.plannedOrganizationLinksTotal, 1)
  assert.equal(plan.works[0].operation, 'patch-work-relationships')
  assert.equal(plan.works[0].relationships.creators[0].source.type, 'bangumi-credit-hint')
  assert.equal(plan.skippedWorks[0].reasons[0], 'no-matched-links')
})

test('patch plan skips all works when audit is not passing', () => {
  const plan = buildBangumiWorkEntityLinkPatchPlan(preview(), {
    meta: { mode: 'audit-only-no-payload-write', status: 'fail', errors: 1 },
  })

  assert.equal(plan.meta.auditCheck, 'audit-not-pass')
  assert.equal(plan.meta.plannedWorksTotal, 0)
  assert.equal(plan.meta.skippedWorksTotal, 2)
  assert.ok(plan.skippedWorks.every((work) => work.reasons.includes('audit-not-pass')))
})

test('patch plan skips works with ambiguous hints even when links exist', () => {
  const input = preview()
  input.works[0].ambiguousCreatorHints.push({ hint: { name: 'Creator A' }, matches: [] })

  const plan = buildBangumiWorkEntityLinkPatchPlan(input, passingAudit)

  assert.equal(plan.meta.plannedWorksTotal, 0)
  assert.equal(plan.meta.skippedWorksTotal, 2)
  assert.ok(plan.skippedWorks[0].reasons.includes('ambiguous-hints-present'))
})

test('patch plan report includes safety summary', () => {
  const plan = buildBangumiWorkEntityLinkPatchPlan(preview(), passingAudit)
  const report = createBangumiWorkEntityLinkPatchPlanReport(plan, { previewInputPath: 'preview.json', auditInputPath: 'audit.json' })

  assert.match(report, /Bangumi work\/entity link patch plan/u)
  assert.match(report, /不调用 Payload API/u)
  assert.match(report, /不创建、不更新、不 PATCH works/u)
  assert.match(report, /unmatched hints 不进入写入计划/u)
})
