import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const builderPath = path.join(root, 'scripts/radar/build-radar-public-blocked-inventory-v01.mjs')
const finalizerPath = path.join(root, 'scripts/radar/finalize-radar-public-blocked-remediation-waves-v01.mjs')
const runnerV01Path = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v01.ps1')
const runnerV02Path = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v02.ps1')
const runnerV03Path = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v03.ps1')
const policyPath = path.join(root, 'docs/guides/radar-blocked-latest-valid-conflict-policy-v01.md')
const builder = fs.readFileSync(builderPath, 'utf8')
const finalizer = fs.readFileSync(finalizerPath, 'utf8')
const runnerV01 = fs.readFileSync(runnerV01Path, 'utf8')
const runnerV02 = fs.readFileSync(runnerV02Path, 'utf8')
const runnerV03 = fs.readFileSync(runnerV03Path, 'utf8')
const policy = fs.readFileSync(policyPath, 'utf8')

test('inventory builder, finalizer, and all runners pass their real parsers', () => {
  for (const file of [builderPath, finalizerPath]) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
  for (const runnerPath of [runnerV01Path, runnerV02Path, runnerV03Path]) {
    const escaped = runnerPath.replaceAll("'", "''")
    const command = [
      '$tokens = $null;',
      '$errors = $null;',
      `[System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors) | Out-Null;`,
      'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
    ].join(' ')
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
})

test('workflow is bound to the accepted 1805 blocked audit and successful 9000-row receipt', () => {
  assert.match(builder, /EXPECTED_AUDIT_ROWS = 10805/u)
  assert.match(builder, /EXPECTED_PUBLIC_BLOCKED = 1805/u)
  assert.match(builder, /EXPECTED_PRIVATE_BLOCKED = 1444/u)
  assert.match(builder, /EXPECTED_PUBLIC_CURRENT = 9000/u)
  assert.match(finalizer, /EXPECTED_ROWS = 1805/u)
  assert.match(finalizer, /EXPECTED_PUBLIC_CURRENT = 9000/u)
  for (const runner of [runnerV01, runnerV02, runnerV03]) {
    assert.match(runner, /7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA/u)
    assert.match(runner, /D1E8114371926C1CDA07D91DD2DB730180D5830ACF691D7CCC6F65DE84CBE6CA/u)
  }
})

test('latest alone never wins over validity, completeness, and identity', () => {
  assert.match(builder, /candidateValidity\(candidate, \{ discarded, identityResolved \}\)/u)
  assert.match(builder, /identity_not_resolved/u)
  assert.match(builder, /discarded_test_assessment/u)
  assert.match(builder, /missing_policy_version/u)
  assert.match(builder, /missing_assessment_batch/u)
  assert.match(builder, /missing_decisive_rule/u)
  assert.match(finalizer, /function completeValid/u)
  assert.match(finalizer, /snapshot\?\.sourceSummary/u)
  assert.match(finalizer, /latest_valid_complete/u)
  assert.match(finalizer, /currentSelection: 'latest_valid_complete_identity_resolved'/u)
  assert.match(policy, /“最新”不能单独凌驾于有效性、完整性和身份门槛之上/u)
})

test('candidate ties use assessedAt, policyVersion, assessmentBatch, and stable hash', () => {
  const assessedAtIndex = finalizer.indexOf('if (timeA !== timeB)')
  const policyIndex = finalizer.indexOf("compareNatural(a?.policyVersion")
  const batchIndex = finalizer.indexOf("compareNatural(a?.assessmentBatch")
  const hashIndex = finalizer.indexOf("candidateSha256).localeCompare")
  assert.ok(assessedAtIndex >= 0)
  assert.ok(policyIndex > assessedAtIndex)
  assert.ok(batchIndex > policyIndex)
  assert.ok(hashIndex > batchIndex)
  assert.match(finalizer, /tieBreakOrder: \['assessedAt', 'policyVersion', 'assessmentBatch', 'candidateSha256'\]/u)
})

test('history and conflicts are retained instead of field-residual merging', () => {
  assert.match(builder, /history,/u)
  assert.match(builder, /conflicts,/u)
  assert.match(builder, /supersessionCandidates/u)
  assert.match(builder, /retain_both_blocked_pending_resolution/u)
  assert.match(builder, /radar-public-blocked-conflict-ledger\.jsonl/u)
  assert.doesNotMatch(builder, /Object\.assign\([^\n]+radarAssessment|\.\.\.older\.snapshot,\s*\.\.\.newer\.snapshot/u)
  assert.match(finalizer, /wholeSnapshotReplacementRequired: true/u)
  assert.match(finalizer, /explicitNullClearsOldValue: true/u)
  assert.match(finalizer, /fieldResidualMergeForbidden: true/u)
  assert.match(finalizer, /historicalCandidatesPreserved: true/u)
  assert.match(policy, /新快照整体替换旧 AI 快照/u)
  assert.match(policy, /旧值必须清空/u)
})

test('decisive conflicts remain blocked for research or human adjudication', () => {
  assert.match(builder, /DECISIVE_FIELDS/u)
  assert.match(builder, /decisive_conflict_review/u)
  assert.match(builder, /C_human_adjudication/u)
  assert.match(builder, /补充来源或人工裁决/u)
  assert.match(builder, /publication_guard_review/u)
  assert.match(builder, /identity_review/u)
  assert.match(finalizer, /blocked_decisive_conflict/u)
  assert.match(finalizer, /decisiveConflictsRemainBlocked: true/u)
  assert.match(policy, /不以“时间较新”自动裁决事实真假/u)
})

test('inventory reads current draft, live, and public snapshots without writing', () => {
  assert.match(builder, /fetchCollection\(baseUrl, token, 'works', \{ draft: 'true' \}\)/u)
  assert.match(builder, /fetchCollection\(baseUrl, token, 'works', \{ draft: 'false' \}\)/u)
  assert.match(builder, /fetchCollection\(baseUrl, token, 'radar-public-conclusions'\)/u)
  assert.match(builder, /Blocked inventory is read-only/u)
  assert.match(runnerV01, /default_transaction_read_only=on/u)
  assert.match(runnerV01, /PAYLOAD_DB_PUSH = 'false'/u)
  assert.doesNotMatch(builder, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/u)
  assert.doesNotMatch(runnerV01, /payload\s+migrate|payload\s+update|production-apply\.sql/iu)
  assert.doesNotMatch(finalizer, /fetch\(|child_process|spawn\(|execFile\(|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/iu)
})

test('inventory and finalizer emit complete machine, review, conflict, and wave outputs', () => {
  for (const expected of [
    'radar-public-blocked-inventory.jsonl',
    'radar-public-blocked-inventory.csv',
    'radar-public-blocked-conflict-ledger.jsonl',
    'radar-public-blocked-lane-automatic-storage-repair.jsonl',
    'radar-public-blocked-lane-research.jsonl',
    'radar-public-blocked-lane-human-review.jsonl',
    'radar-public-blocked-lane-retained.jsonl',
    'radar-public-blocked-inventory-summary.json',
  ]) assert.match(builder, new RegExp(expected.replaceAll('.', '\\.')))
  for (const expected of [
    'radar-public-blocked-final-ledger.jsonl',
    'radar-public-blocked-final-conflicts.jsonl',
    'radar-public-blocked-wave-manifest.json',
    'radar-public-blocked-remediation-summary.json',
  ]) assert.match(finalizer, new RegExp(expected.replaceAll('.', '\\.')))
  assert.match(finalizer, /RADAR-BLOCKED-REMEDIATION-/u)
  assert.match(finalizer, /DEFAULT_WAVE_SIZE = 250/u)
  assert.match(runnerV03, /RADAR-PUBLIC-BLOCKED-REMEDIATION-/u)
})

test('v02 and v03 run real regression suites before their read-only work', () => {
  const v02TestIndex = runnerV02.indexOf('& node --test $testPath')
  const v02RunIndex = runnerV02.indexOf('& $innerRunner @PSBoundParameters')
  assert.ok(v02TestIndex >= 0)
  assert.ok(v02RunIndex > v02TestIndex)
  const v03TestIndex = runnerV03.indexOf('& node --test $testPath')
  const v03RunIndex = runnerV03.indexOf('& $innerRunner')
  const v03FinalizeIndex = runnerV03.indexOf('& node $finalizer')
  assert.ok(v03TestIndex >= 0)
  assert.ok(v03RunIndex > v03TestIndex)
  assert.ok(v03FinalizeIndex > v03RunIndex)
})

test('runner validates cardinality, stops the server, and grants no production capability', () => {
  assert.match(runnerV01, /summary\.inventory\.rows -ne 1805/u)
  assert.match(runnerV01, /summary\.inventory\.uniqueWorkIds -ne 1805/u)
  assert.match(runnerV01, /currentPublicConclusionsRead -ne 9000/u)
  assert.match(runnerV01, /Stop-ProcessTree/u)
  assert.match(runnerV01, /DedicatedAuditServer\s+: Stopped/u)
  assert.match(runnerV03, /productionDatabaseWrite -ne \$false/u)
  assert.match(runnerV03, /ProductionApplyAuthorized\s+: False/u)
  assert.doesNotMatch(runnerV03, /AUTHORIZE-PRODUCTION|psql|pg_dump|docker exec|payload\s+migrate/iu)
})

test('v03 rebuilds a recursive manifest and removes only its superseded intermediate ZIP after success', () => {
  assert.match(runnerV03, /Get-ChildItem -LiteralPath \$outDir -File -Recurse/u)
  assert.match(runnerV03, /sourceInventoryBundleSupersededByFinalBundle = \$true/u)
  const finalExistsIndex = runnerV03.indexOf("if (-not (Test-Path -LiteralPath $finalBundle")
  const removeIntermediateIndex = runnerV03.indexOf('Remove-Item -LiteralPath $inventoryBundle -Force')
  assert.ok(finalExistsIndex >= 0)
  assert.ok(removeIntermediateIndex > finalExistsIndex)
})
