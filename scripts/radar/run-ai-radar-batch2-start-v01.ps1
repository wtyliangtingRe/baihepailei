param(
  [string]$CatalogManifest = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$BatchId = "RADAR-RESEARCH-0002"
$BatchSlug = "radar-research-0002"
$PackageId = "RADAR-RESEARCH-0002-input-v01"
$ExpectedRows = 100
$ChunkSize = 5
$ExpectedChunks = 20
$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$StagingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "staging\ai-radar"))
$OutputBase = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\batch2"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $OutputBase $PackageId))
$PackageZip = [System.IO.Path]::GetFullPath((Join-Path $OutputBase "$PackageId.zip"))

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

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

function Get-ValidCatalogCandidate([System.IO.FileInfo]$File) {
  try {
    $Manifest = Get-Content -LiteralPath $File.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $Entry = @($Manifest.batches | Where-Object {
      $_.batchId -eq $BatchId -and $_.queue -eq "external_research"
    })
    if ($Entry.Count -ne 1) { return $null }

    $SourceFile = Assert-UnderDataLocal (Resolve-RepoPath ([string]$Entry[0].file))
    if (-not (Test-Path -LiteralPath $SourceFile)) { return $null }
    $ExpectedSha = ([string]$Entry[0].sha256).ToLowerInvariant()
    $ActualSha = (Get-FileHash -LiteralPath $SourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($ExpectedSha) -or $ActualSha -ne $ExpectedSha) { return $null }
    if ([int]$Entry[0].rowCount -ne $ExpectedRows) { return $null }

    $GeneratedAt = [datetimeoffset]::MinValue
    if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.generatedAt)) {
      [datetimeoffset]::TryParse([string]$Manifest.generatedAt, [ref]$GeneratedAt) | Out-Null
    }

    return [pscustomobject]@{
      ManifestFile = $File
      Manifest = $Manifest
      Entry = $Entry[0]
      SourceFile = $SourceFile
      SourceSha256 = $ActualSha
      GeneratedAt = $GeneratedAt
      LastWriteTimeUtc = $File.LastWriteTimeUtc
    }
  }
  catch {
    return $null
  }
}

Write-Host "[1/5] 定位并核验第二批正式只读目录清单" -ForegroundColor Cyan

$Candidates = @()
if (-not [string]::IsNullOrWhiteSpace($CatalogManifest)) {
  $Explicit = Resolve-RepoPath $CatalogManifest
  if (-not (Test-Path -LiteralPath $Explicit)) { throw "目录清单不存在：$Explicit" }
  $Candidate = Get-ValidCatalogCandidate (Get-Item -LiteralPath $Explicit)
  if ($null -eq $Candidate) { throw "指定清单不包含有效的 $BatchId，或源文件 SHA-256 不匹配" }
  $Candidates = @($Candidate)
}
else {
  if (-not (Test-Path -LiteralPath $StagingRoot)) { throw "AI Radar staging 根目录不存在：$StagingRoot" }
  Get-ChildItem -LiteralPath $StagingRoot -Filter "catalog-batch-manifest-v01.json" -File -Recurse | ForEach-Object {
    $Candidate = Get-ValidCatalogCandidate $_
    if ($null -ne $Candidate) { $Candidates += $Candidate }
  }
}

if ($Candidates.Count -eq 0) {
  throw "找不到同时满足 batchId=$BatchId、100 条和源文件 SHA-256 匹配的目录清单"
}

$Selected = $Candidates |
  Sort-Object GeneratedAt, LastWriteTimeUtc -Descending |
  Select-Object -First 1

$CatalogManifestFile = Assert-UnderDataLocal $Selected.ManifestFile.FullName
$QueueDir = $Selected.ManifestFile.Directory.FullName
$CatalogDir = Split-Path $QueueDir -Parent
$ExportRoot = Assert-UnderDataLocal (Split-Path $CatalogDir -Parent)
$ResearchRoot = Assert-UnderDataLocal (Join-Path $ExportRoot "research-handoffs-v01")
$HandoffDir = Assert-UnderDataLocal (Join-Path $ResearchRoot $BatchSlug)
$HandoffManifestFile = Assert-UnderDataLocal (Join-Path $HandoffDir "handoff-manifest.json")

