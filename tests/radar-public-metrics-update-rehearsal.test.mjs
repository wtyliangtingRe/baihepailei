import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const importerPath = path.join(
  root,
  'scripts/radar/run-radar-public-metrics-update-rehearsal-v01.mjs',
)
const markerPath = path.join(
  root,
  'src/app/(payload)/api/radar-public-metrics-update-rehearsal-marker/route.ts',
)
const workflowPath = path.join(
  root,
  '.github/workflows/validate-radar-public-metrics-update-rehearsal-v01.yml',
)
const guidePath = path.join(
  root,
  'docs/guides/radar-public-metrics-update-rehearsal-v01.md',
)
const lockPath = path.join(
  root,
  'config/radar-public-metrics-update-rehearsal-v01.lock.json',
)
const rehearsalPath = path.join(
  root,
  'scripts/radar/rehearse-radar-public-metrics-update-v01.ps1',
)

const importer = await import(pathToFileURL(importerPath).href)

const desired = {
  confidencePercent: 36,
  evidenceCoveragePercent: 24,
  metricsPolicyVersion: 'radar-public-metrics-policy-v01',
  sourceMetricsPolicyVersion:
    'radar-next-9988-dimension-metrics-policy-v021-calibration',
  relationshipEvidenceState: 'uncovered',
  metricsSourceReleaseId: 'RADAR-PUBLIC-METRICS-10563-0001',
  metricsCalculationBasisSha256: 'a'.repeat(64),
  requiresMetricReview: false,
}

function result(statusCounts, rows = 10563) {
  return {
    summary: {
      schemaReady: true,
      releaseRows: rows,
      databaseRows: rows,
      databaseCurrentRows: rows,
      statusCounts,
      blockedReasonCounts: {},
    },
    plan: [],
  }
}

test('request surface permits only loopback GET, login POST and exact rating PATCH', () => {
  assert.equal(
    importer.assertRehearsalUrl('http://127.0.0.1:32001'),
    'http://127.0.0.1:32001',
  )
  assert.equal(
    importer.assertRequestPolicy({
      url: 'http://127.0.0.1:32001/api/radar-public-ratings?limit=500',
      method: 'GET',
    }),
    true,
  )
  assert.equal(
    importer.assertRequestPolicy({
      url: 'http://127.0.0.1:32001/api/users/login',
      method: 'POST',
      writeKind: 'login',
    }),
    true,
  )
  assert.equal(
    importer.assertRequestPolicy({
      url: 'http://127.0.0.1:32001/api/radar-public-ratings/2078',
      method: 'PATCH',
      writeKind: 'metric_update',
    }),
    true,
  )

  for (const input of [
    ['https://127.0.0.1:32001', 'GET', ''],
    ['http://example.com:32001', 'GET', ''],
    ['http://127.0.0.1:3000', 'GET', ''],
  ]) {
    assert.throws(() => importer.assertRehearsalUrl(input[0]))
  }

  for (const input of [
    ['http://127.0.0.1:32001/api/radar-public-ratings', 'POST', 'metric_update'],
    ['http://127.0.0.1:32001/api/radar-public-ratings/2078', 'PUT', 'metric_update'],
    ['http://127.0.0.1:32001/api/radar-public-ratings/2078', 'DELETE', 'metric_update'],
    ['http://127.0.0.1:32001/api/radar-public-ratings/work:10000', 'PATCH', 'metric_update'],
    ['http://127.0.0.1:32001/api/works/10000', 'PATCH', 'metric_update'],
    ['http://127.0.0.1:32001/api/radar-public-records/10000', 'PATCH', 'metric_update'],
  ]) {
    assert.throws(() =>
      importer.assertRequestPolicy({
        url: input[0],
        method: input[1],
        writeKind: input[2],
      }),
    )
  }
})

test('metric patch is exactly the eight reviewed fields', () => {
  const patch = importer.metricPatch(desired)
  assert.deepEqual(Object.keys(patch), importer.METRIC_FIELDS)
  assert.deepEqual(patch, desired)

  assert.throws(() => importer.assertMetricPatch({ ...patch, title: 'x' }))
  assert.throws(() => importer.assertMetricPatch({ ...patch, confidencePercent: 1.5 }))
  assert.throws(() => importer.assertMetricPatch({ ...patch, evidenceCoveragePercent: 101 }))
  assert.throws(() => importer.assertMetricPatch({ ...patch, requiresMetricReview: 'false' }))
})

