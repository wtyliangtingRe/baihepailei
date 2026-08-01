param(
  [switch]$SkipMigrationRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-records-migration-v01'
$PreparerPath = '.\scripts\radar\prepare-radar-public-records-migration-v01.ps1'
$TestPath = '.\tests\radar-public-records-migration-preparation.test.mjs'
$AllowedLocalFiles = @('next-env.d.ts', 'payload-types.ts')

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

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repositoryRoot

Invoke-Checked '获取远端分支' { git fetch origin }
Invoke-Checked '切换迁移分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新修复脚本' { git pull --ff-only origin $ExpectedBranch }

$branch = (git branch --show-current).Trim()
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($branch -ne $ExpectedBranch -or $localHead -ne $remoteHead) {
  throw "分支或 HEAD 不符合预期：branch=$branch local=$localHead remote=$remoteHead"
}

$unexpectedBefore = @(
  Get-DirtyPaths |
    Where-Object { $AllowedLocalFiles -notcontains $_ }
)
if ($unexpectedBefore.Count -gt 0) {
  $unexpectedBefore | ForEach-Object {
    Write-Host "unexpected dirty: $_" -ForegroundColor Yellow
  }
  throw '存在预期之外的本地修改；未开始修复。'
}

Write-Host ''
Write-Host '==> 清理上次失败可能遗留的临时配置' -ForegroundColor Cyan
$staleTemporaryConfigs = @(
  Get-ChildItem -LiteralPath $repositoryRoot -File `
    -Filter '.payload-radar-public-records-temp-*.config.ts' `
    -ErrorAction SilentlyContinue
)
foreach ($file in $staleTemporaryConfigs) {
  Write-Host "remove stale temp config: $($file.Name)" -ForegroundColor Yellow
  Remove-Item -LiteralPath $file.FullName -Force
}

$preparer = (Get-Content -LiteralPath $PreparerPath -Raw -Encoding UTF8).Replace("`r`n", "`n")
$testSource = (Get-Content -LiteralPath $TestPath -Raw -Encoding UTF8).Replace("`r`n", "`n")

$cleanupMarker = @'
  # The isolated config lives inside the repository only because Payload needs a
  # loadable config path. Remove it before inspecting git status so the script
  # does not classify its own temporary file as an external workspace change.
  Remove-Item -LiteralPath $temporaryConfigPath -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $temporaryConfigPath) {
    throw '临时 Payload 配置未能在工作区检查前清理。'
  }

'@

$migrationArtifactsAnchor = @'
  $afterMigrationRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
'@

$fixAlreadyPresent = $preparer.Contains('does not classify its own temporary file as an external workspace change')
if (-not $fixAlreadyPresent) {
  $anchorCount = ([regex]::Matches(
    $preparer,
    [regex]::Escape($migrationArtifactsAnchor.TrimEnd("`r", "`n"))
  )).Count
  if ($anchorCount -ne 1) {
    throw "无法唯一定位迁移产物检查锚点：$anchorCount"
  }

  $preparer = $preparer.Replace(
    $migrationArtifactsAnchor,
    $cleanupMarker + $migrationArtifactsAnchor
  )
  Write-Utf8NoBom -Path $PreparerPath -Content $preparer
  Write-Host '已修复：临时配置现在会在 git 工作区检查前删除。' -ForegroundColor Green
} else {
  Write-Host '迁移准备器已经包含临时配置清理修复。' -ForegroundColor Green
}

$testMarker = "test('temporary Payload config is removed before workspace validation'"
if (-not $testSource.Contains($testMarker)) {
  $testAppend = @'

test('temporary Payload config is removed before workspace validation', () => {
  const cleanupMarker = 'does not classify its own temporary file as an external workspace change'
  const cleanupIndex = script.indexOf(cleanupMarker)
  const workspaceCheckIndex = script.indexOf('$unexpectedAfter =')
  const finallyIndex = script.indexOf('} finally {')

  assert.ok(cleanupIndex >= 0, 'missing pre-validation temporary config cleanup')
  assert.ok(workspaceCheckIndex > cleanupIndex, 'workspace validation runs before temporary config cleanup')
  assert.ok(finallyIndex > workspaceCheckIndex, 'fallback finally cleanup must remain after validation')
})
'@
  $testSource = $testSource.TrimEnd("`r", "`n") + $testAppend + "`n"
  Write-Utf8NoBom -Path $TestPath -Content $testSource
  Write-Host '已增加回归测试：禁止清理顺序再次倒退。' -ForegroundColor Green
} else {
  Write-Host '临时配置清理顺序回归测试已经存在。' -ForegroundColor Green
}

Invoke-Checked '解析 PowerShell 脚本' {
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

Invoke-Checked '运行迁移准备回归测试' {
  node --test `
    '.\tests\radar-public-release-v01.test.mjs' `
    '.\tests\radar-public-records-schema.test.mjs' `
    '.\tests\radar-public-release-plan-v01.test.mjs' `
    $TestPath
}
Invoke-Checked '检查修复补丁' { git diff --check }

$repairPaths = @(
  'scripts/radar/prepare-radar-public-records-migration-v01.ps1',
  'tests/radar-public-records-migration-preparation.test.mjs'
)
$changedRepairPaths = @(git diff --name-only -- $repairPaths)
if ($changedRepairPaths.Count -gt 0) {
  Invoke-Checked '仅暂存清理顺序修复与回归测试' {
    git add -- $repairPaths
  }

  $actualStaged = @(git diff --cached --name-only | Sort-Object)
  $expectedStaged = @($repairPaths | Sort-Object)
  if (($actualStaged -join "`n") -ne ($expectedStaged -join "`n")) {
    $actualStaged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
    throw '修复提交的暂存区包含预期之外的文件。'
  }

  Invoke-Checked '提交临时配置清理顺序修复' {
    git commit -m 'Fix Radar migration temp config cleanup'
  }
  Invoke-Checked '推送清理顺序修复' { git push origin $ExpectedBranch }
} else {
  Write-Host ''
  Write-Host '修复代码已在当前分支，无需重复提交。' -ForegroundColor Green
}

if ($SkipMigrationRun) {
  Write-Host ''
  Write-Host '诊断与修复完成；按请求跳过迁移准备器续跑。' -ForegroundColor Green
  exit 0
}

Invoke-Checked '运行修复后的只读迁移准备器并推送生成结果' {
  pwsh `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $PreparerPath `
    -CommitAndPush
}

Write-Host ''
Write-Host '===== Repair and migration preparation result =====' -ForegroundColor Green
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

Write-Host 'Result: accept_repaired_migration_preparation' -ForegroundColor Green
