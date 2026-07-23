param(
  [Parameter(Mandatory = $true)][string]$IdentityAuditDirectory,
  [Parameter(Mandatory = $true)][string]$DryRunV03Directory,
  [Parameter(Mandatory = $true)][string]$BackupVerificationDirectory,
  [Parameter(Mandatory = $true)][string]$SchemaAuditDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-RepoDirectory([string]$Value, [string]$Label) {
  if ([System.IO.Path]::IsPathRooted($Value)) {
    $candidate = [System.IO.Path]::GetFullPath($Value)
  } else {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    throw "找不到 $Label：$candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

$identityDir = Resolve-RepoDirectory $IdentityAuditDirectory 'canonical identity 审计目录'
$dryRunDir = Resolve-RepoDirectory $DryRunV03Directory 'merge dry-run v03 目录'
$backupDir = Resolve-RepoDirectory $BackupVerificationDirectory '备份恢复验证目录'
$schemaDir = Resolve-RepoDirectory $SchemaAuditDirectory '写目标 schema 审计目录'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-merge-transaction-review-$stamp"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-MERGE-TRANSACTION-REVIEW-$stamp.zip"
$builder = Join-Path $PSScriptRoot 'build-test-work-merge-transaction-review-v02.mjs'

& node $builder `
  --identity-audit-dir $identityDir `
  --dryrun-v03-dir $dryRunDir `
  --backup-verification-dir $backupDir `
  --schema-audit-dir $schemaDir `
  --output-dir $outDir
if ($LASTEXITCODE -ne 0) {
  throw 'Test Work merge transaction review 生成失败。'
}

$requiredFiles = @(
  'transaction-review.json',
  'transaction-review.md',
  'transaction-operations.json',
  'transaction-standardization-refinements.jsonl',
  'merge-transaction.sql.disabled',
  'merge-rollback.sql.disabled',
  'merge-acceptance-readonly.sql',
  'merge-rollback-acceptance-readonly.sql',
  'manifest.json'
)
$missing = @(
  $requiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $outDir $_) -PathType Leaf)
  }
)
if ($missing.Count -gt 0) {
  throw "transaction review 输出不完整：$($missing -join ', ')"
}

$review = Get-Content `
  -LiteralPath (Join-Path $outDir 'transaction-review.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100

if ($review.execution.repositoryExecutionWrapperExists -ne $false -or
    $review.execution.executed -ne $false -or
    $review.execution.explicitApprovalReceived -ne $false -or
    $review.safety.databaseWrite -ne $false -or
    $review.safety.payloadWrite -ne $false -or
    $review.safety.executableSqlTextGenerated -ne $true -or
    $review.safety.executableSqlExtensionDisabled -ne $true -or
    $review.safety.executeWrapperGenerated -ne $false -or
    $review.safety.mergePerformed -ne $false -or
    $review.safety.rollbackPerformed -ne $false -or
    $review.safety.hardDeleteWorkPlanned -ne $false -or
    $review.safety.versionRewritePlanned -ne $false -or
    $review.safety.backupFileModified -ne $false) {
  throw 'transaction review 未保持预期安全边界。'
}

if ($review.operationCounts.workUpdates -ne 4 -or
    $review.operationCounts.feedbackArchives -ne 3 -or
    $review.operationCounts.versionGroupsPreserved -ne 2 -or
    $review.operationCounts.exactBeforeRelationCounts -ne 19 -or
    $review.operationCounts.exactBeforeVersionCounts -ne 11) {
  throw 'transaction review 核心操作数量与已审阅计划不一致。'
}
if ($review.operationCounts.exactBeforeRows -lt 45) {
  throw "transaction review exact-before 行覆盖不足：$($review.operationCounts.exactBeforeRows)"
}

$applyPath = Join-Path $outDir 'merge-transaction.sql.disabled'
$rollbackPath = Join-Path $outDir 'merge-rollback.sql.disabled'
$acceptancePath = Join-Path $outDir 'merge-acceptance-readonly.sql'
$rollbackAcceptancePath = Join-Path $outDir 'merge-rollback-acceptance-readonly.sql'
$apply = Get-Content -LiteralPath $applyPath -Raw -Encoding UTF8
$rollback = Get-Content -LiteralPath $rollbackPath -Raw -Encoding UTF8
$acceptance = Get-Content -LiteralPath $acceptancePath -Raw -Encoding UTF8
$rollbackAcceptance = Get-Content -LiteralPath $rollbackAcceptancePath -Raw -Encoding UTF8

foreach ($sql in @($apply, $rollback)) {
  if ($sql -notmatch 'BEGIN ISOLATION LEVEL SERIALIZABLE;' -or
      $sql -notmatch 'COMMIT;\s*$' -or
      $sql -notmatch 'FOR UPDATE' -or
      $sql -notmatch 'lock_timeout' -or
      $sql -notmatch 'statement_timeout') {
    throw 'apply / rollback SQL 缺少事务、锁或提交保护。'
  }
}
if ($apply -notmatch 'DO \$exact_before\$' -or
    $apply -notmatch 'DO \$acceptance\$' -or
    $rollback -notmatch 'DO \$rollback_guard\$' -or
    $rollback -notmatch 'DO \$rollback_acceptance\$') {
  throw 'apply / rollback SQL 缺少 exact guard 或事务内 acceptance。'
}
foreach ($sql in @($acceptance, $rollbackAcceptance)) {
  if ($sql -notmatch 'BEGIN TRANSACTION READ ONLY;' -or
      $sql -notmatch 'ROLLBACK;\s*$' -or
      $sql -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b') {
    throw 'acceptance SQL 不是纯只读 SQL。'
  }
}

$scriptSources = @(
  Get-Content -LiteralPath $builder -Raw -Encoding UTF8,
  Get-Content -LiteralPath $PSCommandPath -Raw -Encoding UTF8
) -join "`n"
if ($scriptSources -match '(?i)docker\s+exec.+psql' -or
    $scriptSources -match '(?i)Invoke-Sqlcmd' -or
    $scriptSources -match '(?i)DATABASE_URL') {
  throw 'transaction review 生成器意外包含数据库执行入口。'
}

$manifest = Get-Content `
  -LiteralPath (Join-Path $outDir 'manifest.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 50
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
Write-Host 'Test Work merge transaction review 与打包完成' -ForegroundColor Green
Write-Host "IdentityAuditDirectory    : $identityDir"
Write-Host "DryRunV03Directory        : $dryRunDir"
Write-Host "BackupVerificationDir     : $backupDir"
Write-Host "SchemaAuditDirectory      : $schemaDir"
Write-Host "OutputDirectory           : $outDir"
Write-Host "Bundle                    : $bundlePath"
Write-Host "SHA256                    : $($bundleHash.Hash)"
Write-Host "TargetWorks               : $($review.targetWorkIds -join ', ')"
Write-Host "WorkUpdates               : $($review.operationCounts.workUpdates)"
Write-Host "FactualChildReparents     : $($review.operationCounts.factualChildReparents)"
Write-Host "TestChildDeletes          : $($review.operationCounts.testAssessmentChildDeletes)"
Write-Host "FeedbackArchives          : $($review.operationCounts.feedbackArchives)"
Write-Host "SemanticDuplicateSkips    : $($review.operationCounts.semanticDuplicateSkips)"
Write-Host "PreservedRelationRows     : $($review.operationCounts.preservedRelationRows)"
Write-Host "StandardizationRefinements: $($review.operationCounts.standardizationRefinements)"
Write-Host "ExactBeforeRows           : $($review.operationCounts.exactBeforeRows)"
Write-Host "RelationCountGuards       : $($review.operationCounts.exactBeforeRelationCounts)"
Write-Host "VersionCountGuards        : $($review.operationCounts.exactBeforeVersionCounts)"
Write-Host ''
Write-Host 'ExecutableSQLText         : True'
Write-Host 'DisabledExtension         : True'
Write-Host 'ExecuteWrapperGenerated   : False'
Write-Host 'ExplicitApprovalReceived  : False'
Write-Host 'DatabaseWrite             : False'
Write-Host 'PayloadWrite              : False'
Write-Host 'MergePerformed            : False'
Write-Host 'RollbackPerformed         : False'
Write-Host 'BackupFileModified        : False'
