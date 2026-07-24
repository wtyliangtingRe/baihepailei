import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  EXPECTED_INCREMENTAL_GRADES,
  EXPECTED_NEW_ROWS,
  EXPECTED_OLD_ROWS,
  EXPECTED_ROWS,
  buildPhase2StorageRow,
  evidenceStrengthFor,
  ratingNoticeFor,
  reviewReasonsFor,
  storageEvidenceStatusFor,
} from '../scripts/radar/build-radar-unified-incremental-assembly-v01.mjs'
import {
  EXPECTED_BASELINE_ROWS,
  EXPECTED_FINAL_GRADES,
  EXPECTED_FINAL_ROWS,
  buildSqlBundle,
  validateReadyRows,
} from '../scripts/radar/build-radar-unified-incremental-storage-lab-v01.mjs'
import {
  canonical,
  normalizePublicRecordForStorage,
  sha256Canonical,
} from '../scripts/radar/lib/public-conclusion-storage-v01.mjs'

function phase2Fixture(overrides = {}) {
  return {
    workId: '32094',
    publicationKey: 'work:32094',
    siteId: 'catalog-bangumi-4887',
    title: '奏光之Strain',
    finalState: 'ready_for_unified_incremental_assembly',
    coverageExemptNoncanonical: false,
    resolvedCandidateSha256: 'a'.repeat(64),
    liveGuard: {
      passed: true,
      draft: { humanTrackRecorded: true },
      live: { title: '奏光之Strain' },
    },
    warnings: [],
    resolvedSnapshot: {
      assessedAt: '2026-07-24T17:07:47.521Z',
      assessmentBatch: 'RADAR-REMAINING-1122-CLOSEOUT-20260724',
      confidencePercent: 45,
      contradictions: [],
      decisiveRuleCode: 'D-UNCLEAR',
      decisiveRuleReason: '资料有限，当前以一般向作品处理。',
      evidenceCoveragePercent: 35,
      evidenceStatus: 'single_traceable_source_ai_conclusion',
      matchedRules: [{
        code: 'D-UNCLEAR',
        confidencePercent: 45,
        grade: 'D',
        reason: '资料有限，当前以一般向作品处理。',
      }],
      policyVersion: 'radar-rating-policy-v0.6-generalized-dryrun',
      requiresHumanReview: true,
      sourceCount: 1,
      sourceSummary: 'Only one traceable provider is currently available.',
      suggestedGrade: 'D',
    },
    ...overrides,
  }
}

test('fixed unified cardinality is 683 + 1121 = 1804', () => {
  assert.equal(EXPECTED_OLD_ROWS, 683)
  assert.equal(EXPECTED_NEW_ROWS, 1121)
  assert.equal(EXPECTED_ROWS, 1804)
  assert.deepEqual(EXPECTED_INCREMENTAL_GRADES, {
    A: 104,
    B: 692,
    C: 182,
    D: 779,
    E: 39,
    F: 8,
  })
})

test('single-provider AI conclusion remains explicit and transparent', () => {
  const snapshot = phase2Fixture().resolvedSnapshot
  assert.equal(evidenceStrengthFor(snapshot), 'weak')
  assert.equal(ratingNoticeFor(snapshot), 'insufficient_information')
  assert.equal(storageEvidenceStatusFor(snapshot.evidenceStatus), 'single_secondary_supported')
  assert.deepEqual(reviewReasonsFor(snapshot), [
    'radar_v06_package_import',
    'radar_guard_low_evidence_coverage',
    'radar_guard_weak_or_conflicting_source',
    'radar_guard_unclear_provisional_grade',
  ])
})

test('human track never blocks phase2 AI storage', () => {
  const row = buildPhase2StorageRow(phase2Fixture())
  assert.equal(row.humanTrackRecorded, true)
  assert.equal(row.humanTrackAffectsAIStorage, false)
  assert.equal(row.publicStatus, 'ready_public_ai_create')
  assert.equal(row.storageStatus, 'ready_public_ai_storage_normalized')
  assert.equal(row.publicRecord.compatibilityGrade, 'D')
  assert.equal(row.publicRecord.evidenceStrength, 'weak')
  assert.equal(row.publicRecord.ratingNotice, 'insufficient_information')
  assert.equal(row.sourceEvidenceStatus, 'single_traceable_source_ai_conclusion')
  assert.equal(row.storageEvidenceStatus, 'single_secondary_supported')
  assert.equal(row.publicRecord.radarAssessment.evidenceStatus, 'single_secondary_supported')
  assert.equal(row.publicRecord.sourcePackageId, 'RADAR-REMAINING-1122-PHASE2-LIVE-GUARD-CLOSEOUT-20260725-005950')
})

