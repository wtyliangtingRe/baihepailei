import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const targetBuilder = path.join(repoRoot, 'scripts/radar/build-test-work-write-schema-targets-v01.mjs')
const summaryBuilder = path.join(repoRoot, 'scripts/radar/build-test-work-write-schema-summary-v01.mjs')
const runner = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-test-work-write-schema-audit-v01.ps1'),
  'utf8',
)

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function manifest(directory, name, files) {
  writeJson(path.join(directory, name), files.map((fileName) => {
    const file = path.join(directory, fileName)
    return { file: fileName, bytes: fs.statSync(file).size, sha256: sha256(file) }
  }))
}

function createInputs(root) {
  const dryRun = path.join(root, 'dryrun')
  const backup = path.join(root, 'backup')
  fs.mkdirSync(dryRun)
  fs.mkdirSync(backup)

  writeJson(path.join(dryRun, 'merge-dryrun-summary.json'), {
    schemaVersion: 3,
    exactBeforeAllChecksRequireTrue: true,
    safety: { databaseWrite: false, mergePerformed: false },
  })
  writeJson(path.join(dryRun, 'canonical-merge-decisions.json'), [
    { alertId: 'identity:1:2', canonicalWorkId: 2, mergeOutWorkId: 1 },
  ])
  writeJsonl(path.join(dryRun, 'field-merge-plan.jsonl'), [
    { field: 'external_ids_mal_id' },
  ])
  writeJsonl(path.join(dryRun, 'relation-merge-plan.jsonl'), [
    {
      tableSchema: 'public', tableName: 'works_source_links', columnName: '_parent_id', rowId: 10,
      action: 'copy_factual_child_to_canonical_if_exact_before_still_matches',
    },
    {
      tableSchema: 'public', tableName: 'works_review_reasons', columnName: '_parent_id', rowId: 11,
      action: 'discard_test_assessment_child_row',
    },
    {
      tableSchema: 'public', tableName: '_works_v', columnName: 'parent_id', rowId: 12,
      action: 'preserve_version_parent_in_place',
    },
  ])
  writeJsonl(path.join(dryRun, 'feedback-test-cleanup-plan.jsonl'), [
    {
      tableSchema: 'public', tableName: 'feedback_submissions', columnName: 'linked_work_id', rowId: 13,
      action: 'archive_confirmed_test_feedback_without_treating_it_as_evidence',
    },
  ])
  writeJsonl(path.join(dryRun, 'test-assessment-cleanup-plan.jsonl'), [
    {
      workId: 1,
      after: {
        human_assessment_status: 'pending',
        human_reviewed_at: null,
        rank: 'unknown',
        rating_notice: 'insufficient_information',
      },
    },
    {
      workId: 2,
      after: {
        human_assessment_status: 'pending',
        human_reviewed_at: null,
        rank: 'unknown',
        rating_notice: 'insufficient_information',
      },
    },
  ])
  writeJsonl(path.join(dryRun, 'work-standardization-plan.jsonl'), [
    { action: 'merge_clean_search_text_lines', workId: 2 },
  ])
  manifest(dryRun, 'manifest.json', [
    'merge-dryrun-summary.json',
    'canonical-merge-decisions.json',
    'field-merge-plan.jsonl',
    'relation-merge-plan.jsonl',
    'feedback-test-cleanup-plan.jsonl',
    'test-assessment-cleanup-plan.jsonl',
    'work-standardization-plan.jsonl',
  ])

  fs.writeFileSync(path.join(backup, 'database-backup.dump'), Buffer.alloc(2048, 9))
  writeJson(path.join(backup, 'backup-verification-summary.json'), {
    backupRestoreVerified: true,
    backupBytes: 2048,
    backupSha256: sha256(path.join(backup, 'database-backup.dump')),
    productionPreMatchedChecks: 37,
    productionPostMatchedChecks: 37,
    restoredMatchedChecks: 37,
    productionCountsStableDuringBackup: true,
    restoredCountsMatchProduction: true,
    safety: { productionDatabaseWrite: false, mergePerformed: false },
  })
  manifest(backup, 'evidence-manifest.json', ['backup-verification-summary.json'])
  return { dryRun, backup }
}

