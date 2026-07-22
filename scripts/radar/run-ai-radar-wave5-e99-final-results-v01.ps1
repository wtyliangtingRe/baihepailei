param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE5-E99-FINAL-RESEARCH-RESULTS-v01"
$ExpectedPackageZipSha256 = "1e4b12a1b9d57aa86ab42292000fc0d268242c00bf9d543cc88a5c1168c98033"
$ExpectedHighImpactInputZipSha256 = "323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3"
$ExpectedHighImpactInputCheckpointSha256 = "60aeee09bc022fdbb06635a5aa496f93d786832fd05eecdf6b48b3c71a7d19eb"
$ExpectedExtremes9ResultZipSha256 = "9cc0c9df244135538547582558e70db82afbea3ee221374272c2e2d1a64cc578"
$ExpectedExtremes9CheckpointSha256 = "73eb281e548b8322c0692615dd4bceb538c9c558d73ef9c27fe19bf691d1579f"
$ExpectedA122InputZipSha256 = "903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb"
$ExpectedA122InputCheckpointSha256 = "9334cc17004d40837dc3db5182867099e1367e92c0e66e0d4c78290aa3f4771e"
$ExpectedA44ResultZipSha256 = "2bb8b6f41e89c5dc858a4236d2e7badd9080ef03d7315b439eacbc612ce0c07d"
$ExpectedA44CheckpointSha256 = "5e23e6da9b767362a1a44580b6f325904e70d44d1028efac7d4c4acbd6ade46e"
$ExpectedA78ResultZipSha256 = "8890a2afc4c16e9c90fcf03d6d922dececb129d3c1359931c3cf8155f1de0ee1"
$ExpectedA78CheckpointSha256 = "a1ba9ffb9bfe41ea622ad5510cbe93e099f46e3c8e7b45dbab8b0eebd8b5b17b"
$ExpectedPolicyCommit = "1ee8670db0e67b81a7055e3ce9bcbf9e15f9ee11"
$ExpectedOrderedIdentitySha256 = "68e39278315e9687721d12e7f985badc7f5bee94fa0e2fdb5c99244414154e4a"

$ExpectedRows = 99
$ExpectedPassedRows = 90
$ExpectedDeferredRows = 9
$ExpectedGradeA = 1
$ExpectedGradeB = 4
$ExpectedGradeD = 54
$ExpectedGradeE = 40
$ExpectedRuleANearConfirmed = 1
$ExpectedRuleBFemaleNtr = 3
$ExpectedRuleBLight = 1
$ExpectedRuleDGeneral = 12
$ExpectedRuleDQueerGeneral = 33
$ExpectedRuleDUnclear = 9
$ExpectedRuleEMaleIntimacy = 12
$ExpectedRuleEMalePossibility = 1
$ExpectedRuleEMaleSubstitute = 1
$ExpectedRuleEPastMaleRomance = 5
$ExpectedRuleERouteContamination = 2
$ExpectedRuleESpecial = 21
$ExpectedRuleETokenYuri = 1
$ExpectedRetained = 40
$ExpectedGradeAndRuleChanged = 50
$ExpectedDeferredReclassification = 9

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave5-e99-final-results-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "RADAR-WAVE5-E99-FINAL-RESEARCH-RESULTS-checkpoint-v01"
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

  return $Candidates |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
}

function Read-Json([string]$File) {
  return Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-Json([string]$File, $Value) {
  New-Item -ItemType Directory -Path (Split-Path $File -Parent) -Force | Out-Null
  $Text = $Value | ConvertTo-Json -Depth 80
  [System.IO.File]::WriteAllText($File, "$Text`n", $Utf8NoBom)
}

function Increment-Count([hashtable]$Map, [string]$Key) {
  if (-not $Map.ContainsKey($Key)) { $Map[$Key] = 0 }
  $Map[$Key] += 1
}

function Get-MapValue([hashtable]$Map, [string]$Key) {
  if (-not $Map.ContainsKey($Key)) { return 0 }
  return [int]$Map[$Key]
}

function Get-JsonlStats([string]$File) {
  $Rows = 0
  $Identities = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $ByGrade = @{}
  $ByRule = @{}
  $ByQaStatus = @{}
  $ByChangeType = @{}
  $Orders = [System.Collections.Generic.List[int]]::new()
  $OrderedIdentityLines = [System.Collections.Generic.List[string]]::new()

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

    $Order = [int]$Row.resultOrder
    $Orders.Add($Order)
    $OrderedIdentityLines.Add("$Order|$($Row.workId)|$($Row.siteId)")

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
    Orders = $Orders
    OrderedIdentityLines = $OrderedIdentityLines
  }
}

