import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyPublicationGap,
} from '../scripts/radar/audit-ai-radar-v06-publication-gap-v01.mjs'

test('classifies a published exact match', () => {
  assert.equal(
    classifyPublicationGap(
      { status: 'current_matches_v06_exact' },
      { status: 'current_matches_v06_exact' },
    ),
    'published_matches_v06',
  )
})

test('classifies a v0.6 result that exists only in the latest draft', () => {
  assert.equal(
    classifyPublicationGap(
      { status: 'current_missing_after_verified_apply' },
      { status: 'current_matches_v06_exact' },
    ),
    'draft_only_v06_match',
  )
})

test('does not overwrite another formal published conclusion', () => {
  assert.equal(
    classifyPublicationGap(
      { status: 'current_has_other_formal_conclusion' },
      { status: 'current_matches_v06_identity_fields' },
    ),
    'draft_matches_v06_published_other_formal',
  )
})

test('flags a later formal draft conclusion separately', () => {
  assert.equal(
    classifyPublicationGap(
      { status: 'current_missing_after_verified_apply' },
      { status: 'current_has_other_formal_conclusion' },
    ),
    'latest_draft_has_other_formal_conclusion',
  )
})

test('classifies missing results in both views', () => {
  assert.equal(
    classifyPublicationGap(
      { status: 'current_missing_after_verified_apply' },
      { status: 'current_scanned_without_valid_conclusion' },
    ),
    'missing_from_both_views',
  )
})
