import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyBangumiWorkEntityLinks,
  buildBangumiWorkEntityLinkImportDryRun,
  buildWorkRelationshipPatch,
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
      note: 'sample',
      rawLine: `- ${name} | role=${role} | source=bangumi`,
    },
  }
}

function plan() {
  return {
    meta: { mode: 'plan-only-no-payload-write', auditCheck: 'audit-pass' },
    works: [
      {
        work: { siteId: 'bangumi:1', slug: 'work-a', title: 'Work A' },
        relationships: {
          creators: [relation('creators', 'Creator A')],
          organizations: [relation('organizations', 'Studio A', 'animation_studio')],
        },
        skippedHints: {},
      },
    ],
    skippedWorks: [],
  }
}

const passingAudit = { meta: { mode: 'audit-only-no-payload-write', status: 'pass', errors: 0 } }

test('relationship patch appends missing rows and keeps existing rows', () => {
  const action = buildBangumiWorkEntityLinkImportDryRun(plan()).actions[0]
  const existingWork = {
    creators: ['creator-existing'],
    creatorCredits: [{ creator: 'creator-existing', role: 'director', originalRole: 'director', source: 'manual', note: 'keep' }],
    organizations: [{ organization: 'org-existing', role: 'broadcaster', originalRole: 'broadcaster', source: 'manual', note: 'keep' }],
  }
  const resolved = {
    creators: [{ id: 'creator-a', relation: action.patchPreview.creators[0] }],
    organizations: [{ id: 'studio-a', relation: action.patchPreview.organizations[0] }],
  }

  const result = buildWorkRelationshipPatch(existingWork, action, resolved)

  assert.equal(result.changed, true)
  assert.deepEqual(result.patch.creators, ['creator-existing', 'creator-a'])
  assert.equal(result.patch.creatorCredits.length, 2)
  assert.equal(result.patch.organizations.length, 2)
})

test('relationship patch is empty when all rows already exist', () => {
  const action = buildBangumiWorkEntityLinkImportDryRun(plan()).actions[0]
  const existingWork = {
    creators: ['creator-a'],
    creatorCredits: [{ creator: 'creator-a', role: 'writer', originalRole: 'writer', source: 'bangumi', note: 'old' }],
    organizations: [{ organization: 'studio-a', role: 'animation_studio', originalRole: 'animation_studio', source: 'bangumi', note: 'old' }],
  }
  const resolved = {
    creators: [{ id: 'creator-a', relation: action.patchPreview.creators[0] }],
    organizations: [{ id: 'studio-a', relation: action.patchPreview.organizations[0] }],
  }

  const result = buildWorkRelationshipPatch(existingWork, action, resolved)

  assert.equal(result.changed, false)
  assert.deepEqual(result.patch, {})
})

test('guarded apply refuses missing confirmation', async () => {
  const result = await applyBangumiWorkEntityLinks({
    plan: plan(),
    dryRunAudit: passingAudit,
    baseUrl: 'http://localhost:3000',
    email: '',
    password: '',
    apply: true,
    confirm: '',
  })

  assert.equal(result.meta.status, 'fail')
  assert.equal(result.meta.updated, 0)
  assert.ok(result.issues.some((issue) => issue.code === 'apply-confirm-missing'))
})

test('guarded apply refuses failed audit marker', async () => {
  const result = await applyBangumiWorkEntityLinks({
    plan: plan(),
    dryRunAudit: { meta: { mode: 'audit-only-no-payload-write', status: 'fail', errors: 1 } },
    baseUrl: 'http://localhost:3000',
    email: '',
    password: '',
    apply: true,
    confirm: 'APPLY_WORK_ENTITY_LINKS',
  })

  assert.equal(result.meta.status, 'fail')
  assert.ok(result.issues.some((issue) => issue.code === 'dry-run-audit-not-pass'))
})
