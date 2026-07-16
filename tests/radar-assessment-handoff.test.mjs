import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  chunkRows,
  jsonlText,
  selectAssessmentBatch,
  sha256Text,
  validateAndMergeResponses,
} from '../scripts/radar/lib/assessment-handoff-v01.mjs'

function inputRow(id) {
  return {
    workId: String(id),
    siteId: `work:test-${id}`,
    title: `作品 ${id}`,
    existingState: {
      ratingNotice: 'ai_synthesized_pending_review',
      reviewStatus: 'pending',
      reviewReasons: ['radar_seed_attached'],
      humanVerified: false,
      locked: false,
      radarAssessment: null,
    },
    writeProtection: { protected: false, reasons: [] },
    inputAudit: { assessmentReadiness: 'ready_for_ai_assessment_with_warnings', flags: [], blockers: [] },
    catalogQueue: { queue: 'ready_for_ai_assessment', reasons: ['legacy_ai_marker_without_complete_assessment'] },
    summaryText: `作品 ${id} 的测试简介。`,
  }
}

function responseRow(row) {
  return {
    workId: row.workId,
    siteId: row.siteId,
    title: row.title,
    evidenceCoverage: 60,
    evidenceStatus: 'single_secondary_supported',
    sourceSummary: '基于现有简介，资料覆盖有限。',
    ruleAssessments: [
      {
        code: 'D-UNCLEAR',
        matched: true,
        confidence: 0.7,
        reason: '现有资料不足以确认更高安全等级。',
        evidenceStatus: 'single_secondary_supported',
        sources: [],
      },
    ],
    contradictions: [],
  }
}

for (const file of [
  'scripts/radar/prepare-ai-radar-assessment-handoff-v01.mjs',
  'scripts/radar/assemble-ai-radar-assessment-handoff-v01.mjs',
]) {
  test(`${file} parses successfully`, () => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  })
}

test('chunking is deterministic and bounded', () => {
  const rows = Array.from({ length: 12 }, (_, index) => inputRow(index + 1))
  const chunks = chunkRows(rows, 5)
  assert.deepEqual(chunks.map((chunk) => chunk.length), [5, 5, 2])
  assert.deepEqual(chunks.flat().map((row) => row.workId), rows.map((row) => row.workId))
  assert.throws(() => chunkRows(rows, 4), /5 to 100/u)
})

test('only ready assessment batches can become handoffs', () => {
  const manifest = {
    batches: [
      { batchId: 'RADAR-ASSESS-0001', queue: 'ready_for_ai_assessment' },
      { batchId: 'RADAR-RESEARCH-0001', queue: 'external_research' },
    ],
  }
  assert.equal(selectAssessmentBatch(manifest, 'RADAR-ASSESS-0001').queue, 'ready_for_ai_assessment')
  assert.throws(() => selectAssessmentBatch(manifest, 'RADAR-RESEARCH-0001'), /not ready_for_ai_assessment/u)
})

test('response merge preserves canonical identity and protection from input', () => {
  const input = inputRow(1)
  input.writeProtection = { protected: true, reasons: ['human_verified'] }
  const response = responseRow(input)
  response.title = '模型改写的标题'
  response.existingState = { humanVerified: false }
  response.writeProtection = { protected: false, reasons: [] }
  const result = validateAndMergeResponses([input], [response], 'RADAR-ASSESS-0001')
  assert.deepEqual(result.blockers, [])
  assert.ok(result.warnings.includes('response_title_differs:1'))
  assert.equal(result.mergedRows[0].title, input.title)
  assert.deepEqual(result.mergedRows[0].existingState, input.existingState)
  assert.deepEqual(result.mergedRows[0].writeProtection, input.writeProtection)
  assert.equal(result.mergedRows[0].evidenceCoverage, 0.6)
})

