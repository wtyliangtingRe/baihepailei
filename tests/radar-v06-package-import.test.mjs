import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCanonicalV06Assessment,
  collectTraceableSources,
  provenanceBlockers,
  validatePackageManifest,
} from '../scripts/radar/lib/v06-package-import-v01.mjs'

const manifest = {
  summary: {
    policyVersion: 'radar-rating-policy-v0.6-generalized-dryrun',
    generatedAt: '2026-07-14T18:11:01.252188+00:00',
    rows: 10805,
    batches: 44,
    responseFiles: 433,
    validationFiles: 433,
    validationErrors: [],
    safety: { payloadWrite: 0, postgresqlWrite: 0 },
  },
}

function fixture(overrides = {}) {
  return buildCanonicalV06Assessment({
    canonicalRow: {
      workId: '1',
      siteId: 'work:1',
      title: 'Example',
      sourceLinks: [{ label: 'Bangumi', url: 'https://bgm.tv/subject/1' }],
      candidateSources: [{ source: 'vndb', url: 'https://vndb.org/v1', note: 'matched' }],
      existingState: {},
      writeProtection: { protected: false, reasons: [] },
      catalogQueue: { queue: 'ready_for_ai_assessment' },
      ...overrides.canonicalRow,
    },
    response: {
      workId: '1',
      siteId: 'work:1',
      title: 'Example',
      evidenceCoverage: 0.8,
      evidenceStatus: 'multiple_secondary_supported',
      sourceSummary: 'Two sources support the result.',
      ruleAssessments: [{
        code: 'A-ONGOING',
        matched: true,
        confidence: 0.9,
        reason: 'Stable F/F direction.',
        sources: [],
      }],
      contradictions: [],
      assessmentNotes: [],
      ...overrides.response,
    },
    resolution: {
      batchId: 'RADAR-ASSESS-0001',
      workId: '1',
      siteId: 'work:1',
      title: 'Example',
      grade: 'A',
      ruleCodes: ['A-ONGOING'],
      ...overrides.resolution,
    },
    guard: overrides.guard,
    packageManifest: manifest,
  })
}

test('accepts the fixed v0.6 package manifest shape', () => {
  assert.deepEqual(validatePackageManifest(manifest), [])
})

test('combines model and canonical sources for honest provenance', () => {
  const sources = collectTraceableSources({
    sourceLinks: [{ label: 'Bangumi', url: 'https://bgm.tv/subject/1' }],
    candidateSources: [{ source: 'vndb', url: 'https://vndb.org/v1', note: 'matched' }],
  }, { ruleAssessments: [] })
  assert.equal(sources.length, 2)
  assert.deepEqual(provenanceBlockers('multiple_secondary_supported', sources.length), [])
})

test('preserves publication guard as review reasons without changing the provisional grade', () => {
  const row = fixture({ guard: { guardReasons: ['low_evidence_coverage'] } })
  assert.equal(row.currentGradeSuggestion, 'A')
  assert.equal(row.needsPublicationGuard, true)
  assert.ok(row.reviewReasons.includes('radar_publication_guard'))
  assert.ok(row.warnings.includes('publication_guard:low_evidence_coverage'))
})

test('keeps historical D-ABO code mapped to grade E', () => {
  const row = fixture({
    response: {
      evidenceStatus: 'single_secondary_supported',
      ruleAssessments: [{
        code: 'D-ABO',
        matched: true,
        confidence: 0.9,
        reason: 'ABO setting.',
        sources: [{ label: 'Source' }],
      }],
    },
    resolution: { grade: 'E', ruleCodes: ['D-ABO'] },
  })
  assert.equal(row.currentGradeSuggestion, 'E')
  assert.equal(row.blockers.length, 0)
})

test('blocks multiple-secondary claims when merged sources still total fewer than two', () => {
  const row = fixture({ canonicalRow: { candidateSources: [] } })
  assert.ok(row.blockers.includes('multiple_secondary_requires_two_traceable_sources'))
})

test('never trusts model-supplied identity over the canonical catalog row', () => {
  const row = fixture({ response: { siteId: 'wrong' } })
  assert.equal(row.siteId, 'work:1')
  assert.ok(row.blockers.includes('response_site_id_mismatch'))
})
