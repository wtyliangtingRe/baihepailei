param(
  [Parameter(Mandatory = $true)][string]$TransactionReviewDirectory,
  [Parameter(Mandatory = $true)][string]$LabRehearsalDirectory,
  [Parameter(Mandatory = $true)][string]$BackupVerificationDirectory
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

$transactionDir = Resolve-RepoDirectory $TransactionReviewDirectory '事务审阅目录'
$labDir = Resolve-RepoDirectory $LabRehearsalDirectory '隔离往返演练目录'
$backupDir = Resolve-RepoDirectory $BackupVerificationDirectory '备份恢复验证目录'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-production-execution-gate-review-$stamp"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-PRODUCTION-EXECUTION-GATE-REVIEW-$stamp.zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$builder = Join-Path $PSScriptRoot 'build-test-work-production-execution-gate-review-v01.mjs'
& node $builder `
  --transaction-review-dir $transactionDir `
  --lab-rehearsal-dir $labDir `
  --backup-verification-dir $backupDir `
  --output-dir $outDir
if ($LASTEXITCODE -ne 0) {
  throw 'Production execution gate review 生成失败。'
}

$gatePath = Join-Path $outDir 'production-execution-gate-review.json'
$validationPath = Join-Path $outDir 'validation.json'
$manifestPath = Join-Path $outDir 'manifest.json'
$gate = Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
$validation = Get-Content -LiteralPath $validationPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 100

if ($gate.evidenceChainVerified -ne $true -or
    $gate.readyToRequestProductionApplyAuthorization -ne $true -or
    $gate.productionApplyAuthorized -ne $false -or
    $gate.productionRollbackAuthorized -ne $false -or
    $gate.productionExecutionWrapperGenerated -ne $false -or
    $gate.productionRollbackWrapperGenerated -ne $false -or
    $gate.executionWindowRequirements.freshBackupRequired -ne $true -or
    $gate.executionWindowRequirements.freshBackupRestoreVerificationRequiredBeforeApply -ne $true -or
    $gate.safety.databaseConnection -ne $false -or
    $gate.safety.productionDatabaseWrite -ne $false -or
    $gate.safety.executableApplySqlCopiedIntoPackage -ne $false -or
    $gate.safety.executableRollbackSqlCopiedIntoPackage -ne $false) {
  throw 'Production execution gate review 未证明预期安全边界。'
}
if ($validation.databaseConnection -ne $false -or
    $validation.productionDatabaseWrite -ne $false -or
    $validation.productionExecutionWrapperGenerated -ne $false -or
    $validation.productionApplyAuthorized -ne $false -or
    $validation.productionRollbackAuthorized -ne $false) {
  throw 'Production execution gate validation 未保持非执行状态。'
}

$forbiddenExtensions = @('.ps1', '.psm1', '.sh', '.cmd', '.bat', '.disabled')
foreach ($file in Get-ChildItem -LiteralPath $outDir -File) {
  foreach ($extension in $forbiddenExtensions) {
    if ($file.Name.EndsWith($extension, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Gate review 包不得包含可执行或 disabled apply 文件：$($file.Name)"
    }
  }
}

foreach ($sqlName in @(
  'production-preflight-readonly.sql',
  'production-post-merge-acceptance-readonly.sql',
  'production-post-rollback-acceptance-readonly.sql'
)) {
  $sqlPath = Join-Path $outDir $sqlName
  $sql = Get-Content -LiteralPath $sqlPath -Raw -Encoding UTF8
  if ($sql -notmatch '^\s*\\set ON_ERROR_STOP on' -or
      $sql -notmatch 'BEGIN TRANSACTION READ ONLY;' -or
      $sql -notmatch 'ROLLBACK;\s*$' -or
      $sql -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b') {
    throw "Gate review 中的 SQL 不是纯只读 acceptance：$sqlName"
  }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 50
foreach ($entry in @($manifest)) {
  $file = Join-Path $outDir ([string]$entry.file)
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "manifest 文件不存在：$($entry.file)"
  }
  $bytes = (Get-Item -LiteralPath $file).Length
  $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
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
Write-Host 'Test Work production execution gate review 与打包完成' -ForegroundColor Green
Write-Host "TransactionReviewDirectory : $transactionDir"
Write-Host "LabRehearsalDirectory      : $labDir"
Write-Host "BackupVerificationDirectory: $backupDir"
Write-Host "OutputDirectory            : $outDir"
Write-Host "Bundle                     : $bundlePath"
Write-Host "SHA256                     : $($bundleHash.Hash)"
Write-Host 'EvidenceChainVerified      : True'
Write-Host 'ReadyToRequestApplyApproval: True'
Write-Host 'FreshWindowBackupRequired  : True'
Write-Host 'FreshRestoreCheckRequired  : True'
Write-Host ''
Write-Host 'DatabaseConnection         : False'
Write-Host 'ProductionDatabaseWrite    : False'
Write-Host 'PayloadWrite               : False'
Write-Host 'ApplySQLCopied             : False'
Write-Host 'RollbackSQLCopied          : False'
Write-Host 'ProductionExecuteWrapper   : Not generated'
Write-Host 'ProductionRollbackWrapper  : Not generated'
Write-Host 'ProductionApplyAuthorized  : False'
Write-Host 'ProductionRollbackAuthorized: False'
