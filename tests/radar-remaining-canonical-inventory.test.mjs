import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  assertReadOnlyArgs,
  buildInventory,
  writeInventoryOutputs,
} from '../scripts/radar/build-radar-remaining-canonical-inventory-v01.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const builderPath = path.resolve(root, '../scripts/radar/build-radar-remaining-canonical-inventory-v01.mjs')
const runnerPath = path.resolve(root, '../scripts/radar/run-and-package-radar-remaining-canonical-inventory-v01.ps1')
const builderSource = fs.readFileSync(builderPath, 'utf8')
const runnerSource = fs.readFileSync(runnerPath, 'utf8')

function work(id, overrides = {}) {
  return {
    id: String(id),
    title: `Work ${id}`,
    slug: `work-${id}`,
    siteId: `site-${id}`,
    catalogStatus: 'active',
    _status: 'published',
    isLiteVisible: true,
    isFullVisible: true,
    ...overrides,
  }
}

function conclusion(id, workId, overrides = {}) {
  return {
    id: String(id),
    publicationKey: `work:${workId}`,
    work: String(workId),
    workIdSnapshot: String(workId),
    workSiteId: `site-${workId}`,
    title: `Work ${workId}`,
    recordStatus: 'current',
    conclusionMode: 'fixed_grade',
    compatibilityGrade: 'D',
    conclusionSha256: 'a'.repeat(64),
    sourceKind: 'package',
    sourcePackageId: 'fixture',
    sourcePackageSha256: 'b'.repeat(64),
    publicationVersion: 'fixture-v01',
    publishedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  }
}

test('inventory separates already-current, missing, supersede, and excluded rows', () => {
  const draftWorks = [work(1), work(2), work(3), work(4, { catalogStatus: 'archived' }), work(5), work(6)]
  const publishedWorks = [work(1), work(2), work(3), work(4, { catalogStatus: 'archived' }), work(6)]
  const publicConclusions = [
    conclusion(101, 1),
    conclusion(103, 3, { title: 'Stale title' }),
    conclusion(104, 4),
    conclusion(106, 6, { recordStatus: 'withdrawn' }),
  ]

  const inventory = buildInventory({
    draftWorks,
    publishedWorks,
    publicConclusions,
    batchSize: 3,
    waveSize: 1,
    expectedPublicCurrent: 3,
  })

  assert.equal(inventory.counts.canonicalWorks, 4)
  assert.equal(inventory.counts.alreadyCurrent, 1)
  assert.equal(inventory.counts.missingCurrent, 2)
  assert.equal(inventory.counts.supersedeCandidate, 1)
  assert.equal(inventory.counts.excludedWorks, 2)
  assert.equal(inventory.counts.excludedPublicConclusions, 2)
  assert.deepEqual(inventory.rows.researchBatch.map((row) => row.workId), ['3', '2', '6'])
  assert.deepEqual(inventory.rows.researchBatch.map((row) => row.waveId), ['wave-01', 'wave-02', 'wave-03'])
  assert.equal(inventory.readyForResearchPackaging, true)
  assert.deepEqual(inventory.globalBlockers, [])
  assert.equal(inventory.safety.payloadContentWrite, false)
  assert.equal(inventory.safety.directPostgresqlWrite, false)
  assert.equal(inventory.safety.productionApplyPackageGenerated, false)
})

test('inventory blocks duplicate identities and an undersized full batch', () => {
  const inventory = buildInventory({
    draftWorks: [work(1), work(1)],
    publishedWorks: [work(1)],
    publicConclusions: [conclusion(101, 1), conclusion(102, 1)],
    batchSize: 2,
    waveSize: 1,
    expectedPublicCurrent: 2,
  })

  assert.equal(inventory.readyForResearchPackaging, false)
  assert.ok(inventory.globalBlockers.includes('duplicate_draft_work_ids_1'))
  assert.ok(inventory.globalBlockers.includes('duplicate_current_publication_keys_1'))
  assert.ok(inventory.globalBlockers.includes('research_candidates_below_batch_size_1_of_2'))
  assert.equal(inventory.rows.supersedeCandidate[0].supersedeReasons.includes('current_conclusion_count_2'), true)
})

test('output package includes tenable per-wave and top-level SHA manifests', () => {
  const inventory = buildInventory({
    draftWorks: [work(1), work(2), work(3)],
    publishedWorks: [work(1), work(2), work(3)],
    publicConclusions: [conclusion(101, 1)],
    batchSize: 2,
    waveSize: 1,
    expectedPublicCurrent: 1,
  })
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-inventory-test-'))
  try {
    const summary = writeInventoryOutputs(outDir, inventory, { branchHead: 'c'.repeat(40) })
    assert.equal(summary.readyForResearchPackaging, true)
    assert.equal(fs.existsSync(path.join(outDir, 'research-batch-0001.jsonl')), true)
    assert.equal(fs.existsSync(path.join(outDir, 'waves/wave-01.manifest.json')), true)
    assert.equal(fs.existsSync(path.join(outDir, 'waves/wave-02.manifest.json')), true)
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'))
    assert.ok(manifest.some((entry) => entry.file === 'inventory-summary.json'))
    assert.ok(manifest.some((entry) => entry.file === 'waves/wave-01.jsonl' && /^[0-9a-f]{64}$/u.test(entry.sha256)))
    assert.equal(manifest.some((entry) => entry.file === 'manifest.json'), false)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('write-like flags are rejected and the builder contains no content mutation route', () => {
  for (const key of ['execute', 'apply', 'write', 'patch', 'delete', 'rollback', 'schema-push']) {
    assert.throws(() => assertReadOnlyArgs({ [key]: true }), /read-only/u)
  }
  assert.match(builderSource, /authenticationPostOnly/u)
  assert.match(builderSource, /payloadContentWrite: false/u)
  assert.match(builderSource, /directPostgresqlWrite: false/u)
  assert.doesNotMatch(builderSource, /method:\s*'(?:PUT|PATCH|DELETE)'/u)
  assert.doesNotMatch(builderSource, /\/api\/(?:works|radar-public-conclusions).*method:\s*'POST'/su)
})

test('runner binds the accepted main baseline and keeps the user worktree untouched', () => {
  assert.match(runnerSource, /ExpectedBaseCommit = 'e9ee3cddf9e0dd058814a6f807ac36cc6d91eaf0'/u)
  assert.match(runnerSource, /ExpectedPublicCurrent = 10804/u)
  assert.match(runnerSource, /BatchSize = 2500/u)
  assert.match(runnerSource, /WaveSize = 250/u)
  assert.match(runnerSource, /git worktree add --detach/u)
  assert.match(runnerSource, /D:\\binv/u)
  assert.match(runnerSource, /PAYLOAD_DB_PUSH = 'false'/u)
  assert.match(runnerSource, /productionApplyPackageGenerated = \$false/u)
  assert.match(runnerSource, /if \(\$worktreeAdded -and \$passed\)/u)
  assert.doesNotMatch(runnerSource, /git reset --hard/u)
  assert.doesNotMatch(runnerSource, /git switch/u)
  assert.doesNotMatch(runnerSource, /payload migrate/u)
  assert.doesNotMatch(runnerSource, /PAYLOAD_DB_PUSH\s*=\s*'true'/u)
  assert.doesNotMatch(runnerSource, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/iu)
})
