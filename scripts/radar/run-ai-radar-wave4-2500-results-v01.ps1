param(
  [string]$ResultZip = "",
  [string]$InputZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$WaveId = "RADAR-INCREMENTAL-WAVE-0004-2500"
$InputPackageId = "$WaveId-input-v02"
$ResultPackageId = "$WaveId-complete-results-v01"
$ExpectedInputZipSha256 = "1a7b880c14c2a1c609306598b71ed313711c637663ea75b76a28eb647bbe5966"
$ExpectedResultZipSha256 = "3a99ee6aad204bce0b26329b7543ea0b7eae92d862ce2db2aca0d156a113072d"
$ExpectedResearchRows = 2500
$ExpectedReadyRows = 10
$ExpectedNeedsMoreRows = 2191
$ExpectedIdentityReviewRows = 299
$ExpectedLegacyReassessmentRows = 10223
$ExpectedSubwaves = 10

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $ResultPackageId))
$OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\wave4-2500-results-v01"))
$CheckpointRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "$WaveId-results-checkpoint-v01"
$CheckpointDir = [System.IO.Path]::GetFullPath((Join-Path $CheckpointRoot $CheckpointId))
$CheckpointZip = [System.IO.Path]::GetFullPath((Join-Path $CheckpointRoot "$CheckpointId.zip"))
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

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

function Get-LatestZip([string]$Name, [string]$Explicit) {
  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    $Resolved = Resolve-RepoPath $Explicit
    if (-not (Test-Path -LiteralPath $Resolved)) { throw "指定 ZIP 不存在：$Resolved" }
    return (Get-Item -LiteralPath $Resolved)
  }
  $Candidates = @()
  foreach ($Root in @((Join-Path $HOME "Downloads"), (Join-Path $DataLocal "outputs"), (Join-Path $DataLocal "incoming"))) {
    if (Test-Path -LiteralPath $Root) {
      $Candidates += @(Get-ChildItem -LiteralPath $Root -Filter $Name -File -Recurse -ErrorAction SilentlyContinue)
    }
  }
  if ($Candidates.Count -eq 0) { throw "找不到 $Name；请保存到 Downloads 或 data_local" }
  return $Candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
}

function Write-Json([string]$File, $Value) {
  New-Item -ItemType Directory -Path (Split-Path $File -Parent) -Force | Out-Null
  $Text = $Value | ConvertTo-Json -Depth 30
  [System.IO.File]::WriteAllText($File, "$Text`n", $Utf8NoBom)
}

function Assert-SafeRelativePath([string]$Root, [string]$Relative) {
  $Normalized = $Relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $Resolved = [System.IO.Path]::GetFullPath((Join-Path $Root $Normalized))
  $Prefix = [System.IO.Path]::GetFullPath($Root) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "结果包路径逃逸：$Relative"
  }
  return $Resolved
}

Write-Host "[1/8] 定位并核验第四波输入与完整结果 ZIP" -ForegroundColor Cyan
$SelectedInputZip = Get-LatestZip "$InputPackageId.zip" $InputZip
$SelectedResultZip = Get-LatestZip "$ResultPackageId.zip" $ResultZip
$ActualInputZipSha256 = (Get-FileHash -LiteralPath $SelectedInputZip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$ActualResultZipSha256 = (Get-FileHash -LiteralPath $SelectedResultZip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualInputZipSha256 -ne $ExpectedInputZipSha256) { throw "第四波 v02 输入 ZIP SHA-256 不匹配：$ActualInputZipSha256" }
if ($ActualResultZipSha256 -ne $ExpectedResultZipSha256) { throw "第四波结果 ZIP SHA-256 不匹配：$ActualResultZipSha256" }

Write-Host "[2/8] 解压结果包并验证全部 SHA-256" -ForegroundColor Cyan
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedResultZip.FullName -DestinationPath $PackageDir -Force
$ManifestFile = Join-Path $PackageDir "package-manifest.json"
$HashFile = Join-Path $PackageDir "SHA256SUMS.txt"
if (-not (Test-Path -LiteralPath $ManifestFile) -or -not (Test-Path -LiteralPath $HashFile)) { throw "结果包缺少 manifest 或 SHA256SUMS" }
foreach ($Line in @(Get-Content -LiteralPath $HashFile -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
  if ($Line -notmatch '^([0-9a-fA-F]{64})\s+(.+)$') { throw "SHA256SUMS 格式错误：$Line" }
  $Expected = $Matches[1].ToLowerInvariant()
  $File = Assert-SafeRelativePath $PackageDir $Matches[2]
  if (-not (Test-Path -LiteralPath $File)) { throw "结果包文件缺失：$($Matches[2])" }
  $Actual = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "结果包 SHA-256 不匹配：$($Matches[2])" }
}

Write-Host "[3/8] 核验包版本、输入绑定和安全声明" -ForegroundColor Cyan
$Manifest = Get-Content -LiteralPath $ManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$Manifest.packageId -ne $ResultPackageId -or [string]$Manifest.waveId -ne $WaveId -or [string]$Manifest.inputPackageId -ne $InputPackageId) {
  throw "结果包 packageId、waveId 或 inputPackageId 不匹配"
}
if ([string]$Manifest.inputZipSha256 -ne $ExpectedInputZipSha256) { throw "结果包未绑定正确的 v02 输入 SHA-256" }
if ($Manifest.publicationReady -ne $false -or $Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or [int]$Manifest.safety.humanTrackMutations -ne 0) {
  throw "结果包安全声明不符合要求"
}

