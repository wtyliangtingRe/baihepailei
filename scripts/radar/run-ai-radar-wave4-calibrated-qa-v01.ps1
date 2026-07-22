param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE4-CALIBRATED-ASSESSMENT-AND-LEGACY-QA-v01"
$ExpectedPackageZipSha256 = "eeebc2474a98e0c5e89348aabb8ceb1f038a076da0b46c16b827a40daf158ec6"
$ExpectedSourceResultZipSha256 = "3a99ee6aad204bce0b26329b7543ea0b7eae92d862ce2db2aca0d156a113072d"
$ExpectedSourceCheckpointZipSha256 = "552b7f3e1ff3f7a3f909e0932dd972a92fd03ba64830d2d63619f54a77fcce66"

$ExpectedNewAssessmentRows = 10
$ExpectedGradeA = 6
$ExpectedGradeE = 4
$ExpectedNewQaPassed = 8
$ExpectedNewQaDeferred = 2

$ExpectedLegacyRows = 10223
$ExpectedLegacyPassed = 1200
$ExpectedLegacyPassedWithCaution = 839
$ExpectedLegacyDeferredEvidence = 8148
$ExpectedLegacyDeferredRouteReview = 32
$ExpectedLegacyDeferredRuleConflict = 4
$ExpectedLegacyValidated = 2039
$ExpectedLegacyDeferred = 8184

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave4-calibrated-qa-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "RADAR-WAVE4-CALIBRATED-ASSESSMENT-AND-LEGACY-QA-checkpoint-v01"
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
  $Text = $Value | ConvertTo-Json -Depth 40
  [System.IO.File]::WriteAllText($File, "$Text`n", $Utf8NoBom)
}

function Get-JsonlStats([string]$File) {
  $Rows = 0
  $Seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($Line in Get-Content -LiteralPath $File -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($Line)) { continue }
    $Row = $Line | ConvertFrom-Json
    $Identity = "$($Row.workId)|$($Row.siteId)"
    if (-not $Seen.Add($Identity)) {
      throw "Duplicate identity in $(Split-Path $File -Leaf): $Identity"
    }
    $Rows += 1
  }
  return [pscustomobject]@{ Rows = $Rows; UniqueIdentities = $Seen.Count }
}

Write-Host "[1/7] Locate and bind the calibrated assessment package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "Calibrated QA ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/7] Extract and verify every declared SHA-256" -ForegroundColor Cyan
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$ValidationFile = Join-Path $PackageDir "validation\package-validation-v01.json"
$NewSummaryFile = Join-Path $PackageDir "new-assessments\ready10-summary-v01.json"
$LegacySummaryFile = Join-Path $PackageDir "legacy-qa\legacy-ai-qa-summary-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"

