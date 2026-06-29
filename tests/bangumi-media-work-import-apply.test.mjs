import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiMediaWorkImportApply,
  buildWorkCreatePayload,
  createBangumiMediaWorkImportApplyReport,
} from '../tools/source_import/scripts/apply-bangumi-media-work-import.mjs'

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
    aliases: ['Sample Manga'],
    creatorCreditHints: [{ name: '作者A', role: 'original_creator', originalRole: '作者' }],
    organizationCreditHints: [{ name: '出版社B', role: 'publisher', originalRole: '出版社' }],
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

function dryRun(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-media-work-import-dry-run',
      mode: 'dry-run-payload-read-no-write',
      stats: {
        queryErrorsTotal: 0,
        skippedWorksTotal: 0,
        ambiguousExistingTotal: 0,
      },
    },
    results: [
      { title: '样本漫画', slug: 'sample-manga', bangumiSubjectId: '1001', status: 'would-create' },
      { title: '样本游戏', slug: 'sample-game', bangumiSubjectId: '2001', status: 'would-create' },
    ],
    ...overrides,
  }
}

test('work create payload maps safe fields only', () => {
  const payload = buildWorkCreatePayload(work())

  assert.equal(payload.title, '样本漫画')
  assert.equal(payload.slug, 'sample-manga')
  assert.equal(payload.siteId, 'bangumi-1001')
  assert.equal(payload.status, 'draft')
  assert.equal(payload.mediaGroup, 'manga')
  assert.equal(payload.mediaType, 'manga')
  assert.equal(payload.externalIds.bangumiSubjectId, '1001')
  assert.deepEqual(payload.aliases, [{ value: 'Sample Manga' }])
  assert.equal(payload.candidateSources[0].source, 'bangumi')
  assert.equal(payload.candidateSources[0].externalId, '1001')
  assert.equal(payload.sourceLinks[0].url, 'https://bgm.tv/subject/1001')
  assert.match(payload.searchText, /作者A/)
  assert.match(payload.evidenceNote, /Bangumi media work seed import/)
  assert.equal(payload.creators, undefined)
  assert.equal(payload.creatorCredits, undefined)
  assert.equal(payload.organizations, undefined)
  assert.equal(payload.cover, undefined)
  assert.equal(payload.summary, undefined)
})

test('guarded work apply preview does not write without apply flag', async () => {
  let writes = 0
  const result = await buildBangumiMediaWorkImportApply(packagePreview(), dryRun(), {
    createWork: async () => {
      writes += 1
      throw new Error('should not write')
    },
  })

  assert.equal(writes, 0)
  assert.equal(result.meta.source, 'bangumi-media-work-import-apply')
  assert.equal(result.meta.mode, 'guarded-apply-preview-no-payload-write')
  assert.equal(result.meta.safety.payloadWrite, false)
  assert.equal(result.meta.safety.databaseWrite, false)
  assert.equal(result.meta.stats.attemptedWrites, 0)
  assert.equal(result.meta.stats.appliedTotal, 0)
  assert.equal(result.meta.stats.skippedTotal, 2)
  assert.equal(result.results[0].reason, 'apply-flag-missing')
})

test('guarded work apply requires confirmation token', async () => {
  let writes = 0
  const result = await buildBangumiMediaWorkImportApply(packagePreview(), dryRun(), {
    apply: true,
    confirm: 'WRONG',
    createWork: async () => {
      writes += 1
      throw new Error('should not write')
    },
  })

  assert.equal(writes, 0)
  assert.equal(result.meta.mode, 'guarded-apply-preview-no-payload-write')
  assert.equal(result.meta.confirmToken, 'missing-or-invalid')
  assert.equal(result.meta.stats.skippedTotal, 2)
  assert.equal(result.results[0].reason, 'confirm-token-missing-or-invalid')
})

