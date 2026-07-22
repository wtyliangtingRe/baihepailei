param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE5-PRIORITY35-RESEARCH-RESULTS-v01"
$ExpectedPackageZipSha256 = "a09702bb94367ad3149b1b976309e70aef54e9ee2d3f245dbcfb77c1f089550f"
$ExpectedSourceInputZipSha256 = "9d0f9f6002681b3851d1aaa3da9970af03396d222cfc1015cf4ee42f9e2c9be3"
$ExpectedSourceCheckpointZipSha256 = "c3c0f21cfe3a3c3c2f10a4d0393d8ecf5c0a79b1c0a3f04c85a97ab6f84c7f76"

$ExpectedRows = 35
$ExpectedPassedRows = 34
$ExpectedDeferredRows = 1
$ExpectedGradeA = 3
$ExpectedGradeD = 32
$ExpectedRuleANearConfirmed = 2
$ExpectedRuleAYuriHarem = 1
$ExpectedRuleDABO = 1
$ExpectedRuleDMultiEnding = 15
$ExpectedRuleDGeneral = 15
$ExpectedRuleDUnclear = 1
$ExpectedRetained = 17
$ExpectedGradeAndRuleChanged = 2
$ExpectedRuleChanged = 15
$ExpectedDeferredReclassification = 1

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave5-priority35-results-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "RADAR-WAVE5-PRIORITY35-RESEARCH-RESULTS-checkpoint-v01"
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

function Get-JsonlStats([string]$File) {
  $Rows = 0
  $Identities = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $ByGrade = @{}
  $ByRule = @{}
  $ByQaStatus = @{}
  $ByChangeType = @{}

  foreach ($Line in Get-Content -LiteralPath $File -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($Line)) { continue }
    $Row = $Line | ConvertFrom-Json
    $Identity = "$($Row.workId)|$($Row.siteId)"
    if (-not $Identities.Add($Identity)) {
      throw "Duplicate identity in $(Split-Path $File -Leaf): $Identity"
    }
    if ([string]$Row.publicationStatus -ne "do_not_publish" -or
        $Row.requiresHumanReview -ne $true -or
        $Row.safety.payloadWrite -ne $false -or
        $Row.safety.directPostgresqlWrite -ne $false -or
        $Row.safety.modifiesWorks -ne $false -or
        $Row.safety.publishesRatings -ne $false -or
        [int]$Row.safety.humanTrackMutations -ne 0) {
      throw "Unsafe or publication-ready result row: $Identity"
    }

    Increment-Count $ByGrade ([string]$Row.recommendedGrade)
    foreach ($Rule in @($Row.recommendedRuleCodes)) {
      Increment-Count $ByRule ([string]$Rule)
    }
    Increment-Count $ByQaStatus ([string]$Row.aiQaStatus)
    Increment-Count $ByChangeType ([string]$Row.changeType)
    $Rows += 1
  }

  return [pscustomobject]@{
    Rows = $Rows
    Identities = $Identities
    ByGrade = $ByGrade
    ByRule = $ByRule
    ByQaStatus = $ByQaStatus
    ByChangeType = $ByChangeType
  }
}

Write-Host "[1/8] Locate and bind the Wave 5 priority-35 result package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "Priority-35 result ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/8] Extract and verify every declared package hash" -ForegroundColor Cyan
Assert-UnderDataLocal $PackageDir | Out-Null
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$SummaryFile = Join-Path $PackageDir "summary\priority35-summary-v01.json"
$ValidationFile = Join-Path $PackageDir "validation\package-validation-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
$AllFile = Join-Path $PackageDir "results\priority35-all-v01.jsonl"
$PassedFile = Join-Path $PackageDir "results\priority35-ai-qa-passed-v01.jsonl"
$DeferredFile = Join-Path $PackageDir "results\priority35-ai-qa-deferred-v01.jsonl"
$ReportFile = Join-Path $PackageDir "REPORT.md"

