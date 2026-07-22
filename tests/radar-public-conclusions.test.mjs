import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

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
    radarAssessment: {
      suggestedGrade: 'A',
      sourceSummary: '新的公开 AI 结论',
      decisiveRuleCode: 'A-NEAR-CONFIRMED',
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

test('AI overlay preserves human priority and replaces stale Radar review reasons', () => {
  const item = {
    collection: 'works',
    recordId: '10',
    rank: 'S',
    humanGrade: 'S',
    humanAssessment: { grade: 'S', status: 'reviewed' },
    ratingNotice: 'manual_reviewed',
    reviewReasons: ['manual_review', 'radar_publication_guard'],
    evidenceStrength: 'strong',
    radarAssessment: { suggestedGrade: 'B', sourceSummary: '旧 AI 结论' },
    searchText: '示例作品',
  }

  const result = overlayConclusion(item, conclusion())
  assert.equal(result.rank, 'S')
  assert.equal(result.ratingNotice, 'manual_reviewed')
  assert.equal(result.radarAssessment.suggestedGrade, 'A')
  assert.deepEqual(result.reviewReasons, ['manual_review', 'radar_v06_package_import'])
})

test('AI grade becomes effective when no human grade exists', () => {
  const index = {
    schemaVersion: 5,
    counts: { works: 1 },
    items: [{
      collection: 'works',
      recordId: '10',
      rank: 'unknown',
      reviewReasons: [],
      searchText: '示例作品',
    }],
  }

  const result = overlayPublicConclusions(index, [conclusion()])
  assert.equal(result.currentRecords, 1)
  assert.equal(result.matchedWorks, 1)
  assert.equal(result.index.schemaVersion, 6)
  assert.equal(result.index.items[0].rank, 'A')
  assert.equal(result.index.items[0].radarAssessment.suggestedGrade, 'A')
  assert.equal(result.index.counts['radar-public-conclusions'], 1)
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
