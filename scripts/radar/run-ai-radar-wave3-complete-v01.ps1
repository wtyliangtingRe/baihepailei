param(
  [string]$PackageZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $RepoRoot

$PackageId = "RADAR-RESEARCH-WAVE-0003-0250-complete-results-v01"
$ResearchBatchId = "RADAR-RESEARCH-WAVE-0003-0250"
$ResearchBatchSlug = "radar-research-wave-0003-0250"
$AssessmentBatchId = "RADAR-ASSESS-RESEARCH-0250"
$AssessmentBatchSlug = "radar-assess-research-0250"
$ExpectedResearchRows = 250
$ExpectedResearchChunks = 50
$ExpectedAssessmentRows = 83
$ExpectedAssessmentChunks = 4
$ExpectedReady = 83
$ExpectedNeedsMore = 142
$ExpectedIdentityReview = 25
$ExpectedAiQaPassed = 80
$ExpectedAiQaDeferred = 3

$DataLocal = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "data_local"))
$IncomingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "incoming\ai-radar\packages"))
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $IncomingRoot $PackageId))
$WorkingRoot = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "working\ai-radar\wave3-complete-v01"))
$CheckpointBase = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\checkpoints"))
$CheckpointId = "RADAR-RESEARCH-WAVE-0003-0250-checkpoint-v01"
$CheckpointDir = [System.IO.Path]::GetFullPath((Join-Path $CheckpointBase $CheckpointId))
$CheckpointZip = [System.IO.Path]::GetFullPath((Join-Path $CheckpointBase "$CheckpointId.zip"))
$LedgerFile = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\state\ai-radar-processing-ledger-v01.jsonl"))
$LedgerSummaryFile = [System.IO.Path]::GetFullPath((Join-Path $DataLocal "outputs\ai-radar\state\ai-radar-processing-ledger-v01-summary.json"))

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

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
    throw "路径必须位于 data_local：$Resolved"
  }
  return $Resolved
}

function To-RepoRelative([string]$Value) {
  $Resolved = Resolve-RepoPath $Value
  Assert-UnderDataLocal $Resolved | Out-Null
  return [System.IO.Path]::GetRelativePath($RepoRoot, $Resolved).Replace("\", "/")
}

function Read-Jsonl([string]$File) {
  return @(
    Get-Content -LiteralPath $File -Encoding UTF8 |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_ | ConvertFrom-Json }
  )
}

function Write-JsonFile([string]$File, [object]$Value, [int]$Depth = 30) {
  $Parent = Split-Path $File -Parent
  New-Item -ItemType Directory -Path $Parent -Force | Out-Null
  $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $File -Encoding UTF8
}

function Get-ResultPackageZip {
  if (-not [string]::IsNullOrWhiteSpace($PackageZip)) {
    $Explicit = Resolve-RepoPath $PackageZip
    if (-not (Test-Path -LiteralPath $Explicit)) { throw "指定的第三波结果 ZIP 不存在：$Explicit" }
    return (Get-Item -LiteralPath $Explicit)
  }
  $Candidates = @()
  foreach ($Root in @((Join-Path $HOME "Downloads"), (Join-Path $DataLocal "incoming"), (Join-Path $DataLocal "outputs"))) {
    if (Test-Path -LiteralPath $Root) {
      $Candidates += @(Get-ChildItem -LiteralPath $Root -Filter "$PackageId*.zip" -File -Recurse -ErrorAction SilentlyContinue)
    }
  }
  $Candidates = @($Candidates | Sort-Object LastWriteTimeUtc -Descending)
  if ($Candidates.Count -eq 0) { throw "找不到 $PackageId.zip；请将下载的结果 ZIP 保存在 Downloads 中" }
  return $Candidates[0]
}

