param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE5-DEFERRED-REMEDIATION-8183-input-v01"
$WaveId = "RADAR-WAVE5-DEFERRED-REMEDIATION-8183"
$ExpectedPackageZipSha256 = "9d0f9f6002681b3851d1aaa3da9970af03396d222cfc1015cf4ee42f9e2c9be3"
$ExpectedSourceQaPackageSha256 = "eeebc2474a98e0c5e89348aabb8ceb1f038a076da0b46c16b827a40daf158ec6"
$ExpectedSourceQaCheckpointSha256 = "2785e46bedb587abd27a61fff91e7b717f03c983a0c384885efa1245cf032490"

$ExpectedResearchRows = 8183
$ExpectedPolicyResolvedRows = 3
$ExpectedSubwaves = 33
$ExpectedFullSubwaves = 32
$ExpectedFinalSubwaveRows = 183
$ExpectedChunks = 1637
$ExpectedFinalSubwaveChunks = 37
$ExpectedNewDeferredRows = 2
$ExpectedRuleConflictRows = 1
$ExpectedRouteReviewRows = 32
$ExpectedEvidenceRefreshRows = 8148

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave5-deferred-remediation-8183-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "$WaveId-input-checkpoint-v01"
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

function Assert-UnderDataLocal([string]$Value) {
  $Resolved = [System.IO.Path]::GetFullPath($Value)
  $Prefix = $DataLocal + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.Equals($DataLocal, [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $Resolved.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path must remain under data_local: $Resolved"
  }
  return $Resolved
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

function Get-JsonlStats([string]$File, [System.Collections.Generic.HashSet[string]]$GlobalSeen = $null) {
  $Rows = 0
  $Seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $ByCategory = @{}
  foreach ($Line in Get-Content -LiteralPath $File -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($Line)) { continue }
    $Row = $Line | ConvertFrom-Json
    $Identity = "$($Row.workId)|$($Row.siteId)"
    if (-not $Seen.Add($Identity)) {
      throw "Duplicate identity in $(Split-Path $File -Leaf): $Identity"
    }
    if ($null -ne $GlobalSeen -and -not $GlobalSeen.Add($Identity)) {
      throw "Cross-file duplicate identity: $Identity"
    }
    $Category = [string]$Row.taskCategory
    if (-not [string]::IsNullOrWhiteSpace($Category)) {
      if (-not $ByCategory.ContainsKey($Category)) { $ByCategory[$Category] = 0 }
      $ByCategory[$Category] += 1
    }
    $Rows += 1
  }
  return [pscustomobject]@{ Rows = $Rows; UniqueIdentities = $Seen.Count; ByCategory = $ByCategory }
}

Write-Host "[1/8] Locate and bind the Wave 5 remediation package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "Wave 5 package ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/8] Extract and verify every declared package hash" -ForegroundColor Cyan
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$SummaryFile = Join-Path $PackageDir "selection-summary-v01.json"
$ValidationFile = Join-Path $PackageDir "validation\input-validation-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
$AggregateFile = Join-Path $PackageDir "aggregate\wave5-targeted-research-all-v01.jsonl"
$PolicyFile = Join-Path $PackageDir "policy-resolutions\abo-grade-prefix-resolutions-v01.jsonl"

