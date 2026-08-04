import assert from 'node:assert/strict'
import test from 'node:test'

import {
  METRIC_FIELDS,
  PRODUCTION_RUNTIME_CONTRACT,
  assertExecutionTarget,
  assertMarker,
  assertRequestPolicy,
  metricPatch,
} from '../scripts/radar/radar-public-metrics-production-contract-v01.mjs'

const desired = {
  confidencePercent: 71,
  evidenceCoveragePercent: 63,
  metricsPolicyVersion: 'radar-public-metrics-policy-v01',
  sourceMetricsPolicyVersion: 'source-policy-v01',
  relationshipEvidenceState: 'partial',
  metricsSourceReleaseId: 'RADAR-PUBLIC-METRICS-10563-0001',
  metricsCalculationBasisSha256:
    'a'.repeat(64),
  requiresMetricReview: false,
}

test('production runtime contract preserves exact eight-field PATCH', () => {
  assert.deepEqual(METRIC_FIELDS, [
    'confidencePercent',
    'evidenceCoveragePercent',
    'metricsPolicyVersion',
    'sourceMetricsPolicyVersion',
    'relationshipEvidenceState',
    'metricsSourceReleaseId',
    'metricsCalculationBasisSha256',
    'requiresMetricReview',
  ])
  assert.deepEqual(metricPatch(desired), desired)
  assert.equal(PRODUCTION_RUNTIME_CONTRACT.exactIdPatchOnly, true)
  assert.equal(PRODUCTION_RUNTIME_CONTRACT.createAllowed, false)
  assert.equal(PRODUCTION_RUNTIME_CONTRACT.putAllowed, false)
  assert.equal(PRODUCTION_RUNTIME_CONTRACT.deleteAllowed, false)
  assert.equal(
    PRODUCTION_RUNTIME_CONTRACT.executableImporterIncluded,
    false,
  )
})

test('HTTP contract allows only reads, login and exact numeric rating PATCH', () => {
  assert.equal(
    assertRequestPolicy({
      url: 'http://127.0.0.1:32001/api/radar-public-ratings',
      method: 'GET',
    }),
    true,
  )
  assert.equal(
    assertRequestPolicy({
      url: 'http://127.0.0.1:32001/api/users/login',
      method: 'POST',
      writeKind: 'login',
    }),
    true,
  )
  assert.equal(
    assertRequestPolicy({
      url: 'http://127.0.0.1:32001/api/radar-public-ratings/42',
      method: 'PATCH',
      writeKind: 'metric_update',
    }),
    true,
  )

  for (const request of [
    {
      url: 'http://127.0.0.1:32001/api/radar-public-ratings',
      method: 'POST',
      writeKind: 'rating_create',
    },
    {
      url: 'http://127.0.0.1:32001/api/radar-public-ratings/42',
      method: 'PUT',
      writeKind: 'metric_update',
    },
    {
      url: 'http://127.0.0.1:32001/api/radar-public-ratings/42',
      method: 'DELETE',
      writeKind: 'metric_update',
    },
    {
      url: 'http://127.0.0.1:32001/api/radar-public-records/42',
      method: 'PATCH',
      writeKind: 'metric_update',
    },
    {
      url: 'http://127.0.0.1:32001/api/radar-public-ratings/work:42',
      method: 'PATCH',
      writeKind: 'metric_update',
    },
  ]) {
    assert.throws(() => assertRequestPolicy(request))
  }
})

test('rehearsal and production database identities cannot be confused', () => {
  assert.equal(
    assertExecutionTarget({
      executionMode: 'rehearsal',
      database:
        'radar_public_metrics_production_gate_rehearsal_20260804',
      productionAuthorization: false,
    }),
    true,
  )

  assert.equal(
    assertExecutionTarget({
      executionMode: 'production',
      database: 'baihepailei',
      productionAuthorization: true,
    }),
    true,
  )

  assert.throws(() =>
    assertExecutionTarget({
      executionMode: 'rehearsal',
      database: 'baihepailei',
      productionAuthorization: false,
    }),
  )
  assert.throws(() =>
    assertExecutionTarget({
      executionMode: 'production',
      database: 'baihepailei',
      productionAuthorization: false,
    }),
  )
  assert.throws(() =>
    assertExecutionTarget({
      executionMode: 'production',
      database:
        'radar_public_metrics_production_gate_rehearsal_20260804',
      productionAuthorization: true,
    }),
  )
})

test('marker binds execution mode, authorization and source identity', () => {
  const base = {
    schemaVersion: 'radar-public-metrics-production-marker-v01',
    productionMode: true,
    executionMode: 'rehearsal',
    productionAuthorization: false,
    phase: 'plan',
    database:
      'radar_public_metrics_production_gate_rehearsal_20260804',
    toolHead: 'b'.repeat(40),
    researchHead: 'c'.repeat(40),
    releaseId: 'RADAR-PUBLIC-METRICS-10563-0001',
    candidateSha256: 'd'.repeat(64),
    sourceContainerId: 'e'.repeat(64),
  }

  assert.equal(assertMarker(base, base), true)
  assert.throws(() =>
    assertMarker(
      { ...base, productionAuthorization: true },
      base,
    ),
  )
  assert.throws(() =>
    assertMarker(
      { ...base, database: 'baihepailei' },
      base,
    ),
  )
})
