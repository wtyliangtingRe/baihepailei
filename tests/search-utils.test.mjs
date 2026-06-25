import test from 'node:test'
import assert from 'node:assert/strict'

import {
  displayRank,
  filterAndRankItems,
  getCollectionLabel,
  resultMeta,
  resultSummary,
  scoreItem,
  splitQuery,
} from '../src/app/(frontend)/search/search-utils.mjs'

const work = {
  id: 'work-1',
  collection: 'works',
  typeLabel: '作品',
  title: '樱 Trick',
  slug: 'sakura-trick',
  url: '/works/sakura-trick',
  rank: 'B',
  originalTitle: '桜Trick',
  aliases: ['樱trick', 'Sakura Trick'],
  creators: ['タチ'],
  tags: ['百合'],
  warnings: ['争议标签'],
  legacyXWikiPage: 'Main.作品.樱Trick',
  searchText: '校园 百合 动画 漫画',
}

const creator = {
  id: 'creator-1',
  collection: 'creators',
  typeLabel: '创作者',
  title: 'タチ',
  slug: 'tachi',
  url: '/creators/tachi',
  aliases: ['Tachi'],
  searchText: '创作者 作者',
}

const term = {
  id: 'term-1',
  collection: 'terms',
  typeLabel: '名词解释',
  title: 'MtF',
  slug: 'mtf',
  url: '/terms/mtf',
  relatedTerms: ['性别表达'],
  relatedWarnings: ['术语争议'],
  searchText: '名词解释 术语',
}

test('splitQuery trims whitespace and lowercases terms', () => {
  assert.deepEqual(splitQuery('  Sakura   Trick  '), ['sakura', 'trick'])
})

test('getCollectionLabel returns labels and falls back to raw collection names', () => {
  assert.equal(getCollectionLabel('works'), '作品')
  assert.equal(getCollectionLabel('unknown'), 'unknown')
})

test('displayRank maps legacy AA rank to S for frontend display', () => {
  assert.equal(displayRank('AA'), 'S级')
  assert.equal(displayRank('B'), 'B级')
  assert.equal(displayRank('unknown'), '')
})

test('scoreItem gives title and alias matches a stronger score than body-only matches', () => {
  const titleScore = scoreItem(work, '樱trick')
  const bodyScore = scoreItem(work, '校园')

  assert.ok(titleScore > bodyScore)
  assert.ok(bodyScore > 0)
})

test('scoreItem matches creator, tag, warning, and related fields', () => {
  assert.ok(scoreItem(work, 'タチ') > 0)
  assert.ok(scoreItem(work, '百合') > 0)
  assert.ok(scoreItem(work, '争议') > 0)
  assert.ok(scoreItem(term, '性别表达') > 0)
})

test('filterAndRankItems filters collections and ranks stronger matches first', () => {
  const results = filterAndRankItems([creator, work, term], {
    activeCollection: 'works',
    query: '樱trick',
  })

  assert.equal(results.length, 1)
  assert.equal(results[0].id, 'work-1')
})

test('filterAndRankItems limits empty-query browse results to 30 items', () => {
  const items = Array.from({ length: 35 }, (_, index) => ({
    ...work,
    id: `work-${index}`,
    title: `作品 ${index}`,
  }))

  const results = filterAndRankItems(items, { query: '', activeCollection: 'all' })
  assert.equal(results.length, 30)
})

test('resultMeta and resultSummary produce compact display strings without legacy XWiki pages', () => {
  const summary = resultSummary(work)

  assert.equal(resultMeta(work), '作品 · B级')
  assert.equal(resultMeta({ ...work, rank: 'AA' }), '作品 · S级')
  assert.match(summary, /桜Trick/)
  assert.match(summary, /タチ/)
  assert.doesNotMatch(summary, /Main\.作品/)
})