test('target builder binds write-schema audit to the verified local backup and excludes version-preservation-only tables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-schema-targets-'))
  const { dryRun, backup } = createInputs(root)
  const output = path.join(root, 'write-schema-targets.json')

  const result = spawnSync(process.execPath, [
    targetBuilder,
    '--dryrun-v03-dir', dryRun,
    '--backup-verification-dir', backup,
    '--output', output,
  ], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)

  const targets = JSON.parse(fs.readFileSync(output, 'utf8'))
  const names = targets.writeTargets.map((row) => row.tableName)
  assert.deepEqual(names.sort(), ['feedback_submissions', 'works', 'works_review_reasons', 'works_source_links'])
  assert.ok(!names.includes('_works_v'))
  assert.equal(targets.localBackup.restoreVerified, true)
  assert.equal(targets.localBackup.sha256, sha256(path.join(backup, 'database-backup.dump')))
  const works = targets.writeTargets.find((row) => row.tableName === 'works')
  assert.ok(works.plannedColumns.includes('human_reviewed_at'))
  assert.ok(works.plannedColumns.includes('external_ids_mal_id'))
  assert.ok(works.plannedColumns.includes('search_text'))
  assert.equal(targets.safety.executableTransactionSqlGenerated, false)
})

test('summary builder requires every planned table and column while preserving a non-writing planning gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-schema-summary-'))
  const directory = path.join(root, 'audit')
  fs.mkdirSync(directory)

  const targetRows = [
    {
      tableSchema: 'public', tableName: 'works',
      plannedActions: ['update_canonical_and_merge_out_work_rows'],
      plannedColumns: ['id', 'rank'], plannedRowIds: [],
    },
    {
      tableSchema: 'public', tableName: 'feedback_submissions',
      plannedActions: ['archive_confirmed_test_feedback_without_treating_it_as_evidence'],
      plannedColumns: ['linked_work_id'], plannedRowIds: [13],
    },
  ]
  writeJson(path.join(directory, 'write-schema-targets.json'), {
    writeTargets: targetRows,
    localBackup: { file: 'database-backup.dump', bytes: 2048, sha256: 'a'.repeat(64), restoreVerified: true },
    safety: { databaseWrite: false, executableTransactionSqlGenerated: false },
  })
  writeJson(path.join(directory, 'validation.json'), {
    postgresReadOnly: true,
    jsonValidated: true,
    databaseWrite: false,
    payloadWrite: false,
    executableTransactionSqlGenerated: false,
  })
  writeJsonl(path.join(directory, 'table-metadata.jsonl'), targetRows.map((row) => ({
    ...row, relationKind: 'r', rowLevelSecurityEnabled: false, rowLevelSecurityForced: false,
  })))
  writeJsonl(path.join(directory, 'column-metadata.jsonl'), [
    { tableSchema: 'public', tableName: 'works', columnName: 'id', typeKind: 'b' },
    { tableSchema: 'public', tableName: 'works', columnName: 'rank', typeKind: 'e' },
    { tableSchema: 'public', tableName: 'feedback_submissions', columnName: 'id', typeKind: 'b' },
    { tableSchema: 'public', tableName: 'feedback_submissions', columnName: 'linked_work_id', typeKind: 'b' },
  ])
  writeJsonl(path.join(directory, 'constraints.jsonl'), [
    { tableSchema: 'public', tableName: 'works', constraintName: 'works_pkey', constraintType: 'p', definition: 'PRIMARY KEY (id)' },
    { tableSchema: 'public', tableName: 'feedback_submissions', constraintName: 'feedback_pkey', constraintType: 'p', definition: 'PRIMARY KEY (id)' },
  ])
  writeJsonl(path.join(directory, 'indexes.jsonl'), [])
  writeJsonl(path.join(directory, 'triggers.jsonl'), [])
  writeJsonl(path.join(directory, 'policies.jsonl'), [])
  writeJsonl(path.join(directory, 'enum-labels.jsonl'), [
    { tableSchema: 'public', tableName: 'works', columnName: 'rank', label: 'unknown' },
  ])
  writeJsonl(path.join(directory, 'sequence-metadata.jsonl'), [])

  const result = spawnSync(process.execPath, [summaryBuilder, '--directory', directory], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const summary = JSON.parse(fs.readFileSync(path.join(directory, 'write-schema-audit-summary.json'), 'utf8'))
  assert.equal(summary.blockers.length, 0)
  assert.equal(summary.readyForTransactionSqlPlanning, true)
  assert.equal(summary.safety.databaseWrite, false)
  assert.equal(summary.safety.executableTransactionSqlGenerated, false)
})

test('PowerShell runner audits schema read-only and does not generate or execute merge SQL', () => {
  assert.match(runner, /BEGIN TRANSACTION READ ONLY;/u)
  assert.match(runner, /default_transaction_read_only=on/u)
  assert.match(runner, /pg_get_constraintdef/u)
  assert.match(runner, /pg_get_triggerdef/u)
  assert.match(runner, /pg_policy/u)
  assert.match(runner, /pg_enum/u)
  assert.match(runner, /ExecutableTransactionSQL\s+: False/u)
  assert.match(runner, /BackupFileModified\s+: False/u)
  assert.doesNotMatch(runner, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/imu)
})
