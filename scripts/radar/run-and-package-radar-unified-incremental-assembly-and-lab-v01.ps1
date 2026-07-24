param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$OldAssemblyBundle,
  [Parameter(Mandatory = $true)][string]$Phase2Bundle,
  [Parameter(Mandatory = $true)][string]$PriorLabEvidenceBundle,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
$assemblyRunner = Join-Path $PSScriptRoot 'run-and-package-radar-unified-incremental-assembly-v01.ps1'
$labRunner = Join-Path $PSScriptRoot 'run-and-package-radar-unified-incremental-storage-lab-v01.ps1'

foreach ($item in @($assemblyRunner, $labRunner)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) {
    throw "缺少统一 assembly/lab runner：$item"
  }
}

$exports = Join-Path $repoRoot 'exports'
$before = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
Get-ChildItem `
  -LiteralPath $exports `
  -File `
  -Filter 'RADAR-UNIFIED-1804-INCREMENTAL-ASSEMBLY-*.zip' `
  -ErrorAction SilentlyContinue |
  ForEach-Object { $null = $before.Add($_.FullName) }

Write-Host ''
Write-Host '==> 构建 1,804 条统一增量 assembly' -ForegroundColor Cyan
& $assemblyRunner `
  -ExpectedBranchHead $ExpectedBranchHead `
  -OldAssemblyBundle $OldAssemblyBundle `
  -Phase2Bundle $Phase2Bundle `
  -PriorLabEvidenceBundle $PriorLabEvidenceBundle
if ($LASTEXITCODE -ne 0) {
  throw '统一 1,804 assembly runner 失败。'
}

$newAssemblies = @(
  Get-ChildItem `
    -LiteralPath $exports `
    -File `
    -Filter 'RADAR-UNIFIED-1804-INCREMENTAL-ASSEMBLY-*.zip' `
    -ErrorAction Stop |
  Where-Object { -not $before.Contains($_.FullName) } |
  Sort-Object LastWriteTimeUtc -Descending
)
if ($newAssemblies.Count -ne 1) {
  throw "预期恰好一个新统一 assembly ZIP，实际：$($newAssemblies.Count)"
}
$assemblyBundle = $newAssemblies[0].FullName
$assemblyHash = (
  Get-FileHash -LiteralPath $assemblyBundle -Algorithm SHA256
).Hash

Write-Host ''
Write-Host '==> 对完整 1,804 条执行隔离恢复库往返演练' -ForegroundColor Cyan
& $labRunner `
  -ExpectedBranchHead $ExpectedBranchHead `
  -AssemblyBundle $assemblyBundle `
  -ExpectedAssemblySHA256 $assemblyHash `
  -Confirm 'RUN-ISOLATED-RADAR-UNIFIED-1804-INCREMENTAL-STORAGE-LAB-V01' `
  -SourcePostgresContainer $SourcePostgresContainer `
  -SourceDatabase $SourceDatabase `
  -SourceDatabaseUser $SourceDatabaseUser `
  -ReadyTimeoutSeconds $ReadyTimeoutSeconds
if ($LASTEXITCODE -ne 0) {
  throw '统一 1,804 隔离 storage lab runner 失败。'
}

Write-Host ''
Write-Host '统一 assembly 与完整隔离往返演练均已完成～' -ForegroundColor Green
Write-Host "UnifiedAssemblyBundle       : $assemblyBundle"
Write-Host "UnifiedAssemblyBundleSHA256 : $assemblyHash"
Write-Host 'ProductionDatabaseWrite     : False'
Write-Host 'ProductionApplyAuthorized   : False'