foreach ($Required in @($ManifestFile, $SummaryFile, $ValidationFile, $HashFile, $AggregateFile, $PolicyFile)) {
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

if ([string]$Manifest.packageId -ne $PackageId -or [string]$Manifest.waveId -ne $WaveId) {
  throw "Unexpected packageId or waveId"
}
if ([string]$Manifest.sourceQaPackage.sha256 -ne $ExpectedSourceQaPackageSha256) {
  throw "Wave 5 package is not bound to the verified QA package"
}
if ([string]$Manifest.sourceQaCheckpoint.sha256 -ne $ExpectedSourceQaCheckpointSha256) {
  throw "Wave 5 package is not bound to the verified QA checkpoint"
}
if ($Validation.complete -ne $true -or @($Validation.validationErrors).Count -ne 0) {
  throw "Wave 5 package validation is incomplete"
}
if ([int]$Manifest.researchRows -ne $ExpectedResearchRows -or
    [int]$Manifest.policyOnlyResolvedRows -ne $ExpectedPolicyResolvedRows -or
    [int]$Manifest.subwaveCount -ne $ExpectedSubwaves -or
    [int]$Manifest.fullSubwaves -ne $ExpectedFullSubwaves -or
    [int]$Manifest.finalSubwaveRows -ne $ExpectedFinalSubwaveRows -or
    [int]$Manifest.totalChunkCount -ne $ExpectedChunks) {
  throw "Wave 5 fixed package counts do not match"
}
if ([int]$Manifest.byTaskCategory.new_assessment_targeted_refresh -ne $ExpectedNewDeferredRows -or
    [int]$Manifest.byTaskCategory.rule_conflict_plus_family_relationship_review -ne $ExpectedRuleConflictRows -or
    [int]$Manifest.byTaskCategory.route_structure_review -ne $ExpectedRouteReviewRows -or
    [int]$Manifest.byTaskCategory.targeted_evidence_refresh -ne $ExpectedEvidenceRefreshRows) {
  throw "Wave 5 category counts do not match"
}
if ($Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "Wave 5 safety declarations are not acceptable"
}

Write-Host "[4/8] Verify aggregate identities and policy-only resolutions" -ForegroundColor Cyan
$AggregateStats = Get-JsonlStats $AggregateFile
if ($AggregateStats.Rows -ne $ExpectedResearchRows -or $AggregateStats.UniqueIdentities -ne $ExpectedResearchRows) {
  throw "Wave 5 aggregate row or identity count mismatch"
}
if ([int]$AggregateStats.ByCategory.new_assessment_targeted_refresh -ne $ExpectedNewDeferredRows -or
    [int]$AggregateStats.ByCategory.rule_conflict_plus_family_relationship_review -ne $ExpectedRuleConflictRows -or
    [int]$AggregateStats.ByCategory.route_structure_review -ne $ExpectedRouteReviewRows -or
    [int]$AggregateStats.ByCategory.targeted_evidence_refresh -ne $ExpectedEvidenceRefreshRows) {
  throw "Wave 5 aggregate category partition mismatch"
}

$PolicyRows = 0
$PolicySeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($Line in Get-Content -LiteralPath $PolicyFile -Encoding UTF8) {
  if ([string]::IsNullOrWhiteSpace($Line)) { continue }
  $Row = $Line | ConvertFrom-Json
  $Identity = "$($Row.workId)|$($Row.siteId)"
  if (-not $PolicySeen.Add($Identity)) { throw "Duplicate policy resolution: $Identity" }
  if ([string]$Row.previousGrade -ne "E" -or [string]$Row.resolvedGrade -ne "D" -or
      @($Row.resolvedRuleCodes).Count -ne 1 -or [string]$Row.resolvedRuleCodes[0] -ne "D-ABO" -or
      [string]$Row.publicationStatus -ne "do_not_publish") {
    throw "Unexpected ABO policy resolution: $Identity"
  }
  $PolicyRows += 1
}
if ($PolicyRows -ne $ExpectedPolicyResolvedRows) {
  throw "Policy-only resolution count mismatch"
}

Write-Host "[5/8] Verify all recoverable subwaves and chunks" -ForegroundColor Cyan
$GlobalSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$SubwaveRows = 0
$ChunkRows = 0
$ChunkCount = 0
foreach ($Subwave in @($Manifest.subwaves | Sort-Object subwaveIndex)) {
  $Index = [int]$Subwave.subwaveIndex
  $ExpectedRows = if ($Index -lt $ExpectedSubwaves) { 250 } else { $ExpectedFinalSubwaveRows }
  $ExpectedSubwaveChunkCount = if ($Index -lt $ExpectedSubwaves) { 50 } else { $ExpectedFinalSubwaveChunks }
  if ([int]$Subwave.rowCount -ne $ExpectedRows -or [int]$Subwave.chunkCount -ne $ExpectedSubwaveChunkCount) {
    throw "Unexpected subwave shape: $($Subwave.subwaveId)"
  }
  $SubManifestFile = Assert-SafeRelativePath $PackageDir ([string]$Subwave.manifestFile)
  $ActualSubManifestSha = (Get-FileHash -LiteralPath $SubManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualSubManifestSha -ne ([string]$Subwave.manifestSha256).ToLowerInvariant()) {
    throw "Subwave manifest SHA-256 mismatch: $($Subwave.subwaveId)"
  }
  $SubManifest = Read-Json $SubManifestFile
  $SourceFile = Assert-SafeRelativePath $PackageDir ([string]$SubManifest.sourceFile)
  $ActualSourceSha = (Get-FileHash -LiteralPath $SourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualSourceSha -ne ([string]$SubManifest.sourceSha256).ToLowerInvariant() -or
      $ActualSourceSha -ne ([string]$Subwave.sourceSha256).ToLowerInvariant()) {
    throw "Subwave source SHA-256 mismatch: $($Subwave.subwaveId)"
  }
  $SourceStats = Get-JsonlStats $SourceFile $GlobalSeen
  if ($SourceStats.Rows -ne $ExpectedRows) {
    throw "Subwave source row count mismatch: $($Subwave.subwaveId)"
  }
  $SubwaveRows += $SourceStats.Rows

  foreach ($Chunk in @($SubManifest.chunks | Sort-Object index)) {
    $ChunkFile = Assert-SafeRelativePath $PackageDir ([string]$Chunk.file)
    $ActualChunkSha = (Get-FileHash -LiteralPath $ChunkFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualChunkSha -ne ([string]$Chunk.sha256).ToLowerInvariant()) {
      throw "Chunk SHA-256 mismatch: $($Chunk.chunkId)"
    }
    $ChunkStats = Get-JsonlStats $ChunkFile
    if ($ChunkStats.Rows -ne [int]$Chunk.rowCount -or $ChunkStats.Rows -lt 1 -or $ChunkStats.Rows -gt 5) {
      throw "Chunk row count mismatch: $($Chunk.chunkId)"
    }
    $ChunkRows += $ChunkStats.Rows
    $ChunkCount += 1
  }
}
if ($SubwaveRows -ne $ExpectedResearchRows -or $GlobalSeen.Count -ne $ExpectedResearchRows -or
    $ChunkRows -ne $ExpectedResearchRows -or $ChunkCount -ne $ExpectedChunks) {
  throw "Wave 5 subwave or chunk aggregate mismatch"
}

Write-Host "[6/8] Install the local remediation package" -ForegroundColor Cyan
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[7/8] Run Wave 5 recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave5-deferred-remediation.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "Wave 5 remediation tests failed"
}

