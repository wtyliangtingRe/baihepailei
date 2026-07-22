[CmdletBinding()]
param(
  [string]$TargetId = "3739",
  [string]$ServerUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedBranch = "agent/radar-direct-overwrite-unrelated-diff-forensics-v02"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$NodeScript = Join-Path $PSScriptRoot "inspect-ai-radar-direct-overwrite-failure-v03.mjs"
$TestFile = Join-Path $RepoRoot "tests\radar-direct-overwrite-failure-forensics-v03.test.mjs"
$ReportRoot = Join-Path $RepoRoot "data_local\outputs\ai-radar\forensics\direct-overwrite-failure-v03"
$CheckpointRoot = Join-Path $RepoRoot "data_local\outputs\ai-radar\checkpoints"
$ZipPath = Join-Path $CheckpointRoot "RADAR-FULL-COVERAGE-DIRECT-OVERWRITE-FAILURE-FORENSICS-v03.zip"

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Ensure-Credentials {
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_EMAIL)) {
    $env:RADAR_PAYLOAD_EMAIL = Read-Host "Payload 管理员邮箱"
  }
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_PASSWORD)) {
    $Secure = Read-Host "Payload 管理员密码" -AsSecureString
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
      $env:RADAR_PAYLOAD_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
    }
  }
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_EMAIL) -or
      [string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_PASSWORD)) {
    throw "Payload 凭据不能为空"
  }
}

$CurrentBranch = (git branch --show-current).Trim()
if ($CurrentBranch -ne $ExpectedBranch) {
  throw "v03 失败取证必须在 $ExpectedBranch 分支执行；当前为 $CurrentBranch"
}

foreach ($Required in @($NodeScript, $TestFile)) {
  if (-not (Test-Path -LiteralPath $Required)) {
    throw "缺少 v03 取证文件：$Required"
  }
}

New-Item -ItemType Directory -Path $ReportRoot -Force | Out-Null
New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null