foreach ($Required in @(
  $ManifestFile,
  $ValidationFile,
  $NewSummaryFile,
  $LegacySummaryFile,
  $HashFile
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

Write-Host "[3/7] Verify source binding, counts and safety declarations" -ForegroundColor Cyan
$Manifest = Read-Json $ManifestFile
$Validation = Read-Json $ValidationFile
$NewSummary = Read-Json $NewSummaryFile
$LegacySummary = Read-Json $LegacySummaryFile

if ([string]$Manifest.packageId -ne $PackageId) {
  throw "Unexpected packageId: $($Manifest.packageId)"
}
if ([string]$Manifest.sourceResultZip.sha256 -ne $ExpectedSourceResultZipSha256) {
  throw "Package is not bound to the verified Wave 4 result ZIP"
}
if ([string]$Manifest.sourceCheckpointZip.sha256 -ne $ExpectedSourceCheckpointZipSha256) {
  throw "Package is not bound to the verified Wave 4 checkpoint ZIP"
}
if ($Validation.complete -ne $true -or @($Validation.validationErrors).Count -ne 0) {
  throw "Package validation is incomplete"
}
if ($Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "Package safety declarations are not acceptable"
}

if ([int]$NewSummary.rows -ne $ExpectedNewAssessmentRows -or
    [int]$NewSummary.byGrade.A -ne $ExpectedGradeA -or
    [int]$NewSummary.byGrade.E -ne $ExpectedGradeE -or
    [int]$NewSummary.byAiQaStatus.ai_qa_passed -ne $ExpectedNewQaPassed -or
    [int]$NewSummary.byAiQaStatus.ai_qa_deferred -ne $ExpectedNewQaDeferred) {
  throw "New assessment summary does not match the verified result"
}

if ([int]$LegacySummary.rows -ne $ExpectedLegacyRows -or
    [int]$LegacySummary.byDisposition.passed -ne $ExpectedLegacyPassed -or
    [int]$LegacySummary.byDisposition.passed_with_caution -ne $ExpectedLegacyPassedWithCaution -or
    [int]$LegacySummary.byDisposition.deferred_evidence -ne $ExpectedLegacyDeferredEvidence -or
    [int]$LegacySummary.byDisposition.deferred_route_review -ne $ExpectedLegacyDeferredRouteReview -or
    [int]$LegacySummary.byDisposition.deferred_rule_conflict -ne $ExpectedLegacyDeferredRuleConflict -or
    [int]$LegacySummary.validatedGradeRows -ne $ExpectedLegacyValidated -or
    [int]$LegacySummary.deferredRows -ne $ExpectedLegacyDeferred) {
  throw "Legacy QA summary does not match the verified result"
}

Write-Host "[4/7] Verify JSONL identity sets and queue partitions" -ForegroundColor Cyan
$QueueExpectations = @(
  @{ File = "new-assessments\ready10-assessments-v01.jsonl"; Rows = 10 },
  @{ File = "new-assessments\ready10-ai-qa-passed-v01.jsonl"; Rows = 8 },
  @{ File = "new-assessments\ready10-ai-qa-deferred-v01.jsonl"; Rows = 2 },
  @{ File = "legacy-qa\legacy-ai-qa-all-v01.jsonl"; Rows = 10223 },
  @{ File = "legacy-qa\legacy-ai-qa-passed-v01.jsonl"; Rows = 1200 },
  @{ File = "legacy-qa\legacy-ai-qa-passed-with-caution-v01.jsonl"; Rows = 839 },
  @{ File = "legacy-qa\legacy-ai-qa-deferred-evidence-v01.jsonl"; Rows = 8148 },
  @{ File = "legacy-qa\legacy-ai-qa-deferred-route-review-v01.jsonl"; Rows = 32 },
  @{ File = "legacy-qa\legacy-ai-qa-deferred-rule-conflict-v01.jsonl"; Rows = 4 }
)
foreach ($Queue in $QueueExpectations) {
  $File = Join-Path $PackageDir $Queue.File
  if (-not (Test-Path -LiteralPath $File)) {
    throw "Queue file missing: $($Queue.File)"
  }
  $Stats = Get-JsonlStats $File
  if ($Stats.Rows -ne [int]$Queue.Rows -or $Stats.UniqueIdentities -ne [int]$Queue.Rows) {
    throw "Queue count or identity mismatch: $($Queue.File)"
  }
}

Write-Host "[5/7] Install local assessment and QA queues" -ForegroundColor Cyan
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[6/7] Run calibrated QA recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave4-calibrated-qa.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "Wave 4 calibrated QA tests failed"
}

Write-Host "[7/7] Create the compact recovery checkpoint" -ForegroundColor Cyan
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

foreach ($Item in @(
  @{ Source = $ManifestFile; Target = "package-manifest.json" },
  @{ Source = $ValidationFile; Target = "package-validation-v01.json" },
  @{ Source = $NewSummaryFile; Target = "ready10-summary-v01.json" },
  @{ Source = $LegacySummaryFile; Target = "legacy-ai-qa-summary-v01.json" },
  @{ Source = (Join-Path $PackageDir "ASSESSMENT_REPORT.md"); Target = "ASSESSMENT_REPORT.md" },
  @{ Source = $TestOutput; Target = "test-output.txt" }
)) {
  Copy-Item -LiteralPath $Item.Source -Destination (Join-Path $CheckpointDir $Item.Target) -Force
}

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave4-calibrated-qa-install-v0.1"
  packageId = $PackageId
  packageZip = $SelectedZip.FullName
  packageZipSha256 = $ActualPackageZipSha256
  newAssessmentRows = $ExpectedNewAssessmentRows
  gradeA = $ExpectedGradeA
  gradeE = $ExpectedGradeE
  newAiQaPassed = $ExpectedNewQaPassed
  newAiQaDeferred = $ExpectedNewQaDeferred
  legacyRows = $ExpectedLegacyRows
  legacyValidatedRows = $ExpectedLegacyValidated
  legacyDeferredRows = $ExpectedLegacyDeferred
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

$CheckpointHashLines = @()
foreach ($File in Get-ChildItem -LiteralPath $CheckpointDir -File | Sort-Object Name) {
  if ($File.Name -eq "SHA256SUMS.txt") { continue }
  $Sha = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $CheckpointHashLines += "$Sha  $($File.Name)"
}
[System.IO.File]::WriteAllText(
  (Join-Path $CheckpointDir "SHA256SUMS.txt"),
  ($CheckpointHashLines -join "`n") + "`n",
  $Utf8NoBom
)

New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null
Compress-Archive -Path (Join-Path $CheckpointDir "*") -DestinationPath $CheckpointZip -CompressionLevel Optimal
$CheckpointZipSha256 = (
  Get-FileHash -LiteralPath $CheckpointZip -Algorithm SHA256
).Hash.ToLowerInvariant()

[pscustomobject]@{
  PackageId = $PackageId
  NewAssessmentRows = $ExpectedNewAssessmentRows
  GradeA = $ExpectedGradeA
  GradeE = $ExpectedGradeE
  NewAiQaPassed = $ExpectedNewQaPassed
  NewAiQaDeferred = $ExpectedNewQaDeferred
  LegacyRows = $ExpectedLegacyRows
  LegacyValidatedRows = $ExpectedLegacyValidated
  LegacyDeferredRows = $ExpectedLegacyDeferred
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List

explorer.exe $CheckpointRoot
