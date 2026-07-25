import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  RESEARCH_HANDOFF_VERSION,
  assertOutputUnderDataLocal,
  assertReadOnlyArgs,
  buildInventoryResearchHandoff,
  transformInventoryRow,
} from '../scripts/radar/prepare-radar-inventory-research-handoff-v01.mjs'

function shaFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
}
function row(id, ordinal, waveId, waveOrdinal) {
  return {
    batchId: 'batch-0001', batchOrdinal: ordinal, catalogStatus: 'active', currentPublicConclusionCount: 0,
    hasEvidence: false, inventoryStatus: 'missing_current', isFullVisible: true, isLiteVisible: true,
    mediaGroup: 'manga', mediaType: 'manga', payloadStatus: 'published', publicationKey: `work:${id}`,
    researchPriority: 2, siteId: `site:${id}`, slug: `work-${id}`, title: `Work ${id}`,
    waveId, waveOrdinal, workId: String(id), yuriCandidateScore: 0,
  }
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-inventory-handoff-'))
  const review = path.join(root, 'review')
  const rows = [
    row(1, 1, 'wave-01', 1), row(2, 2, 'wave-01', 2),
    row(3, 3, 'wave-02', 1), row(4, 4, 'wave-02', 2),
  ]
  writeJson(path.join(review, 'inventory-summary.json'), {
    version: 'radar-remaining-canonical-inventory-v0.1', branchHead: 'a'.repeat(40),
    counts: { researchBatchRows: 4, researchWaveCount: 2, supersedeCandidate: 0 },
    globalBlockers: [], readyForResearchPackaging: true,
  })
  writeJson(path.join(review, 'independent-audit.json'), {
    checks: {
      researchBatchDeterministicOrder: true, wavesMatchResearchBatchExactly: true,
      waveHashesAccepted: true, productionWriteAuthorized: false,
    },
  })
  writeJson(path.join(review, 'review-package-metadata.json'), { sourceBundleSha256: 'B'.repeat(64) })
  writeJsonl(path.join(review, 'research-batch-0001.jsonl'), rows)
  for (let index = 0; index < 2; index += 1) {
    const waveId = `wave-${String(index + 1).padStart(2, '0')}`
    const waveRows = rows.slice(index * 2, index * 2 + 2)
    const file = path.join(review, 'waves', `${waveId}.jsonl`)
    writeJsonl(file, waveRows)
    writeJson(path.join(review, 'waves', `${waveId}.manifest.json`), {
      rows: 2, firstWorkId: waveRows[0].workId, lastWorkId: waveRows.at(-1).workId,
      independentlyRecoverable: true,
      payload: { file: `waves/${waveId}.jsonl`, bytes: fs.statSync(file).size, sha256: shaFile(file) },
    })
  }
  const files = fs.readdirSync(review, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(review, path.join(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/'))
    .sort()
  writeJson(path.join(review, 'review-manifest.json'), files.map((file) => ({
    file, bytes: fs.statSync(path.join(review, file)).size, sha256: shaFile(path.join(review, file)),
  })))
  return { root, review, rows }
}

test('transforms inventory rows into assembler-compatible external research rows', () => {
  const transformed = transformInventoryRow(row(9, 1, 'wave-01', 1), {
    inventoryVersion: 'inventory-v1', sourceBranchHead: 'a'.repeat(40),
    sourceBundleSha256: 'B'.repeat(64), sourceReviewBundleSha256: 'C'.repeat(64),
  })
  assert.equal(transformed.catalogQueue.queue, 'external_research')
  assert.equal(transformed.inputAudit.researchReason, 'missing_current_public_conclusion')
  assert.equal(transformed.writeProtection.protected, false)
  assert.equal(transformed.researchSource.sourceReviewBundleSha256, 'C'.repeat(64))
})

test('builds recoverable handoffs with compatible manifests and reproducible hashes', (t) => {
  const { root, review, rows } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const output = path.join(root, 'data_local', 'out')
  const manifest = buildInventoryResearchHandoff({
    cwd: root, reviewDir: review, outputDir: output,
    expectedSourceBundleSha256: 'B'.repeat(64),
    batchSize: 4, waveSize: 2, chunkSize: 1,
    packageId: 'TEST-PACKAGE', batchPrefix: 'TEST-WAVE',
  })
  assert.deepEqual(manifest.counts, {
    researchRows: 4, subwaves: 2, rowsPerSubwave: 2,
    chunkSize: 1, chunksPerSubwave: 2, totalChunks: 4,
  })
  assert.equal(manifest.batches.length, 2)
  assert.equal(manifest.batches[0].rowCount, 2)
  assert.equal(manifest.batches[0].chunkCount, 2)
  const handoff = JSON.parse(fs.readFileSync(manifest.batches[0].handoffManifest, 'utf8'))
  assert.equal(handoff.version, RESEARCH_HANDOFF_VERSION)
  assert.equal(handoff.queue, 'external_research')
  assert.equal(handoff.rowCount, 2)
  assert.equal(handoff.chunkCount, 2)
  const firstChunk = fs.readFileSync(handoff.chunks[0].inputFile, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(firstChunk[0].workId, rows[0].workId)
  assert.equal(firstChunk[0].catalogQueue.queue, 'external_research')
  for (const line of fs.readFileSync(path.join(output, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const [expected, relative] = line.split('  ')
    assert.equal(shaFile(path.join(output, relative)), expected)
  }
})

test('rejects output outside data_local and write-like flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-inventory-handoff-path-'))
  try {
    assert.throws(() => assertOutputUnderDataLocal(path.join(root, 'outside'), root), /under data_local/u)
    assert.throws(() => assertReadOnlyArgs({ apply: true }), /Write-like flag rejected/u)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a tampered accepted wave', (t) => {
  const { root, review } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.appendFileSync(path.join(review, 'waves', 'wave-01.jsonl'), '{}\n')
  assert.throws(() => buildInventoryResearchHandoff({
    cwd: root, reviewDir: review, outputDir: path.join(root, 'data_local', 'out'),
    expectedSourceBundleSha256: 'B'.repeat(64), batchSize: 4, waveSize: 2, chunkSize: 1,
  }), /Review manifest mismatch/u)
})