Write-Host "[8/8] Create the compact Wave 5 checkpoint" -ForegroundColor Cyan
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

Copy-Item -LiteralPath $ManifestFile -Destination (Join-Path $CheckpointDir "package-manifest.json") -Force
Copy-Item -LiteralPath $SummaryFile -Destination (Join-Path $CheckpointDir "selection-summary-v01.json") -Force
Copy-Item -LiteralPath $ValidationFile -Destination (Join-Path $CheckpointDir "input-validation-v01.json") -Force
Copy-Item -LiteralPath $PolicyFile -Destination (Join-Path $CheckpointDir "abo-grade-prefix-resolutions-v01.jsonl") -Force
Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $CheckpointDir "test-output.txt") -Force

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave5-remediation-install-v0.1"
  packageId = $PackageId
  packageZip = $SelectedZip.FullName
  packageZipSha256 = $ActualPackageZipSha256
  researchRows = $ExpectedResearchRows
  policyOnlyResolvedRows = $ExpectedPolicyResolvedRows
  subwaves = $ExpectedSubwaves
  chunks = $ExpectedChunks
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
  ResearchRows = $ExpectedResearchRows
  PolicyOnlyResolvedRows = $ExpectedPolicyResolvedRows
  NewAssessmentRefreshRows = $ExpectedNewDeferredRows
  RuleConflictResearchRows = $ExpectedRuleConflictRows
  RouteReviewRows = $ExpectedRouteReviewRows
  EvidenceRefreshRows = $ExpectedEvidenceRefreshRows
  Subwaves = $ExpectedSubwaves
  Chunks = $ExpectedChunks
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List
