$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-records-migration-v01'
$RecoverableGeneratedFiles = @('.env.example', 'payload.config.ts')
$AllowedLocalFiles = @('next-env.d.ts', 'payload-types.ts')
$RepairRunner = '.\scripts\radar\repair-and-run-radar-public-records-migration-v01.ps1'

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

function Normalize-Text {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)

  return $Text.Replace("`r`n", "`n").Replace("`r", "`n")
}

function Get-HeadFileText {
  param([Parameter(Mandatory = $true)][string]$Path)

  $temporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) (
    'baihepailei-head-file-' + [guid]::NewGuid().ToString('N') + '.tmp'
  )

  try {
    cmd /d /c "git show HEAD:$Path > `"$temporaryFile`""
    if ($LASTEXITCODE -ne 0) {
      throw "无法读取 HEAD 中的文件：$Path"
    }
    return Normalize-Text -Text (Get-Content -LiteralPath $temporaryFile -Raw -Encoding UTF8)
  }
  finally {
    Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
  }
}

function Test-RecoverableGeneratedFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $workingText = Normalize-Text -Text (Get-Content -LiteralPath $Path -Raw -Encoding UTF8)
  $headText = Get-HeadFileText -Path $Path

  if ($workingText -ceq $headText) {
    Write-Host "$Path 仅有行尾或编码形式差异，可安全恢复。" -ForegroundColor Green
    return $true
  }

  if ($Path -eq 'payload.config.ts') {
    $requiredMarkers = @(
      'RadarPublicRecords',
      'RADAR_PUBLIC_RECORDS_SCHEMA_READY',
      'RadarPublicRecordsWithAudit',
      'radarPublicRecordsSchemaReady ? [RadarPublicRecordsWithAudit]'
    )
    $missing = @($requiredMarkers | Where-Object { -not $workingText.Contains($_) })
    if ($missing.Count -eq 0) {
      Write-Host 'payload.config.ts 包含完整的已知迁移生成配置，可备份后恢复。' -ForegroundColor Green
      return $true
    }

    $missing | ForEach-Object {
      Write-Host "missing generated marker: $_" -ForegroundColor Yellow
    }
    return $false
  }

  if ($Path -eq '.env.example') {
    if ($workingText.Contains('RADAR_PUBLIC_RECORDS_SCHEMA_READY=true')) {
      Write-Host '.env.example 包含已知迁移环境说明，可备份后恢复。' -ForegroundColor Green
      return $true
    }
    return $false
  }

  return $false
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repositoryRoot

Invoke-Checked '获取远端恢复脚本' { git fetch origin }
Invoke-Checked '切换迁移分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新恢复脚本' { git pull --ff-only origin $ExpectedBranch }

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
      $RecoverableGeneratedFiles -notcontains $_
    }
)
if ($unexpected.Count -gt 0) {
  $unexpected | ForEach-Object {
    Write-Host "unexpected dirty: $_" -ForegroundColor Yellow
  }
  throw '除已知失败遗留文件外仍有本地修改；未自动恢复。'
}

$generatedDirty = @(
  $dirty | Where-Object { $RecoverableGeneratedFiles -contains $_ }
)
if ($generatedDirty.Count -gt 0) {
  foreach ($path in $generatedDirty) {
    if (-not (Test-RecoverableGeneratedFile -Path $path)) {
      throw "$path 含有无法归因于迁移失败的语义改动；未自动恢复。"
    }
  }

  $backupRoot = Join-Path `
    $repositoryRoot `
    ('data_local\backups\radar-public-records-migration-v01\failed-config-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

  foreach ($path in $generatedDirty) {
    $safeName = $path.Replace('/', '_').Replace('\', '_')
    $patchPath = Join-Path $backupRoot ($safeName + '.patch')
    $contentPath = Join-Path $backupRoot ($safeName + '.working-copy')

    git diff --binary -- $path | Set-Content -LiteralPath $patchPath -Encoding UTF8
    Copy-Item -LiteralPath $path -Destination $contentPath -Force
    Write-Host "backup: $path -> $backupRoot" -ForegroundColor Yellow
  }

  Invoke-Checked '恢复上次失败遗留的配置文件' {
    git restore --worktree -- $generatedDirty
  }
}
else {
  Write-Host ''
  Write-Host '没有检测到上次失败遗留的配置文件。' -ForegroundColor Green
}

$remainingUnexpected = @(
  Get-DirtyPaths |
    Where-Object { $AllowedLocalFiles -notcontains $_ }
)
if ($remainingUnexpected.Count -gt 0) {
  $remainingUnexpected | ForEach-Object {
    Write-Host "remaining dirty: $_" -ForegroundColor Yellow
  }
  throw '恢复后仍存在预期之外的本地修改。'
}

if (-not (Test-Path -LiteralPath $RepairRunner)) {
  throw "缺少修复续跑器：$RepairRunner"
}

Invoke-Checked '运行修复与只读迁移准备续跑器' {
  pwsh `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $RepairRunner
}

Write-Host ''
Write-Host '===== Failed migration recovery result =====' -ForegroundColor Green
Write-Host "Branch: $((git branch --show-current).Trim())"
Write-Host "Head  : $((git rev-parse HEAD).Trim())"
Write-Host 'DatabaseMigrate   : False'
Write-Host 'PayloadWrite      : False'
Write-Host 'WorksMutation     : False'
Write-Host 'PublicRecordWrite : False'
Write-Host 'Result: accept_failed_migration_recovery' -ForegroundColor Green
