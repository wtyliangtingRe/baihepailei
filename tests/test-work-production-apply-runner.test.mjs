import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const runnerV01 = fs.readFileSync(path.join(root, 'scripts/radar/execute-test-work-production-apply-once-v01.ps1'), 'utf8')
const runnerV02 = fs.readFileSync(path.join(root, 'scripts/radar/execute-test-work-production-apply-once-v02.ps1'), 'utf8')
const packager = fs.readFileSync(path.join(root, 'scripts/radar/run-and-package-test-work-production-apply-runner-review-v01.ps1'), 'utf8')
const receiptBuilder = path.join(root, 'scripts/radar/build-test-work-production-apply-receipt-v01.mjs')

function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function counts(file, review = false) {
  const rows = []
  rows.push(['public.works_review_reasons', review ? 88 : 100])
  rows.push(['public.works_radar_assessment_matched_rules', review ? 45 : 50])
  for (let index = 0; index < 81; index += 1) rows.push([`public.fixture_${String(index).padStart(2, '0')}`, index])
  fs.writeFileSync(file, `${rows.map(([name, value]) => `${name}\t${value}`).join('\n')}\n`, 'utf8')
}

test('receipt builder accepts only exact 83-table post-merge deltas and keeps rollback unauthorized', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-apply-receipt-'))
  const metadata = path.join(dir, 'metadata.json')
  const stages = path.join(dir, 'stages.json')
  const before = path.join(dir, 'before.tsv')
  const after = path.join(dir, 'after.tsv')
  writeJson(metadata, {
    executionId: 'exec-1', branchHead: 'a'.repeat(40), startedAt: new Date().toISOString(),
    productionContainer: 'baihepailei-postgres', productionImage: 'postgres:17-alpine',
    targetWorkIds: [32186,10097,32094,25561],
    authorizationPhrase: 'AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01',
    transactionManifestSha256: '1'.repeat(64), gateManifestSha256: '2'.repeat(64),
    applySqlSha256: '3'.repeat(64), acceptanceSqlSha256: '4'.repeat(64),
    freshBackupBytes: 123, freshBackupSha256: '5'.repeat(64), freshBackupPath: 'backup.dump',
    writerContainersStopped: ['app'], writerContainersRestarted: true,
  })
  writeJson(stages, {
    freshBackupRestoreVerified: true, freshSchemaFingerprintMatched: true,
    productionPreflightPassed: true, applyCommitted: true, postMergeAcceptancePassed: true,
  })
  counts(before, false); counts(after, true)
  const result = spawnSync(process.execPath, [receiptBuilder,
    '--directory', dir, '--metadata', metadata, '--stage-status', stages,
    '--baseline-counts', before, '--post-counts', after,
  ], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'production-apply-receipt.json'), 'utf8'))
  assert.equal(receipt.applyCommitted, true)
  assert.equal(receipt.postMergeTableDeltasMatched, true)
  assert.equal(receipt.productionRollbackAuthorized, false)
  assert.equal(receipt.writerContainersRestarted, true)
  assert.equal(receipt.postMergeChangedTables.length, 2)
})

test('receipt builder fails closed on any unexpected business-table delta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-apply-receipt-fail-'))
  const metadata = path.join(dir, 'metadata.json')
  const stages = path.join(dir, 'stages.json')
  const before = path.join(dir, 'before.tsv')
  const after = path.join(dir, 'after.tsv')
  writeJson(metadata, {
    executionId: 'exec-2', branchHead: 'a'.repeat(40), startedAt: new Date().toISOString(),
    productionContainer: 'baihepailei-postgres', productionImage: 'postgres:17-alpine',
    targetWorkIds: [32186,10097,32094,25561], authorizationPhrase: 'AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01',
    transactionManifestSha256: '1'.repeat(64), gateManifestSha256: '2'.repeat(64), applySqlSha256: '3'.repeat(64),
    acceptanceSqlSha256: '4'.repeat(64), freshBackupBytes: 123, freshBackupSha256: '5'.repeat(64), freshBackupPath: 'backup.dump',
    writerContainersStopped: [], writerContainersRestarted: true,
  })
  writeJson(stages, { freshBackupRestoreVerified: true, freshSchemaFingerprintMatched: true, productionPreflightPassed: true, applyCommitted: true, postMergeAcceptancePassed: true })
  counts(before, false); counts(after, true)
  fs.appendFileSync(after, 'public.unexpected\t1\n', 'utf8')
  const result = spawnSync(process.execPath, [receiptBuilder,
    '--directory', dir, '--metadata', metadata, '--stage-status', stages,
    '--baseline-counts', before, '--post-counts', after,
  ], { cwd: root, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
})

test('v01 production runner requires fresh backup, schema fingerprint, writer pause, and never auto-rolls back', () => {
  assert.match(runnerV01, /run-and-package-test-work-backup-verification-v02\.ps1/u)
  assert.match(runnerV01, /run-and-package-test-work-write-schema-audit-v01\.ps1/u)
  assert.match(runnerV01, /Assert-NoOtherClientSessions/u)
  assert.match(runnerV01, /docker stop -t 30/u)
  assert.match(runnerV01, /BEGIN TRANSACTION READ ONLY;/u)
  assert.match(runnerV01, /applyCommitted = \$true/u)
  assert.match(runnerV01, /postCommitFailure/u)
  assert.match(runnerV01, /rollbackAutomaticallyExecuted = \$false/u)
  assert.match(runnerV01, /ProductionRollbackAuthorized : False/u)
  assert.doesNotMatch(runnerV01, /merge-rollback\.sql\.disabled/u)
  assert.doesNotMatch(runnerV01, /pg_restore[^\n]*-d \$Database/u)
  assert.doesNotMatch(runnerV01, /migration.*(?:up|run)/iu)
})

test('v02 runner is parser-safe, preserves the original script root, fixes collection return, and finalizes receipt after writer restart', () => {
  assert.match(runnerV02, /ValidateSet\('AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01'\)/u)
  assert.match(runnerV02, /\$originalScriptRoot/u)
  assert.match(runnerV02, /return ,\$set/u)
  assert.match(runnerV02, /metadata\.writerContainersRestarted = \$true/u)
  assert.match(runnerV02, /Production apply 最终不可变 receipt/u)
  assert.match(runnerV02, /ParseFile\(\$temporary/u)
  assert.match(runnerV02, /Remove-Item -LiteralPath \$temporary/u)
})

test('review packager records authorization and both runner hashes but cannot connect to or write production', () => {
  assert.match(packager, /ActiveRunner\s+: execute-test-work-production-apply-once-v02\.ps1/u)
  assert.match(packager, /runnerV01Sha256/u)
  assert.match(packager, /runnerV02Sha256/u)
  assert.match(packager, /AuthorizationReceived\s+: True/u)
  assert.match(packager, /RunnerExecuted\s+: False/u)
  assert.match(packager, /ProductionDatabaseConnect\s+: False/u)
  assert.match(packager, /ProductionDatabaseWrite\s+: False/u)
  assert.match(packager, /RollbackAuthorized\s+: False/u)
  assert.doesNotMatch(packager, /^\s*(?:&\s*)?docker\b/imu)
  assert.doesNotMatch(packager, /^\s*(?:&\s*)?psql\b/imu)
})
