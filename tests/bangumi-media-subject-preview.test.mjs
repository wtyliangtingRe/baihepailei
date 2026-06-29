import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiMediaSubjectPreview,
  createBangumiMediaSubjectPreviewReport,
  createBangumiMediaSubjectSummary,
  parseBangumiMediaTypes,
} from '../tools/source_import/scripts/build-bangumi-media-subject-preview.mjs'

test('media parser maps book and game to Bangumi subject types', () => {
  assert.deepEqual(parseBangumiMediaTypes({ media: 'book,game' }), [1, 4])
  assert.deepEqual(parseBangumiMediaTypes({ media: 'book game' }), [1, 4])
  assert.deepEqual(parseBangumiMediaTypes({ media: 'manga light-novel games' }), [1, 4])
  assert.deepEqual(parseBangumiMediaTypes({ media: 'manga,light-novel,games' }), [1, 4])
  assert.deepEqual(parseBangumiMediaTypes({ types: '1,4' }), [1, 4])
  assert.deepEqual(parseBangumiMediaTypes({ types: '1 4' }), [1, 4])
})

test('subject summary keeps book/game metadata without Payload writes', () => {
  const summary = createBangumiMediaSubjectSummary({
    id: 123,
    type: 1,
    name: 'Yuri Book',
    name_cn: '百合书',
    date: '2020-01-01',
    score: 7.8,
    rank: 100,
    summary: 'A sample book subject.',
    images: {
      large: 'https://example.test/large.jpg',
      small: 'https://example.test/small.jpg',
    },
    tags: [
      { name: '百合', count: 20 },
      { name: '漫画', count: 10 },
    ],
    infobox: [
      { key: '作者', value: 'Example Author' },
      { key: '出版社', value: [{ v: 'Example Publisher' }] },
    ],
  })

  assert.equal(summary.bangumiSubjectId, '123')
  assert.equal(summary.typeName, 'book')
  assert.equal(summary.title, '百合书')
  assert.equal(summary.images.hasImages, true)
  assert.equal(summary.images.primary, 'large')
  assert.deepEqual(summary.tags.map((tag) => tag.name), ['百合', '漫画'])
  assert.deepEqual(summary.infobox, [
    { key: '作者', value: 'Example Author' },
    { key: '出版社', value: 'Example Publisher' },
  ])
})

test('preview metadata is explicitly preview-only and safe', () => {
  const preview = buildBangumiMediaSubjectPreview({
    searched: [{ id: 1 }, { id: 2 }],
    uniqueSubjects: [{ id: 1 }],
    detailedSubjects: [{ id: 1, type: 4, name: 'Game A' }],
    failedSubjects: [{ id: '2', title: 'Game B', error: 'boom' }],
    options: {
      generatedAt: '2026-06-29T00:00:00.000Z',
      tags: ['百合'],
      media: ['game'],
      types: [4],
      limit: 20,
      pages: 1,
      fetchDetails: true,
      includeRaw: false,
      transport: 'auto',
      searchTransport: 'powershell',
      detailTransport: 'powershell',
    },
  })

  assert.equal(preview.meta.source, 'bangumi-media-subject-preview')
  assert.equal(preview.meta.mode, 'preview-only-no-payload-write')
  assert.equal(preview.meta.requestedTransport, 'auto')
  assert.equal(preview.meta.searchTransport, 'powershell')
  assert.equal(preview.meta.detailTransport, 'powershell')
  assert.equal(preview.meta.searchedTotal, 2)
  assert.equal(preview.meta.uniqueSubjectsTotal, 1)
  assert.equal(preview.meta.subjectsTotal, 1)
  assert.equal(preview.meta.failedSubjectsTotal, 1)
  assert.equal(preview.meta.safety.payloadWrite, false)
  assert.equal(preview.meta.safety.databaseWrite, false)
  assert.equal(preview.meta.safety.worksPatch, false)
  assert.equal(preview.meta.safety.mediaUpload, false)
  assert.equal(preview.subjects[0].raw, undefined)
})

test('preview report includes safety summary, transport, and sample subjects', () => {
  const preview = buildBangumiMediaSubjectPreview({
    searched: [{ id: 1 }],
    uniqueSubjects: [{ id: 1 }],
    detailedSubjects: [{ id: 1, type: 1, name_cn: '样本书' }],
    options: {
      generatedAt: '2026-06-29T00:00:00.000Z',
      tags: ['百合'],
      media: ['book'],
      types: [1],
      includeRaw: false,
      transport: 'auto',
      searchTransport: 'powershell',
      detailTransport: 'not-used',
    },
  })

  const report = createBangumiMediaSubjectPreviewReport(preview)

  assert.match(report, /# Bangumi media subject preview/)
  assert.match(report, /No Payload connection/)
  assert.match(report, /No database writes/)
  assert.match(report, /searchTransport: powershell/)
  assert.match(report, /book #1: 样本书/)
})
