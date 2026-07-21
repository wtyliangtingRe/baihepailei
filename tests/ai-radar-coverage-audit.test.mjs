import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditRadarCoverage,
  classifyRadarCoverage,
} from '../scripts/radar/audit-ai-radar-coverage-v01.mjs'

test('classifies fixed, bounded, incomplete, and unscanned AI coverage', () => {
  const fixed = {
    existingState: {
      radarAssessment: {
        suggestedGrade: 'C',
        assessedAt: '2026-07-21T00:00:00.000Z',
      },
    },
  }

  const bounded = {
    existingState: {
      radarAssessment: {
        conclusionMode: 'bounded_range',
        bestGrade: 'C',
        likelyGrade: 'D',
        worstGrade: 'E',
        confidencePercent: 52,
      },
    },
  }

  const incomplete = {
    existingState: {
      radarAssessment: {
        policyVersion: 'radar-rating-policy-v0.4-draft',
        sourceSummary: 'Only one weak source was available.',
      },
    },
  }

  const blankGroup = {
    existingState: {
      evidenceStrength: 'unassessed',
      radarAssessment: {
        suggestedGrade: null,
        evidenceStatus: 'unassessed',
        requiresHumanReview: false,
      },
    },
  }

  assert.equal(classifyRadarCoverage(fixed), 'fixed_grade')
  assert.equal(classifyRadarCoverage(bounded), 'bounded_range')
  assert.equal(classifyRadarCoverage(incomplete), 'scanned_without_valid_conclusion')
  assert.equal(classifyRadarCoverage(blankGroup), 'unscanned')

  const summary = auditRadarCoverage([fixed, bounded, incomplete, blankGroup], 'fixture.jsonl')
  assert.deepEqual(summary.byCoverageMode, {
    bounded_range: 1,
    fixed_grade: 1,
    scanned_without_valid_conclusion: 1,
    unscanned: 1,
  })
  assert.equal(summary.radarGroupObjects, 4)
  assert.equal(summary.radarGroupObjectsWithoutMeaningfulSignal, 1)
  assert.equal(summary.coverageGuaranteeSatisfied, false)
})

test('does not treat unknown or top-level evidence strength as a completed AI result', () => {
  const rows = [
    {
      evidenceStrength: 'medium',
      radarAssessment: { suggestedGrade: 'unknown' },
    },
    {
      evidenceStrength: 'weak',
      radarAssessment: {},
    },
  ]

  const summary = auditRadarCoverage(rows)
  assert.equal(summary.fixedGradeRows, 0)
  assert.equal(summary.unscannedRows, 2)
  assert.equal(summary.coverageGuaranteeSatisfied, true)
})