function syntheticStorageRow(workId, grade) {
  const snapshot = canonical({
    assessedAt: '2026-07-24T17:07:47.521Z',
    assessmentBatch: 'RADAR-UNIFIED-1804-SYNTHETIC-TEST',
    confidencePercent: 80,
    contradictions: [],
    decisiveRuleCode: `${grade}-TEST`,
    decisiveRuleReason: `Synthetic ${grade} test rule.`,
    evidenceCoveragePercent: 70,
    evidenceStatus: 'multiple_secondary_supported',
    matchedRules: [{
      code: `${grade}-TEST`,
      confidencePercent: 80,
      grade,
      reason: `Synthetic ${grade} test rule.`,
    }],
    policyVersion: 'radar-rating-policy-v0.6-generalized-dryrun',
    requiresHumanReview: true,
    sourceCount: 2,
    sourceSummary: `Synthetic source summary ${workId}.`,
    suggestedGrade: grade,
  })
  const core = canonical({
    publicationKey: `work:${workId}`,
    work: String(workId),
    workIdSnapshot: String(workId),
    workSiteId: `test-${workId}`,
    title: `Synthetic ${workId}`,
    recordStatus: 'current',
    conclusionMode: 'fixed_grade',
    compatibilityGrade: grade,
    bestGrade: grade,
    likelyGrade: grade,
    worstGrade: grade,
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['radar_v06_package_import'],
    evidenceStrength: 'strong',
    radarAssessment: snapshot,
    sourceKind: 'package',
    sourcePackageId: 'synthetic',
    sourcePackageSha256: 'b'.repeat(64),
    publicationVersion: 'synthetic-v0.1',
  })
  const pre = canonical({ ...core, conclusionSha256: sha256Canonical(core) })
  const record = normalizePublicRecordForStorage(pre).normalizedRecord
  return canonical({
    sourceWorkId: String(workId),
    publicStatus: 'ready_public_ai_create',
    storageStatus: 'ready_public_ai_storage_normalized',
    blockers: [],
    privateBlockers: [],
    publicBlockers: [],
    publicRecord: record,
  })
}

test('lab validator accepts the exact 1804-grade distribution', () => {
  const rows = []
  let workId = 100000
  for (const [grade, count] of Object.entries(EXPECTED_INCREMENTAL_GRADES)) {
    for (let index = 0; index < count; index += 1) {
      rows.push(syntheticStorageRow(workId, grade))
      workId += 1
    }
  }
  const validated = validateReadyRows(rows)
  assert.equal(validated.records.length, EXPECTED_ROWS)
  assert.deepEqual(validated.gradeCounts, EXPECTED_INCREMENTAL_GRADES)
  const sql = buildSqlBundle(validated)
  assert.equal(sql.summary.baselineRows, EXPECTED_BASELINE_ROWS)
  assert.equal(sql.summary.finalRows, EXPECTED_FINAL_ROWS)
  assert.deepEqual(sql.summary.finalGradeCounts, EXPECTED_FINAL_GRADES)
  assert.match(sql.applySql, /expected 1804 input rows/u)
  assert.match(sql.applySql, /expected 10804 rows after apply/u)
  assert.match(sql.rollbackSql, /rollback expected 9000 baseline rows/u)
})

test('runner keeps production read-only and lab network disabled', () => {
  const runner = fs.readFileSync(
    path.resolve('scripts/radar/run-and-package-radar-unified-incremental-storage-lab-v01.ps1'),
    'utf8',
  )
  assert.match(runner, /--network none/u)
  assert.match(runner, /default_transaction_read_only=on/u)
  assert.match(runner, /ProductionDatabaseWrite: False/u)
  assert.match(runner, /ProductionApplyAuthorized: False/u)
  assert.doesNotMatch(runner, /AUTHORIZE-PRODUCTION/u)
})

test('orchestrator binds the exact isolated-lab confirmation phrase', () => {
  const runner = fs.readFileSync(
    path.resolve('scripts/radar/run-and-package-radar-unified-incremental-assembly-and-lab-v01.ps1'),
    'utf8',
  )
  assert.match(runner, /RUN-ISOLATED-RADAR-UNIFIED-1804-INCREMENTAL-STORAGE-LAB-V01/u)
  assert.match(runner, /RADAR-UNIFIED-1804-INCREMENTAL-ASSEMBLY-/u)
})

test('lab runner reads the exact summary filename emitted by the SQL builder', () => {
  const builder = fs.readFileSync(
    path.resolve('scripts/radar/build-radar-unified-incremental-storage-lab-v01.mjs'),
    'utf8',
  )
  const runner = fs.readFileSync(
    path.resolve('scripts/radar/run-and-package-radar-unified-incremental-storage-lab-v01.ps1'),
    'utf8',
  )
  const exactName = 'radar-unified-incremental-storage-lab-plan-summary.json'
  assert.match(builder, new RegExp(exactName.replaceAll('.', '\\.')))
  assert.match(runner, new RegExp(exactName.replaceAll('.', '\\.')))
  assert.doesNotMatch(
    runner,
    /radar-unified-1804-incremental-storage-lab-plan-summary\.json/u,
  )
})
