import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const builder = path.join(repoRoot, 'scripts/radar/build-test-work-production-execution-gate-review-v01.mjs')
const wrapperPath = path.join(repoRoot, 'scripts/radar/run-and-package-test-work-production-execution-gate-review-v01.ps1')
const wrapper = fs.readFileSync(wrapperPath, 'utf8')

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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

function buildFixture(root) {
  const transaction = path.join(root, 'transaction')
  const lab = path.join(root, 'lab')
  const backup = path.join(root, 'backup')
  const output = path.join(root, 'output')
  fs.mkdirSync(transaction)
  fs.mkdirSync(lab)
  fs.mkdirSync(backup)

  const backupBytes = 4096
  const backupPath = path.join(backup, 'database-backup.dump')
  fs.writeFileSync(backupPath, Buffer.alloc(backupBytes, 7))
  const backupHash = sha256(backupPath)

  const sqlFiles = {
    'merge-transaction.sql.disabled': `\\set ON_ERROR_STOP on\n-- Verified backup SHA-256: ${backupHash}\nBEGIN ISOLATION LEVEL SERIALIZABLE;\nSELECT 1 FOR UPDATE;\nCOMMIT;\n`,
    'merge-rollback.sql.disabled': `\\set ON_ERROR_STOP on\n-- Verified backup SHA-256: ${backupHash}\nBEGIN ISOLATION LEVEL SERIALIZABLE;\nSELECT 1 FOR UPDATE;\nCOMMIT;\n`,
    'merge-acceptance-readonly.sql': `\\set ON_ERROR_STOP on\n-- Verified backup SHA-256: ${backupHash}\nBEGIN TRANSACTION READ ONLY;\nSELECT true;\nROLLBACK;\n`,
    'merge-rollback-acceptance-readonly.sql': `\\set ON_ERROR_STOP on\n-- Verified backup SHA-256: ${backupHash}\nBEGIN TRANSACTION READ ONLY;\nSELECT true;\nROLLBACK;\n`,
  }
  for (const [name, content] of Object.entries(sqlFiles)) fs.writeFileSync(path.join(transaction, name), content, 'utf8')
  writeJson(path.join(transaction, 'transaction-review.json'), {
    schemaVersion: 1,
    targetWorkIds: [32186, 10097, 32094, 25561],
    backup: { bytes: backupBytes, sha256: backupHash, restoreVerified: true },
    operationCounts: {
      workUpdates: 4,
      factualChildReparents: 3,
      testAssessmentChildDeletes: 17,
      feedbackArchives: 3,
      semanticDuplicateSkips: 1,
      preservedRelationRows: 17,
      versionRowsGuardedExactly: 1118,
      versionGroupsPreserved: 2,
      standardizationRefinements: 2,
      exactBeforeRows: 1146,
      exactBeforeRelationCounts: 19,
      exactBeforeVersionCounts: 11,
    },
    execution: { repositoryExecutionWrapperExists: false, executed: false, explicitApprovalReceived: false },
    safety: {
      databaseWrite: false,
      executableSqlTextGenerated: true,
      executableSqlExtensionDisabled: true,
      executeWrapperGenerated: false,
      mergePerformed: false,
      rollbackPerformed: false,
      hardDeleteWorkPlanned: false,
      versionRewritePlanned: false,
    },
  })
  manifest(transaction, 'manifest.json', [...Object.keys(sqlFiles), 'transaction-review.json'])

  writeJson(path.join(backup, 'backup-verification-summary.json'), {
    backupRestoreVerified: true,
    businessTableCountChecks: 83,
    backupBytes,
    backupSha256: backupHash,
    productionPreMatchedChecks: 37,
    productionPostMatchedChecks: 37,
    restoredMatchedChecks: 37,
    safety: {
      productionDatabaseWrite: false,
      productionContainerTempFilesRemoved: true,
      ephemeralVerificationContainerRemoved: true,
    },
  })
  manifest(backup, 'evidence-manifest.json', ['backup-verification-summary.json'])

  const transactionManifestHash = sha256(path.join(transaction, 'manifest.json'))
  const transactionReviewHash = sha256(path.join(transaction, 'transaction-review.json'))
  const backupManifestHash = sha256(path.join(backup, 'evidence-manifest.json'))
  const applyHash = sha256(path.join(transaction, 'merge-transaction.sql.disabled'))
  const rollbackHash = sha256(path.join(transaction, 'merge-rollback.sql.disabled'))
  const acceptanceHash = sha256(path.join(transaction, 'merge-acceptance-readonly.sql'))
  const rollbackAcceptanceHash = sha256(path.join(transaction, 'merge-rollback-acceptance-readonly.sql'))

  writeJson(path.join(lab, 'source-bindings.json'), {
    transactionManifestSha256: transactionManifestHash,
    backupEvidenceManifestSha256: backupManifestHash,
    postgresImage: 'postgres:17-alpine',
  })
  writeJson(path.join(lab, 'lab-rehearsal-validation.json'), {
    confirmationMatched: true,
    sourceContainerInspectOnly: true,
    labNetworkDisabled: true,
    labContainerRemoved: true,
    productionDatabaseWrite: false,
    productionExecutionWrapperGenerated: false,
    productionExecutionApproved: false,
  })
  writeJson(path.join(lab, 'lab-rehearsal-summary.json'), {
    schemaVersion: 1,
    sourceTransactionManifestSha256: transactionManifestHash,
    sourceTransactionReviewSha256: transactionReviewHash,
    sourceApplySqlSha256: applyHash,
    sourceRollbackSqlSha256: rollbackHash,
    sourceAcceptanceSqlSha256: acceptanceHash,
    sourceRollbackAcceptanceSqlSha256: rollbackAcceptanceHash,
    backup: { bytes: backupBytes, sha256: backupHash, restoreVerified: true },
    businessTableCountChecks: 83,
    expectedPostMergeTableDeltas: {
      'public.works_review_reasons': -12,
      'public.works_radar_assessment_matched_rules': -5,
    },
    observedPostMergeChangedTables: [
      { table: 'public.works_radar_assessment_matched_rules', delta: -5 },
      { table: 'public.works_review_reasons', delta: -12 },
    ],
    postRollbackMismatches: [],
    stages: {
      restoreCompleted: true,
      baselineAcceptancePassed: true,
      applyTransactionPassed: true,
      postMergeAcceptancePassed: true,
      rollbackTransactionPassed: true,
      postRollbackAcceptancePassed: true,
    },
    stderrMeaningfulLines: { a: 0, b: 0 },
    labRoundTripVerified: true,
    readyForProductionExecutionPlanning: true,
    safety: {
      sourceProductionContainerInspectOnly: true,
      productionDatabaseWrite: false,
      labDatabaseWrite: true,
      labNetworkDisabled: true,
      labContainerRemoved: true,
      mergePerformedInProduction: false,
      rollbackPerformedInProduction: false,
      productionExecutionWrapperGenerated: false,
      productionExecutionApproved: false,
    },
  })
  manifest(lab, 'manifest.json', ['source-bindings.json', 'lab-rehearsal-validation.json', 'lab-rehearsal-summary.json'])

  return { transaction, lab, backup, output }
}

