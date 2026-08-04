import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const lock = JSON.parse(
  fs.readFileSync(
    'config/radar-public-metrics-production-gate-v01.lock.json',
    'utf8',
  ),
)

test('production gate Stage A binds the accepted candidate and remains non-executable', () => {
  assert.equal(
    lock.schemaVersion,
    'radar-public-metrics-production-gate-lock-v01',
  )
  assert.equal(lock.stage, 'candidate_acceptance_lock_only')
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
    lock.postMergePreflight.auditMarkdownSha256,
    '88f84319459f9627f1296a3ba85f0ac51e7c4a71bb3a947a5e258d561454f9e3',
  )
  assert.equal(
    lock.postMergePreflight.auditJsonSha256,
    'b96b2f1561bc7cc5e465ac6a0e06f400f230da1dfb14b2a3857da18530f8d025',
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

  assert.deepEqual(lock.permittedFields, [
    'confidencePercent',
    'evidenceCoveragePercent',
    'metricsPolicyVersion',
    'sourceMetricsPolicyVersion',
    'relationshipEvidenceState',
    'metricsSourceReleaseId',
    'metricsCalculationBasisSha256',
    'requiresMetricReview',
  ])

  assert.equal(lock.source.columns, 44)
  assert.equal(lock.source.migrations, 10)
  assert.equal(lock.source.nonEmptyMetricRows, 0)

  assert.equal(lock.implementation.executableProductionApplyPresent, false)
  assert.equal(lock.implementation.productionImporterPresent, false)
  assert.equal(lock.implementation.productionMarkerPresent, false)
  assert.equal(lock.implementation.disposableGateRehearsalPresent, false)
  assert.equal(lock.implementation.automaticRetryAllowed, false)
  assert.equal(lock.implementation.automaticRollbackAllowed, false)

  assert.equal(lock.authorization.productionAuthorization, false)
  assert.equal(lock.authorization.metricImportAuthorized, false)
  assert.equal(lock.authorization.explicitFutureAuthorizationRequired, true)
})

test('Stage A contains no production execution files', () => {
  for (const file of [
    'scripts/radar/run-radar-public-metrics-production-apply-once-v01.ps1',
    'scripts/radar/run-radar-public-metrics-production-import-v01.mjs',
    'scripts/radar/rehearse-radar-public-metrics-production-gate-v01.ps1',
    'src/app/(payload)/api/radar-public-metrics-production-marker/route.ts',
  ]) {
    assert.equal(fs.existsSync(file), false, `unexpected executable file: ${file}`)
  }
})
