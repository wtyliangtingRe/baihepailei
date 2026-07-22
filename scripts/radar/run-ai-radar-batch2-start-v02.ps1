param(
  [string]$CatalogManifest = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$PackageId = "RADAR-RESEARCH-0002-input-v01"
$OutputBase = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\batch2"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $OutputBase $PackageId))
$PackageZip = [System.IO.Path]::GetFullPath((Join-Path $OutputBase "$PackageId.zip"))

function Resolve-RepoPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  if ([System.IO.Path]::IsPathRooted($Value)) {
    return [System.IO.Path]::GetFullPath($Value)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}

function Assert-UnderDataLocal([string]$Value) {
  $Resolved = [System.IO.Path]::GetFullPath($Value)
  $Prefix = $DataLocal + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.Equals($DataLocal, [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $Resolved.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "路径必须位于 data_local：$Resolved"
  }
  return $Resolved
}

function To-RepoRelative([string]$Value) {
  $Resolved = Assert-UnderDataLocal (Resolve-RepoPath $Value)
  return [System.IO.Path]::GetRelativePath($RepoRoot, $Resolved).Replace("\", "/")
}

Write-Host "[portable 1/3] 调用第二批基础一键入口" -ForegroundColor Cyan
$BaseScript = Join-Path $PSScriptRoot "run-ai-radar-batch2-start-v01.ps1"
if ([string]::IsNullOrWhiteSpace($CatalogManifest)) {
  & $BaseScript
}
else {
  & $BaseScript -CatalogManifest $CatalogManifest
}
if ($LASTEXITCODE -ne 0) { throw "第二批基础输入包生成失败" }

Write-Host "[portable 2/3] 将 handoff 清单路径改为仓库相对路径" -ForegroundColor Cyan
$PackagedHandoffFile = Join-Path $PackageDir "handoff-manifest.json"
if (-not (Test-Path -LiteralPath $PackagedHandoffFile)) {
  throw "第二批包内 handoff-manifest.json 不存在：$PackagedHandoffFile"
}
$Handoff = Get-Content -LiteralPath $PackagedHandoffFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Handoff.batchId -ne "RADAR-RESEARCH-0002") { throw "第二批 handoff batchId 不匹配" }

$LocalHandoffDir = Assert-UnderDataLocal (Split-Path (Resolve-RepoPath ([string]$Handoff.copiedSourceFile)) -Parent)
$LocalHandoffFile = Join-Path $LocalHandoffDir "handoff-manifest.json"
if (-not (Test-Path -LiteralPath $LocalHandoffFile)) { throw "本地 handoff-manifest.json 不存在：$LocalHandoffFile" }

$Handoff.sourceCatalogManifest = To-RepoRelative ([string]$Handoff.sourceCatalogManifest)
$Handoff.sourceBatchFile = To-RepoRelative ([string]$Handoff.sourceBatchFile)
$Handoff.copiedSourceFile = To-RepoRelative (Join-Path $LocalHandoffDir ([System.IO.Path]::GetFileName([string]$Handoff.copiedSourceFile)))
foreach ($Chunk in @($Handoff.chunks)) {
  $Chunk.inputFile = To-RepoRelative (Join-Path $LocalHandoffDir ("chunks\" + [System.IO.Path]::GetFileName([string]$Chunk.inputFile)))
  $Chunk.responseFile = To-RepoRelative (Join-Path $LocalHandoffDir ("responses\" + [System.IO.Path]::GetFileName([string]$Chunk.responseFile)))
}
$Handoff.outputs.instructions = To-RepoRelative (Join-Path $LocalHandoffDir "RESEARCH_INSTRUCTIONS.md")
$Handoff.outputs.assembledRoot = To-RepoRelative (Join-Path $LocalHandoffDir "assembled")
$Handoff.outputs.summary = To-RepoRelative (Join-Path $LocalHandoffDir "handoff-summary.json")

$PortableJson = $Handoff | ConvertTo-Json -Depth 30
$PortableJson | Set-Content -LiteralPath $LocalHandoffFile -Encoding UTF8
$PortableJson | Set-Content -LiteralPath $PackagedHandoffFile -Encoding UTF8

$ReferenceFile = Join-Path $PackageDir "source-reference.json"
$Reference = Get-Content -LiteralPath $ReferenceFile -Raw -Encoding UTF8 | ConvertFrom-Json
$Reference.handoffDirectory = To-RepoRelative $LocalHandoffDir
$Reference.handoffManifestSha256 = (Get-FileHash -LiteralPath $LocalHandoffFile -Algorithm SHA256).Hash.ToLowerInvariant()
$Reference | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReferenceFile -Encoding UTF8

Write-Host "[portable 3/3] 重建包清单、SHA-256 与 ZIP" -ForegroundColor Cyan
$PackageManifestFile = Join-Path $PackageDir "package-manifest.json"
$PackageManifest = Get-Content -LiteralPath $PackageManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$Files = @(
  Get-ChildItem -LiteralPath $PackageDir -File -Recurse |
  Where-Object { $_.Name -notin @("SHA256SUMS.txt", "package-manifest.json") } |
  Sort-Object FullName |
  ForEach-Object {
    [ordered]@{
      path = [System.IO.Path]::GetRelativePath($PackageDir, $_.FullName).Replace("\", "/")
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      bytes = $_.Length
    }
  }
)
$PackageManifest.files = $Files
$PackageManifest.portability = [ordered]@{
  manifestPathsAreRepoRelative = $true
  fixedDrivePaths = 0
  generatedBy = "run-ai-radar-batch2-start-v02.ps1"
}
$PackageManifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $PackageManifestFile -Encoding UTF8

$HashLines = @()
Get-ChildItem -LiteralPath $PackageDir -File -Recurse |
  Where-Object Name -ne "SHA256SUMS.txt" |
  Sort-Object FullName |
  ForEach-Object {
    $Relative = [System.IO.Path]::GetRelativePath($PackageDir, $_.FullName).Replace("\", "/")
    $Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $HashLines += "$Hash  $Relative"
  }
$HashLines | Set-Content -LiteralPath (Join-Path $PackageDir "SHA256SUMS.txt") -Encoding UTF8

Remove-Item -LiteralPath $PackageZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $PackageDir "*") -DestinationPath $PackageZip -CompressionLevel Optimal
$PackageZipSha256 = (Get-FileHash -LiteralPath $PackageZip -Algorithm SHA256).Hash.ToLowerInvariant()

[pscustomobject]@{
  BatchId = $Handoff.batchId
  Rows = $Handoff.rowCount
  Chunks = $Handoff.chunkCount
  ManifestPathsAreRepoRelative = $true
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  UploadZip = $PackageZip
  UploadZipSha256 = $PackageZipSha256
} | Format-List
