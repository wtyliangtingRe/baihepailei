import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const summaryBuilder = path.join(repoRoot, 'scripts/radar/build-test-work-merge-lab-rehearsal-summary-v01.mjs')
const runnerPath = path.join(repoRoot, 'scripts/radar/run-and-package-test-work-merge-lab-rehearsal-v01.ps1')
const runner = fs.readFileSync(runnerPath, 'utf8')

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function createReview(root) {
  const directory = path.join(root, 'review')
  fs.mkdirSync(directory)
  const files = {
    'merge-transaction.sql.disabled': '-- apply\n',
    'merge-rollback.sql.disabled': '-- rollback\n',
    'merge-acceptance-readonly.sql': '-- accept\n',
    'merge-rollback-acceptance-readonly.sql': '-- rollback accept\n',
  }
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), value, 'utf8')
  writeJson(path.join(directory, 'transaction-review.json'), {
    targetWorkIds: [32186, 10097, 32094, 25561],
    backup: { bytes: 27196757, sha256: '3'.repeat(64), restoreVerified: true },
    operationCounts: {
      workUpdates: 4,
      factualChildReparents: 3,
      testAssessmentChildDeletes: 17,
      feedbackArchives: 3,
      semanticDuplicateSkips: 1,
      versionRowsGuardedExactly: 1118,
      exactBeforeRows: 1146,
      exactBeforeRelationCounts: 19,
      exactBeforeVersionCounts: 11,
    },
    execution: {
      repositoryExecutionWrapperExists: false,
      executed: false,
      explicitApprovalReceived: false,
    },
    safety: {
      databaseWrite: false,
      mergePerformed: false,
      executableSqlExtensionDisabled: true,
    },
  })
  const manifestFiles = [...Object.keys(files), 'transaction-review.json']
  writeJson(path.join(directory, 'manifest.json'), manifestFiles.map((name) => {
    const file = path.join(directory, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256(file) }
  }))
  return directory
}

function countRows(overrides = {}) {
  const rows = []
  rows.push(['public.works_review_reasons', 100])
  rows.push(['public.works_radar_assessment_matched_rules', 50])
  for (let index = 0; index < 81; index += 1) rows.push([`public.fixture_${String(index).padStart(2, '0')}`, index])
  return rows.map(([table, count]) => [table, overrides[table] ?? count])
}

function writeCounts(file, rows) {
  fs.writeFileSync(file, `${rows.map(([table, count]) => `${table}\t${count}`).join('\n')}\n`, 'utf8')
}

function createLabOutput(root, rollbackOverride = {}) {
  const directory = path.join(root, 'lab')
  fs.mkdirSync(directory)
  writeJson(path.join(directory, 'lab-rehearsal-validation.json'), {
    confirmationMatched: true,
    sourceContainerInspectOnly: true,
    labNetworkDisabled: true,
    labContainerRemoved: true,
    productionDatabaseWrite: false,
    labDatabaseWrite: true,
    mergePerformedInProduction: false,
    backupFileModified: false,
  })
  writeJson(path.join(directory, 'lab-stage-status.json'), {
    restoreCompleted: true,
    baselineAcceptancePassed: true,
    applyTransactionPassed: true,
    postMergeAcceptancePassed: true,
    rollbackTransactionPassed: true,
    postRollbackAcceptancePassed: true,
  })

  for (const name of [
    'pg-restore-stderr.txt',
    'baseline-acceptance-stderr.txt',
    'apply-transaction-stderr.txt',
    'post-merge-acceptance-stderr.txt',
    'rollback-transaction-stderr.txt',
    'post-rollback-acceptance-stderr.txt',
    'baseline-table-counts-stderr.txt',
    'post-merge-table-counts-stderr.txt',
    'post-rollback-table-counts-stderr.txt',
  ]) fs.writeFileSync(path.join(directory, name), '', 'utf8')

  const baseline = countRows()
  const postMerge = countRows({
    'public.works_review_reasons': 88,
    'public.works_radar_assessment_matched_rules': 45,
  })
  const rollback = countRows(rollbackOverride)
  writeCounts(path.join(directory, 'baseline-table-counts.tsv'), baseline)
  writeCounts(path.join(directory, 'post-merge-table-counts.tsv'), postMerge)
  writeCounts(path.join(directory, 'post-rollback-table-counts.tsv'), rollback)
  return directory
}

test('summary builder accepts only the exact apply and rollback table-count round trip', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-lab-summary-'))
  const review = createReview(root)
  const lab = createLabOutput(root)
  const result = spawnSync(process.execPath, [
    summaryBuilder,
    '--directory', lab,
    '--transaction-review-dir', review,
  ], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const summary = JSON.parse(fs.readFileSync(path.join(lab, 'lab-rehearsal-summary.json'), 'utf8'))
  assert.equal(summary.businessTableCountChecks, 83)
  assert.equal(summary.labRoundTripVerified, true)
  assert.deepEqual(summary.observedPostMergeChangedTables, [
    { table: 'public.works_radar_assessment_matched_rules', before: 50, after: 45, delta: -5, matches: false },
    { table: 'public.works_review_reasons', before: 100, after: 88, delta: -12, matches: false },
  ])
  assert.equal(summary.postRollbackMismatches.length, 0)
  assert.equal(summary.safety.productionDatabaseWrite, false)
})

test('summary builder fails closed when rollback table counts do not return to baseline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-lab-rollback-fail-'))
  const review = createReview(root)
  const lab = createLabOutput(root, { 'public.fixture_00': 1 })
  const result = spawnSync(process.execPath, [
    summaryBuilder,
    '--directory', lab,
    '--transaction-review-dir', review,
  ], { cwd: repoRoot, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /Post-rollback table counts do not match baseline/u)
})

test('PowerShell runner executes only inside a no-network disposable lab and never writes production', () => {
  assert.match(runner, /ValidateSet\('RUN-ISOLATED-TEST-WORK-MERGE-LAB-V01'\)/u)
  assert.match(runner, /--network none/u)
  assert.match(runner, /sourceContainerAccess = 'docker inspect only'/u)
  assert.match(runner, /businessTableCountChecks -ne 83/u)
  assert.match(runner, /productionDatabaseWrite = \$false/u)
  assert.match(runner, /productionExecutionWrapperGenerated = \$false/u)
  assert.match(runner, /Invoke-LabSql -ContainerSqlPath \$containerRollbackAcceptancePath -Prefix 'baseline-acceptance'/u)
  assert.match(runner, /Invoke-LabSql -ContainerSqlPath \$containerApplyPath -Prefix 'apply-transaction'/u)
  assert.match(runner, /Invoke-LabSql -ContainerSqlPath \$containerAcceptancePath -Prefix 'post-merge-acceptance'/u)
  assert.match(runner, /Invoke-LabSql -ContainerSqlPath \$containerRollbackPath -Prefix 'rollback-transaction'/u)
  assert.match(runner, /Invoke-LabSql -ContainerSqlPath \$containerRollbackAcceptancePath -Prefix 'post-rollback-acceptance'/u)
  assert.match(runner, /docker rm -fv \$labContainer/u)
  assert.doesNotMatch(runner, /docker exec[^\n]*\$SourcePostgresContainer/u)
  assert.doesNotMatch(runner, /docker cp[^\n]*\$SourcePostgresContainer/u)
  assert.doesNotMatch(runner, /pg_dump/u)
  assert.doesNotMatch(runner, /\$env:DATABASE_URL/u)
})
