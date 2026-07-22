import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ASSESSMENT_TRACK_FIELDS,
  buildAssessmentTracks,
} from '../scripts/export/assessment-track-presentation.mjs'
import {
  conclusionByWorkID,
  fetchPublicConclusions,
  overlayConclusion,
  overlayPublicConclusions,
} from '../scripts/export/enrich-public-radar-conclusions.mjs'

const repoRoot = process.cwd()
const collectionSource = fs.readFileSync(
  path.join(repoRoot, 'src/collections/RadarPublicConclusions.ts'),
  'utf8',
)
const payloadConfig = fs.readFileSync(path.join(repoRoot, 'payload.config.ts'), 'utf8')
const overlaySource = fs.readFileSync(
  path.join(repoRoot, 'scripts/export/enrich-public-radar-conclusions.mjs'),
  'utf8',
)
const trackSource = fs.readFileSync(
  path.join(repoRoot, 'scripts/export/assessment-track-presentation.mjs'),
  'utf8',
)
const exportWrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/export/build-and-enrich-lite-search-index.mjs'),
  'utf8',
)

function conclusion(overrides = {}) {
  return {
    id: 20,
    publicationKey: 'work:10',
    work: 10,
    workIdSnapshot: '10',
    title: '示例作品',
    recordStatus: 'current',
    conclusionMode: 'fixed_grade',
    compatibilityGrade: 'A',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['radar_v06_package_import'],
    evidenceStrength: 'medium',
    sourceKind: 'package',
    radarAssessment: {
      suggestedGrade: 'A',
      sourceSummary: '新的公开 AI 结论',
      decisiveRuleCode: 'A-NEAR-CONFIRMED',
      decisiveRuleReason: '现有资料支持 A。',
      confidencePercent: 82,
      evidenceCoveragePercent: 70,
      sourceCount: 3,
      requiresHumanReview: true,
      assessedAt: '2026-07-22T00:00:00.000Z',
    },
    publishedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  }
}

test('collection is public-read, staff-write, versionless, and separate from Works', () => {
  assert.match(collectionSource, /slug: 'radar-public-conclusions'/u)
  assert.match(collectionSource, /dbName: 'radar_public'/u)
  assert.match(collectionSource, /read: currentPublicOrStaff/u)
  assert.match(collectionSource, /create: editorsAndUp/u)
  assert.match(collectionSource, /update: editorsAndUp/u)
  assert.match(collectionSource, /delete: adminsOnly/u)
  assert.match(collectionSource, /disableBulkDelete: true/u)
  assert.match(collectionSource, /lockDocuments: false/u)
  assert.doesNotMatch(collectionSource, /versions:/u)
  assert.doesNotMatch(collectionSource, /humanAssessment/u)
  assert.match(payloadConfig, /RadarPublicConclusionsWithAudit/u)
  assert.match(
    payloadConfig,
    /\.\.\.\(radarPublicConclusionsSchemaReady \? \[RadarPublicConclusionsWithAudit\] : \[\]\)/u,
  )
})

test('short database name keeps the deepest generated enum below the Postgres limit', () => {
  const generatedEnumName = 'enum_radar_public_radar_assessment_matched_rules_grade'
  assert.ok(generatedEnumName.length <= 63)
})

