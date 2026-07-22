[CmdletBinding()]
param(
  [string]$TargetId = "3739",
  [string]$ServerUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$NodeScript = Join-Path $PSScriptRoot "inspect-ai-radar-roundtrip-failure-v01.mjs"
$ReportRoot = Join-Path $RepoRoot "data_local\outputs\ai-radar\forensics\roundtrip-failure-v01"
$CheckpointRoot = Join-Path $RepoRoot "data_local\outputs\ai-radar\checkpoints"
$ZipPath = Join-Path $CheckpointRoot "RADAR-FULL-COVERAGE-ROUNDTRIP-FAILURE-FORENSICS-v01.zip"

if (-not (Test-Path -LiteralPath $NodeScript)) {
  throw "找不到只读取证脚本：$NodeScript"
}

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

New-Item -ItemType Directory -Path $ReportRoot -Force | Out-Null
New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null

$BeforeReports = @(
  Get-ChildItem -LiteralPath $ReportRoot -File -Filter "*-work-$TargetId-roundtrip-forensics.json" -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty FullName
)

& node `
  $NodeScript `
  --target-id $TargetId `
  --url $ServerUrl `
  --report-root $ReportRoot

if ($LASTEXITCODE -ne 0) {
  throw "只读取证脚本失败"
}

$Report = Get-ChildItem -LiteralPath $ReportRoot -File -Filter "*-work-$TargetId-roundtrip-forensics.json" |
  Where-Object { $_.FullName -notin $BeforeReports } |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1

if (-not $Report) {
  throw "没有找到本次只读取证报告"
}

$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-roundtrip-forensics-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
  Copy-Item -LiteralPath $Report.FullName -Destination (Join-Path $Temp $Report.Name)

  $Manifest = [ordered]@{
    version = "ai-radar-roundtrip-failure-forensics-checkpoint-v0.1"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    gitCommit = (git rev-parse HEAD).Trim()
    targetId = $TargetId
    reportFile = $Report.Name
    reportSha256 = (Get-FileHash -LiteralPath $Report.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    safety = [ordered]@{
      payloadLoginPostOnly = $true
      payloadDataMutation = $false
      payloadPatch = $false
      payloadRestoreVersion = $false
      directPostgresqlWrite = $false
    }
  }
  $Manifest | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $Temp "checkpoint-manifest.json") -Encoding UTF8

  $Sums = @()
  Get-ChildItem -LiteralPath $Temp -File | Sort-Object Name | ForEach-Object {
    $Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $Sums += "$Hash  $($_.Name)"
  }
  $Sums | Set-Content -LiteralPath (Join-Path $Temp "SHA256SUMS.txt") -Encoding UTF8

  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Compress-Archive -Path (Join-Path $Temp "*") -DestinationPath $ZipPath -CompressionLevel Optimal
}
finally {
  if (Test-Path -LiteralPath $Temp) {
    Remove-Item -LiteralPath $Temp -Recurse -Force
  }
}

$ZipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ""
Write-Host "ForensicsMode          : read-only" -ForegroundColor Green
Write-Host "TargetId               : $TargetId"
Write-Host "PayloadDataMutation    : False"
Write-Host "PayloadPatch           : False"
Write-Host "PayloadRestoreVersion  : False"
Write-Host "DirectPostgresqlWrite  : False"
Write-Host "ForensicsZip           : $ZipPath"
Write-Host "ForensicsZipSha256     : $ZipHash"