function Get-TextSha256([string]$Text) {
  $Bytes = $Utf8NoBom.GetBytes($Text)
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($Hasher.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $Hasher.Dispose()
  }
}

Write-Host "[1/8] Locate and bind the final Wave 5 E99 result package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()

if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "E99 final result ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/8] Extract and verify every declared package hash" -ForegroundColor Cyan
Assert-UnderDataLocal $PackageDir | Out-Null
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$SummaryFile = Join-Path $PackageDir "summary\e99-final-summary-v01.json"
$ValidationFile = Join-Path $PackageDir "validation\package-validation-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
$AllFile = Join-Path $PackageDir "results\e99-final-all-v01.jsonl"
$PassedFile = Join-Path $PackageDir "results\e99-final-ai-qa-passed-v01.jsonl"
$DeferredFile = Join-Path $PackageDir "results\e99-final-ai-qa-deferred-v01.jsonl"
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

  $Actual = (
    Get-FileHash -LiteralPath $File -Algorithm SHA256
  ).Hash.ToLowerInvariant()

  if ($Actual -ne $Expected) {
    throw "Package file SHA-256 mismatch: $($Matches[2])"
  }
}

Write-Host "[3/8] Verify the complete source chain, policy binding and safety" -ForegroundColor Cyan
$Manifest = Read-Json $ManifestFile
$Summary = Read-Json $SummaryFile
$Validation = Read-Json $ValidationFile

if ([string]$Manifest.packageId -ne $PackageId) {
  throw "Unexpected packageId: $($Manifest.packageId)"
}
if ([string]$Manifest.sourceChain.highImpact230Input.sha256 -ne $ExpectedHighImpactInputZipSha256 -or
    [string]$Manifest.sourceChain.highImpact230InputCheckpoint.sha256 -ne $ExpectedHighImpactInputCheckpointSha256 -or
    [string]$Manifest.sourceChain.extremes9Result.sha256 -ne $ExpectedExtremes9ResultZipSha256 -or
    [string]$Manifest.sourceChain.extremes9Checkpoint.sha256 -ne $ExpectedExtremes9CheckpointSha256 -or
    [string]$Manifest.sourceChain.a122Input.sha256 -ne $ExpectedA122InputZipSha256 -or
    [string]$Manifest.sourceChain.a122InputCheckpoint.sha256 -ne $ExpectedA122InputCheckpointSha256 -or
    [string]$Manifest.sourceChain.a122CriticalHigh44Result.sha256 -ne $ExpectedA44ResultZipSha256 -or
    [string]$Manifest.sourceChain.a122CriticalHigh44Checkpoint.sha256 -ne $ExpectedA44CheckpointSha256 -or
    [string]$Manifest.sourceChain.a122Remaining78Result.sha256 -ne $ExpectedA78ResultZipSha256 -or
    [string]$Manifest.sourceChain.a122Remaining78Checkpoint.sha256 -ne $ExpectedA78CheckpointSha256) {
  throw "E99 result package source chain does not match"
}
if ([string]$Manifest.sourcePolicy.commit -ne $ExpectedPolicyCommit -or
    [string]$Manifest.sourcePolicy.path -ne "src/lib/radar/ratingPolicy.ts") {
  throw "E99 result package policy binding does not match"
}
if ($Validation.complete -ne $true -or
    @($Validation.validationErrors).Count -ne 0 -or
    $Validation.highImpact230Complete -ne $true) {
  throw "E99 result validation is incomplete"
}
if ($Manifest.highImpact230Complete -ne $true -or
    $Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "E99 package safety or completion declaration is not acceptable"
}

Write-Host "[4/8] Verify exact identities, orders and QA partitions" -ForegroundColor Cyan
$AllStats = Get-JsonlStats $AllFile
$PassedStats = Get-JsonlStats $PassedFile
$DeferredStats = Get-JsonlStats $DeferredFile