test('public fetch filters current records and never writes Works', async () => {
  const urls = []
  const docs = await fetchPublicConclusions('http://127.0.0.1:3000', async (url, options) => {
    urls.push({ url, options })
    return { docs: [conclusion()], totalPages: 1 }
  })

  assert.equal(docs.length, 1)
  assert.equal(urls.length, 1)
  assert.match(urls[0].url, /\/api\/radar-public-conclusions\?/u)
  assert.match(urls[0].url, /where%5BrecordStatus%5D%5Bequals%5D=current/u)
  assert.equal(urls[0].options, undefined)
  assert.doesNotMatch(overlaySource, /method:\s*['"](?:PATCH|POST|DELETE)['"]/u)
  assert.doesNotMatch(overlaySource, /\/api\/works/u)
  assert.doesNotMatch(overlaySource, /legacy_x_wiki_page/u)
  assert.doesNotMatch(trackSource, /legacy_x_wiki_page/u)
})

test('new current AI conclusion supersedes an older AI conclusion for the same Work', () => {
  const byWork = conclusionByWorkID([
    conclusion({ id: 1, compatibilityGrade: 'B', publishedAt: '2026-07-20T00:00:00.000Z' }),
    conclusion({ id: 2, compatibilityGrade: 'A', publishedAt: '2026-07-22T00:00:00.000Z' }),
    conclusion({ id: 3, recordStatus: 'withdrawn', compatibilityGrade: 'S', publishedAt: '2026-07-23T00:00:00.000Z' }),
  ])

  assert.equal(byWork.size, 1)
  assert.equal(byWork.get('10').compatibilityGrade, 'A')
})

test('human and AI tracks expose the same presentation fields and human grade wins', () => {
  const item = {
    collection: 'works',
    recordId: '10',
    rank: 'E',
    humanAssessment: {
      grade: 'S',
      status: 'reviewed',
      note: '人工判断说明',
      sourceSummary: '人工核对原作与官方材料。',
      sourceLinks: [{ label: '官方页面', url: 'https://example.test/work' }],
      evidenceStatus: 'primary_checked',
      assessedAt: '2026-07-21T00:00:00.000Z',
      assessedBy: 7,
    },
    ratingNotice: 'manual_reviewed',
    reviewReasons: ['manual_review', 'radar_publication_guard'],
    evidenceStrength: 'strong',
    radarAssessment: { suggestedGrade: 'B', sourceSummary: '旧 AI 结论' },
    searchText: '示例作品',
  }

  const result = overlayConclusion(item, conclusion())
  assert.equal(result.rank, 'S')
  assert.equal(result.effectiveGrade, 'S')
  assert.equal(result.effectiveGradeSource, 'human')
  assert.equal(result.ratingNotice, 'manual_reviewed')
  assert.equal(result.radarAssessment.suggestedGrade, 'A')
  assert.deepEqual(result.reviewReasons, ['manual_review', 'radar_v06_package_import'])
  assert.deepEqual(Object.keys(result.assessmentTracks.human), ASSESSMENT_TRACK_FIELDS)
  assert.deepEqual(Object.keys(result.assessmentTracks.ai), ASSESSMENT_TRACK_FIELDS)
  assert.equal(result.assessmentTracks.human.summary, '人工判断说明')
  assert.equal(result.assessmentTracks.ai.summary, '现有资料支持 A。')
})

test('pending human grade is reference material but does not override a current public AI grade', () => {
  const tracks = buildAssessmentTracks({
    humanAssessment: {
      grade: 'S',
      status: 'pending',
      note: '尚未形成有效人工结论。',
    },
  }, conclusion({ compatibilityGrade: 'B' }))

  assert.equal(tracks.human.grade, 'S')
  assert.equal(tracks.human.state, 'pending')
  assert.equal(tracks.effectiveGrade, 'B')
  assert.equal(tracks.effectiveGradeSource, 'ai')
})

test('AI grade becomes effective when no valid human grade exists', () => {
  const index = {
    schemaVersion: 5,
    counts: { works: 1 },
    items: [{
      collection: 'works',
      recordId: '10',
      rank: 'E',
      reviewReasons: [],
      searchText: '示例作品',
    }],
  }

  const result = overlayPublicConclusions(index, [conclusion()])
  assert.equal(result.currentRecords, 1)
  assert.equal(result.matchedWorks, 1)
  assert.equal(result.index.schemaVersion, 7)
  assert.equal(result.index.items[0].rank, 'A')
  assert.equal(result.index.items[0].effectiveGradeSource, 'ai')
  assert.equal(result.index.items[0].radarAssessment.suggestedGrade, 'A')
  assert.equal(result.index.counts['radar-public-conclusions'], 1)
  assert.deepEqual(result.index.radarPublicConclusions.gradePriority, ['human', 'ai', 'unknown'])
  assert.equal(result.index.radarPublicConclusions.rankIsCompatibilityOnly, true)
})

test('stale compatibility rank is ignored when neither valid human nor public AI assessment exists', () => {
  const result = overlayConclusion({
    collection: 'works',
    recordId: '10',
    rank: 'E',
    reviewStatus: 'pending',
    reviewReasons: ['radar_publication_guard'],
    radarAssessment: { suggestedGrade: 'E', sourceSummary: '未公开的旧 AI 草稿' },
  })

  assert.equal(result.rank, 'unknown')
  assert.equal(result.effectiveGrade, 'unknown')
  assert.equal(result.effectiveGradeSource, 'none')
  assert.equal(result.ratingNotice, 'insufficient_information')
  assert.equal(result.radarAssessment, undefined)
  assert.deepEqual(result.reviewReasons, [])
})

test('legacy human fields are transitional fallback only and disagreements remain visible', () => {
  const result = overlayConclusion({
    collection: 'works',
    recordId: '10',
    humanAssessment: {
      grade: 'A',
      status: 'reviewed',
      note: '采用新的人工审核说明。',
    },
    reviewStatus: 'pending',
    humanReviewNote: '旧人工审核说明。',
    humanReviewedAt: '2026-07-20T00:00:00.000Z',
  }, conclusion({ compatibilityGrade: 'B' }))

  assert.equal(result.effectiveGrade, 'A')
  assert.equal(result.effectiveGradeSource, 'human')
  assert.equal(result.assessmentTracks.human.provenance, 'humanAssessment_with_legacy_fallback')
  assert.ok(result.assessmentTracks.human.contradictions.some((value) => value.includes('状态不一致')))
  assert.ok(result.assessmentTracks.human.contradictions.some((value) => value.includes('说明不一致')))
})

test('bounded conclusion exposes the full range without changing human priority', () => {
  const result = overlayConclusion({
    collection: 'works',
    recordId: '10',
    rank: 'unknown',
    reviewReasons: [],
  }, conclusion({
    conclusionMode: 'bounded_range',
    compatibilityGrade: 'D',
    bestGrade: 'C',
    likelyGrade: 'D',
    worstGrade: 'E',
    radarAssessment: {
      suggestedGrade: 'D',
      sourceSummary: 'AI 暂定范围 C–E，最可能 D。',
      assessedAt: '2026-07-22T00:00:00.000Z',
    },
  }))

  assert.equal(result.rank, 'D')
  assert.deepEqual(
    [result.assessmentTracks.ai.bestGrade, result.assessmentTracks.ai.likelyGrade, result.assessmentTracks.ai.worstGrade],
    ['C', 'D', 'E'],
  )
  assert.deepEqual(
    [result.researchPreview.bestGrade, result.researchPreview.likelyGrade, result.researchPreview.worstGrade],
    ['C', 'D', 'E'],
  )
})

test('standard search export applies public conclusion overlay before compaction', () => {
  const overlayPosition = exportWrapper.indexOf('enrich-public-radar-conclusions.mjs')
  const compactPosition = exportWrapper.indexOf('compact-public-index.mjs')
  assert.ok(overlayPosition > 0)
  assert.ok(compactPosition > overlayPosition)
})
