import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const summary = JSON.parse(readFileSync('tests/fixtures/ai-radar-source-provenance-first100-summary-v01.json', 'utf8'))

test('first-100 source provenance review remains blocked until 19 rows are repaired', () => {
  assert.equal(summary.rows, 100)
  assert.equal(summary.blocked, 19)
  assert.equal(summary.warningsOnly, 8)
  assert.equal(summary.clean, 73)
  assert.equal(summary.combinedWithExistingPayloadPlan.eligibleAfterBothGuards, 75)
  assert.equal(summary.safety.payloadWrite, false)
})
