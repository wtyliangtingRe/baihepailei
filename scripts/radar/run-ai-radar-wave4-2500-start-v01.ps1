param(
  [string]$CatalogManifest = "",
  [string]$Ledger = "",
  [int]$TargetRows = 2500,
  [int]$RetryReserve = 500,
  [int]$SubwaveSize = 250,
  [int]$ChunkSize = 5
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$WaveId = "RADAR-INCREMENTAL-WAVE-0004-2500"
$PackageId = "$WaveId-input-v02"
$ExpectedSubwaves = 10
$ExpectedChunksPerFullSubwave = 50
$ExpectedTotalChunks = 500
$MinimumLegacyRowsScanned = 10000
$MinimumLegacyReusableRows = 8000

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$StagingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "staging\ai-radar"))
$StateRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\state"))
$DefaultLedger = [System.IO.Path]::GetFullPath((Join-Path $StateRoot "ai-radar-processing-ledger-v01.jsonl"))
$WorkingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "working\ai-radar\incremental-wave-0004-2500-v02"))
$SelectionRoot = [System.IO.Path]::GetFullPath((Join-Path $WorkingRoot "selection"))
$TestOutput = [System.IO.Path]::GetFullPath((Join-Path $WorkingRoot "test-output.txt"))
$PackageOutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\waves"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $PackageOutputRoot $PackageId))
$PackageZip = [System.IO.Path]::GetFullPath((Join-Path $PackageOutputRoot "$PackageId.zip"))

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

function Resolve-RepoPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  if ([System.IO.Path]::IsPathRooted($Value)) { return [System.IO.Path]::GetFullPath($Value) }
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

function Read-Json([string]$File) {
  return Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-ValidFullCatalog([System.IO.FileInfo]$File) {
  try {
    $Manifest = Read-Json $File.FullName
    $Entries = @($Manifest.batches | Where-Object { $_.queue -eq "external_research" } | Sort-Object index, batchId)
    if ($Entries.Count -eq 0) { return $null }
    $Rows = 0
    foreach ($Entry in $Entries) {
      $SourceFile = Assert-UnderDataLocal (Resolve-RepoPath ([string]$Entry.file))
      if (-not (Test-Path -LiteralPath $SourceFile)) { return $null }
      $ExpectedSha = ([string]$Entry.sha256).ToLowerInvariant()
      $ActualSha = (Get-FileHash -LiteralPath $SourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
      if ([string]::IsNullOrWhiteSpace($ExpectedSha) -or $ActualSha -ne $ExpectedSha) { return $null }
      $LineCount = @(
        Get-Content -LiteralPath $SourceFile -Encoding UTF8 |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
      ).Count
      if ($LineCount -ne [int]$Entry.rowCount) { return $null }
      $Rows += $LineCount
    }
    if ($Rows -lt $TargetRows) { return $null }
    $GeneratedAt = [datetimeoffset]::MinValue
    if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.generatedAt)) {
      [datetimeoffset]::TryParse([string]$Manifest.generatedAt, [ref]$GeneratedAt) | Out-Null
    }
    return [pscustomobject]@{
      File = $File
      Rows = $Rows
      GeneratedAt = $GeneratedAt
      LastWriteTimeUtc = $File.LastWriteTimeUtc
    }
  }
  catch { return $null }
}

if ($TargetRows -ne 2500) { throw "第四波当前固定为 2500 条，实际请求：$TargetRows" }
if ($SubwaveSize -ne 250) { throw "第四波当前固定为 10 × 250，实际子波次：$SubwaveSize" }
if ($ChunkSize -ne 5) { throw "第四波当前固定为每研究块 5 条，实际：$ChunkSize" }
if ($RetryReserve -lt 0 -or $RetryReserve -gt $TargetRows) { throw "RetryReserve 必须位于 0 到 2500" }

Write-Host "[1/7] 定位并完整核验最新目录快照" -ForegroundColor Cyan
$Candidates = @()
if (-not [string]::IsNullOrWhiteSpace($CatalogManifest)) {
  $Explicit = Assert-UnderDataLocal (Resolve-RepoPath $CatalogManifest)
  if (-not (Test-Path -LiteralPath $Explicit)) { throw "目录清单不存在：$Explicit" }
  $Candidate = Get-ValidFullCatalog (Get-Item -LiteralPath $Explicit)
  if ($null -eq $Candidate) { throw "指定目录清单未通过完整文件、行数和 SHA-256 核验" }
  $Candidates = @($Candidate)
}
else {
  if (-not (Test-Path -LiteralPath $StagingRoot)) { throw "AI Radar staging 根目录不存在：$StagingRoot" }
  Get-ChildItem -LiteralPath $StagingRoot -Filter "catalog-batch-manifest-v01.json" -File -Recurse | ForEach-Object {
    $Candidate = Get-ValidFullCatalog $_
    if ($null -ne $Candidate) { $Candidates += $Candidate }
  }
}
if ($Candidates.Count -eq 0) { throw "找不到通过完整 SHA-256 与行数核验的目录清单" }
$SelectedCatalog = $Candidates | Sort-Object GeneratedAt, LastWriteTimeUtc -Descending | Select-Object -First 1

Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $SelectionRoot -Force | Out-Null

