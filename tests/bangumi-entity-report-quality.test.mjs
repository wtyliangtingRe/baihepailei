import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBangumiEntityReview } from '../tools/source_import/scripts/report-bangumi-entities.mjs'

test('Bangumi entity review keeps publisher and game organizations out of person-like flags', () => {
  const review = buildBangumiEntityReview([
    {
      title: '作品A',
      slug: 'bangumi-a',
      organizationCreditHints: [
        { name: '小学館', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
        { name: '秋田書店', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
        { name: '角川書店', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
        { name: '网易游戏', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
        { name: '楽音舎', role: 'committee', originalRole: '製作', source: 'bangumi' },
        { name: '武智恒雄', role: 'committee', originalRole: '製作', source: 'bangumi' },
      ],
    },
  ])

  for (const name of ['小学館', '秋田書店', '角川書店', '网易游戏', '楽音舎']) {
    const item = review.organizations.find((candidate) => candidate.name === name)
    assert.ok(item, name)
    assert.ok(!item.reviewFlags.includes('organization_name_may_be_person'), name)
  }

  const personLike = review.organizations.find((candidate) => candidate.name === '武智恒雄')
  assert.ok(personLike.reviewFlags.includes('organization_name_may_be_person'))
})

test('Bangumi entity review marks names with leftover prefix separators', () => {
  const review = buildBangumiEntityReview([
    {
      title: '作品B',
      slug: 'bangumi-b',
      creatorCreditHints: [
        { name: '首席监督:坂本隆', role: 'series_director', originalRole: '首席监督', source: 'bangumi' },
      ],
      organizationCreditHints: [
        { name: '音乐协力:テレビ東京ミュージック', role: 'music_label', originalRole: '音乐协力', source: 'bangumi' },
      ],
    },
  ])

  const creator = review.creators.find((candidate) => candidate.name === '首席监督:坂本隆')
  const organization = review.organizations.find((candidate) => candidate.name === '音乐协力:テレビ東京ミュージック')

  assert.ok(creator.reviewFlags.includes('has_prefix_separator'))
  assert.ok(organization.reviewFlags.includes('has_prefix_separator'))
})
