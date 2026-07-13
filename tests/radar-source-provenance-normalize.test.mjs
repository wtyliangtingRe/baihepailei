import test from 'node:test'
import assert from 'node:assert/strict'

import { honestEvidenceStatus, normalizeSourceProvenance } from '../scripts/radar/lib/source-provenance-normalize-v01.mjs'

function row(overrides = {}) {
  return {
    workId: '1',
    title: '测试作品',
    evidenceStatus: 'multiple_secondary_supported',
    sourceCount: 2,
    sourceSummary: '原始来源摘要。',
    researchSources: [
      { sourceType: 'secondary_web', label: '来源一', url: 'https://example.com/a' },
      { sourceType: 'series_context', label: '系列上下文', url: '' },
    ],
    blockers: [],
    ...overrides,
  }
}

test('one traceable URL downgrades multiple secondary support to single secondary support', () => {
  assert.equal(honestEvidenceStatus('multiple_secondary_supported', 1), 'single_secondary_supported')
  const result = normalizeSourceProvenance(row())
  assert.equal(result.row.evidenceStatus, 'single_secondary_supported')
  assert.equal(result.row.sourceCount, 1)
  assert.equal(result.auditAfter.auditStatus, 'ok')
})

test('zero traceable URLs becomes insufficient evidence without blocking publication forever', () => {
  const result = normalizeSourceProvenance(row({
    evidenceStatus: 'single_secondary_supported',
    sourceCount: 1,
    researchSources: [{ sourceType: 'secondary_web', label: '无链接检索备注', url: '' }],
  }))
  assert.equal(result.row.evidenceStatus, 'insufficient_evidence')
  assert.equal(result.row.sourceCount, 0)
  assert.ok(result.row.blockers.includes('external_research_insufficient'))
  assert.equal(result.auditAfter.auditStatus, 'warning')
})

test('two distinct traceable URLs retain multiple secondary support without a meaningless diff', () => {
  const original = row({
    researchSources: [
      { sourceType: 'secondary_web', label: '来源一', url: 'https://example.com/a/' },
      { sourceType: 'secondary_web', label: '来源二', url: 'https://example.com/b' },
    ],
  })
  const result = normalizeSourceProvenance(original)
  assert.equal(result.row.evidenceStatus, 'multiple_secondary_supported')
  assert.equal(result.row.sourceCount, 2)
  assert.equal(result.changed, false)
  assert.equal(result.row.sourceSummary, original.sourceSummary)
  assert.equal(result.row.sourceProvenanceNormalization, undefined)
})

test('unlinked context is preserved but not counted as a source', () => {
  const result = normalizeSourceProvenance(row())
  assert.equal(result.row.researchSources.length, 2)
  assert.equal(result.row.sourceCount, 1)
  assert.match(result.row.sourceSummary, /无链接的系列上下文仅作为内部辅助说明/u)
})

test('normalization is idempotent and does not duplicate the honesty note', () => {
  const once = normalizeSourceProvenance(row())
  const twice = normalizeSourceProvenance(once.row)
  assert.equal((twice.row.sourceSummary.match(/来源可追溯性说明：/gu) || []).length, 1)
  assert.equal(twice.row.evidenceStatus, once.row.evidenceStatus)
  assert.equal(twice.row.sourceCount, once.row.sourceCount)
  assert.equal(twice.changed, false)
})
