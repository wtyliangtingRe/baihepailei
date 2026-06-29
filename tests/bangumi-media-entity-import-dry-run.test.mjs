import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiMediaEntityImportDryRun,
  createBangumiMediaEntityImportDryRunReport,
} from '../tools/source_import/scripts/dry-run-bangumi-media-entity-import.mjs'

function entity(collection, overrides = {}) {
  const isCreator = collection === 'creators'
  return {
    collection,
    kind: isCreator ? 'creator' : 'organization',
    name: isCreator ? 'Author A' : 'Publisher B',
    slug: isCreator ? 'author-a' : 'publisher-b',
    status: 'draft',
    importAction: 'create-if-missing',
    source: 'bangumi-media-entity-seed-package-preview',
    roles: [isCreator ? 'original_creator' : 'publisher'],
    originalRoles: [isCreator ? '作者' : '出版社'],
    sourceWorks: [{ title: '样本作品', bangumiSubjectId: '1' }],
    evidence: [{ key: '1|role|originalRole', role: isCreator ? 'original_creator' : 'publisher', originalRole: isCreator ? '作者' : '出版社', work: { title: '样本作品', bangumiSubjectId: '1' } }],
    ...overrides,
  }
}

function packagePreview(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-media-entity-seed-package-preview',
      mode: 'package-preview-only-no-payload-write',
      generatedAt: '2026-06-29T00:00:00.000Z',
    },
    creators: [entity('creators')],
    organizations: [entity('organizations')],
    skippedSeeds: [],
    ...overrides,
  }
}

function passAudit(overrides = {}) {
  return {
    source: 'bangumi-media-entity-seed-package-preview-audit',
    mode: 'audit-only-no-payload-write',
    status: 'pass',
    errors: [],
    ...overrides,
  }
}

test('entity import dry-run classifies would-create and existing rows without writes', async () => {
  const dryRun = await buildBangumiMediaEntityImportDryRun(packagePreview(), passAudit(), {
    generatedAt: '2026-06-29T01:00:00.000Z',
    lookupEntity: async (row) => {
      if (row.collection === 'creators') return []
      return [{ id: 'org-1', name: row.name, slug: row.slug, status: 'draft' }]
    },
  })

  assert.equal(dryRun.meta.source, 'bangumi-media-entity-import-dry-run')
  assert.equal(dryRun.meta.mode, 'dry-run-payload-read-no-write')
  assert.equal(dryRun.meta.safety.payloadRead, true)
  assert.equal(dryRun.meta.safety.payloadWrite, false)
  assert.equal(dryRun.meta.safety.databaseWrite, false)
  assert.equal(dryRun.meta.safety.entityImport, false)
  assert.equal(dryRun.meta.stats.packageEntitiesTotal, 2)
  assert.equal(dryRun.meta.stats.wouldCreateTotal, 1)
  assert.equal(dryRun.meta.stats.alreadyExistsTotal, 1)
  assert.equal(dryRun.meta.stats.ambiguousExistingTotal, 0)
  assert.equal(dryRun.meta.stats.queryErrorsTotal, 0)
  assert.equal(dryRun.results.find((row) => row.collection === 'creators').plannedOperation, 'create')
  assert.equal(dryRun.results.find((row) => row.collection === 'organizations').plannedOperation, 'none')
})

test('entity import dry-run detects ambiguous matches and query errors', async () => {
  const dryRun = await buildBangumiMediaEntityImportDryRun(packagePreview(), passAudit(), {
    lookupEntity: async (row) => {
      if (row.collection === 'creators') return [
        { id: 'creator-1', name: row.name, slug: row.slug },
        { id: 'creator-2', name: row.name, slug: `${row.slug}-2` },
      ]
      throw new Error('local payload unavailable')
    },
  })

  assert.equal(dryRun.meta.stats.ambiguousExistingTotal, 1)
  assert.equal(dryRun.meta.stats.queryErrorsTotal, 1)
  assert.equal(dryRun.results.find((row) => row.collection === 'creators').status, 'ambiguous-existing')
  assert.equal(dryRun.results.find((row) => row.collection === 'organizations').status, 'query-error')
})

test('entity import dry-run blocks when audit is missing or package is invalid', async () => {
  const dryRun = await buildBangumiMediaEntityImportDryRun(packagePreview(), null, {
    lookupEntity: async () => { throw new Error('should not query') },
  })

  assert.equal(dryRun.meta.safety.payloadRead, false)
  assert.equal(dryRun.meta.stats.resultsTotal, 0)
  assert.equal(dryRun.meta.stats.skippedEntitiesTotal, 2)
  assert.equal(dryRun.skippedEntities[0].reason, 'audit-missing')

  const invalidPackage = packagePreview({ meta: { source: 'wrong', mode: 'wrong' } })
  const invalidDryRun = await buildBangumiMediaEntityImportDryRun(invalidPackage, passAudit(), {
    lookupEntity: async () => { throw new Error('should not query') },
  })

  assert.equal(invalidDryRun.meta.safety.payloadRead, false)
  assert.equal(invalidDryRun.skippedEntities[0].reason, 'package-source-invalid')
})

test('entity import dry-run can bypass audit check explicitly', async () => {
  const dryRun = await buildBangumiMediaEntityImportDryRun(packagePreview(), null, {
    requireAuditPass: false,
    lookupEntity: async () => [],
  })

  assert.equal(dryRun.meta.checks.auditCheck, 'audit-check-disabled')
  assert.equal(dryRun.meta.stats.resultsTotal, 2)
  assert.equal(dryRun.meta.stats.wouldCreateTotal, 2)
})

test('entity import dry-run report includes safety and result counts', async () => {
  const dryRun = await buildBangumiMediaEntityImportDryRun(packagePreview(), passAudit(), {
    lookupEntity: async () => [],
  })
  const report = createBangumiMediaEntityImportDryRunReport(dryRun, {
    inputPath: 'data_local/payload/bangumi-media-entity-seed-package-preview.json',
    auditPath: 'data_local/reports/bangumi-media-entity-seed-package-preview-audit.json',
  })

  assert.match(report, /# Bangumi media entity import dry-run/)
  assert.match(report, /Payload read\/query only/)
  assert.match(report, /No Payload create\/update\/delete/)
  assert.match(report, /wouldCreateTotal: 2/)
  assert.match(report, /## Results/)
})
