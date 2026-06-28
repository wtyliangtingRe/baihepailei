import test from 'node:test'
import assert from 'node:assert/strict'

import { auditPayloadCandidateData } from '../scripts/import/audit-payload-candidates.mjs'

function candidateWork(overrides = {}) {
  return {
    title: '作品A',
    slug: 'bangumi-1',
    status: 'draft',
    isLiteVisible: false,
    isFullVisible: false,
    externalIds: { bangumiSubjectId: '1' },
    candidateSources: [{ source: 'bangumi', label: 'Bangumi', externalId: '1' }],
    evidenceNote: '## Bangumi 简介候选\n简介\n\n## Bangumi 创作者职位候选\n- A | role=director\n\n## Bangumi 机构/制作候选\n- B | role=committee',
    ...overrides,
  }
}

test('payload candidate audit passes safe hidden draft Bangumi works', () => {
  const works = [
    candidateWork(),
    candidateWork({ title: '作品B', slug: 'bangumi-2', externalIds: { bangumiSubjectId: '2' }, candidateSources: [{ source: 'bangumi', externalId: '2' }] }),
  ]
  const audit = auditPayloadCandidateData({ works, rulesTotal: 2, expectedWorks: 2, expectedRules: 2 })

  assert.equal(audit.summary.worksTotal, 2)
  assert.equal(audit.summary.rulesTotal, 2)
  assert.equal(audit.summary.draft, 2)
  assert.equal(audit.summary.liteHidden, 2)
  assert.equal(audit.summary.fullHidden, 2)
  assert.equal(audit.summary.evidenceNote, 2)
  assert.equal(audit.summary.summaryHint, 2)
  assert.equal(audit.summary.creatorHint, 2)
  assert.equal(audit.summary.organizationHint, 2)
  assert.equal(audit.summary.duplicateBangumiIds, 0)
  assert.equal(audit.summary.duplicateSlugs, 0)
  assert.equal(audit.checks.every((check) => check.ok), true)
})

test('payload candidate audit reports visible works and duplicate IDs', () => {
  const works = [
    candidateWork({ slug: 'bangumi-1', externalIds: { bangumiSubjectId: '1' }, isLiteVisible: true }),
    candidateWork({ title: '作品B', slug: 'bangumi-1', externalIds: { bangumiSubjectId: '1' } }),
  ]
  const audit = auditPayloadCandidateData({ works, rulesTotal: 1, expectedWorks: 2, expectedRules: 2 })

  assert.equal(audit.summary.duplicateBangumiIds, 1)
  assert.equal(audit.summary.duplicateSlugs, 1)
  assert.equal(audit.samples.publishedOrVisible.length, 1)
  assert.equal(audit.checks.some((check) => !check.ok && check.name === 'all works are Lite hidden'), true)
  assert.equal(audit.checks.some((check) => !check.ok && check.name === 'expected rules total'), true)
  assert.equal(audit.checks.some((check) => !check.ok && check.name === 'Bangumi IDs are unique'), true)
  assert.equal(audit.checks.some((check) => !check.ok && check.name === 'slugs are unique'), true)
})
