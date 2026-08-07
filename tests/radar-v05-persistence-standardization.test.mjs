import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { buildDesiredPublicRating } from '../scripts/radar/lib/unified-rating-release-plan-v01.mjs'
import { payloadDocument } from '../scripts/radar/run-unified-rating-incremental-production-import-9988-v01.mjs'

const candidateSource = fs.readFileSync('src/collections/RadarPublicConclusions.ts', 'utf8')
const publishedSource = fs.readFileSync('src/collections/RadarPublicRatings.ts', 'utf8')
const contract = JSON.parse(fs.readFileSync('config/radar-public-ratings-schema-v01.json', 'utf8'))
const migrationSource = fs.readFileSync('src/migrations/20260808_060000_radar_v05_persistence_standardization_v01.ts', 'utf8')
const migrationIndex = fs.readFileSync('src/migrations/index.ts', 'utf8')

const importedAt = '2026-08-08T00:00:00.000Z'
const work = { id: '42', siteId: 'SITE-42', title: 'Example' }
const release = {
  releaseId: 'RADAR-V05-TEST',
  sourceCommitSha: 'a'.repeat(40),
  policyVersion: 'radar-rating-policy-v0.5',
  researchSnapshotId: 'snapshot-v05',
  ratingsSha256: 'b'.repeat(64),
}

function rating(overrides = {}) {
  return {
    identityKey: '42|SITE-42',
    workId: '42',
    siteId: 'SITE-42',
    title: 'Example',
    coreGrade: 'A',
    bestGrade: 'A',
    likelyGrade: 'A',
    worstGrade: 'A',
    confidence: 'medium',
    matchedClasses: ['A-TEST'],
    factRefs: ['fact-42'],
    evidenceRefs: ['source-42'],
    reasoningSummary: 'Test conclusion.',
    unresolvedDimensions: [],
    classificationRule: 'test_rule',
    confirmationBasis: ['test_basis'],
    benefitOfDoubtBaselineApplied: false,
    publicTagHints: [],
    publicWarningTemplateIds: [],
    humanReview: {
      status: 'unreviewed',
      reviewerIdentity: null,
      reviewedAt: null,
      decision: null,
      proposedCoreGrade: null,
      proposedProfileChanges: [],
      reasoning: null,
      additionalEvidenceRefs: [],
      moderationState: null,
      blocksAnalysis: false,
      blocksPublication: false,
    },
    sourceRatingCampaignId: 'ASSESSMENT-TEST',
    sourceRatingDecisionHash: 'decision-42',
    releaseRatingHash: 'release-42',
    ...overrides,
  }
}

function fieldBlock(source, name) {
  const start = source.indexOf(`      name: '${name}',`)
  assert.notEqual(start, -1, `missing field ${name}`)
  const next = source.indexOf("\n    },\n    {\n      name: '", start)
  return source.slice(start, next === -1 ? source.length : next + 7)
}

function desired(overrides = {}) {
  return buildDesiredPublicRating(rating(overrides), work, release, importedAt)
}

test('Candidate persistence natively supports all v0.5 conclusion modes without a required compatibility grade', () => {
  const mode = fieldBlock(candidateSource, 'conclusionMode')
  for (const value of ['fixed_grade', 'bounded_range', 'labels_only', 'blocked']) {
    assert.match(mode, new RegExp(`value: '${value}'`, 'u'))
  }
  assert.doesNotMatch(fieldBlock(candidateSource, 'compatibilityGrade'), /required: true/u)
})

test('Published persistence exposes the same four modes and permits grade-less states', () => {
  assert.deepEqual(contract.conclusionModes, ['fixed_grade', 'bounded_range', 'labels_only', 'blocked'])
  assert.equal(contract.legacyNullConclusionMode, true)
  assert.deepEqual(contract.gradeFieldsNullableFor, ['labels_only', 'blocked'])
  assert.ok(contract.fields.rating.includes('conclusionMode'))

  const mode = fieldBlock(publishedSource, 'conclusionMode')
  assert.doesNotMatch(mode, /required: true/u)
  for (const value of contract.conclusionModes) assert.match(mode, new RegExp(`value: '${value}'`, 'u'))
  for (const field of ['coreGrade', 'bestGrade', 'likelyGrade', 'worstGrade']) {
    assert.doesNotMatch(fieldBlock(publishedSource, field), /required: true/u)
  }
})

