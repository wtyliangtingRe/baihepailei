import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const script = fs.readFileSync(new URL('../scripts/import/audit-work-duplicates-cross-language-v01.mjs', import.meta.url), 'utf8')

test('cross-language duplicate audit is read-only and forbids automatic apply', () => {
  assert.match(script, /payloadWrite:\s*false/u)
  assert.match(script, /directPostgresqlWrite:\s*false/u)
  assert.match(script, /mergeApplied:\s*false/u)
  assert.match(script, /deleteApplied:\s*false/u)
  assert.match(script, /automaticApplyAllowed:\s*false/u)
  assert.doesNotMatch(script, /method:\s*['"](?:PATCH|POST|DELETE)['"]/u)
})

test('candidate matching requires cross-source media/date compatibility and rare latin tokens', () => {
  assert.match(script, /MAX_TOKEN_FREQUENCY/u)
  assert.match(script, /shared_rare_latin_token/u)
  assert.match(script, /mediaCompatible/u)
  assert.match(script, /formatCompatible/u)
  assert.match(script, /dateCompatibility/u)
  assert.match(script, /not_confirmed_cross_source/u)
  assert.match(script, /cjk_latin_title_pair/u)
})

test('candidate rows remain human-review only', () => {
  assert.match(script, /kind:\s*'cross_language_rare_latin_token_review'/u)
  assert.match(script, /confidence:\s*'review'/u)
  assert.match(script, /ownerAdminConfirmationRequired:\s*true/u)
})

test('audit supports focused inspection for one title or token', () => {
  assert.match(script, /const focus = val\(args\.focus\)/u)
  assert.match(script, /JSON\.stringify\(row\)\.toLowerCase\(\)\.includes\(focus\)/u)
})
