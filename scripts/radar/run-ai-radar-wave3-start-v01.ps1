param(
  [string]$CatalogManifest = "",
  [int]$TargetRows = 250,
  [int]$ChunkSize = 5
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$StartBatchId = "RADAR-RESEARCH-0003"
$WaveId = "RADAR-RESEARCH-WAVE-0003-0250"
$WaveSlug = "radar-research-wave-0003-0250"
$PackageId = "$WaveId-input-v01"
$ExpectedChunks = [int][Math]::Ceiling($TargetRows / $ChunkSize)
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$StagingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "staging\ai-radar"))
$WaveWorkingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "working\ai-radar\research-waves\$WaveSlug"))
$WaveSourceFile = [System.IO.Path]::GetFullPath((Join-Path $WaveWorkingRoot "$WaveSlug.source.jsonl"))
$WaveCatalogManifest = [System.IO.Path]::GetFullPath((Join-Path $WaveWorkingRoot "catalog-batch-manifest-v01.json"))
$WaveProvenanceFile = [System.IO.Path]::GetFullPath((Join-Path $WaveWorkingRoot "wave-provenance.json"))
$HandoffRoot = [System.IO.Path]::GetFullPath((Join-Path $StagingRoot "research-waves-v01"))
$HandoffDir = [System.IO.Path]::GetFullPath((Join-Path $HandoffRoot $WaveSlug))
$PackageOutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\waves"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $PackageOutputRoot $PackageId))
$PackageZip = [System.IO.Path]::GetFullPath((Join-Path $PackageOutputRoot "$PackageId.zip"))

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