test('response validation blocks missing, duplicate and mismatched identities', () => {
  const first = inputRow(1)
  const second = inputRow(2)
  const wrong = responseRow(first)
  wrong.siteId = 'work:wrong'
  const duplicate = responseRow(first)
  const result = validateAndMergeResponses([first, second], [wrong, duplicate], 'RADAR-ASSESS-0001')
  assert.ok(result.blockers.includes('response_duplicate_work_id:1'))
  assert.ok(result.blockers.includes('response_site_id_mismatch:1'))
  assert.ok(result.blockers.includes('response_missing_for_work:2'))
})

test('prepare and assemble commands complete a local six-row handoff end to end', () => {
  fs.mkdirSync('data_local', { recursive: true })
  const root = fs.mkdtempSync(path.join('data_local', 'radar-handoff-test-'))
  try {
    const queueDir = path.join(root, 'queue')
    const batchDir = path.join(queueDir, 'batches', 'ready-for-ai-assessment')
    const handoffRoot = path.join(root, 'handoffs')
    fs.mkdirSync(batchDir, { recursive: true })
    const rows = Array.from({ length: 6 }, (_, index) => inputRow(index + 1))
    const batchFile = path.join(batchDir, 'radar-assess-0001.jsonl')
    const batchText = jsonlText(rows)
    fs.writeFileSync(batchFile, batchText, 'utf8')
    const manifestFile = path.join(queueDir, 'catalog-batch-manifest-v01.json')
    fs.writeFileSync(manifestFile, JSON.stringify({
      inputSha256: 'catalog-input-test',
      batches: [{
        batchId: 'RADAR-ASSESS-0001',
        queue: 'ready_for_ai_assessment',
        rowCount: rows.length,
        file: batchFile,
        sha256: sha256Text(batchText),
      }],
    }, null, 2), 'utf8')

    execFileSync(process.execPath, [
      'scripts/radar/prepare-ai-radar-assessment-handoff-v01.mjs',
      '--batch-id', 'RADAR-ASSESS-0001',
      '--manifest', manifestFile,
      '--out-dir', handoffRoot,
      '--chunk-size', '5',
    ], { stdio: 'pipe' })

    const handoffDir = path.join(handoffRoot, 'radar-assess-0001')
    const handoff = JSON.parse(fs.readFileSync(path.join(handoffDir, 'handoff-manifest.json'), 'utf8'))
    assert.equal(handoff.rowCount, 6)
    assert.equal(handoff.chunkCount, 2)
    assert.deepEqual(handoff.chunks.map((chunk) => chunk.rowCount), [5, 1])

    for (const chunk of handoff.chunks) {
      const inputRows = fs.readFileSync(chunk.inputFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
      fs.writeFileSync(chunk.responseFile, jsonlText(inputRows.map(responseRow)), 'utf8')
    }

    execFileSync(process.execPath, [
      'scripts/radar/assemble-ai-radar-assessment-handoff-v01.mjs',
      '--batch-id', 'RADAR-ASSESS-0001',
      '--out-dir', handoffRoot,
    ], { stdio: 'pipe' })

    const assembly = JSON.parse(fs.readFileSync(path.join(handoffDir, 'assembled', 'assembly-summary.json'), 'utf8'))
    assert.equal(assembly.complete, true)
    assert.equal(assembly.assembledRows, 6)
    assert.equal(assembly.blockers.length, 0)
    const assembledRows = fs.readFileSync(assembly.outputs.completeRawAssessments, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
    assert.equal(assembledRows.length, 6)
    assert.equal(assembledRows[0].assessmentBatch, 'RADAR-ASSESS-0001')
    assert.deepEqual(assembledRows[0].existingState, rows[0].existingState)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('handoff scripts have no Payload write path', () => {
  const source = [
    fs.readFileSync('scripts/radar/prepare-ai-radar-assessment-handoff-v01.mjs', 'utf8'),
    fs.readFileSync('scripts/radar/assemble-ai-radar-assessment-handoff-v01.mjs', 'utf8'),
  ].join('\n')
  assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/u)
  assert.match(source, /payloadPatchRequests:\s*0/u)
  assert.match(source, /Execute\/apply\/write\/gate flags are rejected/u)
})
