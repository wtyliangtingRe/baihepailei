import test from 'node:test'
import assert from 'node:assert/strict'

import {
  auditBangumiMediaEntitySeedPreview,
  createBangumiMediaEntitySeedPreviewAuditReport,
} from '../tools/source_import/scripts/audit-bangumi-media-entity-seed-preview.mjs'

function validSeed(kind, overrides = {}) {
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
    safety: {
      payloadWrite: false,
      databaseWrite: false,
      entityImport: false,
      worksPatch: false,
    },
    ...overrides,
  }
}

function validPreview(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-media-entity-seed-preview',
      mode: 'preview-only-no-payload-write',
      generatedAt: '2026-06-29T00:00:00.000Z',
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        entityImport: false,
        worksPatch: false,
      },
      stats: {
        creatorsTotal: 1,
        organizationsTotal: 1,
        seedsTotal: 2,
        seedEvidenceTotal: 2,
      },
    },
    creators: [validSeed('creator')],
    organizations: [validSeed('organization')],
    ...overrides,
  }
}

test('valid media entity seed preview audit passes', () => {
  const audit = auditBangumiMediaEntitySeedPreview(validPreview(), {
    generatedAt: '2026-06-29T01:00:00.000Z',
  })

  assert.equal(audit.source, 'bangumi-media-entity-seed-preview-audit')
  assert.equal(audit.mode, 'audit-only-no-payload-write')
  assert.equal(audit.status, 'pass')
  assert.equal(audit.errors.length, 0)
  assert.equal(audit.stats.creatorsTotal, 1)
  assert.equal(audit.stats.organizationsTotal, 1)
  assert.equal(audit.stats.seedsTotal, 2)
  assert.equal(audit.stats.seedEvidenceTotal, 2)
  assert.deepEqual(audit.stats.creatorRoleCounts, { original_creator: 1 })
  assert.deepEqual(audit.stats.organizationRoleCounts, { publisher: 1 })
})

test('audit fails unsafe meta and malformed seed rows', () => {
  const preview = validPreview({
    meta: {
      source: 'wrong-source',
      mode: 'apply',
      safety: {
        payloadWrite: true,
        databaseWrite: false,
        entityImport: false,
        worksPatch: false,
      },
      stats: {
        creatorsTotal: 2,
        organizationsTotal: 1,
        seedsTotal: 99,
        seedEvidenceTotal: 99,
      },
    },
    creators: [
      validSeed('creator', {
        name: '',
        slug: '',
        collection: 'organizations',
        kind: 'organization',
        status: 'published',
        source: 'other',
        mode: 'apply',
        sourceWorks: [],
        evidence: [],
      }),
    ],
  })

  const audit = auditBangumiMediaEntitySeedPreview(preview)
  const codes = audit.errors.map((error) => error.code)

  assert.equal(audit.status, 'fail')
  assert.ok(codes.includes('unexpected-source'))
  assert.ok(codes.includes('unexpected-mode'))
  assert.ok(codes.includes('unsafe-preview-flag'))
  assert.ok(codes.includes('missing-seed-name'))
  assert.ok(codes.includes('missing-seed-slug'))
  assert.ok(codes.includes('unexpected-seed-collection'))
  assert.ok(codes.includes('unexpected-seed-kind'))
  assert.ok(codes.includes('unexpected-seed-status'))
  assert.ok(codes.includes('unexpected-seed-source'))
  assert.ok(codes.includes('unexpected-seed-mode'))
  assert.ok(codes.includes('missing-seed-source-works'))
  assert.ok(codes.includes('missing-seed-evidence'))
  assert.ok(codes.includes('creators-total-mismatch'))
  assert.ok(codes.includes('seeds-total-mismatch'))
  assert.ok(codes.includes('seed-evidence-total-mismatch'))
})

test('audit detects duplicate seed names and platform organization infos', () => {
  const preview = validPreview({
    meta: {
      source: 'bangumi-media-entity-seed-preview',
      mode: 'preview-only-no-payload-write',
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        entityImport: false,
        worksPatch: false,
      },
      stats: {
        creatorsTotal: 2,
        organizationsTotal: 1,
        seedsTotal: 3,
        seedEvidenceTotal: 3,
      },
    },
    creators: [validSeed('creator'), validSeed('creator', { name: 'author a', slug: 'author-a-2' })],
    organizations: [validSeed('organization', { name: 'PC', slug: 'pc', roles: ['platform'], originalRoles: ['平台'] })],
  })

  const audit = auditBangumiMediaEntitySeedPreview(preview)

  assert.equal(audit.status, 'fail')
  assert.ok(audit.errors.some((error) => error.code === 'duplicate-seed-name'))
  assert.ok(audit.infos.some((info) => info.code === 'platform-organization-seeds'))
  assert.equal(audit.stats.platformOrganizationSeedsTotal, 1)
})

test('audit report includes safety and issue sections', () => {
  const audit = auditBangumiMediaEntitySeedPreview(validPreview(), {
    generatedAt: '2026-06-29T01:00:00.000Z',
  })
  const report = createBangumiMediaEntitySeedPreviewAuditReport(audit, {
    inputPath: 'data_local/payload/bangumi-media-entity-seed-preview.json',
  })

  assert.match(report, /# Bangumi media entity seed preview audit/)
  assert.match(report, /status: pass/)
  assert.match(report, /No Payload connection/)
  assert.match(report, /No database writes/)
  assert.match(report, /original_creator: 1/)
  assert.match(report, /publisher: 1/)
  assert.match(report, /## Errors/)
})
