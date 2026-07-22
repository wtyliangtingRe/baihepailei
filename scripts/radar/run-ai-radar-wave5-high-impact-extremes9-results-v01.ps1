param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE5-HIGH-IMPACT-EXTREMES9-RESEARCH-RESULTS-v01"
$ExpectedPackageZipSha256 = "9cc0c9df244135538547582558e70db82afbea3ee221374272c2e2d1a64cc578"
$ExpectedSourceInputZipSha256 = "323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3"
$ExpectedSourceCheckpointZipSha256 = "60aeee09bc022fdbb06635a5aa496f93d786832fd05eecdf6b48b3c71a7d19eb"
$ExpectedPolicyCommit = "2b3f6a088b1c91889e10738c362e8350468477fd"

$ExpectedRows = 9
$ExpectedPassedRows = 9
$ExpectedDeferredRows = 0
$ExpectedGradeS = 1
$ExpectedGradeF = 8
$ExpectedRuleSRelationship = 1
$ExpectedRuleSCreatorSafe = 1
$ExpectedRuleFMaleNtr = 2
$ExpectedRuleFProjectContamination = 6
$ExpectedRetained = 7
$ExpectedRuleNarrowed = 2

$ExpectedIdentities = @(
  "4225|work:mgv2-00488-安达与岛村ss",
  "4601|work:mgv2-00864-捏造トラップ-ntr-1",
  "4717|work:mgv2-00980-捏造トラップ-ntr-2",
  "30235|catalog-bangumi-371692",
  "30234|catalog-bangumi-486264",
  "27834|catalog-anilist-180516",
  "27837|catalog-anilist-148370",
  "27838|catalog-anilist-176299",
  "27839|catalog-anilist-172420"
)

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave5-high-impact-extremes9-results-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "RADAR-WAVE5-HIGH-IMPACT-EXTREMES9-RESEARCH-RESULTS-checkpoint-v01"
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
  $ByPreviousGrade = @{}
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
    Increment-Count $ByPreviousGrade ([string]$Row.previousGrade)
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
    ByPreviousGrade = $ByPreviousGrade
    ByRule = $ByRule
    ByQaStatus = $ByQaStatus
    ByChangeType = $ByChangeType
  }
}

Write-Host "[1/8] Locate and bind the Wave 5 extremes-9 result package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "Extremes-9 result ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/8] Extract and verify every declared package hash" -ForegroundColor Cyan
Assert-UnderDataLocal $PackageDir | Out-Null
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$SummaryFile = Join-Path $PackageDir "summary\extremes9-summary-v01.json"
$ValidationFile = Join-Path $PackageDir "validation\package-validation-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
$AllFile = Join-Path $PackageDir "results\extremes9-all-v01.jsonl"
$PassedFile = Join-Path $PackageDir "results\extremes9-ai-qa-passed-v01.jsonl"
$DeferredFile = Join-Path $PackageDir "results\extremes9-ai-qa-deferred-v01.jsonl"
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

Write-Host "[3/8] Verify source chain, policy binding and safety declarations" -ForegroundColor Cyan
$Manifest = Read-Json $ManifestFile
$Summary = Read-Json $SummaryFile
$Validation = Read-Json $ValidationFile

if ([string]$Manifest.packageId -ne $PackageId) {
  throw "Unexpected packageId: $($Manifest.packageId)"
}
if ([string]$Manifest.sourceHighImpactInputZip.sha256 -ne $ExpectedSourceInputZipSha256) {
  throw "Result package is not bound to the verified high-impact input ZIP"
}
if ([string]$Manifest.sourceHighImpactInputCheckpoint.sha256 -ne $ExpectedSourceCheckpointZipSha256) {
  throw "Result package is not bound to the verified high-impact input checkpoint"
}
if ([string]$Manifest.sourcePolicy.commit -ne $ExpectedPolicyCommit -or
    [string]$Manifest.sourcePolicy.path -ne "src/lib/radar/ratingPolicy.ts") {
  throw "Result package is not bound to the expected rating policy"
}
if ($Validation.complete -ne $true -or @($Validation.validationErrors).Count -ne 0) {
  throw "Extremes-9 package validation is incomplete"
}
if ($Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "Extremes-9 package safety declarations are not acceptable"
}

if ([int]$Summary.rows -ne $ExpectedRows -or
    [int]$Summary.aiQaPassedRows -ne $ExpectedPassedRows -or
    [int]$Summary.aiQaDeferredRows -ne $ExpectedDeferredRows -or
    [int]$Summary.byRecommendedGrade.S -ne $ExpectedGradeS -or
    [int]$Summary.byRecommendedGrade.F -ne $ExpectedGradeF -or
    [int]$Summary.byRecommendedRule.'S-RELATIONSHIP' -ne $ExpectedRuleSRelationship -or
    [int]$Summary.byRecommendedRule.'S-CREATOR-SAFE' -ne $ExpectedRuleSCreatorSafe -or
    [int]$Summary.byRecommendedRule.'F-MALE-NTR' -ne $ExpectedRuleFMaleNtr -or
    [int]$Summary.byRecommendedRule.'F-PROJECT-CONTAMINATION' -ne $ExpectedRuleFProjectContamination) {
  throw "Extremes-9 summary distribution does not match"
}