test('guarded work apply writes only would-create rows after confirmation', async () => {
  const localDryRun = dryRun({
    results: [
      { title: '样本漫画', slug: 'sample-manga', bangumiSubjectId: '1001', status: 'would-create' },
      { title: '样本游戏', slug: 'sample-game', bangumiSubjectId: '2001', status: 'already-exists' },
    ],
  })
  const writes = []
  const result = await buildBangumiMediaWorkImportApply(packagePreview(), localDryRun, {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_WORKS',
    createWork: async (row) => {
      writes.push(row.slug)
      return { id: `created-${row.slug}`, title: row.title, slug: row.slug, siteId: `bangumi-${row.bangumiSubjectId}`, status: 'draft' }
    },
  })

  assert.deepEqual(writes, ['sample-manga'])
  assert.equal(result.meta.mode, 'apply-guarded-payload-write')
  assert.equal(result.meta.safety.payloadWrite, true)
  assert.equal(result.meta.stats.attemptedWrites, 1)
  assert.equal(result.meta.stats.appliedTotal, 1)
  assert.equal(result.meta.stats.skippedTotal, 1)
  assert.equal(result.results[0].status, 'applied')
  assert.equal(result.results[1].reason, 'dry-run-status-already-exists')
})

test('guarded work apply blocks invalid package or dry-run', async () => {
  const invalidPackage = packagePreview({ meta: { source: 'wrong', mode: 'wrong' } })
  const packageResult = await buildBangumiMediaWorkImportApply(invalidPackage, dryRun(), {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_WORKS',
    createWork: async () => { throw new Error('should not write') },
  })

  assert.equal(packageResult.meta.safety.payloadWrite, false)
  assert.equal(packageResult.meta.checks.packageCheck, 'package-source-invalid')
  assert.equal(packageResult.meta.stats.skippedTotal, 2)

  const invalidDryRun = dryRun({ meta: { source: 'bangumi-media-work-import-dry-run', mode: 'dry-run-payload-read-no-write', stats: { queryErrorsTotal: 1, skippedWorksTotal: 0, ambiguousExistingTotal: 0 } } })
  const dryResult = await buildBangumiMediaWorkImportApply(packagePreview(), invalidDryRun, {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_WORKS',
    createWork: async () => { throw new Error('should not write') },
  })

  assert.equal(dryResult.meta.safety.payloadWrite, false)
  assert.equal(dryResult.meta.checks.dryRunCheck, 'dry-run-has-query-errors')
  assert.equal(dryResult.meta.stats.skippedTotal, 2)
})

test('guarded work apply records create errors', async () => {
  const result = await buildBangumiMediaWorkImportApply(packagePreview({ works: [work()] }), dryRun({ results: [{ title: '样本漫画', slug: 'sample-manga', bangumiSubjectId: '1001', status: 'would-create' }] }), {
    apply: true,
    confirm: 'APPLY_BANGUMI_MEDIA_WORKS',
    createWork: async () => {
      throw new Error('create failed')
    },
  })

  assert.equal(result.meta.stats.attemptedWrites, 1)
  assert.equal(result.meta.stats.appliedTotal, 0)
  assert.equal(result.meta.stats.errorsTotal, 1)
  assert.equal(result.errors[0].error, 'create failed')
})

test('guarded work apply report includes safety and counts', async () => {
  const result = await buildBangumiMediaWorkImportApply(packagePreview(), dryRun())
  const report = createBangumiMediaWorkImportApplyReport(result, {
    inputPath: 'data_local/payload/bangumi-media-work-package-preview.json',
    dryRunPath: 'data_local/payload/bangumi-media-work-import-dry-run.json',
  })

  assert.match(report, /# Bangumi media work import apply/)
  assert.match(report, /Payload write: no/)
  assert.match(report, /Only dry-run `would-create` rows are eligible/)
  assert.match(report, /attemptedWrites: 0/)
  assert.match(report, /skippedTotal: 2/)
})
