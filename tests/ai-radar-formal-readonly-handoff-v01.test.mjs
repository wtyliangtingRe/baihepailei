import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import test from 'node:test'

const runnerFile = 'scripts/radar/run-ai-radar-formal-readonly-handoff-v01.ps1'
const source = fs.readFileSync(runnerFile, 'utf8')

test('formal handoff runner parses as valid PowerShell', () => {
  const command = [
    '$tokens = $null',
    '$errors = $null',
    `[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '${runnerFile}').Path, [ref]$tokens, [ref]$errors) | Out-Null`,
    "if (@($errors).Count -ne 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }",
  ].join('; ')

  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
  })

  assert.equal(
    result.status,
    0,
    [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n'),
  )
})

test('runner defaults to inspect and requires a separate exact export confirmation', () => {
  assert.match(source, /\[string\]\$Mode = 'Inspect'/u)
  assert.match(source, /EXPORT-FORMAL-AI-RADAR-READONLY-HANDOFF-V01/u)
  assert.match(source, /if \(\$Mode -eq 'Export' -and \$currentBranch -ne 'main'\)/u)
  assert.match(source, /if \(\$Confirmation -ne \$RequiredConfirmation\)/u)
})

test('runner is pinned to the formal loopback server and database topology', () => {
  assert.match(source, /\$FormalUrl = 'http:\/\/127\.0\.0\.1:3000'/u)
  assert.match(source, /\$MainDatabase = 'baihepailei'/u)
  assert.match(source, /\$ExpectedPublicTableCount = 83/u)
  assert.match(source, /\$MinimumExpectedFullCatalogWorks = 35000/u)
  assert.match(source, /\$mainConnectionsBefore = Get-DatabaseConnectionCount/u)
  assert.match(source, /\$mainConnectionsAfterRead = Get-DatabaseConnectionCount/u)
  assert.match(source, /if \(\$mainConnectionsAfterRead -lt 1\)/u)
  assert.match(source, /-Port 3000/u)
})

test('runner prompts securely and never passes a password argument', () => {
  assert.match(source, /Read-Host 'Payload administrator password \(input hidden\)' -AsSecureString/u)
  assert.match(source, /Env:RADAR_PAYLOAD_PASSWORD/u)
  assert.match(source, /Env:RADAR_PAYLOAD_EMAIL/u)
  assert.doesNotMatch(source, /--password/u)
  assert.doesNotMatch(source, /--email/u)
})

test('runner delegates only the read-only catalog and handoff preparation pipeline', () => {
  assert.match(source, /run-ai-radar-full-catalog-preparation-v01\.mjs/u)
  assert.match(source, /prepare-ai-radar-assessment-handoff-v01\.mjs/u)
  assert.match(source, /build-ai-radar-input-v01\.mjs/u)
  assert.match(source, /\[int\]\$AssessmentHandoffBatchLimit = 1/u)
  assert.match(source, /ready_for_ai_assessment/u)
  assert.doesNotMatch(source, /run-ai-radar-v06-batch-execute-once/u)
  assert.doesNotMatch(source, /run-ai-radar-execute-once/u)
})

test('runner only uses read-only SQL and rejects unexpected local state', () => {
  assert.match(source, /SELECT count\(\*\) FROM pg_stat_activity/u)
  assert.match(source, /SELECT count\(\*\) FROM pg_tables/u)
  assert.match(source, /Unexpected local changes are present/u)
  assert.doesNotMatch(source, /\bINSERT\s+INTO\b/iu)
  assert.doesNotMatch(source, /\bUPDATE\s+[a-z_]/iu)
  assert.doesNotMatch(source, /\bDELETE\s+FROM\b/iu)
  assert.doesNotMatch(source, /\bDROP\s+(DATABASE|TABLE)\b/iu)
  assert.doesNotMatch(source, /\bCREATE\s+(DATABASE|TABLE)\b/iu)
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b/iu)
  assert.doesNotMatch(source, /\bTRUNCATE\b/iu)
  assert.doesNotMatch(source, /\bpg_restore\b/u)
})

test('runner writes a hashed upload plan under data_local with explicit no-write safety', () => {
  assert.match(source, /formal-readonly-handoff-v01/u)
  assert.match(source, /UPLOAD_PLAN\.md/u)
  assert.match(source, /formal-readonly-handoff-summary-v01\.json/u)
  assert.match(source, /batchManifestSha256/u)
  assert.match(source, /payloadWrite = \$false/u)
  assert.match(source, /payloadPatchRequests = 0/u)
  assert.match(source, /directPostgresqlWrite = \$false/u)
  assert.match(source, /publishesRatings = \$false/u)
  assert.match(source, /existingRankNotTreatedAsGroundTruth = \$true/u)
})

test('runner warms Payload before requiring a database connection', () => {
  const inspectReadIndex = source.indexOf(
    "-FailureMessage 'Formal read-only inspect failed.'",
  )
  const afterReadConnectionIndex = source.indexOf(
    '$mainConnectionsAfterRead = Get-DatabaseConnectionCount',
  )
  const afterReadGuardIndex = source.indexOf(
    'if ($mainConnectionsAfterRead -lt 1)',
  )

  assert.ok(inspectReadIndex >= 0)
  assert.ok(afterReadConnectionIndex > inspectReadIndex)
  assert.ok(afterReadGuardIndex > afterReadConnectionIndex)

  const beforeInspectRead = source.slice(0, inspectReadIndex)

  assert.doesNotMatch(
    beforeInspectRead,
    /if \(\$mainConnections(?:Before)? -lt 1\)/u,
  )
})

test('runner accepts an empty ready-for-assessment package collection', () => {
  const functionStart = source.indexOf('function Write-UploadPlan')
  const functionEnd = source.indexOf(
    '\nAssert-IntegerRange',
    functionStart,
  )

  assert.ok(functionStart >= 0)
  assert.ok(functionEnd > functionStart)

  const functionSource = source.slice(functionStart, functionEnd)

  assert.match(
    functionSource,
    /\[AllowEmptyCollection\(\)\]\s*\n\s*\[object\[\]\]\$Packages/u,
  )
  assert.match(
    functionSource,
    /if \(\$Packages\.Count -eq 0\)/u,
  )
  assert.match(
    functionSource,
    /当前没有 ready_for_ai_assessment 批次/u,
  )
})
