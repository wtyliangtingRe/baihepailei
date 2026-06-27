import test from 'node:test'
import assert from 'node:assert/strict'

import {
  candidateWorkLookupPlan,
  cleanDoc,
  collectionsForSeed,
} from '../scripts/import/direct-seed-clean-data.mjs'

test('candidate work seed can contain only works collection', () => {
  const collections = collectionsForSeed({ works: [] })

  assert.deepEqual(collections, ['works'])
})

test('collections can be explicitly limited to works', () => {
  const collections = collectionsForSeed({ works: [], rules: [] }, 'works')

  assert.deepEqual(collections, ['works'])
})

test('candidate work cleaning preserves draft candidate fields', () => {
  const doc = cleanDoc('works', {
    siteId: 'work-000123',
    title: '终将成为你',
    slug: 'yagate-kimi-ni-naru',
    rank: 'unknown',
    reviewStatus: 'pending',
    evidenceStrength: 'unassessed',
    originalTitle: 'やがて君になる',
    aliases: [{ value: 'Bloom Into You' }],
    localizedTitles: [
      { title: '終將成為妳', language: 'zh-Hant', region: 'TW', kind: 'localized' },
      { title: 'Bloom Into You', language: 'en', region: 'US', kind: 'official' },
    ],
    mediaType: 'manga',
    format: 'manga_series',
    firstPublishedAt: '2015-04-01',
    firstPublishedPrecision: 'month',
    firstPublishedLabel: '2015-04',
    externalIds: { bangumiSubjectId: '1001' },
    candidateSources: [{ source: 'bangumi', label: 'Bangumi', externalId: '1001', url: 'https://bgm.tv/subject/1001', note: 'Bangumi 标签搜索命中：百合' }],
    yuriCandidateScore: 0.5,
    isLiteVisible: false,
    isFullVisible: false,
    hasEvidence: false,
    status: 'draft',
  })

  assert.equal(doc.siteId, 'work-000123')
  assert.equal(doc.rank, 'unknown')
  assert.equal(doc.reviewStatus, 'pending')
  assert.equal(doc.evidenceStrength, 'unassessed')
  assert.equal(doc.mediaGroup, 'manga')
  assert.equal(doc.mediaType, 'manga')
  assert.equal(doc.format, 'manga_series')
  assert.equal(doc.localizedTitles.length, 2)
  assert.equal(doc.firstPublishedLabel, '2015-04')
  assert.equal(doc.externalIds.bangumiSubjectId, '1001')
  assert.equal(doc.candidateSources[0].source, 'bangumi')
  assert.equal(doc.yuriCandidateScore, 0.5)
  assert.equal(doc.isLiteVisible, false)
  assert.equal(doc.isFullVisible, false)
  assert.equal(doc.status, 'draft')
  assert.match(doc.searchText, /Bangumi/u)
  assert.match(doc.searchText, /終將成為妳/u)
  assert.match(doc.searchText, /Bloom Into You/u)
})

test('candidate work lookup plan uses stable match priority', () => {
  const plan = candidateWorkLookupPlan({
    siteId: 'work-000123',
    slug: 'yagate-kimi-ni-naru',
    title: '终将成为你',
    mediaType: 'manga',
    firstPublishedLabel: '2015-04',
    externalIds: {
      bangumiSubjectId: '1001',
      wikidataQid: 'Q123',
    },
  })

  assert.deepEqual(plan.map((item) => item.type), [
    'siteId',
    'externalId',
    'externalId',
    'slug',
    'titleMediaDate',
  ])
  assert.equal(plan[0].field, 'siteId')
  assert.equal(plan[1].field, 'externalIds.bangumiSubjectId')
  assert.equal(plan[2].field, 'externalIds.wikidataQid')
})

test('candidate work cleaning derives sourceLinks from candidateSources', () => {
  const doc = cleanDoc('works', {
    title: '作品A',
    slug: 'work-a',
    mediaType: 'anime',
    candidateSources: [{ source: 'bangumi', label: 'Bangumi', externalId: '1', url: 'https://bgm.tv/subject/1' }],
    isLiteVisible: false,
    isFullVisible: false,
  })

  assert.deepEqual(doc.sourceLinks, [{ label: 'Bangumi', url: 'https://bgm.tv/subject/1' }])
})

test('creator and organization cleaning include localized names in search text', () => {
  const creator = cleanDoc('creators', {
    name: '仲谷鳰',
    slug: 'nakatani-nio',
    localizedNames: [{ name: 'Nakatani Nio', language: 'en', kind: 'romanized' }],
  })
  const organization = cleanDoc('organizations', {
    name: '芳文社',
    slug: 'houbunsha',
    type: 'publisher',
    localizedNames: [{ name: 'Houbunsha', language: 'en', kind: 'romanized' }],
  })

  assert.equal(creator.localizedNames[0].name, 'Nakatani Nio')
  assert.match(creator.searchText, /Nakatani Nio/u)
  assert.equal(organization.localizedNames[0].name, 'Houbunsha')
  assert.match(organization.searchText, /Houbunsha/u)
})
