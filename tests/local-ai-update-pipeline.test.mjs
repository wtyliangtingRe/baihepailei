import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync('scripts/radar/run-local-ai-update-v01.mjs', 'utf8')

test('local AI update command stays preparation and dry-run only', () => {
  assert.match(source, /preparation and dry-run only/u)
  assert.match(source, /args\\.apply \\|\\| args\\.execute \\|\\| args\\.confirm/u)
  assert.match(source, /payloadWrite: false/u)
  assert.match(source, /requiresExactOneToOneModelOutput: true/u)
})

test('local AI update supports repeatable scopes and trusted output merging', () => {
  assert.match(source, /unassessed, feedback-drafts, or all/u)
  assert.match(source, /function mergeScoredRows/u)
  assert.match(source, /existingState: packet\\.existingState/u)
  assert.match(source, /writeProtection: packet\\.writeProtection/u)
  assert.match(source, /humanTrackMutable: false/u)
})

test('local AI update always runs audit, plan and Payload dry-run after scorer output', () => {
  assert.match(source, /audit-ai-radar-input-v01\\.mjs/u)
  assert.match(source, /guard-ai-radar-exact-summary-duplicates-v01\\.mjs/u)
  assert.match(source, /audit-ai-radar-source-provenance-v01\\.mjs/u)
  assert.match(source, /plan-ai-radar-payload-patches-v01\\.mjs/u)
  assert.match(source, /dryrun-ai-radar-payload-patches-v01\\.mjs/u)
})
