import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPublicationPatch,
  chooseConclusionCandidate,
  classifyConclusion,
} from '../scripts/radar/run-ai-radar-full-coverage-publication-v01.mjs'

test('classifies fixed and bounded conclusions', () => {
  assert.equal(classifyConclusion({ radarAssessment: { suggestedGrade: 'A' } }).mode, 'fixed_grade')
  assert.deepEqual(
    classifyConclusion({
      conclusionMode: 'bounded_range',
      bestGrade: 'B',
      likelyGrade: 'C',
      worstGrade: 'E',
    }),
    {
      mode: 'bounded_range',
      bestGrade: 'B',
      likelyGrade: 'C',
      worstGrade: 'E',
      compatibilityGrade: 'C',
    },
  )
})

test('new exact research outranks an older draft fixed grade', () => {
  const candidate = chooseConclusionCandidate({
    packageRow: {
      conclusionMode: 'fixed_grade',
      suggestedGrade: 'S',
    },
    latestDraft: { radarAssessment: { suggestedGrade: 'A' } },
    published: { radarAssessment: { suggestedGrade: 'B' } },
  })
  assert.equal(candidate.source, 'package_fixed')
  assert.equal(candidate.compatibilityGrade, 'S')
})

test('existing fixed draft outranks a new coarse range', () => {
  const candidate = chooseConclusionCandidate({
    packageRow: {
      conclusionMode: 'bounded_range',
      bestGrade: 'B',
      likelyGrade: 'C',
      worstGrade: 'E',
    },
    latestDraft: { radarAssessment: { suggestedGrade: 'B' } },
    published: {},
  })
  assert.equal(candidate.source, 'latest_draft_fixed')
  assert.equal(candidate.compatibilityGrade, 'B')
})

test('bounded package keeps its range in the public source summary', () => {
  const candidate = chooseConclusionCandidate({
    packageRow: {
      conclusionMode: 'bounded_range',
      bestGrade: 'B',
      likelyGrade: 'C',
      worstGrade: 'E',
      confidencePercent: 58,
      evidenceCoveragePercent: 40,
      evidenceStatus: 'single_secondary_supported',
      sourceSummary: '现有资料仅支持粗评。',
      policyVersion: 'radar-rating-policy-v0.4-draft',
      assessmentBatch: 'test-batch',
      assessedAt: '2026-07-23T00:00:00.000Z',
      matchedRules: [],
      contradictions: [],
    },
    latestDraft: {},
    published: {},
  })
  const patch = buildPublicationPatch({
    candidate,
    published: { reviewReasons: [], reviewStatus: 'pending' },
  })
  assert.equal(patch.rank, 'C')
  assert.equal(patch.radarAssessment.suggestedGrade, 'C')
  assert.match(patch.radarAssessment.sourceSummary, /AI 暂定范围：B–E，最可能 C/)
  assert.ok(!('humanAssessment' in patch))
})

test('human track presence omits all compatibility fields', () => {
  const candidate = chooseConclusionCandidate({
    packageRow: {
      conclusionMode: 'fixed_grade',
      suggestedGrade: 'A',
      confidencePercent: 90,
      evidenceCoveragePercent: 80,
      evidenceStatus: 'multiple_secondary_supported',
      sourceSummary: '精确结论。',
      policyVersion: 'radar-rating-policy-v0.4-draft',
      assessmentBatch: 'test-batch',
      assessedAt: '2026-07-23T00:00:00.000Z',
      matchedRules: [],
      contradictions: [],
    },
    latestDraft: {},
    published: {},
  })
  const patch = buildPublicationPatch({
    candidate,
    published: {
      humanAssessment: { grade: 'B', status: 'reviewed' },
      rank: 'B',
      ratingNotice: 'manual_reviewed',
    },
  })
  assert.deepEqual(Object.keys(patch).sort(), ['_status', 'radarAssessment'])
  assert.ok(!('humanAssessment' in patch))
})

test('no invalid input becomes a conclusion', () => {
  assert.equal(classifyConclusion({ radarAssessment: {} }).mode, 'none')
  assert.equal(classifyConclusion({
    conclusionMode: 'bounded_range',
    bestGrade: 'B',
    likelyGrade: 'unknown',
    worstGrade: 'E',
  }).mode, 'none')
})
