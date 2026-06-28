import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDateWithPrecision } from '../tools/source_import/lib/date-precision.mjs'
import { parseJsonl, stringifyJsonl } from '../tools/source_import/lib/jsonl.mjs'
import { compareWorkCandidates } from '../tools/source_import/lib/match-work.mjs'
import { createRawSourceRecord, sourceRecordToCandidateWork } from '../tools/source_import/lib/source-record.mjs'
import { slugify, uniqueSlug } from '../tools/source_import/lib/slug.mjs'
import { dedupeCandidates, uniqueCandidateSources } from '../tools/source_import/scripts/dedupe-candidates.mjs'
import { normalizeCandidateRecords } from '../tools/source_import/scripts/normalize-candidates.mjs'
import { candidateSlugBase, toPayloadSeed } from '../tools/source_import/scripts/to-payload-seed.mjs'


test('JSONL helpers parse and stringify records', () => {
  const records = parseJsonl('{"a":1}\n\n{"b":2}\n')

  assert.deepEqual(records, [{ a: 1 }, { b: 2 }])
  assert.equal(stringifyJsonl(records), '{"a":1}\n{"b":2}\n')
})

test('JSONL parser accepts a UTF-8 BOM on the first line', () => {
  const records = parseJsonl('\uFEFF{"a":1}\n{"b":2}\n')

  assert.deepEqual(records, [{ a: 1 }, { b: 2 }])
})

test('date precision helper handles year, month, day, and unknown labels', () => {
  assert.deepEqual(parseDateWithPrecision('2015'), {
    date: '2015-01-01',
    precision: 'year',
    label: '2015',
  })
  assert.deepEqual(parseDateWithPrecision('2015-04'), {
    date: '2015-04-01',
    precision: 'month',
    label: '2015-04',
  })
  assert.deepEqual(parseDateWithPrecision('2018-10-05'), {
    date: '2018-10-05',
    precision: 'day',
    label: '2018-10-05',
  })
  assert.deepEqual(parseDateWithPrecision('TBA'), {
    date: null,
    precision: 'unknown',
    label: 'TBA',
  })
})

test('slug helpers normalize unicode text and avoid duplicates', () => {
  assert.equal(slugify(' Sakura  Trick! '), 'sakura-trick')

  const seen = new Set()
  assert.equal(uniqueSlug('Sakura Trick', seen), 'sakura-trick')
  assert.equal(uniqueSlug('Sakura Trick', seen), 'sakura-trick-2')
})

test('source record helper creates draft candidate works without ratings', () => {
  const record = createRawSourceRecord({
    source: 'bangumi',
    sourceRecordId: '12345',
    sourceUrl: 'https://bgm.tv/subject/12345',
    fetchedAt: '2026-06-27T00:00:00.000Z',
    raw: {
      name: '桜Trick',
      name_cn: '樱 Trick',
      date: '2014-01-10',
      mediaType: 'anime',
      externalIds: { bangumiSubjectId: '12345' },
      localizedTitles: [
        { title: '桜Trick', language: 'ja', region: 'JP', kind: 'original', isPrimary: true },
        { title: 'Sakura Trick', language: 'en', kind: 'romanized' },
      ],
    },
  })

  const candidate = sourceRecordToCandidateWork(record)

  assert.equal(candidate.title, '樱 Trick')
  assert.equal(candidate.originalTitle, '桜Trick')
  assert.equal(candidate.mediaGroup, 'anime')
  assert.equal(candidate.mediaType, 'anime')
  assert.equal(candidate.localizedTitles.length, 2)
  assert.equal(candidate.localizedTitles[0].title, '桜Trick')
  assert.equal(candidate.firstPublishedPrecision, 'day')
  assert.equal(candidate.rank, 'unknown')
  assert.equal(candidate.reviewStatus, 'pending')
  assert.equal(candidate.evidenceStrength, 'unassessed')
  assert.equal(candidate.status, 'draft')
  assert.equal(candidate.isLiteVisible, false)
  assert.equal(candidate.candidateSources[0].source, 'bangumi')
})

