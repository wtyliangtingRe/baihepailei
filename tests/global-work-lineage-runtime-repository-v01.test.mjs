import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FROZEN_WORK_LINEAGE_BLOCKS,
  assertFormalWorkLineageDocument,
  findFormalWorkLineageById,
  listFormalWorkLineages,
} from '../src/lib/work-lineage/runtimeRepositoryCore.ts'

function document(workId = '100') {
  return {
    contractVersion: 'global-work-lineage-v01',
    workId,
    canonical: { naming: { canonicalTitle: 'Example', names: ['Example'] } },
    identities: { observation: { state: 'complete' }, bindings: [] },
    research: {},
    assessment: {},
    candidate: {},
    published: {},
    human: {},
    reservations: {},
    quarantine: {},
    effectiveState: { ai: { selection: { currentConclusionState: 'unknown' } } },
    integrity: {},
    provenance: {},
  }
}

test('runtime accepts exactly the active projection of the Frozen 13 blocks', () => {
  assert.equal(FROZEN_WORK_LINEAGE_BLOCKS.length, 13)
  assert.doesNotThrow(() => assertFormalWorkLineageDocument(document()))
  assert.throws(
    () => assertFormalWorkLineageDocument({ ...document(), legacy: {} }),
    /Frozen block set|Legacy/,
  )
  assert.throws(
    () => assertFormalWorkLineageDocument({ ...document(), compatibility: {} }),
    /Frozen block set/,
  )
})

test('exact lookup uses only workId against the new schema', async () => {
  const calls = []
  const executor = {
    async query(text, values) {
      calls.push({ text, values })
      return {
        rows: [{ work_id: '100', document_sha256: 'a'.repeat(64), document: document() }],
      }
    },
  }
  const result = await findFormalWorkLineageById(executor, '100')
  assert.equal(result.document.workId, '100')
  assert.deepEqual(calls[0].values, ['100'])
  assert.match(calls[0].text, /global_work_lineage_v01\.work_lineages/)
  assert.doesNotMatch(calls[0].text, /payload|radar|legacy/i)
})

test('list search is presentation-only and remains parameterized', async () => {
  const calls = []
  const executor = {
    async query(text, values) {
      calls.push({ text, values })
      if (/count\(\*\)/.test(text)) return { rows: [{ total: '1' }] }
      return {
        rows: [{ work_id: '100', document_sha256: 'b'.repeat(64), document: document() }],
      }
    },
  }
  const result = await listFormalWorkLineages(executor, {
    query: "Example' OR true --",
    limit: 10,
    offset: 2,
  })
  assert.equal(result.items[0].canonicalTitle, 'Example')
  assert.equal(result.total, 1)
  assert.deepEqual(calls[0].values, ["Example' OR true --"])
  assert.deepEqual(calls[1].values, ["Example' OR true --", 10, 2])
  assert.doesNotMatch(calls[1].text, /Example/)
  assert.match(calls[1].text, /canonical_title ILIKE/)
  assert.match(calls[1].text, /work_id = \$1/)
})

test('public cutover pages have no legacy index, Payload, or Radar reader', async () => {
  const { readFile } = await import('node:fs/promises')
  const pages = [
    '../src/app/(frontend)/page.tsx',
    '../src/app/(frontend)/browse/page.tsx',
    '../src/app/(frontend)/works/page.tsx',
    '../src/app/(frontend)/works/[slug]/page.tsx',
    '../src/app/(frontend)/search/page.tsx',
    '../src/app/(frontend)/ratings/page.tsx',
    '../src/app/(frontend)/radar/page.tsx',
    '../src/app/(frontend)/radar/[id]/page.tsx',
    '../src/app/(frontend)/radar/[id]/download/route.ts',
    '../src/app/(frontend)/creators/page.tsx',
    '../src/app/(frontend)/creators/[slug]/page.tsx',
    '../src/app/(frontend)/organizations/page.tsx',
    '../src/app/(frontend)/organizations/[slug]/page.tsx',
    '../src/app/(frontend)/evidence/page.tsx',
    '../src/app/(frontend)/evidence/[slug]/page.tsx',
    '../src/app/(frontend)/recommendations/page.tsx',
    '../src/app/(frontend)/updates/page.tsx',
  ]
  const forbidden = /@payload-config|from ['"]payload['"]|search-index|detail-index|radar-public-|public\/search-index|public\/detail-index/i
  for (const page of pages) {
    const source = await readFile(new URL(page, import.meta.url), 'utf8')
    assert.doesNotMatch(source, forbidden, page)
  }
})
