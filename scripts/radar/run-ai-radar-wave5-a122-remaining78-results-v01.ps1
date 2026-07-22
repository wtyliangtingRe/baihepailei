param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE5-A122-REMAINING78-RESEARCH-RESULTS-v01"
$ExpectedPackageZipSha256 = "8890a2afc4c16e9c90fcf03d6d922dececb129d3c1359931c3cf8155f1de0ee1"
$ExpectedSourceInputZipSha256 = "903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb"
$ExpectedSourceInputCheckpointSha256 = "9334cc17004d40837dc3db5182867099e1367e92c0e66e0d4c78290aa3f4771e"
$ExpectedCompleted44ZipSha256 = "2bb8b6f41e89c5dc858a4236d2e7badd9080ef03d7315b439eacbc612ce0c07d"
$ExpectedCompleted44CheckpointSha256 = "5e23e6da9b767362a1a44580b6f325904e70d44d1028efac7d4c4acbd6ade46e"
$ExpectedPolicyCommit = "ebd74a16fa0fec25b794ee84a728ccbcd5009457"
$ExpectedPolicyId = "radar-rating-policy-v0.4-draft"

$ExpectedRows = 78
$ExpectedPassedRows = 72
$ExpectedDeferredRows = 6
$ExpectedAuditStart = 45
$ExpectedAuditEnd = 122
$ExpectedIdentitySetSha256 = "7a7962bd4efa51d1e7f2eac5bfcd3fe737feb51b3a30748b2c756d6ab335fff1"
$ExpectedAuditIdentityMapSha256 = "21380fbdd8d8523aeceb2030b2dbc6ed643b39fd447453ae6b30469367f05653"

$ExpectedGradeS = 21
$ExpectedGradeA = 47
$ExpectedGradeB = 5
$ExpectedGradeD = 5

$ExpectedRuleSRelationship = 19
$ExpectedRuleSMarriage = 2
$ExpectedRuleANearConfirmed = 30
$ExpectedRuleAOngoing = 9
$ExpectedRuleAYuriHarem = 8
$ExpectedRuleBFemaleNtr = 1
$ExpectedRuleBLight = 3
$ExpectedRuleBUnfinishedCreatorRisk = 1
$ExpectedRuleDUnclear = 5

$ExpectedRetained = 36
$ExpectedRuleChanged = 10
$ExpectedGradeAndRuleChanged = 26
$ExpectedDeferredReclassification = 6

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave5-a122-remaining78-results-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "RADAR-WAVE5-A122-REMAINING78-RESEARCH-RESULTS-checkpoint-v01"
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

function Get-MapCount([hashtable]$Map, [string]$Key) {
  if ($Map.ContainsKey($Key)) { return [int]$Map[$Key] }
  return 0
}

function Get-PropertyInt($Object, [string]$Name) {
  $Property = $Object.PSObject.Properties[$Name]
  if ($null -eq $Property) { return 0 }
  return [int]$Property.Value
}

function Get-TextSha256([string]$Text) {
  $Bytes = $Utf8NoBom.GetBytes($Text)
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($Hasher.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $Hasher.Dispose()
  }
}

function Get-JsonlStats([string]$File) {
  $Rows = 0
  $Identities = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $AuditIdentity = @{}
  $ByGrade = @{}
  $ByRule = @{}
  $ByQaStatus = @{}
  $ByChangeType = @{}

  foreach ($Line in Get-Content -LiteralPath $File -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($Line)) { continue }
    $Row = $Line | ConvertFrom-Json
    $Identity = "$($Row.workId)|$($Row.siteId)"
    $AuditOrder = [int]$Row.auditOrder
    if (-not $Identities.Add($Identity)) {
      throw "Duplicate identity in $(Split-Path $File -Leaf): $Identity"
    }
    if ($AuditIdentity.ContainsKey($AuditOrder)) {
      throw "Duplicate audit order in $(Split-Path $File -Leaf): $AuditOrder"
    }
    $AuditIdentity[$AuditOrder] = "$AuditOrder|$Identity"

    if ([string]$Row.publicationStatus -ne "do_not_publish" -or
        $Row.requiresHumanReview -ne $true -or
        [string]$Row.policyVersion -ne $ExpectedPolicyId -or
        [string]$Row.policyCommit -ne $ExpectedPolicyCommit -or
        $Row.safety.payloadWrite -ne $false -or
        $Row.safety.directPostgresqlWrite -ne $false -or
        $Row.safety.modifiesWorks -ne $false -or
        $Row.safety.publishesRatings -ne $false -or
        [int]$Row.safety.humanTrackMutations -ne 0) {
      throw "Unsafe, unbound or publication-ready result row: $Identity"
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
    AuditIdentity = $AuditIdentity
    ByGrade = $ByGrade
    ByRule = $ByRule
    ByQaStatus = $ByQaStatus
    ByChangeType = $ByChangeType
  }
}

