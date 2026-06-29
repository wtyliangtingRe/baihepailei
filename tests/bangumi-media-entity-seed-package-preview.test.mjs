import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiMediaEntitySeedPackagePreview,
  createBangumiMediaEntitySeedPackagePreviewReport,
} from '../tools/source_import/scripts/build-bangumi-media-entity-seed-package-preview.mjs'

import {
  auditBangumiMediaEntitySeedPackagePreview,
  createBangumiMediaEntitySeedPackagePreviewAuditReport,
} from '../tools/source_import/scripts/audit-bangumi-media-entity-seed-package-preview.mjs'

function seed(kind, overrides = {}) {
  const isCreator = kind === 'creator'
  return {
    collection: isCreator ? 'creators' : 'organizations',
    kind,
    name: isCreator ? 'Author A' : 'Publisher B',
    slug: isCreator ? 'author-a' : 'publisher-b',
    status: 'draft',
    source: 'bangumi-media-candidate-work-hints',
    mode: 'preview-only-no-payload-write',
    aliases: [],
    roles: [isCreator ? 'original_creator' : 'publisher'],
    originalRoles: [isCreator ? '作者' : '出版社'],
    sourceWorks: [
      {
        title: '样本作品',
        slug: 'sample-work',
        mediaGroup: 'manga',
        mediaType: 'manga',
        bangumiSubjectId: '1',
      },
    ],
    evidence: [
      {
        key: '1|original_creator|作者',
        source: 'bangumi',
        role: isCreator ? 'original_creator' : 'publisher',
        originalRole: isCreator ? '作者' : '出版社',
        work: {
          title: '样本作品',
          slug: 'sample-work',
          mediaGroup: 'manga',
          mediaType: 'manga',
          bangumiSubjectId: '1',
        },
      },
    ],
    ...overrides,
  }
}

function seedPreview(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-media-entity-seed-preview',
      mode: 'preview-only-no-payload-write',
      generatedAt: '2026-06-29T00:00:00.000Z',
    },
    creators: [seed('creator')],
    organizations: [seed('organization'), seed('organization', {
      name: 'PC',
      slug: 'pc',
      roles: ['platform'],
      originalRoles: ['平台'],
    })],
    ...overrides,
  }
}

test('seed package preview excludes platform organizations by default', () => {
  const pkg = buildBangumiMediaEntitySeedPackagePreview(seedPreview(), {
    generatedAt: '2026-06-29T01:00:00.000Z',
  })

  assert.equal(pkg.meta.source, 'bangumi-media-entity-seed-package-preview')
  assert.equal(pkg.meta.mode, 'package-preview-only-no-payload-write')
  assert.equal(pkg.meta.safety.payloadWrite, false)
  assert.equal(pkg.meta.safety.databaseWrite, false)
  assert.equal(pkg.meta.safety.entityImport, false)
  assert.equal(pkg.meta.safety.worksPatch, false)
  assert.equal(pkg.creators.length, 1)
  assert.equal(pkg.organizations.length, 1)
  assert.equal(pkg.skippedSeeds.length, 1)
  assert.equal(pkg.skippedSeeds[0].name, 'PC')
  assert.equal(pkg.skippedSeeds[0].reason, 'platform-organization-excluded-by-default')
  assert.equal(pkg.meta.stats.excludedPlatformSeedsTotal, 1)
  assert.equal(pkg.meta.stats.packageEvidenceTotal, 2)
})

test('seed package preview can include platform organizations when explicitly allowed', () => {
  const pkg = buildBangumiMediaEntitySeedPackagePreview(seedPreview(), {
    excludePlatformOrganizations: false,
  })

  assert.equal(pkg.organizations.length, 2)
  assert.equal(pkg.skippedSeeds.length, 0)
  assert.ok(pkg.organizations.some((entity) => entity.name === 'PC'))
})

