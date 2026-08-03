import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  buildPlan,
} from '../scripts/radar/plan-radar-public-metrics-overlay-v01.mjs'

const metricColumns = [
  'publication_key',
  'identity_key',
  'record_status',
  'confidence_percent',
  'evidence_coverage_percent',
  'metrics_policy_version',
  'source_metrics_policy_version',
  'relationship_evidence_state',
  'metrics_source_release_id',
  'metrics_calculation_basis_sha256',
  'requires_metric_review',
]

const manifest = {
  releaseId: 'RADAR-PUBLIC-METRICS-10563-0001',
  policy: {
    policyId: 'radar-public-metrics-policy-v01',
    status: 'frozen',
  },
  gates: {
    canonicalRatingReleaseRewrite: false,
    websiteWrite: false,
    payloadWrite: false,
    postgresqlWrite: false,
    productionAuthorization: false,
  },
}

function metric(number, overrides = {}) {
  return {
    releaseId: 'RADAR-PUBLIC-METRICS-10563-0001',
    recordStatus: 'current',
    workId: String(number),
    siteId: `SITE-${number}`,
    publicationKey: `work:${number}`,
    identityKey: `${number}|SITE-${number}`,
    titleSnapshot: `Work ${number}`,
    confidencePercent: 40 + number,
    evidenceCoveragePercent: 30 + number,
    metricsPolicyVersion: 'radar-public-metrics-policy-v01',
    sourceMetricsPolicyVersion: 'source-policy-v01',
    relationshipEvidenceState: 'partial',
    sourceCalculationBasisSha256: `${number}`.padStart(64, '0'),
    requiresMetricReview: false,
    ...overrides,
  }
}

function databaseRow(number, overrides = {}) {
  return {
    id: number,
    publication_key: `work:${number}`,
    identity_key: `${number}|SITE-${number}`,
    record_status: 'current',
    confidence_percent: 40 + number,
    evidence_coverage_percent: 30 + number,
    metrics_policy_version: 'radar-public-metrics-policy-v01',
    source_metrics_policy_version: 'source-policy-v01',
    relationship_evidence_state: 'partial',
    metrics_source_release_id:
      'RADAR-PUBLIC-METRICS-10563-0001',
    metrics_calculation_basis_sha256:
      `${number}`.padStart(64, '0'),
    requires_metric_review: false,
    ...overrides,
  }
}

test('planner classifies exact current, update, missing and identity mismatch rows', () => {
  const result = buildPlan({
    manifest,
    metrics: [
      metric(1),
      metric(2),
      metric(3),
      metric(4),
    ],
    dbRows: [
      databaseRow(1),
      databaseRow(2, {
        confidence_percent: 1,
      }),
      databaseRow(4, {
        identity_key: '4|WRONG',
      }),
    ],
    dbColumns: metricColumns,
  })

  assert.deepEqual(
    result.summary.statusCounts,
    {
      alreadyCurrent: 1,
      wouldUpdate: 1,
      missingRating: 1,
      identityMismatch: 1,
      blocked: 0,
    },
  )

  assert.equal(result.summary.releaseContractValidated, true)
  assert.equal(result.summary.writeAuthorizationGatesVerified, true)
  assert.equal(result.summary.validatedMetricRows, 4)
  assert.equal(result.summary.databaseWriteExecuted, false)
})

test('planner blocks matched rows until additive schema columns exist', () => {
  const result = buildPlan({
    manifest,
    metrics: [metric(1)],
    dbRows: [
      {
        id: 1,
        publication_key: 'work:1',
        identity_key: '1|SITE-1',
        record_status: 'current',
      },
    ],
    dbColumns: [
      'id',
      'publication_key',
      'identity_key',
      'record_status',
    ],
  })

  assert.equal(result.summary.schemaReady, false)
  assert.equal(result.summary.statusCounts.blocked, 1)
  assert.equal(result.summary.wouldUpdateAfterSchema, 1)
  assert.match(
    result.plan[0].reason,
    /schema_columns_missing/,
  )
})

test('planner rejects an unsafe Release policy or write authorization gate', () => {
  assert.throws(
    () => buildPlan({
      manifest: {
        ...manifest,
        policy: {
          ...manifest.policy,
          policyId: 'unexpected-policy',
        },
      },
      metrics: [metric(1)],
      dbRows: [databaseRow(1)],
      dbColumns: metricColumns,
    }),
    /unexpected public metrics policy/i,
  )

  assert.throws(
    () => buildPlan({
      manifest: {
        ...manifest,
        gates: {
          ...manifest.gates,
          payloadWrite: true,
        },
      },
      metrics: [metric(1)],
      dbRows: [databaseRow(1)],
      dbColumns: metricColumns,
    }),
    /unsafe or missing Release gate: payloadWrite/i,
  )
})

test('planner rejects malformed identity and noninteger metric values', () => {
  assert.throws(
    () => buildPlan({
      manifest,
      metrics: [metric(1, {
        publicationKey: 'work:WRONG',
      })],
      dbRows: [databaseRow(1)],
      dbColumns: metricColumns,
    }),
    /publication key does not match Work ID/i,
  )

  assert.throws(
    () => buildPlan({
      manifest,
      metrics: [metric(1, {
        confidencePercent: 41.5,
      })],
      dbRows: [databaseRow(1)],
      dbColumns: metricColumns,
    }),
    /must be an integer from 0 through 100/i,
  )

  assert.throws(
    () => buildPlan({
      manifest,
      metrics: [metric(1, {
        relationshipEvidenceState: 'unknown',
      })],
      dbRows: [databaseRow(1)],
      dbColumns: metricColumns,
    }),
    /invalid relationship evidence state/i,
  )
})

test('planner source contains no database mutation implementation', () => {
  const source = fs.readFileSync(
    new URL(
      '../scripts/radar/plan-radar-public-metrics-overlay-v01.mjs',
      import.meta.url,
    ),
    'utf8',
  )

  assert.doesNotMatch(
    source,
    /payload\.(create|update|delete)/,
  )

  assert.doesNotMatch(
    source,
    /\b(INSERT\s+INTO|UPDATE\s+radar_public_ratings|DELETE\s+FROM)\b/i,
  )
})
