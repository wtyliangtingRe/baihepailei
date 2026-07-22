import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

import {
  applyCalibrationProfile,
  buildCalibrationContext,
  loadCalibrationProfile,
  normalizeTitleKey,
  validateCalibrationResponse,
} from '../scripts/radar/lib/calibration-profile-v01.mjs'
import { jsonlText, sha256Text } from '../scripts/radar/lib/assessment-handoff-v01.mjs'

const REGISTRY = 'config/radar/calibration-profiles/registry.v0.1.json'

for (const file of [
  'scripts/radar/lib/calibration-profile-v01.mjs',
  'scripts/radar/prepare-ai-radar-calibrated-assessment-handoff-v01.mjs',
  'scripts/radar/assemble-ai-radar-calibrated-assessment-handoff-v01.mjs',
  'scripts/radar/resolve-ai-radar-calibrated-assessments-v01.mjs',
]) {
  test(`${file} parses successfully`, () => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  })
}

test('site owner profile loads only approved anchors as active references', () => {
  const loaded = loadCalibrationProfile(REGISTRY)
  assert.equal(loaded.profileId, 'site-owner-primary-v0.1')
  assert.equal(loaded.profile.statistics.sourceAnchorCount, 68)
  assert.equal(loaded.profile.statistics.activeApprovedAnchors, 36)
  assert.equal(loaded.profile.statistics.ignoredTentativeAnchors, 8)
  assert.equal(loaded.profile.statistics.ignoredPartialAnchors, 1)
  assert.equal(loaded.profile.statistics.ignoredPendingAnchors, 23)
  assert.equal(loaded.activeAnchors.length, 36)
  assert.equal(loaded.activePrinciples.length, 16)
  assert.ok(loaded.activeAnchors.every((anchor) => anchor.weight > 0))
})

test('title normalization links Japanese Madoka rows to approved calibration anchors', () => {
  assert.equal(normalizeTitleKey('魔法少女まどか☆マギカ (1)'), normalizeTitleKey('魔法少女まどか☆マギカ'))
  const loaded = loadCalibrationProfile(REGISTRY)
  const context = buildCalibrationContext({
    title: '魔法少女まどか☆マギカ (1)',
    titles: ['魔法少女まどか☆マギカ (1)'],
    series: { seriesKey: '魔法少女まどか☆マギカ' },
  }, loaded)
  assert.deepEqual(context.relevantAnchors.map((item) => item.anchorId).sort(), ['R09', 'R17'])
  assert.equal(context.mode, 'advisory')
  assert.equal(context.factsOverrideCalibration, true)
})

test('pending and tentative questionnaire rows stay outside the runtime profile', () => {
  const loaded = loadCalibrationProfile(REGISTRY)
  assert.ok(!loaded.profile.anchors.some((item) => ['R08', 'R28'].includes(item.anchorId)))
  assert.equal(loaded.profile.statistics.ignoredTentativeAnchors, 8)
  assert.equal(loaded.profile.statistics.ignoredPendingAnchors, 23)
})

test('calibration validation accepts only signals exposed by the input row', () => {
  const loaded = loadCalibrationProfile(REGISTRY)
  const [input] = applyCalibrationProfile([{
    workId: '1',
    siteId: 'work:test-1',
    title: '魔法少女まどか☆マギカ (1)',
    series: { seriesKey: '魔法少女まどか☆マギカ' },
  }], loaded)
  const valid = validateCalibrationResponse(input, {
    calibrationProfileId: 'site-owner-primary-v0.1',
    calibrationSignals: [{
      type: 'principle',
      id: 'side-character-severe-risk-maps-to-d-side-severe',
      effect: 'preserved D-SIDE-SEVERE-RADAR',
      reason: '男性过去恋情只发生在配角。',
      weight: 1,
    }],
  }, '1')
  assert.deepEqual(valid.blockers, [])
  assert.equal(valid.calibration.signals.length, 1)

  const invalid = validateCalibrationResponse(input, {
    calibrationProfileId: 'site-owner-primary-v0.1',
    calibrationSignals: [{ type: 'anchor', id: 'R68', effect: 'used', reason: 'wrong anchor' }],
  }, '1')
  assert.ok(invalid.blockers.includes('calibration_anchor_not_allowed:1:R68'))
})

