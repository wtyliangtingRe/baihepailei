import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const builder = path.join(repoRoot, 'scripts/radar/build-test-work-backup-verification-summary-v01.mjs')
const runnerV1 = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-test-work-backup-verification-v01.ps1'),
  'utf8',
)
const runnerV2 = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-test-work-backup-verification-v02.ps1'),
  'utf8',
)

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function exactSummary() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-23T00:00:00.000Z',
    sourceSqlSha256: 'a'.repeat(64),
    sourceExpectationsSha256: 'b'.repeat(64),
    expectedChecks: 37,
    observedChecks: 37,
    matchedChecks: 37,
    failedChecks: 0,
    exactRowChecks: 7,
    relationCountChecks: 19,
    versionRelationCountChecks: 11,
    missingChecks: [],
    unexpectedChecks: [],
    duplicateActualChecks: [],
    stderrLineCount: 0,
    allChecksMatched: true,
  }
}

test('evidence builder requires three matching exact runs, stable table counts, and a restorable dump listing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-verify-evidence-'))
  for (const prefix of ['production-pre', 'production-post', 'restore']) {
    writeJson(path.join(directory, `${prefix}-exact-before-run-summary.json`), exactSummary())
  }
  writeJson(path.join(directory, 'source-exact-before-run-summary.json'), exactSummary())

  const tableCounts = 'public._works_v\t82898\npublic.works\t35615\n'
  fs.writeFileSync(path.join(directory, 'production-pre-table-counts.tsv'), tableCounts, 'utf8')
  fs.writeFileSync(path.join(directory, 'production-post-table-counts.tsv'), tableCounts, 'utf8')
  fs.writeFileSync(path.join(directory, 'restore-table-counts.tsv'), tableCounts, 'utf8')

  fs.writeFileSync(path.join(directory, 'database-backup.dump'), Buffer.alloc(2048, 7))
  fs.writeFileSync(
    path.join(directory, 'pg-restore-list.txt'),
    '1; 0 0 TABLE DATA public works restore_verify\n2; 0 0 TABLE DATA public _works_v restore_verify\n',
    'utf8',
  )
  fs.writeFileSync(path.join(directory, 'postgres-image.txt'), 'postgres:16\n', 'utf8')

  for (const name of [
    'pg-dump-stderr.txt',
    'pg-restore-list-stderr.txt',
    'pg-restore-stderr.txt',
    'production-pre-table-counts-stderr.txt',
    'production-post-table-counts-stderr.txt',
    'restore-table-counts-stderr.txt',
  ]) {
    fs.writeFileSync(path.join(directory, name), '', 'utf8')
  }

  const result = spawnSync(process.execPath, [builder, '--directory', directory], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)

  const summary = JSON.parse(fs.readFileSync(path.join(directory, 'backup-verification-summary.json'), 'utf8'))
  assert.equal(summary.backupRestoreVerified, true)
  assert.equal(summary.productionCountsStableDuringBackup, true)
  assert.equal(summary.restoredCountsMatchProduction, true)
  assert.equal(summary.businessTableCountChecks, 2)
  assert.equal(summary.productionPreMatchedChecks, 37)
  assert.equal(summary.productionPostMatchedChecks, 37)
  assert.equal(summary.restoredMatchedChecks, 37)
  assert.equal(summary.safety.productionDatabaseWrite, false)
  assert.equal(summary.safety.ephemeralVerificationDatabaseWrite, true)
  assert.equal(summary.safety.ephemeralVerificationContainerRemoved, true)

  const evidenceManifest = JSON.parse(fs.readFileSync(path.join(directory, 'evidence-manifest.json'), 'utf8'))
  assert.ok(!evidenceManifest.some((row) => row.file === 'database-backup.dump'))
  assert.ok(evidenceManifest.some((row) => row.file === 'database-backup.dump.sha256'))
})

test('evidence builder fails closed when restored table counts differ', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-verify-mismatch-'))
  for (const prefix of ['production-pre', 'production-post', 'restore']) {
    writeJson(path.join(directory, `${prefix}-exact-before-run-summary.json`), exactSummary())
  }
  writeJson(path.join(directory, 'source-exact-before-run-summary.json'), exactSummary())
  fs.writeFileSync(path.join(directory, 'production-pre-table-counts.tsv'), 'public.works\t10\n', 'utf8')
  fs.writeFileSync(path.join(directory, 'production-post-table-counts.tsv'), 'public.works\t10\n', 'utf8')
  fs.writeFileSync(path.join(directory, 'restore-table-counts.tsv'), 'public.works\t9\n', 'utf8')
  fs.writeFileSync(path.join(directory, 'database-backup.dump'), Buffer.alloc(2048, 7))
  fs.writeFileSync(
    path.join(directory, 'pg-restore-list.txt'),
    '1; 0 0 TABLE DATA public works restore_verify\n2; 0 0 TABLE DATA public _works_v restore_verify\n',
    'utf8',
  )
  fs.writeFileSync(path.join(directory, 'postgres-image.txt'), 'postgres:16\n', 'utf8')
  for (const name of [
    'pg-dump-stderr.txt',
    'pg-restore-list-stderr.txt',
    'pg-restore-stderr.txt',
    'production-pre-table-counts-stderr.txt',
    'production-post-table-counts-stderr.txt',
    'restore-table-counts-stderr.txt',
  ]) fs.writeFileSync(path.join(directory, name), '', 'utf8')

  const result = spawnSync(process.execPath, [builder, '--directory', directory], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Restored table counts do not match/u)
})

test('backup runner dumps production read-only and restores only into a disposable isolated container', () => {
  assert.match(runnerV1, /pg_dump/u)
  assert.match(runnerV1, /--serializable-deferrable/u)
  assert.match(runnerV1, /--no-owner/u)
  assert.match(runnerV1, /pg_restore/u)
  assert.match(runnerV1, /--exit-on-error/u)
  assert.match(runnerV1, /production-pre/u)
  assert.match(runnerV1, /production-post/u)
  assert.match(runnerV1, /Prefix 'restore'/u)
  assert.match(runnerV1, /BEGIN TRANSACTION READ ONLY;/u)
  assert.match(runnerV1, /docker rm -fv \$verifyContainer/u)
  assert.match(runnerV1, /ProductionDatabaseWrite\s+: False/u)
  assert.match(runnerV1, /EphemeralDatabaseWrite\s+: True \(isolated container only\)/u)
  assert.doesNotMatch(runnerV1, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/imu)
})

test('parser-safe v02 entry verifies its temporary script before execution and deletes it afterward', () => {
  assert.match(runnerV2, /run-and-package-test-work-backup-verification-v01\.ps1/u)
  assert.match(runnerV2, /Parser\]::ParseFile/u)
  assert.match(runnerV2, /verificationLogStdout/u)
  assert.match(runnerV2, /verificationLogStderr/u)
  assert.match(runnerV2, /Remove-Item -LiteralPath \$temporary/u)
  assert.match(runnerV2, /ReadyTimeoutSeconds/u)
  assert.doesNotMatch(runnerV2, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/imu)
})
