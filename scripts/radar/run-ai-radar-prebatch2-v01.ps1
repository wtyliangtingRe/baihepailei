param(
  [string]$PackagePath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-ASSESS-RESEARCH-0001-ai-qa-results-v01"
$BatchId = "RADAR-ASSESS-RESEARCH-0001"
$PackageFileName = "$PackageId.zip"
$ExpectedZipSha256 = "f164ed08766f2f1a06d3aac0bcfc25afed6abc62ba64978ab31052610220c66b"
$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}
function Resolve-RepoPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  if ([System.IO.Path]::IsPathRooted($Value)) { return [System.IO.Path]::GetFullPath($Value) }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}
function Assert-UnderDataLocal([string]$Value) {
  $Resolved = [System.IO.Path]::GetFullPath($Value)
  if (-not $Resolved.StartsWith($DataLocal + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $Resolved.Equals($DataLocal, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "路径必须位于 data_local：$Resolved"
  }
  return $Resolved
}

if ([string]::IsNullOrWhiteSpace($PackagePath)) {
  $Downloads = Join-Path $HOME "Downloads"
  $Exact = Join-Path $Downloads $PackageFileName
  if (Test-Path -LiteralPath $Exact) { $PackagePath = $Exact }
  else {
    $Candidates = @(
      Get-ChildItem -LiteralPath $Downloads -Filter "RADAR-ASSESS-RESEARCH-0001-ai-qa-results-v01*.zip" -File |
      Sort-Object LastWriteTime -Descending
    )
    if ($Candidates.Count -eq 0) { throw "下载目录中找不到 $PackageFileName" }
    $PackagePath = $Candidates[0].FullName
  }
}

$PackagePath = [System.IO.Path]::GetFullPath($PackagePath)
if (-not (Test-Path -LiteralPath $PackagePath)) { throw "AI QA ZIP 不存在：$PackagePath" }
$ActualZipSha256 = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualZipSha256 -ne $ExpectedZipSha256) { throw "AI QA ZIP SHA-256 不匹配。实际：$ActualZipSha256" }

$IncomingRoot = Assert-UnderDataLocal (Join-Path $DataLocal "incoming\ai-radar\packages\$PackageId")
$IncomingZip = Join-Path $IncomingRoot $PackageFileName
$ExtractRoot = Join-Path $IncomingRoot "extracted"
New-Item -ItemType Directory -Path $IncomingRoot -Force | Out-Null
Copy-Item -LiteralPath $PackagePath -Destination $IncomingZip -Force
Remove-Item -LiteralPath $ExtractRoot -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $IncomingZip -DestinationPath $ExtractRoot -Force

$PackageManifests = @(
  Get-ChildItem -LiteralPath $ExtractRoot -Filter "package-manifest.json" -File -Recurse |
  Where-Object {
    try {
      $Content = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
      $Content.packageId -eq $PackageId -and $Content.batchId -eq $BatchId
    }
    catch { $false }
  }
)
if ($PackageManifests.Count -ne 1) { throw "预期找到 1 份有效 AI QA package-manifest.json，实际找到 $($PackageManifests.Count) 份" }
$PackageDir = Assert-UnderDataLocal $PackageManifests[0].Directory.FullName

$StagingRoot = Join-Path $DataLocal "staging"
$HandoffCandidates = @()
Get-ChildItem -LiteralPath $StagingRoot -Filter "handoff-manifest.json" -File -Recurse | ForEach-Object {
  try {
    $Manifest = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Manifest.version -ne "ai-radar-calibrated-assessment-handoff-v0.1" -or $Manifest.batchId -ne $BatchId) { return }
    $AssembledRoot = Resolve-RepoPath ([string]$Manifest.outputs.assembledRoot)
    $ManifestHandoffDir = [System.IO.Path]::GetFullPath($_.Directory.FullName)
    $ExpectedHandoffDir = [System.IO.Path]::GetFullPath((Split-Path $AssembledRoot -Parent))
    if ($ManifestHandoffDir.Equals($ExpectedHandoffDir, [System.StringComparison]::OrdinalIgnoreCase)) { $HandoffCandidates += $_ }
  }
  catch { }
}
if ($HandoffCandidates.Count -ne 1) {
  $HandoffCandidates | Select-Object FullName | Format-Table -AutoSize
  throw "预期找到 1 个正式校准交接目录，实际找到 $($HandoffCandidates.Count) 个"
}

$HandoffDir = Assert-UnderDataLocal $HandoffCandidates[0].Directory.FullName
$CalibratedRoot = Assert-UnderDataLocal (Split-Path $HandoffDir -Parent)
$AssembledRoot = Assert-UnderDataLocal (Join-Path $HandoffDir "assembled")
$ResolvedRoot = Assert-UnderDataLocal (Join-Path $AssembledRoot "resolved")
$RawAssessmentFile = Assert-UnderDataLocal (Join-Path $AssembledRoot "radar-assess-research-0001.raw-assessments.jsonl")
$AssemblySummaryFile = Assert-UnderDataLocal (Join-Path $AssembledRoot "assembly-summary.json")
$ResolvedFile = Assert-UnderDataLocal (Join-Path $ResolvedRoot "ai-radar-calibrated-resolved-v01.jsonl")
$ResolverSummaryFile = Assert-UnderDataLocal (Join-Path $ResolvedRoot "ai-radar-calibrated-resolve-v01-summary.json")
$WorkingRoot = Assert-UnderDataLocal (Join-Path $DataLocal "working\ai-radar\prebatch2\$PackageId")
$CheckpointDir = Assert-UnderDataLocal (Join-Path $DataLocal "outputs\ai-radar\checkpoints\RADAR-ASSESS-RESEARCH-0001-prebatch2-checkpoint-v01")
$CheckpointZip = Assert-UnderDataLocal (Join-Path $DataLocal "outputs\ai-radar\checkpoints\RADAR-ASSESS-RESEARCH-0001-prebatch2-checkpoint-v01.zip")

