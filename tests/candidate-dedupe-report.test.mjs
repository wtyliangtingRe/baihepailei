import test from 'node:test'
import assert from 'node:assert/strict'

import { createDedupeReport } from '../tools/source_import/lib/dedupe-report.mjs'
import { compareWorkCandidates } from '../tools/source_import/lib/match-work.mjs'
import { normalizeTitleForMatch } from '../tools/source_import/lib/title-normalize.mjs'
import { dedupeCandidates } from '../tools/source_import/scripts/dedupe-candidates.mjs'

function candidate(overrides) {
  return {
    title: '作品A',
    originalTitle: 'Work A',
    aliases: [],
    mediaType: 'manga',
    format: 'manga_series',
    firstPublishedAt: '2020-01-01',
    firstPublishedPrecision: 'year',
    firstPublishedLabel: '2020',
    externalIds: {},
    candidateSources: [],
    ...overrides,
  }
}

test('title normalization removes common punctuation and spacing', () => {
  assert.equal(normalizeTitleForMatch(' Work A!! '), 'worka')
  assert.equal(normalizeTitleForMatch('终 将 成 为 你'), '终将成为你')
})

test('candidate comparison auto-merges by exact external ID', () => {
  const result = compareWorkCandidates(
    candidate({ externalIds: { bangumiSubjectId: '123' } }),
    candidate({ title: '别的标题', externalIds: { bangumiSubjectId: '123' } }),
  )

  assert.equal(result.action, 'merge')
  assert.equal(result.confidence, 'exact_external_id')
})

test('candidate comparison auto-merges by original title and media type', () => {
  const result = compareWorkCandidates(
    candidate({ title: '中文标题', originalTitle: 'Yagate Kimi ni Naru', mediaType: 'manga' }),
    candidate({ title: '另一个中文名', originalTitle: 'やがて君になる', mediaType: 'manga' }),
  )

  assert.equal(result.action, 'new')

  const romanized = compareWorkCandidates(
    candidate({ title: '中文标题', originalTitle: 'Yagate Kimi ni Naru', mediaType: 'manga' }),
    candidate({ title: '别名标题', originalTitle: 'Yagate Kimi ni Naru', mediaType: 'manga' }),
  )

  assert.equal(romanized.action, 'merge')
  assert.equal(romanized.confidence, 'exact_original_title')
})

test('dedupe keeps possible same-title date matches as review items', () => {
  const result = dedupeCandidates([
    candidate({ title: '终将成为你', originalTitle: 'Bloom Into You', firstPublishedLabel: '2015' }),
    candidate({ title: '终将成为你', originalTitle: 'Yagate Kimi ni Naru', firstPublishedLabel: '2016' }),
  ])

  assert.equal(result.deduped.length, 2)
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].confidence, 'possible_same_title_date')
})

test('dedupe keeps same-title different-media matches as review items', () => {
  const result = dedupeCandidates([
    candidate({ title: '作品A', originalTitle: 'Work A', mediaType: 'manga' }),
    candidate({ title: '作品A', originalTitle: 'Work A Anime', mediaType: 'anime' }),
  ])

  assert.equal(result.deduped.length, 2)
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].confidence, 'same_title_different_media')
})

test('dedupe auto-merges exact external IDs and records merge metadata', () => {
  const result = dedupeCandidates([
    candidate({ title: '作品A', externalIds: { bangumiSubjectId: '1' }, candidateSources: [{ source: 'bangumi', externalId: '1' }] }),
    candidate({ title: '作品A', externalIds: { bangumiSubjectId: '1' }, candidateSources: [{ source: 'manual', externalId: 'manual-a' }] }),
  ])

  assert.equal(result.deduped.length, 1)
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.merges.length, 1)
  assert.equal(result.deduped[0].candidateSources.length, 2)
})

test('dedupe report includes summary, merge, and review sections', () => {
  const result = dedupeCandidates([
    candidate({ title: '作品A', externalIds: { bangumiSubjectId: '1' } }),
    candidate({ title: '作品A', externalIds: { bangumiSubjectId: '1' } }),
    candidate({ title: '作品B', originalTitle: 'Work B', firstPublishedLabel: '2020' }),
    candidate({ title: '作品B', originalTitle: 'Work C', firstPublishedLabel: '2020' }),
  ])
  const report = createDedupeReport({ inputCount: 4, ...result })

  assert.match(report, /# Dedupe report/u)
  assert.match(report, /Auto merges: 1/u)
  assert.match(report, /Review items: 1/u)
  assert.match(report, /possible_same_title_date/u)
})
