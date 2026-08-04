import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const lock = JSON.parse(
  fs.readFileSync(
    'config/radar-public-metrics-production-gate-v01.lock.json',
    'utf8',
  ),
)

test('production gate binds accepted evidence and is ready only for disposable rehearsal', () => {
  assert.equal(
    lock.schemaVersion,
    'radar-public-metrics-production-gate-lock-v01',
  )
  assert.equal(
    lock.stage,
    'production_gate_final_review_accepted_ready_to_mark',
  )
  assert.equal(
    lock.baseMain,
    'cba94510c6ed460f821d82179e24d9a61ee28f5c',
  )
  assert.equal(
    lock.postMergePreflight.candidateSha256,
    'cc8757e41be8ef51e8331e9e19d59d9fadb2ad8e2ca1eba9e2a8357f7bdea6b7',
  )
  assert.equal(
    lock.postMergePreflight.reviewZipSha256,
    'd044479131e8ce77f01901ea092970a2a72c69deecc3382cfbc625fca1c69d83',
  )
  assert.equal(
    lock.disposableRehearsal.evidenceSha256,
    '1474267b2d53ecf08209afb0eb2bf6f8d01c2fbdba9a1f5845b23f3f86b67b0f',
  )

  assert.deepEqual(lock.expectedTransition, {
    initialWouldUpdate: 10563,
    finalAlreadyCurrent: 10563,
    missingRating: 0,
    identityMismatch: 0,
    blocked: 0,
    metricPatch: 10563,
    postCreate: 0,
    put: 0,
    delete: 0,
  })

  assert.equal(lock.implementation.productionMarkerPresent, true)
  assert.equal(
    lock.implementation.productionRuntimeContractPresent,
    true,
  )
  assert.equal(lock.implementation.productionImporterPresent, true)
  assert.equal(
    lock.implementation.executableProductionApplyPresent,
    true,
  )
  assert.equal(
    lock.implementation.disposableGateRehearsalPresent,
    true,
  )
  assert.equal(lock.implementation.freshBackupRequired, true)
  assert.equal(lock.implementation.advisoryLockRequired, true)
  assert.equal(lock.implementation.durableApplyControlRequired, true)
  assert.equal(lock.implementation.writerIsolationRequired, true)
  assert.equal(lock.implementation.automaticRetryAllowed, false)
  assert.equal(lock.implementation.automaticRollbackAllowed, false)

  assert.equal(lock.authorization.productionAuthorization, false)
  assert.equal(lock.authorization.metricImportAuthorized, false)
  assert.equal(
    lock.authorization.explicitFutureAuthorizationRequired,
    true,
  )
  assert.equal(
    lock.authorization.postMergeAuthorizationArtifactRequired,
    true,
  )
})

test('critical production-gate code is hash-bound', () => {
  const expected = {
    'scripts/radar/run-radar-public-metrics-production-import-v01.mjs':
      '3abce88f24523f795d933f4faeafb897783a0f49febadc2ea4d5c51e923721a4',
    'scripts/radar/run-radar-public-metrics-production-apply-once-v01.ps1':
      '9ee7f1741722416e94cd3aaad2a797364a63b2bc891e4e47953e7e8cfb7560f2',
    'scripts/radar/rehearse-radar-public-metrics-production-gate-v01.ps1':
      '8aaf002caacc06bbdfb02c31d99ad3d6f35a6a042746524f0266a49b4d286d47',
    'tests/radar-public-metrics-production-execution-gate.test.mjs':
      '3ee4d376db23ab10692a3979e5e060bdbbd4f79a16602e494c7b86cdfbc6562f',
  }

  assert.deepEqual(lock.implementation.criticalCodeFiles, expected)

  for (const [file, sha] of Object.entries(expected)) {
    assert.equal(fs.existsSync(file), true, `missing ${file}`)
    assert.match(sha, /^[a-f0-9]{64}$/u)
  }
})

