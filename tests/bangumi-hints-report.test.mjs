import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createBangumiHintsReport,
  summarizeBangumiHints,
} from '../tools/source_import/scripts/report-bangumi-hints.mjs'

const works = [
  {
    title: '樱 Trick',
    slug: 'bangumi-1',
    externalIds: { bangumiSubjectId: '1' },
    creatorCreditHints: [
      { name: '大沼心', role: 'director', originalRole: '監督', source: 'bangumi' },
      { name: '高山カツヒコ', role: 'series_composition', originalRole: 'シリーズ構成', source: 'bangumi' },
      { name: '高山カツヒコ', role: 'script', originalRole: '脚本', source: 'bangumi' },
    ],
    organizationCreditHints: [
      { name: 'citrus製作委員会', role: 'committee', originalRole: '製作', source: 'bangumi' },
      { name: '一迅社', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
      { name: 'TOKYO MX', role: 'broadcaster', originalRole: '放送局', source: 'bangumi' },
    ],
  },
  {
    title: '作品B',
    slug: 'bangumi-2',
    externalIds: { bangumiSubjectId: '2' },
    creatorCreditHints: [
      { name: '大沼心', role: 'chief_director', originalRole: '総監督', source: 'bangumi' },
    ],
    organizationCreditHints: [
      { name: 'citrus製作委員会', role: 'committee', originalRole: '製作', source: 'bangumi' },
      { name: '一迅社', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
      { name: 'A社 / B社', role: 'committee_member', originalRole: '製作', source: 'bangumi' },
    ],
  },
]

test('Bangumi hints summary counts person and organization hints', () => {
  const summary = summarizeBangumiHints(works)

  assert.equal(summary.worksTotal, 2)
  assert.equal(summary.worksWithPersonHints, 2)
  assert.equal(summary.worksWithOrganizationHints, 2)
  assert.equal(summary.personHintsTotal, 4)
  assert.equal(summary.organizationHintsTotal, 6)
  assert.equal(summary.personUniqueNames, 2)
  assert.equal(summary.organizationUniqueNames, 4)
  assert.equal(summary.topPersons[0].name, '大沼心')
  assert.equal(summary.topPersons[0].worksCount, 2)
  assert.equal(summary.topGroups[0].name, 'citrus製作委員会')
  assert.equal(summary.topGroupMembers[0].name, '一迅社')
  assert.ok(summary.personRoleCoverage.some((row) => row.role === 'director' && row.works === 1))
  assert.ok(summary.organizationRoleCoverage.some((row) => row.role === 'committee_member' && row.works === 2))
})

test('Bangumi hints summary marks suspicious mixed names for review', () => {
  const summary = summarizeBangumiHints(works)

  assert.ok(summary.reviewNeeded.some((row) => row.name === 'A社 / B社' && row.reasons.includes('name_has_separator')))
  assert.ok(summary.reviewNeeded.some((row) => row.name === 'citrus製作委員会' && row.reasons.includes('name_contains_role_word')))
})

test('Bangumi hints report renders key tables', () => {
  const report = createBangumiHintsReport(works, { inputPath: 'input.jsonl', topLimit: 5 })

  assert.match(report, /Bangumi 候选职位\/制作报告/u)
  assert.match(report, /人物 role 覆盖/u)
  assert.match(report, /机构\/制作 role 覆盖/u)
  assert.match(report, /高频人物候选/u)
  assert.match(report, /大沼心/u)
  assert.match(report, /citrus製作委員会/u)
  assert.match(report, /疑似需要人工复核的候选名/u)
})
