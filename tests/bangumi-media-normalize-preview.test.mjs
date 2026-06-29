import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiMediaNormalizePreview,
  createBangumiMediaNormalizePreviewReport,
} from '../tools/source_import/scripts/build-bangumi-media-normalize-preview.mjs'

function validAudit() {
  return {
    source: 'bangumi-media-subject-preview-audit',
    mode: 'audit-only-no-payload-write',
    status: 'pass',
  }
}

function validPreview() {
  return {
    meta: {
      source: 'bangumi-media-subject-preview',
      mode: 'preview-only-no-payload-write',
      generatedAt: '2026-06-29T00:00:00.000Z',
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        worksPatch: false,
        mediaUpload: false,
      },
    },
    subjects: [
      {
        id: '1',
        bangumiSubjectId: '1',
        type: 1,
        typeName: 'book',
        title: '样本漫画',
        raw: {
          id: 1,
          type: 1,
          name: 'Sample Manga',
          name_cn: '样本漫画',
          date: '2020-01-01',
          summary: 'A sample manga.',
          images: {
            common: 'https://example.test/common.jpg',
          },
          tags: [
            { name: '百合', count: 20 },
            { name: '漫画', count: 10 },
          ],
          infobox: [
            { key: '作者', value: 'Example Author' },
            { key: '出版社', value: 'Example Publisher' },
          ],
        },
      },
      {
        id: '2',
        bangumiSubjectId: '2',
        type: 4,
        typeName: 'game',
        title: '样本游戏',
        raw: {
          id: 2,
          type: 4,
          name: 'Sample Game',
          name_cn: '样本游戏',
          date: '2021-02-03',
          summary: 'A sample game.',
          images: {
            large: 'https://example.test/large.jpg',
          },
          tags: [
            { name: '百合', count: 30 },
            { name: '视觉小说', count: 10 },
          ],
          infobox: [
            { key: '游戏类型', value: 'visual novel' },
            { key: '开发', value: 'Example Dev' },
          ],
        },
      },
    ],
  }
}

test('normalize preview converts media subjects into candidate works', () => {
  const result = buildBangumiMediaNormalizePreview(validPreview(), validAudit(), {
    generatedAt: '2026-06-29T01:00:00.000Z',
  })

  assert.equal(result.meta.source, 'bangumi-media-normalize-preview')
  assert.equal(result.meta.mode, 'normalize-preview-only-no-payload-write')
  assert.equal(result.meta.input.auditStatus, 'pass')
  assert.equal(result.meta.safety.payloadWrite, false)
  assert.equal(result.meta.safety.databaseWrite, false)
  assert.equal(result.meta.safety.worksPatch, false)
  assert.equal(result.meta.safety.mediaUpload, false)
  assert.equal(result.candidates.length, 2)
  assert.equal(result.skippedSubjects.length, 0)
  assert.equal(result.duplicateSubjects.length, 0)

  const [book, game] = result.candidates
  assert.equal(book.title, '样本漫画')
  assert.equal(book.externalIds.bangumiSubjectId, '1')
  assert.equal(book.mediaType, 'manga')
  assert.equal(book.format, 'manga_series')
  assert.equal(book.candidateSources[0].source, 'bangumi')
  assert.equal(book.candidateSources[0].fetchedAt, '2026-06-29T00:00:00.000Z')
  assert.ok(book.externalCoverImages.length > 0)
  assert.ok(book.creatorCreditHints.length > 0)
  assert.ok(book.organizationCreditHints.length > 0)

  assert.equal(game.mediaType, 'visual_novel')
  assert.equal(game.format, 'visual_novel')
  assert.equal(game.externalIds.bangumiSubjectId, '2')
})

test('normalize preview requires pass audit by default', () => {
  assert.throws(
    () => buildBangumiMediaNormalizePreview(validPreview(), { status: 'fail' }),
    /Preview audit status must be pass/u,
  )
})

test('normalize preview can skip missing raw subjects when audit is not required', () => {
  const preview = validPreview()
  preview.subjects.push({ id: '3', bangumiSubjectId: '3', type: 1, typeName: 'book', title: '' })

  const result = buildBangumiMediaNormalizePreview(preview, null, {
    requireAuditPass: false,
  })

  assert.equal(result.candidates.length, 2)
  assert.equal(result.skippedSubjects.length, 1)
  assert.equal(result.skippedSubjects[0].reason, 'missing-title')
})

test('normalize preview skips duplicate subjects', () => {
  const preview = validPreview()
  preview.subjects.push(preview.subjects[0])

  const result = buildBangumiMediaNormalizePreview(preview, validAudit())

  assert.equal(result.candidates.length, 2)
  assert.equal(result.duplicateSubjects.length, 1)
  assert.equal(result.meta.stats.duplicateSubjectsTotal, 1)
})

test('normalize preview report includes safety and stats', () => {
  const result = buildBangumiMediaNormalizePreview(validPreview(), validAudit(), {
    generatedAt: '2026-06-29T01:00:00.000Z',
  })
  const report = createBangumiMediaNormalizePreviewReport(result)

  assert.match(report, /# Bangumi media normalize preview/)
  assert.match(report, /No Payload connection/)
  assert.match(report, /No database writes/)
  assert.match(report, /candidatesTotal: 2/)
  assert.match(report, /manga: 1/)
  assert.match(report, /visual_novel: 1/)
})
