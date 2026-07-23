import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v06.ps1')
const runner = fs.readFileSync(runnerPath, 'utf8')

test('direct progress runner passes the real PowerShell parser', () => {
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

test('real v03 runner executes directly in the current PowerShell process', () => {
  assert.match(runner, /\& \$innerRunner `\s*\n/u)
  assert.doesNotMatch(runner, /Start-Process[^\n]+\$innerRunner/iu)
  assert.match(runner, /真正任务将在当前终端直接运行/u)
})

test('masked credential input remains explicit and editable', () => {
  assert.match(runner, /需要 Payload 管理员密码/u)
  assert.match(runner, /\[Console\]::ReadKey\(\$true\)/u)
  assert.match(runner, /\[ConsoleKey\]::Backspace/u)
  assert.match(runner, /\[Console\]::Write\('\*'\)/u)
})

test('independent monitor reports node, port 3101, and output directory stages', () => {
  assert.match(runner, /Get-NetTCPConnection -LocalPort `\$port -State Listen/u)
  assert.match(runner, /radar-public-blocked-inventory-\*/u)
  assert.match(runner, /本机 3101 已监听/u)
  assert.match(runner, /正在执行测试、检查 Docker 或启动 Next/u)
  assert.match(runner, /正在读取或整理 API 数据/u)
  assert.match(runner, /-NoNewWindow/u)
})

test('password is inherited only through process environment and restored', () => {
  assert.match(runner, /SetEnvironmentVariable\('RADAR_PAYLOAD_PASSWORD', \$password, 'Process'\)/u)
  assert.match(runner, /SetEnvironmentVariable\('RADAR_PAYLOAD_PASSWORD', \$previousPassword, 'Process'\)/u)
  assert.match(runner, /\$password = \$null/u)
  assert.doesNotMatch(runner, /-Password\s+\$password|--password\s+\$password|ArgumentList[^\n]+\$password/iu)
})

test('direct runner forwards every locked v03 input and cleans the monitor', () => {
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
  assert.match(runner, /Stop-Process -Id \$monitor\.Id -Force/u)
  assert.match(runner, /Remove-Item -LiteralPath \$monitorScript/u)
})
