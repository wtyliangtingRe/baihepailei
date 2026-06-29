import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyBangumiMediaEntityImport,
  createBangumiMediaEntityImportApplyReport,
} from '../tools/source_import/scripts/apply-bangumi-media-entity-import.mjs'

function entity(collection, overrides = {}) {
  const isCreator = collection === 'creators'
  return {
    collection,
    kind: isCreator ? 'creator' : 'organization',
    name: isCreator ? 'Author A' : 'Publisher B',
    slug: isCreator ? 'author-a' : 'publisher-b',
    status: 'draft',
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
    },
    creators: [entity('creators')],
    organizations: [entity('organizations')],
    ...overrides,
  }
}

function dryRun(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-media-entity-import-dry-run',
      mode: 'dry-run-payload-read-no-write',
      stats: {
        queryErrorsTotal: 0,
        skippedEntitiesTotal: 0,
        ambiguousExistingTotal: 0,
      },
    },
    results: [
      { collection: 'creators', name: 'Author A', slug: 'author-a', status: 'would-create' },
      { collection: 'organizations', name: 'Publisher B', slug: 'publisher-b', status: 'would-create' },
    ],
    ...overrides,
  }
}

test('guarded apply does not write without apply flag and confirm token', async () => {
  let writes = 0
  const result = await applyBangumiMediaEntityImport(packagePreview(), dryRun(), {
    createEntity: async () => {
      writes += 1
      return {}
    },
  })

  assert.equal(writes, 0)
  assert.equal(result.meta.mode, 'guarded-apply-preview-no-payload-write')
  assert.equal(result.meta.safety.payloadWrite, false)
  assert.equal(result.meta.stats.attemptedWrites, 0)
  assert.equal(result.meta.stats.appliedTotal, 0)
  assert.equal(result.meta.stats.skippedTotal, 2)
  assert.ok(result.skipped.every((row) => row.reason === 'apply-flag-missing'))
})

test('guarded apply writes only would-create rows after explicit confirmation', async () => {
  const created = []
  const result = await applyBangumiMediaEntityImport(packagePreview(), dryRun(), {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_ENTITIES',
    createEntity: async (row) => {
      created.push(row.name)
      return { id: `${row.collection}-${created.length}`, name: row.name, slug: row.slug, status: 'draft' }
    },
  })

  assert.deepEqual(created, ['Author A', 'Publisher B'])
  assert.equal(result.meta.mode, 'apply-guarded-payload-write')
  assert.equal(result.meta.safety.payloadWrite, true)
  assert.equal(result.meta.safety.databaseWrite, true)
  assert.equal(result.meta.safety.entityImport, true)
  assert.equal(result.meta.safety.worksPatch, false)
  assert.equal(result.meta.stats.attemptedWrites, 2)
  assert.equal(result.meta.stats.appliedTotal, 2)
  assert.equal(result.meta.stats.errorsTotal, 0)
})

test('guarded apply respects limit and skips non-create dry-run rows', async () => {
  const result = await applyBangumiMediaEntityImport(packagePreview(), dryRun({
    results: [
      { collection: 'creators', name: 'Author A', slug: 'author-a', status: 'would-create' },
      { collection: 'organizations', name: 'Publisher B', slug: 'publisher-b', status: 'already-exists' },
    ],
  }), {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_ENTITIES',
    limit: 1,
    createEntity: async (row) => ({ id: `${row.collection}-1`, name: row.name, slug: row.slug }),
  })

  assert.equal(result.meta.stats.attemptedWrites, 1)
  assert.equal(result.meta.stats.appliedTotal, 1)
  assert.equal(result.meta.stats.skippedTotal, 1)
  assert.equal(result.skipped[0].reason, 'dry-run-status-already-exists')
})

test('guarded apply blocks invalid package and invalid dry-run before writes', async () => {
  let writes = 0
  const invalidPackage = packagePreview({ meta: { source: 'wrong', mode: 'wrong' } })
  const packageResult = await applyBangumiMediaEntityImport(invalidPackage, dryRun(), {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_ENTITIES',
    createEntity: async () => {
      writes += 1
      return {}
    },
  })

  assert.equal(writes, 0)
  assert.equal(packageResult.meta.stats.appliedTotal, 0)
  assert.ok(packageResult.skipped.every((row) => row.reason === 'package-source-invalid'))

  const invalidDryRun = dryRun({ meta: { source: 'bangumi-media-entity-import-dry-run', mode: 'dry-run-payload-read-no-write', stats: { queryErrorsTotal: 1 } } })
  const dryRunResult = await applyBangumiMediaEntityImport(packagePreview(), invalidDryRun, {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_ENTITIES',
    createEntity: async () => {
      writes += 1
      return {}
    },
  })

  assert.equal(writes, 0)
  assert.equal(dryRunResult.meta.stats.appliedTotal, 0)
  assert.ok(dryRunResult.skipped.every((row) => row.reason === 'dry-run-has-query-errors'))
})

test('guarded apply records create errors and report includes safety', async () => {
  const result = await applyBangumiMediaEntityImport(packagePreview(), dryRun(), {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_ENTITIES',
    createEntity: async (row) => {
      if (row.collection === 'creators') throw new Error('create failed')
      return { id: 'org-1', name: row.name, slug: row.slug }
    },
  })
  const report = createBangumiMediaEntityImportApplyReport(result)

  assert.equal(result.meta.stats.attemptedWrites, 2)
  assert.equal(result.meta.stats.appliedTotal, 1)
  assert.equal(result.meta.stats.errorsTotal, 1)
  assert.match(report, /# Bangumi media entity import apply/)
  assert.match(report, /Without `--apply --confirm APPLY_BANGUMI_MEDIA_ENTITIES`/)
  assert.match(report, /No works patch/)
  assert.match(report, /create failed/)
})
