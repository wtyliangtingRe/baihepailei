import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDateWithPrecision } from '../tools/source_import/lib/date-precision.mjs'
import { parseJsonl, stringifyJsonl } from '../tools/source_import/lib/jsonl.mjs'
import { createRawSourceRecord, sourceRecordToCandidateWork } from '../tools/source_import/lib/source-record.mjs'
import { slugify, uniqueSlug } from '../tools/source_import/lib/slug.mjs'
import { dedupeCandidates } from '../tools/source_import/scripts/dedupe-candidates.mjs'
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
