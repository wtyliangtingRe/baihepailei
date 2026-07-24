param(
  [Parameter(Mandatory = $true)][string]$TransactionReviewDirectory,
  [Parameter(Mandatory = $true)][string]$GateReviewDirectory,
  [Parameter(Mandatory = $true)][string]$LabRehearsalDirectory,
  [Parameter(Mandatory = $true)][string]$BaselineSchemaAuditDirectory,
  [Parameter(Mandatory = $true)][ValidateSet('AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01')][string]$AuthorizationPhrase
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-Dir([string]$Value, [string]$Label) {
  $candidate = if ([System.IO.Path]::IsPathRooted($Value)) { [System.IO.Path]::GetFullPath($Value) } else { [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value)) }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { throw "找不到 $Label：$candidate" }
  return (Resolve-Path -LiteralPath $candidate).Path
}
function Test-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
}
function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

if ($AuthorizationPhrase -ne 'AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01') { throw 'Apply 授权不匹配。' }
$transactionDir = Resolve-Dir $TransactionReviewDirectory 'transaction review 目录'
$gateDir = Resolve-Dir $GateReviewDirectory 'gate review 目录'
$labDir = Resolve-Dir $LabRehearsalDirectory 'lab rehearsal 目录'
$schemaDir = Resolve-Dir $BaselineSchemaAuditDirectory 'schema audit 目录'
foreach ($dir in @($transactionDir,$gateDir,$labDir,$schemaDir)) { Test-Manifest $dir }

$gate = Get-Content -LiteralPath (Join-Path $gateDir 'production-execution-gate-review.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$lab = Get-Content -LiteralPath (Join-Path $labDir 'lab-rehearsal-summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$review = Get-Content -LiteralPath (Join-Path $transactionDir 'transaction-review.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($gate.evidenceChainVerified -ne $true -or $gate.readyToRequestProductionApplyAuthorization -ne $true -or $gate.authorization.applyPhrase -ne $AuthorizationPhrase) { throw 'Gate review 不允许生成 apply runner。' }
if ($lab.labRoundTripVerified -ne $true -or $lab.businessTableCountChecks -ne 83 -or $lab.safety.productionDatabaseWrite -ne $false) { throw 'Lab rehearsal 证据不完整。' }
if ($review.execution.executed -ne $false -or $review.operationCounts.exactBeforeRows -ne 1146) { throw 'Transaction review 状态或数量发生漂移。' }

$runnerV01Path = Join-Path $PSScriptRoot 'execute-test-work-production-apply-once-v01.ps1'
$runnerV02Path = Join-Path $PSScriptRoot 'execute-test-work-production-apply-once-v02.ps1'
$receiptBuilderPath = Join-Path $PSScriptRoot 'build-test-work-production-apply-receipt-v01.mjs'
foreach ($file in @($runnerV01Path,$runnerV02Path,$receiptBuilderPath)) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "缺少 runner 文件：$file" } }

