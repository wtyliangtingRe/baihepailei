$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-records-migration-v01'
$PreparerPath = '.\scripts\radar\prepare-radar-public-records-migration-v01.ps1'
$TestPath = '.\tests\radar-public-records-migration-preparation.test.mjs'
$AllowedLocalFiles = @('next-env.d.ts', 'payload-types.ts')
$ExpectedRepairFiles = @(
  'scripts/radar/prepare-radar-public-records-migration-v01.ps1',
  'tests/radar-public-records-migration-preparation.test.mjs'
)

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host ''
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Label 失败（退出码 $LASTEXITCODE）"
  }
}

function Get-DirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path.Replace('\', '/')
  }
  return @($paths)
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  [System.IO.File]::WriteAllText(
    $Path,
    $Content,
    [System.Text.UTF8Encoding]::new($false)
  )
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repositoryRoot

Invoke-Checked '获取远端续跑脚本' { git fetch origin }
Invoke-Checked '切换迁移分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新续跑脚本' { git pull --ff-only origin $ExpectedBranch }

$branch = (git branch --show-current).Trim()
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($branch -ne $ExpectedBranch -or $localHead -ne $remoteHead) {
  throw "分支或 HEAD 不符合预期：branch=$branch local=$localHead remote=$remoteHead"
}

$dirty = @(Get-DirtyPaths)
$unexpected = @(
  $dirty |
    Where-Object {
      $AllowedLocalFiles -notcontains $_ -and
      $ExpectedRepairFiles -notcontains $_
    }
)
if ($unexpected.Count -gt 0) {
  $unexpected | ForEach-Object {
    Write-Host "unexpected dirty: $_" -ForegroundColor Yellow
  }
  throw '存在预期之外的本地修改；未继续。'
}

$missingRepairFiles = @(
  $ExpectedRepairFiles |
    Where-Object { $dirty -notcontains $_ }
)
if ($missingRepairFiles.Count -gt 0) {
  $missingRepairFiles | ForEach-Object {
    Write-Host "missing expected repair change: $_" -ForegroundColor Yellow
  }
  throw '未发现上一轮应保留的修复修改；未继续。'
}

$preparer = (Get-Content -LiteralPath $PreparerPath -Raw -Encoding UTF8).Replace("`r`n", "`n")
$testSource = (Get-Content -LiteralPath $TestPath -Raw -Encoding UTF8).Replace("`r`n", "`n")

foreach ($marker in @(
  'does not classify its own temporary file as an external workspace change',
  "Remove-Item -LiteralPath `$temporaryConfigPath -Force -ErrorAction SilentlyContinue",
  "`$unexpectedAfter = @(Get-DirtyPaths"
)) {
  if (-not $preparer.Contains($marker)) {
    throw "迁移准备器缺少预期修复标记：$marker"
  }
}

$oldAssertion = "const finallyIndex = script.indexOf('} finally {')"
$newAssertion = "const finallyIndex = script.indexOf('} finally {', workspaceCheckIndex)"

if ($testSource.Contains($oldAssertion)) {
  $testSource = $testSource.Replace($oldAssertion, $newAssertion)
  Write-Utf8NoBom -Path $TestPath -Content $testSource
  Write-Host '已修正回归测试：从 workspace 检查之后查找最终 finally。' -ForegroundColor Green
}
elseif ($testSource.Contains($newAssertion)) {
  Write-Host '回归测试断言已修正，无需重复修改。' -ForegroundColor Green
}
else {
  throw '无法定位需要修正的 finally 断言。'
}

Invoke-Checked '解析迁移准备器' {
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $PreparerPath),
    [ref]$null,
    [ref]$parseErrors
  ) | Out-Null
  if ($parseErrors.Count -gt 0) {
    $parseErrors | Format-List | Out-String | Write-Error
    exit 1
  }
}

Invoke-Checked '运行修正后的迁移准备回归测试' {
  node --test `
    '.\tests\radar-public-release-v01.test.mjs' `
    '.\tests\radar-public-records-schema.test.mjs' `
    '.\tests\radar-public-release-plan-v01.test.mjs' `
    $TestPath
}
Invoke-Checked '检查修复补丁' { git diff --check }

Invoke-Checked '仅暂存迁移准备器与回归测试修复' {
  git add -- $ExpectedRepairFiles
}

$actualStaged = @(git diff --cached --name-only | Sort-Object)
$expectedStaged = @($ExpectedRepairFiles | Sort-Object)
if (($actualStaged -join "`n") -ne ($expectedStaged -join "`n")) {
  $actualStaged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
  throw '修复提交的暂存区包含预期之外的文件。'
}

Invoke-Checked '提交迁移准备器与测试修复' {
  git commit -m 'Fix Radar migration cleanup regression test'
}
Invoke-Checked '推送迁移准备器与测试修复' {
  git push origin $ExpectedBranch
}

Invoke-Checked '运行修复后的只读迁移准备器并推送生成结果' {
  pwsh `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $PreparerPath `
    -CommitAndPush
}

Write-Host ''
Write-Host '===== Migration preparation resume result =====' -ForegroundColor Green
Write-Host "Branch: $((git branch --show-current).Trim())"
Write-Host "Head  : $((git rev-parse HEAD).Trim())"
Write-Host 'DatabaseMigrate   : False'
Write-Host 'PayloadWrite      : False'
Write-Host 'WorksMutation     : False'
Write-Host 'PublicRecordWrite : False'

$unexpectedAfter = @(
  Get-DirtyPaths |
    Where-Object { $AllowedLocalFiles -notcontains $_ }
)
if ($unexpectedAfter.Count -gt 0) {
  $unexpectedAfter | ForEach-Object {
    Write-Host "unexpected final dirty: $_" -ForegroundColor Yellow
  }
  throw '续跑完成后存在预期之外的本地修改。'
}

Write-Host 'Result: accept_migration_preparation_after_test_fix' -ForegroundColor Green
