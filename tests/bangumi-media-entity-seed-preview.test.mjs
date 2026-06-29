import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiMediaEntitySeedPreview,
  createBangumiMediaEntitySeedPreviewReport,
} from '../tools/source_import/scripts/build-bangumi-media-entity-seed-preview.mjs'

function sampleWork(overrides = {}) {
  return {
    title: '样本漫画',
    slug: 'sample-manga',
    mediaGroup: 'manga',
    mediaType: 'manga',
    externalIds: { bangumiSubjectId: '1' },
    creatorCreditHints: [
      { name: 'Author A', role: 'original_creator', originalRole: '作者', note: 'Bangumi infobox: 作者' },
      { name: 'Artist B', role: 'art', originalRole: '作画', note: 'Bangumi infobox: 作画' },
    ],
    organizationCreditHints: [
      { name: 'Publisher C', role: 'publisher', originalRole: '出版社', note: 'Bangumi infobox: 出版社' },
    ],
    ...overrides,
  }
}

test('media entity seed preview groups creators and organizations', () => {
  const preview = buildBangumiMediaEntitySeedPreview([
    sampleWork(),
    sampleWork({
      title: '样本游戏',
      slug: 'sample-game',
      mediaGroup: 'game',
      mediaType: 'visual_novel',
      externalIds: { bangumiSubjectId: '2' },
      creatorCreditHints: [
        { name: 'Author A', role: 'script', originalRole: '剧本', note: 'Bangumi infobox: 剧本' },
      ],
      organizationCreditHints: [
        { name: 'Dev Studio', role: 'developer', originalRole: '开发', note: 'Bangumi infobox: 开发' },
      ],
    }),
  ], { generatedAt: '2026-06-29T00:00:00.000Z' })

  assert.equal(preview.meta.source, 'bangumi-media-entity-seed-preview')
  assert.equal(preview.meta.mode, 'preview-only-no-payload-write')
  assert.equal(preview.meta.safety.payloadWrite, false)
  assert.equal(preview.meta.safety.databaseWrite, false)
  assert.equal(preview.meta.safety.entityImport, false)
  assert.equal(preview.meta.safety.worksPatch, false)
  assert.equal(preview.meta.stats.candidateWorksTotal, 2)
  assert.equal(preview.meta.stats.creatorsTotal, 2)
  assert.equal(preview.meta.stats.organizationsTotal, 2)

  const author = preview.creators.find((seed) => seed.name === 'Author A')
  assert.ok(author)
  assert.equal(author.collection, 'creators')
  assert.deepEqual(author.roles, ['original_creator', 'script'])
  assert.equal(author.sourceWorks.length, 2)
  assert.equal(author.evidence.length, 2)

  const publisher = preview.organizations.find((seed) => seed.name === 'Publisher C')
  assert.ok(publisher)
  assert.equal(publisher.collection, 'organizations')
  assert.deepEqual(publisher.roles, ['publisher'])
})

test('media entity seed preview skips empty names and deduplicates repeated evidence', () => {
  const preview = buildBangumiMediaEntitySeedPreview([
    sampleWork({
      creatorCreditHints: [
        { name: '', role: 'script', originalRole: '剧本' },
        { name: 'Author A', role: 'script', originalRole: '剧本' },
        { name: 'Author A', role: 'script', originalRole: '剧本' },
      ],
      organizationCreditHints: [
        { name: 'Publisher C', role: 'publisher', originalRole: '出版社' },
        { name: 'Publisher C', role: 'publisher', originalRole: '出版社' },
      ],
    }),
  ])

  assert.equal(preview.creators.length, 1)
  assert.equal(preview.creators[0].evidence.length, 1)
  assert.equal(preview.organizations.length, 1)
  assert.equal(preview.organizations[0].evidence.length, 1)
})

test('media entity seed preview report includes safety and role counts', () => {
  const preview = buildBangumiMediaEntitySeedPreview([sampleWork()])
  const report = createBangumiMediaEntitySeedPreviewReport(preview)

  assert.match(report, /# Bangumi media entity seed preview/)
  assert.match(report, /No Payload connection/)
  assert.match(report, /No database writes/)
  assert.match(report, /No entity import/)
  assert.match(report, /original_creator: 1/)
  assert.match(report, /publisher: 1/)
})