$TestOutput = Join-Path $env:TEMP ("radar-direct-overwrite-failure-v03-tests-" + [guid]::NewGuid().ToString("N") + ".txt")
$Temp = $null
try {
  $TestLines = @(& node --test $TestFile 2>&1)
  $TestExit = $LASTEXITCODE
  $TestLines | ForEach-Object { Write-Host $_ }
  $TestLines | Set-Content -LiteralPath $TestOutput -Encoding UTF8
  if ($TestExit -ne 0) {
    throw "v03 失败取证回归测试失败"
  }

  Ensure-Credentials

  $BeforeReports = @(
    Get-ChildItem -LiteralPath $ReportRoot -File -Filter "*-work-$TargetId-direct-overwrite-diff-v03.json" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
  )

  & node `
    $NodeScript `
    --target-id $TargetId `
    --url $ServerUrl `
    --report-root $ReportRoot

  if ($LASTEXITCODE -ne 0) {
    throw "v03 direct-overwrite 只读取证脚本失败"
  }

  $ReportFile = Get-ChildItem -LiteralPath $ReportRoot -File -Filter "*-work-$TargetId-direct-overwrite-diff-v03.json" |
    Where-Object { $_.FullName -notin $BeforeReports } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

  if (-not $ReportFile) {
    throw "没有找到本次 v03 失败取证报告"
  }

  $Report = Get-Content -LiteralPath $ReportFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  $PatchCount = [int]$Report.diff.counts.patch
  $HumanCount = [int]$Report.diff.counts.human
  $VolatileCount = [int]$Report.diff.counts.volatile
  $UnrelatedCount = [int]$Report.diff.counts.unrelated
  $UnrelatedPaths = @($Report.diff.unrelatedChangedPaths | ForEach-Object { [string]$_.path })

  $Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-direct-overwrite-failure-v03-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $Temp | Out-Null

  Copy-Item -LiteralPath $ReportFile.FullName -Destination (Join-Path $Temp "direct-overwrite-failure-report-v03.json")
  Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $Temp "test-output.txt")

  $Manifest = [ordered]@{
    version = "ai-radar-direct-overwrite-failure-forensics-checkpoint-v0.3"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    gitCommit = (git rev-parse HEAD).Trim()
    targetId = $TargetId
    reportFile = "direct-overwrite-failure-report-v03.json"
    reportSha256 = Get-Sha256 $ReportFile.FullName
    evidenceSelectionKind = [string]$Report.evidenceSelection.selectionKind
    failureLedgerFound = [bool]$Report.evidenceSelection.failureLedgerFound
    targetLedgerEventFound = [bool]$Report.evidenceSelection.targetLedgerEventFound
    patchPresentInPublished = [bool]$Report.current.patchPresentInPublished
    baselineFound = [bool]$Report.baseline.found
    baselineMatchKind = [string]$Report.baseline.matchKind
    changedPathCounts = [ordered]@{
      patch = $PatchCount
      human = $HumanCount
      volatile = $VolatileCount
      unrelated = $UnrelatedCount
    }
    unrelatedChangedPaths = $UnrelatedPaths
    safety = [ordered]@{
      payloadLoginPostOnly = $true
      payloadRead = $true
      payloadDataMutation = $false
      payloadPatch = $false
      payloadRestoreVersion = $false
      directPostgresqlWrite = $false
    }
  }
  $Manifest | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath (Join-Path $Temp "checkpoint-manifest.json") -Encoding UTF8

  $SumLines = @()
  Get-ChildItem -LiteralPath $Temp -File | Sort-Object Name | ForEach-Object {
    $SumLines += "$(Get-Sha256 $_.FullName)  $($_.Name)"
  }
  $SumLines | Set-Content -LiteralPath (Join-Path $Temp "SHA256SUMS.txt") -Encoding UTF8

  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Compress-Archive -Path (Join-Path $Temp "*") -DestinationPath $ZipPath -CompressionLevel Optimal

  Write-Host ""
  Write-Host "ForensicsMode          : read-only" -ForegroundColor Green
  Write-Host "TargetId               : $TargetId"
  Write-Host "EvidenceSelectionKind  : $([string]$Report.evidenceSelection.selectionKind)"
  Write-Host "FailureLedgerFound     : $([bool]$Report.evidenceSelection.failureLedgerFound)"
  Write-Host "TargetLedgerEventFound : $([bool]$Report.evidenceSelection.targetLedgerEventFound)"
  Write-Host "PatchPresent           : $([bool]$Report.current.patchPresentInPublished)"
  Write-Host "BaselineFound          : $([bool]$Report.baseline.found)"
  Write-Host "BaselineMatchKind      : $([string]$Report.baseline.matchKind)"
  Write-Host "PatchChangedPaths      : $PatchCount"
  Write-Host "HumanChangedPaths      : $HumanCount"
  Write-Host "SystemChangedPaths     : $VolatileCount"
  Write-Host "UnrelatedChangedPaths  : $UnrelatedCount"
  Write-Host "UnrelatedPathList      : $(if ($UnrelatedPaths.Count) { $UnrelatedPaths -join ', ' } else { '(none)' })"
  Write-Host "PayloadDataMutation    : False"
  Write-Host "PayloadPatch           : False"
  Write-Host "PayloadRestoreVersion  : False"
  Write-Host "DirectPostgresqlWrite  : False"
  Write-Host "ForensicsZip           : $ZipPath"
  Write-Host "ForensicsZipSha256     : $(Get-Sha256 $ZipPath)"
}
finally {
  if ($Temp -and (Test-Path -LiteralPath $Temp)) {
    Remove-Item -LiteralPath $Temp -Recurse -Force
  }
  if (Test-Path -LiteralPath $TestOutput) {
    Remove-Item -LiteralPath $TestOutput -Force
  }
}