function Get-FullCatalogManifest {
  $Candidates = @()
  Get-ChildItem -LiteralPath (Join-Path $DataLocal "staging\ai-radar") -Filter "catalog-batch-manifest-v01.json" -File -Recurse |
    ForEach-Object {
      try {
        $Manifest = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        $External = @($Manifest.batches | Where-Object { $_.queue -eq "external_research" })
        $HasThird = @($External | Where-Object { $_.batchId -eq "RADAR-RESEARCH-0003" }).Count -eq 1
        $Rows = ($External | Measure-Object -Property rowCount -Sum).Sum
        if ($HasThird -and $Rows -ge 35000) {
          $Candidates += [pscustomobject]@{ File = $_; Rows = $Rows; LastWriteTimeUtc = $_.LastWriteTimeUtc }
        }
      } catch {}
    }
  if ($Candidates.Count -eq 0) { throw "找不到包含完整 external_research 队列的目录清单" }
  return ($Candidates | Sort-Object Rows, LastWriteTimeUtc -Descending | Select-Object -First 1).File
}

Write-Host "[1/9] 定位、解压并校验第三波完整结果包" -ForegroundColor Cyan
$SelectedPackageZip = Get-ResultPackageZip
Remove-Item -LiteralPath $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Expand-Archive -LiteralPath $SelectedPackageZip.FullName -DestinationPath $PackageDir -Force

$PackageManifestFile = Join-Path $PackageDir "package-manifest.json"
if (-not (Test-Path -LiteralPath $PackageManifestFile)) { throw "结果包缺少 package-manifest.json" }
$PackageManifest = Get-Content -LiteralPath $PackageManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($PackageManifest.version -ne "ai-radar-wave3-complete-results-package-v0.1" -or
    $PackageManifest.packageId -ne $PackageId -or
    $PackageManifest.researchBatchId -ne $ResearchBatchId -or
    $PackageManifest.assessmentBatchId -ne $AssessmentBatchId -or
    [int]$PackageManifest.researchRows -ne $ExpectedResearchRows -or
    [int]$PackageManifest.assessmentRows -ne $ExpectedAssessmentRows -or
    [int]$PackageManifest.assessmentChunks -ne $ExpectedAssessmentChunks) {
  throw "第三波结果包版本、批次或行数不匹配"
}
if ([int]$PackageManifest.safety.humanTrackMutations -ne 0 -or
    $PackageManifest.safety.payloadWrite -ne $false -or
    $PackageManifest.safety.directPostgresqlWrite -ne $false) {
  throw "第三波结果包安全声明不符合要求"
}
foreach ($Entry in @($PackageManifest.files)) {
  $Relative = ([string]$Entry.path).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  $File = [System.IO.Path]::GetFullPath((Join-Path $PackageDir $Relative))
  $Prefix = [System.IO.Path]::GetFullPath($PackageDir) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $File.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "结果包文件路径逃逸：$File" }
  if (-not (Test-Path -LiteralPath $File)) { throw "结果包缺少文件：$Relative" }
  $Actual = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne ([string]$Entry.sha256).ToLowerInvariant()) { throw "结果包文件 SHA-256 不匹配：$Relative" }
}

Write-Host "[2/9] 定位第三波研究 handoff 并规范化相对路径" -ForegroundColor Cyan
$HandoffCandidates = @()
Get-ChildItem -LiteralPath (Join-Path $DataLocal "staging\ai-radar") -Filter "handoff-manifest.json" -File -Recurse |
  ForEach-Object {
    try {
      $Candidate = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($Candidate.batchId -eq $ResearchBatchId -and [int]$Candidate.rowCount -eq $ExpectedResearchRows) {
        $HandoffCandidates += [pscustomobject]@{ File = $_; Manifest = $Candidate; LastWriteTimeUtc = $_.LastWriteTimeUtc }
      }
    } catch {}
  }