Write-Host "[4/8] 核验 2500 个研究身份与 10 个子波次" -ForegroundColor Cyan
$ValidationFile = Assert-SafeRelativePath $PackageDir ([string]$Manifest.validationFile)
$Validation = Get-Content -LiteralPath $ValidationFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Validation.complete -ne $true -or [int]$Validation.resultResearchRows -ne $ExpectedResearchRows -or
    [int]$Validation.resultUniqueIdentities -ne $ExpectedResearchRows -or
    [int]$Validation.legacyReassessmentRows -ne $ExpectedLegacyReassessmentRows -or
    [int]$Validation.subwaveCount -ne $ExpectedSubwaves -or
    @($Validation.schemaErrors).Count -ne 0 -or @($Validation.missingIdentities).Count -ne 0 -or @($Validation.unexpectedIdentities).Count -ne 0) {
  throw "结果包总体验证记录不完整"
}
if (@($Manifest.subwaves).Count -ne $ExpectedSubwaves) { throw "结果包子波次数量不等于 10" }
foreach ($Subwave in @($Manifest.subwaves)) {
  $SubManifestFile = Assert-SafeRelativePath $PackageDir ([string]$Subwave.manifestFile)
  $ActualSubManifestSha = (Get-FileHash -LiteralPath $SubManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualSubManifestSha -ne ([string]$Subwave.manifestSha256).ToLowerInvariant()) { throw "子波次 manifest SHA 不匹配：$($Subwave.subwaveId)" }
  $SubManifest = Get-Content -LiteralPath $SubManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]$SubManifest.state -ne "complete_first_pass" -or [int]$SubManifest.rowCount -ne 250 -or [int]$SubManifest.chunkCount -ne 50) {
    throw "子波次状态、行数或块数不正确：$($Subwave.subwaveId)"
  }
}

