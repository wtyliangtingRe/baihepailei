import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const RUNNER = 'scripts/radar/run-ai-radar-wave5-deferred-remediation-8183-start-v01.ps1'
const runner = fs.readFileSync(RUNNER, 'utf8')

test('Wave 5 runner is bound to the verified package and source chain', () => {
  assert.match(runner, /RADAR-WAVE5-DEFERRED-REMEDIATION-8183-input-v01/u)
  assert.match(runner, /9d0f9f6002681b3851d1aaa3da9970af03396d222cfc1015cf4ee42f9e2c9be3/u)
  assert.match(runner, /eeebc2474a98e0c5e89348aabb8ceb1f038a076da0b46c16b827a40daf158ec6/u)
  assert.match(runner, /2785e46bedb587abd27a61fff91e7b717f03c983a0c384885efa1245cf032490/u)
})

test('Wave 5 runner validates all fixed task, subwave and chunk counts', () => {
  assert.match(runner, /\$ExpectedResearchRows = 8183/u)
  assert.match(runner, /\$ExpectedPolicyResolvedRows = 3/u)
  assert.match(runner, /\$ExpectedSubwaves = 33/u)
  assert.match(runner, /\$ExpectedFullSubwaves = 32/u)
  assert.match(runner, /\$ExpectedFinalSubwaveRows = 183/u)
  assert.match(runner, /\$ExpectedChunks = 1637/u)
  assert.match(runner, /\$ExpectedFinalSubwaveChunks = 37/u)
})

test('Wave 5 runner validates priority queue partitions', () => {
  assert.match(runner, /\$ExpectedNewDeferredRows = 2/u)
  assert.match(runner, /\$ExpectedRuleConflictRows = 1/u)
  assert.match(runner, /\$ExpectedRouteReviewRows = 32/u)
  assert.match(runner, /\$ExpectedEvidenceRefreshRows = 8148/u)
  assert.match(runner, /new_assessment_targeted_refresh/u)
  assert.match(runner, /rule_conflict_plus_family_relationship_review/u)
  assert.match(runner, /route_structure_review/u)
  assert.match(runner, /targeted_evidence_refresh/u)
})

test('Wave 5 runner validates nested hashes, identities and recoverability', () => {
  assert.match(runner, /SHA256SUMS\.txt/u)
  assert.match(runner, /manifestSha256/u)
  assert.match(runner, /sourceSha256/u)
  assert.match(runner, /Chunk SHA-256 mismatch/u)
  assert.match(runner, /HashSet\[string\]/u)
  assert.match(runner, /Cross-file duplicate identity/u)
})

test('Wave 5 runner keeps ABO policy resolutions separate and local-only', () => {
  assert.match(runner, /abo-grade-prefix-resolutions-v01\.jsonl/u)
  assert.match(runner, /resolvedGrade -ne "D"/u)
  assert.match(runner, /D-ABO/u)
  assert.match(runner, /publicationStatus -ne "do_not_publish"/u)
  assert.match(runner, /PayloadWrite = \$false/u)
  assert.match(runner, /DirectPostgresqlWrite = \$false/u)
  assert.doesNotMatch(runner, /payload\.update|payload\.create|UPDATE\s+works|INSERT\s+INTO/iu)
  assert.doesNotMatch(runner, /[A-Za-z]:\\/u)
})
