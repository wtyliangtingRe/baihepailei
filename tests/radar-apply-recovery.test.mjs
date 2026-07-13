import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import {
  DEFAULT_ARM_TTL_MINUTES,
  MAX_ARM_TTL_MINUTES,
} from '../scripts/radar/lib/local-arm-v01.mjs'
import { changedFieldsAgainstCurrent } from '../scripts/radar/lib/payload-apply-v01.mjs'

const reconcileSource = readFileSync('scripts/radar/reconcile-ai-radar-payload-state-v01.mjs', 'utf8')
const executeOnceSource = readFileSync('scripts/radar/run-ai-radar-execute-once-v01.mjs', 'utf8')
const resumeSource = readFileSync('scripts/radar/resume-ai-radar-first100-v01.mjs', 'utf8')

for (const file of [
  'scripts/radar/reconcile-ai-radar-payload-state-v01.mjs',
  'scripts/radar/run-ai-radar-execute-once-v01.mjs',
  'scripts/radar/resume-ai-radar-first100-v01.mjs',
]) {
  test(`${file} parses successfully`, () => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  })
}

test('reconciliation is read-only and classifies partial state', () => {
  assert.doesNotMatch(reconcileSource, /method:\s*['"]PATCH['"]/u)
  assert.match(reconcileSource, /drifted_or_partially_applied/u)
  assert.match(reconcileSource, /already_applied/u)
  assert.match(reconcileSource, /pending_original_snapshot/u)
  assert.match(reconcileSource, /payloadPatchRequests:\s*0/u)
})

test('safe execute wrapper isolates every run and rejects a caller supplied output directory', () => {
  assert.match(executeOnceSource, /randomUUID/u)
  assert.match(executeOnceSource, /payload-apply-execute-runs-v01/u)
  assert.match(executeOnceSource, /--out-dir is rejected/u)
  assert.match(executeOnceSource, /'--execute'/u)
})

test('local arm defaults to two hours and allows up to twelve hours', () => {
  assert.equal(DEFAULT_ARM_TTL_MINUTES, 120)
  assert.equal(MAX_ARM_TTL_MINUTES, 720)
})

test('Payload UTC normalization and generated row ids are semantically equal to the reviewed patch', () => {
  const plan = {
    patch: {
      radarAssessment: {
        assessedAt: '2026-07-13T00:00:00+08:00',
        matchedRules: [{ code: 'A-YURI-HAREM', grade: 'A' }],
      },
    },
  }
  const work = {
    radarAssessment: {
      assessedAt: '2026-07-12T16:00:00Z',
      matchedRules: [{ id: 'payload-row-id', code: 'A-YURI-HAREM', grade: 'A' }],
    },
  }
  assert.deepEqual(changedFieldsAgainstCurrent(work, plan), [])
})

test('resume command is incident-bound, isolated, retry-verified and cannot silently broaden scope', () => {
  assert.match(resumeSource, /RESUME-AI-RADAR-FIRST-100-93-PATCHES/u)
  assert.match(resumeSource, /EXPECTED_ALREADY_APPLIED = 1/u)
  assert.match(resumeSource, /EXPECTED_PENDING = 93/u)
  assert.match(resumeSource, /payload-apply-resume-runs-v01/u)
  assert.match(resumeSource, /verifyWithRetry/u)
  assert.match(resumeSource, /rollbackIntentPersistedBeforePatch:\s*true/u)
  assert.match(resumeSource, /if \(args\.execute !== true\)/u)
  assert.match(resumeSource, /--out-dir, --limit/u)
  assert.doesNotMatch(resumeSource, /automaticRollback:\s*true/u)
})
