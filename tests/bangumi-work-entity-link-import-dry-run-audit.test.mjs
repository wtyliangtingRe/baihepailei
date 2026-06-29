import test from 'node:test'
import assert from 'node:assert/strict'

import {
  auditBangumiWorkEntityLinkImportDryRun,
  createBangumiWorkEntityLinkImportDryRunAuditReport,
} from '../tools/source_import/scripts/audit-bangumi-work-entity-link-dry-run.mjs'

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

function dryRun(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-work-entity-link-import-dry-run',
      mode: 'dry-run-only-no-payload-write',
      status: 'pass',
      dryRun: true,
      planMode: 'plan-only-no-payload-write',
      auditCheck: 'audit-pass',
      worksTotal: 1,
      actionsTotal: 1,
      wouldPatchWorksTotal: 1,
      skippedPlanWorksTotal: 1,
      creatorLinksTotal: 1,
      organizationLinksTotal: 1,
      errors: 0,
      warnings: 0,
      infos: 1,
    },
    actions: [
      {
        action: 'dry-run-patch-work-relationships',
        work: { siteId: 'bangumi:1', slug: 'work-a', title: 'Work A' },
        dryRun: true,
        wouldPatch: true,
        patchPreview: {
          creators: [relation('creators', 'Creator A')],
          organizations: [relation('organizations', 'Studio A', 'animation_studio')],
        },
        skippedHints: {},
      },
    ],
    skippedPlanWorks: [
      {
        work: { siteId: 'bangumi:2', slug: 'work-b', title: 'Work B' },
        reasons: ['no-matched-links'],
      },
    ],
    issues: [
      {
        level: 'info',
        code: 'plan-skipped-works-present',
        path: 'skippedWorks',
        message: 'Some works were skipped by the patch plan and will not be patched.',
      },
    ],
    ...overrides,
  }
}

function plan(overrides = {}) {
  return {
    meta: {
      mode: 'plan-only-no-payload-write',
      auditCheck: 'audit-pass',
      plannedWorksTotal: 1,
      skippedWorksTotal: 1,
    },
    works: [{ work: { siteId: 'bangumi:1' } }],
    skippedWorks: [{ work: { siteId: 'bangumi:2' } }],
    ...overrides,
  }
}

test('dry-run audit passes a valid dry-run result and plan pair', () => {
  const audit = auditBangumiWorkEntityLinkImportDryRun(dryRun(), plan())

  assert.equal(audit.meta.mode, 'audit-only-no-payload-write')
  assert.equal(audit.meta.status, 'pass')
  assert.equal(audit.meta.errors, 0)
  assert.equal(audit.stats.actionsTotal, 1)
  assert.equal(audit.stats.wouldPatchWorksTotal, 1)
  assert.equal(audit.stats.creatorLinksTotal, 1)
  assert.equal(audit.stats.organizationLinksTotal, 1)
  assert.ok(audit.issues.some((issue) => issue.code === 'skipped-plan-works-present'))
})

test('dry-run audit fails invalid dry-run mode and status', () => {
  const audit = auditBangumiWorkEntityLinkImportDryRun(dryRun({
    meta: {
      ...dryRun().meta,
      mode: 'write-enabled',
      status: 'fail',
      errors: 1,
    },
  }), plan())

  assert.equal(audit.meta.status, 'fail')
  assert.ok(audit.issues.some((issue) => issue.code === 'invalid-dry-run-mode'))
  assert.ok(audit.issues.some((issue) => issue.code === 'dry-run-not-pass'))
  assert.ok(audit.issues.some((issue) => issue.code === 'dry-run-has-errors'))
})

test('dry-run audit fails if actions are not patchable', () => {
  const input = dryRun()
  input.actions[0].wouldPatch = false
  input.meta.wouldPatchWorksTotal = 0

  const audit = auditBangumiWorkEntityLinkImportDryRun(input, plan())

  assert.equal(audit.meta.status, 'fail')
  assert.ok(audit.issues.some((issue) => issue.code === 'action-would-patch-not-true'))
})

test('dry-run audit fails relation shape and duplicate relation issues', () => {
  const input = dryRun()
  input.actions[0].patchPreview.creators.push({ ...input.actions[0].patchPreview.creators[0] })
  input.actions[0].patchPreview.organizations[0].source = {}
  input.meta.creatorLinksTotal = 2

  const audit = auditBangumiWorkEntityLinkImportDryRun(input, plan())

  assert.equal(audit.meta.status, 'fail')
  assert.ok(audit.issues.some((issue) => issue.code === 'duplicate-action-relation'))
  assert.ok(audit.issues.some((issue) => issue.code === 'invalid-relation-shape'))
})

test('dry-run audit cross-checks the input plan counts', () => {
  const audit = auditBangumiWorkEntityLinkImportDryRun(dryRun(), plan({
    meta: {
      mode: 'plan-only-no-payload-write',
      auditCheck: 'audit-pass',
      plannedWorksTotal: 2,
      skippedWorksTotal: 1,
    },
  }))

  assert.equal(audit.meta.status, 'fail')
  assert.ok(audit.issues.some((issue) => issue.code === 'plan-actions-count-mismatch'))
})

test('dry-run audit report includes safety summary', () => {
  const audit = auditBangumiWorkEntityLinkImportDryRun(dryRun(), plan())
  const report = createBangumiWorkEntityLinkImportDryRunAuditReport(audit, { dryRunInputPath: 'dry-run.json', planInputPath: 'plan.json' })

  assert.match(report, /Bangumi work\/entity link import dry-run audit/u)
  assert.match(report, /不调用 Payload API/u)
  assert.match(report, /不写入 relationships/u)
  assert.match(report, /真实写入 PR/u)
})
