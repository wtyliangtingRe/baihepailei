import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  buildAssessmentReadyRows,
  chunkResearchRows,
  selectResearchBatch,
  validateAndMergeResearchResponses,
} from '../scripts/radar/lib/research-handoff-v01.mjs'
import { jsonlText, sha256Text } from '../scripts/radar/lib/assessment-handoff-v01.mjs'

function inputRow(id) {
  return {
    workId: String(id),
    siteId: `work:test-${id}`,
    title: `作品 ${id}`,
    titles: [`作品 ${id}`],
    summaryText: '',
    existingState: {
      reviewStatus: 'pending',
      humanVerified: false,
      locked: false,
    },
    writeProtection: { protected: false, reasons: [] },
    inputAudit: {
      assessmentReadiness: 'needs_external_research',
      flags: ['summary_missing'],
      blockers: [],
    },
    catalogQueue: {
      queue: 'external_research',
      reasons: ['content_evidence_missing'],
      actionable: true,
    },
    series: { seriesKey: `作品 ${id}`, familySize: 1 },
  }
}

function responseRow(row, overrides = {}) {
  return {
    workId: row.workId,
    siteId: row.siteId,
    title: row.title,
    identityStatus: 'confirmed',
    researchStatus: 'ready_for_ai_assessment',
    evidenceCoverage: 0.7,
    evidenceStatus: 'multiple_secondary_supported',
    sourceSummary: '多个可追溯来源支持作品身份与主要关系。',
    contentSummary: '两名女性角色在共同经历事件后发展出明确恋爱关系。',
    relationshipSummary: '女性主角之间存在明确双向恋爱指向。',
    endingSummary: '结局维持女性主角关系。',
    riskFindings: {
      femaleFemaleRelationship: 'confirmed',
      maleInvolvement: 'none_found',
      ntrRisk: 'none_found',
      endingStatus: 'positive',
      adultContent: 'none_found',
      settingProfiles: [],
    },
    sources: [{
      label: '测试来源',
      url: `https://example.invalid/${row.workId}`,
      sourceType: 'secondary',
      supports: ['identity', 'relationship', 'ending'],
    }],
    contradictions: [],
    unresolvedQuestions: [],
    researchNotes: [],
    ...overrides,
  }
}

for (const file of [
  'scripts/radar/prepare-ai-radar-research-handoff-v01.mjs',
  'scripts/radar/assemble-ai-radar-research-handoff-v01.mjs',
]) {
  test(`${file} parses successfully`, () => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  })
}

test('research chunking is deterministic and bounded', () => {
  const rows = Array.from({ length: 7 }, (_, index) => inputRow(index + 1))
  const chunks = chunkResearchRows(rows, 3)
  assert.deepEqual(chunks.map((chunk) => chunk.length), [3, 3, 1])
  assert.deepEqual(chunks.flat().map((row) => row.workId), rows.map((row) => row.workId))
  assert.throws(() => chunkResearchRows(rows, 21), /1 to 20/u)
})

test('only external research batches can become research handoffs', () => {
  const manifest = {
    batches: [
      { batchId: 'RADAR-RESEARCH-0001', queue: 'external_research' },
      { batchId: 'RADAR-ASSESS-0001', queue: 'ready_for_ai_assessment' },
    ],
  }
  assert.equal(selectResearchBatch(manifest, 'RADAR-RESEARCH-0001').queue, 'external_research')
  assert.throws(() => selectResearchBatch(manifest, 'RADAR-ASSESS-0001'), /not external_research/u)
})

test('research response merge preserves canonical identity and protection', () => {
  const input = inputRow(1)
  input.writeProtection = { protected: true, reasons: ['human_verified'] }
  const response = responseRow(input, {
    title: '模型改写标题',
    existingState: { humanVerified: false },
    writeProtection: { protected: false, reasons: [] },
  })
  const result = validateAndMergeResearchResponses([input], [response], 'RADAR-RESEARCH-0001')
  assert.deepEqual(result.blockers, [])
  assert.ok(result.warnings.includes('research_response_title_differs:1'))
  assert.equal(result.mergedRows[0].title, input.title)
  assert.deepEqual(result.mergedRows[0].existingState, input.existingState)
  assert.deepEqual(result.mergedRows[0].writeProtection, input.writeProtection)
})

test('ready research requires confirmed identity and adequate evidence', () => {
  const input = inputRow(1)
  const response = responseRow(input, {
    identityStatus: 'ambiguous',
    evidenceCoverage: 0.2,
    evidenceStatus: 'insufficient_evidence',
    sources: [],
  })
  const result = validateAndMergeResearchResponses([input], [response], 'RADAR-RESEARCH-0001')
  assert.ok(result.blockers.includes('research_ready_identity_not_confirmed:1'))
  assert.ok(result.blockers.includes('research_ready_evidence_status_too_weak:1'))
  assert.ok(result.blockers.includes('research_ready_coverage_too_low:1'))
  assert.ok(result.blockers.includes('research_ready_sources_missing:1'))
})

