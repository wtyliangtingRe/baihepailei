import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v05.ps1')
const runner = fs.readFileSync(runnerPath, 'utf8')

test('visible progress runner passes the real PowerShell parser', () => {
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

test('visible progress runner keeps masked interactive credential input', () => {
  assert.match(runner, /需要 Payload 管理员密码/u)
  assert.match(runner, /每个字符显示 \*/u)
  assert.match(runner, /\[Console\]::ReadKey\(\$true\)/u)
  assert.match(runner, /\[Console\]::Write\('\*'\)/u)
  assert.match(runner, /\[ConsoleKey\]::Backspace/u)
  assert.match(runner, /\[ConsoleKey\]::Escape/u)
})

test('child execution streams logs and emits stage heartbeats', () => {
  assert.match(runner, /RedirectStandardOutput \$stdoutPath/u)
  assert.match(runner, /RedirectStandardError \$stderrPath/u)
  assert.match(runner, /Write-NewLogLines/u)
  assert.match(runner, /\[运行状态 \{0\}s\]/u)
  assert.match(runner, /本机只读服务已监听；正在登录或分页读取 API/u)
  assert.match(runner, /正在读取\/整理 API 数据/u)
  assert.match(runner, /正在校验输入、检查 Docker或启动|正在校验输入、检查 Docker 或启动/u)
})

test('password stays process-only and child receives it only through inherited environment', () => {
  assert.match(runner, /SetEnvironmentVariable\('RADAR_PAYLOAD_PASSWORD', \$password, 'Process'\)/u)
  assert.match(runner, /SetEnvironmentVariable\('RADAR_PAYLOAD_PASSWORD', \$previousPassword, 'Process'\)/u)
  assert.match(runner, /\$password = \$null/u)
  assert.doesNotMatch(runner, /-Password\s+\$password|--password\s+\$password|ArgumentList[^\n]+\$password/iu)
  assert.doesNotMatch(runner, /WriteAllText\([^\n]+\$password/iu)
})

test('wrapper invokes reviewed v03 with locked inputs and kills the child tree on interruption', () => {
  assert.match(runner, /run-and-package-radar-public-blocked-inventory-v03\.ps1/u)
  assert.match(runner, /taskkill \/PID \$child\.Id \/T \/F/u)
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
  ]) assert.match(runner, new RegExp(`-${parameter}`))
})
