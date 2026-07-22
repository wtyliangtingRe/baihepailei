import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const shim = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/audit-canonical-work-identity-v02.ps1'),
  'utf8',
)
const wrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-canonical-work-identity-audit-v02.ps1'),
  'utf8',
)

test('v02 identity audit fixes the known PowerShell interpolation parser edge in a temporary copy', () => {
  assert.match(shim, /audit-canonical-work-identity-v01\.ps1/u)
  assert.match(shim, /\$Path:\$lineNumber/u)
  assert.match(shim, /\$\{Path\}:\$lineNumber/u)
  assert.match(shim, /GetTempPath/u)
  assert.match(shim, /Guid\]::NewGuid/u)
  assert.match(shim, /Remove-Item -LiteralPath \$temporary/u)
  assert.doesNotMatch(shim, /\bpayload\s+migrate\b/iu)
})

test('v02 identity wrapper remains read-only and packages only validated evidence', () => {
  assert.match(wrapper, /audit-canonical-work-identity-v02\.ps1/u)
  assert.match(wrapper, /build-canonical-work-identity-summary-v01\.mjs/u)
  assert.match(wrapper, /jsonValidated -ne \$true/u)
  assert.match(wrapper, /canonicalDecisionApplied -ne \$false/u)
  assert.match(wrapper, /mergePerformed -ne \$false/u)
  assert.match(wrapper, /DatabaseWrite\s+: False/u)
  assert.match(wrapper, /MergePerformed\s+: False/u)
  assert.doesNotMatch(wrapper, /(?m)^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/iu)
})
