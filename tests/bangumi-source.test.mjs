import test from 'node:test'
import assert from 'node:assert/strict'

import { parseJsonl } from '../tools/source_import/lib/jsonl.mjs'
import {
  bangumiSubjectToCandidateInput,
  bangumiSubjectToRawSource,
  bangumiSubjectUrl,
  mapBangumiSubjectType,
} from '../tools/source_import/sources/bangumi.mjs'
import { normalizeBangumiSubjects } from '../tools/source_import/scripts/normalize-bangumi-subjects.mjs'

const fixtureText = `{"id":1001,"type":2,"name":"Sakura Trick","name_cn":"樱 Trick","date":"2014-01-10","infobox":[{"key":"话数","value":"12"}],"tags":[{"name":"百合","count":120},{"name":"校园","count":50}]}
{"id":1002,"type":1,"name":"Yagate Kimi ni Naru","name_cn":"终将成为你","date":"2015","infobox":[{"key":"类型","value":"漫画"}],"tags":[{"name":"百合","count":200},{"name":"漫画","count":100}]}
{"id":1003,"type":4,"name":"Sample Visual Novel","name_cn":"示例视觉小说","date":"2020-05","infobox":[{"key":"游戏类型","value":"视觉小说"}],"tags":[{"name":"visual novel","count":20}]}
`

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
})

test('Bangumi candidate input maps title, date label, external ID, and source link', () => {
  const subject = parseJsonl(fixtureText)[0]
  const candidate = bangumiSubjectToCandidateInput(subject)

  assert.equal(candidate.title, '樱 Trick')
  assert.equal(candidate.originalTitle, 'Sakura Trick')
  assert.equal(candidate.mediaType, 'anime')
  assert.equal(candidate.firstPublishedLabel, '2014-01-10')
  assert.deepEqual(candidate.externalIds, { bangumiSubjectId: '1001' })
  assert.equal(candidate.candidateSources[0].source, 'bangumi')
  assert.equal(candidate.candidateSources[0].url, 'https://bgm.tv/subject/1001')
})

test('Bangumi normalize CLI helper emits hidden draft candidates', () => {
  const records = parseJsonl(fixtureText)
  const candidates = normalizeBangumiSubjects(records, { fetchedAt: '2026-06-27T00:00:00.000Z' })

  assert.equal(candidates.length, 3)
  assert.equal(candidates[0].title, '樱 Trick')
  assert.equal(candidates[0].firstPublishedPrecision, 'day')
  assert.equal(candidates[1].firstPublishedPrecision, 'year')
  assert.equal(candidates[2].firstPublishedPrecision, 'month')
  assert.equal(candidates[0].rank, 'unknown')
  assert.equal(candidates[0].reviewStatus, 'pending')
  assert.equal(candidates[0].evidenceStrength, 'unassessed')
  assert.equal(candidates[0].status, 'draft')
  assert.equal(candidates[0].isLiteVisible, false)
  assert.equal(candidates[0].candidateSources[0].fetchedAt, '2026-06-27T00:00:00.000Z')
})
