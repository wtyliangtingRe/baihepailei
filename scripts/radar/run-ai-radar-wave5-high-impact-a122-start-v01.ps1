param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE5-HIGH-IMPACT-A122-input-v01"
$BatchId = "RADAR-WAVE5-HIGH-IMPACT-A122"
$ExpectedPackageZipSha256 = "903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb"
$ExpectedSourceInputZipSha256 = "323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3"
$ExpectedSourceInputCheckpointSha256 = "60aeee09bc022fdbb06635a5aa496f93d786832fd05eecdf6b48b3c71a7d19eb"
$ExpectedExtremesResultZipSha256 = "9cc0c9df244135538547582558e70db82afbea3ee221374272c2e2d1a64cc578"
$ExpectedExtremesCheckpointSha256 = "73eb281e548b8322c0692615dd4bceb538c9c558d73ef9c27fe19bf691d1579f"
$ExpectedPolicyCommit = "2719fe917f4e162590b19c1b0cc883eb08ee511d"

$ExpectedRows = 122
$ExpectedChunks = 25
$ExpectedFullChunks = 24
$ExpectedFinalChunkRows = 2
$ExpectedRuleNearConfirmed = 81
$ExpectedRuleOngoing = 29
$ExpectedRuleOpenEnd = 2
$ExpectedRuleYuriHarem = 11
$ExpectedEvidencePrimary = 3
$ExpectedEvidenceMultipleSecondary = 8
$ExpectedEvidenceSingleSecondary = 111
$ExpectedRiskCritical = 7
$ExpectedRiskHigh = 37
$ExpectedRiskMedium = 57
$ExpectedRiskStandard = 21
$ExpectedRouteConflict = 7
$ExpectedOpenEndFlag = 2
$ExpectedOngoingFlag = 29
$ExpectedLowCoverage = 18
$ExpectedLowConfidence = 98
$ExpectedMaleOrHetTerm = 9
$ExpectedSingleSecondaryFlag = 111
$ExpectedHaremFlag = 11

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave5-high-impact-a122-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "RADAR-WAVE5-HIGH-IMPACT-A122-input-checkpoint-v01"
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

function Increment-Count([hashtable]$Map, [string]$Key) {
  if (-not $Map.ContainsKey($Key)) { $Map[$Key] = 0 }
  $Map[$Key] += 1
}

function Get-RiskBand([int]$Score) {
  if ($Score -ge 100) { return "critical" }
  if ($Score -ge 60) { return "high" }
  if ($Score -ge 30) { return "medium" }
  return "standard"
}

function Get-JsonlStats([string]$File, [System.Collections.Generic.HashSet[string]]$GlobalSeen = $null) {
  $Rows = 0
  $Identities = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $AuditOrders = [System.Collections.Generic.HashSet[int]]::new()
  $ByGrade = @{}
  $ByRule = @{}
  $ByEvidenceStatus = @{}
  $ByAuditFlag = @{}
  $ByRiskBand = @{}

  foreach ($Line in Get-Content -LiteralPath $File -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($Line)) { continue }
    $Row = $Line | ConvertFrom-Json
    $Identity = "$($Row.workId)|$($Row.siteId)"
    if (-not $Identities.Add($Identity)) {
      throw "Duplicate identity in $(Split-Path $File -Leaf): $Identity"
    }
    if ($null -ne $GlobalSeen -and -not $GlobalSeen.Add($Identity)) {
      throw "Cross-file duplicate identity: $Identity"
    }
    if ([string]$Row.previousGrade -ne "A" -or
        [string]$Row.auditBatchId -ne $BatchId -or
        [string]$Row.requestedCompletion -ne "a_grade_safety_audit_then_calibrated_ai_qa" -or
        [string]$Row.publicationStatus -ne "do_not_publish" -or
        $Row.requiresHumanReview -ne $true -or
        $Row.safety.payloadWrite -ne $false -or
        $Row.safety.directPostgresqlWrite -ne $false -or
        $Row.safety.modifiesWorks -ne $false -or
        $Row.safety.publishesRatings -ne $false -or
        [int]$Row.humanTrackMutations -ne 0) {
      throw "Unsafe or malformed A122 task row: $Identity"
    }
    if (@($Row.auditQuestions).Count -lt 5) {
      throw "A122 task lacks complete audit questions: $Identity"
    }

    $Order = [int]$Row.auditOrder
    if ($Order -lt 1 -or $Order -gt $ExpectedRows -or -not $AuditOrders.Add($Order)) {
      throw "Invalid or duplicate audit order: $Order"
    }

    Increment-Count $ByGrade ([string]$Row.previousGrade)
    foreach ($Rule in @($Row.previousRuleCodes)) {
      Increment-Count $ByRule ([string]$Rule)
    }
    Increment-Count $ByEvidenceStatus ([string]$Row.evidenceStatus)
    foreach ($Flag in @($Row.auditFlags)) {
      Increment-Count $ByAuditFlag ([string]$Flag)
    }
    Increment-Count $ByRiskBand (Get-RiskBand ([int]$Row.auditRiskScore))
    $Rows += 1
  }

  return [pscustomobject]@{
    Rows = $Rows
    Identities = $Identities
    AuditOrders = $AuditOrders
    ByGrade = $ByGrade
    ByRule = $ByRule
    ByEvidenceStatus = $ByEvidenceStatus
    ByAuditFlag = $ByAuditFlag
    ByRiskBand = $ByRiskBand
  }
}