test('source record helper cleans obvious Bangumi hint name artifacts', () => {
  const record = createRawSourceRecord({
    source: 'bangumi',
    sourceRecordId: '12345',
    sourceUrl: 'https://bgm.tv/subject/12345',
    raw: {
      name_cn: '候选作品',
      mediaType: 'anime',
      creatorCreditHints: [
        { name: '7', role: 'script', originalRole: '脚本', source: 'bangumi' },
        { name: '12)', role: 'script', originalRole: '脚本', source: 'bangumi' },
        { name: 'KADOKAWA刊)', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
        { name: '协力:野上武志', role: 'character_original_design', originalRole: '人物原案', source: 'bangumi', note: 'Bangumi infobox: 人物原案' },
        { name: 'Koi(芳文社「まんがタイムきららMAX」連載)', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
        { name: 'Cygames', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
      ],
      organizationCreditHints: [
        { name: 'TOKYO MX', role: 'broadcaster', originalRole: '播放电视台', source: 'bangumi' },
        { name: '動画人物設定:茶之原拓也', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
      ],
    },
  })

  const candidate = sourceRecordToCandidateWork(record)

  assert.deepEqual(candidate.creatorCreditHints.map((row) => row.name), ['野上武志', 'Koi', 'Cygames'])
  assert.match(candidate.creatorCreditHints[0].note, /cleaned Bangumi hint name/u)
  assert.deepEqual(candidate.organizationCreditHints.map((row) => row.name), ['TOKYO MX', '茶之原拓也'])
})

test('source record helper cleans trailing note, footnote, and role prefixes from hints', () => {
  const record = createRawSourceRecord({
    source: 'bangumi',
    sourceRecordId: '67890',
    sourceUrl: 'https://bgm.tv/subject/67890',
    raw: {
      name_cn: '候选作品二',
      mediaType: 'anime',
      creatorCreditHints: [
        { name: '漫画:弐尉マルコ', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
        { name: '綾奈ゆにこ(1', role: 'script', originalRole: '脚本', source: 'bangumi' },
        { name: '吉田玲子(1-2', role: 'script', originalRole: '脚本', source: 'bangumi' },
        { name: '赤尾でこ(三重野瞳', role: 'series_composition', originalRole: '系列构成', source: 'bangumi' },
        { name: '赤尾でこ(三重野瞳)', role: 'series_composition', originalRole: '系列构成', source: 'bangumi' },
        { name: '赤尾でこ[三重野瞳]', role: 'series_composition', originalRole: '系列构成', source: 'bangumi' },
        { name: '虚淵玄 (Nitro+', role: 'script', originalRole: '脚本', source: 'bangumi' },
        { name: '虚淵玄 (Nitro+)', role: 'script', originalRole: '脚本', source: 'bangumi' },
        { name: '天野こずえ「ARIA」', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
        { name: 'Magica Quartet (新房昭之・虚淵玄・蒼樹うめ・SHAFT', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
        { name: 'Magica Quartet (新房昭之・虚淵玄・蒼樹うめ・SHAFT)', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
        { name: 'はいむらきよたか(灰村キヨタカ)', role: 'character_original_design', originalRole: '人物原案', source: 'bangumi' },
        { name: 'ひと和×Craft Egg', role: 'character_original_design', originalRole: '人物原案', source: 'bangumi' },
      ],
      organizationCreditHints: [
        { name: '製作协力:Aniplex', role: 'committee', originalRole: '製作', source: 'bangumi' },
        { name: '制作協力:KADOKAWA', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
      ],
    },
  })

  const candidate = sourceRecordToCandidateWork(record)

  assert.deepEqual(candidate.creatorCreditHints.map((row) => row.name), [
    '弐尉マルコ',
    '綾奈ゆにこ',
    '吉田玲子',
    '赤尾でこ',
    '虚淵玄',
    '天野こずえ',
    'Magica Quartet',
    'はいむらきよたか',
    'ひと和×Craft Egg',
  ])
  assert.deepEqual(candidate.organizationCreditHints.map((row) => row.name), ['Aniplex', 'KADOKAWA'])
})

test('normalize and dedupe candidates by external IDs', () => {
  const records = [
    createRawSourceRecord({
      source: 'bangumi',
      sourceRecordId: '1',
      sourceUrl: 'https://bgm.tv/subject/1',
      raw: { name_cn: '作品A', name: 'Work A', mediaType: 'manga', externalIds: { bangumiSubjectId: '1' } },
    }),
    createRawSourceRecord({
      source: 'bangumi',
      sourceRecordId: '1',
      sourceUrl: 'https://bgm.tv/subject/1',
      raw: { name_cn: '作品A', name: 'Work A', mediaType: 'manga', externalIds: { bangumiSubjectId: '1' } },
    }),
  ]

  const candidates = normalizeCandidateRecords(records)
  const result = dedupeCandidates(candidates)

  assert.equal(candidates.length, 2)
  assert.equal(result.deduped.length, 1)
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.deduped[0].candidateSources.length, 1)
  assert.equal(result.deduped[0].candidateSources[0].externalId, '1')
})

test('dedupe keeps distinct Bangumi anime subjects with the same original title for review', () => {
  const existing = {
    title: '小魔女学园',
    originalTitle: 'リトルウィッチアカデミア',
    mediaType: 'anime',
    firstPublishedAt: '2017-01-08',
    externalIds: { bangumiSubjectId: '185792' },
    candidateSources: [{ source: 'bangumi', label: 'Bangumi', externalId: '185792' }],
  }
  const candidate = {
    title: '小魔女学园',
    originalTitle: 'リトルウィッチアカデミア',
    mediaType: 'anime',
    firstPublishedAt: '2013-03-02',
    externalIds: { bangumiSubjectId: '54675' },
    candidateSources: [{ source: 'bangumi', label: 'Bangumi', externalId: '54675' }],
  }

  const match = compareWorkCandidates(candidate, existing)
  assert.equal(match.action, 'conflict')
  assert.equal(match.confidence, 'same_original_title_distinct_bangumi_subject')

  const result = dedupeCandidates([existing, candidate])
  assert.equal(result.deduped.length, 2)
  assert.equal(result.merges.length, 0)
  assert.equal(result.conflicts.length, 1)
})

test('candidate source link dedupe ignores fetchedAt and merges notes', () => {
  const sources = uniqueCandidateSources([
    {
      source: 'bangumi',
      label: 'Bangumi',
      externalId: '1',
      url: 'https://bgm.tv/subject/1',
      fetchedAt: '2026-06-27T00:00:00.000Z',
      note: 'Bangumi 标签命中：百合(120)',
    },
    {
      source: 'bangumi',
      label: 'Bangumi',
      externalId: '1',
      url: 'https://bgm.tv/subject/1',
      fetchedAt: '2026-06-27T00:00:01.000Z',
      note: 'Bangumi 标签搜索命中：百合',
    },
  ])

  assert.equal(sources.length, 1)
  assert.equal(sources[0].externalId, '1')
  assert.equal(sources[0].fetchedAt, '2026-06-27T00:00:00.000Z')
  assert.match(sources[0].note, /标签命中/u)
  assert.match(sources[0].note, /标签搜索命中/u)
})

test('candidate slug base prefers stable external IDs over non-Latin titles', () => {
  assert.equal(candidateSlugBase({
    title: '終將成為妳',
    externalIds: { bangumiSubjectId: '18313' },
  }), 'bangumi-18313')
})

test('candidate slug base lets external IDs override generated legacy slugs', () => {
  assert.equal(candidateSlugBase({
    title: '終將成為妳',
    slug: 'e-e-æ2-æ-æ-1-4æ-e3-43-4a',
    externalIds: { bangumiSubjectId: '73577' },
  }), 'bangumi-73577')
})

test('Payload seed export keeps candidates as hidden drafts', () => {
  const seed = toPayloadSeed([
    {
      title: '作品A',
      slug: 'work-a',
      mediaType: 'visual_novel',
      format: 'visual_novel',
      firstPublishedAt: '2020-01-01',
      firstPublishedPrecision: 'year',
      firstPublishedLabel: '2020',
      aliases: [{ value: 'Work A' }],
      localizedTitles: [{ title: '作品A 英文名', language: 'en', kind: 'official' }],
      candidateSources: [{ source: 'manual', label: 'Manual', externalId: '', url: '', fetchedAt: null, note: '' }],
    },
  ])

  assert.equal(seed.works.length, 1)
  assert.equal(seed.works[0].rank, 'unknown')
  assert.equal(seed.works[0].reviewStatus, 'pending')
  assert.equal(seed.works[0].evidenceStrength, 'unassessed')
  assert.equal(seed.works[0].mediaGroup, 'game')
  assert.equal(seed.works[0].localizedTitles[0].title, '作品A 英文名')
  assert.equal(seed.works[0].status, 'draft')
  assert.equal(seed.works[0].isLiteVisible, false)
  assert.equal(seed.works[0].isFullVisible, false)
})

test('Payload seed export carries Bangumi enrichment hints into review notes', () => {
  const seed = toPayloadSeed([
    {
      title: '樱 Trick',
      slug: 'sakura-trick',
      mediaType: 'anime',
      summaryText: '这是 Bangumi 简介。',
      creatorCreditHints: [
        { name: '大沼心', role: 'director', originalRole: '監督', source: 'bangumi', note: 'Bangumi infobox: 監督' },
      ],
      organizationCreditHints: [
        { name: 'citrus製作委員会', role: 'committee', originalRole: '製作', source: 'bangumi' },
        { name: '一迅社', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
      ],
    },
  ])

  assert.match(seed.works[0].evidenceNote, /Bangumi 简介候选/u)
  assert.match(seed.works[0].evidenceNote, /这是 Bangumi 简介/u)
  assert.match(seed.works[0].evidenceNote, /大沼心/u)
  assert.match(seed.works[0].evidenceNote, /citrus製作委員会/u)
  assert.match(seed.works[0].evidenceNote, /一迅社/u)
})
