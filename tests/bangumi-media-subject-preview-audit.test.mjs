import test from 'node:test'
import assert from 'node:assert/strict'

import {
  auditBangumiMediaSubjectPreview,
  createBangumiMediaSubjectPreviewAuditReport,
} from '../tools/source_import/scripts/audit-bangumi-media-subject-preview.mjs'

function validPreview(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-media-subject-preview',
      mode: 'preview-only-no-payload-write',
      generatedAt: '2026-06-29T00:00:00.000Z',
      tags: ['百合'],
      media: ['book', 'game'],
      types: [1, 4],
      fetchDetails: true,
      includeRaw: true,
      requestedTransport: 'powershell',
      searchTransport: 'powershell',
      detailTransport: 'powershell',
      subjectsTotal: 2,
      failedSubjectsTotal: 0,
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        worksPatch: false,
        mediaUpload: false,
      },
      ...(overrides.meta || {}),
    },
    searchBatches: [
      { tag: '百合', type: 1, returned: 1, subjectIds: ['1'] },
      { tag: '百合', type: 4, returned: 1, subjectIds: ['2'] },
    ],
    subjects: [
      {
        id: '1',
        bangumiSubjectId: '1',
        type: 1,
        typeName: 'book',
        title: '样本书',
        images: { hasImages: true },
        tags: [{ name: '百合', count: 10 }],
        infobox: [{ key: '作者', value: 'Example Author' }],
        raw: { id: 1 },
      },
      {
        id: '2',
        bangumiSubjectId: '2',
        type: 4,
        typeName: 'game',
        title: '样本游戏',
        images: { hasImages: false },
        tags: [{ name: '百合', count: 8 }],
        infobox: [{ key: '开发', value: 'Example Dev' }],
        raw: { id: 2 },
      },
    ],
    failedSubjects: [],
    ...overrides,
  }
}

test('valid media subject preview audit passes', () => {
  const audit = auditBangumiMediaSubjectPreview(validPreview())

  assert.equal(audit.status, 'pass')
  assert.equal(audit.errors.length, 0)
  assert.equal(audit.stats.subjectsTotal, 2)
  assert.equal(audit.stats.rawSubjectsTotal, 2)
  assert.deepEqual(audit.stats.typeCounts, { book: 1, game: 1 })
})

test('audit fails unsafe source, mode, totals, duplicate ids, and invalid types', () => {
  const preview = validPreview({
    meta: {
      source: 'bad-source',
      mode: 'write-mode',
      subjectsTotal: 99,
      safety: {
        payloadWrite: true,
        databaseWrite: false,
        worksPatch: false,
        mediaUpload: false,
      },
    },
    subjects: [
      {
        id: '1',
        bangumiSubjectId: '1',
        type: 3,
        typeName: 'music',
        title: '',
        raw: {},
      },
      {
        id: '1',
        bangumiSubjectId: '1',
        type: 1,
        typeName: 'book',
        title: 'dup',
        raw: {},
      },
    ],
  })

  const audit = auditBangumiMediaSubjectPreview(preview)
  const codes = audit.errors.map((error) => error.code)

  assert.equal(audit.status, 'fail')
  assert.ok(codes.includes('unexpected-source'))
  assert.ok(codes.includes('unexpected-mode'))
  assert.ok(codes.includes('unsafe-flag'))
  assert.ok(codes.includes('subjects-total-mismatch'))
  assert.ok(codes.includes('duplicate-subject-id'))
  assert.ok(codes.includes('unexpected-subject-type'))
  assert.ok(codes.includes('unexpected-type-name'))
  assert.ok(audit.warnings.some((warning) => warning.code === 'missing-title'))
})

test('audit warns on failed subjects and missing raw details', () => {
  const preview = validPreview({
    meta: {
      failedSubjectsTotal: 1,
    },
    subjects: [
      {
        id: '1',
        bangumiSubjectId: '1',
        type: 1,
        typeName: 'book',
        title: '样本书',
      },
    ],
    failedSubjects: [{ id: '2', title: '失败项目', error: 'boom' }],
  })

  const audit = auditBangumiMediaSubjectPreview(preview)
  const warningCodes = audit.warnings.map((warning) => warning.code)

  assert.equal(audit.status, 'fail')
  assert.ok(audit.errors.some((error) => error.code === 'subjects-total-mismatch'))
  assert.ok(warningCodes.includes('failed-subjects-present'))
  assert.ok(warningCodes.includes('no-raw-subjects'))
})

test('audit report includes safety and issue sections', () => {
  const audit = auditBangumiMediaSubjectPreview(validPreview())
  const report = createBangumiMediaSubjectPreviewAuditReport(audit, {
    inputPath: 'data_local/payload/bangumi-media-subject-preview.json',
  })

  assert.match(report, /# Bangumi media subject preview audit/)
  assert.match(report, /status: pass/)
  assert.match(report, /No Payload connection/)
  assert.match(report, /No database writes/)
  assert.match(report, /book: 1/)
  assert.match(report, /game: 1/)
  assert.match(report, /## Errors/)
})
