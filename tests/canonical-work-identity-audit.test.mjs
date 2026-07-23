import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const audit = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/audit-canonical-work-identity-v01.ps1'),
  'utf8',
)
const builder = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/build-canonical-work-identity-summary-v01.mjs'),
  'utf8',
)
const wrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-canonical-work-identity-audit-v01.ps1'),
  'utf8',
)

test('canonical identity database audit is UTF-8 safe and database-read-only', () => {
  assert.match(audit, /default_transaction_read_only=on/u)
  assert.match(audit, /PGCLIENTENCODING=UTF8/u)
  assert.match(audit, /convert_to\(payload\.json_text, 'UTF8'\)/u)
  assert.match(audit, /FromBase64String/u)
  assert.match(audit, /ConvertFrom-Json -Depth 100 -ErrorAction Stop/u)
  assert.match(audit, /canonical-identity-review-alerts\.jsonl/u)
  assert.match(audit, /sourceDryRunManifestValidated = \$true/u)
  assert.doesNotMatch(audit, /\bpayload\s+migrate\b/iu)
  assert.doesNotMatch(audit, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/imu)
})

test('identity summary never chooses or applies a canonical Work automatically', () => {
  assert.match(builder, /canonicalWorkId: null/u)
  assert.match(builder, /manual_full_identity_review_required/u)
  assert.match(builder, /canonicalDecisionApplied: false/u)
  assert.match(builder, /mergePerformed: false/u)
  assert.match(builder, /Newer timestamp alone is insufficient/u)
})

test('one-command identity wrapper validates artifacts and remains fail-closed', () => {
  assert.match(wrapper, /audit-canonical-work-identity-v01\.ps1/u)
  assert.match(wrapper, /build-canonical-work-identity-summary-v01\.mjs/u)
  assert.match(wrapper, /canonicalDecisionApplied -ne \$false/u)
  assert.match(wrapper, /mergePerformed -ne \$false/u)
  assert.match(wrapper, /Compress-Archive/u)
  assert.match(wrapper, /-LiteralPath \$paths/u)
  assert.match(wrapper, /DatabaseWrite\s+: False/u)
  assert.match(wrapper, /MergePerformed\s+: False/u)
  assert.doesNotMatch(wrapper, /\bpayload\s+migrate\b/iu)
})