Write-Host "[1/8] Locate and bind the Wave 5 A122 remaining-78 result package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "A122 remaining-78 result ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/8] Extract and verify every declared package hash" -ForegroundColor Cyan
Assert-UnderDataLocal $PackageDir | Out-Null
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$SummaryFile = Join-Path $PackageDir "summary\a122-remaining78-summary-v01.json"
$ValidationFile = Join-Path $PackageDir "validation\package-validation-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
$AllFile = Join-Path $PackageDir "results\a122-remaining78-all-v01.jsonl"
$PassedFile = Join-Path $PackageDir "results\a122-remaining78-ai-qa-passed-v01.jsonl"
$DeferredFile = Join-Path $PackageDir "results\a122-remaining78-ai-qa-deferred-v01.jsonl"
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

Write-Host "[3/8] Verify source chain, policy binding, summary and safety" -ForegroundColor Cyan
$Manifest = Read-Json $ManifestFile
$Summary = Read-Json $SummaryFile
$Validation = Read-Json $ValidationFile

if ([string]$Manifest.packageId -ne $PackageId) {
  throw "Unexpected packageId: $($Manifest.packageId)"
}
if ([string]$Manifest.sourceA122InputZip.sha256 -ne $ExpectedSourceInputZipSha256 -or
    [string]$Manifest.sourceA122InputCheckpoint.sha256 -ne $ExpectedSourceInputCheckpointSha256 -or
    [string]$Manifest.completedCriticalHigh44Result.sha256 -ne $ExpectedCompleted44ZipSha256 -or
    [string]$Manifest.completedCriticalHigh44Checkpoint.sha256 -ne $ExpectedCompleted44CheckpointSha256) {
  throw "A122 remaining-78 package source chain does not match"
}
if ([string]$Manifest.sourcePolicy.commit -ne $ExpectedPolicyCommit -or
    [string]$Manifest.sourcePolicy.policyId -ne $ExpectedPolicyId -or
    [string]$Manifest.sourcePolicy.path -ne "src/lib/radar/ratingPolicy.ts") {
  throw "A122 remaining-78 package policy binding does not match"
}
if ($Validation.complete -ne $true -or @($Validation.validationErrors).Count -ne 0) {
  throw "A122 remaining-78 package validation is incomplete"
}
if ($Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "A122 remaining-78 package safety declarations are unacceptable"
}

if ([int]$Summary.rows -ne $ExpectedRows -or
    [int]$Summary.aiQaPassedRows -ne $ExpectedPassedRows -or
    [int]$Summary.aiQaDeferredRows -ne $ExpectedDeferredRows -or
    [int]$Summary.auditOrderStart -ne $ExpectedAuditStart -or
    [int]$Summary.auditOrderEnd -ne $ExpectedAuditEnd -or
    (Get-PropertyInt $Summary.byRecommendedGrade "S") -ne $ExpectedGradeS -or
    (Get-PropertyInt $Summary.byRecommendedGrade "A") -ne $ExpectedGradeA -or
    (Get-PropertyInt $Summary.byRecommendedGrade "B") -ne $ExpectedGradeB -or
    (Get-PropertyInt $Summary.byRecommendedGrade "D") -ne $ExpectedGradeD) {
  throw "A122 remaining-78 summary counts do not match"
}

Write-Host "[4/8] Verify exact identities, audit orders and QA partitions" -ForegroundColor Cyan
$AllStats = Get-JsonlStats $AllFile
$PassedStats = Get-JsonlStats $PassedFile
$DeferredStats = Get-JsonlStats $DeferredFile

if ($AllStats.Rows -ne $ExpectedRows -or
    $PassedStats.Rows -ne $ExpectedPassedRows -or
    $DeferredStats.Rows -ne $ExpectedDeferredRows) {
  throw "A122 remaining-78 JSONL row counts do not match"
}

$IdentityText = ((@($AllStats.Identities) | Sort-Object) -join "`n") + "`n"
if ((Get-TextSha256 $IdentityText) -ne $ExpectedIdentitySetSha256) {
  throw "A122 remaining-78 exact identity set does not match"
}

$AuditLines = @()
for ($Order = $ExpectedAuditStart; $Order -le $ExpectedAuditEnd; $Order += 1) {
  if (-not $AllStats.AuditIdentity.ContainsKey($Order)) {
    throw "Missing A122 remaining-78 audit order: $Order"
  }
  $AuditLines += [string]$AllStats.AuditIdentity[$Order]
}
$AuditIdentityText = ($AuditLines -join "`n") + "`n"
if ((Get-TextSha256 $AuditIdentityText) -ne $ExpectedAuditIdentityMapSha256) {
  throw "A122 remaining-78 audit-order identity map does not match"
}

$PartitionSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($Identity in $PassedStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) { throw "Duplicate identity in QA partitions: $Identity" }
}
foreach ($Identity in $DeferredStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) { throw "Duplicate identity in QA partitions: $Identity" }
}
if ($PartitionSeen.Count -ne $ExpectedRows) {
  throw "Passed and deferred partitions do not cover all A122 remaining rows"
}
foreach ($Identity in $AllStats.Identities) {
  if (-not $PartitionSeen.Contains($Identity)) {
    throw "Identity missing from QA partitions: $Identity"
  }
}
foreach ($Identity in $PartitionSeen) {
  if (-not $AllStats.Identities.Contains($Identity)) {
    throw "Unexpected identity in QA partitions: $Identity"
  }
}