test('historical Published releases keep null mode and their original grade projection', () => {
  const document = desired()
  assert.equal(document.conclusionMode, null)
  assert.deepEqual(
    [document.coreGrade, document.bestGrade, document.likelyGrade, document.worstGrade],
    ['A', 'A', 'A', 'A'],
  )
})

test('explicit fixed and bounded v0.5 releases persist deterministic grade semantics', () => {
  const fixed = desired({ conclusionMode: 'fixed_grade' })
  assert.equal(fixed.conclusionMode, 'fixed_grade')
  assert.deepEqual([fixed.coreGrade, fixed.bestGrade, fixed.likelyGrade, fixed.worstGrade], ['A', 'A', 'A', 'A'])

  const bounded = desired({
    conclusionMode: 'bounded_range',
    coreGrade: 'D',
    bestGrade: 'C',
    likelyGrade: 'D',
    worstGrade: 'E',
  })
  assert.equal(bounded.conclusionMode, 'bounded_range')
  assert.deepEqual([bounded.coreGrade, bounded.bestGrade, bounded.likelyGrade, bounded.worstGrade], ['D', 'C', 'D', 'E'])
})

test('labels_only and blocked persist without ghost grades and survive the active incremental importer payload', () => {
  for (const conclusionMode of ['labels_only', 'blocked']) {
    const document = desired({
      conclusionMode,
      coreGrade: 'D',
      bestGrade: 'C',
      likelyGrade: 'D',
      worstGrade: 'E',
    })
    assert.equal(document.conclusionMode, conclusionMode)
    assert.deepEqual([document.coreGrade, document.bestGrade, document.likelyGrade, document.worstGrade], [null, null, null, null])

    const payload = payloadDocument(document)
    assert.equal(payload.conclusionMode, conclusionMode)
    assert.deepEqual([payload.coreGrade, payload.bestGrade, payload.likelyGrade, payload.worstGrade], [null, null, null, null])
  }
})

test('new machine X cannot be persisted as an explicit fixed grade', () => {
  const document = desired({
    conclusionMode: 'fixed_grade',
    coreGrade: 'X',
    bestGrade: 'X',
    likelyGrade: 'X',
    worstGrade: 'X',
  })
  assert.equal(document.conclusionMode, 'labels_only')
  assert.deepEqual([document.coreGrade, document.bestGrade, document.likelyGrade, document.worstGrade], [null, null, null, null])
})

test('migration expands Candidate, adds Published mode, relaxes grade constraints, and refuses destructive rollback', () => {
  assert.match(migrationSource, /enum_radar_public_conclusion_mode[^;]+ADD VALUE IF NOT EXISTS 'labels_only'/u)
  assert.match(migrationSource, /enum_radar_public_conclusion_mode[^;]+ADD VALUE IF NOT EXISTS 'blocked'/u)
  assert.match(migrationSource, /radar_public[^;]+compatibility_grade[^;]+DROP NOT NULL/u)
  assert.match(migrationSource, /enum_radar_public_ratings_conclusion_mode[^;]+fixed_grade[^;]+bounded_range[^;]+labels_only[^;]+blocked/u)
  for (const column of ['core_grade', 'best_grade', 'likely_grade', 'worst_grade']) {
    assert.match(migrationSource, new RegExp(`radar_public_ratings[^;]+${column}[^;]+DROP NOT NULL`, 'u'))
  }
  assert.match(migrationSource, /Cannot safely roll back Radar v0\.5 persistence/u)
  assert.match(migrationIndex, /20260808_060000_radar_v05_persistence_standardization_v01/u)
})