[pscustomobject]@{
  CatalogManifest = [System.IO.Path]::GetRelativePath($RepoRoot, $CatalogManifestFile)
  SourceBatchFile = [System.IO.Path]::GetRelativePath($RepoRoot, $Selected.SourceFile)
  SourceBatchSha256 = $Selected.SourceSha256
  ExportRoot = [System.IO.Path]::GetRelativePath($RepoRoot, $ExportRoot)
} | Format-List

Write-Host "[2/5] 生成第二批 100 条外部研究交接包" -ForegroundColor Cyan
node ".\scripts\radar\prepare-ai-radar-research-handoff-v01.mjs" `
  --batch-id $BatchId `
  --manifest $CatalogManifestFile `
  --out-dir $ResearchRoot `
  --chunk-size $ChunkSize
Assert-LastExitCode "第二批外部研究交接包生成失败"

if (-not (Test-Path -LiteralPath $HandoffManifestFile)) {
  throw "第二批 handoff-manifest.json 未生成：$HandoffManifestFile"
}

$Handoff = Get-Content -LiteralPath $HandoffManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Handoff.batchId -ne $BatchId) { throw "第二批 handoff batchId 不匹配" }
if ($Handoff.queue -ne "external_research") { throw "第二批 handoff queue 不正确" }
if ([int]$Handoff.rowCount -ne $ExpectedRows) { throw "预期 $ExpectedRows 条，实际 $($Handoff.rowCount) 条" }
if ([int]$Handoff.chunkSize -ne $ChunkSize) { throw "预期 chunkSize=$ChunkSize，实际 $($Handoff.chunkSize)" }
if ([int]$Handoff.chunkCount -ne $ExpectedChunks) { throw "预期 $ExpectedChunks 个块，实际 $($Handoff.chunkCount) 个" }
if ($Handoff.safety.payloadWrite -ne $false -or
    $Handoff.safety.directPostgresqlWrite -ne $false -or
    $Handoff.safety.modifiesWorks -ne $false) {
  throw "第二批 handoff 安全声明不符合只读要求"
}

