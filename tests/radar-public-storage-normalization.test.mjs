import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PUBLIC_CONCLUSION_STORAGE_VERSION,
  canonical,
  conclusionSha256ForRecord,
  normalizePublicRecordForStorage,
  normalizeTimestampForPostgres3,
} from '../scripts/radar/lib/public-conclusion-storage-v01.mjs'

const root = process.cwd()
const builderPath = path.join(root, 'scripts/radar/build-radar-public-storage-normalization-v01.mjs')
const builder = fs.readFileSync(builderPath, 'utf8')

test('storage normalization library and builder pass the Node parser', () => {
  for (const file of [
    path.join(root, 'scripts/radar/lib/public-conclusion-storage-v01.mjs'),
    builderPath,
  ]) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
})

test('PostgreSQL timestamp(3) normalization rounds and canonicalizes UTC', () => {
  assert.equal(normalizeTimestampForPostgres3('2026-07-14T18:11:01.252188+00:00'), '2026-07-14T18:11:01.252Z')
  assert.equal(normalizeTimestampForPostgres3('2026-07-14T18:11:01.252500Z'), '2026-07-14T18:11:01.253Z')
  assert.equal(normalizeTimestampForPostgres3('2026-07-14T18:11:01.999500Z'), '2026-07-14T18:11:02.000Z')
  assert.equal(normalizeTimestampForPostgres3('2026-07-14T20:11:01.123499+02:00'), '2026-07-14T18:11:01.123Z')
  assert.throws(() => normalizeTimestampForPostgres3('not-a-timestamp'), /supported ISO-8601/u)
})

test('normalization changes only assessedAt and conclusionSha256', () => {
  const core = canonical({
    publicationKey: 'work:42',
    work: 42,
    workIdSnapshot: '42',
    title: 'Example',
    recordStatus: 'current',
    conclusionMode: 'fixed_grade',
    compatibilityGrade: 'A',
    bestGrade: 'A',
    likelyGrade: 'A',
    worstGrade: 'A',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['radar_v06_package_import'],
    evidenceStrength: 'strong',
    radarAssessment: {
      confidencePercent: 90,
      evidenceCoveragePercent: 80,
      evidenceStatus: 'multiple_secondary_supported',
      sourceSummary: 'fixture',
      sourceCount: 2,
      policyVersion: 'fixture-v01',
      assessmentBatch: 'fixture-batch',
      suggestedGrade: 'A',
      decisiveRuleCode: 'A01',
      decisiveRuleReason: 'fixture',
      requiresHumanReview: true,
      assessedAt: '2026-07-14T18:11:01.252500+00:00',
      matchedRules: [{ code: 'A01', grade: 'A', confidencePercent: 90, reason: 'fixture' }],
      contradictions: [],
    },
    sourceKind: 'package',
    sourcePackageId: 'fixture',
    sourcePackageSha256: 'a'.repeat(64),
    publicationVersion: 'fixture-v01',
  })
  const record = canonical({ ...core, conclusionSha256: conclusionSha256ForRecord(core) })
  const { normalizedRecord, mapping } = normalizePublicRecordForStorage(record)

  assert.equal(mapping.oldAssessedAt, '2026-07-14T18:11:01.252500+00:00')
  assert.equal(mapping.normalizedAssessedAt, '2026-07-14T18:11:01.253Z')
  assert.notEqual(mapping.oldConclusionSha256, mapping.newConclusionSha256)
  assert.equal(normalizedRecord.radarAssessment.assessedAt, '2026-07-14T18:11:01.253Z')
  assert.equal(conclusionSha256ForRecord(normalizedRecord), normalizedRecord.conclusionSha256)
  assert.deepEqual(mapping.changedFields, [
    'publicRecord.radarAssessment.assessedAt',
    'publicRecord.conclusionSha256',
  ])
})

test('builder is bound to accepted evidence and supersedes only the old data plan', () => {
  assert.match(builder, /EXPECTED_ROWS = 9000/u)
  assert.match(builder, /7877020d0314352531290be0d4e334d2b17e18e6f552591dd14e30431f7837ba/u)
  assert.match(builder, /297fed9ab54675748e5ae0dd812cfa4ac367966d12e7732541913223d74ac0fb/u)
  assert.match(builder, /95111c7a01fc5c56efd58a9ed03a2c446ec831d1b6fe3ce6822a9bdfafc1258f/u)
  assert.match(builder, /f44f647833b4a1ea39ea48ee71d59a5f707c0f8595734ce6a1871372ba7014dc/u)
  assert.match(builder, /oldPublicWritePlanSuperseded: true/u)
  assert.match(builder, /businessAuditSuperseded: false/u)
  assert.match(builder, /migrationDdlSuperseded: false/u)
  assert.match(builder, /oldReadyFileMustNotBeWritten: true/u)
  assert.match(builder, /ready_public_ai_storage_normalized/u)
  assert.match(builder, new RegExp(PUBLIC_CONCLUSION_STORAGE_VERSION.replaceAll('.', '\\.')))
})

test('normalization builder has no database, Payload, migration, or production apply path', () => {
  assert.doesNotMatch(builder, /\bfetch\s*\(/u)
  assert.doesNotMatch(builder, /payload\s+(?:migrate|update|create)/iu)
  assert.doesNotMatch(builder, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE TABLE)\b/iu)
  assert.doesNotMatch(builder, /docker\s+exec/iu)
  assert.doesNotMatch(builder, /AUTHORIZE-PRODUCTION/u)
  assert.match(builder, /productionDatabaseWrite: false/u)
  assert.match(builder, /productionApplyAuthorized: false/u)
})