function Get-RepoRelativePath([string]$Value) {
  return [System.IO.Path]::GetRelativePath($RepoRoot, [System.IO.Path]::GetFullPath($Value)).Replace("\", "/")
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

function Read-Json([string]$File) {
  return Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-Json([string]$File, $Value) {
  $Text = $Value | ConvertTo-Json -Depth 20
  [System.IO.Directory]::CreateDirectory((Split-Path $File -Parent)) | Out-Null
  [System.IO.File]::WriteAllText($File, "$Text`n", $Utf8NoBom)
}

function Get-ValidCatalogCandidate([System.IO.FileInfo]$File) {
  try {
    $Manifest = Read-Json $File.FullName
    $Entries = @($Manifest.batches | Where-Object { $_.queue -eq "external_research" } | Sort-Object index, batchId)
    $StartIndex = -1
    for ($Index = 0; $Index -lt $Entries.Count; $Index += 1) {
      if ([string]$Entries[$Index].batchId -eq $StartBatchId) {
        $StartIndex = $Index
        break
      }
    }
    if ($StartIndex -lt 0) { return $null }

    $RowsAvailable = 0
    $ValidatedEntries = @()
    for ($Index = $StartIndex; $Index -lt $Entries.Count -and $RowsAvailable -lt $TargetRows; $Index += 1) {
      $Entry = $Entries[$Index]
      $SourceFile = Assert-UnderDataLocal (Resolve-RepoPath ([string]$Entry.file))
      if (-not (Test-Path -LiteralPath $SourceFile)) { return $null }
      $ExpectedSha = ([string]$Entry.sha256).ToLowerInvariant()
      $ActualSha = (Get-FileHash -LiteralPath $SourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
      if ([string]::IsNullOrWhiteSpace($ExpectedSha) -or $ActualSha -ne $ExpectedSha) { return $null }
      $Lines = @(Get-Content -LiteralPath $SourceFile -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
      if ($Lines.Count -ne [int]$Entry.rowCount) { return $null }
      $ValidatedEntries += [pscustomobject]@{
        Entry = $Entry
        SourceFile = $SourceFile
        SourceSha256 = $ActualSha
        Lines = $Lines
      }
      $RowsAvailable += $Lines.Count
    }
    if ($RowsAvailable -lt $TargetRows) { return $null }

    $GeneratedAt = [datetimeoffset]::MinValue
    if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.generatedAt)) {
      [datetimeoffset]::TryParse([string]$Manifest.generatedAt, [ref]$GeneratedAt) | Out-Null
    }

    return [pscustomobject]@{
      ManifestFile = $File
      Manifest = $Manifest
      Entries = $ValidatedEntries
      GeneratedAt = $GeneratedAt
      LastWriteTimeUtc = $File.LastWriteTimeUtc
    }
  }
  catch {
    return $null
  }
}

if ($TargetRows -ne 250) { throw "第三波当前固定为 250 条，实际请求：$TargetRows" }
if ($ChunkSize -ne 5) { throw "第三波当前固定为每块 5 条，实际请求：$ChunkSize" }

Write-Host "[1/6] 定位并核验正式只读目录清单" -ForegroundColor Cyan
$Candidates = @()
if (-not [string]::IsNullOrWhiteSpace($CatalogManifest)) {
  $Explicit = Assert-UnderDataLocal (Resolve-RepoPath $CatalogManifest)
  if (-not (Test-Path -LiteralPath $Explicit)) { throw "目录清单不存在：$Explicit" }
  $Candidate = Get-ValidCatalogCandidate (Get-Item -LiteralPath $Explicit)
  if ($null -eq $Candidate) { throw "指定清单无法从 $StartBatchId 提供 250 条已核验 external_research 数据" }
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
  throw "找不到可从 $StartBatchId 开始提供 250 条且 SHA-256 完整匹配的正式只读目录清单"
}
$Selected = $Candidates | Sort-Object GeneratedAt, LastWriteTimeUtc -Descending | Select-Object -First 1

Write-Host "[2/6] 汇总批次 0003、0004 与 0005 的前 50 条" -ForegroundColor Cyan
Remove-Item -LiteralPath $WaveWorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $WaveWorkingRoot -Force | Out-Null

$SelectedLines = [System.Collections.Generic.List[string]]::new()
$SelectedRows = [System.Collections.Generic.List[object]]::new()
$SeenIdentities = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$SourceBatches = @()
$Remaining = $TargetRows

foreach ($Validated in @($Selected.Entries)) {
  if ($Remaining -le 0) { break }
  $Take = [Math]::Min($Remaining, $Validated.Lines.Count)
  $BatchRows = @()
  for ($Index = 0; $Index -lt $Take; $Index += 1) {
    $Line = [string]$Validated.Lines[$Index]
    $Row = $Line | ConvertFrom-Json
    $WorkId = [string]$Row.workId
    $SiteId = [string]$Row.siteId
    if ([string]::IsNullOrWhiteSpace($WorkId) -or [string]::IsNullOrWhiteSpace($SiteId)) {
      throw "来源行缺少 workId 或 siteId：$($Validated.Entry.batchId) 第 $($Index + 1) 行"
    }
    if ([string]$Row.catalogQueue.queue -ne "external_research") {
      throw "来源行不是 external_research：$WorkId"
    }
    $Identity = "$WorkId|$SiteId"
    if (-not $SeenIdentities.Add($Identity)) { throw "第三波出现重复身份：$Identity" }
    $SelectedLines.Add($Line.Trim())
    $SelectedRows.Add($Row)
    $BatchRows += $Row
  }
  $SourceBatches += [ordered]@{
    batchId = [string]$Validated.Entry.batchId
    sourceFile = Get-RepoRelativePath $Validated.SourceFile
    sourceSha256 = $Validated.SourceSha256
    originalRows = [int]$Validated.Entry.rowCount
    selectedRows = $Take
    firstWorkId = [string]$BatchRows[0].workId
    lastWorkId = [string]$BatchRows[-1].workId
  }
  $Remaining -= $Take
}
if ($SelectedLines.Count -ne $TargetRows) { throw "第三波预期 250 条，实际汇总 $($SelectedLines.Count) 条" }

[System.IO.File]::WriteAllText($WaveSourceFile, (($SelectedLines -join "`n") + "`n"), $Utf8NoBom)
$WaveSourceSha256 = (Get-FileHash -LiteralPath $WaveSourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
$FirstWorkId = [string]$SelectedRows[0].workId
$LastWorkId = [string]$SelectedRows[-1].workId

$Provenance = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  version = "ai-radar-research-wave-provenance-v0.1"
  waveId = $WaveId
  sourceCatalogManifest = Get-RepoRelativePath $Selected.ManifestFile.FullName
  startBatchId = $StartBatchId
  rowCount = $TargetRows
  firstWorkId = $FirstWorkId
  lastWorkId = $LastWorkId
  sourceBatches = $SourceBatches
  safety = [ordered]@{
    payloadRead = $false
    payloadWrite = $false
    directPostgresqlWrite = $false
    modifiesWorks = $false
    humanTrackMutations = 0
  }
}
Write-Json $WaveProvenanceFile $Provenance

$SyntheticManifestObject = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  version = "ai-radar-research-wave-catalog-v0.1"
  inputSha256 = $WaveSourceSha256
  batches = @([ordered]@{
    batchId = $WaveId
    queue = "external_research"
    index = 1
    rowCount = $TargetRows
    firstWorkId = $FirstWorkId
    lastWorkId = $LastWorkId
    file = Get-RepoRelativePath $WaveSourceFile
    sha256 = $WaveSourceSha256
  })
  provenance = $Provenance
}
Write-Json $WaveCatalogManifest $SyntheticManifestObject

Write-Host "[3/6] 生成 50 个五条研究块" -ForegroundColor Cyan
node ".\scripts\radar\prepare-ai-radar-research-handoff-v01.mjs" `
  --batch-id $WaveId `
  --manifest (Get-RepoRelativePath $WaveCatalogManifest) `
  --out-dir (Get-RepoRelativePath $HandoffRoot) `
  --chunk-size $ChunkSize
Assert-LastExitCode "第三波外部研究交接生成失败"

$HandoffManifestFile = Assert-UnderDataLocal (Join-Path $HandoffDir "handoff-manifest.json")
if (-not (Test-Path -LiteralPath $HandoffManifestFile)) { throw "第三波 handoff-manifest.json 未生成" }
$Handoff = Read-Json $HandoffManifestFile
if ([string]$Handoff.batchId -ne $WaveId) { throw "第三波 batchId 不匹配" }
if ([int]$Handoff.rowCount -ne $TargetRows) { throw "第三波 handoff 行数不匹配" }
if ([int]$Handoff.chunkCount -ne $ExpectedChunks) { throw "第三波预期 $ExpectedChunks 块，实际 $($Handoff.chunkCount) 块" }
if ($Handoff.safety.payloadWrite -ne $false -or $Handoff.safety.directPostgresqlWrite -ne $false -or $Handoff.safety.modifiesWorks -ne $false) {
  throw "第三波 handoff 安全声明不符合要求"
}
foreach ($Chunk in @($Handoff.chunks)) {
  $InputFile = Assert-UnderDataLocal (Resolve-RepoPath ([string]$Chunk.inputFile))
  if (-not $InputFile.StartsWith($HandoffDir + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "研究块路径逃逸 handoff 目录：$InputFile"
  }
  if (-not (Test-Path -LiteralPath $InputFile)) { throw "研究块不存在：$InputFile" }
  $ActualSha = (Get-FileHash -LiteralPath $InputFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualSha -ne ([string]$Chunk.inputSha256).ToLowerInvariant()) { throw "研究块 SHA-256 不匹配：$InputFile" }
}

Write-Host "[4/6] 运行基础与 250 条波次测试" -ForegroundColor Cyan
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
$TestOutput = Join-Path $PackageDir "test-output.txt"
& node --test `
  ".\tests\radar-research-handoff.test.mjs" `
  ".\tests\radar-calibration-profile.test.mjs" `
  ".\tests\radar-ai-qa-pipeline.test.mjs" `
  ".\tests\radar-batch2-kickoff.test.mjs" `
  ".\tests\radar-batch2-portable-start.test.mjs" `
  ".\tests\radar-batch2-complete.test.mjs" `
  ".\tests\radar-wave3-kickoff.test.mjs" 2>&1 | Tee-Object -FilePath $TestOutput
Assert-LastExitCode "第三波开始前测试失败"

Write-Host "[5/6] 生成唯一需要上传的 250 条输入 ZIP" -ForegroundColor Cyan
$PackageChunks = Join-Path $PackageDir "chunks"
New-Item -ItemType Directory -Path $PackageChunks -Force | Out-Null
Copy-Item -LiteralPath $HandoffManifestFile -Destination (Join-Path $PackageDir "handoff-manifest.json") -Force
Copy-Item -LiteralPath (Join-Path $HandoffDir "handoff-summary.json") -Destination (Join-Path $PackageDir "handoff-summary.json") -Force
Copy-Item -LiteralPath (Join-Path $HandoffDir "RESEARCH_INSTRUCTIONS.md") -Destination (Join-Path $PackageDir "RESEARCH_INSTRUCTIONS.md") -Force
Copy-Item -LiteralPath (Join-Path $HandoffDir "$WaveSlug.source.jsonl") -Destination (Join-Path $PackageDir "$WaveSlug.source.jsonl") -Force
Copy-Item -LiteralPath $WaveCatalogManifest -Destination (Join-Path $PackageDir "wave-catalog-manifest.json") -Force
Copy-Item -LiteralPath $WaveProvenanceFile -Destination (Join-Path $PackageDir "wave-provenance.json") -Force
Get-ChildItem -LiteralPath (Join-Path $HandoffDir "chunks") -Filter "*.input.jsonl" -File |
  Sort-Object Name |
  Copy-Item -Destination $PackageChunks -Force

$PackageFiles = @(
  Get-ChildItem -LiteralPath $PackageDir -File -Recurse |
  Where-Object Name -ne "SHA256SUMS.txt" |
  Sort-Object FullName
)
$PackageManifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  version = "ai-radar-research-wave-input-package-v0.1"
  packageId = $PackageId
  waveId = $WaveId
  queue = "external_research"
  rowCount = $TargetRows
  chunkSize = $ChunkSize
  chunkCount = $ExpectedChunks
  sourceBatches = $SourceBatches
  files = @($PackageFiles | ForEach-Object {
    [ordered]@{
      path = [System.IO.Path]::GetRelativePath($PackageDir, $_.FullName).Replace("\", "/")
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      bytes = $_.Length
    }
  })
  requestedCompletion = [ordered]@{
    mode = "single_assistant_pass"
    returnPackage = "$WaveId-complete-results-v01.zip"
    stages = @("external_research", "research_assembly", "calibrated_ai_assessment", "ai_qa", "targeted_defer_partition")
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
  nextStep = "Upload this single ZIP. Do not upload individual chunks."
}
Write-Json (Join-Path $PackageDir "package-manifest.json") $PackageManifest

$HashLines = @()
Get-ChildItem -LiteralPath $PackageDir -File -Recurse |
  Where-Object Name -ne "SHA256SUMS.txt" |
  Sort-Object FullName |
  ForEach-Object {
    $Relative = [System.IO.Path]::GetRelativePath($PackageDir, $_.FullName).Replace("\", "/")
    $Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $HashLines += "$Hash  $Relative"
  }
[System.IO.File]::WriteAllText((Join-Path $PackageDir "SHA256SUMS.txt"), (($HashLines -join "`n") + "`n"), $Utf8NoBom)

New-Item -ItemType Directory -Path $PackageOutputRoot -Force | Out-Null
Remove-Item -LiteralPath $PackageZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $PackageDir "*") -DestinationPath $PackageZip -CompressionLevel Optimal
$PackageZipSha256 = (Get-FileHash -LiteralPath $PackageZip -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "[6/6] 第三波 250 条输入包完成" -ForegroundColor Cyan
[pscustomobject]@{
  WaveId = $WaveId
  Rows = $TargetRows
  ChunkSize = $ChunkSize
  Chunks = $ExpectedChunks
  SourceBatches = ($SourceBatches | ForEach-Object { "$($_.batchId):$($_.selectedRows)" }) -join ", "
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  UploadZip = $PackageZip
  UploadZipSha256 = $PackageZipSha256
} | Format-List

explorer.exe $PackageOutputRoot
