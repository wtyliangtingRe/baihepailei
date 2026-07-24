import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  EXPECTED_ASSEMBLY_ZIP_SHA256,
  EXPECTED_BASELINE_ROWS,
  EXPECTED_FINAL_ROWS,
  EXPECTED_INCREMENTAL_GRADES,
  EXPECTED_ROWS,
  buildSqlBundle,
  validateReadyRows,
} from '../scripts/radar/build-radar-blocked-incremental-storage-lab-v01.mjs'
import {
  canonical,
  sha256Canonical,
} from '../scripts/radar/lib/public-conclusion-storage-v01.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const runnerPath = path.join(root, '..', 'scripts', 'radar', 'run-and-package-radar-blocked-incremental-storage-lab-v01.ps1')

function gradeList() {
  return Object.entries(EXPECTED_INCREMENTAL_GRADES).flatMap(([grade, count]) => Array(count).fill(grade))
}

function makeRows() {
  return gradeList().map((grade, index) => {
    const work = String(index + 1)
    const core = canonical({
      publicationKey: `work:${work}`,
      work,
      workIdSnapshot: work,
      workSiteId: `site-${work}`,
      title: `Work ${work}`,
      recordStatus: 'current',
      conclusionMode: 'fixed_grade',
      compatibilityGrade: grade,
      bestGrade: grade,
      likelyGrade: grade,
      worstGrade: grade,
      ratingNotice: 'ai_synthesized_pending_review',
      reviewReasons: ['radar_v06_package_import'],
      evidenceStrength: 'strong',
      radarAssessment: {
        confidencePercent: 90,
        evidenceCoveragePercent: 75,
        evidenceStatus: 'multiple_secondary_supported',
        sourceSummary: `Summary ${work}`,
        sourceCount: 2,
        policyVersion: 'policy-v1',
        assessmentBatch: 'batch-v1',
        suggestedGrade: grade,
        decisiveRuleCode: `${grade}-RULE`,
        decisiveRuleReason: `Reason ${work}`,
        requiresHumanReview: true,
        assessedAt: '2026-07-24T03:37:27.000Z',
        matchedRules: [{ code: `${grade}-RULE`, grade, confidencePercent: 90, reason: `Reason ${work}` }],
        contradictions: [],
      },
      sourceKind: 'package',
      sourcePackageId: 'test-package',
      sourcePackageSha256: 'a'.repeat(64),
      publicationVersion: 'incremental-v1',
    })
    const publicRecord = canonical({ ...core, conclusionSha256: sha256Canonical(core) })
    return canonical({
      sourceWorkId: work,
      publicStatus: 'ready_public_ai_create',
      storageStatus: 'ready_public_ai_storage_normalized',
      blockers: [],
      privateBlockers: [],
      publicBlockers: [],
      publicRecord,
    })
  })
}

test('locks the accepted 683-row assembly package and 9000-row baseline', () => {
  assert.equal(EXPECTED_ASSEMBLY_ZIP_SHA256, 'd41fb41951e35e8dc0c2cdde1fb904968af3df5d3564bddb8a13a3fb002c14c2')
  assert.equal(EXPECTED_ROWS, 683)
  assert.equal(EXPECTED_BASELINE_ROWS, 9000)
  assert.equal(EXPECTED_FINAL_ROWS, 9683)
})

test('validates exact create identities, hashes, children, and grade distribution', () => {
  const result = validateReadyRows(makeRows())
  assert.equal(result.records.length, 683)
  assert.equal(result.publicationKeys.length, 683)
  assert.equal(result.workIds.length, 683)
  assert.equal(result.conclusionHashes.length, 683)
  assert.equal(result.reviewReasonRows, 683)
  assert.equal(result.matchedRuleRows, 683)
  assert.equal(result.contradictionRows, 0)
  assert.deepEqual(result.gradeCounts, EXPECTED_INCREMENTAL_GRADES)
})

test('rejects an overlapping or duplicate publication identity before SQL generation', () => {
  const rows = makeRows()
  rows[1].publicRecord.publicationKey = rows[0].publicRecord.publicationKey
  assert.throws(() => validateReadyRows(rows), /publication identity mismatch|Duplicate publicationKey/u)
})

