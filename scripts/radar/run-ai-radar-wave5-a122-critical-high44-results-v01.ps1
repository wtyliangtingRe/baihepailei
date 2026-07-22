param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-WAVE5-A122-CRITICAL-HIGH44-RESEARCH-RESULTS-v01"
$ExpectedPackageZipSha256 = "2bb8b6f41e89c5dc858a4236d2e7badd9080ef03d7315b439eacbc612ce0c07d"
$ExpectedSourceInputZipSha256 = "903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb"
$ExpectedSourceCheckpointZipSha256 = "9334cc17004d40837dc3db5182867099e1367e92c0e66e0d4c78290aa3f4771e"
$ExpectedPolicyCommit = "0091143a6417d28b08a731bbe659cc506e0efa08"

$ExpectedRows = 44
$ExpectedPassedRows = 39
$ExpectedDeferredRows = 5
$ExpectedGradeS = 3
$ExpectedGradeA = 33
$ExpectedGradeB = 5
$ExpectedGradeD = 2
$ExpectedGradeF = 1
$ExpectedRuleSRelationship = 3
$ExpectedRuleANearConfirmed = 20
$ExpectedRuleAOngoing = 11
$ExpectedRuleAYuriHarem = 3
$ExpectedRuleBFemaleNtr = 2
$ExpectedRuleBPowerImbalance = 2
$ExpectedRuleBUnfinishedCreatorRisk = 1
$ExpectedRuleDUnclear = 2
$ExpectedRuleFHetEnd = 1
$ExpectedRetained = 15
$ExpectedRuleChanged = 15
$ExpectedGradeAndRuleChanged = 9
$ExpectedDeferredReclassification = 5

$ExpectedIdentities = @(
  "4769|work:mgv2-01032-summer-in-trigue",
  "4821|work:mgv2-01084-不恋爱就完蛋了",
  "4815|work:mgv2-01078-千面",
  "4761|work:mgv2-01024-百合婚姻介绍所",
  "4892|work:mgv2-01155-镜花饴情-mirage-sugar-acacia",
  "4738|work:mgv2-01001-斜阳下的彼岸",
  "4755|work:mgv2-01018-濒临少女们的求婚大作战",
  "29115|catalog-anilist-497",
  "4235|work:mgv2-00498-零碎的梦",
  "30666|catalog-bangumi-388908",
  "30670|catalog-bangumi-508067",
  "30252|catalog-bangumi-378778",
  "30751|catalog-bangumi-576510",
  "30698|catalog-bangumi-594065",
  "30694|catalog-bangumi-433838",
  "31213|catalog-bangumi-639986",
  "15651|catalog-anilist-186822",
  "4434|work:mgv2-00697-恋爱遗传子xx",
  "4305|work:mgv2-00568-无法拒绝孤单女孩",
  "4483|work:mgv2-00746-あの娘にキスと白百合を-1",
  "4373|work:mgv2-00636-向笨蛋告白",
  "4264|work:mgv2-00527-恋语轻唱",
  "4322|work:mgv2-00585-月不会数羊",
  "4311|work:mgv2-00574-辣妹女仆与反派大小姐-大小姐的完美结局什么的最棒啦",
  "4490|work:mgv2-00753-あの娘にキスと白百合を-2",
  "4607|work:mgv2-00870-あの娘にキスと白百合を-3",
  "4711|work:mgv2-00974-あの娘にキスと白百合を-4",
  "4368|work:mgv2-00631-因为你照亮着我",
  "4302|work:mgv2-00565-我们无法描绘恋爱",
  "4276|work:mgv2-00539-梦想和恋爱划算不来",
  "4349|work:mgv2-00612-雨夜の月-11",
  "4475|work:mgv2-00738-和间宫同学一起",
  "4293|work:mgv2-00556-关于被班上绿茶威胁那件事",
  "4316|work:mgv2-00579-梦中被甩之后展开的百合恋情",
  "4516|work:mgv2-00779-月亮-世界與歌姬",
  "30560|catalog-bangumi-21679",
  "4625|work:mgv2-00888-honey-crush",
  "4629|work:mgv2-00892-プアプアlips",
  "4635|work:mgv2-00898-奥拉克妮剧团",
  "4574|work:mgv2-00837-粉色-冲击",
  "4332|work:mgv2-00595-温热的银莲花",
  "28582|catalog-anilist-168999",
  "4215|work:mgv2-00478-我心匪石",
  "4197|work:mgv2-00460-谨遵百合神大人之谕"
)

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave5-a122-critical-high44-results-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "RADAR-WAVE5-A122-CRITICAL-HIGH44-RESEARCH-RESULTS-checkpoint-v01"
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
  $AuditOrders = [System.Collections.Generic.HashSet[int]]::new()
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
    if (-not $AuditOrders.Add([int]$Row.auditOrder)) {
      throw "Duplicate auditOrder in $(Split-Path $File -Leaf): $($Row.auditOrder)"
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
    AuditOrders = $AuditOrders
    ByGrade = $ByGrade
    ByRule = $ByRule
    ByQaStatus = $ByQaStatus
    ByChangeType = $ByChangeType
  }
}

