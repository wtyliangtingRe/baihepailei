import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  assertAllowedArguments,
  assertExactTransition,
  assertLoopbackUrl,
  assertRequestPolicy,
} from '../scripts/radar/plan-unified-rating-incremental-release-9988-v01.mjs'
import { validateIncrementalRelease } from '../scripts/radar/validate-unified-rating-incremental-release-9988-v01.mjs'

test('planner accepts only loopback and login/GET traffic', () => {
  assert.equal(assertLoopbackUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000')
  assert.equal(assertLoopbackUrl('http://localhost:33888/'), 'http://localhost:33888')
  assert.throws(() => assertLoopbackUrl('https://127.0.0.1:3000'), /HTTP loopback/)
  assert.throws(() => assertLoopbackUrl('http://example.com:3000'), /loopback/)

  assert.equal(assertRequestPolicy({ url: 'http://127.0.0.1:3000/api/works', method: 'GET' }), true)
  assert.equal(assertRequestPolicy({
    url: 'http://127.0.0.1:3000/api/users/login',
    method: 'POST',
    writeKind: 'login',
  }), true)
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.throws(() => assertRequestPolicy({
      url: 'http://127.0.0.1:3000/api/radar-public-records',
      method,
      writeKind: 'record_create',
    }), /Forbidden planner request/)
  }
})

test('planner argument and transition contract is exact', () => {
  assert.equal(assertAllowedArguments({
    input: 'release',
    url: 'http://127.0.0.1:3000',
    'out-dir': 'data_local/outputs/radar-unified-rating-incremental-release-9988-v01/test',
    'expected-main-head': 'a'.repeat(40),
    confirm: 'PLAN-RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-V01',
  }), true)
  assert.throws(() => assertAllowedArguments({ apply: 'true' }), /Forbidden arguments/)

  const rows = Array.from({ length: 9988 }, (_, index) => ({
    recordPlan: { planStatus: 'ready_create' },
    ratingPlan: { planStatus: 'ready_create' },
  }))
  const lock = {
    counts: { records: 9988 },
    expectedTransition: {
      recordStatusCounts: { ready_create: 9988 },
      ratingStatusCounts: { ready_create: 9988 },
      blockers: 0,
    },
  }
  assert.deepEqual(assertExactTransition({
    accepted: true,
    counts: { rows: 9988, blockers: 0 },
    rows,
  }, lock), {
    recordStatusCounts: { ready_create: 9988 },
    ratingStatusCounts: { ready_create: 9988 },
  })
  rows[0].recordPlan.planStatus = 'ready_update'
  assert.throws(() => assertExactTransition({
    accepted: true,
    counts: { rows: 9988, blockers: 0 },
    rows,
  }, lock), /transition mismatch/)
})

test('source contains no content mutation path', () => {
  const planner = fs.readFileSync(new URL('../scripts/radar/plan-unified-rating-incremental-release-9988-v01.mjs', import.meta.url), 'utf8')
  const validator = fs.readFileSync(new URL('../scripts/radar/validate-unified-rating-incremental-release-9988-v01.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(planner, /writeKind:\s*['"]record_create/)
  assert.doesNotMatch(planner, /writeKind:\s*['"]rating_create/)
  assert.doesNotMatch(planner, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/)
  assert.doesNotMatch(validator, /fetch\s*\(/)
  assert.match(planner, /authenticationSessionMayBeCreated:\s*true/)
  assert.match(planner, /productionAuthorization:\s*false/)
})

test('locked Release validator defaults to the exact cross-repo path', () => {
  assert.equal(typeof validateIncrementalRelease, 'function')
  const lock = JSON.parse(fs.readFileSync(new URL('../config/radar-unified-rating-incremental-release-9988-v01.lock.json', import.meta.url), 'utf8'))
  assert.equal(lock.researchCommitSha, 'c8790df95d1235d8d1aacabfb7c119fec9e1c642')
  assert.equal(lock.counts.records, 9988)
  assert.equal(lock.counts.ratings, 9988)
  assert.deepEqual(lock.expectedTransition.recordStatusCounts, { ready_create: 9988 })
  assert.deepEqual(lock.expectedTransition.ratingStatusCounts, { ready_create: 9988 })
  assert.equal(lock.productionAuthorization, false)
})