Write-Host "[1/8] Locate and bind the Wave 5 A122 audit package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "A122 package ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/8] Extract and verify every declared package hash" -ForegroundColor Cyan
Assert-UnderDataLocal $PackageDir | Out-Null
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$SummaryFile = Join-Path $PackageDir "selection-summary-v01.json"
$ValidationFile = Join-Path $PackageDir "validation\input-validation-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
$AggregateFile = Join-Path $PackageDir "aggregate\wave5-high-impact-a122-all-v01.jsonl"
$ReadmeFile = Join-Path $PackageDir "README.md"

foreach ($Required in @($ManifestFile, $SummaryFile, $ValidationFile, $HashFile, $AggregateFile, $ReadmeFile)) {
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
if ([string]$Manifest.sourceHighImpactInput.sha256 -ne $ExpectedSourceInputZipSha256 -or
    [string]$Manifest.sourceHighImpactInputCheckpoint.sha256 -ne $ExpectedSourceInputCheckpointSha256 -or
    [string]$Manifest.completedExtremes9Result.sha256 -ne $ExpectedExtremesResultZipSha256 -or
    [string]$Manifest.completedExtremes9Checkpoint.sha256 -ne $ExpectedExtremesCheckpointSha256 -or
    [string]$Manifest.sourcePolicy.commit -ne $ExpectedPolicyCommit) {
  throw "A122 package source chain does not match"
}
if ($Validation.complete -ne $true -or @($Validation.validationErrors).Count -ne 0) {
  throw "A122 package validation is incomplete"
}
if ([int]$Manifest.rows -ne $ExpectedRows -or
    [int]$Manifest.chunkCount -ne $ExpectedChunks -or
    [int]$Manifest.fullChunks -ne $ExpectedFullChunks -or
    [int]$Manifest.finalChunkRows -ne $ExpectedFinalChunkRows -or
    [int]$Summary.rows -ne $ExpectedRows -or
    [int]$Summary.uniqueIdentities -ne $ExpectedRows -or
    [int]$Summary.chunkCount -ne $ExpectedChunks -or
    [int]$Summary.finalChunkRows -ne $ExpectedFinalChunkRows -or
    [int]$Summary.selection.overlapWithCompletedExtremes9 -ne 0) {
  throw "A122 fixed counts do not match"
}
if ($Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "A122 package safety declarations are not acceptable"
}

Write-Host "[4/8] Verify aggregate identities and calibrated audit distributions" -ForegroundColor Cyan
$AggregateStats = Get-JsonlStats $AggregateFile
if ($AggregateStats.Rows -ne $ExpectedRows -or
    $AggregateStats.Identities.Count -ne $ExpectedRows -or
    $AggregateStats.AuditOrders.Count -ne $ExpectedRows) {
  throw "A122 aggregate row, identity or audit-order count mismatch"
}
for ($Order = 1; $Order -le $ExpectedRows; $Order += 1) {
  if (-not $AggregateStats.AuditOrders.Contains($Order)) {
    throw "A122 audit order is incomplete: $Order"
  }
}

if ([int]$AggregateStats.ByGrade.A -ne $ExpectedRows -or
    [int]$AggregateStats.ByRule.'A-NEAR-CONFIRMED' -ne $ExpectedRuleNearConfirmed -or
    [int]$AggregateStats.ByRule.'A-ONGOING' -ne $ExpectedRuleOngoing -or
    [int]$AggregateStats.ByRule.'A-OPEN-END' -ne $ExpectedRuleOpenEnd -or
    [int]$AggregateStats.ByRule.'A-YURI-HAREM' -ne $ExpectedRuleYuriHarem -or
    [int]$AggregateStats.ByEvidenceStatus.primary_material_confirmed -ne $ExpectedEvidencePrimary -or
    [int]$AggregateStats.ByEvidenceStatus.multiple_secondary_supported -ne $ExpectedEvidenceMultipleSecondary -or
    [int]$AggregateStats.ByEvidenceStatus.single_secondary_supported -ne $ExpectedEvidenceSingleSecondary -or
    [int]$AggregateStats.ByRiskBand.critical -ne $ExpectedRiskCritical -or
    [int]$AggregateStats.ByRiskBand.high -ne $ExpectedRiskHigh -or
    [int]$AggregateStats.ByRiskBand.medium -ne $ExpectedRiskMedium -or
    [int]$AggregateStats.ByRiskBand.standard -ne $ExpectedRiskStandard -or
    [int]$AggregateStats.ByAuditFlag.prior_route_conflict_summary -ne $ExpectedRouteConflict -or
    [int]$AggregateStats.ByAuditFlag.open_end_requires_resolution -ne $ExpectedOpenEndFlag -or
    [int]$AggregateStats.ByAuditFlag.ongoing_requires_current_status -ne $ExpectedOngoingFlag -or
    [int]$AggregateStats.ByAuditFlag.low_evidence_coverage -ne $ExpectedLowCoverage -or
    [int]$AggregateStats.ByAuditFlag.low_confidence -ne $ExpectedLowConfidence -or
    [int]$AggregateStats.ByAuditFlag.male_or_heterosexual_term_present -ne $ExpectedMaleOrHetTerm -or
    [int]$AggregateStats.ByAuditFlag.single_secondary_only -ne $ExpectedSingleSecondaryFlag -or
    [int]$AggregateStats.ByAuditFlag.multi_route_or_harem_structure -ne $ExpectedHaremFlag) {
  throw "A122 aggregate rule, evidence or audit distribution mismatch"
}

Write-Host "[5/8] Verify all 25 recoverable chunks and exact identity union" -ForegroundColor Cyan
$ChunkSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$ChunkRows = 0
$ChunkCount = 0
foreach ($Chunk in @($Manifest.chunks | Sort-Object index)) {
  $Index = [int]$Chunk.index
  $ExpectedChunkRows = if ($Index -lt $ExpectedChunks) { 5 } else { $ExpectedFinalChunkRows }
  if ([int]$Chunk.rowCount -ne $ExpectedChunkRows) {
    throw "Unexpected A122 chunk size: $($Chunk.chunkId)"
  }
  $ChunkFile = Assert-SafeRelativePath $PackageDir ([string]$Chunk.file)
  $ActualChunkSha = (Get-FileHash -LiteralPath $ChunkFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualChunkSha -ne ([string]$Chunk.sha256).ToLowerInvariant()) {
    throw "A122 chunk SHA-256 mismatch: $($Chunk.chunkId)"
  }
  $ChunkStats = Get-JsonlStats $ChunkFile $ChunkSeen
  if ($ChunkStats.Rows -ne $ExpectedChunkRows) {
    throw "A122 chunk row count mismatch: $($Chunk.chunkId)"
  }
  $ChunkRows += $ChunkStats.Rows
  $ChunkCount += 1
}
if ($ChunkRows -ne $ExpectedRows -or
    $ChunkCount -ne $ExpectedChunks -or
    $ChunkSeen.Count -ne $ExpectedRows) {
  throw "A122 chunk aggregate mismatch"
}
foreach ($Identity in $AggregateStats.Identities) {
  if (-not $ChunkSeen.Contains($Identity)) {
    throw "Aggregate identity missing from A122 chunks: $Identity"
  }
}
foreach ($Identity in $ChunkSeen) {
  if (-not $AggregateStats.Identities.Contains($Identity)) {
    throw "Unexpected identity in A122 chunks: $Identity"
  }
}

Write-Host "[6/8] Install the local A122 audit package" -ForegroundColor Cyan
Assert-UnderDataLocal $OutputRoot | Out-Null
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[7/8] Run Wave 5 A122 recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave5-high-impact-a122.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "Wave 5 A122 tests failed"
}