Write-Host "[1/8] Locate and bind the A122 critical/high-44 result package" -ForegroundColor Cyan
$SelectedZip = Get-LatestZip "$PackageId.zip" $PackageZip
$ActualPackageZipSha256 = (
  Get-FileHash -LiteralPath $SelectedZip.FullName -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ActualPackageZipSha256 -ne $ExpectedPackageZipSha256) {
  throw "Critical/high-44 result ZIP SHA-256 mismatch: $ActualPackageZipSha256"
}

Write-Host "[2/8] Extract and verify every declared package hash" -ForegroundColor Cyan
Assert-UnderDataLocal $PackageDir | Out-Null
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedZip.FullName -DestinationPath $PackageDir -Force

$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$SummaryFile = Join-Path $PackageDir "summary\a122-critical-high44-summary-v01.json"
$ValidationFile = Join-Path $PackageDir "validation\package-validation-v01.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
$AllFile = Join-Path $PackageDir "results\a122-critical-high44-all-v01.jsonl"
$PassedFile = Join-Path $PackageDir "results\a122-critical-high44-ai-qa-passed-v01.jsonl"
$DeferredFile = Join-Path $PackageDir "results\a122-critical-high44-ai-qa-deferred-v01.jsonl"
$ReportFile = Join-Path $PackageDir "REPORT.md"

foreach ($Required in @(
  $ManifestFile, $SummaryFile, $ValidationFile, $HashFile,
  $AllFile, $PassedFile, $DeferredFile, $ReportFile
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
if ([string]$Manifest.sourceA122InputZip.sha256 -ne $ExpectedSourceInputZipSha256) {
  throw "Result package is not bound to the verified A122 input ZIP"
}
if ([string]$Manifest.sourceA122InputCheckpoint.sha256 -ne $ExpectedSourceCheckpointZipSha256) {
  throw "Result package is not bound to the verified A122 input checkpoint"
}
if ([string]$Manifest.sourcePolicy.commit -ne $ExpectedPolicyCommit -or
    [string]$Manifest.sourcePolicy.path -ne "src/lib/radar/ratingPolicy.ts") {
  throw "Result package is not bound to the expected rating policy"
}
if ($Validation.complete -ne $true -or @($Validation.validationErrors).Count -ne 0) {
  throw "Critical/high-44 package validation is incomplete"
}
if ($Manifest.publicationReady -ne $false -or
    $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "Critical/high-44 package safety declarations are not acceptable"
}

if ([int]$Summary.rows -ne $ExpectedRows -or
    [int]$Summary.aiQaPassedRows -ne $ExpectedPassedRows -or
    [int]$Summary.aiQaDeferredRows -ne $ExpectedDeferredRows -or
    [int]$Summary.byRecommendedGrade.S -ne $ExpectedGradeS -or
    [int]$Summary.byRecommendedGrade.A -ne $ExpectedGradeA -or
    [int]$Summary.byRecommendedGrade.B -ne $ExpectedGradeB -or
    [int]$Summary.byRecommendedGrade.D -ne $ExpectedGradeD -or
    [int]$Summary.byRecommendedGrade.F -ne $ExpectedGradeF) {
  throw "Critical/high-44 summary grade or QA distribution does not match"
}

Write-Host "[4/8] Verify all exact identities, audit orders and QA partitions" -ForegroundColor Cyan
$AllStats = Get-JsonlStats $AllFile
$PassedStats = Get-JsonlStats $PassedFile
$DeferredStats = Get-JsonlStats $DeferredFile

if ($AllStats.Rows -ne $ExpectedRows -or
    $PassedStats.Rows -ne $ExpectedPassedRows -or
    $DeferredStats.Rows -ne $ExpectedDeferredRows) {
  throw "Critical/high-44 result row counts do not match"
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
    throw "Unexpected identity in critical/high-44 results: $Identity"
  }
}
foreach ($Identity in $ExpectedIdentitySet) {
  if (-not $AllStats.Identities.Contains($Identity)) {
    throw "Expected identity missing from critical/high-44 results: $Identity"
  }
}
for ($Order = 1; $Order -le $ExpectedRows; $Order += 1) {
  if (-not $AllStats.AuditOrders.Contains($Order)) {
    throw "Expected auditOrder missing from critical/high-44 results: $Order"
  }
}

$PartitionSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($Identity in $PassedStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) { throw "Duplicate identity in QA partitions: $Identity" }
}
foreach ($Identity in $DeferredStats.Identities) {
  if (-not $PartitionSeen.Add($Identity)) { throw "Duplicate identity in QA partitions: $Identity" }
}
if ($PartitionSeen.Count -ne $ExpectedRows) {
  throw "Passed and deferred partitions do not cover all critical/high-44 rows"
}
foreach ($Identity in $AllStats.Identities) {
  if (-not $PartitionSeen.Contains($Identity)) {
    throw "Identity missing from passed/deferred partitions: $Identity"
  }
}

