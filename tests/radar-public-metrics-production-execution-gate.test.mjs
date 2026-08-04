import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  assertAllowedArguments,
  assertConvergedPlan,
  assertInitialPlan,
  assertModeAuthorization,
  assertRuntimeUrl,
} from '../scripts/radar/run-radar-public-metrics-production-import-v01.mjs'

const initial = {
  summary: {
    schemaReady: true,
    releaseRows: 10563,
    databaseCurrentRows: 10563,
    statusCounts: {
      alreadyCurrent: 0,
      wouldUpdate: 10563,
      missingRating: 0,
      identityMismatch: 0,
      blocked: 0,
    },
  },
}

const converged = {
  summary: {
    schemaReady: true,
    releaseRows: 10563,
    databaseCurrentRows: 10563,
    statusCounts: {
      alreadyCurrent: 10563,
      wouldUpdate: 0,
      missingRating: 0,
      identityMismatch: 0,
      blocked: 0,
    },
  },
}

test('production importer accepts only the closed argument surface', () => {
  assert.equal(
    assertAllowedArguments({
      'release-dir': 'x',
      url: 'http://127.0.0.1:32001',
      'out-dir': 'x',
      mode: 'plan',
      'execution-mode': 'rehearsal',
      'expected-tool-head': 'a'.repeat(40),
      'expected-research-head': 'b'.repeat(40),
      'expected-database':
        'radar_public_metrics_production_gate_rehearsal_x',
      'expected-candidate-sha256': 'c'.repeat(64),
      'expected-phase': 'plan',
      'expected-source-container-id': 'd'.repeat(64),
      confirm:
        'RUN-RADAR-PUBLIC-METRICS-PRODUCTION-IMPORT-V01',
    }),
    true,
  )
  assert.throws(() =>
    assertAllowedArguments({
      'allow-create': 'true',
    }),
  )
})

test('runtime URL remains loopback-only', () => {
  assert.equal(
    assertRuntimeUrl('http://127.0.0.1:32001'),
    'http://127.0.0.1:32001',
  )
  assert.throws(() => assertRuntimeUrl('https://127.0.0.1:32001'))
  assert.throws(() => assertRuntimeUrl('http://example.com:32001'))
  assert.throws(() => assertRuntimeUrl('http://127.0.0.1:3000'))
})

test('execution mode and production authorization cannot be confused', () => {
  assert.equal(
    assertModeAuthorization({
      executionMode: 'rehearsal',
      productionAuthorization: false,
      mode: 'apply',
    }),
    true,
  )
  assert.equal(
    assertModeAuthorization({
      executionMode: 'production',
      productionAuthorization: true,
      mode: 'apply',
    }),
    true,
  )
  assert.throws(() =>
    assertModeAuthorization({
      executionMode: 'rehearsal',
      productionAuthorization: true,
      mode: 'apply',
    }),
  )
  assert.throws(() =>
    assertModeAuthorization({
      executionMode: 'production',
      productionAuthorization: false,
      mode: 'apply',
    }),
  )
})

test('plan and verification remain exact closed-world states', () => {
  assert.equal(assertInitialPlan(initial), initial)
  assert.equal(assertConvergedPlan(converged), converged)
  assert.throws(() =>
    assertInitialPlan({
      ...initial,
      summary: {
        ...initial.summary,
        statusCounts: {
          ...initial.summary.statusCounts,
          blocked: 1,
        },
      },
    }),
  )
})

test('PowerShell gate contains backup, lock, durable marker and failure closure', () => {
  const runner = fs.readFileSync(
    'scripts/radar/run-radar-public-metrics-production-apply-once-v01.ps1',
    'utf8',
  )
  const rehearsal = fs.readFileSync(
    'scripts/radar/rehearse-radar-public-metrics-production-gate-v01.ps1',
    'utf8',
  )

  for (const required of [
    'freshBackupSha256',
    'pg_advisory_lock',
    'durable apply-control marker',
    'automaticRetryAllowed = $false',
    'automaticRollbackAllowed = $false',
    'operatorMustInspectBeforeAnyFurtherAction',
    'Stop-RadarIncrementalWriters',
    'Restart-RadarIncrementalWriters',
    'APPLY-RADAR-PUBLIC-METRICS-10563-ONCE-I-ACCEPT-PRODUCTION-WRITE',
  ]) {
    assert.match(runner, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  for (const required of [
    'pg_dump',
    'pg_restore',
    'production-gate-rehearsal-authorization-v01',
    'sourceDatabaseUnchanged = $true',
    'productionAuthorization = $false',
    'Compress-Archive',
  ]) {
    assert.match(
      rehearsal,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
  }
})

test('production importer is update-only and exact-ID only', () => {
  const importer = fs.readFileSync(
    'scripts/radar/run-radar-public-metrics-production-import-v01.mjs',
    'utf8',
  )

  assert.match(
    importer,
    /\/api\/radar-public-ratings\/\$\{row\.databaseId\}/u,
  )
  assert.match(importer, /method: 'PATCH'/u)
  assert.match(importer, /writeKind: 'metric_update'/u)
  assert.match(importer, /postCreate: 0/u)
  assert.match(importer, /put: 0/u)
  assert.match(importer, /delete: 0/u)
  assert.doesNotMatch(importer, /method: 'PUT'/u)
  assert.doesNotMatch(importer, /method: 'DELETE'/u)
  assert.doesNotMatch(importer, /writeKind: 'rating_create'/u)
})
