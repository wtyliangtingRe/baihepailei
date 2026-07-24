import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v04.ps1')
const runner = fs.readFileSync(runnerPath, 'utf8')

test('masked prompt runner passes the real PowerShell parser', () => {
  const escaped = runnerPath.replaceAll("'", "''")
  const command = [
    '$tokens = $null;',
    '$errors = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors) | Out-Null;`,
    'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
  ].join(' ')
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('masked prompt is explicit, interactive, editable, and cancellable', () => {
  assert.match(runner, /需要 Payload 管理员密码/u)
  assert.match(runner, /每个字符显示 \*/u)
  assert.match(runner, /\[Console\]::ReadKey\(\$true\)/u)
  assert.match(runner, /\[ConsoleKey\]::Backspace/u)
  assert.match(runner, /\[ConsoleKey\]::Enter/u)
  assert.match(runner, /\[ConsoleKey\]::Escape/u)
  assert.match(runner, /\[ConsoleModifiers\]::Control/u)
  assert.match(runner, /\[Console\]::Write\('\*'\)/u)
})

test('credential is process-only, restored, and never put in a command argument', () => {
  assert.match(runner, /SetEnvironmentVariable\('RADAR_PAYLOAD_PASSWORD', \$password, 'Process'\)/u)
  assert.match(runner, /SetEnvironmentVariable\('RADAR_PAYLOAD_PASSWORD', \$previousPassword, 'Process'\)/u)
  assert.match(runner, /\$password = \$null/u)
  assert.doesNotMatch(runner, /-Password\s+\$password|--password\s+\$password|ArgumentList[^\n]+\$password/iu)
})

test('wrapper invokes the reviewed v03 runner with all locked inputs', () => {
  assert.match(runner, /run-and-package-radar-public-blocked-inventory-v03\.ps1/u)
  for (const parameter of [
    'ExpectedBranchHead',
    'AuditBundle',
    'ProductionReceiptBundle',
    'ExpectedAuditSHA256',
    'ExpectedProductionReceiptSHA256',
    'PostgresContainer',
    'Port',
    'ReadyTimeoutSeconds',
    'WaveSize',
  ]) assert.match(runner, new RegExp(`-${parameter} \\$${parameter}`))
})