Write-Host "[5/8] Verify grade, rule, QA and change-type distributions" -ForegroundColor Cyan
if ([int]$AllStats.ByGrade.S -ne $ExpectedGradeS -or
    [int]$AllStats.ByGrade.A -ne $ExpectedGradeA -or
    [int]$AllStats.ByGrade.B -ne $ExpectedGradeB -or
    [int]$AllStats.ByGrade.D -ne $ExpectedGradeD -or
    [int]$AllStats.ByGrade.F -ne $ExpectedGradeF -or
    [int]$AllStats.ByRule.'S-RELATIONSHIP' -ne $ExpectedRuleSRelationship -or
    [int]$AllStats.ByRule.'A-NEAR-CONFIRMED' -ne $ExpectedRuleANearConfirmed -or
    [int]$AllStats.ByRule.'A-ONGOING' -ne $ExpectedRuleAOngoing -or
    [int]$AllStats.ByRule.'A-YURI-HAREM' -ne $ExpectedRuleAYuriHarem -or
    [int]$AllStats.ByRule.'B-FEMALE-NTR' -ne $ExpectedRuleBFemaleNtr -or
    [int]$AllStats.ByRule.'B-POWER-IMBALANCE' -ne $ExpectedRuleBPowerImbalance -or
    [int]$AllStats.ByRule.'B-UNFINISHED-CREATOR-RISK' -ne $ExpectedRuleBUnfinishedCreatorRisk -or
    [int]$AllStats.ByRule.'D-UNCLEAR' -ne $ExpectedRuleDUnclear -or
    [int]$AllStats.ByRule.'F-HET-END' -ne $ExpectedRuleFHetEnd -or
    [int]$AllStats.ByQaStatus.ai_qa_passed -ne $ExpectedPassedRows -or
    [int]$AllStats.ByQaStatus.ai_qa_deferred -ne $ExpectedDeferredRows -or
    [int]$AllStats.ByChangeType.retained -ne $ExpectedRetained -or
    [int]$AllStats.ByChangeType.rule_changed -ne $ExpectedRuleChanged -or
    [int]$AllStats.ByChangeType.grade_and_rule_changed -ne $ExpectedGradeAndRuleChanged -or
    [int]$AllStats.ByChangeType.deferred_reclassification -ne $ExpectedDeferredReclassification) {
  throw "Critical/high-44 JSONL distribution does not match the verified summary"
}

Write-Host "[6/8] Install local critical/high-44 result queues" -ForegroundColor Cyan
Assert-UnderDataLocal $OutputRoot | Out-Null
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Copy-Item -Path (Join-Path $PackageDir "*") -Destination $OutputRoot -Recurse -Force

Write-Host "[7/8] Run A122 critical/high-44 recovery tests" -ForegroundColor Cyan
& node --test ".\tests\radar-wave5-a122-critical-high44-results.test.mjs" 2>&1 |
  Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) {
  throw "A122 critical/high-44 result tests failed"
}

Write-Host "[8/8] Create the compact critical/high-44 result checkpoint" -ForegroundColor Cyan
Assert-UnderDataLocal $CheckpointDir | Out-Null
Assert-UnderDataLocal $CheckpointZip | Out-Null
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null

Copy-Item -LiteralPath $ManifestFile -Destination (Join-Path $CheckpointDir "package-manifest.json") -Force
Copy-Item -LiteralPath $SummaryFile -Destination (Join-Path $CheckpointDir "a122-critical-high44-summary-v01.json") -Force
Copy-Item -LiteralPath $ValidationFile -Destination (Join-Path $CheckpointDir "package-validation-v01.json") -Force
Copy-Item -LiteralPath $AllFile -Destination (Join-Path $CheckpointDir "a122-critical-high44-all-v01.jsonl") -Force
Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $CheckpointDir "test-output.txt") -Force

$InstallSummary = [ordered]@{
  generatedAt = [datetimeoffset]::UtcNow.ToString("o")
  version = "ai-radar-wave5-a122-critical-high44-install-v0.1"
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
  gradeA = $ExpectedGradeA
  gradeB = $ExpectedGradeB
  gradeD = $ExpectedGradeD
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
  GradeA = $ExpectedGradeA
  GradeB = $ExpectedGradeB
  GradeD = $ExpectedGradeD
  GradeF = $ExpectedGradeF
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List
