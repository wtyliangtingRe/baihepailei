#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function text(value) {
  return String(value ?? '').trim()
}

function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}

function readJson(file) {
  return JSON.parse(readText(file))
}

function writeText(file, value) {
  fs.writeFileSync(file, `${String(value).replace(/\s+$/u, '')}\n`, 'utf8')
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyManifest(directory, name) {
  const manifestPath = path.join(directory, name)
  const manifest = readJson(manifestPath)
  for (const entry of manifest) {
    const file = path.join(directory, entry.file)
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${entry.file}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) throw new Error(`Manifest byte mismatch: ${entry.file}`)
    if (sha256File(file) !== text(entry.sha256).toLowerCase()) throw new Error(`Manifest SHA mismatch: ${entry.file}`)
  }
  return { manifestPath, manifest }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function assertHash(file, expected, label) {
  const actual = sha256File(file)
  if (actual !== text(expected).toLowerCase()) throw new Error(`${label} SHA-256 mismatch`)
  return actual
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of ['transaction-review-dir', 'lab-rehearsal-dir', 'backup-verification-dir', 'output-dir']) {
    if (!text(args[key])) throw new Error(`Required: --${key}`)
  }

  const transactionDir = path.resolve(args['transaction-review-dir'])
  const labDir = path.resolve(args['lab-rehearsal-dir'])
  const backupDir = path.resolve(args['backup-verification-dir'])
  const outputDir = path.resolve(args['output-dir'])
  fs.mkdirSync(outputDir, { recursive: true })

  const transactionManifest = verifyManifest(transactionDir, 'manifest.json')
  const labManifest = verifyManifest(labDir, 'manifest.json')
  const backupManifest = verifyManifest(backupDir, 'evidence-manifest.json')

  const reviewPath = path.join(transactionDir, 'transaction-review.json')
  const applyPath = path.join(transactionDir, 'merge-transaction.sql.disabled')
  const rollbackPath = path.join(transactionDir, 'merge-rollback.sql.disabled')
  const acceptancePath = path.join(transactionDir, 'merge-acceptance-readonly.sql')
  const rollbackAcceptancePath = path.join(transactionDir, 'merge-rollback-acceptance-readonly.sql')
  const review = readJson(reviewPath)

  const labSummary = readJson(path.join(labDir, 'lab-rehearsal-summary.json'))
  const labValidation = readJson(path.join(labDir, 'lab-rehearsal-validation.json'))
  const labBindings = readJson(path.join(labDir, 'source-bindings.json'))
  const backupSummary = readJson(path.join(backupDir, 'backup-verification-summary.json'))
  const backupPath = path.join(backupDir, 'database-backup.dump')

  assertEqual(review.schemaVersion, 1, 'transaction review schemaVersion')
  assertEqual(review.execution?.repositoryExecutionWrapperExists, false, 'repository execution wrapper')
  assertEqual(review.execution?.executed, false, 'transaction executed')
  assertEqual(review.execution?.explicitApprovalReceived, false, 'transaction approval')
  assertEqual(review.safety?.databaseWrite, false, 'transaction database write')
  assertEqual(review.safety?.executableSqlTextGenerated, true, 'transaction SQL generated')
  assertEqual(review.safety?.executableSqlExtensionDisabled, true, 'transaction SQL disabled extension')
  assertEqual(review.safety?.executeWrapperGenerated, false, 'transaction execute wrapper generated')
  assertEqual(review.safety?.mergePerformed, false, 'transaction merge performed')
  assertEqual(review.safety?.rollbackPerformed, false, 'transaction rollback performed')
  assertEqual(review.safety?.hardDeleteWorkPlanned, false, 'hard delete planned')
  assertEqual(review.safety?.versionRewritePlanned, false, 'version rewrite planned')

  const requiredOperationCounts = {
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
  }
  for (const [key, value] of Object.entries(requiredOperationCounts)) {
    assertEqual(review.operationCounts?.[key], value, `operationCounts.${key}`)
  }
  if (JSON.stringify(review.targetWorkIds) !== JSON.stringify([32186, 10097, 32094, 25561])) {
    throw new Error(`Unexpected target Work IDs: ${JSON.stringify(review.targetWorkIds)}`)
  }

  assertEqual(labSummary.schemaVersion, 1, 'lab summary schemaVersion')
  assertEqual(labSummary.labRoundTripVerified, true, 'lab round trip')
  assertEqual(labSummary.readyForProductionExecutionPlanning, true, 'lab readiness')
  assertEqual(labSummary.businessTableCountChecks, 83, 'lab business table checks')
  assertEqual(labSummary.postRollbackMismatches?.length, 0, 'lab rollback mismatches')
  for (const key of [
    'restoreCompleted',
    'baselineAcceptancePassed',
    'applyTransactionPassed',
    'postMergeAcceptancePassed',
    'rollbackTransactionPassed',
    'postRollbackAcceptancePassed',
  ]) assertEqual(labSummary.stages?.[key], true, `lab stage ${key}`)
  for (const [file, count] of Object.entries(labSummary.stderrMeaningfulLines || {})) {
    assertEqual(count, 0, `lab stderr ${file}`)
  }
  assertEqual(labSummary.safety?.sourceProductionContainerInspectOnly, true, 'lab source access')
  assertEqual(labSummary.safety?.productionDatabaseWrite, false, 'lab production database write')
  assertEqual(labSummary.safety?.labDatabaseWrite, true, 'lab database write')
  assertEqual(labSummary.safety?.labNetworkDisabled, true, 'lab network disabled')
  assertEqual(labSummary.safety?.labContainerRemoved, true, 'lab container removed')
  assertEqual(labSummary.safety?.mergePerformedInProduction, false, 'production merge in lab')
  assertEqual(labSummary.safety?.rollbackPerformedInProduction, false, 'production rollback in lab')
  assertEqual(labSummary.safety?.productionExecutionWrapperGenerated, false, 'production wrapper in lab')
  assertEqual(labSummary.safety?.productionExecutionApproved, false, 'production approval in lab')

  const expectedChangedTables = [
    ['public.works_radar_assessment_matched_rules', -5],
    ['public.works_review_reasons', -12],
  ]
  const actualChangedTables = (labSummary.observedPostMergeChangedTables || [])
    .map((row) => [row.table, row.delta])
    .sort((a, b) => a[0].localeCompare(b[0]))
  if (JSON.stringify(actualChangedTables) !== JSON.stringify(expectedChangedTables)) {
    throw new Error(`Unexpected lab table deltas: ${JSON.stringify(actualChangedTables)}`)
  }

  assertEqual(labValidation.confirmationMatched, true, 'lab confirmation')
  assertEqual(labValidation.sourceContainerInspectOnly, true, 'lab validation source access')
  assertEqual(labValidation.labNetworkDisabled, true, 'lab validation network')
  assertEqual(labValidation.labContainerRemoved, true, 'lab validation container removal')
  assertEqual(labValidation.productionDatabaseWrite, false, 'lab validation production write')
  assertEqual(labValidation.productionExecutionWrapperGenerated, false, 'lab validation production wrapper')
  assertEqual(labValidation.productionExecutionApproved, false, 'lab validation production approval')

  const sourceHashes = {
    transactionManifestSha256: sha256File(transactionManifest.manifestPath),
    transactionReviewSha256: sha256File(reviewPath),
    labManifestSha256: sha256File(labManifest.manifestPath),
    backupEvidenceManifestSha256: sha256File(backupManifest.manifestPath),
    applySqlSha256: sha256File(applyPath),
    rollbackSqlSha256: sha256File(rollbackPath),
    acceptanceSqlSha256: sha256File(acceptancePath),
    rollbackAcceptanceSqlSha256: sha256File(rollbackAcceptancePath),
  }
  assertEqual(labSummary.sourceTransactionManifestSha256, sourceHashes.transactionManifestSha256, 'lab transaction manifest binding')
  assertEqual(labSummary.sourceTransactionReviewSha256, sourceHashes.transactionReviewSha256, 'lab transaction review binding')
  assertEqual(labSummary.sourceApplySqlSha256, sourceHashes.applySqlSha256, 'lab apply SQL binding')
  assertEqual(labSummary.sourceRollbackSqlSha256, sourceHashes.rollbackSqlSha256, 'lab rollback SQL binding')
  assertEqual(labSummary.sourceAcceptanceSqlSha256, sourceHashes.acceptanceSqlSha256, 'lab acceptance SQL binding')
  assertEqual(labSummary.sourceRollbackAcceptanceSqlSha256, sourceHashes.rollbackAcceptanceSqlSha256, 'lab rollback acceptance binding')
  assertEqual(labBindings.transactionManifestSha256, sourceHashes.transactionManifestSha256, 'lab bindings transaction manifest')
  assertEqual(labBindings.backupEvidenceManifestSha256, sourceHashes.backupEvidenceManifestSha256, 'lab bindings backup manifest')

  assertEqual(backupSummary.backupRestoreVerified, true, 'backup restore verification')
  assertEqual(backupSummary.businessTableCountChecks, 83, 'backup business table checks')
  assertEqual(backupSummary.productionPreMatchedChecks, 37, 'backup production pre checks')
  assertEqual(backupSummary.productionPostMatchedChecks, 37, 'backup production post checks')
  assertEqual(backupSummary.restoredMatchedChecks, 37, 'backup restored checks')
  assertEqual(backupSummary.safety?.productionDatabaseWrite, false, 'backup production write')
  assertEqual(backupSummary.safety?.productionContainerTempFilesRemoved, true, 'backup production temp cleanup')
  assertEqual(backupSummary.safety?.ephemeralVerificationContainerRemoved, true, 'backup verification container cleanup')

  if (!fs.existsSync(backupPath)) throw new Error(`Local backup missing: ${backupPath}`)
  const backupBytes = fs.statSync(backupPath).size
  const backupSha256 = sha256File(backupPath)
  assertEqual(backupBytes, Number(backupSummary.backupBytes), 'backup byte count')
  assertEqual(backupBytes, Number(review.backup?.bytes), 'review backup byte count')
  assertEqual(backupSha256, text(backupSummary.backupSha256).toLowerCase(), 'backup summary hash')
  assertEqual(backupSha256, text(review.backup?.sha256).toLowerCase(), 'review backup hash')
  assertEqual(backupSha256, text(labSummary.backup?.sha256).toLowerCase(), 'lab backup hash')

  const applyAuthorizationPhrase = 'AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01'
  const rollbackAuthorizationPhrase = 'AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-ROLLBACK-V01'
  const gate = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidenceChainVerified: true,
    readyToRequestProductionApplyAuthorization: true,
    productionApplyAuthorized: false,
    productionRollbackAuthorized: false,
    productionExecutionWrapperGenerated: false,
    productionRollbackWrapperGenerated: false,
    targetWorkIds: review.targetWorkIds,
    operationCounts: review.operationCounts,
    expectedPostMergeTableDeltas: labSummary.expectedPostMergeTableDeltas,
    sourceHashes,
    rehearsalBackup: {
      file: backupPath,
      bytes: backupBytes,
      sha256: backupSha256,
      restoreVerified: true,
      purpose: 'rehearsal and disaster-recovery evidence; not the final fresh execution-window backup',
    },
    authorization: {
      applyPhrase: applyAuthorizationPhrase,
      rollbackPhrase: rollbackAuthorizationPhrase,
      applyPhraseReceived: false,
      rollbackPhraseReceived: false,
      separateApprovalsRequired: true,
      approvalScope: 'The apply phrase authorizes generation and one-time use of a production apply runner only after all fresh execution-window gates pass. It does not authorize rollback or full-dump restore.',
    },
    executionWindowRequirements: {
      maintenanceWindowRequired: true,
      applicationAndImporterWritePauseRequired: true,
      freshBackupRequired: true,
      freshBackupMustBeCreatedInSameMaintenanceWindow: true,
      freshBackupRestoreVerificationRequiredBeforeApply: true,
      freshTargetBaselineAcceptanceRequiredImmediatelyBeforeApply: true,
      freshSchemaFingerprintRequiredImmediatelyBeforeApply: true,
      productionContainerImageMustMatchRehearsedImage: labBindings.postgresImage,
      targetRowsLockedInsideSerializableTransaction: true,
      applyReceiptRequired: true,
      postMergeAcceptanceRequired: true,
      postMergeTableDeltaCheckRequired: true,
    },
    failurePolicy: {
      preCommitGuardFailure: 'The serializable transaction aborts and commits nothing.',
      postCommitAcceptanceFailure: 'Stop, preserve all receipts and logs, and do not run rollback automatically.',
      rollbackPolicy: 'Rollback requires its own exact authorization phrase, the apply receipt, and fresh rollback guards.',
      fullDumpRestorePolicy: 'Never automatic. Use only as separately reviewed disaster recovery.',
    },
    safety: {
      databaseConnection: false,
      productionDatabaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      executableApplySqlCopiedIntoPackage: false,
      executableRollbackSqlCopiedIntoPackage: false,
      productionExecutionWrapperGenerated: false,
      productionRollbackWrapperGenerated: false,
      mergePerformedInProduction: false,
      rollbackPerformedInProduction: false,
      backupFileModified: false,
    },
  }
  writeJson(path.join(outputDir, 'production-execution-gate-review.json'), gate)
  writeJson(path.join(outputDir, 'source-hashes.json'), sourceHashes)
  writeJson(path.join(outputDir, 'production-table-count-policy.json'), {
    schemaVersion: 1,
    businessTableCountChecks: 83,
    expectedPostMergeTableDeltas: labSummary.expectedPostMergeTableDeltas,
    allOtherBusinessTableDeltasMustBeZero: true,
    postRollbackAllBusinessTableDeltasMustBeZero: true,
  })

  fs.copyFileSync(rollbackAcceptancePath, path.join(outputDir, 'production-preflight-readonly.sql'))
  fs.copyFileSync(acceptancePath, path.join(outputDir, 'production-post-merge-acceptance-readonly.sql'))
  fs.copyFileSync(rollbackAcceptancePath, path.join(outputDir, 'production-post-rollback-acceptance-readonly.sql'))

  writeText(path.join(outputDir, 'production-apply-authorization-template.txt'), [
    'This phrase is intentionally NOT granted by this artifact.',
    '',
    applyAuthorizationPhrase,
    '',
    'Scope: generate and use a one-time production apply runner only after a fresh same-window backup, restore verification, baseline acceptance, schema fingerprint, and write pause all pass.',
    'Does not authorize rollback, full-dump restore, migration execution, schema push, Payload publishing, or PR merge.',
  ].join('\n'))
  writeText(path.join(outputDir, 'production-rollback-authorization-template.txt'), [
    'This phrase is intentionally NOT granted by this artifact.',
    '',
    rollbackAuthorizationPhrase,
    '',
    'Scope: prepare or run the exact rollback only after an apply receipt exists and fresh rollback guards pass.',
    'Never implied by apply approval and never run automatically.',
  ].join('\n'))

  writeJson(path.join(outputDir, 'production-apply-receipt-schema.json'), {
    schemaVersion: 1,
    required: [
      'executionId', 'branchHead', 'startedAt', 'completedAt', 'productionContainer', 'productionImage',
      'transactionManifestSha256', 'applySqlSha256', 'acceptanceSqlSha256',
      'freshBackupBytes', 'freshBackupSha256', 'freshBackupRestoreVerified',
      'baselineAcceptancePassed', 'schemaFingerprintMatched', 'applyCommitted',
      'postMergeAcceptancePassed', 'postMergeTableDeltasMatched', 'productionMergeReceiptSha256',
    ],
    applyCommittedMustBeTrueOnlyAfterTransactionExitZero: true,
    rollbackNotImplicit: true,
  })
  writeJson(path.join(outputDir, 'production-rollback-receipt-schema.json'), {
    schemaVersion: 1,
    required: [
      'rollbackId', 'applyReceiptSha256', 'startedAt', 'completedAt', 'rollbackGuardPassed',
      'rollbackCommitted', 'postRollbackAcceptancePassed', 'postRollbackTableDeltasMatched',
      'productionRollbackReceiptSha256',
    ],
    rollbackRequiresSeparateAuthorization: true,
    fullDumpRestoreNotEquivalentToRollback: true,
  })

  const markdown = [
    '# Test Work production execution gate review',
    '',
    '- Evidence chain verified: true',
    '- Isolated apply/rollback round trip verified: true',
    '- Ready to request production apply authorization: true',
    '- Production apply authorized: false',
    '- Production rollback authorized: false',
    '- Production execution wrapper generated: false',
    '- Production database write: false',
    '',
    '## Target operation',
    '',
    `- Work IDs: ${review.targetWorkIds.join(', ')}`,
    `- Work updates: ${review.operationCounts.workUpdates}`,
    `- Factual child reparents: ${review.operationCounts.factualChildReparents}`,
    `- Test assessment child deletes: ${review.operationCounts.testAssessmentChildDeletes}`,
    `- Feedback archives: ${review.operationCounts.feedbackArchives}`,
    `- Version and version-child exact guards: ${review.operationCounts.versionRowsGuardedExactly}`,
    '',
    '## Required before production apply',
    '',
    '1. Enter a short write-pause maintenance window.',
    '2. Create a fresh backup in that same window.',
    '3. Restore and verify the fresh backup in an isolated container.',
    '4. Run fresh baseline acceptance and schema fingerprint checks.',
    '5. Verify the current image and every bound SHA-256.',
    '6. Receive the exact apply authorization separately.',
    '7. Generate a one-time apply runner and receipt only after the above pass.',
    '',
    '## Failure behavior',
    '',
    '- Guard failure before commit: transaction aborts with no write committed.',
    '- Post-commit acceptance failure: stop and preserve evidence; do not auto-rollback.',
    '- Rollback requires a separate authorization and the apply receipt.',
    '- Full database restore is never automatic.',
  ].join('\n')
  writeText(path.join(outputDir, 'production-execution-gate-review.md'), markdown)

  writeJson(path.join(outputDir, 'validation.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    manifestsValidated: true,
    hashesValidated: true,
    labRoundTripValidated: true,
    localBackupValidated: true,
    databaseConnection: false,
    productionDatabaseWrite: false,
    executableApplySqlCopiedIntoPackage: false,
    executableRollbackSqlCopiedIntoPackage: false,
    productionExecutionWrapperGenerated: false,
    productionRollbackWrapperGenerated: false,
    productionApplyAuthorized: false,
    productionRollbackAuthorized: false,
  })

  const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(outputDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outputDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work production execution gate review complete')
  console.log('EvidenceChainVerified: True')
  console.log('ReadyToRequestProductionApplyAuthorization: True')
  console.log('FreshExecutionWindowBackupRequired: True')
  console.log('ProductionApplyAuthorized: False')
  console.log('ProductionRollbackAuthorized: False')
  console.log('ProductionExecutionWrapperGenerated: False')
  console.log('ProductionDatabaseWrite: False')
}

main()
