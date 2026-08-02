import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  assertAllowedArguments,
  assertConverged,
  assertFreshPlan,
  assertProductionUrl,
  assertRequestPolicy,
  payloadDocument,
} from '../scripts/radar/run-unified-release-production-import-0575-v01.mjs'

const importerSource = fs.readFileSync('scripts/radar/run-unified-release-production-import-0575-v01.mjs', 'utf8')
const markerSource = fs.readFileSync('src/app/(payload)/api/radar-unified-release-production-marker/route.ts', 'utf8')

function plan(recordStatusCounts, ratingStatusCounts, blockers = 0, rows = 575) {
  return {
    accepted: blockers === 0,
    counts: { rows, blockers, recordStatusCounts, ratingStatusCounts },
  }
}

test('production URL is loopback-only on a bounded non-default port', () => {
  assert.equal(assertProductionUrl('http://127.0.0.1:32001'), 'http://127.0.0.1:32001')
  assert.throws(() => assertProductionUrl('https://127.0.0.1:32001'), /HTTP loopback/u)
  assert.throws(() => assertProductionUrl('http://example.com:32001'), /loopback/u)
  assert.throws(() => assertProductionUrl('http://127.0.0.1:3000'), /32000-39999/u)
  assert.throws(() => assertProductionUrl('http://127.0.0.1:40000'), /32000-39999/u)
})

test('production importer accepts its exact input/output arguments and rejects unknown write controls', () => {
  assert.equal(assertAllowedArguments({
    input: 'release',
    url: 'http://127.0.0.1:32001',
    'out-dir': 'data_local/outputs/radar-unified-release-production-0575-v01/test',
    mode: 'apply',
    'expected-main-head': 'a'.repeat(40),
    'expected-research-head': 'b'.repeat(40),
    'expected-database': 'temporary_database',
    'expected-candidate-sha256': 'c'.repeat(64),
    'expected-phase': 'rehearsal',
    confirm: 'RUN-RADAR-UNIFIED-RELEASE-PRODUCTION-IMPORT-0575-V01',
  }), true)
  assert.throws(() => assertAllowedArguments({ input: 'release', rollback: 'true' }), /Forbidden arguments: rollback/u)
  assert.throws(() => assertAllowedArguments({ input: 'release', remote: 'true' }), /Forbidden arguments: remote/u)
})

test('request policy permits GET and only three exact POST targets', () => {
  assert.equal(assertRequestPolicy({ url: 'http://127.0.0.1:32001/api/works', method: 'GET' }), true)
  assert.equal(assertRequestPolicy({ url: 'http://127.0.0.1:32001/api/users/login', method: 'POST', writeKind: 'login' }), true)
  assert.equal(assertRequestPolicy({ url: 'http://127.0.0.1:32001/api/radar-public-records', method: 'POST', writeKind: 'record_create' }), true)
  assert.equal(assertRequestPolicy({ url: 'http://127.0.0.1:32001/api/radar-public-ratings', method: 'POST', writeKind: 'rating_create' }), true)
  assert.throws(() => assertRequestPolicy({ url: 'http://127.0.0.1:32001/api/works', method: 'POST', writeKind: 'record_create' }), /Forbidden POST/u)
  assert.throws(() => assertRequestPolicy({ url: 'http://127.0.0.1:32001/api/radar-public-records/1', method: 'PATCH' }), /Forbidden HTTP method/u)
  assert.throws(() => assertRequestPolicy({ url: 'http://127.0.0.1:32001/api/radar-public-records/1', method: 'PUT' }), /Forbidden HTTP method/u)
  assert.throws(() => assertRequestPolicy({ url: 'http://127.0.0.1:32001/api/radar-public-records/1', method: 'DELETE' }), /Forbidden HTTP method/u)
})

test('fresh plan requires exactly 575 record and rating creates', () => {
  assert.doesNotThrow(() => assertFreshPlan(plan({ ready_create: 575 }, { ready_create: 575 })))
  assert.throws(() => assertFreshPlan(plan({ ready_create: 574, already_current: 1 }, { ready_create: 575 })), /fresh plan mismatch/u)
  assert.throws(() => assertFreshPlan(plan({ ready_create: 575 }, { ready_create: 575 }, 1)), /fresh plan mismatch/u)
  assert.throws(() => assertFreshPlan(plan({ ready_create: 575 }, { ready_create: 575 }, 0, 574)), /fresh plan mismatch/u)
})

test('verification requires exact 575 plus 575 convergence', () => {
  assert.doesNotThrow(() => assertConverged(plan({ already_current: 575 }, { already_current: 575 })))
  assert.throws(() => assertConverged(plan({ already_current: 575 }, { ready_create: 575 })), /did not converge/u)
})

test('payload normalization preserves relationship identity and nulls blank review fields', () => {
  const document = payloadDocument({
    work: '42',
    humanReview: {
      reviewerIdentity: '',
      reviewedAt: '',
      decision: '',
      proposedCoreGrade: '',
      reasoning: '',
      moderationState: '',
    },
  })
  assert.equal(document.work, 42)
  for (const value of Object.values(document.humanReview)) assert.equal(value, null)
})

test('production importer has no update or delete implementation', () => {
  assert.doesNotMatch(importerSource, /method:\s*['"]PATCH['"]/u)
  assert.doesNotMatch(importerSource, /method:\s*['"]PUT['"]/u)
  assert.doesNotMatch(importerSource, /method:\s*['"]DELETE['"]/u)
  assert.doesNotMatch(importerSource, /ready_update/u)
  assert.doesNotMatch(importerSource, /incremental mode/iu)
  assert.match(importerSource, /automaticRetryAllowed:\s*false/u)
  assert.match(importerSource, /automaticRollbackAllowed:\s*false/u)
})

test('production marker is disabled by default and binds exact execution identity', () => {
  assert.match(markerSource, /RADAR_UNIFIED_RELEASE_PRODUCTION_MODE/u)
  assert.match(markerSource, /x-radar-unified-release-production-nonce/u)
  assert.match(markerSource, /loopback_required/u)
  assert.match(markerSource, /production_database_mismatch/u)
  assert.match(markerSource, /RADAR_UNIFIED_RELEASE_PRODUCTION_MAIN_HEAD/u)
  assert.match(markerSource, /RADAR_UNIFIED_RELEASE_PRODUCTION_RESEARCH_HEAD/u)
  assert.match(markerSource, /RADAR_UNIFIED_RELEASE_PRODUCTION_CANDIDATE_SHA256/u)
  assert.match(markerSource, /productionMode:\s*true/u)
})
