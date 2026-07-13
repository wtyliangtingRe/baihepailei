import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('scripts/radar/apply-ai-radar-payload-patches-v01.mjs', 'utf8')

test('apply command defaults to readiness and requires explicit execute mode', () => {
  assert.match(source, /const execute = args\.execute === true/u)
  assert.match(source, /Legacy --apply\/--confirm flags are rejected/u)
  assert.match(source, /explicit_approval_token_mismatch/u)
})

test('rollback intent is persisted before the PATCH request', () => {
  const rollbackAppend = source.indexOf('appendJsonl(outputs.rollback, rollback)')
  const patchRequest = source.indexOf('await patchWork(baseUrl, token, targetId, patch)')
  assert.ok(rollbackAppend >= 0)
  assert.ok(patchRequest >= 0)
  assert.ok(rollbackAppend < patchRequest)
})

test('execution stops on the first failure and never auto-rolls back', () => {
  assert.match(source, /stoppedAfterFailure = true[\s\S]*break/u)
  assert.match(source, /automaticRollback: false/u)
  assert.match(source, /rollbackIntentPersistedBeforePatch: true/u)
})
