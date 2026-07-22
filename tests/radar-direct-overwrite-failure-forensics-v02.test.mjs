import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  categorizeDiffs,
  diffDocuments,
} from '../scripts/radar/inspect-ai-radar-direct-overwrite-failure-v02.mjs'

const repoRoot = process.cwd()
const nodeSource = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/inspect-ai-radar-direct-overwrite-failure-v02.mjs'),
  'utf8',
)
const powerShellSource = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/inspect-ai-radar-direct-overwrite-failure-v02.ps1'),
  'utf8',
)

test('recursive diff separates patch, human, volatile, and unrelated fields', () => {
  const before = {
    id: 3739,
    updatedAt: '2026-07-22T00:00:00.000Z',
    title: 'Before',
    radarAssessment: { suggestedGrade: 'B' },
    humanAssessment: { grade: 'S' },
    metadata: { nested: ['a', 'b'] },
  }
  const after = {
    id: 3739,
    updatedAt: '2026-07-22T01:00:00.000Z',
    title: 'After',
    radarAssessment: { suggestedGrade: 'A' },
    humanAssessment: { grade: 'S' },
    metadata: { nested: ['a', 'c'] },
  }
  const diffs = diffDocuments(before, after)
  const categories = categorizeDiffs(diffs, { radarAssessment: after.radarAssessment })

  assert.deepEqual(categories.patch.map((item) => item.path), ['radarAssessment.suggestedGrade'])
  assert.deepEqual(categories.human.map((item) => item.path), [])
  assert.deepEqual(categories.volatile.map((item) => item.path), ['updatedAt'])
  assert.deepEqual(categories.unrelated.map((item) => item.path), ['metadata.nested[1]', 'title'])
})

test('forensics reads failed ledger, public state, draft state, and versions', () => {
  assert.match(nodeSource, /findFailedRun\(outRoot, targetId\)/u)
  assert.match(nodeSource, /readWork\(baseUrl, token, targetId\)/u)
  assert.match(nodeSource, /readWork\(baseUrl, token, targetId, \{ draft: true \}\)/u)
  assert.match(nodeSource, /readVersions\(baseUrl, token, targetId\)/u)
  assert.match(nodeSource, /selectBaselineVersion\(versions, failedRun\.planRow, patch\)/u)
})

test('forensics is Payload read-only apart from login', () => {
  assert.match(nodeSource, /payloadLoginPostOnly: true/u)
  assert.match(nodeSource, /payloadDataMutation: false/u)
  assert.match(nodeSource, /payloadPatch: false/u)
  assert.match(nodeSource, /payloadRestoreVersion: false/u)
  assert.doesNotMatch(nodeSource, /method:\s*['"]PATCH['"]/u)
  assert.doesNotMatch(nodeSource, /\/api\/works\/versions\/\$\{encodeURIComponent/u)
})

test('forensics reports exact unrelated changed paths and backup proof', () => {
  assert.match(nodeSource, /unrelatedChangedPaths: categories\.unrelated/u)
  assert.match(nodeSource, /publishedUnrelatedMatchesExpectedBefore/u)
  assert.match(nodeSource, /RADAR-DIRECT-OVERWRITE-FIRST5-\.\*-proof/u)
  assert.match(nodeSource, /dumpSha256Actual/u)
})

test('PowerShell wrapper creates a checksum-protected read-only checkpoint', () => {
  assert.match(powerShellSource, /RADAR-FULL-COVERAGE-DIRECT-OVERWRITE-FAILURE-FORENSICS-v02\.zip/u)
  assert.match(powerShellSource, /PayloadDataMutation\s+: False/u)
  assert.match(powerShellSource, /PayloadPatch\s+: False/u)
  assert.match(powerShellSource, /PayloadRestoreVersion\s+: False/u)
  assert.match(powerShellSource, /SHA256SUMS\.txt/u)
})
