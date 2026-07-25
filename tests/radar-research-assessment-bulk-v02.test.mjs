import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedModes, normalizeContentProfile, validateOutcome } from '../scripts/radar/lib/research-assessment-handoff-v02.mjs'

test('v0.2 lanes and grade ranges preserve safety restrictions', () => {
  assert.deepEqual(allowedModes('identity_review'), ['labels_only'])
  assert.throws(() => validateOutcome({ assessmentMode: 'exact', exactGradeSuggestion: 'X' }, 'ready_for_ai_assessment'))
  assert.throws(() => validateOutcome({ assessmentMode: 'bounded_range', gradeRange: { best: 'D', likely: 'A', worst: 'F' } }, 'needs_more_research'))
  assert.doesNotThrow(() => validateOutcome({ assessmentMode: 'bounded_range', gradeRange: { best: 'A', likely: 'C', worst: 'F' } }, 'needs_more_research'))
})

test('v0.2 content normalization never infers sexual content from horror', () => {
  const profile = normalizeContentProfile({ riskFindings: { adultContent: 'none_found', violenceOrHorror: 'severe', maleInvolvement: 'none_found' } })
  assert.equal(profile.sexualContent, 'none_found')
  assert.equal(profile.sexualParticipants, 'none')
  assert.equal(profile.violenceOrHorror, 'severe')
  const explicit = normalizeContentProfile({ riskFindings: { adultContent: 'explicit', maleInvolvement: 'none_found' } })
  assert.equal(explicit.sexualContent, 'explicit')
  assert.equal(explicit.sexualParticipants, 'female_female')
})