Write-Host "[5/8] 拆分可评级、补研究、身份复核与旧证据重新评级队列" -ForegroundColor Cyan
Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$ResearchSource = Join-Path $PackageDir "aggregate\research-results-v01.jsonl"
$LegacySource = Join-Path $PackageDir "reassessments\legacy-reassessment-results-v01.jsonl"
$AllOut = Join-Path $OutputRoot "ai-radar-wave4-research-all-v01.jsonl"
$ReadyOut = Join-Path $OutputRoot "ai-radar-wave4-assessment-ready-v01.jsonl"
$NeedsMoreOut = Join-Path $OutputRoot "ai-radar-wave4-needs-more-research-v01.jsonl"
$IdentityOut = Join-Path $OutputRoot "ai-radar-wave4-identity-review-v01.jsonl"
$LegacyOut = Join-Path $OutputRoot "ai-radar-wave4-legacy-reassessment-v01.jsonl"
Copy-Item -LiteralPath $ResearchSource -Destination $AllOut -Force
Copy-Item -LiteralPath $LegacySource -Destination $LegacyOut -Force
$ReadyWriter = [System.IO.StreamWriter]::new($ReadyOut, $false, $Utf8NoBom)
$NeedsWriter = [System.IO.StreamWriter]::new($NeedsMoreOut, $false, $Utf8NoBom)
$IdentityWriter = [System.IO.StreamWriter]::new($IdentityOut, $false, $Utf8NoBom)
$Seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$ResearchRows = 0
$ReadyRows = 0
$NeedsMoreRows = 0
$IdentityRows = 0
try {
  foreach ($Line in Get-Content -LiteralPath $ResearchSource -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($Line)) { continue }
    $Row = $Line | ConvertFrom-Json
    $Identity = "$($Row.workId)|$($Row.siteId)"
    if (-not $Seen.Add($Identity)) { throw "研究结果出现重复身份：$Identity" }
    $ResearchRows += 1
    switch ([string]$Row.researchStatus) {
      "ready_for_ai_assessment" { $ReadyWriter.WriteLine($Line); $ReadyRows += 1 }
      "needs_more_research" { $NeedsWriter.WriteLine($Line); $NeedsMoreRows += 1 }
      "identity_review" { $IdentityWriter.WriteLine($Line); $IdentityRows += 1 }
      default { throw "不支持的研究状态：$($Row.researchStatus) / $Identity" }
    }
  }
}
finally {
  $ReadyWriter.Dispose()
  $NeedsWriter.Dispose()
  $IdentityWriter.Dispose()
}
$LegacyRows = @(Get-Content -LiteralPath $LegacySource -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
if ($ResearchRows -ne $ExpectedResearchRows -or $ReadyRows -ne $ExpectedReadyRows -or
    $NeedsMoreRows -ne $ExpectedNeedsMoreRows -or $IdentityRows -ne $ExpectedIdentityReviewRows -or
    $LegacyRows -ne $ExpectedLegacyReassessmentRows) {
  throw "结果队列统计不符合预期：research=$ResearchRows ready=$ReadyRows needs=$NeedsMoreRows identity=$IdentityRows legacy=$LegacyRows"
}
Copy-Item -LiteralPath (Join-Path $PackageDir "AGGREGATE_REPORT.md") -Destination (Join-Path $OutputRoot "AGGREGATE_REPORT.md") -Force
Copy-Item -LiteralPath (Join-Path $PackageDir "web-evidence\web-evidence-index-v01.jsonl") -Destination (Join-Path $OutputRoot "web-evidence-index-v01.jsonl") -Force

Write-Host "[6/8] 运行第四波结果回收测试" -ForegroundColor Cyan
$TestOutput = Join-Path $OutputRoot "test-output.txt"
& node --test ".\tests\radar-wave4-results.test.mjs" 2>&1 | Tee-Object -FilePath $TestOutput
if ($LASTEXITCODE -ne 0) { throw "第四波结果回收测试失败" }

Write-Host "[7/8] 生成结果摘要和唯一检查点 ZIP" -ForegroundColor Cyan
$Summary = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  version = "ai-radar-wave4-results-checkpoint-v0.1"
  waveId = $WaveId
  packageId = $ResultPackageId
  inputZipSha256 = $ActualInputZipSha256
  resultZipSha256 = $ActualResultZipSha256
  researchRows = $ResearchRows
  readyForAiAssessmentRows = $ReadyRows
  needsMoreResearchRows = $NeedsMoreRows
  identityReviewRows = $IdentityRows
  legacyReassessmentRows = $LegacyRows
  subwaveCount = $ExpectedSubwaves
  outputRoot = [System.IO.Path]::GetRelativePath($RepoRoot, $OutputRoot).Replace("\", "/")
  publicationReady = $false
  safety = [ordered]@{
    payloadWrite = $false
    directPostgresqlWrite = $false
    modifiesWorks = $false
    publishesRatings = $false
    humanTrackMutations = 0
  }
  nextStep = "Upload the checkpoint ZIP for verification, then run calibrated assessment on the 10 ready rows and rule-by-rule AI QA on legacy reassessments."
}
$SummaryFile = Join-Path $OutputRoot "wave4-results-summary-v01.json"
Write-Json $SummaryFile $Summary
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null
foreach ($File in @($SummaryFile, $ManifestFile, $ValidationFile, $TestOutput, (Join-Path $OutputRoot "AGGREGATE_REPORT.md"))) {
  Copy-Item -LiteralPath $File -Destination (Join-Path $CheckpointDir ([System.IO.Path]::GetFileName($File))) -Force
}
$CheckpointHashes = @()
Get-ChildItem -LiteralPath $CheckpointDir -File | Sort-Object Name | ForEach-Object {
  $CheckpointHashes += "{0}  {1}" -f ((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()), $_.Name
}
[System.IO.File]::WriteAllText((Join-Path $CheckpointDir "SHA256SUMS.txt"), (($CheckpointHashes -join "`n") + "`n"), $Utf8NoBom)
New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null
Compress-Archive -Path (Join-Path $CheckpointDir "*") -DestinationPath $CheckpointZip -CompressionLevel Optimal
$CheckpointZipSha256 = (Get-FileHash -LiteralPath $CheckpointZip -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "[8/8] 第四波结果回收完成" -ForegroundColor Cyan
[pscustomobject]@{
  ResearchRows = $ResearchRows
  ReadyForAiAssessmentRows = $ReadyRows
  NeedsMoreResearchRows = $NeedsMoreRows
  IdentityReviewRows = $IdentityRows
  LegacyReassessmentRows = $LegacyRows
  Subwaves = $ExpectedSubwaves
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List

explorer.exe $CheckpointRoot