Write-Host "[8/8] Create the compact A122 input checkpoint" -ForegroundColor Cyan
Assert-UnderDataLocal $CheckpointDir | Out-Null
Assert-UnderDataLocal $CheckpointZip | Out-Null
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

Copy-Item -LiteralPath $ManifestFile -Destination (Join-Path $CheckpointDir "package-manifest.json") -Force
Copy-Item -LiteralPath $SummaryFile -Destination (Join-Path $CheckpointDir "selection-summary-v01.json") -Force
Copy-Item -LiteralPath $ValidationFile -Destination (Join-Path $CheckpointDir "input-validation-v01.json") -Force
Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $CheckpointDir "test-output.txt") -Force

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave5-high-impact-a122-install-v0.1"
  packageId = $PackageId
  packageZip = $SelectedZip.FullName
  packageZipSha256 = $ActualPackageZipSha256
  sourceInputZipSha256 = $ExpectedSourceInputZipSha256
  sourceInputCheckpointSha256 = $ExpectedSourceInputCheckpointSha256
  completedExtremesResultZipSha256 = $ExpectedExtremesResultZipSha256
  completedExtremesCheckpointSha256 = $ExpectedExtremesCheckpointSha256
  policyCommit = $ExpectedPolicyCommit
  rows = $ExpectedRows
  chunks = $ExpectedChunks
  riskCritical = $ExpectedRiskCritical
  riskHigh = $ExpectedRiskHigh
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
$CheckpointZipSha256 = (
  Get-FileHash -LiteralPath $CheckpointZip -Algorithm SHA256
).Hash.ToLowerInvariant()

[pscustomobject]@{
  PackageId = $PackageId
  Rows = $ExpectedRows
  RuleANearConfirmed = $ExpectedRuleNearConfirmed
  RuleAOngoing = $ExpectedRuleOngoing
  RuleAOpenEnd = $ExpectedRuleOpenEnd
  RuleAYuriHarem = $ExpectedRuleYuriHarem
  RiskCritical = $ExpectedRiskCritical
  RiskHigh = $ExpectedRiskHigh
  Chunks = $ExpectedChunks
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List
