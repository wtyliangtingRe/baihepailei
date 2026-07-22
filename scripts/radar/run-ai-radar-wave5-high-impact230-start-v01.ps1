param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE5-HIGH-IMPACT-230-input-v01"
$BatchId = "RADAR-WAVE5-HIGH-IMPACT-230"
$ExpectedPackageZipSha256 = "323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3"
$ExpectedWave5InputZipSha256 = "9d0f9f6002681b3851d1aaa3da9970af03396d222cfc1015cf4ee42f9e2c9be3"
$ExpectedWave5CheckpointZipSha256 = "c3c0f21cfe3a3c3c2f10a4d0393d8ecf5c0a79b1c0a3f04c85a97ab6f84c7f76"
$ExpectedPriority35ResultZipSha256 = "a09702bb94367ad3149b1b976309e70aef54e9ee2d3f245dbcfb77c1f089550f"
$ExpectedPriority35CheckpointZipSha256 = "ea126e8039a7879ddd38e05de5ff4edb369395407ed9849c61f5744743b6a224"

$ExpectedRows = 230
$ExpectedChunks = 46
$ExpectedS = 1
$ExpectedA = 122
$ExpectedE = 99
$ExpectedF = 8

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave5-high-impact230-input-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "$BatchId-input-checkpoint-v01"
$CheckpointDir = [System.IO.Path]::GetFullPath((Join-Path $CheckpointRoot $CheckpointId))
$CheckpointZip = [System.IO.Path]::GetFullPath((Join-Path $CheckpointRoot "$CheckpointId.zip"))
$TestOutput = [System.IO.Path]::GetFullPath((Join-Path $OutputRoot "test-output.txt"))
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Resolve-RepoPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  if ([System.IO.Path]::IsPathRooted($Value)) {
    return [System.IO.Path]::GetFullPath($Value)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}

function Assert-SafeRelativePath([string]$Root, [string]$Relative) {
  if ([string]::IsNullOrWhiteSpace($Relative)) { throw "Relative path is empty" }
  $Normalized = $Relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $Resolved = [System.IO.Path]::GetFullPath((Join-Path $Root $Normalized))
  $Prefix = [System.IO.Path]::GetFullPath($Root) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Package path traversal detected: $Relative"
  }
  return $Resolved
}

function Get-LatestZip([string]$Name, [string]$Explicit) {
  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    $Resolved = Resolve-RepoPath $Explicit
    if (-not (Test-Path -LiteralPath $Resolved)) {
      throw "Specified ZIP does not exist: $Resolved"
    }
    return Get-Item -LiteralPath $Resolved
  }

  $Candidates = @()
  foreach ($Root in @(
    (Join-Path $HOME "Downloads"),
    (Join-Path $DataLocal "outputs"),
    (Join-Path $DataLocal "incoming")
  )) {
    if (Test-Path -LiteralPath $Root) {
      $Candidates += @(
        Get-ChildItem -LiteralPath $Root -Filter $Name -File -Recurse -ErrorAction SilentlyContinue
      )
    }
  }

  if ($Candidates.Count -eq 0) {
    throw "Cannot find $Name in Downloads or data_local"
  }

  return $Candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
}

function Read-Json([string]$File) {
  return Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-Json([string]$File, $Value) {
  New-Item -ItemType Directory -Path (Split-Path $File -Parent) -Force | Out-Null
  $Text = $Value | ConvertTo-Json -Depth 60
  [System.IO.File]::WriteAllText($File, "$Text`n", $Utf8NoBom)
}

function Read-JsonlIdentities([string]$File) {
  $Rows = 0
  $Seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $ByGrade = @{}
  foreach ($Line in Get-Content -LiteralPath $File -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($Line)) { continue }
    $Row = $Line | ConvertFrom-Json
    $Identity = "$($Row.workId)|$($Row.siteId)"
    if (-not $Seen.Add($Identity)) {
      throw "Duplicate identity in $(Split-Path $File -Leaf): $Identity"
    }
    if ([string]$Row.batchId -ne $BatchId) {
      throw "Unexpected batchId in $(Split-Path $File -Leaf): $Identity"
    }
    if ([string]$Row.publicationStatus -ne "do_not_publish" -or $Row.requiresHumanReview -ne $true) {
      throw "Unsafe row publication state: $Identity"
    }
    if ($Row.safety.payloadWrite -ne $false -or
        $Row.safety.directPostgresqlWrite -ne $false -or
        $Row.safety.modifiesWorks -ne $false -or
        $Row.safety.publishesRatings -ne $false) {
      throw "Unsafe row write declaration: $Identity"
    }
    $Grade = [string]$Row.previousGrade
    if (-not $ByGrade.ContainsKey($Grade)) { $ByGrade[$Grade] = 0 }
    $ByGrade[$Grade] += 1
    $Rows += 1
  }
  return [pscustomobject]@{
    Rows = $Rows
    Seen = $Seen
    ByGrade = $ByGrade
  }
}

