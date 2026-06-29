import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiMediaWorkImportDryRun,
  createBangumiMediaWorkImportDryRunReport,
} from '../tools/source_import/scripts/dry-run-bangumi-media-work-import.mjs'

function work(overrides = {}) {
  return {
    collection: 'works',
    kind: 'media-work',
    title: '样本漫画',
    slug: 'sample-manga',
    originalSlug: 'sample-manga',
    slugCollisionResolved: false,
    status: 'draft',
    importAction: 'create-if-missing',
    mediaGroup: 'manga',
    mediaType: 'manga',
    bangumiSubjectId: '1001',
    creatorCreditHints: [{ name: '作者A', role: 'original_creator' }],
    organizationCreditHints: [{ name: '出版社B', role: 'publisher' }],
    evidence: [{ title: '样本漫画', bangumiSubjectId: '1001' }],
    ...overrides,
  }
}

function packagePreview(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-media-work-package-preview',
      mode: 'package-preview-only-no-payload-write',
      generatedAt: '2026-06-29T00:00:00.000Z',
    },
    works: [work(), work({ title: '样本游戏', slug: 'sample-game', mediaGroup: 'game', mediaType: 'visual_novel', bangumiSubjectId: '2001' })],
    ...overrides,
  }
}

function passAudit(overrides = {}) {
  return {
    source: 'bangumi-media-work-package-preview-audit',
    mode: 'audit-only-no-payload-write',
    status: 'pass',
    errors: [],
    ...overrides,
  }
}

test('work import dry-run classifies would-create and exact existing rows without writes', async () => {
  const dryRun = await buildBangumiMediaWorkImportDryRun(packagePreview(), passAudit(), {
    generatedAt: '2026-06-29T01:00:00.000Z',
    lookupWork: async (row) => {
      if (row.slug === 'sample-manga') return []
      return [{ id: 'work-1', title: row.title, slug: row.slug, status: 'draft' }]
    },
  })

  assert.equal(dryRun.meta.source, 'bangumi-media-work-import-dry-run')
  assert.equal(dryRun.meta.mode, 'dry-run-payload-read-no-write')
  assert.equal(dryRun.meta.safety.payloadRead, true)
  assert.equal(dryRun.meta.safety.payloadWrite, false)
  assert.equal(dryRun.meta.safety.databaseWrite, false)
  assert.equal(dryRun.meta.safety.workImport, false)
  assert.equal(dryRun.meta.safety.worksPatch, false)
  assert.equal(dryRun.meta.stats.packageWorksTotal, 2)
  assert.equal(dryRun.meta.stats.wouldCreateTotal, 1)
  assert.equal(dryRun.meta.stats.alreadyExistsTotal, 1)
  assert.equal(dryRun.meta.stats.ambiguousExistingTotal, 0)
  assert.equal(dryRun.meta.stats.queryErrorsTotal, 0)
  assert.equal(dryRun.results.find((row) => row.slug === 'sample-manga').plannedOperation, 'create')
  assert.equal(dryRun.results.find((row) => row.slug === 'sample-game').plannedOperation, 'none')
})

test('work import dry-run prefers exact title and slug while recording title collisions', async () => {
  const dryRun = await buildBangumiMediaWorkImportDryRun(packagePreview({ works: [work()] }), passAudit(), {
    lookupWork: async (row) => [
      { id: 'work-new', title: row.title, slug: row.slug, status: 'draft' },
      { id: 'work-old', title: row.title, slug: 'legacy-same-title', status: 'draft' },
    ],
  })
  const row = dryRun.results[0]

  assert.equal(dryRun.meta.stats.alreadyExistsTotal, 1)
  assert.equal(dryRun.meta.stats.ambiguousExistingTotal, 0)
  assert.equal(dryRun.meta.stats.titleCollisionRowsTotal, 1)
  assert.equal(dryRun.meta.stats.titleCollisionDocsTotal, 1)
  assert.equal(row.status, 'already-exists')
  assert.equal(row.existing.length, 1)
  assert.equal(row.existing[0].id, 'work-new')
  assert.equal(row.titleCollisions.length, 1)
  assert.equal(row.titleCollisions[0].id, 'work-old')
})

test('work import dry-run treats same-title different-slug rows as ambiguous when no exact match exists', async () => {
  const dryRun = await buildBangumiMediaWorkImportDryRun(packagePreview({ works: [work()] }), passAudit(), {
    lookupWork: async (row) => [
      { id: 'work-old', title: row.title, slug: 'legacy-same-title', status: 'draft' },
    ],
  })

  assert.equal(dryRun.meta.stats.ambiguousExistingTotal, 1)
  assert.equal(dryRun.results[0].status, 'ambiguous-existing')
})

test('work import dry-run detects query errors', async () => {
  const dryRun = await buildBangumiMediaWorkImportDryRun(packagePreview({ works: [work()] }), passAudit(), {
    lookupWork: async () => {
      throw new Error('local payload unavailable')
    },
  })

  assert.equal(dryRun.meta.stats.queryErrorsTotal, 1)
  assert.equal(dryRun.results[0].status, 'query-error')
  assert.equal(dryRun.results[0].error, 'local payload unavailable')
})

test('work import dry-run blocks when audit is missing or package is invalid', async () => {
  const dryRun = await buildBangumiMediaWorkImportDryRun(packagePreview(), null, {
    lookupWork: async () => { throw new Error('should not query') },
  })

  assert.equal(dryRun.meta.safety.payloadRead, false)
  assert.equal(dryRun.meta.stats.resultsTotal, 0)
  assert.equal(dryRun.meta.stats.skippedWorksTotal, 2)
  assert.equal(dryRun.skippedWorks[0].reason, 'audit-missing')

  const invalidPackage = packagePreview({ meta: { source: 'wrong', mode: 'wrong' } })
  const invalidDryRun = await buildBangumiMediaWorkImportDryRun(invalidPackage, passAudit(), {
    lookupWork: async () => { throw new Error('should not query') },
  })

  assert.equal(invalidDryRun.meta.safety.payloadRead, false)
  assert.equal(invalidDryRun.skippedWorks[0].reason, 'package-source-invalid')
})

test('work import dry-run can bypass audit check explicitly', async () => {
  const dryRun = await buildBangumiMediaWorkImportDryRun(packagePreview(), null, {
    requireAuditPass: false,
    lookupWork: async () => [],
  })

  assert.equal(dryRun.meta.checks.auditCheck, 'audit-check-disabled')
  assert.equal(dryRun.meta.stats.resultsTotal, 2)
  assert.equal(dryRun.meta.stats.wouldCreateTotal, 2)
})

test('work import dry-run report includes safety and result counts', async () => {
  const dryRun = await buildBangumiMediaWorkImportDryRun(packagePreview(), passAudit(), {
    lookupWork: async () => [],
  })
  const report = createBangumiMediaWorkImportDryRunReport(dryRun, {
    inputPath: 'data_local/payload/bangumi-media-work-package-preview.json',
    auditPath: 'data_local/reports/bangumi-media-work-package-preview-audit.json',
  })

  assert.match(report, /# Bangumi media work import dry-run/)
  assert.match(report, /Payload read\/query only/)
  assert.match(report, /No Payload create\/update\/delete/)
  assert.match(report, /wouldCreateTotal: 2/)
  assert.match(report, /titleCollisionRowsTotal: 0/)
  assert.match(report, /## Results/)
})