test('Payload rows map only into planner comparison fields', () => {
  assert.deepEqual(
    importer.payloadRowToPlannerRow({
      id: 2078,
      publicationKey: 'work:10000',
      identityKey: '10000|catalog-anilist-106296',
      recordStatus: 'current',
      ...desired,
      title: 'must not enter planner row',
      humanReview: { status: 'reviewed' },
    }),
    {
      id: 2078,
      publication_key: 'work:10000',
      identity_key: '10000|catalog-anilist-106296',
      record_status: 'current',
      confidence_percent: 36,
      evidence_coverage_percent: 24,
      metrics_policy_version: 'radar-public-metrics-policy-v01',
      source_metrics_policy_version:
        'radar-next-9988-dimension-metrics-policy-v021-calibration',
      relationship_evidence_state: 'uncovered',
      metrics_source_release_id: 'RADAR-PUBLIC-METRICS-10563-0001',
      metrics_calculation_basis_sha256: 'a'.repeat(64),
      requires_metric_review: false,
    },
  )
})

test('initial and converged plans are exact closed-world states', () => {
  importer.assertInitialPlan(result({
    alreadyCurrent: 0,
    wouldUpdate: 10563,
    missingRating: 0,
    identityMismatch: 0,
    blocked: 0,
  }))
  importer.assertConvergedPlan(result({
    alreadyCurrent: 10563,
    wouldUpdate: 0,
    missingRating: 0,
    identityMismatch: 0,
    blocked: 0,
  }))

  assert.throws(() => importer.assertInitialPlan(result({
    alreadyCurrent: 0,
    wouldUpdate: 10562,
    missingRating: 1,
    identityMismatch: 0,
    blocked: 0,
  })))
  assert.throws(() => importer.assertConvergedPlan(result({
    alreadyCurrent: 10562,
    wouldUpdate: 1,
    missingRating: 0,
    identityMismatch: 0,
    blocked: 0,
  })))
})

test('lock binds the independently reviewed read-only candidate', () => {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  assert.equal(lock.schemaVersion, 'radar-public-metrics-update-rehearsal-lock-v01')
  assert.equal(lock.baseMain, '62768b16d7f2bba102bb4391999b479b1fda4110')
  assert.equal(lock.researchHead, 'c2fe7847ee8b60b439f8e92025437937ceff06d5')
  assert.equal(lock.releaseId, 'RADAR-PUBLIC-METRICS-10563-0001')
  assert.equal(lock.planCandidateSha256, '7c387dba1e5c6bfa9e3fe312c39b7ff203d969386209c02536b821f03f923b21')
  assert.equal(lock.planReviewZipSha256, '6f724b85a0f125bc99d3b0074f9f017609b7acff9b91ddfa5bb3b570afa544c5')
  assert.equal(lock.expectedTransition.wouldUpdate, 10563)
  assert.equal(lock.expectedTransition.blocked, 0)
  assert.equal(lock.productionAuthorization, false)
})

test('marker, workflow and guide preserve disposable-only boundary', () => {
  const marker = fs.readFileSync(markerPath, 'utf8')
  const workflow = fs.readFileSync(workflowPath, 'utf8')
  const guide = fs.readFileSync(guidePath, 'utf8')

  for (const value of [
    'rehearsalMode: true',
    'productionAuthorization: false',
    'RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_NONCE',
    'x-radar-public-metrics-update-rehearsal-nonce',
  ]) {
    assert.ok(marker.includes(value))
  }

  assert.match(workflow, /node --check/u)
  assert.match(workflow, /Forbidden HTTP request/u)
  assert.match(workflow, /git diff --check/u)

  assert.match(guide, /PATCH/u)
  assert.match(guide, /10,563/u)
  assert.match(guide, /disposable/u)
  assert.match(guide, /No production authorization/u)
})
test('rehearsal binds the schema receipt and migrates only the disposable restore', () => {
  const rehearsal = fs.readFileSync(rehearsalPath, 'utf8')

  assert.match(
    rehearsal,
    /aaaf3a2d0e05ed565e673198a9b134717945b56b49038b97243d958d60ed63a2/u,
  )
  assert.match(
    rehearsal,
    /PlanCandidate\.schemaExecution\.executionReceiptSha256/u,
  )
  assert.match(rehearsal, /Temp restored columns/u)
  assert.match(rehearsal, /Temp restored migrations/u)
  assert.match(rehearsal, /-Expected 36/u)
  assert.match(rehearsal, /-Expected 9/u)
  assert.match(rehearsal, /pnpm exec payload migrate/u)
  assert.match(rehearsal, /MigrationDatabaseUrl/u)
  assert.match(rehearsal, /\$env:DATABASE_URL = \$MigrationDatabaseUrl/u)

  const migrationCommands =
    rehearsal.match(/pnpm exec payload migrate/gu) || []

  assert.equal(migrationCommands.length, 1)
})

test('public table count SQL uses PowerShell-safe validated identifiers', () => {
  const rehearsal = fs.readFileSync(rehearsalPath, 'utf8')

  assert.match(
    rehearsal,
    /\[string\]\$TableName -notmatch '\^\[a-zA-Z0-9_\]\+\$'/u,
  )
  assert.match(
    rehearsal,
    /-Sql "SELECT count\(\*\)::text FROM public\.\$TableName;"/u,
  )
  assert.doesNotMatch(
    rehearsal,
    /public\.\\\\"\$TableName\\\\";/u,
  )
})
