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
const libraryPath = path.join(root, 'scripts/radar/lib/public-conclusion-storage-v01.mjs')
const builderPath = path.join(root, 'scripts/radar/build-radar-public-storage-normalization-v01.mjs')
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-public-storage-normalization-v01.ps1')
const library = fs.readFileSync(libraryPath, 'utf8')
const builder = fs.readFileSync(builderPath, 'utf8')
const runner = fs.readFileSync(runnerPath, 'utf8')

test('storage normalization library, builder, and runner pass their real parsers', () => {
  for (const file of [libraryPath, builderPath]) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
  const command = [
    '$tokens = $null;',
    '$errors = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${runnerPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null;`,
    'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
  ].join(' ')
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
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
  assert.equal(PUBLIC_CONCLUSION_STORAGE_VERSION, 'radar-public-storage-normalization-v0.1')
  assert.match(library, /PUBLIC_CONCLUSION_STORAGE_VERSION = 'radar-public-storage-normalization-v0\.1'/u)
  assert.match(builder, /PUBLIC_CONCLUSION_STORAGE_VERSION/u)
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
})

test('summary and supersession metadata bind the defined storage plan hash', () => {
  const bindings = builder.match(/storageWritePlanSha256:\s*storagePlanSha256/gu) || []
  assert.equal(bindings.length, 2)
  assert.doesNotMatch(
    builder,
    /replacementDataArtifacts\s*:\s*\{[^}]*\bstorageWritePlanSha256\s*,/su,
  )
  assert.match(builder, /const storagePlanSha256 = sha256File\(storagePlanPath\)/u)
})

test('package runner binds the failed lab and emits a manifest-protected replacement package', () => {
  assert.match(runner, /FailedLabDirectory/u)
  assert.match(runner, /RADAR-PUBLIC-STORAGE-NORMALIZATION-/u)
  assert.match(runner, /public-ai-storage-ready\.jsonl/u)
  assert.match(runner, /public-conclusion-storage-rewrite-map\.jsonl/u)
  assert.match(runner, /public-conclusions-storage-write-plan\.jsonl/u)
  assert.match(runner, /manifest\.json/u)
  assert.match(runner, /OldDataPlanSuperseded\s+: True/u)
  assert.match(runner, /BusinessAuditSuperseded\s+: False/u)
  assert.match(runner, /MigrationDdlSuperseded\s+: False/u)
})

test('normalization path has no database, Payload, migration, or production apply capability', () => {
  assert.doesNotMatch(builder, /node:child_process|child_process|spawn(?:Sync)?\s*\(|exec(?:File|Sync)?\s*\(/u)
  assert.doesNotMatch(builder, /from\s+['"](?:pg|postgres|postgresql|@payloadcms\/db-postgres)['"]/iu)
  assert.doesNotMatch(builder, /\bfetch\s*\(|https?:\/\/|\/api\//iu)
  assert.doesNotMatch(builder, /\b(?:INSERT\s+INTO|UPDATE\s+(?:"?[a-z_][\w.]*"?)\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE)\b/iu)
  assert.doesNotMatch(builder, /docker\s+exec|payload\s+(?:migrate|update|create)|AUTHORIZE-PRODUCTION/iu)

  assert.doesNotMatch(runner, /docker\s+exec|psql(?:\.exe)?\b|pg_dump|pg_restore/iu)
  assert.doesNotMatch(runner, /Invoke-(?:WebRequest|RestMethod)|Start-Process|System\.Diagnostics\.Process/iu)
  assert.doesNotMatch(runner, /payload\s+(?:migrate|update|create)|AUTHORIZE-PRODUCTION/iu)
  assert.doesNotMatch(runner, /\b(?:INSERT\s+INTO|UPDATE\s+(?:"?[a-z_][\w.]*"?)\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE)\b/iu)

  assert.match(builder, /productionDatabaseRead: false/u)
  assert.match(builder, /productionDatabaseWrite: false/u)
  assert.match(builder, /productionApplyAuthorized: false/u)
  assert.match(runner, /ProductionDatabaseWrite\s+: False/u)
  assert.match(runner, /ProductionApplyAuthorized\s+: False/u)
})
