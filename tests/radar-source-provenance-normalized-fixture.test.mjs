import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const summary = JSON.parse(readFileSync('tests/fixtures/ai-radar-source-provenance-normalized-first100-summary-v01.json', 'utf8'))

test('first-100 honest provenance normalization remains transparent and unblocked', () => {
  assert.equal(summary.rows, 100)
  assert.equal(summary.changed, 27)
  assert.equal(summary.unchanged, 73)
  assert.equal(summary.evidenceStatusDowngraded, 19)
  assert.equal(summary.sourceCountCorrected, 25)
  assert.equal(summary.annotationOnly, 2)
  assert.equal(summary.auditAfter.blocked, 0)
  assert.equal(summary.auditAfter.warningsOnly, 6)
  assert.equal(summary.auditAfter.clean, 94)
})
