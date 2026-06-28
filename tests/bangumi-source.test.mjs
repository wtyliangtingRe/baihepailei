import test from 'node:test'
import assert from 'node:assert/strict'

import { parseJsonl } from '../tools/source_import/lib/jsonl.mjs'
import {
  bangumiSubjectCreatorCreditHints,
  bangumiSubjectExternalCoverImages,
  bangumiSubjectLocalizedTitles,
  bangumiSubjectOrganizationCreditHints,
  bangumiSubjectSummaryText,
  bangumiSubjectToCandidateInput,
  bangumiSubjectToRawSource,
  bangumiSubjectUrl,
  mapBangumiSubjectType,
} from '../tools/source_import/sources/bangumi.mjs'
import { normalizeBangumiSubjects } from '../tools/source_import/scripts/normalize-bangumi-subjects.mjs'

const fixtureRecords = [
  {
    id: 1001,
    type: 2,
    name: 'Sakura Trick',
    name_cn: '樱 Trick',
    date: '2014-01-10',
    summary: '这是 Bangumi 简介。\n\n第二段用于后台候选复核。',
    images: {
      common: 'https://lain.bgm.tv/r/400/pic/cover/l/sample.jpg',
      large: 'https://lain.bgm.tv/pic/cover/l/sample.jpg',
    },
    infobox: [
      { key: '话数', value: '12' },
      { key: '别名', value: [{ v: '樱花 Trick' }, { v: '桜Trick' }] },
      { key: '監督', value: '大沼心' },
      { key: 'シリーズ構成', value: '高山カツヒコ' },
      { key: '脚本', value: [{ v: '高山カツヒコ' }, { v: '綾奈ゆにこ' }] },
      { key: '製作', value: 'citrus製作委員会（一迅社、bilibili、Crunchyroll、ランティス）' },
      { key: 'アニメーション制作', value: 'パッショーネ' },
      { key: '放送局', value: 'AT-X / TOKYO MX' },
    ],
    tags: [{ name: '百合', count: 120 }, { name: '校园', count: 50 }],
  },
  {
    id: 1002,
    type: 1,
    name: 'Yagate Kimi ni Naru',
    name_cn: '终将成为你',
    date: '2015',
    infobox: [{ key: '类型', value: '漫画' }, { key: '英文名', value: 'Bloom Into You' }],
    tags: [{ name: '百合', count: 200 }, { name: '漫画', count: 100 }],
  },
  {
    id: 1003,
    type: 4,
    name: 'Sample Visual Novel',
    name_cn: '示例视觉小说',
    date: '2020-05',
    infobox: [{ key: '游戏类型', value: '视觉小说' }],
    tags: [{ name: 'visual novel', count: 20 }],
  },
]

const fixtureText = `${fixtureRecords.map((record) => JSON.stringify(record)).join('\n')}\n`

test('Bangumi subject URL helper builds stable subject links', () => {
  assert.equal(bangumiSubjectUrl(1001), 'https://bgm.tv/subject/1001')
})

test('Bangumi type mapper maps broad subject types and book/game subtypes', () => {
  const records = parseJsonl(fixtureText)

  assert.deepEqual(mapBangumiSubjectType(records[0]), { mediaType: 'anime', format: 'unknown' })
  assert.deepEqual(mapBangumiSubjectType(records[1]), { mediaType: 'manga', format: 'manga_series' })
  assert.deepEqual(mapBangumiSubjectType(records[2]), { mediaType: 'visual_novel', format: 'visual_novel' })
})

test('Bangumi raw source wrapper keeps raw subject metadata only', () => {
  const subject = parseJsonl(fixtureText)[0]
  const rawSource = bangumiSubjectToRawSource(subject, { fetchedAt: '2026-06-27T00:00:00.000Z' })

  assert.equal(rawSource.source, 'bangumi')
  assert.equal(rawSource.sourceRecordId, '1001')
  assert.equal(rawSource.sourceUrl, 'https://bgm.tv/subject/1001')
  assert.equal(rawSource.fetchedAt, '2026-06-27T00:00:00.000Z')
  assert.equal(rawSource.raw.name_cn, '樱 Trick')
  assert.equal(rawSource.raw.images.common, 'https://lain.bgm.tv/r/400/pic/cover/l/sample.jpg')
})

test('Bangumi localized titles include Chinese title, original title, and infobox aliases', () => {
  const subject = parseJsonl(fixtureText)[0]
  const titles = bangumiSubjectLocalizedTitles(subject)

  assert.ok(titles.some((title) => title.title === '樱 Trick' && title.language === 'zh-Hans' && title.kind === 'localized'))
  assert.ok(titles.some((title) => title.title === 'Sakura Trick' && title.kind === 'original'))
  assert.ok(titles.some((title) => title.title === '樱花 Trick' && title.kind === 'alias'))
  assert.ok(titles.some((title) => title.title === '桜Trick' && title.kind === 'alias'))
})

