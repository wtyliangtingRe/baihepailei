import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const finalizer = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/finalize-ai-radar-full-coverage-preflight-v01.ps1'),
  'utf8',
)
const wrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-ai-radar-full-coverage-publication-v02.ps1'),
  'utf8',
)

test('preflight finalizer keeps test log out of the return value', () => {
  assert.match(finalizer, /\$TestLines = @\(& node --test \$TestFile 2>&1\)/u)
  assert.match(finalizer, /\$TestLines \| ForEach-Object \{ Write-Host \$_ \}/u)
  assert.match(finalizer, /\$TestLines \| Set-Content -LiteralPath \$TestOutput/u)
  assert.doesNotMatch(finalizer, /Tee-Object -FilePath \$TestOutput/u)
})

test('v02 wrapper applies exactly the output-isolation repair', () => {
  assert.match(wrapper, /\$Occurrences -ne 1/u)
  assert.match(wrapper, /Tee-Object -FilePath \$TestOutput \| ForEach-Object \{ Write-Host \$_ \}/u)
  assert.match(wrapper, /\$Source\.Replace\(\$Needle, \$Replacement\)/u)
})

test('preflight finalizer reuses a paired existing plan and stays read-only', () => {
  assert.match(finalizer, /\$RunDir = Split-Path -Parent \$PlanSummaryFile/u)
  assert.match(finalizer, /\$PlanFile = Join-Path \$RunDir "publication-plan\.jsonl"/u)
  assert.match(finalizer, /payloadWrite = \$false/u)
  assert.match(finalizer, /humanAssessmentMutation = \$false/u)
  assert.match(finalizer, /wholeDraftPublication = \$false/u)
  assert.match(finalizer, /directPostgresqlWrite = \$false/u)
})
