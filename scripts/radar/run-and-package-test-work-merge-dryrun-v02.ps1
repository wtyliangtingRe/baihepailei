param(
  [Parameter(Mandatory = $true)][string]$IdentityAuditDirectory,
  [Parameter(Mandatory = $true)][string[]]$Decision,
  [Parameter(Mandatory = $true)][switch]$DiscardTestAssessments
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

$sourceDir = [System.IO.Path]::GetFullPath($IdentityAuditDirectory)
if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
  throw "找不到 canonical identity 审计目录：$sourceDir"
}
if (-not $DiscardTestAssessments.IsPresent) {
  throw '必须显式传入 -DiscardTestAssessments 才能生成测试评级清理计划。'
}
if ($Decision.Count -eq 0) {
  throw '至少需要一个 mergeOut:canonical 决定。'
}
foreach ($item in $Decision) {
  if ($item -notmatch '^\d+:\d+$') {
    throw "无效决定，格式必须是 mergeOut:canonical：$item"
  }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-merge-dryrun-v02-$stamp"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-MERGE-DRYRUN-V02-$stamp.zip"
$planner = Join-Path $PSScriptRoot 'build-test-work-merge-dryrun-v01.mjs'
$refiner = Join-Path $PSScriptRoot 'refine-test-work-merge-dryrun-v02.mjs'

$nodeArgs = @(
  $planner,
  '--identity-audit-dir', $sourceDir,
  '--output-dir', $outDir,
  '--discard-test-assessments'
)
foreach ($item in $Decision) {
  $nodeArgs += @('--decision', $item)
}

& node @nodeArgs
if ($LASTEXITCODE -ne 0) {
  throw 'Test Work merge dry-run 基础计划生成失败。'
}

& node $refiner `
  --identity-audit-dir $sourceDir `
  --output-dir $outDir
if ($LASTEXITCODE -ne 0) {
  throw 'Test Work merge dry-run v02 语义校正失败。'
}

$requiredFiles = @(
  'canonical-merge-decisions.json',
  'field-merge-plan.jsonl',
  'relation-merge-plan.jsonl',
  'test-assessment-cleanup-plan.jsonl',
  'feedback-test-cleanup-plan.jsonl',
  'version-preservation-plan.jsonl',
  'exact-before-readonly.sql',
  'merge-preview-commented.sql',
  'merge-dryrun-summary.json',
  'merge-dryrun-summary.md',
  'manifest.json'
)
$missing = @(
  $requiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $outDir $_) -PathType Leaf)
  }
)
if ($missing.Count -gt 0) {
  throw "Test Work merge dry-run v02 输出不完整：$($missing -join ', ')"
}

$summary = Get-Content `
  -LiteralPath (Join-Path $outDir 'merge-dryrun-summary.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100

if ($summary.schemaVersion -ne 2 -or
    $summary.completeLegacyHumanReset -ne $true -or
    $summary.versionOwnershipMappedThroughWorksV -ne $true) {
  throw 'v02 人工字段或版本归属校正未生效。'
}
if ($summary.userAuthorizedTestAssessmentDiscard -ne $true) {
  throw '输出未绑定测试评级丢弃授权。'
}
if ($summary.canonicalDecisions -ne $Decision.Count) {
  throw "canonical 决定数量不匹配：$($summary.canonicalDecisions) / $($Decision.Count)"
}
if ($summary.safety.databaseWrite -ne $false -or
    $summary.safety.payloadWrite -ne $false -or
    $summary.safety.executableUpdateSqlGenerated -ne $false -or
    $summary.safety.canonicalDecisionApplied -ne $false -or
    $summary.safety.mergePerformed -ne $false -or
    $summary.safety.hardDeletePlanned -ne $false -or
    $summary.safety.versionRewritePlanned -ne $false) {
  throw 'Test Work merge dry-run v02 未证明安全边界。'
}

$cleanupRows = @(
  Get-Content `
    -LiteralPath (Join-Path $outDir 'test-assessment-cleanup-plan.jsonl') `
    -Encoding UTF8 |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_ | ConvertFrom-Json -Depth 100 }
)
if ($cleanupRows.Count -ne ($Decision.Count * 2)) {
  throw "评级清理行数不符合每组两个 Work：$($cleanupRows.Count)"
}
foreach ($row in $cleanupRows) {
  if ($row.completeLegacyHumanReset -ne $true -or
      $row.after.human_assessment_status -ne 'pending' -or
      $row.after.review_status -ne 'pending' -or
      $row.after.rank -ne 'unknown' -or
      $row.after.rating_notice -ne 'insufficient_information' -or
      $row.publicAIConclusionToCreate -ne $false) {
    throw "评级清理语义不完整：Work $($row.workId)"
  }
}

$versionRows = @(
  Get-Content `
    -LiteralPath (Join-Path $outDir 'version-preservation-plan.jsonl') `
    -Encoding UTF8 |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_ | ConvertFrom-Json -Depth 100 }
)
foreach ($row in $versionRows) {
  if ($row.versionOwnershipMappedThroughWorksV -ne $true -or
      $row.reparentVersions -ne $false -or
      $row.deleteVersions -ne $false) {
    throw "版本保留语义不完整：$($row.alertId)"
  }
}

$exactBefore = Get-Content `
  -LiteralPath (Join-Path $outDir 'exact-before-readonly.sql') `
  -Raw `
  -Encoding UTF8