test('prior rehearsal is retained as remediation evidence only', () => {
  assert.equal(
    lock.priorProductionGateRehearsal.evidenceSha256,
    '6c6164a2d4275a5ea63ab075fdf99eba41a51a83540d4318df1a857fda23f6f6',
  )
  assert.equal(
    lock.priorProductionGateRehearsal.finalEvidenceAccepted,
    false,
  )
  assert.equal(
    lock.priorProductionGateRehearsal.sourceDatabaseUnchanged,
    true,
  )
  assert.deepEqual(
    lock.priorProductionGateRehearsal.blockingFindings,
    [
      'F1_target_source_write_semantics',
      'F2_postgresql_identifier_truncation',
      'F3_apply_control_marker_missing',
    ],
  )
  assert.equal(lock.implementation.exactCurrentDatabaseRequired, true)
  assert.equal(
    lock.implementation.targetSourceWriteDistinctionRequired,
    true,
  )
  assert.equal(lock.implementation.applyControlEvidenceRequired, true)
  assert.equal(
    lock.implementation.databaseIdentifierMaximumUtf8Bytes,
    63,
  )
  assert.equal(
    lock.implementation.finalDisposableRehearsalRequired,
    true,
  )
  assert.equal(lock.authorization.productionAuthorization, false)
  assert.equal(lock.authorization.metricImportAuthorized, false)
})
test('final repaired rehearsal evidence is independently accepted', () => {
  const final = lock.finalProductionGateRehearsal

  assert.equal(
    lock.stage,
    'production_gate_final_review_accepted_ready_to_mark',
  )
  assert.equal(
    final.evidenceSha256,
    '187021c234751ef9ea3cd69bc9830e914b926ab6c68378bdf874ee77c23d5140',
  )
  assert.equal(final.evidenceBytes, 2000446)
  assert.equal(final.archiveEntries, 37)
  assert.equal(final.checksumEntries, 36)
  assert.equal(final.internalChecksumsValid, 36)
  assert.equal(
    final.toolHead,
    '1ce8f3df61063105ebbc66df0eb9f879d56d87ea',
  )
  assert.equal(
    final.candidateSha256,
    'cc8757e41be8ef51e8331e9e19d59d9fadb2ad8e2ca1eba9e2a8357f7bdea6b7',
  )
  assert.equal(
    final.applyControlSha256,
    '7fd67a1c9367c9625512e366077c27d55918727ba266599881f762edd7e64ab6',
  )
  assert.equal(final.applyControlState, 'completed')
  assert.equal(final.planPassed, true)
  assert.equal(final.applyStarted, true)
  assert.equal(final.applyPassed, true)
  assert.equal(final.verifyPassed, true)
  assert.equal(final.patchRequests, 10563)
  assert.equal(final.postAlreadyCurrent, 10563)
  assert.equal(final.postCreateRequests, 0)
  assert.equal(final.putRequests, 0)
  assert.equal(final.deleteRequests, 0)
  assert.equal(final.targetDatabaseWrite, true)
  assert.equal(final.sourceDatabaseWrite, false)
  assert.equal(final.sourceDatabaseUnchanged, true)
  assert.equal(final.productionAuthorization, false)
  assert.equal(final.finalEvidenceAccepted, false)
  assert.equal(final.behaviorEvidenceAccepted, true)
  assert.equal(final.exactCurrentCodeAccepted, false)
  assert.equal(final.supersededByFinalReviewRemediation, true)
  assert.equal(
    final.independentAuditMarkdownSha256,
    '4aaeead0ae65da6c475e91d72125602d6315cff3b7d698aa760fa3068c7cd9c4',
  )
  assert.equal(
    final.independentAuditJsonSha256,
    '6f7cea1cfc32317ca6aaa23bdc78cc902badb995a45f2a97ab0107716910a216',
  )
  assert.equal(
    final.decision,
    'accept_final_disposable_public_metrics_production_gate_rehearsal_evidence_v01',
  )
  assert.equal(lock.implementation.finalDisposableRehearsalAccepted, true)
  assert.equal(lock.authorization.productionAuthorization, false)
  assert.equal(lock.authorization.metricImportAuthorized, false)
})