test('generates insert-only lab apply and exact bounded rollback', () => {
  const sql = buildSqlBundle(validateReadyRows(makeRows()))
  assert.match(sql.applySql, /BEGIN ISOLATION LEVEL SERIALIZABLE/u)
  assert.match(sql.applySql, /INSERT INTO radar_public \(/u)
  assert.match(sql.applySql, /incremental publication-key overlap/u)
  assert.doesNotMatch(sql.applySql, /\bUPDATE\b|ON\s+CONFLICT|MERGE\s+INTO/iu)
  assert.match(sql.rollbackSql, /DELETE FROM radar_public p USING radar_blocked_incremental_input_raw/u)
  assert.doesNotMatch(sql.rollbackSql, /DELETE FROM works|UPDATE\s+works|TRUNCATE/iu)
})

test('production preflight is transaction-enforced read-only and checks zero overlap', () => {
  const sql = buildSqlBundle(validateReadyRows(makeRows())).readonlyPreflight
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u)
  assert.match(sql, /input_publication_overlap/u)
  assert.match(sql, /input_work_ids_exist/u)
  assert.doesNotMatch(sql, /CREATE TEMP|COPY\s|INSERT\s|UPDATE\s|DELETE\s|ALTER\s|DROP\s|TRUNCATE\s/iu)
})

test('acceptance binds 9683 rows, the 683 exact input rows, and child deltas', () => {
  const sql = buildSqlBundle(validateReadyRows(makeRows())).acceptanceSql
  assert.match(sql, /main_rows/u)
  assert.match(sql, /9683/u)
  assert.match(sql, /input_main_mismatches/u)
  assert.match(sql, /input_review_reason_delta/u)
  assert.match(sql, /input_matched_rule_delta/u)
  assert.match(sql, /input_contradiction_delta/u)
  assert.match(sql, /grade_S/u)
  assert.match(sql, /grade_F/u)
})

test('fingerprints preserve the original 9000 main and child rows', () => {
  const sql = buildSqlBundle(validateReadyRows(makeRows()))
  assert.match(sql.baselineFingerprintSql, /NOT EXISTS \(SELECT 1 FROM input_keys/u)
  assert.match(sql.baselineFingerprintSql, /review_reason_md5/u)
  assert.match(sql.baselineFingerprintSql, /matched_rule_md5/u)
  assert.match(sql.baselineFingerprintSql, /contradiction_md5/u)
  assert.match(sql.fullFingerprintSql, /to_jsonb\(b\)::text/u)
})

test('runner uses fresh pg_dump and a network-none disposable PostgreSQL', () => {
  const runner = fs.readFileSync(runnerPath, 'utf8')
  assert.match(runner, /pg_dump/u)
  assert.match(runner, /--serializable-deferrable/u)
  assert.match(runner, /docker run -d --name \$labContainer --network none/u)
  assert.match(runner, /pg_restore[\s\S]*--exit-on-error/u)
  assert.match(runner, /ProductionDatabaseWrite: False/u)
})

test('runner protects production with read-only PGOPTIONS and never creates a production gate', () => {
  const runner = fs.readFileSync(runnerPath, 'utf8')
  assert.match(runner, /default_transaction_read_only=on/u)
  assert.match(runner, /productionDatabaseWrite = \$false/u)
  assert.match(runner, /productionApplyAuthorized = \$false/u)
  assert.match(runner, /productionGateGenerated = \$false/u)
  assert.doesNotMatch(runner, /AUTHORIZE-PRODUCTION|production-apply\.sql\.disabled/u)
})

test('runner restores both Radar sequences and excludes the full dump from evidence ZIP', () => {
  const runner = fs.readFileSync(runnerPath, 'utf8')
  assert.match(runner, /radar_public_id_seq/u)
  assert.match(runner, /radar_public_review_reasons_id_seq/u)
  assert.match(runner, /Write-SequenceRestoreSql/u)
  assert.match(runner, /Where-Object \{ \$_\.Name -ne 'database-backup\.dump' \}/u)
  assert.match(runner, /BaselineRestored\s+: True/u)
})

test('runner explicitly permits the passwordless production container path', () => {
  const runner = fs.readFileSync(runnerPath, 'utf8')
  assert.match(
    runner,
    /\[AllowEmptyString\(\)\]\s*\r?\n\s*\[string\]\$Password/u,
  )
  assert.match(runner, /-Password ''/u)
})

test('acceptance temp-table import is writable only inside the isolated lab', () => {
  const sql = buildSqlBundle(validateReadyRows(makeRows()))
  assert.match(
    sql.acceptanceSql,
    /BEGIN ISOLATION LEVEL REPEATABLE READ;\s*CREATE TEMP TABLE radar_blocked_incremental_input_raw/u,
  )
  assert.match(sql.acceptanceSql, /ON COMMIT DROP/u)
  assert.doesNotMatch(
    sql.acceptanceSql,
    /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u,
  )

  assert.match(
    sql.postRollbackSql,
    /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u,
  )
  assert.doesNotMatch(sql.postRollbackSql, /CREATE TEMP|COPY\s/iu)

  const runner = fs.readFileSync(runnerPath, 'utf8')
  assert.match(
    runner,
    /-Prefix 'incremental-acceptance'[\s\S]{0,180}-ReadOnly \$false/u,
  )
  assert.doesNotMatch(
    runner,
    /-Prefix 'incremental-acceptance'[\s\S]{0,180}-ReadOnly \$true/u,
  )
})