Write-Host "[1/6] 校验并应用 3 条确定性 AI QA 修正" -ForegroundColor Cyan
node ".\scripts\radar\apply-ai-radar-ai-qa-package-v01.mjs" --package-dir $PackageDir --handoff-dir $HandoffDir --working-dir $WorkingRoot
Assert-LastExitCode "AI QA 修正应用失败"

Write-Host "[2/6] 重新组装 68 条校准评级" -ForegroundColor Cyan
node ".\scripts\radar\assemble-ai-radar-calibrated-assessment-handoff-v01.mjs" --batch-id $BatchId --out-dir $CalibratedRoot
Assert-LastExitCode "校准评级重新组装失败"

Write-Host "[3/6] 重新解析 AI 评级，并保持人工审核线独立" -ForegroundColor Cyan
node ".\scripts\radar\resolve-ai-radar-calibrated-assessments-v01.mjs" --input $RawAssessmentFile --out-dir $ResolvedRoot
Assert-LastExitCode "校准评级重新解析失败"

Write-Host "[4/6] 生成第一批 AI QA 最终候选" -ForegroundColor Cyan
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null
node ".\scripts\radar\finalize-ai-radar-ai-qa-v01.mjs" --package-dir $PackageDir --resolved-file $ResolvedFile --assembly-summary $AssemblySummaryFile --resolver-summary $ResolverSummaryFile --out-dir $CheckpointDir
Assert-LastExitCode "AI QA 最终候选生成失败"

Copy-Item -LiteralPath $AssemblySummaryFile -Destination (Join-Path $CheckpointDir "source-assembly-summary.json") -Force
Copy-Item -LiteralPath $ResolverSummaryFile -Destination (Join-Path $CheckpointDir "source-resolver-summary.json") -Force
Copy-Item -LiteralPath (Join-Path $WorkingRoot "apply-summary.json") -Destination (Join-Path $CheckpointDir "source-ai-qa-apply-summary.json") -Force
Copy-Item -LiteralPath $PackageManifests[0].FullName -Destination (Join-Path $CheckpointDir "source-package-manifest.json") -Force

Write-Host "[5/6] 运行研究、校准和 AI QA 测试" -ForegroundColor Cyan
$TestOutput = Join-Path $CheckpointDir "test-output.txt"
& node --test ".\tests\radar-research-handoff.test.mjs" ".\tests\radar-calibration-profile.test.mjs" ".\tests\radar-ai-qa-pipeline.test.mjs" 2>&1 | Tee-Object -FilePath $TestOutput
Assert-LastExitCode "第一批结束前测试失败"

$RunSummary = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  version = "ai-radar-prebatch2-run-v0.1"
  packageId = $PackageId
  batchId = $BatchId
  branch = (git branch --show-current).Trim()
  commit = (git rev-parse HEAD).Trim()
  packageZipSha256 = $ActualZipSha256
  packageDirectory = [System.IO.Path]::GetRelativePath($RepoRoot, $PackageDir)
  handoffDirectory = [System.IO.Path]::GetRelativePath($RepoRoot, $HandoffDir)
  checkpointDirectory = [System.IO.Path]::GetRelativePath($RepoRoot, $CheckpointDir)
  expected = [ordered]@{ aiQaPassedRows = 66; aiQaDeferredRows = 2; correctionsAppliedRows = 3; humanTrackMutations = 0 }
  safety = [ordered]@{ payloadWrite = $false; directPostgresqlWrite = $false; modifiesWorks = $false; publishesRatings = $false; onlyLocalArtifacts = $true; humanTrackMutations = 0 }
}
$RunSummary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $CheckpointDir "prebatch2-run-summary.json") -Encoding UTF8

$HashLines = @()
Get-ChildItem -LiteralPath $CheckpointDir -File -Recurse | Sort-Object FullName | ForEach-Object {
  $Relative = [System.IO.Path]::GetRelativePath($CheckpointDir, $_.FullName).Replace("\", "/")
  $Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $HashLines += "$Hash  $Relative"
}
$HashLines | Set-Content -LiteralPath (Join-Path $CheckpointDir "SHA256SUMS.txt") -Encoding UTF8

Write-Host "[6/6] 压缩唯一需要上传的检查点" -ForegroundColor Cyan
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $CheckpointDir "*") -DestinationPath $CheckpointZip -CompressionLevel Optimal
$CheckpointSha256 = (Get-FileHash -LiteralPath $CheckpointZip -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host ""
Write-Host "第一批 AI QA 闭环处理完成。" -ForegroundColor Green
[pscustomobject]@{
  AiQaPassedRows = 66
  AiQaDeferredRows = 2
  CorrectionsAppliedRows = 3
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointSha256 = $CheckpointSha256
} | Format-List