Write-Host "[1/8] Locate and bind the Wave 5 high-impact 230 package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()

if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "High-impact package ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/8] Extract and verify every declared package hash" -ForegroundColor Cyan
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$SummaryFile = Join-Path $PackageDir "selection-summary-v01.json"
$ValidationFile = Join-Path $PackageDir "validation\input-validation-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"

foreach ($Required in @($ManifestFile, $SummaryFile, $ValidationFile, $HashFile)) {
  if (-not (Test-Path -LiteralPath $Required)) {
    throw "Required package file missing: $Required"
  }
}

foreach ($Line in @(
  Get-Content -LiteralPath $HashFile -Encoding UTF8 |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)) {
  if ($Line -notmatch '^([0-9a-fA-F]{64})\s+(.+)$') {
    throw "Invalid SHA256SUMS line: $Line"
  }
  $Expected = $Matches[1].ToLowerInvariant()
  $File = Assert-SafeRelativePath $PackageDir $Matches[2]
  if (-not (Test-Path -LiteralPath $File)) {
    throw "Declared package file missing: $($Matches[2])"
  }
  $Actual = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) {
    throw "Package file SHA-256 mismatch: $($Matches[2])"
  }
}

Write-Host "[3/8] Verify source chain, fixed counts and safety" -ForegroundColor Cyan
$Manifest = Read-Json $ManifestFile
$Summary = Read-Json $SummaryFile
$Validation = Read-Json $ValidationFile

if ([string]$Manifest.packageId -ne $PackageId -or [string]$Manifest.batchId -ne $BatchId) {
  throw "Unexpected packageId or batchId"
}
if ([string]$Manifest.sourceWave5Input.sha256 -ne $ExpectedWave5InputZipSha256 -or
    [string]$Manifest.sourceWave5InputCheckpoint.sha256 -ne $ExpectedWave5CheckpointZipSha256 -or
    [string]$Manifest.completedPriority35Result.sha256 -ne $ExpectedPriority35ResultZipSha256 -or
    [string]$Manifest.completedPriority35Checkpoint.sha256 -ne $ExpectedPriority35CheckpointZipSha256) {
  throw "High-impact package source chain does not match the verified inputs"
}
if ($Validation.complete -ne $true -or @($Validation.validationErrors).Count -ne 0 -or
    [int]$Validation.priority35Overlap -ne 0) {
  throw "High-impact package validation is incomplete"
}
if ([int]$Manifest.rows -ne $ExpectedRows -or [int]$Manifest.chunkCount -ne $ExpectedChunks -or
    [int]$Manifest.byPreviousGrade.S -ne $ExpectedS -or
    [int]$Manifest.byPreviousGrade.A -ne $ExpectedA -or
    [int]$Manifest.byPreviousGrade.E -ne $ExpectedE -or
    [int]$Manifest.byPreviousGrade.F -ne $ExpectedF) {
  throw "High-impact package fixed counts do not match"
}
if ($Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "High-impact package safety declarations are not acceptable"
}