Write-Host "[4/8] Verify all, passed and deferred identity partitions" -ForegroundColor Cyan
$AllStats = Get-JsonlStats $AllFile
$PassedStats = Get-JsonlStats $PassedFile
$DeferredStats = Get-JsonlStats $DeferredFile

if ($AllStats.Rows -ne $ExpectedRows -or
    $PassedStats.Rows -ne $ExpectedPassedRows -or
    $DeferredStats.Rows -ne $ExpectedDeferredRows) {
  throw "Extremes-9 result row counts do not match"
}

$ExpectedIdentitySet = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]$ExpectedIdentities,
  [System.StringComparer]::Ordinal
)
if ($ExpectedIdentitySet.Count -ne $ExpectedRows) {
  throw "Hard-coded expected identity list is invalid"
}
foreach ($Identity in $AllStats.Identities) {
  if (-not $ExpectedIdentitySet.Contains($Identity)) {
    throw "Unexpected identity in extremes-9 results: $Identity"
  }
}
foreach ($Identity in $ExpectedIdentitySet) {
  if (-not $AllStats.Identities.Contains($Identity)) {
    throw "Expected identity missing from extremes-9 results: $Identity"
  }
}

$PartitionSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($Identity in $PassedStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) { throw "Duplicate identity in result partitions: $Identity" }
}
foreach ($Identity in $DeferredStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) { throw "Duplicate identity in result partitions: $Identity" }
}
if ($PartitionSeen.Count -ne $ExpectedRows) {
  throw "Passed and deferred partitions do not cover all extremes-9 rows"
}
foreach ($Identity in $AllStats.Identities) {
  if (-not $PartitionSeen.Contains($Identity)) {
    throw "Identity missing from passed/deferred partitions: $Identity"
  }
}

Write-Host "[5/8] Verify grade, rule, QA and change-type distributions" -ForegroundColor Cyan
if ([int]$AllStats.ByPreviousGrade.S -ne 1 -or
    [int]$AllStats.ByPreviousGrade.F -ne 8 -or
    [int]$AllStats.ByGrade.S -ne $ExpectedGradeS -or
    [int]$AllStats.ByGrade.F -ne $ExpectedGradeF -or
    [int]$AllStats.ByRule.'S-RELATIONSHIP' -ne $ExpectedRuleSRelationship -or
    [int]$AllStats.ByRule.'S-CREATOR-SAFE' -ne $ExpectedRuleSCreatorSafe -or
    [int]$AllStats.ByRule.'F-MALE-NTR' -ne $ExpectedRuleFMaleNtr -or
    [int]$AllStats.ByRule.'F-PROJECT-CONTAMINATION' -ne $ExpectedRuleFProjectContamination -or
    [int]$AllStats.ByQaStatus.ai_qa_passed -ne $ExpectedPassedRows -or
    $AllStats.ByQaStatus.ContainsKey("ai_qa_deferred") -or
    [int]$AllStats.ByChangeType.retained -ne $ExpectedRetained -or
    [int]$AllStats.ByChangeType.rule_narrowed -ne $ExpectedRuleNarrowed) {
  throw "Extremes-9 JSONL distribution does not match the verified summary"
}

Write-Host "[6/8] Install local extremes-9 result queues" -ForegroundColor Cyan
Assert-UnderDataLocal $OutputRoot | Out-Null
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[7/8] Run Wave 5 extremes-9 recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave5-high-impact-extremes9-results.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "Wave 5 extremes-9 result tests failed"
}

Write-Host "[8/8] Create the compact extremes-9 result checkpoint" -ForegroundColor Cyan
Assert-UnderDataLocal $CheckpointDir | Out-Null
Assert-UnderDataLocal $CheckpointZip | Out-Null
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

Copy-Item -LiteralPath $ManifestFile -Destination (Join-Path $CheckpointDir "package-manifest.json") -Force
Copy-Item -LiteralPath $SummaryFile -Destination (Join-Path $CheckpointDir "extremes9-summary-v01.json") -Force
Copy-Item -LiteralPath $ValidationFile -Destination (Join-Path $CheckpointDir "package-validation-v01.json") -Force
Copy-Item -LiteralPath $AllFile -Destination (Join-Path $CheckpointDir "extremes9-all-v01.jsonl") -Force
Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $CheckpointDir "test-output.txt") -Force

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave5-high-impact-extremes9-install-v0.1"
  packageId = $PackageId
  packageZip = $SelectedZip.FullName
  packageZipSha256 = $ActualPackageZipSha256
  sourceInputZipSha256 = $ExpectedSourceInputZipSha256
  sourceCheckpointZipSha256 = $ExpectedSourceCheckpointZipSha256
  policyCommit = $ExpectedPolicyCommit
  rows = $ExpectedRows
  aiQaPassedRows = $ExpectedPassedRows
  aiQaDeferredRows = $ExpectedDeferredRows
  gradeS = $ExpectedGradeS
  gradeF = $ExpectedGradeF
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
  GradeS = $ExpectedGradeS
  GradeF = $ExpectedGradeF
  RuleFMaleNtr = $ExpectedRuleFMaleNtr
  RuleFProjectContamination = $ExpectedRuleFProjectContamination
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List
