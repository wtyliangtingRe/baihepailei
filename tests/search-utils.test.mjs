import test from 'node:test'
import assert from 'node:assert/strict'

import { displayRank, filterAndRankItems, getCollectionLabel, mediaGroupLabel, resultMeta, resultSummary, scoreItem, splitQuery, workTypeLabel } from '../src/app/(frontend)/search/search-utils.mjs'

const work = {
  id: 'work-1', collection: 'works', typeLabel: '作品', title: '樱 Trick', slug: 'sakura-trick', url: '/works/sakura-trick',
  rank: 'B', originalTitle: '桜Trick', aliases: ['樱trick', 'Sakura Trick'], localizedTitles: ['Sakura Trick', '樱花 Trick'],
  mediaGroup: 'anime', mediaType: 'anime', format: 'tv_anime', firstPublishedLabel: '2014-01-10', creators: ['タチ'],
  tags: ['百合'], warnings: ['争议标签'], searchText: '校园 百合 动画 漫画',
}
const creator = { id: 'creator-1', collection: 'creators', typeLabel: '创作者', title: 'タチ', slug: 'tachi', url: '/creators/tachi', aliases: ['Tachi'], localizedNames: ['Tachi'], searchText: '创作者 作者' }
const term = { id: 'term-1', collection: 'terms', typeLabel: '名词解释', title: 'MtF', slug: 'mtf', url: '/terms/mtf', relatedTerms: ['性别表达'], relatedWarnings: ['术语争议'], searchText: '名词解释 术语' }

test('query normalization and display labels remain stable', () => {
  assert.deepEqual(splitQuery('  Sakura   Trick  '), ['sakura', 'trick'])
  assert.equal(getCollectionLabel('works'), '作品')
  assert.equal(displayRank('AA'), 'S级')
  assert.equal(mediaGroupLabel('anime'), '动画')
  assert.equal(workTypeLabel(work), 'TV 动画')
})

test('title and alias matches outrank body-only matches', () => {
  assert.ok(scoreItem(work, '樱trick') > scoreItem(work, '校园'))
  assert.ok(scoreItem(work, 'タチ') > 0)
  assert.ok(scoreItem(work, '动画') > 0)
})

test('multi-term queries require every term to match', () => {
  assert.ok(scoreItem(work, '樱 动画') > 0)
  assert.equal(scoreItem(work, '樱 不存在的词'), 0)
})

test('collection filtering and empty browse limits work', () => {
  const results = filterAndRankItems([creator, work, term], { activeCollection: 'works', query: '樱trick' })
  assert.equal(results.length, 1)
  assert.equal(results[0].id, 'work-1')
  assert.equal(filterAndRankItems(Array.from({ length: 35 }, (_, index) => ({ ...work, id: `work-${index}` })), { query: '' }).length, 30)
})

test('result metadata exposes media group and exact work format', () => {
  assert.equal(resultMeta(work), '作品 · B级 · 动画')
  assert.match(resultSummary(work), /TV 动画/u)
  assert.match(resultSummary(work), /タチ/u)
  assert.doesNotMatch(resultSummary(work), /XWiki|旧站/iu)
})
