import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const v01Path = path.join(repoRoot, 'scripts/radar/build-test-work-merge-transaction-review-v01.mjs')
const v02Path = path.join(repoRoot, 'scripts/radar/build-test-work-merge-transaction-review-v02.mjs')
const wrapperPath = path.join(repoRoot, 'scripts/radar/run-and-package-test-work-merge-transaction-review-v01.ps1')

const v01 = fs.readFileSync(v01Path, 'utf8')
const v02 = fs.readFileSync(v02Path, 'utf8')
const wrapper = fs.readFileSync(wrapperPath, 'utf8')

function transactionTempFiles() {
  return new Set(
    fs.readdirSync(os.tmpdir())
      .filter((name) => name.startsWith('build-test-work-merge-transaction-review-v02-')),
  )
}

test('transaction review generators parse and the v02 fail-closed patch reaches normal argument validation', () => {
  for (const file of [v01Path, v02Path]) {
    const check = spawnSync(process.execPath, ['--check', file], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    assert.equal(check.status, 0, check.stderr || check.stdout)
  }

  const before = transactionTempFiles()
  const result = spawnSync(process.execPath, [v02Path], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const after = transactionTempFiles()

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /Required: --identity-audit-dir/u)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Expected \d+ occurrence\(s\), found/u)
  assert.deepEqual(after, before)
})

test('v02 fixes PL/pgSQL diagnostics and guards skipped and preserved relation rows exactly', () => {
  assert.match(v02, /fileURLToPath\(import\.meta\.url\)/u)
  assert.match(v02, /count_mismatch actual_count=%/u)
  assert.match(v02, /update_count affected=%/u)
  assert.match(v02, /delete_count affected=%/u)
  assert.match(v02, /insert_count affected=%/u)
  assert.match(v02, /const preservedRows = \[\]/u)
  assert.match(v02, /acceptance_unchanged:/u)
  assert.match(v02, /acceptance_preserved:/u)
  assert.match(v02, /rollback_guard_unchanged:/u)
  assert.match(v02, /rollback_guard_preserved:/u)
  assert.match(v02, /node', \['--check', temporary\]/u)
  assert.match(v02, /fs\.rmSync\(temporary, \{ force: true \}\)/u)
})

test('transaction SQL is review-only, backup-bound, serializable, guarded, and reversible', () => {
  assert.match(v01, /Verified backup SHA-256/u)
  assert.match(v01, /BEGIN ISOLATION LEVEL SERIALIZABLE;/u)
  assert.match(v01, /SET LOCAL lock_timeout/u)
  assert.match(v01, /FOR UPDATE/u)
  assert.match(v01, /DO \$exact_before\$/u)
  assert.match(v01, /DO \$acceptance\$/u)
  assert.match(v01, /DO \$rollback_guard\$/u)
  assert.match(v01, /DO \$rollback_acceptance\$/u)
  assert.match(v01, /merge-transaction\.sql\.disabled/u)
  assert.match(v01, /merge-rollback\.sql\.disabled/u)
  assert.match(v01, /repositoryExecutionWrapperExists: false/u)
  assert.match(v01, /executeWrapperGenerated: false/u)
  assert.match(v01, /hardDeleteWorkPlanned: false/u)
  assert.match(v01, /versionRewritePlanned: false/u)
  assert.match(v01, /mergedduplicateworkids:/u)
  assert.doesNotMatch(v01, /docker\s+exec/u)
  assert.doesNotMatch(v01, /DATABASE_URL/u)
  assert.doesNotMatch(v01, /\bpsql\b/u)
})

test('PowerShell wrapper packages evidence but contains no database execution path', () => {
  assert.match(wrapper, /build-test-work-merge-transaction-review-v02\.mjs/u)
  assert.match(wrapper, /build-test-work-merge-transaction-review-v01\.mjs/u)
  assert.match(wrapper, /ExecutableSQLText\s+: True/u)
  assert.match(wrapper, /DisabledExtension\s+: True/u)
  assert.match(wrapper, /ExecuteWrapperGenerated\s+: False/u)
  assert.match(wrapper, /ExplicitApprovalReceived\s+: False/u)
  assert.match(wrapper, /DatabaseWrite\s+: False/u)
  assert.match(wrapper, /MergePerformed\s+: False/u)
  assert.match(wrapper, /exactBeforeRows -lt 45/u)
  assert.doesNotMatch(wrapper, /Get-Content[^\n]+UTF8,/u)
  assert.doesNotMatch(wrapper, /docker\s+exec/u)
  assert.doesNotMatch(wrapper, /Invoke-Sqlcmd/u)
  assert.doesNotMatch(wrapper, /DATABASE_URL/u)
})
