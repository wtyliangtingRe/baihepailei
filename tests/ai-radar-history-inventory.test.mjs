import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildHistoryInventory,
  classifyResearchProposal,
} from '../scripts/radar/audit-ai-radar-history-v01.mjs'

test('classifies reusable bounded and likely-only research proposals', () => {
  assert.equal(classifyResearchProposal({
    proposedBestGrade: 'B',
    proposedLikelyGrade: 'C',
    proposedWorstGrade: 'E',
  }), 'bounded_range')

  assert.equal(classifyResearchProposal({ proposedLikelyGrade: 'D' }), 'likely_only')
  assert.equal(classifyResearchProposal({ proposedLikelyGrade: 'unknown' }), 'no_grade_suggestion')
})

test('separates formal Works conclusions from reusable research and true gaps', () => {
  const works = [
    {
      id: 1,
      siteId: 'work:1',
      title: 'Fixed work',
      radarAssessment: {
        suggestedGrade: 'B',
        assessedAt: '2026-07-01T00:00:00.000Z',
        assessmentBatch: 'RADAR-ASSESS-0001',
      },
    },
    {
      id: 2,
      siteId: 'work:2',
      title: 'Reusable range',
      radarAssessment: {},
    },
    {
      id: 3,
      siteId: 'work:3',
      title: 'Incomplete work',
      radarAssessment: {
        assessedAt: '2026-07-02T00:00:00.000Z',
        sourceSummary: 'Some research exists, but no grade was stored.',
      },
    },
    {
      id: 4,
      siteId: 'work:4',
      title: 'True gap',
      radarAssessment: {},
    },
  ]

  const research = [
    {
      id: 101,
      researchKey: 'program|2|work:2',
      work: 2,
      workSiteId: 'work:2',
      recordStatus: 'current',
      researchStatus: 'partial',
      proposedBestGrade: 'B',
      proposedLikelyGrade: 'C',
      proposedWorstGrade: 'E',
      sources: [{ url: 'https://example.test/2' }],
    },
    {
      id: 102,
      researchKey: 'program|3|work:3',
      work: 3,
      workSiteId: 'work:3',
      recordStatus: 'current',
      researchStatus: 'partial',
      proposedLikelyGrade: 'D',
    },
    {
      id: 103,
      researchKey: 'program|4|work:4',
      work: 4,
      workSiteId: 'work:4',
      recordStatus: 'archived',
      researchStatus: 'resolved',
      proposedBestGrade: 'A',
      proposedLikelyGrade: 'B',
      proposedWorstGrade: 'C',
    },
    {
      id: 104,
      researchKey: 'program|999|missing',
      work: 999,
      workSiteId: 'missing',
      recordStatus: 'current',
      proposedLikelyGrade: 'C',
    },
  ]

  const result = buildHistoryInventory(works, research, { payloadRead: false })

  assert.deepEqual(result.summary.works.byCoverageMode, {
    unscanned: 2,
    fixed_grade: 1,
    scanned_without_valid_conclusion: 1,
  })
  assert.equal(result.summary.research.rowsRead, 4)
  assert.equal(result.summary.research.currentRows, 3)
  assert.equal(result.summary.research.archivedRows, 1)
  assert.equal(result.summary.research.unresolvedCurrentRows, 1)
  assert.equal(result.summary.overlap.worksWithFormalAiConclusion, 1)
  assert.equal(result.summary.overlap.nonFormalWorksWithReusableResearch, 2)
  assert.equal(result.summary.overlap.unscannedWithReusableResearch, 1)
  assert.equal(result.summary.overlap.scannedWithoutConclusionWithReusableResearch, 1)
  assert.equal(result.summary.overlap.worksWithoutFormalOrCurrentResearch, 1)
  assert.equal(result.summary.overlap.worksWithoutFormalOrReusableResearch, 1)
  assert.equal(result.reusableResearchCandidates.length, 2)
  assert.equal(result.scannedWithoutValidConclusion.length, 1)
  assert.equal(result.worksWithoutFormalOrReusableResearch[0].workId, '4')
})

test('does not treat rating notices or empty Payload groups as completed AI work', () => {
  const result = buildHistoryInventory([
    {
      id: 10,
      title: 'Notice only',
      ratingNotice: 'ai_synthesized_pending_review',
      evidenceStrength: 'medium',
      radarAssessment: {
        suggestedGrade: null,
        policyVersion: null,
        assessedAt: null,
      },
    },
  ], [], {})

  assert.equal(result.summary.works.unscannedRows, 1)
  assert.equal(result.summary.works.fixedGradeRows, 0)
  assert.equal(result.summary.overlap.worksWithoutFormalOrCurrentResearch, 1)
})
