import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyExactSummaryDuplicateGuard,
  findExactSummaryDuplicateGroups,
  normalizeComparableSummary,
} from '../scripts/radar/guard-ai-radar-exact-summary-duplicates-v01.mjs'

test('summary normalization ignores whitespace and punctuation', () => {
  assert.equal(
    normalizeComparableSummary('善良的人，请回避。\n只有爱著某个人的坏人！'),
    normalizeComparableSummary('善良的人请回避 只有爱著某个人的坏人'),
  )
})

test('exact duplicate summaries under different identities form a group', () => {
  const summary = '善良的人请回避，只有爱著某个人的坏人，才能翻开这本书。奈诗键理为了心爱的女孩不断战斗并交换时间。'
  const groups = findExactSummaryDuplicateGroups([
    {
      workId: '3800',
      title: 'むげんのみなもに (01)',
      series: { seriesKey: 'むげんのみなもに' },
      summaryText: summary,
      externalIds: { bangumiSubjectId: '47267' },
    },
    {
      workId: '3834',
      title: '沉入无限的水面之中',
      series: { seriesKey: '沉入无限的水面之中' },
      summaryText: summary,
      externalIds: { bangumiSubjectId: '59881' },
    },
  ], 20)

  assert.equal(groups.length, 1)
  assert.equal(groups[0].memberCount, 2)
})

test('duplicate rows are write protected and moved out of ready queue', () => {
  const summary = '这是足够长的完全相同简介，用于测试不同标题和不同外部身份之间的正文重复。'.repeat(4)
  const input = [
    {
      workId: '1', title: '日本标题', summaryText: summary,
      series: { seriesKey: '日本标题' },
      writeProtection: { protected: false, reasons: [] },
      inputAudit: {
        assessmentReadiness: 'ready_for_ai_assessment_with_warnings',
        flags: [], warnings: [], blockers: [],
      },
    },
    {
      workId: '2', title: '中文标题', summaryText: summary,
      series: { seriesKey: '中文标题' },
      writeProtection: { protected: false, reasons: [] },
      inputAudit: {
        assessmentReadiness: 'ready_for_ai_assessment_with_warnings',
        flags: [], warnings: [], blockers: [],
      },
    },
  ]

  const result = applyExactSummaryDuplicateGuard(input, 20)
  assert.equal(result.groups.length, 1)
  for (const row of result.rows) {
    assert.equal(row.writeProtection.protected, true)
    assert.equal(row.inputAudit.assessmentReadiness, 'needs_identity_or_series_review')
    assert.ok(row.inputAudit.flags.includes('exact_summary_duplicate_different_identity'))
    assert.ok(row.inputAudit.blockers.includes('exact_summary_duplicate_requires_identity_review'))
  }
})

test('same-series rows with different summaries are not blocked', () => {
  const groups = findExactSummaryDuplicateGroups([
    {
      workId: '1', title: '作品 (1)', series: { seriesKey: '作品' },
      summaryText: '第一卷讲述两名少女在学校相遇并逐渐了解彼此。'.repeat(4),
    },
    {
      workId: '2', title: '作品 (2)', series: { seriesKey: '作品' },
      summaryText: '第二卷讲述两名少女面对新的社团活动和家庭问题。'.repeat(4),
    },
  ], 20)
  assert.equal(groups.length, 0)
})
