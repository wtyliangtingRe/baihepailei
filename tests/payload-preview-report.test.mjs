import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createPayloadSeedPreviewReport,
  summarizePayloadSeed,
} from '../tools/source_import/scripts/report-payload-seed.mjs'

const seed = {
  works: [
    {
      title: '终将成为你',
      slug: 'bangumi-73577',
      mediaGroup: 'manga',
      mediaType: 'manga',
      firstPublishedLabel: '2015',
      localizedTitles: [
        { title: 'やがて君になる', language: 'ja', kind: 'original' },
        { title: 'Bloom Into You', language: 'en', kind: 'official' },
      ],
      candidateSources: [
        { source: 'bangumi', label: 'Bangumi', externalId: '73577' },
      ],
      externalCoverImages: [
        { source: 'bangumi', label: 'Bangumi cover common', size: 'common', url: 'https://example.invalid/common.jpg' },
        { source: 'bangumi', label: 'Bangumi cover large', size: 'large', url: 'https://example.invalid/large.jpg' },
      ],
      workGroup: { key: 'bloom-into-you', title: '终将成为你', source: 'manual', confidence: 'reviewed' },
      status: 'draft',
      isLiteVisible: false,
      isFullVisible: false,
    },
    {
      title: '终将成为你 动画',
      slug: 'bangumi-99999',
      mediaGroup: 'anime',
      mediaType: 'anime',
      firstPublishedLabel: '2018-10-05',
      localizedTitles: [],
      candidateSources: [
        { source: 'bangumi', label: 'Bangumi', externalId: '99999' },
      ],
      externalCoverImages: [],
      workGroup: { key: 'bloom-into-you', title: '终将成为你', source: 'manual', confidence: 'reviewed' },
      status: 'draft',
      isLiteVisible: false,
      isFullVisible: false,
    },
    {
      title: '示例游戏',
      slug: 'bangumi-1003',
      mediaGroup: 'game',
      mediaType: 'game',
      firstPublishedLabel: '2020-05',
      localizedTitles: [],
      candidateSources: [
        { source: 'bangumi', label: 'Bangumi', externalId: '1003' },
      ],
      externalCoverImages: [],
      status: 'draft',
      isLiteVisible: false,
      isFullVisible: false,
    },
  ],
}

test('payload seed preview summary counts works, visibility, media, sources, image metadata, and work groups', () => {
  const summary = summarizePayloadSeed(seed)

  assert.equal(summary.worksCount, 3)
  assert.equal(summary.draftCount, 3)
  assert.equal(summary.hiddenLiteCount, 3)
  assert.equal(summary.hiddenFullCount, 3)
  assert.equal(summary.localizedTitleCount, 2)
  assert.equal(summary.externalCoverImageCount, 2)
  assert.equal(summary.externalCoverWorkCount, 1)
  assert.equal(summary.multiWorkGroupCount, 1)
  assert.deepEqual(summary.workGroups.map((group) => [group.title, group.count]), [['终将成为你', 2]])
  assert.deepEqual(summary.mediaGroups, [['anime', 1], ['game', 1], ['manga', 1]])
  assert.deepEqual(summary.mediaTypes, [['anime', 1], ['game', 1], ['manga', 1]])
  assert.deepEqual(summary.sources, [['bangumi', 3]])
})

test('payload seed preview report includes overview, localized title preview, image metadata preview, work group preview, and hidden draft state', () => {
  const report = createPayloadSeedPreviewReport(seed, { inputPath: 'payload.json' })

  assert.match(report, /# Payload 候选导入预览/u)
  assert.match(report, /作品数：3/u)
  assert.match(report, /多译名条目数：2/u)
  assert.match(report, /外部封面候选数：2/u)
  assert.match(report, /带外部封面候选作品：1/u)
  assert.match(report, /多条目候选系列分组：1/u)
  assert.match(report, /候选系列分组/u)
  assert.match(report, /终将成为你 \| 2/u)
  assert.match(report, /bangumi-73577/u)
  assert.match(report, /终将成为你/u)
  assert.match(report, /やがて君になる \(ja\/original\)/u)
  assert.match(report, /Bloom Into You \(en\/official\)/u)
  assert.match(report, /Bangumi:73577/u)
  assert.match(report, /Bangumi cover common \+1/u)
  assert.match(report, /draft \/ lite-hidden \/ full-hidden/u)
})
