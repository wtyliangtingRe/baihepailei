import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiEntityReview,
  createBangumiEntityReviewReport,
} from '../tools/source_import/scripts/report-bangumi-entities.mjs'

const works = [
  {
    title: '作品A',
    slug: 'bangumi-1',
    externalIds: { bangumiSubjectId: '1' },
    creatorCreditHints: [
      { name: '吉田玲子', role: 'script', originalRole: '脚本', source: 'bangumi' },
      { name: '吉田玲子', role: 'series_composition', originalRole: '系列构成', source: 'bangumi' },
      { name: 'ひと和×Craft Egg', role: 'character_original_design', originalRole: '人物原案', source: 'bangumi' },
      { name: 'Cygames', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
    ],
    organizationCreditHints: [
      { name: 'Cygames', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
      { name: 'TOKYO MX', role: 'broadcaster', originalRole: '播放电视台', source: 'bangumi' },
    ],
  },
  {
    title: '作品B',
    slug: 'bangumi-2',
    externalIds: { bangumiSubjectId: '2' },
    creatorCreditHints: [
      { name: '吉田玲子', role: 'script', originalRole: '脚本', source: 'bangumi' },
      { name: 'citrus製作委員会', role: 'original_creator', originalRole: '原作', source: 'bangumi' },
    ],
    organizationCreditHints: [
      { name: 'Cygames', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
      { name: '一迅社', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
    ],
  },
]

test('Bangumi entity review aggregates creator and organization candidates', () => {
  const review = buildBangumiEntityReview(works)

  assert.equal(review.meta.worksTotal, 2)
  assert.equal(review.meta.creatorRowsTotal, 6)
  assert.equal(review.meta.organizationRowsTotal, 4)
  assert.equal(review.meta.creatorsTotal, 4)
  assert.equal(review.meta.organizationsTotal, 3)
  assert.equal(review.meta.sharedNameCandidates, 1)

  const yoshida = review.creators.find((item) => item.name === '吉田玲子')
  assert.equal(yoshida.worksCount, 2)
  assert.equal(yoshida.hintCount, 3)
  assert.deepEqual(yoshida.roles.map((row) => row.role), ['script', 'series_composition'])

  const cygamesCreator = review.creators.find((item) => item.name === 'Cygames')
  const cygamesOrganization = review.organizations.find((item) => item.name === 'Cygames')
  assert.ok(cygamesCreator.reviewFlags.includes('appears_in_both_lists'))
  assert.ok(cygamesOrganization.reviewFlags.includes('appears_in_both_lists'))
})

test('Bangumi entity review marks compound and group-looking creator names', () => {
  const review = buildBangumiEntityReview(works)

  const compound = review.creators.find((item) => item.name === 'ひと和×Craft Egg')
  assert.ok(compound.reviewFlags.includes('compound_name'))

  const groupLooking = review.creators.find((item) => item.name === 'citrus製作委員会')
  assert.ok(groupLooking.reviewFlags.includes('creator_name_looks_like_group'))
})

test('Bangumi entity review report renders key sections', () => {
  const review = buildBangumiEntityReview(works)
  const report = createBangumiEntityReviewReport(review, { inputPath: 'input.jsonl', topLimit: 10 })

  assert.match(report, /Bangumi 候选实体审查报告/u)
  assert.match(report, /高频 creator 候选/u)
  assert.match(report, /高频 organization 候选/u)
  assert.match(report, /需要人工复核的高频候选/u)
  assert.match(report, /吉田玲子/u)
  assert.match(report, /Cygames/u)
})
