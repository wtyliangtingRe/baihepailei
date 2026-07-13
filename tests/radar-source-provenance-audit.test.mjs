import test from 'node:test'
import assert from 'node:assert/strict'

import { auditSourceProvenance } from '../scripts/radar/lib/source-provenance-audit-v01.mjs'

function row(overrides = {}) {
  return {
    workId: '42',
    siteId: 'work:test-42',
    title: '测试作品',
    currentGradeSuggestion: 'B',
    evidenceStatus: 'multiple_secondary_supported',
    sourceCount: 2,
    researchSources: [
      { label: '来源一', url: 'https://example.com/a', sourceType: 'catalog_source' },
      { label: '来源二', url: 'https://example.com/b', sourceType: 'secondary_web' },
    ],
    ...overrides,
  }
}

test('multiple secondary support requires two traceable URLs', () => {
  const result = auditSourceProvenance(row({
    sourceCount: 1,
    researchSources: [{ label: '唯一来源', url: 'https://example.com/a', sourceType: 'secondary_web' }],
  }))
  assert.equal(result.auditStatus, 'blocked')
  assert.ok(result.blockers.includes('multiple_secondary_supported_but_fewer_than_2_traceable_sources'))
})

test('single secondary support requires at least one traceable URL', () => {
  const result = auditSourceProvenance(row({
    evidenceStatus: 'single_secondary_supported',
    sourceCount: 1,
    researchSources: [{ label: '无链接检索备注', sourceType: 'secondary_web' }],
  }))
  assert.equal(result.auditStatus, 'blocked')
  assert.ok(result.blockers.includes('single_secondary_supported_but_no_traceable_source'))
})

test('series context without a URL is not counted as a traceable source', () => {
  const result = auditSourceProvenance(row({
    evidenceStatus: 'single_secondary_supported',
    sourceCount: 2,
    researchSources: [
      { label: '目录来源', url: 'https://example.com/a', sourceType: 'catalog_source' },
      { label: '系列上下文', sourceType: 'series_context' },
    ],
  }))
  assert.equal(result.auditStatus, 'warning')
  assert.equal(result.traceableSourceCount, 1)
  assert.ok(result.warnings.includes('declared_source_count_differs_from_traceable_count'))
})

test('unlinked secondary web notes remain visible as warnings', () => {
  const result = auditSourceProvenance(row({
    evidenceStatus: 'single_secondary_supported',
    sourceCount: 2,
    researchSources: [
      { label: '目录来源', url: 'https://example.com/a', sourceType: 'catalog_source' },
      { label: '无链接检索备注', sourceType: 'secondary_web' },
    ],
  }))
  assert.equal(result.auditStatus, 'warning')
  assert.ok(result.warnings.includes('unlinked_secondary_web_source'))
})

test('two distinct traceable sources pass provenance audit', () => {
  const result = auditSourceProvenance(row())
  assert.equal(result.auditStatus, 'ok')
  assert.equal(result.traceableSourceCount, 2)
  assert.deepEqual(result.blockers, [])
})
