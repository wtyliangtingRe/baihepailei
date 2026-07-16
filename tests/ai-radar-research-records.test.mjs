import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROGRAM_ID,
  buildResearchRecord,
  normalizeResearchRecord,
  stableEqual,
  toPayloadData,
} from '../scripts/radar/import-ai-radar-research-records-v01.mjs'

const batch = {
  batchId: 'W01-BLOCKED_SUMMARY_REPAIR-0001',
  wave: 'W01',
  lane: 'blocked_summary_repair',
  milestone: 1,
  responseSha256: 'a'.repeat(64),
}

test('blocked rows preserve grade range and next action', () => {
  const record = buildResearchRecord({
    workId: 123,
    siteId: 'VNDB-V1',
    title: 'Example',
    researchStatus: 'partial',
    proposedLikelyGrade: 'D',
    proposedBestGrade: 'C',
    proposedWorstGrade: 'E',
    sourceSummary: 'summary',
    sources: [{ title: 'VNDB', url: 'https://vndb.org/v1', sourceType: 'secondary' }],
    unresolvedQuestions: ['ending'],
    confidencePercent: 55,
    recommendedNextAction: 'retain_block',
    researchNote: 'internal only',
  }, batch, '2026-07-16T00:00:00.000Z')

  assert.equal(record.researchKey, `${PROGRAM_ID}|123|VNDB-V1`)
  assert.equal(record.recordShape, 'blocked')
  assert.equal(record.proposedLikelyGrade, 'D')
  assert.equal(record.recommendedNextAction, 'retain_block')
  assert.equal(record.recommendedNextQueue, '')
  assert.deepEqual(record.unresolvedQuestions, [{ value: 'ending' }])
})

test('catalog rows preserve triage fields without inventing grades', () => {
  const record = buildResearchRecord({
    workId: 456,
    siteId: 'catalog-anilist-1',
    title: 'Catalog Example',
    researchStatus: 'partial',
    yuriRelevance: 'possible',
    riskSignals: ['male_involvement', 'other'],
    sourceSummary: 'metadata triage',
    sources: [],
    confidencePercent: 35,
    recommendedNextQueue: 'more_research',
    researchNote: 'not a rating',
  }, {
    ...batch,
    batchId: 'W03-CATALOG_TIER1_YURI_RISK-0001',
    wave: 'W03',
    lane: 'catalog_tier1_yuri_risk',
  }, '2026-07-16T00:00:00.000Z')

  assert.equal(record.recordShape, 'catalog')
  assert.equal(record.proposedLikelyGrade, '')
  assert.equal(record.recommendedNextAction, '')
  assert.equal(record.recommendedNextQueue, 'more_research')
  assert.deepEqual(record.riskSignals, ['male_involvement', 'other'])
})

test('Payload-generated array ids and relationship objects do not cause false drift', () => {
  const target = normalizeResearchRecord({
    researchKey: `${PROGRAM_ID}|1|SITE-1`,
    title: 'One',
    programId: PROGRAM_ID,
    importBatch: 'ai-radar-research-complete-v01',
    batchId: 'W01-X-0001',
    wave: 'W01',
    lane: 'x',
    milestone: 1,
    work: '1',
    workIdSnapshot: '1',
    workSiteId: 'SITE-1',
    recordShape: 'blocked',
    researchStatus: 'resolved',
    sources: [{ title: 'A', url: 'https://example.com', sourceType: 'official' }],
    unresolvedQuestions: [{ value: 'Q' }],
    confidencePercent: 80,
    sourceResponseSha256: 'b'.repeat(64),
    importedAt: '2026-07-16T00:00:00.000Z',
    recordStatus: 'current',
  })

  const payloadShape = {
    ...target,
    work: { id: 1, title: 'One' },
    sources: [{ id: 'row-1', ...target.sources[0] }],
    unresolvedQuestions: [{ id: 'row-2', value: 'Q' }],
  }
  assert.equal(stableEqual(payloadShape, target), true)
})
test('Payload write data uses numeric relationships and omits empty optional selects', () => {
  const blocked = buildResearchRecord({
    workId: 33269,
    siteId: 'VNDB-V15860',
    title: 'Quantum Conscience',
    researchStatus: 'insufficient',
    proposedLikelyGrade: 'D',
    proposedBestGrade: 'unknown',
    proposedWorstGrade: 'unknown',
    sourceSummary: 'summary',
    sources: [],
    unresolvedQuestions: ['ending'],
    confidencePercent: 35,
    recommendedNextAction: 'retain_block',
  }, batch, '2026-07-16T00:00:00.000Z')

  const blockedPayload = toPayloadData(blocked)
  assert.equal(blockedPayload.work, 33269)
  assert.equal(blockedPayload.recommendedNextAction, 'retain_block')
  assert.equal(Object.hasOwn(blockedPayload, 'yuriRelevance'), false)
  assert.equal(Object.hasOwn(blockedPayload, 'recommendedNextQueue'), false)

  const catalog = buildResearchRecord({
    workId: 456,
    siteId: 'catalog-anilist-1',
    title: 'Catalog Example',
    researchStatus: 'partial',
    yuriRelevance: 'possible',
    riskSignals: [],
    confidencePercent: 35,
    recommendedNextQueue: 'more_research',
  }, {
    ...batch,
    batchId: 'W03-CATALOG_TIER1_YURI_RISK-0001',
    wave: 'W03',
    lane: 'catalog_tier1_yuri_risk',
  }, '2026-07-16T00:00:00.000Z')

  const catalogPayload = toPayloadData(catalog)
  assert.equal(catalogPayload.work, 456)
  assert.equal(catalogPayload.yuriRelevance, 'possible')
  assert.equal(catalogPayload.recommendedNextQueue, 'more_research')
  assert.equal(Object.hasOwn(catalogPayload, 'recommendedNextAction'), false)
  assert.equal(Object.hasOwn(catalogPayload, 'proposedLikelyGrade'), false)
})
test('equivalent importedAt timestamps normalize to the same UTC instant', () => {
  const expected = normalizeResearchRecord({
    researchKey: `${PROGRAM_ID}|33269|VNDB-V15860`,
    title: 'Quantum Conscience',
    importedAt: '2026-07-16T00:49:36.336430+00:00',
  })

  const actual = normalizeResearchRecord({
    researchKey: `${PROGRAM_ID}|33269|VNDB-V15860`,
    title: 'Quantum Conscience',
    importedAt: '2026-07-16T00:49:36.336Z',
  })

  assert.equal(expected.importedAt, '2026-07-16T00:49:36.336Z')
  assert.equal(actual.importedAt, '2026-07-16T00:49:36.336Z')
  assert.equal(stableEqual(expected, actual), true)
})

