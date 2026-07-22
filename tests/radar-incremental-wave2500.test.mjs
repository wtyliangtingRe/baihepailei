import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildIncrementalWavePlan,
  jsonlText,
} from '../scripts/radar/lib/incremental-wave-package-v01.mjs'
import { packageIncrementalWave } from '../scripts/radar/package-ai-radar-incremental-wave-v01.mjs'

const RUNNER = 'scripts/radar/run-ai-radar-wave4-2500-start-v01.ps1'

function sampleRows(count = 2500) {
  return Array.from({ length: count }, (_, index) => ({
    workId: String(100000 + index),
    siteId: `work:test-${index}`,
    title: `Test ${index}`,
    incrementalSelection: index < 235
      ? { action: 'research_retry_needs_more_research', refreshReason: 'needs_more_research' }
      : { action: 'research_new', refreshReason: null },
  }))
}

test('2500 rows become ten independently recoverable 250-row subwaves', () => {
  const plan = buildIncrementalWavePlan(sampleRows(), {
    waveId: 'RADAR-INCREMENTAL-WAVE-0004-2500',
    targetRows: 2500,
    subwaveSize: 250,
    chunkSize: 5,
  })
  assert.equal(plan.selectedRows, 2500)
  assert.equal(plan.subwaveCount, 10)
  assert.equal(plan.newRows, 2265)
  assert.equal(plan.retryRows, 235)
  assert.equal(plan.subwaves.every((item) => item.rowCount === 250), true)
  assert.equal(plan.subwaves.every((item) => item.chunkCount === 50), true)
  assert.equal(plan.subwaves.reduce((sum, item) => sum + item.chunkCount, 0), 500)
  assert.equal(plan.identities.size, 2500)
})

test('completed unchanged or reassessment rows cannot consume research capacity', () => {
  const completed = sampleRows(1)
  completed[0].incrementalSelection = { action: 'skip_completed_unchanged', refreshReason: null }
  assert.throws(() => buildIncrementalWavePlan(completed, {
    waveId: 'RADAR-INCREMENTAL-WAVE-TEST', targetRows: 1, subwaveSize: 1, chunkSize: 1,
  }), /Non-research action entered research capacity/u)
  const reassess = sampleRows(1)
  reassess[0].incrementalSelection = { action: 'reassess_policy_changed', refreshReason: 'policy_changed' }
  assert.throws(() => buildIncrementalWavePlan(reassess, {
    waveId: 'RADAR-INCREMENTAL-WAVE-TEST', targetRows: 1, subwaveSize: 1, chunkSize: 1,
  }), /Non-research action entered research capacity/u)
})

test('retry rows require an explicit refresh reason', () => {
  const rows = sampleRows(1)
  rows[0].incrementalSelection = { action: 'research_retry_incomplete', refreshReason: null }
  assert.throws(() => buildIncrementalWavePlan(rows, {
    waveId: 'RADAR-INCREMENTAL-WAVE-TEST', targetRows: 1, subwaveSize: 1, chunkSize: 1,
  }), /lacks refreshReason/u)
})

test('packager emits portable subwave manifests, recovery plan and hashes', () => {
  const root = path.resolve('data_local/test-incremental-wave2500')
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })
  const rows = sampleRows(20)
  const selectionFile = path.join(root, 'selection.jsonl')
  const summaryFile = path.join(root, 'summary.json')
  const reassessmentFile = path.join(root, 'reassess.jsonl')
  const outputDir = path.join(root, 'package')
  fs.writeFileSync(selectionFile, jsonlText(rows), 'utf8')
  fs.writeFileSync(summaryFile, `${JSON.stringify({
    selectedResearchRows: 20,
    safety: { payloadWrite: false, directPostgresqlWrite: false, humanTrackMutations: 0 },
  }, null, 2)}\n`, 'utf8')
  fs.writeFileSync(reassessmentFile, jsonlText([{ workId: 'r1', siteId: 'work:r1' }]), 'utf8')
  const summary = packageIncrementalWave({
    selectionFile,
    selectionSummaryFile: summaryFile,
    reassessmentFile,
    outputDir,
    waveId: 'RADAR-INCREMENTAL-WAVE-TEST-0020',
    packageId: 'RADAR-INCREMENTAL-WAVE-TEST-0020-input-v01',
    targetRows: 20,
    subwaveSize: 10,
    chunkSize: 5,
  })
  assert.equal(summary.subwaveCount, 2)
  assert.equal(summary.totalChunkCount, 4)
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'package-manifest.json'), 'utf8'))
  assert.equal(manifest.reassessmentRows, 1)
  assert.equal(manifest.reassessments.consumesResearchCapacity, false)
  assert.equal(manifest.requestedCompletion.partialPackageAllowed, true)
  assert.equal(manifest.requestedCompletion.completedSubwavesMustBeSkippedOnRerun, true)
  assert.equal(manifest.subwaves.every((item) => !path.isAbsolute(item.manifestFile)), true)
  const hashLines = fs.readFileSync(path.join(outputDir, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/u)
  assert.ok(hashLines.length > 10)
  fs.rmSync(root, { recursive: true, force: true })
})

test('2500 start runner is fixed, repository-relative and read-only', () => {
  const runner = fs.readFileSync(RUNNER, 'utf8')
  assert.match(runner, /\$TargetRows = 2500/u)
  assert.match(runner, /\$SubwaveSize = 250/u)
  assert.match(runner, /\$ChunkSize = 5/u)
  assert.match(runner, /\$ExpectedSubwaves = 10/u)
  assert.match(runner, /\$ExpectedTotalChunks = 500/u)
  assert.match(runner, /select-ai-radar-incremental-wave-v01\.mjs/u)
  assert.match(runner, /package-ai-radar-incremental-wave-v01\.mjs/u)
  assert.doesNotMatch(runner, /[A-Za-z]:\\/u)
  assert.match(runner, /PayloadWrite = \$false/u)
  assert.match(runner, /DirectPostgresqlWrite = \$false/u)
  assert.doesNotMatch(runner, /UPDATE\s+works/iu)
})
