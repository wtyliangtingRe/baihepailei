import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  assertAllowedArguments as assertPlannerArguments,
  assertExactTransition,
  assertLoopbackUrl,
  assertRequestPolicy as assertPlannerRequestPolicy,
} from '../scripts/radar/plan-unified-rating-incremental-release-9988-v01.mjs'
import {
  assertAllowedArguments as assertImporterArguments,
  assertConverged,
  assertFreshPlan,
  assertProductionUrl,
  assertRequestPolicy as assertImporterRequestPolicy,
  payloadDocument,
} from '../scripts/radar/run-unified-rating-incremental-production-import-9988-v01.mjs'
import { validateIncrementalRelease } from '../scripts/radar/validate-unified-rating-incremental-release-9988-v01.mjs'

test('planner accepts only loopback and login/GET traffic', () => {
  assert.equal(assertLoopbackUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000')
  assert.equal(assertLoopbackUrl('http://localhost:33888/'), 'http://localhost:33888')
  assert.throws(() => assertLoopbackUrl('https://127.0.0.1:3000'), /HTTP loopback/)
  assert.throws(() => assertLoopbackUrl('http://example.com:3000'), /loopback/)

  assert.equal(assertPlannerRequestPolicy({ url: 'http://127.0.0.1:3000/api/works', method: 'GET' }), true)
  assert.equal(assertPlannerRequestPolicy({
    url: 'http://127.0.0.1:3000/api/users/login',
    method: 'POST',
    writeKind: 'login',
  }), true)
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.throws(() => assertPlannerRequestPolicy({
      url: 'http://127.0.0.1:3000/api/radar-public-records',
      method,
      writeKind: 'record_create',
    }), /Forbidden planner request/)
  }
})