Write-Host "[5/8] Verify grade, rule, QA and change-type distributions" -ForegroundColor Cyan
if ((Get-MapCount $AllStats.ByGrade "S") -ne $ExpectedGradeS -or
    (Get-MapCount $AllStats.ByGrade "A") -ne $ExpectedGradeA -or
    (Get-MapCount $AllStats.ByGrade "B") -ne $ExpectedGradeB -or
    (Get-MapCount $AllStats.ByGrade "D") -ne $ExpectedGradeD -or
    (Get-MapCount $AllStats.ByRule "S-RELATIONSHIP") -ne $ExpectedRuleSRelationship -or
    (Get-MapCount $AllStats.ByRule "S-MARRIAGE") -ne $ExpectedRuleSMarriage -or
    (Get-MapCount $AllStats.ByRule "A-NEAR-CONFIRMED") -ne $ExpectedRuleANearConfirmed -or
    (Get-MapCount $AllStats.ByRule "A-ONGOING") -ne $ExpectedRuleAOngoing -or
    (Get-MapCount $AllStats.ByRule "A-YURI-HAREM") -ne $ExpectedRuleAYuriHarem -or
    (Get-MapCount $AllStats.ByRule "B-FEMALE-NTR") -ne $ExpectedRuleBFemaleNtr -or
    (Get-MapCount $AllStats.ByRule "B-LIGHT") -ne $ExpectedRuleBLight -or
    (Get-MapCount $AllStats.ByRule "B-UNFINISHED-CREATOR-RISK") -ne $ExpectedRuleBUnfinishedCreatorRisk -or
    (Get-MapCount $AllStats.ByRule "D-UNCLEAR") -ne $ExpectedRuleDUnclear -or
    (Get-MapCount $AllStats.ByQaStatus "ai_qa_passed") -ne $ExpectedPassedRows -or
    (Get-MapCount $AllStats.ByQaStatus "ai_qa_deferred") -ne $ExpectedDeferredRows -or
    (Get-MapCount $AllStats.ByChangeType "retained") -ne $ExpectedRetained -or
    (Get-MapCount $AllStats.ByChangeType "rule_changed") -ne $ExpectedRuleChanged -or
    (Get-MapCount $AllStats.ByChangeType "grade_and_rule_changed") -ne $ExpectedGradeAndRuleChanged -or
    (Get-MapCount $AllStats.ByChangeType "deferred_reclassification") -ne $ExpectedDeferredReclassification) {
  throw "A122 remaining-78 JSONL distribution does not match the verified summary"
}

Write-Host "[6/8] Install the complete local A122 remaining-78 result queues" -ForegroundColor Cyan
Assert-UnderDataLocal $OutputRoot | Out-Null
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[7/8] Run A122 remaining-78 recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave5-a122-remaining78-results.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "A122 remaining-78 result tests failed"
}

Write-Host "[8/8] Create one compact remaining-78 result checkpoint" -ForegroundColor Cyan
Assert-UnderDataLocal $CheckpointDir | Out-Null
Assert-UnderDataLocal $CheckpointZip | Out-Null
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

Copy-Item -LiteralPath $ManifestFile -Destination (Join-Path $CheckpointDir "package-manifest.json") -Force
Copy-Item -LiteralPath $SummaryFile -Destination (Join-Path $CheckpointDir "a122-remaining78-summary-v01.json") -Force
Copy-Item -LiteralPath $ValidationFile -Destination (Join-Path $CheckpointDir "package-validation-v01.json") -Force
Copy-Item -LiteralPath $AllFile -Destination (Join-Path $CheckpointDir "a122-remaining78-all-v01.jsonl") -Force
Copy-Item -LiteralPath $PassedFile -Destination (Join-Path $CheckpointDir "a122-remaining78-ai-qa-passed-v01.jsonl") -Force
Copy-Item -LiteralPath $DeferredFile -Destination (Join-Path $CheckpointDir "a122-remaining78-ai-qa-deferred-v01.jsonl") -Force
Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $CheckpointDir "test-output.txt") -Force

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave5-a122-remaining78-install-v0.1"
  packageId = $PackageId
  packageZip = $SelectedZip.FullName
  packageZipSha256 = $ActualPackageZipSha256
  sourceInputZipSha256 = $ExpectedSourceInputZipSha256
  sourceInputCheckpointSha256 = $ExpectedSourceInputCheckpointSha256
  completed44ZipSha256 = $ExpectedCompleted44ZipSha256
  completed44CheckpointSha256 = $ExpectedCompleted44CheckpointSha256
  policyCommit = $ExpectedPolicyCommit
  rows = $ExpectedRows
  aiQaPassedRows = $ExpectedPassedRows
  aiQaDeferredRows = $ExpectedDeferredRows
  gradeS = $ExpectedGradeS
  gradeA = $ExpectedGradeA
  gradeB = $ExpectedGradeB
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
  GradeS = $ExpectedGradeS
  GradeA = $ExpectedGradeA
  GradeB = $ExpectedGradeB
  GradeD = $ExpectedGradeD
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List
