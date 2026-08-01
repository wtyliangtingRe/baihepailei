import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  assertIsolatedLabUrl,
  summarizePlans,
} from '../scripts/radar/run-public-release-lab-import-v01.mjs'

const importer = readFileSync('scripts/radar/run-public-release-lab-import-v01.mjs', 'utf8')
const marker = readFileSync('src/app/(payload)/api/radar-public-release-lab-marker/route.ts', 'utf8')

test('write-capable importer accepts only loopback high ports', () => {
  assert.equal(assertIsolatedLabUrl('http://127.0.0.1:32001'), 'http://127.0.0.1:32001')
  assert.equal(assertIsolatedLabUrl('http://localhost:39999/'), 'http://localhost:39999')
  assert.throws(() => assertIsolatedLabUrl('http://127.0.0.1:3000'), /31000-39999|3000/u)
  assert.throws(() => assertIsolatedLabUrl('https://127.0.0.1:32001'), /must use http/u)
  assert.throws(() => assertIsolatedLabUrl('http://example.com:32001'), /loopback/u)
  assert.throws(() => assertIsolatedLabUrl('http://127.0.0.1:8080'), /31000-39999/u)
})

test('plan summary closes create and already-current partitions', () => {
  assert.deepEqual(
    summarizePlans([
      { planStatus: 'ready_create' },
      { planStatus: 'ready_create' },
      { planStatus: 'blocked_identity_conflict' },
    ]),
    {
      byPlanStatus: { blocked_identity_conflict: 1, ready_create: 2 },
      readyCreate: 2,
      readyUpdate: 0,
      alreadyCurrent: 0,
      blocked: 1,
    },
  )
})

test('importer requires the isolated marker and has no update/delete path', () => {
  assert.match(importer, /RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01/u)
  assert.match(importer, /radar-public-release-lab-marker/u)
  assert.match(importer, /RADAR_PUBLIC_RELEASE_LAB_NONCE/u)
  assert.match(importer, /expected-website-commit/u)
  assert.match(importer, /expected-research-commit/u)
  assert.match(importer, /expected-database/u)
  assert.match(importer, /method: 'POST'/u)
  assert.doesNotMatch(importer, /method: 'PATCH'|method: 'DELETE'|method: 'PUT'/u)
  assert.match(importer, /readyCreate !== rows/u)
  assert.match(importer, /alreadyCurrent !== rows/u)
  assert.match(importer, /productionWrite: false/u)
})

test('lab marker is disabled by default and binds nonce plus database', () => {
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_MODE/u)
  assert.match(marker, /invalid_lab_nonce/u)
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_DATABASE/u)
  assert.match(marker, /lab_database_mismatch/u)
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_WEBSITE_COMMIT/u)
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_RESEARCH_COMMIT/u)
  assert.match(marker, /status: 404/u)
  assert.match(marker, /status: 403/u)
})