test('gate builder binds the complete rehearsal chain while withholding production authorization and executable SQL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-gate-'))
  const fixture = buildFixture(root)
  const result = spawnSync(process.execPath, [
    builder,
    '--transaction-review-dir', fixture.transaction,
    '--lab-rehearsal-dir', fixture.lab,
    '--backup-verification-dir', fixture.backup,
    '--output-dir', fixture.output,
  ], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)

  const gate = JSON.parse(fs.readFileSync(path.join(fixture.output, 'production-execution-gate-review.json'), 'utf8'))
  assert.equal(gate.evidenceChainVerified, true)
  assert.equal(gate.readyToRequestProductionApplyAuthorization, true)
  assert.equal(gate.productionApplyAuthorized, false)
  assert.equal(gate.productionRollbackAuthorized, false)
  assert.equal(gate.executionWindowRequirements.freshBackupRequired, true)
  assert.equal(gate.executionWindowRequirements.freshBackupRestoreVerificationRequiredBeforeApply, true)
  assert.equal(gate.safety.executableApplySqlCopiedIntoPackage, false)
  assert.equal(gate.safety.productionExecutionWrapperGenerated, false)
  assert.ok(!fs.existsSync(path.join(fixture.output, 'merge-transaction.sql.disabled')))
  assert.ok(fs.existsSync(path.join(fixture.output, 'production-preflight-readonly.sql')))
})

test('gate builder fails closed if the lab evidence claims production execution approval', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-gate-fail-'))
  const fixture = buildFixture(root)
  const validationPath = path.join(fixture.lab, 'lab-rehearsal-validation.json')
  const validation = JSON.parse(fs.readFileSync(validationPath, 'utf8'))
  validation.productionExecutionApproved = true
  writeJson(validationPath, validation)
  manifest(fixture.lab, 'manifest.json', ['source-bindings.json', 'lab-rehearsal-validation.json', 'lab-rehearsal-summary.json'])

  const result = spawnSync(process.execPath, [
    builder,
    '--transaction-review-dir', fixture.transaction,
    '--lab-rehearsal-dir', fixture.lab,
    '--backup-verification-dir', fixture.backup,
    '--output-dir', fixture.output,
  ], { cwd: repoRoot, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /lab validation production approval/u)
})

test('PowerShell packager contains no production database execution path', () => {
  assert.match(wrapper, /ProductionExecuteWrapper\s+: Not generated/u)
  assert.match(wrapper, /ProductionApplyAuthorized\s+: False/u)
  assert.match(wrapper, /FreshWindowBackupRequired\s+: True/u)
  assert.match(wrapper, /forbiddenExtensions/u)
  assert.doesNotMatch(wrapper, /^\s*(?:&\s*)?docker\b/imu)
  assert.doesNotMatch(wrapper, /^\s*(?:&\s*)?psql\b/imu)
  assert.doesNotMatch(wrapper, /pg_dump/u)
  assert.doesNotMatch(wrapper, /Invoke-Sqlcmd/u)
  assert.doesNotMatch(wrapper, /\$env:DATABASE_URL/u)
})