test('calibrated prepare and assemble complete a local two-row handoff', () => {
  fs.mkdirSync('data_local', { recursive: true })
  const root = fs.mkdtempSync(path.join('data_local', 'radar-calibration-test-'))
  try {
    const queueDir = path.join(root, 'queue')
    const batchDir = path.join(queueDir, 'batches', 'ready-for-ai-assessment')
    const handoffRoot = path.join(root, 'handoffs')
    fs.mkdirSync(batchDir, { recursive: true })
    const rows = [
      {
        workId: '1', siteId: 'work:test-1', title: '魔法少女まどか☆マギカ (1)', titles: ['魔法少女まどか☆マギカ (1)'],
        existingState: {}, writeProtection: { protected: false, reasons: [] },
        inputAudit: { assessmentReadiness: 'ready_for_ai_assessment_with_warnings' },
        catalogQueue: { queue: 'ready_for_ai_assessment' },
        series: { seriesKey: '魔法少女まどか☆マギカ' },
      },
      {
        workId: '2', siteId: 'work:test-2', title: '新作品', titles: ['新作品'],
        existingState: {}, writeProtection: { protected: false, reasons: [] },
        inputAudit: { assessmentReadiness: 'ready_for_ai_assessment_with_warnings' },
        catalogQueue: { queue: 'ready_for_ai_assessment' },
        series: { seriesKey: '新作品' },
      },
    ]
    const batchFile = path.join(batchDir, 'radar-assess-research-0001.jsonl')
    const batchText = jsonlText(rows)
    fs.writeFileSync(batchFile, batchText, 'utf8')
    const manifestFile = path.join(queueDir, 'assessment-ready-manifest-v01.json')
    fs.writeFileSync(manifestFile, JSON.stringify({
      inputSha256: 'test-input',
      batches: [{
        batchId: 'RADAR-ASSESS-RESEARCH-0001',
        queue: 'ready_for_ai_assessment',
        rowCount: rows.length,
        file: batchFile,
        sha256: sha256Text(batchText),
      }],
    }, null, 2), 'utf8')

    execFileSync(process.execPath, [
      'scripts/radar/prepare-ai-radar-calibrated-assessment-handoff-v01.mjs',
      '--batch-id', 'RADAR-ASSESS-RESEARCH-0001',
      '--manifest', manifestFile,
      '--out-dir', handoffRoot,
      '--chunk-size', '5',
      '--calibration-registry', REGISTRY,
    ], { stdio: 'pipe' })

    const handoffDir = path.join(handoffRoot, 'radar-assess-research-0001')
    const handoff = JSON.parse(fs.readFileSync(path.join(handoffDir, 'handoff-manifest.json'), 'utf8'))
    assert.equal(handoff.calibration.profileId, 'site-owner-primary-v0.1')
    const chunk = handoff.chunks[0]
    const inputs = fs.readFileSync(chunk.inputFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
    assert.equal(inputs[0].calibrationContext.relevantAnchors.length, 2)
    assert.equal(inputs[1].calibrationContext.relevantAnchors.length, 0)

    const responses = inputs.map((input, index) => ({
      workId: input.workId,
      siteId: input.siteId,
      title: input.title,
      evidenceCoverage: 0.8,
      evidenceStatus: 'multiple_secondary_supported',
      sourceSummary: '测试证据摘要。',
      ruleAssessments: [{
        code: index === 0 ? 'D-SIDE-SEVERE-RADAR' : 'B-LIGHT',
        matched: true,
        confidence: 0.8,
        reason: '测试规则理由。',
        evidenceStatus: 'multiple_secondary_supported',
        sources: [],
      }],
      contradictions: [],
      assessmentNotes: [],
      calibrationProfileId: 'site-owner-primary-v0.1',
      calibrationSignals: index === 0 ? [{
        type: 'principle',
        id: 'side-character-severe-risk-maps-to-d-side-severe',
        effect: 'supported D-SIDE-SEVERE-RADAR',
        reason: '测试校准理由。',
        weight: 1,
      }] : [],
      calibrationNotes: [],
    }))
    fs.writeFileSync(chunk.responseFile, jsonlText(responses), 'utf8')

    const assembled = spawnSync(process.execPath, [
      'scripts/radar/assemble-ai-radar-calibrated-assessment-handoff-v01.mjs',
      '--batch-id', 'RADAR-ASSESS-RESEARCH-0001',
      '--out-dir', handoffRoot,
    ], { encoding: 'utf8' })
    assert.equal(assembled.status, 0, assembled.stderr || assembled.stdout)
    const summary = JSON.parse(fs.readFileSync(path.join(handoffDir, 'assembled', 'assembly-summary.json'), 'utf8'))
    assert.equal(summary.complete, true)
    assert.equal(summary.assembledRows, 2)
    assert.equal(summary.totalCalibrationSignals, 1)
    assert.equal(summary.rowsWithoutCalibrationSignals, 1)
    const outputRows = fs.readFileSync(summary.outputs.completeRawAssessments, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
    assert.equal(outputRows[0].calibrationProfileId, 'site-owner-primary-v0.1')
    assert.equal(outputRows[0].calibrationSignals[0].id, 'side-character-severe-risk-maps-to-d-side-severe')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('calibrated scripts contain no Payload or PostgreSQL write path', () => {
  const source = [
    fs.readFileSync('scripts/radar/prepare-ai-radar-calibrated-assessment-handoff-v01.mjs', 'utf8'),
    fs.readFileSync('scripts/radar/assemble-ai-radar-calibrated-assessment-handoff-v01.mjs', 'utf8'),
    fs.readFileSync('scripts/radar/resolve-ai-radar-calibrated-assessments-v01.mjs', 'utf8'),
  ].join('\n')
  assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/u)
  assert.match(source, /payloadWrite:\s*false/u)
  assert.match(source, /directPostgresqlWrite:\s*false/u)
  assert.match(source, /publishesRatings:\s*false/u)
})