Write-Host "[2/7] 重建增量台账并纳入旧批量评级证据" -ForegroundColor Cyan
$LedgerFile = if ([string]::IsNullOrWhiteSpace($Ledger)) {
  $DefaultLedger
} else {
  Assert-UnderDataLocal (Resolve-RepoPath $Ledger)
}
node ".\scripts\radar\build-ai-radar-processing-ledger-v01.mjs" `
  --catalog-manifest (To-RepoRelative $SelectedCatalog.File.FullName) `
  --scan-root "data_local" `
  --out (To-RepoRelative $LedgerFile)
Assert-LastExitCode "包含旧成果的增量台账重建失败"

$LedgerSummaryFile = if ($LedgerFile.EndsWith(".jsonl", [System.StringComparison]::OrdinalIgnoreCase)) {
  $LedgerFile.Substring(0, $LedgerFile.Length - 6) + "-summary.json"
} else {
  "$LedgerFile-summary.json"
}
if (-not (Test-Path -LiteralPath $LedgerSummaryFile)) { throw "增量台账摘要未生成：$LedgerSummaryFile" }
$LedgerSummary = Read-Json $LedgerSummaryFile
$LedgerRows = @(
  Get-Content -LiteralPath $LedgerFile -Encoding UTF8 |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
if ($LedgerRows.Count -lt 450) { throw "增量台账少于第三波验收基线 450 条：$($LedgerRows.Count)" }
if ([int]$LedgerSummary.legacyFilesScanned -lt 1 -or
    [int]$LedgerSummary.legacyRowsScanned -lt $MinimumLegacyRowsScanned -or
    [int]$LedgerSummary.legacyReusableRows -lt $MinimumLegacyReusableRows) {
  throw "旧成果未完整纳入：files=$($LedgerSummary.legacyFilesScanned)，rows=$($LedgerSummary.legacyRowsScanned)，reusable=$($LedgerSummary.legacyReusableRows)。请保留或恢复 RADAR-ASSESS-0001 至 0041 的结果文件后重试。"
}
if ($LedgerSummary.safety.payloadWrite -ne $false -or
    $LedgerSummary.safety.directPostgresqlWrite -ne $false -or
    [int]$LedgerSummary.safety.humanTrackMutations -ne 0) {
  throw "增量台账安全声明不符合要求"
}

Write-Host "[3/7] 选择真正未完成的 2500 条研究并分离旧证据重新评级" -ForegroundColor Cyan
node ".\scripts\radar\select-ai-radar-incremental-wave-v01.mjs" `
  --catalog-manifest (To-RepoRelative $SelectedCatalog.File.FullName) `
  --ledger (To-RepoRelative $LedgerFile) `
  --out-dir (To-RepoRelative $SelectionRoot) `
  --target-rows $TargetRows `
  --retry-reserve $RetryReserve `
  --policy-version "radar-rating-policy-v0.4-draft" `
  --calibration-profile-id "site-owner-primary-v0.1"
Assert-LastExitCode "2500 条增量选择失败"
$SelectionSummaryFile = Join-Path $SelectionRoot "incremental-selection-summary-v01.json"
$ResearchSelectionFile = Join-Path $SelectionRoot "incremental-research-selection-v01.jsonl"
$ReassessmentFile = Join-Path $SelectionRoot "incremental-reassessment-selection-v01.jsonl"
$SelectionSummary = Read-Json $SelectionSummaryFile
if ([int]$SelectionSummary.selectedResearchRows -ne $TargetRows) { throw "增量选择未达到 2500 条：$($SelectionSummary.selectedResearchRows)" }
if ([int]$SelectionSummary.legacyReassessmentRows -lt 1 -or
    [int]$SelectionSummary.reassessmentRowsWithReusableEvidence -lt 1) {
  throw "旧批量评级仍未进入复用证据重新评级队列，已阻止生成重复研究包"
}
if ($SelectionSummary.safety.payloadWrite -ne $false -or
    $SelectionSummary.safety.directPostgresqlWrite -ne $false -or
    [int]$SelectionSummary.safety.humanTrackMutations -ne 0) {
  throw "增量选择安全声明不符合要求"
}