if ($HandoffCandidates.Count -eq 0) { throw "找不到 $ResearchBatchId 的 250 条研究 handoff" }
$SelectedHandoff = $HandoffCandidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$ResearchHandoffManifestFile = Assert-UnderDataLocal $SelectedHandoff.File.FullName
$ResearchHandoffDir = Assert-UnderDataLocal $SelectedHandoff.File.Directory.FullName
$ResearchRoot = Assert-UnderDataLocal (Split-Path $ResearchHandoffDir -Parent)
$ResearchManifest = $SelectedHandoff.Manifest
$PortableBackup = Join-Path $ResearchHandoffDir "handoff-manifest.pre-portable-v01.json"
if (-not (Test-Path -LiteralPath $PortableBackup)) { Copy-Item -LiteralPath $ResearchHandoffManifestFile -Destination $PortableBackup }
if (-not [string]::IsNullOrWhiteSpace([string]$ResearchManifest.sourceCatalogManifest)) {
  $ResearchManifest.sourceCatalogManifest = To-RepoRelative ([string]$ResearchManifest.sourceCatalogManifest)
}
if (-not [string]::IsNullOrWhiteSpace([string]$ResearchManifest.sourceBatchFile)) {
  $ResearchManifest.sourceBatchFile = To-RepoRelative ([string]$ResearchManifest.sourceBatchFile)
}
$ResearchManifest.copiedSourceFile = To-RepoRelative (Join-Path $ResearchHandoffDir "$ResearchBatchSlug.source.jsonl")
foreach ($Chunk in @($ResearchManifest.chunks)) {
  $Chunk.inputFile = To-RepoRelative (Join-Path $ResearchHandoffDir ("chunks\" + [System.IO.Path]::GetFileName([string]$Chunk.inputFile)))
  $Chunk.responseFile = To-RepoRelative (Join-Path $ResearchHandoffDir ("responses\" + [System.IO.Path]::GetFileName([string]$Chunk.responseFile)))
}
$ResearchManifest.outputs.instructions = To-RepoRelative (Join-Path $ResearchHandoffDir "RESEARCH_INSTRUCTIONS.md")
$ResearchManifest.outputs.assembledRoot = To-RepoRelative (Join-Path $ResearchHandoffDir "assembled")
$ResearchManifest.outputs.summary = To-RepoRelative (Join-Path $ResearchHandoffDir "handoff-summary.json")
Write-JsonFile $ResearchHandoffManifestFile $ResearchManifest

Write-Host "[3/9] 安装 50 个研究响应并完成研究组装" -ForegroundColor Cyan
$ResearchResponsePackageDir = Join-Path $PackageDir "research-responses"
foreach ($Chunk in @($ResearchManifest.chunks)) {
  $Name = [System.IO.Path]::GetFileName([string]$Chunk.responseFile)
  $Source = Join-Path $ResearchResponsePackageDir $Name
  $Destination = Assert-UnderDataLocal (Resolve-RepoPath ([string]$Chunk.responseFile))
  if (-not (Test-Path -LiteralPath $Source)) { throw "结果包缺少研究响应：$Name" }
  New-Item -ItemType Directory -Path (Split-Path $Destination -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}
node ".\scripts\radar\assemble-ai-radar-research-handoff-v01.mjs" `
  --batch-id $ResearchBatchId `
  --out-dir (To-RepoRelative $ResearchRoot)
Assert-LastExitCode "第三波研究结果组装失败"
$ResearchAssemblySummaryFile = Join-Path $ResearchHandoffDir "assembled\assembly-summary.json"
$ResearchAssembly = Get-Content -LiteralPath $ResearchAssemblySummaryFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($ResearchAssembly.complete -ne $true -or
    [int]$ResearchAssembly.assembledRows -ne $ExpectedResearchRows -or
    [int]$ResearchAssembly.assessmentReadyRows -ne $ExpectedReady -or
    [int]$ResearchAssembly.byResearchStatus.ready_for_ai_assessment -ne $ExpectedReady -or
    [int]$ResearchAssembly.byResearchStatus.needs_more_research -ne $ExpectedNeedsMore -or
    [int]$ResearchAssembly.byResearchStatus.identity_review -ne $ExpectedIdentityReview) {
  throw "第三波研究组装统计不符合预期"
}

Write-Host "[4/9] 生成 83 条站长校准评级输入并安装 AI 评级响应" -ForegroundColor Cyan
$AssessmentReadyManifest = Join-Path $ResearchHandoffDir "assembled\assessment-ready-manifest-v01.json"
$CalibratedRoot = Join-Path $ResearchHandoffDir "calibrated-assessment-handoffs-v01"
node ".\scripts\radar\prepare-ai-radar-calibrated-assessment-handoff-v01.mjs" `
  --batch-id $AssessmentBatchId `
  --manifest (To-RepoRelative $AssessmentReadyManifest) `
  --out-dir (To-RepoRelative $CalibratedRoot) `
  --chunk-size 25
Assert-LastExitCode "第三波校准评级输入生成失败"

$AssessmentHandoffDir = Join-Path $CalibratedRoot $AssessmentBatchSlug
$AssessmentHandoffManifestFile = Join-Path $AssessmentHandoffDir "handoff-manifest.json"
$AssessmentHandoff = Get-Content -LiteralPath $AssessmentHandoffManifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$AssessmentHandoff.rowCount -ne $ExpectedAssessmentRows -or
    [int]$AssessmentHandoff.chunkCount -ne $ExpectedAssessmentChunks -or
    $AssessmentHandoff.calibration.profileId -ne "site-owner-primary-v0.1") {
  throw "第三波校准评级 handoff 不符合预期"
}
$AssessmentResponsePackageDir = Join-Path $PackageDir "assessment-responses"
foreach ($Chunk in @($AssessmentHandoff.chunks)) {
  $InputFile = Assert-UnderDataLocal (Resolve-RepoPath ([string]$Chunk.inputFile))
  $ResponseFile = Assert-UnderDataLocal (Resolve-RepoPath ([string]$Chunk.responseFile))
  $Name = [System.IO.Path]::GetFileName($ResponseFile)
  $PackagedResponse = Join-Path $AssessmentResponsePackageDir $Name
  if (-not (Test-Path -LiteralPath $PackagedResponse)) { throw "结果包缺少评级响应：$Name" }
  $InputRows = @(Read-Jsonl $InputFile)
  $OutputRows = @(Read-Jsonl $PackagedResponse)
  if ($InputRows.Count -ne $OutputRows.Count -or $InputRows.Count -ne [int]$Chunk.rowCount) { throw "评级块行数不匹配：$Name" }
  for ($Index = 0; $Index -lt $InputRows.Count; $Index += 1) {
    if ([string]$InputRows[$Index].workId -ne [string]$OutputRows[$Index].workId -or
        [string]$InputRows[$Index].siteId -ne [string]$OutputRows[$Index].siteId) {
      throw "评级块身份或顺序不匹配：$Name，索引 $Index"
    }
  }
  New-Item -ItemType Directory -Path (Split-Path $ResponseFile -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $PackagedResponse -Destination $ResponseFile -Force
}

Write-Host "[5/9] 组装、解析并执行第三波 AI QA 独立线路" -ForegroundColor Cyan
node ".\scripts\radar\assemble-ai-radar-calibrated-assessment-handoff-v01.mjs" `
  --batch-id $AssessmentBatchId `
  --out-dir (To-RepoRelative $CalibratedRoot)
Assert-LastExitCode "第三波校准评级结果组装失败"
$AssessmentAssemblySummaryFile = Join-Path $AssessmentHandoffDir "assembled\assembly-summary.json"
$RawAssessmentFile = Join-Path $AssessmentHandoffDir "assembled\$AssessmentBatchSlug.raw-assessments.jsonl"
$ResolvedRoot = Join-Path $AssessmentHandoffDir "assembled\resolved"
node ".\scripts\radar\resolve-ai-radar-calibrated-assessments-v01.mjs" `
  --input (To-RepoRelative $RawAssessmentFile) `
  --out-dir (To-RepoRelative $ResolvedRoot)
Assert-LastExitCode "第三波校准评级解析失败"

$ResolvedFile = Join-Path $ResolvedRoot "ai-radar-calibrated-resolved-v01.jsonl"
$ResolverSummaryFile = Join-Path $ResolvedRoot "ai-radar-calibrated-resolve-v01-summary.json"
$AiQaOutputDir = Join-Path $AssessmentHandoffDir "assembled\ai-qa-final-v01"
node ".\scripts\radar\finalize-ai-radar-wave3-v01.mjs" `
  --decisions (To-RepoRelative (Join-Path $PackageDir "ai-qa\ai-radar-ai-qa-decisions-v0.1.jsonl")) `
  --targeted-research (To-RepoRelative (Join-Path $PackageDir "targeted-research\ai-radar-ai-qa-targeted-research-v0.1.jsonl")) `
  --resolved-file (To-RepoRelative $ResolvedFile) `
  --assembly-summary (To-RepoRelative $AssessmentAssemblySummaryFile) `
  --resolver-summary (To-RepoRelative $ResolverSummaryFile) `
  --out-dir (To-RepoRelative $AiQaOutputDir) `
  --expected-rows $ExpectedAssessmentRows `
  --expected-passed $ExpectedAiQaPassed `
  --expected-deferred $ExpectedAiQaDeferred
Assert-LastExitCode "第三波 AI QA 最终分流失败"
$AiQaSummaryFile = Join-Path $AiQaOutputDir "ai-radar-wave3-ai-qa-final-summary-v0.1.json"
$AiQaSummary = Get-Content -LiteralPath $AiQaSummaryFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$AiQaSummary.aiQaPassedRows -ne $ExpectedAiQaPassed -or
    [int]$AiQaSummary.aiQaDeferredRows -ne $ExpectedAiQaDeferred -or
    [int]$AiQaSummary.trackIsolation.humanTrackMutations -ne 0) {
  throw "第三波 AI QA 最终统计不符合预期"
}

Write-Host "[6/9] 重建目录快照增量台账" -ForegroundColor Cyan
$FullCatalogManifest = Get-FullCatalogManifest
node ".\scripts\radar\build-ai-radar-processing-ledger-v01.mjs" `
  --catalog-manifest (To-RepoRelative $FullCatalogManifest.FullName) `
  --scan-root "data_local" `
  --out (To-RepoRelative $LedgerFile)
Assert-LastExitCode "第三波增量台账重建失败"
if (-not (Test-Path -LiteralPath $LedgerFile) -or -not (Test-Path -LiteralPath $LedgerSummaryFile)) {
  throw "第三波增量台账或摘要未生成"
}
$LedgerSummary = Get-Content -LiteralPath $LedgerSummaryFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$LedgerSummary.ledgerRows -lt 450 -or
    [int]$LedgerSummary.safety.humanTrackMutations -ne 0) {
  throw "第三波增量台账统计或安全声明不符合预期"
}

Write-Host "[7/9] 运行第三波、台账与基础流程测试" -ForegroundColor Cyan
Remove-Item -LiteralPath $WorkingRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $WorkingRoot -Force | Out-Null
$TestOutput = Join-Path $WorkingRoot "test-output.txt"
& node --test `
  ".\tests\radar-research-handoff.test.mjs" `
  ".\tests\radar-calibration-profile.test.mjs" `
  ".\tests\radar-ai-qa-pipeline.test.mjs" `
  ".\tests\radar-batch2-kickoff.test.mjs" `
  ".\tests\radar-batch2-complete.test.mjs" `
  ".\tests\radar-wave3-kickoff.test.mjs" `
  ".\tests\radar-incremental-ledger.test.mjs" `
  ".\tests\radar-wave3-complete.test.mjs" 2>&1 | Tee-Object -FilePath $TestOutput
Assert-LastExitCode "第三波完整流程测试失败"

Write-Host "[8/9] 生成唯一需要上传的第三波检查点 ZIP" -ForegroundColor Cyan
Remove-Item -LiteralPath $CheckpointDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $CheckpointZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null
New-Item -ItemType Directory -Path $CheckpointBase -Force | Out-Null
$CheckpointCopies = @(
  @{ Source = $PackageManifestFile; Name = "source-package-manifest.json" },
  @{ Source = $ResearchAssemblySummaryFile; Name = "research-assembly-summary.json" },
  @{ Source = $AssessmentAssemblySummaryFile; Name = "assessment-assembly-summary.json" },
  @{ Source = $ResolverSummaryFile; Name = "assessment-resolver-summary.json" },
  @{ Source = $AiQaSummaryFile; Name = "ai-qa-final-summary.json" },
  @{ Source = (Join-Path $AiQaOutputDir "AI_RADAR_WAVE3_AI_QA_FINAL_REPORT_v0.1.md"); Name = "AI_RADAR_WAVE3_AI_QA_FINAL_REPORT_v0.1.md" },
  @{ Source = (Join-Path $AiQaOutputDir "ai-radar-wave3-ai-qa-decisions-v0.1.csv"); Name = "ai-radar-wave3-ai-qa-decisions-v0.1.csv" },
  @{ Source = (Join-Path $AiQaOutputDir "ai-radar-wave3-ai-qa-passed-v0.1.jsonl"); Name = "ai-radar-wave3-ai-qa-passed-v0.1.jsonl" },
  @{ Source = (Join-Path $AiQaOutputDir "ai-radar-wave3-ai-qa-deferred-v0.1.jsonl"); Name = "ai-radar-wave3-ai-qa-deferred-v0.1.jsonl" },
  @{ Source = (Join-Path $AiQaOutputDir "ai-radar-wave3-targeted-research-v0.1.jsonl"); Name = "ai-radar-wave3-targeted-research-v0.1.jsonl" },
  @{ Source = $LedgerFile; Name = "ai-radar-processing-ledger-v01.jsonl" },
  @{ Source = $LedgerSummaryFile; Name = "ai-radar-processing-ledger-v01-summary.json" },
  @{ Source = $TestOutput; Name = "test-output.txt" }
)
foreach ($Copy in $CheckpointCopies) {
  if (-not (Test-Path -LiteralPath $Copy.Source)) { throw "检查点来源文件不存在：$($Copy.Source)" }
  Copy-Item -LiteralPath $Copy.Source -Destination (Join-Path $CheckpointDir $Copy.Name) -Force
}
$CheckpointSummary = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  version = "ai-radar-wave3-checkpoint-v0.1"
  checkpointId = $CheckpointId
  research = [ordered]@{
    rows = $ExpectedResearchRows
    readyForAiAssessment = $ExpectedReady
    needsMoreResearch = $ExpectedNeedsMore
    identityReview = $ExpectedIdentityReview
  }
  aiAssessment = [ordered]@{
    rows = $ExpectedAssessmentRows
    calibrationProfileId = "site-owner-primary-v0.1"
    aiQaPassed = $ExpectedAiQaPassed
    aiQaDeferred = $ExpectedAiQaDeferred
    correctionsApplied = 0
  }
  ledger = [ordered]@{
    rows = [int]$LedgerSummary.ledgerRows
    mode = "catalog_snapshot_incremental"
    output = To-RepoRelative $LedgerFile
  }
  trackIsolation = [ordered]@{
    aiTrackRows = $ExpectedAssessmentRows
    humanTrackRowsCreated = 0
    humanTrackMutations = 0
    humanReviewStatus = "not_started_separate_track"
  }
  safety = [ordered]@{
    payloadRead = $false
    payloadWrite = $false
    directPostgresqlWrite = $false
    modifiesWorks = $false
    publishesRatings = $false
    onlyLocalArtifacts = $true
  }
  source = [ordered]@{
    resultPackage = $SelectedPackageZip.Name
    resultPackageSha256 = (Get-FileHash -LiteralPath $SelectedPackageZip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    gitBranch = (git branch --show-current).Trim()
    gitCommit = (git rev-parse HEAD).Trim()
  }
  nextStep = "Upload this single checkpoint ZIP. Future waves must be selected through the processing ledger."
}
Write-JsonFile (Join-Path $CheckpointDir "checkpoint-summary.json") $CheckpointSummary
$HashLines = @()
Get-ChildItem -LiteralPath $CheckpointDir -File -Recurse |
  Where-Object Name -ne "SHA256SUMS.txt" |
  Sort-Object FullName |
  ForEach-Object {
    $Relative = [System.IO.Path]::GetRelativePath($CheckpointDir, $_.FullName).Replace("\", "/")
    $Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $HashLines += "$Hash  $Relative"
  }
$HashLines | Set-Content -LiteralPath (Join-Path $CheckpointDir "SHA256SUMS.txt") -Encoding UTF8
Compress-Archive -Path (Join-Path $CheckpointDir "*") -DestinationPath $CheckpointZip -CompressionLevel Optimal
$CheckpointZipSha256 = (Get-FileHash -LiteralPath $CheckpointZip -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "[9/9] 第三波完整闭环完成" -ForegroundColor Green
[pscustomobject]@{
  ResearchRows = $ExpectedResearchRows
  AssessmentRows = $ExpectedAssessmentRows
  AiQaPassedRows = $ExpectedAiQaPassed
  AiQaDeferredRows = $ExpectedAiQaDeferred
  LedgerRows = [int]$LedgerSummary.ledgerRows
  HumanTrackMutations = 0
  PayloadWrite = $false
  DirectPostgresqlWrite = $false
  CheckpointZip = $CheckpointZip
  CheckpointZipSha256 = $CheckpointZipSha256
} | Format-List

explorer.exe $CheckpointBase
