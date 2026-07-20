import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync('scripts/radar/prepare-discovered-work-candidates-v01.mjs', 'utf8')

test('discovered work planning is source-snapshot based and has no write mode', () => {
  assert.match(source, /--candidates and --works are required/u)
  assert.match(source, /Discovered-work planning is read-only/u)
  assert.match(source, /sourceSnapshotRequired: true/u)
  assert.match(source, /titleOnlyAutoMergeAllowed: false/u)
})

test('candidate planner separates ready drafts, duplicates and blockers', () => {
  assert.match(source, /ready_for_editor_draft/u)
  assert.match(source, /possible_duplicate/u)
  assert.match(source, /missing_traceable_source_link/u)
  assert.match(source, /external_id/u)
  assert.match(source, /title_media/u)
})