Write-Host "[4/7] 运行增量、旧成果复用、2500 拆分与恢复规则测试" -ForegroundColor Cyan
& node --test `
  ".\tests\radar-incremental-ledger.test.mjs" `
  ".\tests\radar-legacy-assessment-overlay.test.mjs" `
  ".\tests\radar-incremental-wave2500.test.mjs" `
  ".\tests\radar-research-handoff.test.mjs" 2>&1 | Tee-Object -FilePath $TestOutput
Assert-LastExitCode "2500 条增量波次测试失败"

Write-Host "[5/7] 生成 10 × 250 子波次与 500 个五条研究块" -ForegroundColor Cyan
node ".\scripts\radar\package-ai-radar-incremental-wave-v01.mjs" `
  --selection (To-RepoRelative $ResearchSelectionFile) `
  --selection-summary (To-RepoRelative $SelectionSummaryFile) `
  --reassessments (To-RepoRelative $ReassessmentFile) `
  --ledger (To-RepoRelative $LedgerFile) `
  --test-output (To-RepoRelative $TestOutput) `
  --out-dir (To-RepoRelative $PackageDir) `
  --wave-id $WaveId `
  --package-id $PackageId `
  --target-rows $TargetRows `
  --subwave-size $SubwaveSize `
  --chunk-size $ChunkSize
Assert-LastExitCode "2500 条增量输入包生成失败"
$PackageManifestFile = Join-Path $PackageDir "package-manifest.json"
$PackageManifest = Read-Json $PackageManifestFile
if ([int]$PackageManifest.selectedResearchRows -ne $TargetRows -or
    [int]$PackageManifest.subwaveCount -ne $ExpectedSubwaves -or
    [int]$PackageManifest.totalChunkCount -ne $ExpectedTotalChunks) {
  throw "2500 条输入包统计不符合预期"
}
if (@($PackageManifest.subwaves | Where-Object {
  [int]$_.rowCount -ne $SubwaveSize -or [int]$_.chunkCount -ne $ExpectedChunksPerFullSubwave
}).Count -ne 0) {
  throw "存在不是 250 条或不是 50 块的子波次"
}
if ($PackageManifest.safety.payloadWrite -ne $false -or
    $PackageManifest.safety.directPostgresqlWrite -ne $false -or
    [int]$PackageManifest.safety.humanTrackMutations -ne 0) {
  throw "2500 条输入包安全声明不符合要求"
}

Write-Host "[6/7] 复核包内全部 SHA-256 并压缩为一个上传文件" -ForegroundColor Cyan
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
foreach ($Line in @(Get-Content -LiteralPath $HashFile -Encoding UTF8 | Where-Object {
  -not [string]::IsNullOrWhiteSpace($_)
})) {
  if ($Line -notmatch '^([0-9a-fA-F]{64})\s+(.+)$') { throw "SHA256SUMS 行格式错误：$Line" }
  $Expected = $Matches[1].ToLowerInvariant()
  $Relative = $Matches[2].Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $File = [System.IO.Path]::GetFullPath((Join-Path $PackageDir $Relative))
  $Prefix = $PackageDir + [System.IO.Path]::DirectorySeparatorChar
  if (-not $File.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "SHA256SUMS 路径逃逸：$Relative" }
  if (-not (Test-Path -LiteralPath $File)) { throw "SHA256SUMS 文件缺失：$Relative" }
  $Actual = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "SHA256SUMS 不匹配：$Relative" }
}
New-Item -ItemType Directory -Path $PackageOutputRoot -Force | Out-Null
Remove-Item -LiteralPath $PackageZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $PackageDir "*") -DestinationPath $PackageZip -CompressionLevel Optimal
$PackageZipSha256 = (Get-FileHash -LiteralPath $PackageZip -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "[7/7] 去重后的 2500 条增量输入包完成" -ForegroundColor Cyan
[pscustomobject]@{
  WaveId = $WaveId
  ResearchRows = [int]$PackageManifest.selectedResearchRows
  NewRows = [int]$PackageManifest.selectedNewRows
  RetryRows = [int]$PackageManifest.selectedRetryRows
  ReassessmentRows = [int]$PackageManifest.reassessmentRows
  LegacyFilesScanned = [int]$LedgerSummary.legacyFilesScanned
  LegacyRowsScanned = [int]$LedgerSummary.legacyRowsScanned
  LegacyReusableRows = [int]$LedgerSummary.legacyReusableRows
  LegacyReassessmentRows = [int]$SelectionSummary.legacyReassessmentRows
  Subwaves = [int]$PackageManifest.subwaveCount
  Chunks = [int]$PackageManifest.totalChunkCount
  LedgerRows = $LedgerRows.Count
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  UploadZip = $PackageZip
  UploadZipSha256 = $PackageZipSha256
} | Format-List

explorer.exe $PackageOutputRoot