test('Bangumi external cover helper keeps cover URLs as metadata', () => {
  const subject = parseJsonl(fixtureText)[0]
  const covers = bangumiSubjectExternalCoverImages(subject)

  assert.equal(covers.length, 2)
  assert.equal(covers[0].source, 'bangumi')
  assert.equal(covers[0].size, 'common')
  assert.equal(covers[0].url, 'https://lain.bgm.tv/r/400/pic/cover/l/sample.jpg')
  assert.equal(covers[0].usage, 'candidate_reference')
})

test('Bangumi enrichment helpers extract summaries, creator credits, and organization hints', () => {
  const subject = parseJsonl(fixtureText)[0]
  const creatorCredits = bangumiSubjectCreatorCreditHints(subject)
  const organizationCredits = bangumiSubjectOrganizationCreditHints(subject)

  assert.equal(bangumiSubjectSummaryText(subject), '这是 Bangumi 简介。\n\n第二段用于后台候选复核。')
  assert.ok(creatorCredits.some((credit) => credit.name === '大沼心' && credit.role === 'director' && credit.originalRole === '監督'))
  assert.ok(creatorCredits.some((credit) => credit.name === '高山カツヒコ' && credit.role === 'series_composition'))
  assert.ok(creatorCredits.some((credit) => credit.name === '綾奈ゆにこ' && credit.role === 'script'))
  assert.ok(organizationCredits.some((credit) => credit.name === 'citrus製作委員会' && credit.role === 'committee'))
  assert.ok(organizationCredits.some((credit) => credit.name === '一迅社' && credit.role === 'committee_member'))
  assert.ok(organizationCredits.some((credit) => credit.name === 'bilibili' && credit.role === 'committee_member'))
  assert.ok(organizationCredits.some((credit) => credit.name === 'パッショーネ' && credit.role === 'animation_studio'))
  assert.ok(organizationCredits.some((credit) => credit.name === 'AT-X' && credit.role === 'broadcaster'))
})

test('Bangumi candidate input maps title, date label, external ID, source link, localized metadata, and cover metadata', () => {
  const subject = parseJsonl(fixtureText)[0]
  const candidate = bangumiSubjectToCandidateInput(subject)

  assert.equal(candidate.title, '樱 Trick')
  assert.equal(candidate.originalTitle, 'Sakura Trick')
  assert.equal(candidate.mediaGroup, 'anime')
  assert.equal(candidate.mediaType, 'anime')
  assert.equal(candidate.firstPublishedLabel, '2014-01-10')
  assert.deepEqual(candidate.externalIds, { bangumiSubjectId: '1001' })
  assert.equal(candidate.candidateSources[0].source, 'bangumi')
  assert.equal(candidate.candidateSources[0].url, 'https://bgm.tv/subject/1001')
  assert.ok(candidate.aliases.includes('樱花 Trick'))
  assert.ok(candidate.localizedTitles.some((title) => title.title === '桜Trick' && title.kind === 'alias'))
  assert.equal(candidate.externalCoverImages[0].url, 'https://lain.bgm.tv/r/400/pic/cover/l/sample.jpg')
  assert.match(candidate.summaryText, /后台候选复核/u)
  assert.ok(candidate.creatorCreditHints.some((credit) => credit.name === '大沼心' && credit.role === 'director'))
  assert.ok(candidate.organizationCreditHints.some((credit) => credit.name === 'Crunchyroll' && credit.role === 'committee_member'))
})

test('Bangumi normalize CLI helper emits hidden draft candidates with media group and localized titles', () => {
  const records = parseJsonl(fixtureText)
  const candidates = normalizeBangumiSubjects(records, { fetchedAt: '2026-06-27T00:00:00.000Z' })

  assert.equal(candidates.length, 3)
  assert.equal(candidates[0].title, '樱 Trick')
  assert.equal(candidates[0].mediaGroup, 'anime')
  assert.equal(candidates[1].mediaGroup, 'manga')
  assert.equal(candidates[2].mediaGroup, 'game')
  assert.equal(candidates[0].localizedTitles.length > 0, true)
  assert.equal(candidates[0].externalCoverImages.length, 2)
  assert.equal(candidates[0].firstPublishedPrecision, 'day')
  assert.equal(candidates[1].firstPublishedPrecision, 'year')
  assert.equal(candidates[2].firstPublishedPrecision, 'month')
  assert.equal(candidates[0].summaryText.includes('Bangumi 简介'), true)
  assert.equal(candidates[0].creatorCreditHints.length > 0, true)
  assert.equal(candidates[0].organizationCreditHints.length > 0, true)
  assert.equal(candidates[0].rank, 'unknown')
  assert.equal(candidates[0].reviewStatus, 'pending')
  assert.equal(candidates[0].evidenceStrength, 'unassessed')
  assert.equal(candidates[0].status, 'draft')
  assert.equal(candidates[0].isLiteVisible, false)
  assert.equal(candidates[0].candidateSources[0].fetchedAt, '2026-06-27T00:00:00.000Z')
})
