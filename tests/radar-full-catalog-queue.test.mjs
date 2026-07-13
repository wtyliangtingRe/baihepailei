import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

import {
  buildCatalogQueues,
  classifyCatalogRow,
  splitSeriesAware,
} from '../scripts/radar/lib/catalog-batch-v01.mjs'

function row(id, overrides = {}) {
  return {
    workId: String(id),
    siteId: `work:test-${id}`,
    title: `作品 ${id}`,
    series: { seriesKey: `系列 ${id}` },
    existingState: {
      ratingNotice: 'insufficient_information',
      reviewStatus: 'pending',
      reviewReasons: [],
      humanVerified: false,
      locked: false,
    },
    writeProtection: { protected: false, reasons: [] },
    inputAudit: {
      assessmentReadiness: 'ready_for_ai_assessment_with_warnings',
      flags: [],
      blockers: [],
    },
    ...overrides,
  }
}

for (const file of [
  'scripts/radar/prepare-ai-radar-catalog-batches-v01.mjs',
  'scripts/radar/run-ai-radar-full-catalog-preparation-v01.mjs',
  'scripts/radar/run-ai-radar-resume-first100-safe-v01.mjs',
]) {
  test(`${file} parses successfully`, () => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  })
}

test('catalog classification covers assessed, protected, identity, research, ready and invalid rows', () => {
  assert.equal(classifyCatalogRow(row(1, {
    existingState: { ratingNotice: 'ai_synthesized_pending_review', reviewStatus: 'pending', reviewReasons: ['radar_seed_attached'] },
  })).queue, 'already_ai_assessed')
  assert.equal(classifyCatalogRow(row(2, {
    existingState: { ratingNotice: 'manual_reviewed', reviewStatus: 'reviewed', reviewReasons: [] },
  })).queue, 'protected_or_manual_review')
  assert.equal(classifyCatalogRow(row(3, {
    inputAudit: { assessmentReadiness: 'needs_identity_or_series_review', flags: [], blockers: [] },
  })).queue, 'identity_review')
  assert.equal(classifyCatalogRow(row(4, {
    inputAudit: { assessmentReadiness: 'needs_external_research', flags: ['summary_missing'], blockers: [] },
  })).queue, 'external_research')
  assert.equal(classifyCatalogRow(row(5)).queue, 'ready_for_ai_assessment')
  assert.equal(classifyCatalogRow({ ...row(6), siteId: '' }).queue, 'invalid_record')
})

test('series-aware batches never split a normal family across boundaries', () => {
  const familyA = Array.from({ length: 6 }, (_, index) => row(index + 1, { series: { seriesKey: '系列 A' } }))
  const familyB = Array.from({ length: 6 }, (_, index) => row(index + 101, { series: { seriesKey: '系列 B' } }))
  const batches = splitSeriesAware([...familyB, ...familyA], 10)
  assert.equal(batches.length, 2)
  assert.deepEqual(new Set(batches[0].map((item) => item.series.seriesKey)), new Set(['系列 A']))
  assert.deepEqual(new Set(batches[1].map((item) => item.series.seriesKey)), new Set(['系列 B']))
})

test('catalog inventory is deterministic and every input row is assigned once', () => {
  const rows = [
    row(20),
    row(3, { inputAudit: { assessmentReadiness: 'needs_external_research', flags: [], blockers: [] } }),
    row(11, { inputAudit: { assessmentReadiness: 'needs_identity_or_series_review', flags: [], blockers: [] } }),
    row(1, { existingState: { ratingNotice: 'ai_synthesized_pending_review', reviewStatus: 'pending', reviewReasons: ['radar_seed_attached'] } }),
  ]
  const built = buildCatalogQueues(rows, {
    assessmentBatchSize: 10,
    researchBatchSize: 10,
    identityBatchSize: 10,
  })
  assert.deepEqual(built.inventory.map((item) => item.workId), ['1', '3', '11', '20'])
  assert.equal(Object.values(built.queues).flat().length, rows.length)
  assert.equal(built.queues.already_ai_assessed.length, 1)
  assert.equal(built.queues.external_research.length, 1)
  assert.equal(built.queues.identity_review.length, 1)
  assert.equal(built.queues.ready_for_ai_assessment.length, 1)
})

test('full catalog preparation contains no Payload PATCH path', () => {
  const sources = [
    fs.readFileSync('scripts/radar/prepare-ai-radar-catalog-batches-v01.mjs', 'utf8'),
    fs.readFileSync('scripts/radar/run-ai-radar-full-catalog-preparation-v01.mjs', 'utf8'),
  ].join('\n')
  assert.doesNotMatch(sources, /method:\s*['"]PATCH['"]/u)
  assert.match(sources, /payloadPatchRequests:\s*0/u)
  assert.match(sources, /Execute\/apply\/write flags are rejected|Execute\/apply\/write/u)
})

test('resume safety wrapper creates its parent root before spawning the incident script', () => {
  const source = fs.readFileSync('scripts/radar/run-ai-radar-resume-first100-safe-v01.mjs', 'utf8')
  const mkdirCall = source.indexOf('fs.mkdirSync(OUTPUT_ROOT')
  const spawnCall = source.indexOf('const result = spawnSync(')
  assert.ok(mkdirCall >= 0)
  assert.ok(spawnCall >= 0)
  assert.ok(mkdirCall < spawnCall)
  assert.match(source, /recursive:\s*true/u)
})
