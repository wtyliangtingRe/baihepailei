import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDirectOverwriteSource } from '../scripts/radar/run-ai-radar-full-coverage-direct-overwrite-v02.mjs'

const repoRoot = process.cwd()
const source = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-ai-radar-full-coverage-publication-v01.mjs'),
  'utf8',
)
const patched = buildDirectOverwriteSource(source)

test('direct overwrite generator accepts Windows CRLF source materialization', () => {
  const crlfSource = source.replace(/\r?\n/gu, '\r\n')
  const crlfPatched = buildDirectOverwriteSource(crlfSource)
  assert.equal(crlfPatched, patched)
  assert.doesNotMatch(crlfPatched, /\r/u)
})

test('direct overwrite removes all version roundtrip execution', () => {
  assert.doesNotMatch(patched, /executeRoundtrip\(/u)
  assert.doesNotMatch(patched, /restoreVersion\(/u)
  assert.doesNotMatch(patched, /\/api\/works\/versions\/\$\{encodeURIComponent\(versionId\)\}/u)
  assert.doesNotMatch(patched, /strategy = 'version_roundtrip'/u)
  assert.doesNotMatch(patched, /safeDirect \?/u)
})

test('every non-published valid row uses direct AI field publication', () => {
  assert.match(patched, /strategy = 'direct_field_publish_latest_ai_overwrite'/u)
  assert.match(patched, /event\.workPublication = await executeDirect\(\{ baseUrl, token, row, publishedBefore \}\)/u)
  assert.match(patched, /strategy: 'direct_field_publish_latest_ai_overwrite'/u)
})

test('latest AI conclusion explicitly supersedes the older AI draft', () => {
  assert.match(patched, /latest_ai_overwrites_older_draft_ai/u)
  assert.match(patched, /latestAiOverwritesOlderDraftAi: true/u)
  assert.match(patched, /versionRoundtripUsedWhenDraftUnrelatedFieldsDiffer: false/u)
})

test('direct overwrite still verifies human and unrelated published state', () => {
  assert.match(patched, /direct_human_state_changed/u)
  assert.match(patched, /direct_unrelated_state_changed/u)
  assert.match(patched, /direct_patch_not_present/u)
  assert.match(patched, /humanAssessmentMutation: false/u)
  assert.match(patched, /wholeDraftPublication: false/u)
})

test('a failed direct write stops the run immediately', () => {
  assert.match(patched, /wrapped\.writeRequests = writes/u)
  assert.match(patched, /counters\.increment\('execution_failed'\); throw error/u)
})

test('only allowed AI compatibility fields can be patched', () => {
  for (const field of [
    "'_status'",
    "'radarAssessment'",
    "'rank'",
    "'ratingNotice'",
    "'reviewReasons'",
    "'evidenceStrength'",
  ]) {
    assert.match(patched, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  }
  assert.match(patched, /human_assessment_patch_forbidden/u)
})