$runnerV01Text = Get-Content -LiteralPath $runnerV01Path -Raw -Encoding UTF8
$runnerV02Text = Get-Content -LiteralPath $runnerV02Path -Raw -Encoding UTF8
if ($runnerV01Text -notmatch 'run-and-package-test-work-backup-verification-v02.ps1' -or
    $runnerV01Text -notmatch 'run-and-package-test-work-write-schema-audit-v01.ps1' -or
    $runnerV01Text -notmatch 'Assert-NoOtherClientSessions' -or
    $runnerV01Text -notmatch 'ProductionRollbackAuthorized : False' -or
    $runnerV01Text -notmatch 'rollbackAutomaticallyExecuted = \$false' -or
    $runnerV02Text -notmatch "ValidateSet\('AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01'\)" -or
    $runnerV02Text -notmatch 'return ,\$set' -or
    $runnerV02Text -notmatch 'writerContainersRestarted = \$true' -or
    $runnerV02Text -notmatch 'ParseFile\(\$temporary') {
  throw 'Production runner chain 缺少必要安全门槛。'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-production-apply-runner-review-$stamp"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-PRODUCTION-APPLY-RUNNER-REVIEW-$stamp.zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Copy-Item -LiteralPath $runnerV01Path -Destination (Join-Path $outDir 'execute-test-work-production-apply-once-v01.ps1.review-copy') -Force
Copy-Item -LiteralPath $runnerV02Path -Destination (Join-Path $outDir 'execute-test-work-production-apply-once-v02.ps1.review-copy') -Force
Copy-Item -LiteralPath $receiptBuilderPath -Destination (Join-Path $outDir 'build-test-work-production-apply-receipt-v01.mjs.review-copy') -Force

$head = (git rev-parse HEAD).Trim()
$authorizationHash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($AuthorizationPhrase))).Replace('-','').ToLowerInvariant()
$contract = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  branchHead = $head
  authorizationPhrase = $AuthorizationPhrase
  authorizationPhraseSha256 = $authorizationHash
  authorizationReceived = $true
  authorizedScope = 'one production apply only after all fresh execution-window gates pass'
  targetWorkIds = @(32186,10097,32094,25561)
  operationCounts = $review.operationCounts
  transactionManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $transactionDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  gateManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $gateDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  labManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $labDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  baselineSchemaManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $schemaDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  runnerV01Sha256 = (Get-FileHash -LiteralPath $runnerV01Path -Algorithm SHA256).Hash.ToLowerInvariant()
  runnerV02Sha256 = (Get-FileHash -LiteralPath $runnerV02Path -Algorithm SHA256).Hash.ToLowerInvariant()
  activeRunner = 'execute-test-work-production-apply-once-v02.ps1'
  receiptBuilderSha256 = (Get-FileHash -LiteralPath $receiptBuilderPath -Algorithm SHA256).Hash.ToLowerInvariant()
  freshBackupRequiredAtExecution = $true
  freshRestoreVerificationRequiredAtExecution = $true
  freshSchemaFingerprintRequiredAtExecution = $true
  writerPauseRequiredAtExecution = $true
  productionExecutionRunnerGenerated = $true
  productionExecutionRunnerReviewed = $false
  productionExecutionRunnerExecuted = $false
  productionDatabaseConnection = $false
  productionDatabaseWrite = $false
  productionRollbackAuthorized = $false
  automaticRollback = $false
  fullDumpRestoreAuthorized = $false
  migrationGeneration = $false
  schemaPush = $false
  payloadWrite = $false
  prMergeAuthorized = $false
}
Write-Json -Path (Join-Path $outDir 'production-apply-runner-review.json') -Value $contract

$readme = @"
# Production apply runner review

- Authorization received: true
- Branch head: $head
- Active runner: execute-test-work-production-apply-once-v02.ps1
- Target Works: 32186, 10097, 32094, 25561
- Fresh backup at execution: required
- Fresh isolated restore verification: required
- Fresh schema fingerprint: required
- Writer pause and client-session checks: required
- Automatic rollback: false
- Production rollback authorized: false
- Runner executed during packaging: false
- Production database connection during packaging: false
- Production database write during packaging: false
"@
[System.IO.File]::WriteAllText((Join-Path $outDir 'README.md'), ($readme.Trim() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))

$files = @(Get-ChildItem -LiteralPath $outDir -File | Sort-Object Name)
$manifest = @($files | ForEach-Object { $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256; [ordered]@{ file=$_.Name; bytes=$_.Length; sha256=$hash.Hash.ToLowerInvariant() } })
Write-Json -Path (Join-Path $outDir 'manifest.json') -Value $manifest
$paths = @((Get-ChildItem -LiteralPath $outDir -File | Sort-Object Name).FullName)
Compress-Archive -LiteralPath $paths -DestinationPath $bundlePath -CompressionLevel Optimal -Force
$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Write-Host ''
Write-Host 'Production apply runner 审阅包生成完成' -ForegroundColor Green
Write-Host "OutputDirectory           : $outDir"
Write-Host "Bundle                    : $bundlePath"
Write-Host "SHA256                    : $($bundleHash.Hash)"
Write-Host "BranchHead                : $head"
Write-Host 'ActiveRunner              : execute-test-work-production-apply-once-v02.ps1'
Write-Host 'AuthorizationReceived     : True'
Write-Host 'RunnerGenerated           : True'
Write-Host 'RunnerReviewed            : False'
Write-Host 'RunnerExecuted            : False'
Write-Host 'ProductionDatabaseConnect : False'
Write-Host 'ProductionDatabaseWrite   : False'
Write-Host 'RollbackAuthorized        : False'
