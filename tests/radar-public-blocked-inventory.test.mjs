import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const builderPath = path.join(root, 'scripts/radar/build-radar-public-blocked-inventory-v01.mjs')
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v01.ps1')
const builder = fs.readFileSync(builderPath, 'utf8')
const runner = fs.readFileSync(runnerPath, 'utf8')

test('blocked inventory builder and runner pass their real parsers', () => {
  const nodeResult = spawnSync(process.execPath, ['--check', builderPath], { cwd: root, encoding: 'utf8' })
  assert.equal(nodeResult.status, 0, nodeResult.stderr || nodeResult.stdout)
  const escaped = runnerPath.replaceAll("'", "''")
  const command = [
    '$tokens = $null;',
    '$errors = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors) | Out-Null;`,
    'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
  ].join(' ')
  const psResult = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
  assert.equal(psResult.status, 0, psResult.stderr || psResult.stdout)
})

test('workflow is bound to the accepted 1805 blocked audit and successful 9000-row receipt', () => {
  assert.match(builder, /EXPECTED_AUDIT_ROWS = 10805/u)
  assert.match(builder, /EXPECTED_PUBLIC_BLOCKED = 1805/u)
  assert.match(builder, /EXPECTED_PRIVATE_BLOCKED = 1444/u)
  assert.match(builder, /EXPECTED_PUBLIC_CURRENT = 9000/u)
  assert.match(runner, /7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA/u)
  assert.match(runner, /D1E8114371926C1CDA07D91DD2DB730180D5830ACF691D7CCC6F65DE84CBE6CA/u)
})

test('latest alone never wins over validity and identity', () => {
  assert.match(builder, /candidateValidity\(candidate, \{ discarded, identityResolved \}\)/u)
  assert.match(builder, /const structurallyValid = history\.filter/u)
  assert.match(builder, /const selectedCandidate = structurallyValid\.at\(-1\) \|\| history\.at\(-1\)/u)
  assert.match(builder, /identity_not_resolved/u)
  assert.match(builder, /discarded_test_assessment/u)
  assert.match(builder, /missing_policy_version/u)
  assert.match(builder, /missing_assessment_batch/u)
  assert.match(builder, /missing_decisive_rule/u)
})

test('history and conflicts are retained instead of field-residual merging', () => {
  assert.match(builder, /history,/u)
  assert.match(builder, /conflicts,/u)
  assert.match(builder, /supersessionCandidates/u)
  assert.match(builder, /retain_both_blocked_pending_resolution/u)
  assert.match(builder, /radar-public-blocked-conflict-ledger\.jsonl/u)
  assert.doesNotMatch(builder, /Object\.assign\([^\n]+radarAssessment|\.\.\.older\.snapshot,\s*\.\.\.newer\.snapshot/u)
})

test('decisive conflicts remain blocked for research or human adjudication', () => {
  assert.match(builder, /DECISIVE_FIELDS/u)
  assert.match(builder, /decisive_conflict_review/u)
  assert.match(builder, /C_human_adjudication/u)
  assert.match(builder, /补充来源或人工裁决/u)
  assert.match(builder, /publication_guard_review/u)
  assert.match(builder, /identity_review/u)
})

test('inventory reads current draft, live, and public snapshots without writing', () => {
  assert.match(builder, /fetchCollection\(baseUrl, token, 'works', \{ draft: 'true' \}\)/u)
  assert.match(builder, /fetchCollection\(baseUrl, token, 'works', \{ draft: 'false' \}\)/u)
  assert.match(builder, /fetchCollection\(baseUrl, token, 'radar-public-conclusions'\)/u)
  assert.match(builder, /Blocked inventory is read-only/u)
  assert.match(runner, /default_transaction_read_only=on/u)
  assert.match(runner, /PAYLOAD_DB_PUSH = 'false'/u)
  assert.doesNotMatch(builder, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/u)
  assert.doesNotMatch(runner, /payload\s+migrate|payload\s+update|production-apply\.sql/iu)
})

test('inventory emits machine, human-readable, lane, conflict, and manifest outputs', () => {
  for (const expected of [
    'radar-public-blocked-inventory.jsonl',
    'radar-public-blocked-inventory.csv',
    'radar-public-blocked-conflict-ledger.jsonl',
    'radar-public-blocked-lane-automatic-storage-repair.jsonl',
    'radar-public-blocked-lane-research.jsonl',
    'radar-public-blocked-lane-human-review.jsonl',
    'radar-public-blocked-lane-retained.jsonl',
    'radar-public-blocked-inventory-summary.json',
    'manifest.json',
  ]) assert.match(builder, new RegExp(expected.replaceAll('.', '\\.')))
  assert.match(runner, /RADAR-PUBLIC-BLOCKED-INVENTORY-/u)
})

test('runner validates cardinality and stops the dedicated audit server', () => {
  assert.match(runner, /summary\.inventory\.rows -ne 1805/u)
  assert.match(runner, /summary\.inventory\.uniqueWorkIds -ne 1805/u)
  assert.match(runner, /currentPublicConclusionsRead -ne 9000/u)
  assert.match(runner, /Stop-ProcessTree/u)
  assert.match(runner, /DedicatedAuditServer\s+: Stopped/u)
  assert.match(runner, /ProductionApplyAuthorized\s+: False/u)
})
