import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

import { buildDesiredPublicRating } from '../scripts/radar/lib/unified-rating-release-plan-v01.mjs'
import { payloadDocument } from '../scripts/radar/run-unified-rating-incremental-production-import-9988-v01.mjs'

const candidateSource = readFileSync('src/collections/RadarPublicConclusions.ts', 'utf8')
const publishedSource = readFileSync('src/collections/RadarPublicRatings.ts', 'utf8')
const contract = JSON.parse(readFileSync('config/radar-public-ratings-schema-v01.json', 'utf8'))

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

function generatedV05MigrationPairs() {
  const names = readdirSync('src/migrations')
  const ts = names.filter((name) => name.endsWith('_radar_v05_persistence_standardization_v01.ts'))
  const json = names.filter((name) => name.endsWith('_radar_v05_persistence_standardization_v01.json'))
  return { ts, json }
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

test('a generated v0.5 Payload migration, when present, is paired with its schema snapshot', () => {
  const { ts, json } = generatedV05MigrationPairs()
  assert.ok(ts.length <= 1, `expected at most one v0.5 migration TS, got ${ts.join(', ')}`)
  assert.ok(json.length <= 1, `expected at most one v0.5 migration snapshot, got ${json.join(', ')}`)
  assert.equal(ts.length, json.length, 'v0.5 migration TS and JSON snapshot must be a pair')
  if (ts.length === 0) return

  const tsStem = ts[0].replace(/\.ts$/u, '')
  const jsonStem = json[0].replace(/\.json$/u, '')
  assert.equal(tsStem, jsonStem)
  assert.ok(existsSync(`src/migrations/${json[0]}`))

  const migrationSource = readFileSync(`src/migrations/${ts[0]}`, 'utf8')
  const migrationSnapshot = readFileSync(`src/migrations/${json[0]}`, 'utf8')
  const migrationIndex = readFileSync('src/migrations/index.ts', 'utf8')

  for (const token of ['radar_public', 'radar_public_ratings', 'compatibility_grade', 'conclusion_mode', 'labels_only', 'blocked']) {
    assert.match(migrationSource, new RegExp(token, 'u'))
  }
  for (const token of ['public.radar_public', 'public.radar_public_ratings', 'public.radar_public_records', 'public.works']) {
    assert.match(migrationSnapshot, new RegExp(token.replace('.', '\\.'), 'u'))
  }
  assert.equal((migrationIndex.match(new RegExp(`name: '${tsStem}'`, 'gu')) || []).length, 1)
  assert.match(migrationIndex, new RegExp(`from './${tsStem}'`, 'u'))
})