if ($exactBefore -notmatch 'BEGIN TRANSACTION READ ONLY;' -or $exactBefore -notmatch 'ROLLBACK;') {
  throw 'exact-before SQL 缺少只读事务保护。'
}
if ($exactBefore -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b') {
  throw 'exact-before SQL 出现写入或 DDL。'
}

$preview = Get-Content `
  -LiteralPath (Join-Path $outDir 'merge-preview-commented.sql') `
  -Raw `
  -Encoding UTF8
$previewStatements = @(
  $preview -split '\r?\n' | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and $_ -notmatch '^\s*--'
  }
)
if ($previewStatements.Count -gt 0) {
  throw 'merge 预览中存在未注释的可执行文本。'
}

$manifest = Get-Content `
  -LiteralPath (Join-Path $outDir 'manifest.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 30
foreach ($entry in @($manifest)) {
  $file = Join-Path $outDir ([string]$entry.file)
  $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
  $bytes = (Get-Item -LiteralPath $file).Length
  if ($bytes -ne [long]$entry.bytes) {
    throw "manifest 字节数不匹配：$($entry.file)"
  }
  if ($hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
    throw "manifest SHA-256 不匹配：$($entry.file)"
  }
}

$paths = @(
  Get-ChildItem -LiteralPath $outDir -File |
    Sort-Object Name |
    ForEach-Object FullName
)
Compress-Archive `
  -LiteralPath $paths `
  -DestinationPath $bundlePath `
  -CompressionLevel Optimal `
  -Force

$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Write-Host ''
Write-Host 'Test Work merge dry-run v02 与打包完成' -ForegroundColor Green
Write-Host "SourceDirectory          : $sourceDir"
Write-Host "OutputDirectory          : $outDir"
Write-Host "Bundle                   : $bundlePath"
Write-Host "SHA256                   : $($bundleHash.Hash)"
Write-Host "IdentityGroups           : $($summary.identityGroups)"
Write-Host "CanonicalDecisions       : $($summary.canonicalDecisions)"
Write-Host "FieldPlanRows            : $($summary.fieldPlanRows)"
Write-Host "RelationPlanRows         : $($summary.relationPlanRows)"
Write-Host "AssessmentCleanupRows    : $($summary.assessmentCleanupRows)"
Write-Host "FeedbackCleanupRows      : $($summary.feedbackCleanupRows)"
Write-Host "VersionPreservationRows  : $($summary.versionPreservationRows)"
Write-Host 'CompleteLegacyHumanReset : True'
Write-Host 'VersionOwnershipMapped   : True'
Write-Host ''
Write-Host 'DatabaseWrite            : False'
Write-Host 'PayloadWrite             : False'
Write-Host 'ExecutableUpdateSQL      : False'
Write-Host 'CanonicalDecisionApplied : False'
Write-Host 'MergePerformed           : False'
Write-Host 'HardDeletePlanned        : False'
Write-Host 'VersionRewritePlanned    : False'