foreach ($Required in @(
  $ManifestFile,
  $SummaryFile,
  $ValidationFile,
  $HashFile,
  $AllFile,
  $PassedFile,
  $DeferredFile,
  $ReportFile
)) {
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

Write-Host "[3/8] Verify source binding, summaries and safety declarations" -ForegroundColor Cyan
$Manifest = Read-Json $ManifestFile
$Summary = Read-Json $SummaryFile
$Validation = Read-Json $ValidationFile

if ([string]$Manifest.packageId -ne $PackageId) {
  throw "Unexpected packageId: $($Manifest.packageId)"
}
if ([string]$Manifest.sourceInputZip.sha256 -ne $ExpectedSourceInputZipSha256) {
  throw "Result package is not bound to the verified Wave 5 input ZIP"
}
if ([string]$Manifest.sourceCheckpointZip.sha256 -ne $ExpectedSourceCheckpointZipSha256) {
  throw "Result package is not bound to the verified Wave 5 input checkpoint"
}
if ($Validation.complete -ne $true -or @($Validation.validationErrors).Count -ne 0) {
  throw "Priority-35 package validation is incomplete"
}
if ($Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "Priority-35 package safety declarations are not acceptable"
}

if ([int]$Summary.rows -ne $ExpectedRows -or
    [int]$Summary.aiQaPassedRows -ne $ExpectedPassedRows -or
    [int]$Summary.aiQaDeferredRows -ne $ExpectedDeferredRows -or
    [int]$Summary.byRecommendedGrade.A -ne $ExpectedGradeA -or
    [int]$Summary.byRecommendedGrade.D -ne $ExpectedGradeD -or
    [int]$Summary.byRecommendedRule.'A-NEAR-CONFIRMED' -ne $ExpectedRuleANearConfirmed -or
    [int]$Summary.byRecommendedRule.'A-YURI-HAREM' -ne $ExpectedRuleAYuriHarem -or
    [int]$Summary.byRecommendedRule.'D-ABO' -ne $ExpectedRuleDABO -or
    [int]$Summary.byRecommendedRule.'D-MULTI-ENDING' -ne $ExpectedRuleDMultiEnding -or
    [int]$Summary.byRecommendedRule.'D-GENERAL' -ne $ExpectedRuleDGeneral -or
    [int]$Summary.byRecommendedRule.'D-UNCLEAR' -ne $ExpectedRuleDUnclear) {
  throw "Priority-35 summary grade or rule distribution does not match"
}

Write-Host "[4/8] Verify all, passed and deferred identity partitions" -ForegroundColor Cyan
$AllStats = Get-JsonlStats $AllFile
$PassedStats = Get-JsonlStats $PassedFile
$DeferredStats = Get-JsonlStats $DeferredFile

if ($AllStats.Rows -ne $ExpectedRows -or
    $PassedStats.Rows -ne $ExpectedPassedRows -or
    $DeferredStats.Rows -ne $ExpectedDeferredRows) {
  throw "Priority-35 result row counts do not match"
}

$PartitionSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($Identity in $PassedStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) { throw "Duplicate identity in result partitions: $Identity" }
}
foreach ($Identity in $DeferredStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) { throw "Duplicate identity in result partitions: $Identity" }
}
if ($PartitionSeen.Count -ne $ExpectedRows) {
  throw "Passed and deferred partitions do not cover all priority rows"
}
foreach ($Identity in $AllStats.Identities) {
  if (-not $PartitionSeen.Contains($Identity)) {
    throw "Identity missing from passed/deferred partitions: $Identity"
  }
}
foreach ($Identity in $PartitionSeen) {
  if (-not $AllStats.Identities.Contains($Identity)) {
    throw "Unexpected identity in passed/deferred partitions: $Identity"
  }
}

Write-Host "[5/8] Verify grade, rule, QA and change-type distributions" -ForegroundColor Cyan
if ([int]$AllStats.ByGrade.A -ne $ExpectedGradeA -or
    [int]$AllStats.ByGrade.D -ne $ExpectedGradeD -or
    [int]$AllStats.ByRule.'A-NEAR-CONFIRMED' -ne $ExpectedRuleANearConfirmed -or
    [int]$AllStats.ByRule.'A-YURI-HAREM' -ne $ExpectedRuleAYuriHarem -or
    [int]$AllStats.ByRule.'D-ABO' -ne $ExpectedRuleDABO -or
    [int]$AllStats.ByRule.'D-MULTI-ENDING' -ne $ExpectedRuleDMultiEnding -or
    [int]$AllStats.ByRule.'D-GENERAL' -ne $ExpectedRuleDGeneral -or
    [int]$AllStats.ByRule.'D-UNCLEAR' -ne $ExpectedRuleDUnclear -or
    [int]$AllStats.ByQaStatus.ai_qa_passed -ne $ExpectedPassedRows -or
    [int]$AllStats.ByQaStatus.ai_qa_deferred -ne $ExpectedDeferredRows -or
    [int]$AllStats.ByChangeType.retained -ne $ExpectedRetained -or
    [int]$AllStats.ByChangeType.grade_and_rule_changed -ne $ExpectedGradeAndRuleChanged -or
    [int]$AllStats.ByChangeType.rule_changed -ne $ExpectedRuleChanged -or
    [int]$AllStats.ByChangeType.deferred_reclassification -ne $ExpectedDeferredReclassification) {
  throw "Priority-35 JSONL distribution does not match the verified summary"
}

Write-Host "[6/8] Install local priority result queues" -ForegroundColor Cyan
Assert-UnderDataLocal $OutputRoot | Out-Null
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[7/8] Run Wave 5 priority-35 recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave5-priority35-results.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "Wave 5 priority-35 result tests failed"
}

Write-Host "[8/8] Create the compact priority result checkpoint" -ForegroundColor Cyan
Assert-UnderDataLocal $CheckpointDir | Out-Null
Assert-UnderDataLocal $CheckpointZip | Out-Null
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

Copy-Item -LiteralPath $ManifestFile -Destination (Join-Path $CheckpointDir "package-manifest.json") -Force
Copy-Item -LiteralPath $SummaryFile -Destination (Join-Path $CheckpointDir "priority35-summary-v01.json") -Force
Copy-Item -LiteralPath $ValidationFile -Destination (Join-Path $CheckpointDir "package-validation-v01.json") -Force
Copy-Item -LiteralPath $AllFile -Destination (Join-Path $CheckpointDir "priority35-all-v01.jsonl") -Force
Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $CheckpointDir "test-output.txt") -Force

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave5-priority35-install-v0.1"
  packageId = $PackageId
  packageZip = $SelectedZip.FullName
  packageZipSha256 = $ActualPackageZipSha256
  sourceInputZipSha256 = $ExpectedSourceInputZipSha256
  sourceCheckpointZipSha256 = $ExpectedSourceCheckpointZipSha256
  rows = $ExpectedRows
  aiQaPassedRows = $ExpectedPassedRows
  aiQaDeferredRows = $ExpectedDeferredRows
  gradeA = $ExpectedGradeA
  gradeD = $ExpectedGradeD
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
  AiQaPassedRows = $ExpectedPassedRows
  AiQaDeferredRows = $ExpectedDeferredRows
  GradeA = $ExpectedGradeA
  GradeD = $ExpectedGradeD
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List