if ($AllStats.Rows -ne $ExpectedRows -or
    $PassedStats.Rows -ne $ExpectedPassedRows -or
    $DeferredStats.Rows -ne $ExpectedDeferredRows) {
  throw "E99 result row counts do not match"
}

$SortedOrders = @($AllStats.Orders | Sort-Object)
for ($Index = 0; $Index -lt $ExpectedRows; $Index += 1) {
  if ([int]$SortedOrders[$Index] -ne ($Index + 1)) {
    throw "E99 result orders are not exactly 1..99"
  }
}

$OrderedLines = @(
  $AllStats.OrderedIdentityLines |
  ForEach-Object {
    $Parts = $_ -split '\|', 3
    [pscustomobject]@{
      Order = [int]$Parts[0]
      Line = $_
    }
  } |
  Sort-Object Order |
  ForEach-Object { $_.Line }
)
$OrderedIdentityText = (($OrderedLines -join "`n") + "`n")
$ActualOrderedIdentitySha256 = Get-TextSha256 $OrderedIdentityText
if ($ActualOrderedIdentitySha256 -ne $ExpectedOrderedIdentitySha256) {
  throw "E99 exact ordered identity map does not match"
}

$PartitionSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($Identity in $PassedStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) {
    throw "Duplicate identity in E99 QA partitions: $Identity"
  }
}
foreach ($Identity in $DeferredStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) {
    throw "Duplicate identity in E99 QA partitions: $Identity"
  }
}
if ($PartitionSeen.Count -ne $ExpectedRows) {
  throw "E99 QA partitions do not cover all rows"
}
foreach ($Identity in $AllStats.Identities) {
  if (-not $PartitionSeen.Contains($Identity)) {
    throw "E99 identity missing from QA partitions: $Identity"
  }
}

Write-Host "[5/8] Verify final grade, rule, QA and change distributions" -ForegroundColor Cyan
if ((Get-MapValue $AllStats.ByGrade "A") -ne $ExpectedGradeA -or
    (Get-MapValue $AllStats.ByGrade "B") -ne $ExpectedGradeB -or
    (Get-MapValue $AllStats.ByGrade "D") -ne $ExpectedGradeD -or
    (Get-MapValue $AllStats.ByGrade "E") -ne $ExpectedGradeE -or
    (Get-MapValue $AllStats.ByRule "A-NEAR-CONFIRMED") -ne $ExpectedRuleANearConfirmed -or
    (Get-MapValue $AllStats.ByRule "B-FEMALE-NTR") -ne $ExpectedRuleBFemaleNtr -or
    (Get-MapValue $AllStats.ByRule "B-LIGHT") -ne $ExpectedRuleBLight -or
    (Get-MapValue $AllStats.ByRule "D-GENERAL") -ne $ExpectedRuleDGeneral -or
    (Get-MapValue $AllStats.ByRule "D-QUEER-GENERAL") -ne $ExpectedRuleDQueerGeneral -or
    (Get-MapValue $AllStats.ByRule "D-UNCLEAR") -ne $ExpectedRuleDUnclear -or
    (Get-MapValue $AllStats.ByRule "E-MALE-INTIMACY") -ne $ExpectedRuleEMaleIntimacy -or
    (Get-MapValue $AllStats.ByRule "E-MALE-POSSIBILITY") -ne $ExpectedRuleEMalePossibility -or
    (Get-MapValue $AllStats.ByRule "E-MALE-SUBSTITUTE") -ne $ExpectedRuleEMaleSubstitute -or
    (Get-MapValue $AllStats.ByRule "E-PAST-MALE-ROMANCE") -ne $ExpectedRuleEPastMaleRomance -or
    (Get-MapValue $AllStats.ByRule "E-ROUTE-CONTAMINATION") -ne $ExpectedRuleERouteContamination -or
    (Get-MapValue $AllStats.ByRule "E-SPECIAL") -ne $ExpectedRuleESpecial -or
    (Get-MapValue $AllStats.ByRule "E-TOKEN-YURI") -ne $ExpectedRuleETokenYuri -or
    (Get-MapValue $AllStats.ByQaStatus "ai_qa_passed") -ne $ExpectedPassedRows -or
    (Get-MapValue $AllStats.ByQaStatus "ai_qa_deferred") -ne $ExpectedDeferredRows -or
    (Get-MapValue $AllStats.ByChangeType "retained") -ne $ExpectedRetained -or
    (Get-MapValue $AllStats.ByChangeType "grade_and_rule_changed") -ne $ExpectedGradeAndRuleChanged -or
    (Get-MapValue $AllStats.ByChangeType "deferred_reclassification") -ne $ExpectedDeferredReclassification) {
  throw "E99 JSONL distribution does not match the verified result summary"
}

