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
      summaryText: '純夏と汐は互いの恋心を少しずつ自覚し、友人たちに見守られながら二人の関係を深めていく。純夏は汐に本当の気持ちを伝えるため勇気を出し、将来も一緒に歩むことを考え始める。',
      evidenceSignals: [{ type: 'summary', text: 'one' }], candidateSources: [],
    },
    {
      workId: '2', title: '示例作品 (2)', media: { mediaType: 'manga' },
      summaryText: '遠い宇宙基地で機械技師たちが壊れた航行装置を修理する。隊長は未知の惑星から届いた信号を解析し、巨大な宇宙船の秘密を追うため仲間と危険な探査任務へ出発する。調査班は基地の事故原因も究明する。',
      evidenceSignals: [{ type: 'summary', text: 'two' }], candidateSources: [],
    },
    {
      workId: '3', title: '示例作品 (3)', media: { mediaType: 'manga' },
      summaryText: '純夏はついに汐へ恋心を告白し、汐も隠していた本当の気持ちを伝える。二人は互いを大切な恋人として受け入れ、卒業後の将来について一緒に話し合いながら関係を深めていく。',
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
