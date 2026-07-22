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
const forensicsNode = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/inspect-ai-radar-roundtrip-failure-v01.mjs'),
  'utf8',
)
const forensicsPowerShell = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/inspect-ai-radar-roundtrip-failure-v01.ps1'),
  'utf8',
)

test('preflight finalizer keeps test log out of the return value', () => {
  assert.match(finalizer, /\$TestLines = @\(& node --test \$TestFile 2>&1\)/u)
  assert.match(finalizer, /\$TestLines \| ForEach-Object \{ Write-Host \$_ \}/u)
  assert.match(finalizer, /\$TestLines \| Set-Content -LiteralPath \$TestOutput/u)
  assert.doesNotMatch(finalizer, /Tee-Object -FilePath \$TestOutput/u)
})

test('v02 wrapper applies exactly one output-isolation repair', () => {
  assert.match(wrapper, /\$OutputOccurrences -ne 1/u)
  assert.match(wrapper, /Tee-Object -FilePath \$TestOutput \| ForEach-Object \{ Write-Host \$_ \}/u)
  assert.match(wrapper, /\.Replace\(\$OutputNeedle, \$OutputReplacement\)/u)
})

test('v02 wrapper resolves the canonical DATABASE_URL before DATABASE_URI', () => {
  assert.match(wrapper, /\$Keys = @\('DATABASE_URL', 'DATABASE_URI'\)/u)
  assert.match(wrapper, /\.env\.development\.local/u)
  assert.match(wrapper, /\.env\.local/u)
  assert.match(wrapper, /\.env\.development/u)
  assert.match(wrapper, /\.env'/u)
  assert.match(wrapper, /\$env:DATABASE_URI = \$Database\.Value/u)
  assert.doesNotMatch(wrapper, /Write-Host.*\$Database\.Value/u)
})

test('v02 wrapper bridges pg_dump to the running Docker container', () => {
  assert.match(wrapper, /PostgresContainer = "baihepailei-postgres"/u)
  assert.match(wrapper, /Test-RunningContainer -Name \$PostgresContainer/u)
  assert.match(wrapper, /BAIHEPAILEI_PG_DUMP_CONTAINER/u)
  assert.match(wrapper, /Join-Path \$BackupScriptRoot 'pg_dump\.ps1'/u)
  assert.match(wrapper, /\$env:Path = "\$BackupScriptRoot;\$env:Path"/u)
})

test('v02 wrapper converts the legacy positional database argument to --dbname', () => {
  assert.match(wrapper, /\$PgDumpNeedle = '& pg_dump --format=custom --file=\$DumpFile \$env:DATABASE_URI'/u)
  assert.match(wrapper, /\$PgDumpReplacement = '& pg_dump --dbname=\$env:DATABASE_URI --format=custom --file=\$DumpFile'/u)
  assert.match(wrapper, /\$PgDumpOccurrences -ne 1/u)
  assert.match(wrapper, /\.Replace\(\$PgDumpNeedle, \$PgDumpReplacement\)/u)
})

test('v02 wrapper exposes a read-only backup probe', () => {
  assert.match(wrapper, /\[switch\]\$BackupProbe/u)
  assert.match(wrapper, /\$Execute -and \$BackupProbe/u)
  assert.match(wrapper, /if \(\$BackupProbe\)/u)
  assert.match(wrapper, /& pg_dump --dbname=\$env:DATABASE_URI --format=custom --file=\$ProbeFile/u)
  assert.match(wrapper, /BackupProbe\s+: passed/u)
  assert.match(wrapper, /PayloadWrite\s+: False/u)
  assert.match(wrapper, /DirectPostgresqlWrite\s+: False/u)
  assert.match(wrapper, /Remove-Item -LiteralPath \$ProbeFile -Force/u)
})

test('roundtrip forensics reads current state without Payload data mutation', () => {
  assert.match(forensicsNode, /readWork\(baseUrl, token, targetId, false\)/u)
  assert.match(forensicsNode, /readWork\(baseUrl, token, targetId, true\)/u)
  assert.match(forensicsNode, /readVersions\(baseUrl, token, targetId\)/u)
  assert.match(forensicsNode, /readResearch\(baseUrl, token, targetId\)/u)
  assert.match(forensicsNode, /payloadDataMutation: false/u)
  assert.match(forensicsNode, /payloadRestoreVersion: false/u)
  assert.doesNotMatch(forensicsNode, /method:\s*'PATCH'/u)
  assert.doesNotMatch(forensicsNode, /\/versions\/\$\{encodeURIComponent\([^)]*\)\}.*method:\s*'POST'/u)
})

test('roundtrip forensics wrapper creates a checksum-protected checkpoint', () => {
  assert.match(forensicsPowerShell, /RADAR-FULL-COVERAGE-ROUNDTRIP-FAILURE-FORENSICS-v01\.zip/u)
  assert.match(forensicsPowerShell, /PayloadDataMutation\s+: False/u)
  assert.match(forensicsPowerShell, /PayloadPatch\s+: False/u)
  assert.match(forensicsPowerShell, /PayloadRestoreVersion\s+: False/u)
  assert.match(forensicsPowerShell, /SHA256SUMS\.txt/u)
})

test('preflight finalizer reuses a paired existing plan and stays read-only', () => {
  assert.match(finalizer, /\$RunDir = Split-Path -Parent \$PlanSummaryFile/u)
  assert.match(finalizer, /\$PlanFile = Join-Path \$RunDir "publication-plan\.jsonl"/u)
  assert.match(finalizer, /payloadWrite = \$false/u)
  assert.match(finalizer, /humanAssessmentMutation = \$false/u)
  assert.match(finalizer, /wholeDraftPublication = \$false/u)
  assert.match(finalizer, /directPostgresqlWrite = \$false/u)
})