if ([int]$Summary.highImpact230Coverage.completedAfterThisPackage -ne 230 -or
    [int]$Summary.highImpact230Coverage.remainingAfterThisPackage -ne 0) {
  throw "High-impact 230 completion summary does not match"
}

Write-Host "[6/8] Install the complete local E99 result queues" -ForegroundColor Cyan
Assert-UnderDataLocal $OutputRoot | Out-Null
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[7/8] Run final E99 recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave5-e99-final-results.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "Wave 5 final E99 result tests failed"
}

Write-Host "[8/8] Create the single final E99 result checkpoint" -ForegroundColor Cyan
Assert-UnderDataLocal $CheckpointDir | Out-Null
Assert-UnderDataLocal $CheckpointZip | Out-Null
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

Copy-Item -LiteralPath $ManifestFile -Destination (Join-Path $CheckpointDir "package-manifest.json") -Force
Copy-Item -LiteralPath $SummaryFile -Destination (Join-Path $CheckpointDir "e99-final-summary-v01.json") -Force
Copy-Item -LiteralPath $ValidationFile -Destination (Join-Path $CheckpointDir "package-validation-v01.json") -Force
Copy-Item -LiteralPath $AllFile -Destination (Join-Path $CheckpointDir "e99-final-all-v01.jsonl") -Force
Copy-Item -LiteralPath $PassedFile -Destination (Join-Path $CheckpointDir "e99-final-ai-qa-passed-v01.jsonl") -Force
Copy-Item -LiteralPath $DeferredFile -Destination (Join-Path $CheckpointDir "e99-final-ai-qa-deferred-v01.jsonl") -Force
Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $CheckpointDir "test-output.txt") -Force

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave5-e99-final-install-v0.1"
  packageId = $PackageId
  packageZip = $SelectedZip.FullName
  packageZipSha256 = $ActualPackageZipSha256
  policyCommit = $ExpectedPolicyCommit
  rows = $ExpectedRows
  aiQaPassedRows = $ExpectedPassedRows
  aiQaDeferredRows = $ExpectedDeferredRows
  gradeA = $ExpectedGradeA
  gradeB = $ExpectedGradeB
  gradeD = $ExpectedGradeD
  gradeE = $ExpectedGradeE
  highImpact230Completed = 230
  highImpact230Remaining = 0
  orderedIdentitySha256 = $ActualOrderedIdentitySha256
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
  $Relative = [System.IO.Path]::GetRelativePath(
    $CheckpointDir,
    $File.FullName
  ).Replace("\", "/")
  $Hash = (
    Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256
  ).Hash.ToLowerInvariant()
  $HashLines += "$Hash  $Relative"
}

[System.IO.File]::WriteAllText(
  (Join-Path $CheckpointDir "SHA256SUMS.txt"),
  (($HashLines -join "`n") + "`n"),
  $Utf8NoBom
)

New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null
Compress-Archive `
  -Path (Join-Path $CheckpointDir "*") `
  -DestinationPath $CheckpointZip `
  -CompressionLevel Optimal

$CheckpointZipSha256 = (
  Get-FileHash -LiteralPath $CheckpointZip -Algorithm SHA256
).Hash.ToLowerInvariant()

[pscustomobject]@{
  PackageId = $PackageId
  Rows = $ExpectedRows
  AiQaPassedRows = $ExpectedPassedRows
  AiQaDeferredRows = $ExpectedDeferredRows
  GradeA = $ExpectedGradeA
  GradeB = $ExpectedGradeB
  GradeD = $ExpectedGradeD
  GradeE = $ExpectedGradeE
  HighImpact230Completed = 230
  HighImpact230Remaining = 0
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List
