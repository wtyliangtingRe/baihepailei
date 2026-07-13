import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditAndCleanRows,
  inferEffectiveMediaType,
  parseSeriesTitle,
} from '../scripts/radar/audit-ai-radar-input-v01.mjs'

test('volume titles are grouped into a stable series key', () => {
  assert.deepEqual(parseSeriesTitle('ささめきこと (02)'), {
    seriesKey: 'ささめきこと',
    volumeLabel: '02',
    isVolumeLevel: true,
  })
  assert.deepEqual(parseSeriesTitle('星川银座四丁目 2'), {
    seriesKey: '星川银座四丁目',
    volumeLabel: '2',
    isVolumeLevel: true,
  })
})

test('MangaDex provenance can repair assessment media type without writing Payload', () => {
  const result = inferEffectiveMediaType({
    media: { mediaType: 'other' },
    candidateSources: [
      { source: 'mangadex', note: 'originalSource=mangadex; mediaType=manga; confidence=high_confidence' },
    ],
  })
  assert.deepEqual(result, {
    value: 'manga',
    inferred: true,
    reason: 'candidate_source_note',
  })
})

test('series summary outlier is isolated from ready assessment rows', () => {
  const rows = [
    {
      workId: '1', title: '示例作品 (1)', media: { mediaType: 'manga' },
      summaryText: '純夏和汐在学校里逐渐确认彼此的恋爱心意，二人的关系成为故事中心。她们在同学与家庭面前学习如何诚实面对感情，并继续共同生活。',
      evidenceSignals: [{ type: 'summary', text: 'one' }], candidateSources: [],
    },
    {
      workId: '2', title: '示例作品 (2)', media: { mediaType: 'manga' },
      summaryText: '精灵研究会为了获得活动室而召集成员，任田与伙伴开始召唤精灵的喜剧故事。新的成员加入以后，大家为了完成研究会任务展开校园冒险。',
      evidenceSignals: [{ type: 'summary', text: 'two' }], candidateSources: [],
    },
    {
      workId: '3', title: '示例作品 (3)', media: { mediaType: 'manga' },
      summaryText: '純夏终于向汐表达心意，两位少女继续面对学校生活与恋爱关系的变化。她们决定珍惜彼此，在毕业与未来选择中维持共同生活。',
      evidenceSignals: [{ type: 'summary', text: 'three' }], candidateSources: [],
    },
  ]
  const cleaned = auditAndCleanRows(rows)
  assert.equal(cleaned[1].inputAudit.assessmentReadiness, 'needs_identity_or_series_review')
  assert.ok(cleaned[1].inputAudit.flags.includes('series_summary_outlier'))
  assert.equal(cleaned[0].inputAudit.assessmentReadiness, 'ready_for_ai_assessment_with_warnings')
})

test('repeated Yurizukan volume records collapse into one evidence group', () => {
  const rows = [{
    workId: '1', title: '示例作品 (1)', media: { mediaType: 'manga' }, summaryText: '两个女性角色之间存在明确的长期恋爱关系。',
    evidenceSignals: [
      { type: 'summary', text: 'content' },
      { type: 'evidence_note', text: 'operational note' },
      { type: 'candidate_source_note', source: 'yurizukan', text: 'technical note' },
    ],
    candidateSources: [
      { source: 'yurizukan', externalId: '1', note: 'trustedYuriSource=true; 関係性=GL; groupKey=manga|example|author' },
      { source: 'yurizukan', externalId: '2', note: 'trustedYuriSource=true; 関係性=GL; groupKey=manga|example|author' },
    ],
  }]
  const [cleaned] = auditAndCleanRows(rows)
  assert.equal(cleaned.sourceEvidenceGroups.length, 1)
  assert.equal(cleaned.sourceEvidenceGroups[0].recordCount, 2)
  assert.equal(cleaned.metadataEvidenceSignals.length, 1)
  assert.equal(cleaned.contentEvidenceSignals.length, 1)
  assert.equal(cleaned.provenanceSignals.length, 2)
  assert.equal('evidenceSignals' in cleaned, false)
})