foreach ($Chunk in @($Handoff.chunks)) {
  $InputFile = Assert-UnderDataLocal (Resolve-RepoPath ([string]$Chunk.inputFile))
  if (-not $InputFile.StartsWith($HandoffDir + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "研究块路径逃逸 handoff 目录：$InputFile"
  }
  if (-not (Test-Path -LiteralPath $InputFile)) { throw "研究块不存在：$InputFile" }
  $Actual = (Get-FileHash -LiteralPath $InputFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne ([string]$Chunk.inputSha256).ToLowerInvariant()) {
    throw "研究块 SHA-256 不匹配：$InputFile"
  }
}

Write-Host "[3/5] 运行研究、校准、AI QA 与第二批入口测试" -ForegroundColor Cyan
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
$TestOutput = Join-Path $PackageDir "test-output.txt"
& node --test `
  ".\tests\radar-research-handoff.test.mjs" `
  ".\tests\radar-calibration-profile.test.mjs" `
  ".\tests\radar-ai-qa-pipeline.test.mjs" `
  ".\tests\radar-batch2-kickoff.test.mjs" 2>&1 | Tee-Object -FilePath $TestOutput
Assert-LastExitCode "第二批开始前测试失败"

Write-Host "[4/5] 生成唯一需要上传的第二批输入 ZIP" -ForegroundColor Cyan
$PackageChunks = Join-Path $PackageDir "chunks"
New-Item -ItemType Directory -Path $PackageChunks -Force | Out-Null
Copy-Item -LiteralPath $HandoffManifestFile -Destination (Join-Path $PackageDir "handoff-manifest.json") -Force
Copy-Item -LiteralPath (Join-Path $HandoffDir "handoff-summary.json") -Destination (Join-Path $PackageDir "handoff-summary.json") -Force
Copy-Item -LiteralPath (Join-Path $HandoffDir "RESEARCH_INSTRUCTIONS.md") -Destination (Join-Path $PackageDir "RESEARCH_INSTRUCTIONS.md") -Force
Copy-Item -LiteralPath (Join-Path $HandoffDir "$BatchSlug.source.jsonl") -Destination (Join-Path $PackageDir "$BatchSlug.source.jsonl") -Force
Get-ChildItem -LiteralPath (Join-Path $HandoffDir "chunks") -Filter "*.input.jsonl" -File |
  Sort-Object Name |
  Copy-Item -Destination $PackageChunks -Force

$Reference = [ordered]@{
  version = "ai-radar-batch2-input-reference-v0.1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  batchId = $BatchId
  sourceCatalogManifest = [System.IO.Path]::GetRelativePath($RepoRoot, $CatalogManifestFile).Replace("\", "/")
  sourceCatalogInputSha256 = [string]$Handoff.sourceCatalogInputSha256
  sourceBatchFile = [System.IO.Path]::GetRelativePath($RepoRoot, $Selected.SourceFile).Replace("\", "/")
  sourceBatchSha256 = $Selected.SourceSha256
  handoffDirectory = [System.IO.Path]::GetRelativePath($RepoRoot, $HandoffDir).Replace("\", "/")
  handoffManifestSha256 = (Get-FileHash -LiteralPath $HandoffManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
}
$Reference | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PackageDir "source-reference.json") -Encoding UTF8

$FilesBeforeManifest = @(
  Get-ChildItem -LiteralPath $PackageDir -File -Recurse |
  Sort-Object FullName |
  ForEach-Object {
    [ordered]@{
      path = [System.IO.Path]::GetRelativePath($PackageDir, $_.FullName).Replace("\", "/")
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      bytes = $_.Length
    }
  }
)

$PackageManifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  version = "ai-radar-batch2-input-package-v0.1"
  packageId = $PackageId
  batchId = $BatchId
  queue = "external_research"
  rowCount = $ExpectedRows
  chunkSize = $ChunkSize
  chunkCount = $ExpectedChunks
  files = $FilesBeforeManifest
  requestedCompletion = [ordered]@{
    mode = "single_assistant_pass"
    returnPackage = "RADAR-RESEARCH-0002-complete-results-v01.zip"
    stages = @(
      "external_research",
      "research_assembly",
      "calibrated_ai_assessment",
      "ai_qa",
      "targeted_defer_partition"
    )
    humanTrackMutations = 0
  }
  safety = [ordered]@{
    payloadRead = $false
    payloadWrite = $false
    directPostgresqlWrite = $false
    modifiesWorks = $false
    publishesRatings = $false
    onlyLocalArtifacts = $true
    humanTrackMutations = 0
  }
  nextStep = "Upload this ZIP to ChatGPT. Do not manually extract or upload individual chunks."
}
$PackageManifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $PackageDir "package-manifest.json") -Encoding UTF8

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

New-Item -ItemType Directory -Path $OutputBase -Force | Out-Null
Remove-Item -LiteralPath $PackageZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $PackageDir "*") -DestinationPath $PackageZip -CompressionLevel Optimal
$PackageZipSha256 = (Get-FileHash -LiteralPath $PackageZip -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "[5/5] 第二批输入包完成" -ForegroundColor Cyan
[pscustomobject]@{
  BatchId = $BatchId
  Rows = $ExpectedRows
  ChunkSize = $ChunkSize
  Chunks = $ExpectedChunks
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  UploadZip = $PackageZip
  UploadZipSha256 = $PackageZipSha256
} | Format-List
