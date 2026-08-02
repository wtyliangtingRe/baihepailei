import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCurrentRecordIndexes,
  buildPlanRow,
  buildWorkIndexes,
} from '../scripts/radar/lib/public-release-plan-v01.mjs'

const release = {
  releaseId: 'RADAR-PUBLIC-RELEASE-0001',
  sourceCommitSha: 'a'.repeat(40),
  policyVersion: 'test-policy',
  researchSnapshotId: 'snapshot-1',
  recordsSha256: 'b'.repeat(64),
}
const importedAt = '2026-08-01T00:00:00Z'

function record(overrides = {}) {
  return {
    schemaVersion: 'radar-public-record-v01',
    workId: '10',
    siteId: 'catalog-anilist-20',
    identityKey: '10|catalog-anilist-20',
    title: 'Example',
    aliases: [],
    externalIds: { anilist: '20' },
    publicState: 'partial',
    researchStatus: 'partially_verified',
    lastReviewedAt: '2026-08-01T00:00:00Z',
    pageNotice: '部分资料已核实。',
    facts: [{ factId: 'fact-1', type: 'source_page_title', value: 'Example', sourceRefs: ['src-1'] }],
    evidence: [{ sourceRef: 'src-1', tier: 'A', role: 'primary', url: 'https://example.com/20', title: 'Example', exactIdentityBound: true }],
    ...overrides,
  }
}

const works = [{ id: 10, siteId: 'catalog-anilist-20', title: 'Example in Payload' }]

test('plans an exact work create without touching Works', () => {
  const row = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([]), release, importedAt)
  assert.equal(row.planStatus, 'ready_create')
  assert.equal(row.target.id, '10')
  assert.equal(row.desired.publicationKey, 'work:10')
  assert.equal(row.desired.work, '10')
  assert.equal(row.desired.facts[0].factType, 'source_page_title')
  assert.deepEqual(row.desired.facts[0].sourceRefs, [{ value: 'src-1' }])
  assert.equal(row.desired.sourceReviewedAt, '2026-08-01T00:00:00.000Z')
  assert.equal(row.desired.recordStatus, 'current')
  assert.equal('humanAssessment' in row.desired, false)
  assert.equal('radarAssessment' in row.desired, false)
})

test('blocks title matches when exact identifiers are absent', () => {
  const row = buildPlanRow(record({ workId: '999', siteId: 'missing-site' }), buildWorkIndexes(works), buildCurrentRecordIndexes([]), release, importedAt)
  assert.equal(row.planStatus, 'blocked_missing_exact_work')
  assert.equal(row.target, null)
})

test('blocks work ID and site ID split across different works', () => {
  const splitWorks = [
    { id: 10, siteId: 'catalog-anilist-999', title: 'Wrong by ID' },
    { id: 11, siteId: 'catalog-anilist-20', title: 'Wrong by site ID' },
  ]
  const row = buildPlanRow(record(), buildWorkIndexes(splitWorks), buildCurrentRecordIndexes([]), release, importedAt)
  assert.equal(row.planStatus, 'blocked_identity_conflict')
  assert.match(row.blockers[0], /work_id_site_id_mismatch/u)
})

test('recognizes an already current public projection', () => {
  const first = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([]), release, importedAt)
  const current = { id: 77, ...first.desired }
  const second = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([current]), release, '2026-08-02T00:00:00Z')
  assert.equal(second.planStatus, 'already_current')
  assert.equal(second.currentRecordId, '77')
})

test('recognizes Payload-normalized review dates as the same instant', () => {
  const first = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([]), release, importedAt)
  const current = {
    id: 77,
    ...first.desired,
    sourceReviewedAt: '2026-08-01T08:00:00.000+08:00',
  }
  const second = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([current]), release, importedAt)
  assert.equal(second.planStatus, 'already_current')
})

test('plans update when the review timestamp instant changes', () => {
  const first = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([]), release, importedAt)
  const current = {
    id: 77,
    ...first.desired,
    sourceReviewedAt: '2026-08-01T00:00:01.000Z',
  }
  const second = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([current]), release, importedAt)
  assert.equal(second.planStatus, 'ready_update')
})

test('plans update when release-bound content changes', () => {
  const first = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([]), release, importedAt)
  const current = { id: 77, ...first.desired }
  const changed = record({ pageNotice: '新的资料提示。' })
  const second = buildPlanRow(changed, buildWorkIndexes(works), buildCurrentRecordIndexes([current]), release, importedAt)
  assert.equal(second.planStatus, 'ready_update')
})

test('blocks an existing public record bound to another identity', () => {
  const first = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([]), release, importedAt)
  const current = { id: 77, ...first.desired, identityKey: '999|wrong' }
  const second = buildPlanRow(record(), buildWorkIndexes(works), buildCurrentRecordIndexes([current]), release, importedAt)
  assert.equal(second.planStatus, 'blocked_existing_publication_identity_conflict')
})
