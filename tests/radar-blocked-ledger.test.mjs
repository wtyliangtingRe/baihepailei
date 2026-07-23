import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const builderPath = path.join(root, 'scripts/radar/build-radar-blocked-ledger-v01.mjs')
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-blocked-ledger-v01.ps1')
const policyPath = path.join(root, 'docs/guides/radar-blocked-latest-valid-conflict-policy-v01.md')
const builder = fs.readFileSync(builderPath, 'utf8')
const runner = fs.readFileSync(runnerPath, 'utf8')
const policy = fs.readFileSync(policyPath, 'utf8')

test('builder and runner pass their real parsers', () => {
  const nodeResult = spawnSync(process.execPath, ['--check', builderPath], { cwd: root, encoding: 'utf8' })
  assert.equal(nodeResult.status, 0, nodeResult.stderr || nodeResult.stdout)
  const command = [
    '$tokens = $null;',
    '$errors = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${runnerPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null;`,
    'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
  ].join(' ')
  const psResult = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
  assert.equal(psResult.status, 0, psResult.stderr || psResult.stdout)
})

test('workflow is bound to the accepted final audit and exact blocked files', () => {
  assert.match(builder, /7877020d0314352531290be0d4e334d2b17e18e6f552591dd14e30431f7837ba/u)
  assert.match(builder, /4017846c1fe5f72fc7389f3f07b7402af3d0a4ad5889d7bb314907a0b920bd8c/u)
  assert.match(builder, /74ee4db765a6e613efe4cf824594a57b43a484a201d0a56e66dc7ae20fb9b7c5/u)
  assert.match(builder, /EXPECTED_PUBLIC_BLOCKED = 1805/u)
  assert.match(builder, /EXPECTED_PRIVATE_BLOCKED = 1444/u)
  assert.match(runner, /PublicBlockedRows\s+: 1805/u)
  assert.match(runner, /PrivateBlockedRows\s+: 1444/u)
})

test('latest selection requires a valid complete snapshot and whole-record replacement', () => {
  assert.match(builder, /latest_valid_complete_snapshot/u)
  assert.match(builder, /latest_valid_complete_snapshot_whole_record_replace/u)
  assert.match(builder, /explicitNullClearsOldValue: true/u)
  assert.match(builder, /oldFieldsNeverMergedBackIntoCurrent: true/u)
  assert.match(builder, /historyPreserved: true/u)
  assert.match(builder, /unresolvedConflictBlocksPublicReady: true/u)
  assert.match(policy, /新快照整体替换旧 AI 快照/u)
  assert.match(policy, /旧值必须清空/u)
  assert.match(policy, /不会覆盖[\s\S]*较旧但有效完整的 current/u)
})

test('decisive conflicts are retained and cannot become public ready automatically', () => {
  assert.match(builder, /public_release_conflict_or_guard/u)
  assert.match(builder, /private_public_conclusion_hash_disagreement/u)
  assert.match(builder, /latest_candidate_preserved_but_conflict_unresolved/u)
  assert.match(builder, /conflictQueue/u)
  assert.match(policy, /不以“时间较新”自动裁决事实真假/u)
  assert.match(policy, /两方证据都写入 contradictions/u)
  assert.match(policy, /状态保持 blocked/u)
})

test('discarded test assessments require fresh research and cannot be remapped', () => {
  assert.match(builder, /discarded_test_assessment_requires_fresh_research/u)
  assert.match(builder, /fresh_research_required/u)
  assert.match(builder, /discard old test assessment and perform fresh research/u)
  assert.match(policy, /永远不能通过改 Work ID、改标题或 remap 重新成为 current/u)
})

test('ledger preserves complete source rows and deterministic wave receipts', () => {
  assert.match(builder, /sourceRows: \{/u)
  assert.match(builder, /sourceRowSha256/u)
  assert.match(builder, /radar-blocked-ledger-all\.jsonl/u)
  assert.match(builder, /radar-blocked-wave-manifest\.json/u)
  assert.match(builder, /RADAR-BLOCKED-REMEDIATION-/u)
  assert.match(builder, /DEFAULT_WAVE_SIZE = 250/u)
  assert.match(runner, /WaveSize = 250/u)
})

test('the first phase cannot write Payload or PostgreSQL or authorize production', () => {
  assert.match(builder, /payloadWrite: false/u)
  assert.match(builder, /directPostgresqlWrite: false/u)
  assert.match(builder, /productionDatabaseWrite: false/u)
  assert.match(builder, /productionApplyAuthorized: false/u)
  assert.doesNotMatch(builder, /child_process|spawn\(|exec\(|fetch\(|postgres|\bpg\b|payload/iu)
  assert.doesNotMatch(runner, /docker exec|psql|pg_dump|payload\s+migrate|AUTHORIZE-PRODUCTION/iu)
})

test('runner packages real files rather than a literal wildcard path', () => {
  assert.match(runner, /Get-ChildItem -LiteralPath \$outDir -Force/u)
  assert.doesNotMatch(runner, /Copy-Item -LiteralPath \(Join-Path \$outDir '\*'\)/u)
})