test('final code review remediation is closed and requires replacement rehearsal', () => {
  assert.equal(
    lock.stage,
    'production_gate_final_review_accepted_ready_to_mark',
  )
  assert.equal(lock.implementation.freshBackupFreshnessRequired, true)
  assert.equal(lock.implementation.freshBackupSourceBindingRequired, true)
  assert.equal(lock.implementation.authorizationFutureSkewRejected, true)
  assert.equal(
    lock.implementation.immediateProductionPatchConfirmationRequired,
    true,
  )
  assert.equal(
    lock.implementation.writerRestartFailureInspectionRequired,
    true,
  )
  assert.equal(lock.implementation.finalReviewRemediationRequired, true)
  assert.equal(
    lock.implementation.finalReviewRemediationRehearsalRequired,
    true,
  )
  assert.deepEqual(lock.finalCodeReview.blockingFindings, [
    'F1_fresh_backup_freshness_and_source_binding',
    'F2_future_dated_authorization',
    'F3_immediate_operator_confirmation',
    'F4_writer_restart_inspection_flag',
  ])
  assert.equal(lock.finalCodeReview.remediationImplemented, true)
  assert.equal(
    lock.finalCodeReview.replacementDisposableRehearsalRequired,
    false,
  )
  assert.equal(lock.finalCodeReview.markReadyAuthorized, true)
  assert.equal(lock.finalCodeReview.mergeAuthorized, false)
  assert.equal(lock.finalCodeReview.productionWriteAuthorized, false)
  assert.equal(lock.authorization.productionAuthorization, false)
  assert.equal(lock.authorization.metricImportAuthorized, false)
})
test('failed replacement rehearsal is closed before plan and schema-remediated', () => {
  const failed = lock.replacementRehearsalFailedAttempt

  assert.equal(
    lock.stage,
    'production_gate_final_review_accepted_ready_to_mark',
  )
  assert.equal(failed.attemptedHead, 'ea99394ae6f0d3f96fdfde61445946f3b4e5ed14')
  assert.equal(
    failed.freshBackupSha256,
    '9d934be1a619e086a5ddc1144e173995e839718344a5d0095fb464474ed45516',
  )
  assert.equal(
    failed.rehearsalAuthorizationSha256,
    'a4bb66c7fb343afaa4ba4cae97c40b22ac1877ba0e0bcc6a97530c221aaa3b69',
  )
  assert.equal(failed.databaseIdentityAndInitialStatePassed, true)
  assert.equal(failed.planStarted, false)
  assert.equal(failed.applyStarted, false)
  assert.equal(failed.metricPatch, 0)
  assert.equal(failed.sourceDatabaseWrite, false)
  assert.equal(failed.productionAuthorization, false)
  assert.equal(failed.accepted, false)
  assert.equal(failed.automaticRetryAllowed, false)
  assert.equal(
    lock.implementation.rehearsalAuthorizationFreshBackupBindingRequired,
    true,
  )
  assert.equal(
    lock.implementation.replacementRehearsalSchemaRemediationRequired,
    true,
  )
  assert.equal(lock.authorization.productionAuthorization, false)
  assert.equal(lock.authorization.metricImportAuthorized, false)
})
test('replacement rehearsal evidence is independently accepted for current code', () => {
  const replacement = lock.replacementProductionGateRehearsal

  assert.equal(
    lock.stage,
    'production_gate_final_review_accepted_ready_to_mark',
  )
  assert.equal(
    replacement.evidenceSha256,
    '224658a4797c795f6b2603bbac865a87e77b223d8434de2225628909e0d94555',
  )
  assert.equal(replacement.evidenceBytes, 1987405)
  assert.equal(replacement.archiveEntries, 37)
  assert.equal(replacement.checksumEntries, 36)
  assert.equal(replacement.internalChecksumsValid, 36)
  assert.equal(
    replacement.toolHead,
    '67b8faa2b975c9528ce70a333c4a74f771c019ec',
  )
  assert.equal(
    replacement.authorizationSha256,
    'a6357062d62659a3f901a87f524b9aaabba7297e371132895b73c9139aa7abb6',
  )
  assert.equal(
    replacement.freshBackupSha256,
    'f6eec13aa55e1f59ca17413b9f380808d00a2159d3e441f19197e36d7adc890f',
  )
  assert.equal(
    replacement.applyControlSha256,
    '7791df8dfaae2815be90cf6f3e6e082ef5d0b5469160aa1f05b09e20c5a902dc',
  )
  assert.equal(replacement.applyControlState, 'completed')
  assert.equal(replacement.applyControlFreshBackupCreatedAt, null)
  assert.equal(
    replacement.rehearsalNullBackupControlTimestampAccepted,
    true,
  )
  assert.equal(replacement.planPassed, true)
  assert.equal(replacement.applyStarted, true)
  assert.equal(replacement.applyPassed, true)
  assert.equal(replacement.verifyPassed, true)
  assert.equal(replacement.patchRequests, 10563)
  assert.equal(replacement.uniqueNumericPatchIds, 10563)
  assert.equal(replacement.postAlreadyCurrent, 10563)
  assert.equal(replacement.postCreateRequests, 0)
  assert.equal(replacement.putRequests, 0)
  assert.equal(replacement.deleteRequests, 0)
  assert.equal(replacement.allHttpResponses200, true)
  assert.equal(replacement.targetDatabaseWrite, true)
  assert.equal(replacement.sourceDatabaseWrite, false)
  assert.equal(replacement.sourceDatabaseUnchanged, true)
  assert.equal(replacement.productionAuthorization, false)
  assert.equal(replacement.independentAuditChecks, 121)
  assert.equal(replacement.independentAuditPassed, 121)
  assert.equal(replacement.independentAuditFailed, 0)
  assert.equal(
    replacement.independentAuditMarkdownSha256,
    'ba5e1b30f06c0b0b327e8b03722831934f8d36b6e2b515be83d83e2dd9be6dca',
  )
  assert.equal(
    replacement.independentAuditJsonSha256,
    'b1e0bcb99e4dc55d446ee92d34211b31f47ebf2ca6c32f2ab69048d37887fbfc',
  )
  assert.equal(replacement.finalEvidenceAccepted, true)
  assert.equal(replacement.markReadyAuthorized, false)
  assert.equal(replacement.mergeAuthorized, false)
  assert.equal(replacement.productionWriteAuthorized, false)
  assert.equal(lock.implementation.finalDisposableRehearsalAccepted, true)
  assert.equal(lock.implementation.replacementDisposableRehearsalAccepted, true)
  assert.equal(
    lock.implementation.replacementEvidenceIndependentAuditAccepted,
    true,
  )
  assert.equal(lock.finalCodeReview.replacementDisposableRehearsalRequired, false)
  assert.equal(lock.finalCodeReview.replacementDisposableRehearsalAccepted, true)
  assert.equal(lock.finalCodeReview.replacementIndependentAuditAccepted, true)
  assert.equal(lock.finalCodeReview.markReadyAuthorized, true)
  assert.equal(lock.finalCodeReview.mergeAuthorized, false)
  assert.equal(lock.finalCodeReview.productionWriteAuthorized, false)
  assert.equal(lock.authorization.productionAuthorization, false)
  assert.equal(lock.authorization.metricImportAuthorized, false)
})
test('final PR review authorizes only marking Ready', () => {
  const finalReview = lock.finalPrReview

  assert.equal(
    lock.stage,
    'production_gate_final_review_accepted_ready_to_mark',
  )
  assert.equal(lock.implementation.finalPrReviewAccepted, true)
  assert.equal(
    finalReview.reviewedHead,
    '2a3167deb52542d50f3b1706c4721fd5cdfb32bc',
  )
  assert.equal(
    finalReview.baseMain,
    'cba94510c6ed460f821d82179e24d9a61ee28f5c',
  )
  assert.equal(finalReview.ciRunId, 30890582574)
  assert.equal(finalReview.ciRunNumber, 9)
  assert.equal(finalReview.ciConclusion, 'success')
  assert.equal(finalReview.changedFiles, 11)
  assert.equal(finalReview.commits, 9)
  assert.equal(finalReview.comments, 0)
  assert.equal(finalReview.reviewSubmissions, 0)
  assert.equal(finalReview.reviewThreads, 0)
  assert.equal(finalReview.requestedReviewers, 0)
  assert.equal(finalReview.latestBindingCommitFiles, 4)
  assert.equal(finalReview.latestBindingCommitTouchedProductionCode, false)
  assert.equal(
    finalReview.evidenceSha256,
    '224658a4797c795f6b2603bbac865a87e77b223d8434de2225628909e0d94555',
  )
  assert.equal(finalReview.independentAuditPassed, 121)
  assert.equal(finalReview.independentAuditFailed, 0)
  assert.equal(
    finalReview.reviewMarkdownSha256,
    '8b2345fd11e4d7cca8b0d1fa784220be85078fb7ff5f157c889b4a514e9d336d',
  )
  assert.equal(
    finalReview.reviewJsonSha256,
    'effa425bf81e300d790182288c7a12fea1d6739f8f3093f7cef6e33083c839a0',
  )
  assert.deepEqual(finalReview.blockingFindings, [])
  assert.equal(finalReview.accepted, true)
  assert.equal(finalReview.markReadyAuthorized, true)
  assert.equal(finalReview.mergeAuthorized, false)
  assert.equal(finalReview.productionWriteAuthorized, false)
  assert.equal(lock.finalCodeReview.accepted, true)
  assert.equal(
    lock.finalCodeReview.reviewedHead,
    '2a3167deb52542d50f3b1706c4721fd5cdfb32bc',
  )
  assert.equal(lock.finalCodeReview.blockingFindingsResolved, true)
  assert.equal(lock.finalCodeReview.markReadyAuthorized, true)
  assert.equal(lock.finalCodeReview.mergeAuthorized, false)
  assert.equal(lock.finalCodeReview.productionWriteAuthorized, false)
  assert.equal(lock.authorization.productionAuthorization, false)
  assert.equal(lock.authorization.metricImportAuthorized, false)
})
