param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$MigrationName = 'radar_public_conclusions_v01'
$AllowedLocalFiles = @('next-env.d.ts', 'payload-types.ts')

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Label 失败（退出码 $LASTEXITCODE）"
  }
}

function Get-UnexpectedDirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    if ($AllowedLocalFiles -contains $path) { continue }
    $paths += $path
  }
  return @($paths)
}

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

$unexpectedBefore = @(Get-UnexpectedDirtyPaths)
if ($unexpectedBefore.Count -gt 0) {
  $unexpectedBefore | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '发现预期之外的本地修改；未开始生成迁移。'
}

Invoke-Checked '获取远端分支' { git fetch origin }
Invoke-Checked '切换公共结论分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新提交' { git pull --ff-only origin $ExpectedBranch }

$branch = (git branch --show-current).Trim()
if ($branch -ne $ExpectedBranch) {
  throw "当前分支不符合预期：$branch"
}

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $remoteHead) {
  throw "本地 HEAD 未与远端分支对齐：local=$localHead remote=$remoteHead"
}

Invoke-Checked '运行公共结论与展示回归测试' {
  node --test `
    '.\tests\radar-public-conclusions.test.mjs' `
    '.\tests\radar-assessment-presentation.test.mjs'
}

Invoke-Checked '运行 TypeScript 静态检查' {
  pnpm exec tsc --noEmit
}

$beforeMigrationFiles = @(
  Get-ChildItem -LiteralPath '.\src\migrations' -File -Filter '*.ts' |
    Select-Object -ExpandProperty FullName
)

Invoke-Checked '只生成 Payload Postgres 迁移文件（不执行 migrate）' {
  pnpm payload migrate:create $MigrationName --skip-empty
}

$afterMigrationFiles = @(
  Get-ChildItem -LiteralPath '.\src\migrations' -File -Filter '*.ts' |
    Select-Object -ExpandProperty FullName
)
$newMigrationFiles = @(
  $afterMigrationFiles |
    Where-Object { $beforeMigrationFiles -notcontains $_ } |
    Where-Object { [System.IO.Path]::GetFileName($_) -ne 'index.ts' }
)

if ($newMigrationFiles.Count -ne 1) {
  $newMigrationFiles | ForEach-Object { Write-Host "generated: $_" -ForegroundColor Yellow }
  throw "预期只生成 1 个迁移文件，实际为 $($newMigrationFiles.Count) 个。"
}

$newMigration = $newMigrationFiles[0]
$newMigrationName = [System.IO.Path]::GetFileName($newMigration)
if ($newMigrationName -notmatch [regex]::Escape($MigrationName)) {
  throw "迁移文件名不包含预期名称：$newMigrationName"
}

$migrationSource = Get-Content -LiteralPath $newMigration -Raw -Encoding UTF8
$forbiddenPatterns = @(
  'ALTER TABLE\s+"(?:public"\.)?"works"',
  'DROP TABLE\s+"(?:public"\.)?"works"',
  'CREATE TABLE\s+"(?:public"\.)?"_works_v"',
  'ALTER TABLE\s+"(?:public"\.)?"_works_v"',
  'DROP TABLE\s+"(?:public"\.)?"_works_v"'
)
foreach ($pattern in $forbiddenPatterns) {
  if ($migrationSource -match $pattern) {
    throw "迁移触碰了禁止的 Works / Work versions 结构：$pattern"
  }
}

if ($migrationSource -notmatch 'radar_public_conclusions') {
  throw '生成的迁移没有包含 radar_public_conclusions 表结构。'
}

$changedPaths = @(
  git status --short |
    ForEach-Object {
      $path = ([string]$_).Substring(3).Trim()
      if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
      $path
    }
)

$allowedGenerated = @(
  'src/migrations/index.ts',
  ('src/migrations/' + $newMigrationName)
) + $AllowedLocalFiles

$unexpectedAfter = @($changedPaths | Where-Object { $allowedGenerated -notcontains $_ })
if ($unexpectedAfter.Count -gt 0) {
  $unexpectedAfter | ForEach-Object { Write-Host "unexpected generated change: $_" -ForegroundColor Yellow }
  throw '生成迁移后出现了预期之外的文件修改。'
}

Invoke-Checked '复跑公共结论与展示回归测试' {
  node --test `
    '.\tests\radar-public-conclusions.test.mjs' `
    '.\tests\radar-assessment-presentation.test.mjs'
}

Invoke-Checked '复跑 TypeScript 静态检查' {
  pnpm exec tsc --noEmit
}

Invoke-Checked '检查补丁空白与冲突标记' { git diff --check }

Write-Host ''
Write-Host '迁移文件已生成且未执行数据库迁移' -ForegroundColor Green
Write-Host "MigrationFile : $newMigration"
Write-Host 'DatabaseMigrate: False'
Write-Host 'WorksSchemaWrite: False'
Write-Host 'WorkDataWrite   : False'

if ($CommitAndPush) {
  Invoke-Checked '仅暂存迁移文件' {
    git add -- 'src/migrations/index.ts' ("src/migrations/$newMigrationName")
  }

  $staged = @(git diff --cached --name-only)
  $expectedStaged = @('src/migrations/index.ts', "src/migrations/$newMigrationName") | Sort-Object
  $actualStaged = @($staged | Sort-Object)
  if (($expectedStaged -join "`n") -ne ($actualStaged -join "`n")) {
    $actualStaged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
    throw '暂存区包含预期之外的文件；未提交。'
  }

  Invoke-Checked '提交生成的迁移' {
    git commit -m 'Add Radar public conclusions migration'
  }
  Invoke-Checked '推送迁移提交' {
    git push origin $ExpectedBranch
  }

  Write-Host ''
  Write-Host '迁移提交已推送' -ForegroundColor Green
  Write-Host "Head: $((git rev-parse HEAD).Trim())"
}