test('assessment-ready rows preserve input and attach research evidence', () => {
  const input = inputRow(1)
  const response = responseRow(input)
  const result = validateAndMergeResearchResponses([input], [response], 'RADAR-RESEARCH-0001')
  assert.deepEqual(result.blockers, [])
  const ready = buildAssessmentReadyRows([input], result.mergedRows, 'RADAR-RESEARCH-0001')
  assert.equal(ready.length, 1)
  assert.equal(ready[0].catalogQueue.queue, 'ready_for_ai_assessment')
  assert.equal(ready[0].inputAudit.researchResolution, 'external_research_completed')
  assert.equal(ready[0].externalResearch.researchBatch, 'RADAR-RESEARCH-0001')
  assert.deepEqual(ready[0].existingState, input.existingState)
})

test('prepare and assemble commands complete a local research handoff end to end', () => {
  fs.mkdirSync('data_local', { recursive: true })
  const root = fs.mkdtempSync(path.join('data_local', 'radar-research-handoff-test-'))
  try {
    const queueDir = path.join(root, 'queue')
    const batchDir = path.join(queueDir, 'batches', 'external-research')
    const handoffRoot = path.join(root, 'handoffs')
    fs.mkdirSync(batchDir, { recursive: true })
    const rows = [inputRow(1), inputRow(2), inputRow(3)]
    const batchFile = path.join(batchDir, 'radar-research-0001.jsonl')
    const batchText = jsonlText(rows)
    fs.writeFileSync(batchFile, batchText, 'utf8')
    const manifestFile = path.join(queueDir, 'catalog-batch-manifest-v01.json')
    fs.writeFileSync(manifestFile, JSON.stringify({
      inputSha256: 'catalog-input-test',
      batches: [{
        batchId: 'RADAR-RESEARCH-0001',
        queue: 'external_research',
        rowCount: rows.length,
        file: batchFile,
        sha256: sha256Text(batchText),
      }],
    }, null, 2), 'utf8')

    execFileSync(process.execPath, [
      'scripts/radar/prepare-ai-radar-research-handoff-v01.mjs',
      '--batch-id', 'RADAR-RESEARCH-0001',
      '--manifest', manifestFile,
      '--out-dir', handoffRoot,
      '--chunk-size', '2',
    ], { stdio: 'pipe' })

    const handoffDir = path.join(handoffRoot, 'radar-research-0001')
    const handoff = JSON.parse(fs.readFileSync(path.join(handoffDir, 'handoff-manifest.json'), 'utf8'))
    assert.equal(handoff.rowCount, 3)
    assert.deepEqual(handoff.chunks.map((chunk) => chunk.rowCount), [2, 1])

    for (const chunk of handoff.chunks) {
      const chunkInputs = fs.readFileSync(chunk.inputFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
      const outputs = chunkInputs.map((row) => {
        if (row.workId === '2') return responseRow(row, {
          researchStatus: 'needs_more_research',
          evidenceCoverage: 0.2,
          evidenceStatus: 'insufficient_evidence',
          sources: [],
        })
        if (row.workId === '3') return responseRow(row, {
          identityStatus: 'ambiguous',
          researchStatus: 'identity_review',
          evidenceCoverage: 0.3,
          evidenceStatus: 'conflicting_evidence',
        })
        return responseRow(row)
      })
      fs.writeFileSync(chunk.responseFile, jsonlText(outputs), 'utf8')
    }

    execFileSync(process.execPath, [
      'scripts/radar/assemble-ai-radar-research-handoff-v01.mjs',
      '--batch-id', 'RADAR-RESEARCH-0001',
      '--out-dir', handoffRoot,
    ], { stdio: 'pipe' })

    const assembly = JSON.parse(fs.readFileSync(path.join(handoffDir, 'assembled', 'assembly-summary.json'), 'utf8'))
    assert.equal(assembly.complete, true)
    assert.equal(assembly.assembledRows, 3)
    assert.equal(assembly.assessmentReadyRows, 1)
    assert.equal(assembly.byResearchStatus.ready_for_ai_assessment, 1)
    assert.equal(assembly.byResearchStatus.needs_more_research, 1)
    assert.equal(assembly.byResearchStatus.identity_review, 1)
    const assessmentManifest = JSON.parse(fs.readFileSync(assembly.outputs.assessmentManifest, 'utf8'))
    assert.equal(assessmentManifest.batches[0].batchId, 'RADAR-ASSESS-RESEARCH-0001')
    assert.equal(assessmentManifest.batches[0].rowCount, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('research handoff scripts have no Payload write path', () => {
  const source = [
    fs.readFileSync('scripts/radar/prepare-ai-radar-research-handoff-v01.mjs', 'utf8'),
    fs.readFileSync('scripts/radar/assemble-ai-radar-research-handoff-v01.mjs', 'utf8'),
  ].join('\n')
  assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/u)
  assert.doesNotMatch(source, /\/api\/works/iu)
  assert.match(source, /payloadPatchRequests:\s*0/u)
  assert.match(source, /Execute\/apply\/write\/gate flags are rejected/u)
})