test('valid seed package audit passes with platform exclusion info', () => {
  const pkg = buildBangumiMediaEntitySeedPackagePreview(seedPreview())
  const audit = auditBangumiMediaEntitySeedPackagePreview(pkg, {
    generatedAt: '2026-06-29T02:00:00.000Z',
  })

  assert.equal(audit.source, 'bangumi-media-entity-seed-package-preview-audit')
  assert.equal(audit.mode, 'audit-only-no-payload-write')
  assert.equal(audit.status, 'pass')
  assert.equal(audit.errors.length, 0)
  assert.equal(audit.stats.creatorsTotal, 1)
  assert.equal(audit.stats.organizationsTotal, 1)
  assert.equal(audit.stats.skippedSeedsTotal, 1)
  assert.equal(audit.stats.excludedPlatformSeedsTotal, 1)
  assert.equal(audit.stats.packageEvidenceTotal, 2)
  assert.ok(audit.infos.some((info) => info.code === 'platform-organization-seeds-excluded'))
})

test('seed package audit fails unsafe and malformed package entities', () => {
  const pkg = buildBangumiMediaEntitySeedPackagePreview(seedPreview())
  pkg.meta.source = 'wrong-source'
  pkg.meta.mode = 'apply'
  pkg.meta.safety.payloadWrite = true
  pkg.meta.stats.creatorsTotal = 99
  pkg.creators.push({
    collection: 'organizations',
    kind: 'organization',
    name: '',
    slug: '',
    status: 'published',
    importAction: 'update',
    source: 'other',
    roles: [],
    originalRoles: [],
    sourceWorks: [],
    evidence: [],
    safety: {
      payloadWrite: true,
      databaseWrite: false,
      entityImport: false,
      worksPatch: false,
    },
  })

  const audit = auditBangumiMediaEntitySeedPackagePreview(pkg)
  const codes = audit.errors.map((error) => error.code)

  assert.equal(audit.status, 'fail')
  assert.ok(codes.includes('unexpected-source'))
  assert.ok(codes.includes('unexpected-mode'))
  assert.ok(codes.includes('unsafe-package-flag'))
  assert.ok(codes.includes('missing-entity-name'))
  assert.ok(codes.includes('missing-entity-slug'))
  assert.ok(codes.includes('unexpected-entity-collection'))
  assert.ok(codes.includes('unexpected-entity-kind'))
  assert.ok(codes.includes('unexpected-entity-status'))
  assert.ok(codes.includes('unexpected-import-action'))
  assert.ok(codes.includes('unexpected-entity-source'))
  assert.ok(codes.includes('unsafe-entity-flag'))
  assert.ok(codes.includes('missing-entity-source-works'))
  assert.ok(codes.includes('missing-entity-evidence'))
  assert.ok(codes.includes('creators-total-mismatch'))
})

test('seed package audit fails when platform organization enters package', () => {
  const pkg = buildBangumiMediaEntitySeedPackagePreview(seedPreview(), {
    excludePlatformOrganizations: false,
  })
  const audit = auditBangumiMediaEntitySeedPackagePreview(pkg)

  assert.equal(audit.status, 'fail')
  assert.ok(audit.errors.some((error) => error.code === 'platform-organization-in-package'))
  assert.equal(audit.stats.platformOrganizationsInPackageTotal, 1)
})

test('seed package reports include safety and skipped seed sections', () => {
  const pkg = buildBangumiMediaEntitySeedPackagePreview(seedPreview())
  const previewReport = createBangumiMediaEntitySeedPackagePreviewReport(pkg)
  const audit = auditBangumiMediaEntitySeedPackagePreview(pkg)
  const auditReport = createBangumiMediaEntitySeedPackagePreviewAuditReport(audit)

  assert.match(previewReport, /# Bangumi media entity seed package preview/)
  assert.match(previewReport, /No Payload connection/)
  assert.match(previewReport, /PC: reason=platform-organization-excluded-by-default/)
  assert.match(auditReport, /# Bangumi media entity seed package preview audit/)
  assert.match(auditReport, /status: pass/)
  assert.match(auditReport, /No database writes/)
})