Write-Host "[4/8] Verify aggregate identities and grade partitions" -ForegroundColor Cyan
$AggregateFile = Assert-SafeRelativePath $PackageDir ([string]$Manifest.aggregateFile)
$AggregateSha = (Get-FileHash -LiteralPath $AggregateFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($AggregateSha -ne ([string]$Manifest.aggregateFileSha256).ToLowerInvariant()) {
  throw "Aggregate SHA-256 mismatch"
}
$AggregateStats = Read-JsonlIdentities $AggregateFile
if ($AggregateStats.Rows -ne $ExpectedRows -or $AggregateStats.Seen.Count -ne $ExpectedRows -or
    [int]$AggregateStats.ByGrade.S -ne $ExpectedS -or
    [int]$AggregateStats.ByGrade.A -ne $ExpectedA -or
    [int]$AggregateStats.ByGrade.E -ne $ExpectedE -or
    [int]$AggregateStats.ByGrade.F -ne $ExpectedF) {
  throw "Aggregate row, identity or grade distribution mismatch"
}

Write-Host "[5/8] Verify all 46 recoverable chunks and exact identity union" -ForegroundColor Cyan
$ChunkSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$ChunkRows = 0
$ChunkCount = 0
foreach ($Chunk in @($Manifest.chunks | Sort-Object index)) {
  $ChunkFile = Assert-SafeRelativePath $PackageDir ([string]$Chunk.file)
  $ActualChunkSha = (Get-FileHash -LiteralPath $ChunkFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualChunkSha -ne ([string]$Chunk.sha256).ToLowerInvariant()) {
    throw "Chunk SHA-256 mismatch: $($Chunk.chunkId)"
  }
  $Stats = Read-JsonlIdentities $ChunkFile
  if ($Stats.Rows -ne [int]$Chunk.rowCount -or $Stats.Rows -ne 5) {
    throw "Chunk row count mismatch: $($Chunk.chunkId)"
  }
  foreach ($Identity in $Stats.Seen) {
    if (-not $ChunkSeen.Add($Identity)) {
      throw "Cross-chunk duplicate identity: $Identity"
    }
  }
  $ChunkRows += $Stats.Rows
  $ChunkCount += 1
}

if ($ChunkRows -ne $ExpectedRows -or $ChunkCount -ne $ExpectedChunks -or
    $ChunkSeen.Count -ne $ExpectedRows) {
  throw "Chunk aggregate mismatch"
}
foreach ($Identity in $AggregateStats.Seen) {
  if (-not $ChunkSeen.Contains($Identity)) {
    throw "Aggregate identity missing from chunk union: $Identity"
  }
}
foreach ($Identity in $ChunkSeen) {
  if (-not $AggregateStats.Seen.Contains($Identity)) {
    throw "Chunk identity missing from aggregate: $Identity"
  }
}

Write-Host "[6/8] Install the local high-impact research package" -ForegroundColor Cyan
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[7/8] Run high-impact package recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave5-high-impact230.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "High-impact package tests failed"
}

Write-Host "[8/8] Create the compact high-impact input checkpoint" -ForegroundColor Cyan
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

Copy-Item -LiteralPath $ManifestFile -Destination (Join-Path $CheckpointDir "package-manifest.json") -Force
Copy-Item -LiteralPath $SummaryFile -Destination (Join-Path $CheckpointDir "selection-summary-v01.json") -Force
Copy-Item -LiteralPath $ValidationFile -Destination (Join-Path $CheckpointDir "input-validation-v01.json") -Force
Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $CheckpointDir "test-output.txt") -Force

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave5-high-impact230-install-v0.1"
  packageId = $PackageId
  batchId = $BatchId
  packageZip = $SelectedZip.FullName
  packageZipSha256 = $ActualPackageZipSha256
  rows = $ExpectedRows
  chunks = $ExpectedChunks
  byPreviousGrade = [ordered]@{
    S = $ExpectedS
    A = $ExpectedA
    E = $ExpectedE
    F = $ExpectedF
  }
  outputRoot = $OutputRoot
  checkpointZip = $CheckpointZip
  publicationReady = $false
  safety = [ordered]@{
    payloadWrite = $false
    directPostgresqlWrite = $false
    modifiesWorks = $false
    publishesRatings = $false
    humanTrackMutations = 0
    onlyLocalArtifacts = $true
  }
}
Write-Json (Join-Path $CheckpointDir "install-summary-v01.json") $InstallSummary

$HashLines = @()
foreach ($File in Get-ChildItem -LiteralPath $CheckpointDir -File -Recurse | Sort-Object FullName) {
  if ($File.Name -eq "SHA256SUMS.txt") { continue }
  $Relative = [System.IO.Path]::GetRelativePath($CheckpointDir, $File.FullName).Replace("\", "/")
  $Hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $HashLines += "$Hash  $Relative"
}
[System.IO.File]::WriteAllText(
  (Join-Path $CheckpointDir "SHA256SUMS.txt"),
  (($HashLines -join "`n") + "`n"),
  $Utf8NoBom
)

New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null
Compress-Archive -Path (Join-Path $CheckpointDir "*") -DestinationPath $CheckpointZip -CompressionLevel Optimal
$CheckpointZipSha256 = (Get-FileHash -LiteralPath $CheckpointZip -Algorithm SHA256).Hash.ToLowerInvariant()

[pscustomobject]@{
  PackageId = $PackageId
  Rows = $ExpectedRows
  GradeS = $ExpectedS
  GradeA = $ExpectedA
  GradeE = $ExpectedE
  GradeF = $ExpectedF
  Chunks = $ExpectedChunks
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List