test('planner argument and transition contract is exact', () => {
  assert.equal(assertPlannerArguments({
    input: 'release',
    url: 'http://127.0.0.1:3000',
    'out-dir': 'data_local/outputs/radar-unified-rating-incremental-release-9988-v01/test',
    'expected-main-head': 'a'.repeat(40),
    confirm: 'PLAN-RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-V01',
  }), true)
  assert.throws(() => assertPlannerArguments({ apply: 'true' }), /Forbidden arguments/)

  const rows = Array.from({ length: 9988 }, () => ({
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

test('create-only importer permits only locked POST targets', () => {
  assert.equal(assertProductionUrl('http://127.0.0.1:33888'), 'http://127.0.0.1:33888')
  assert.throws(() => assertProductionUrl('http://127.0.0.1:3000'), /not 3000/)
  assert.throws(() => assertProductionUrl('http://example.com:33888'), /loopback/)

  assert.equal(assertImporterRequestPolicy({ url: 'http://127.0.0.1:33888/api/works', method: 'GET' }), true)
  assert.equal(assertImporterRequestPolicy({
    url: 'http://127.0.0.1:33888/api/users/login', method: 'POST', writeKind: 'login',
  }), true)
  assert.equal(assertImporterRequestPolicy({
    url: 'http://127.0.0.1:33888/api/radar-public-records', method: 'POST', writeKind: 'record_create',
  }), true)
  assert.equal(assertImporterRequestPolicy({
    url: 'http://127.0.0.1:33888/api/radar-public-ratings', method: 'POST', writeKind: 'rating_create',
  }), true)
  for (const method of ['PATCH', 'PUT', 'DELETE']) {
    assert.throws(() => assertImporterRequestPolicy({
      url: 'http://127.0.0.1:33888/api/radar-public-records', method, writeKind: 'record_create',
    }), /Forbidden HTTP method/)
  }
  assert.throws(() => assertImporterRequestPolicy({
    url: 'http://127.0.0.1:33888/api/works', method: 'POST', writeKind: 'record_create',
  }), /Forbidden POST target/)
})

test('importer enforces exact fresh and converged states', () => {
  const fresh = {
    accepted: true,
    counts: {
      blockers: 0,
      rows: 9988,
      recordStatusCounts: { ready_create: 9988 },
      ratingStatusCounts: { ready_create: 9988 },
    },
  }
  assert.equal(assertFreshPlan(fresh), fresh)
  assert.throws(() => assertFreshPlan({
    ...fresh,
    counts: { ...fresh.counts, recordStatusCounts: { ready_update: 1, ready_create: 9987 } },
  }), /fresh plan mismatch/)

  const converged = {
    accepted: true,
    counts: {
      blockers: 0,
      rows: 9988,
      recordStatusCounts: { already_current: 9988 },
      ratingStatusCounts: { already_current: 9988 },
    },
  }
  assert.equal(assertConverged(converged), converged)
  assert.throws(() => assertConverged(fresh), /did not converge/)
})

test('Payload document normalizes relationship and blank review values', () => {
  const document = payloadDocument({
    work: '123',
    publicationKey: 'work:123',
    humanReview: {
      status: 'unreviewed',
      reviewerIdentity: '',
      reviewedAt: '',
      decision: '',
      proposedCoreGrade: '',
      reasoning: '',
      moderationState: '',
      blocksAnalysis: false,
      blocksPublication: false,
    },
  })
  assert.equal(document.work, 123)
  assert.equal(document.humanReview.reviewerIdentity, null)
  assert.equal(document.humanReview.reviewedAt, null)
  assert.equal(document.humanReview.proposedCoreGrade, null)
  assert.throws(() => payloadDocument({ work: 'unsafe', humanReview: {} }), /Unsafe Work relationship ID/)
})

test('source safety contracts contain no update or delete path', () => {
  const planner = fs.readFileSync(new URL('../scripts/radar/plan-unified-rating-incremental-release-9988-v01.mjs', import.meta.url), 'utf8')
  const importer = fs.readFileSync(new URL('../scripts/radar/run-unified-rating-incremental-production-import-9988-v01.mjs', import.meta.url), 'utf8')
  const validator = fs.readFileSync(new URL('../scripts/radar/validate-unified-rating-incremental-release-9988-v01.mjs', import.meta.url), 'utf8')
  const marker = fs.readFileSync(new URL('../src/app/(payload)/api/radar-unified-rating-incremental-production-marker/route.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(planner, /writeKind:\s*['"]record_create/)
  assert.doesNotMatch(planner, /writeKind:\s*['"]rating_create/)
  assert.doesNotMatch(planner, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/)
  assert.doesNotMatch(validator, /fetch\s*\(/)
  assert.match(planner, /authenticationSessionMayBeCreated:\s*true/)
  assert.match(planner, /productionAuthorization:\s*false/)

  assert.doesNotMatch(importer, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/)
  assert.doesNotMatch(importer, /payload\.update|payload\.delete|omissionMeansDelete:\s*true/)
  assert.match(importer, /automaticRetryAllowed:\s*false/)
  assert.match(importer, /automaticRollbackAllowed:\s*false/)
  assert.match(importer, /operatorMustInspectBeforeAnyFurtherAction:\s*true/)
  assert.match(importer, /for \(const row of prePlan\.rows\)/)

  assert.match(marker, /radar-unified-rating-incremental-production-marker-9988-v01/)
  assert.match(marker, /RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_NONCE/)
  assert.match(marker, /loopback_required/)
})

test('locked Release validator and arguments bind exact identities', () => {
  assert.equal(typeof validateIncrementalRelease, 'function')
  const lock = JSON.parse(fs.readFileSync(new URL('../config/radar-unified-rating-incremental-release-9988-v01.lock.json', import.meta.url), 'utf8'))
  assert.equal(lock.researchCommitSha, 'c8790df95d1235d8d1aacabfb7c119fec9e1c642')
  assert.equal(lock.counts.records, 9988)
  assert.equal(lock.counts.ratings, 9988)
  assert.deepEqual(lock.expectedTransition.recordStatusCounts, { ready_create: 9988 })
  assert.deepEqual(lock.expectedTransition.ratingStatusCounts, { ready_create: 9988 })
  assert.equal(lock.productionAuthorization, false)

  assert.equal(assertImporterArguments({
    input: 'release',
    url: 'http://127.0.0.1:33888',
    'out-dir': 'data_local/outputs/radar-unified-rating-incremental-production-9988-v01/test',
    mode: 'plan',
    'expected-main-head': 'a'.repeat(40),
    'expected-research-head': 'b'.repeat(40),
    'expected-database': 'temporary_database',
    'expected-candidate-sha256': 'c'.repeat(64),
    'expected-phase': 'plan',
    confirm: 'RUN-RADAR-UNIFIED-RATING-INCREMENTAL-PRODUCTION-IMPORT-9988-V01',
  }), true)
  assert.throws(() => assertImporterArguments({ resume: 'true' }), /Forbidden arguments/)
})
