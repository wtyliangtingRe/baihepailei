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
    'production_gate_disposable_rehearsal_ready',
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
      '81723aea3975a4edadd7e0ce923dc671ebe95718291c7e987564790e07474d12',
    'scripts/radar/run-radar-public-metrics-production-apply-once-v01.ps1':
      '4935b7779eb632c7f64bd726385601e1e27cd9df2c85e1daf8a028d1bc937a94',
    'scripts/radar/rehearse-radar-public-metrics-production-gate-v01.ps1':
      '19e4e6a2effc315fc118cc735273fcd730e849dcd4286abf353eb710692c8b7e',
    'tests/radar-public-metrics-production-execution-gate.test.mjs':
      'e04a18657e95a524a0da85a4ecef4722318759f5595117419931561d18b20d3e',
  }

  assert.deepEqual(lock.implementation.criticalCodeFiles, expected)

  for (const [file, sha] of Object.entries(expected)) {
    assert.equal(fs.existsSync(file), true, `missing ${file}`)
    assert.match(sha, /^[a-f0-9]{64}$/u)
  }
})
