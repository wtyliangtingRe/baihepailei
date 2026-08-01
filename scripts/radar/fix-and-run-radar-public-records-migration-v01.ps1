param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-records-migration-v01'
$TargetPath = '.\scripts\radar\prepare-radar-public-records-migration-v01.ps1'
$AllowedDirty = @('next-env.d.ts', 'payload-types.ts')

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
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path.Replace('\\', '/')
  }
  return @($paths)
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repositoryRoot

Invoke-Checked '获取远端分支' { git fetch origin }
Invoke-Checked '切换迁移分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新提交' { git pull --ff-only origin $ExpectedBranch }

$unexpectedBefore = @(Get-DirtyPaths | Where-Object { $AllowedDirty -notcontains $_ })
if ($unexpectedBefore.Count -gt 0) {
  $unexpectedBefore | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '发现预期之外的本地修改；未应用修复。'
}

$source = (Get-Content -LiteralPath $TargetPath -Raw -Encoding UTF8).Replace("`r`n", "`n")
$cleanupLine = '  Remove-Item -LiteralPath $temporaryConfigPath -Force -ErrorAction SilentlyContinue'
$anchor = @'
  $afterMigrationRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
'@
$replacement = @'
  # Remove the repository-local temporary config before inspecting git status.
  # The config is an intentional generator input, not a migration artifact.
  Remove-Item -LiteralPath $temporaryConfigPath -Force -ErrorAction SilentlyContinue

  $afterMigrationRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
'@

$alreadyFixed = $source.Contains('# Remove the repository-local temporary config before inspecting git status.')
if (-not $alreadyFixed) {
  $anchorCount = ([regex]::Matches($source, [regex]::Escape($anchor.TrimStart("`n")))).Count
  if ($anchorCount -ne 1) {
    throw "无法唯一定位迁移生成后的检查锚点：$anchorCount"
  }
  $source = $source.Replace($anchor.TrimStart("`n"), $replacement.TrimStart("`n"))
  [System.IO.File]::WriteAllText($TargetPath, $source, [System.Text.UTF8Encoding]::new($false))
}

$written = Get-Content -LiteralPath $TargetPath -Raw -Encoding UTF8
$cleanupPosition = $written.IndexOf($cleanupLine, [System.StringComparison]::Ordinal)
$artifactPosition = $written.IndexOf('  $afterMigrationRepositoryArtifacts = @(', [System.StringComparison]::Ordinal)
$unexpectedPosition = $written.IndexOf('  $unexpectedAfter = @(', [System.StringComparison]::Ordinal)
if ($cleanupPosition -lt 0 -or $artifactPosition -lt 0 -or $unexpectedPosition -lt 0) {
  throw '修复后无法定位清理、迁移产物或意外文件检查。'
}
if ($cleanupPosition -gt $artifactPosition -or $cleanupPosition -gt $unexpectedPosition) {
  throw '临时配置清理仍发生在 git 状态检查之后。'
}

Invoke-Checked '解析修复后的 PowerShell 脚本' {
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $TargetPath),
    [ref]$null,
    [ref]$parseErrors
  ) | Out-Null
  if ($parseErrors.Count -gt 0) {
    $parseErrors | Format-List | Out-String | Write-Error
    exit 1
  }
}

if (-not $alreadyFixed) {
  Invoke-Checked '提交临时配置清理顺序修复' {
    git add -- $TargetPath
    git commit -m 'Fix Radar public records migration temp cleanup'
  }
  Invoke-Checked '推送迁移准备器修复' { git push origin $ExpectedBranch }
}

Write-Host ''
Write-Host '临时配置清理顺序已验证。现在重新运行迁移准备器。' -ForegroundColor Green

$arguments = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $TargetPath
)
if ($CommitAndPush) { $arguments += '-CommitAndPush' }

& pwsh @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Radar public records 迁移准备器失败（退出码 $LASTEXITCODE）。"
}
