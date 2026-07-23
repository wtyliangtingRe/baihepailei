import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const receiptBuilderPath = path.join(root, 'scripts/radar/build-radar-public-conclusions-production-apply-receipt-v01.mjs')
const runnerV01Path = path.join(root, 'scripts/radar/execute-radar-public-conclusions-production-apply-once-v01.ps1')
const runnerV02Path = path.join(root, 'scripts/radar/execute-radar-public-conclusions-production-apply-once-v02.ps1')
const receiptBuilder = fs.readFileSync(receiptBuilderPath, 'utf8')
const runnerV01 = fs.readFileSync(runnerV01Path, 'utf8')
const runnerV02 = fs.readFileSync(runnerV02Path, 'utf8')

test('receipt builder and both production runners pass their real parsers', () => {
  const nodeResult = spawnSync(process.execPath, ['--check', receiptBuilderPath], { cwd: root, encoding: 'utf8' })
  assert.equal(nodeResult.status, 0, nodeResult.stderr || nodeResult.stdout)
  for (const file of [runnerV01Path, runnerV02Path]) {
    const command = [
      '$tokens = $null;',
      '$errors = $null;',
      `[System.Management.Automation.Language.Parser]::ParseFile('${file.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null;`,
      'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
    ].join(' ')
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
})

test('production apply is bound to the accepted storage, lab, gate, SQL, and explicit phrase', () => {
  for (const text of [runnerV01, runnerV02]) {
    assert.match(text, /AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01/u)
    assert.match(text, /642E43B9CBAC02C75D2D473293C7B57B8B0197594262DFA96B065015E89C135E/u)
    assert.match(text, /EB3B1BCBE7B553471157BDED6B027F6850E3927AA9C1226AFFDC63B85EE69825/u)
    assert.match(text, /C0FBEC5B62C3FC45072B9F235C5DF5FEA7462F564226EA7FDD3CE9C723E0E2B5/u)
  }
  assert.match(runnerV01, /61F5673A2727D2FDE63590A1A74C2A26C5CFB2EACFA7AE27078F9CD999048DDA/u)
  assert.match(runnerV01, /B518CA4CA58F73C5CDDC9916C774B7BE5E8946F622E00388010F32066A1F4F6E/u)
  assert.match(runnerV01, /BA1CA326484611DD090FBA3CDC7566F13D1218CA2F75AED7B3FF308796C92170/u)
  assert.match(runnerV01, /24738E9C9510E2D6014D7211E16F0CF7E9D2C852D8B55FF3B839457E268B00BE/u)
})

test('v02 stages the exact fixed input path required by the reviewed SQL and removes it', () => {
  assert.match(runnerV02, /FixedContainerReadyPath = '\/tmp\/public-ai-storage-ready\.jsonl'/u)
  const copyIndex = runnerV02.indexOf('& docker cp $readyPath "${PostgresContainer}:$FixedContainerReadyPath"')
  const invokeIndex = runnerV02.indexOf('& $innerRunner @PSBoundParameters')
  const cleanupIndex = runnerV02.indexOf('& docker exec $PostgresContainer rm -f $FixedContainerReadyPath')
  assert.ok(copyIndex >= 0)
  assert.ok(invokeIndex > copyIndex)
  assert.ok(cleanupIndex > invokeIndex)
  assert.match(runnerV02, /test ! -e/u)
  assert.doesNotMatch(runnerV02, /\.Replace\(|Replace-Exact|WriteAllText\(\$innerRunner/u)
})

test('same-window fresh backup and full no-network rehearsal finish before production apply', () => {
  const backupIndex = runnerV01.indexOf('同窗口 production pg_dump')
  const noNetworkIndex = runnerV01.indexOf('--network none')
  const labApplyIndex = runnerV01.indexOf("'fresh-lab-apply'")
  const labRollbackIndex = runnerV01.indexOf("'fresh-lab-rollback'")
  const finalPreflightIndex = runnerV01.indexOf("'production-final-preflight'")
  const productionApplyIndex = runnerV01.indexOf("$productionApplyStdout = Join-Path $outDir 'production-apply-stdout.txt'")
  assert.ok(backupIndex >= 0)
  assert.ok(noNetworkIndex > backupIndex)
  assert.ok(labApplyIndex > noNetworkIndex)
  assert.ok(labRollbackIndex > labApplyIndex)
  assert.ok(finalPreflightIndex > labRollbackIndex)
  assert.ok(productionApplyIndex > finalPreflightIndex)
  assert.match(runnerV01, /freshWindowLabBaselineRestored = \$true/u)
})

test('writer isolation and zero-drift gates precede the production transaction', () => {
  assert.match(runnerV01, /docker stop -t 30/u)
  assert.match(runnerV01, /Assert-NoOtherClientSessions '维护窗口开始'/u)
  assert.match(runnerV01, /Compare-CountMaps \$gateBaseline/u)
  assert.match(runnerV01, /Production apply 前最终检查/u)
  assert.match(runnerV01, /productionRadarSchemaAbsent/u)
  assert.match(runnerV01, /productionRowsWritten -ne 0/u)
  assert.match(runnerV01, /writerContainersIntentionallyLeftPaused = \(\$applyCommitted -and -not \$allAccepted\)/u)
})

test('rollback remains lab-only and is never automatically authorized in production', () => {
  assert.match(runnerV01, /Invoke-PsqlFile \$labContainer[^\n]+\$rollbackPath/u)
  assert.doesNotMatch(runnerV01, /Invoke-PsqlFile \$PostgresContainer[^\n]+\$rollbackPath/u)
  assert.doesNotMatch(runnerV01, /AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-ROLLBACK-V01/u)
  assert.match(runnerV01, /rollbackAutomaticallyExecuted = \$false/u)
  assert.match(runnerV01, /productionRollbackAuthorized = \$false/u)
  assert.match(runnerV01, /RollbackAutomaticallyRun\s+: False/u)
})

test('production acceptance requires 22 checks and preserves all 83 existing tables', () => {
  assert.match(runnerV01, /production acceptance' 22/u)
  assert.match(runnerV01, /Assert-PostApplyCounts/u)
  assert.match(runnerV01, /public\.radar_public' = 9000/u)
  assert.match(runnerV01, /public\.radar_public_review_reasons' = 9000/u)
  assert.match(runnerV01, /public\.radar_public_radar_assessment_matched_rules' = 9077/u)
  assert.match(runnerV01, /public\.radar_public_radar_assessment_contradictions' = 0/u)
  assert.match(receiptBuilder, /EXPECTED_EXISTING_TABLES = 83/u)
  assert.match(receiptBuilder, /EXPECTED_ACCEPTANCE_NAMES = \[/u)
  assert.match(receiptBuilder, /productionPublicRowsWritten: EXPECTED_ROWS/u)
})

test('receipt excludes the full backup and records no Payload write or PR merge', () => {
  assert.match(receiptBuilder, /name !== 'database-backup\.dump'/u)
  assert.match(receiptBuilder, /payloadMigrationCommandExecuted: false/u)
  assert.match(receiptBuilder, /payloadWrite: false/u)
  assert.match(receiptBuilder, /prMergeAuthorized: false/u)
  assert.match(receiptBuilder, /rollbackAutomaticallyExecuted: false/u)
  assert.match(runnerV01, /Where-Object \{ \$_.Name -ne 'database-backup\.dump' \}/u)
  assert.doesNotMatch(runnerV01, /payload\s+migrate|payload\s+update|gh\s+pr\s+merge/iu)
})
