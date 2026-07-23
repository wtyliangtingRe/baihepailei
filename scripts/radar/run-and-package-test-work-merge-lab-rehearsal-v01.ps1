param(
  [Parameter(Mandatory = $true)][string]$TransactionReviewDirectory,
  [Parameter(Mandatory = $true)][string]$BackupVerificationDirectory,
  [Parameter(Mandatory = $true)][ValidateSet('RUN-ISOLATED-TEST-WORK-MERGE-LAB-V01')][string]$Confirm,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [int]$ReadyTimeoutSeconds = 90
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

function Test-ArtifactManifest([string]$Directory, [string]$ManifestName = 'manifest.json') {
  $manifestPath = Join-Path $Directory $ManifestName
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 $ManifestName：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
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
}

function Write-JsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText(
    $Path,
    ($json.TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Save-StageStatus {
  Write-JsonFile -Path $stageStatusPath -Value $stageStatus
}

function Invoke-LabSql(
  [string]$ContainerSqlPath,
  [string]$Prefix
) {
  $stdoutPath = Join-Path $outDir "$Prefix-stdout.txt"
  $stderrPath = Join-Path $outDir "$Prefix-stderr.txt"
  $dockerArgs = @(
    'exec',
    '-e', "PGPASSWORD=$labPassword",
    '-e', 'PGOPTIONS=-c TimeZone=UTC -c client_min_messages=warning',
    $labContainer,
    'psql',
    '-X',
    '-q',
    '-v', 'ON_ERROR_STOP=1',
    '-U', $labUser,
    '-d', $labDatabase,
    '-f', $ContainerSqlPath
  )
  & docker @dockerArgs 1> $stdoutPath 2> $stderrPath
  if ($LASTEXITCODE -ne 0) {
    throw "$Prefix 在隔离 PostgreSQL 容器中执行失败。"
  }
}

function Invoke-LabTableCounts(
  [string]$ContainerSqlPath,
  [string]$Prefix
) {
  $stdoutPath = Join-Path $outDir "$Prefix-table-counts.tsv"
  $stderrPath = Join-Path $outDir "$Prefix-table-counts-stderr.txt"
  $dockerArgs = @(
    'exec',
    '-e', "PGPASSWORD=$labPassword",
    '-e', 'PGOPTIONS=-c TimeZone=UTC -c client_min_messages=warning',
    $labContainer,
    'psql',
    '-X',
    '-qAt',
    '-v', 'ON_ERROR_STOP=1',
    '-F', "`t",
    '-U', $labUser,
    '-d', $labDatabase,
    '-f', $ContainerSqlPath
  )
  & docker @dockerArgs 1> $stdoutPath 2> $stderrPath
  if ($LASTEXITCODE -ne 0) {
    throw "$Prefix 业务表行数查询失败。"
  }
}

if ($Confirm -ne 'RUN-ISOLATED-TEST-WORK-MERGE-LAB-V01') {
  throw '隔离演练确认字符串不匹配。'
}

$transactionDir = Resolve-RepoDirectory $TransactionReviewDirectory '事务审阅目录'
$backupDir = Resolve-RepoDirectory $BackupVerificationDirectory '备份恢复验证目录'
Test-ArtifactManifest $transactionDir
Test-ArtifactManifest $backupDir 'evidence-manifest.json'

$reviewPath = Join-Path $transactionDir 'transaction-review.json'
$operationsPath = Join-Path $transactionDir 'transaction-operations.json'
$applyPath = Join-Path $transactionDir 'merge-transaction.sql.disabled'
$rollbackPath = Join-Path $transactionDir 'merge-rollback.sql.disabled'
$acceptancePath = Join-Path $transactionDir 'merge-acceptance-readonly.sql'
$rollbackAcceptancePath = Join-Path $transactionDir 'merge-rollback-acceptance-readonly.sql'
$backupSummaryPath = Join-Path $backupDir 'backup-verification-summary.json'
$backupPath = Join-Path $backupDir 'database-backup.dump'

foreach ($file in @(
  $reviewPath,
  $operationsPath,
  $applyPath,
  $rollbackPath,
  $acceptancePath,
  $rollbackAcceptancePath,
  $backupSummaryPath,
  $backupPath
)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "隔离演练输入文件不存在：$file"
  }
}

$review = Get-Content -LiteralPath $reviewPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
$backupSummary = Get-Content -LiteralPath $backupSummaryPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 100

if ($review.execution.repositoryExecutionWrapperExists -ne $false -or
    $review.execution.executed -ne $false -or
    $review.execution.explicitApprovalReceived -ne $false -or
    $review.safety.databaseWrite -ne $false -or
    $review.safety.executableSqlTextGenerated -ne $true -or
    $review.safety.executableSqlExtensionDisabled -ne $true -or
    $review.safety.executeWrapperGenerated -ne $false -or
    $review.safety.mergePerformed -ne $false -or
    $review.safety.rollbackPerformed -ne $false -or
    $review.safety.versionRewritePlanned -ne $false) {
  throw '事务审阅输入未保持预期安全边界。'
}
if ($review.operationCounts.workUpdates -ne 4 -or
    $review.operationCounts.factualChildReparents -ne 3 -or
    $review.operationCounts.testAssessmentChildDeletes -ne 17 -or
    $review.operationCounts.feedbackArchives -ne 3 -or
    $review.operationCounts.semanticDuplicateSkips -ne 1 -or
    $review.operationCounts.versionRowsGuardedExactly -ne 1118 -or
    $review.operationCounts.exactBeforeRows -ne 1146 -or
    $review.operationCounts.exactBeforeRelationCounts -ne 19 -or
    $review.operationCounts.exactBeforeVersionCounts -ne 11) {
  throw '事务审阅输入核心操作数量发生漂移。'
}
if ($backupSummary.backupRestoreVerified -ne $true -or
    $backupSummary.productionPreMatchedChecks -ne 37 -or
    $backupSummary.productionPostMatchedChecks -ne 37 -or
    $backupSummary.restoredMatchedChecks -ne 37 -or
    $backupSummary.safety.productionDatabaseWrite -ne $false -or
    $backupSummary.safety.ephemeralVerificationContainerRemoved -ne $true) {
  throw '备份恢复验证证据不完整。'
}

$backupBytes = (Get-Item -LiteralPath $backupPath).Length
$backupHash = Get-FileHash -LiteralPath $backupPath -Algorithm SHA256
if ($backupBytes -ne [long]$backupSummary.backupBytes -or
    $backupHash.Hash.ToLowerInvariant() -ne ([string]$backupSummary.backupSha256).ToLowerInvariant() -or
    $backupHash.Hash.ToLowerInvariant() -ne ([string]$review.backup.sha256).ToLowerInvariant()) {
  throw '本地 database-backup.dump 与事务审阅或恢复验证证据不一致。'
}

$apply = Get-Content -LiteralPath $applyPath -Raw -Encoding UTF8
$rollback = Get-Content -LiteralPath $rollbackPath -Raw -Encoding UTF8
$acceptance = Get-Content -LiteralPath $acceptancePath -Raw -Encoding UTF8
$rollbackAcceptance = Get-Content -LiteralPath $rollbackAcceptancePath -Raw -Encoding UTF8
foreach ($sql in @($apply, $rollback)) {
  if ($sql -notmatch 'BEGIN ISOLATION LEVEL SERIALIZABLE;' -or
      $sql -notmatch 'COMMIT;\s*$' -or
      $sql -notmatch 'FOR UPDATE' -or
      $sql -notmatch 'Verified backup SHA-256') {
    throw 'apply / rollback SQL 不满足隔离演练入口要求。'
  }
}
foreach ($sql in @($acceptance, $rollbackAcceptance)) {
  if ($sql -notmatch 'BEGIN TRANSACTION READ ONLY;' -or
      $sql -notmatch 'ROLLBACK;\s*$' -or
      $sql -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b') {
    throw 'acceptance SQL 不是纯只读 SQL。'
  }
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker 不可用。'
}
$sourceRunning = (& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') {
  throw "源 PostgreSQL 容器未运行：$SourcePostgresContainer"
}
$postgresImage = (& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresImage)) {
  throw "无法读取源 PostgreSQL 镜像：$SourcePostgresContainer"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-merge-lab-rehearsal-$stamp"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-MERGE-LAB-REHEARSAL-$stamp.zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$labContainer = "baihepailei-test-work-merge-lab-$stamp"
$labUser = 'merge_lab'
$labDatabase = 'merge_lab'
$labPassword = [Guid]::NewGuid().ToString('N')
$containerDumpPath = '/tmp/database-backup.dump'
$containerApplyPath = '/tmp/merge-transaction.sql.disabled'
$containerRollbackPath = '/tmp/merge-rollback.sql.disabled'
$containerAcceptancePath = '/tmp/merge-acceptance-readonly.sql'
$containerRollbackAcceptancePath = '/tmp/merge-rollback-acceptance-readonly.sql'
$containerTableCountPath = '/tmp/business-table-counts-readonly.sql'
$summaryBuilder = Join-Path $PSScriptRoot 'build-test-work-merge-lab-rehearsal-summary-v01.mjs'
$stageStatusPath = Join-Path $outDir 'lab-stage-status.json'
$stageStatus = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  restoreCompleted = $false
  baselineAcceptancePassed = $false
  applyTransactionPassed = $false
  postMergeAcceptancePassed = $false
  rollbackTransactionPassed = $false
  postRollbackAcceptancePassed = $false
}
Save-StageStatus

$sourceBindings = [ordered]@{
  transactionManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $transactionDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  transactionReviewSha256 = (Get-FileHash -LiteralPath $reviewPath -Algorithm SHA256).Hash.ToLowerInvariant()
  applySqlSha256 = (Get-FileHash -LiteralPath $applyPath -Algorithm SHA256).Hash.ToLowerInvariant()
  rollbackSqlSha256 = (Get-FileHash -LiteralPath $rollbackPath -Algorithm SHA256).Hash.ToLowerInvariant()
  acceptanceSqlSha256 = (Get-FileHash -LiteralPath $acceptancePath -Algorithm SHA256).Hash.ToLowerInvariant()
  rollbackAcceptanceSqlSha256 = (Get-FileHash -LiteralPath $rollbackAcceptancePath -Algorithm SHA256).Hash.ToLowerInvariant()
  backupBytes = $backupBytes
  backupSha256 = $backupHash.Hash.ToLowerInvariant()
  postgresImage = $postgresImage
  sourceContainer = $SourcePostgresContainer
  sourceContainerAccess = 'docker inspect only'
}
Write-JsonFile -Path (Join-Path $outDir 'source-bindings.json') -Value $sourceBindings

[System.IO.File]::WriteAllText(
  (Join-Path $outDir 'postgres-image.txt'),
  ($postgresImage + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)

$tableCountSqlPath = Join-Path $outDir 'business-table-counts-readonly.sql'
$tableCountSql = @'
BEGIN TRANSACTION READ ONLY;

SELECT format(
  'SELECT %L AS table_name, count(*)::bigint AS row_count FROM %I.%I;',
  schemaname || '.' || tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec

ROLLBACK;
'@
[System.IO.File]::WriteAllText(
  $tableCountSqlPath,
  ($tableCountSql.Trim() + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)

$labContainerRemoved = $false
$operationError = $null
try {
  $containerId = (& docker run `
    -d `
    --name $labContainer `
    --network none `
    -e "POSTGRES_USER=$labUser" `
    -e "POSTGRES_PASSWORD=$labPassword" `
    -e "POSTGRES_DB=$labDatabase" `
    $postgresImage).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
    throw '启动无网络隔离 PostgreSQL 演练容器失败。'
  }

  $ready = $false
  $attempts = [Math]::Max(1, [Math]::Ceiling($ReadyTimeoutSeconds / 2))
  for ($index = 0; $index -lt $attempts; $index += 1) {
    & docker exec `
      -e "PGPASSWORD=$labPassword" `
      $labContainer `
      pg_isready `
      -U $labUser `
      -d $labDatabase `
      *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    throw '隔离 PostgreSQL 演练容器未在限时内就绪。'
  }

  foreach ($copy in @(
    @($backupPath, $containerDumpPath),
    @($applyPath, $containerApplyPath),
    @($rollbackPath, $containerRollbackPath),
    @($acceptancePath, $containerAcceptancePath),
    @($rollbackAcceptancePath, $containerRollbackAcceptancePath),
    @($tableCountSqlPath, $containerTableCountPath)
  )) {
    & docker cp ([string]$copy[0]) "${labContainer}:$([string]$copy[1])"
    if ($LASTEXITCODE -ne 0) {
      throw "复制隔离演练输入失败：$([string]$copy[0])"
    }
  }

  $restoreStdout = Join-Path $outDir 'pg-restore-stdout.txt'
  $restoreStderr = Join-Path $outDir 'pg-restore-stderr.txt'
  & docker exec `
    -e "PGPASSWORD=$labPassword" `
    $labContainer `
    pg_restore `
    --exit-on-error `
    --no-owner `
    --no-privileges `
    -U $labUser `
    -d $labDatabase `
    $containerDumpPath `
    1> $restoreStdout `
    2> $restoreStderr
  if ($LASTEXITCODE -ne 0) {
    throw '隔离演练数据库恢复失败。'
  }
  $stageStatus.restoreCompleted = $true
  Save-StageStatus

  Invoke-LabSql -ContainerSqlPath $containerRollbackAcceptancePath -Prefix 'baseline-acceptance'
  $stageStatus.baselineAcceptancePassed = $true
  Save-StageStatus
  Invoke-LabTableCounts -ContainerSqlPath $containerTableCountPath -Prefix 'baseline'

  Invoke-LabSql -ContainerSqlPath $containerApplyPath -Prefix 'apply-transaction'
  $stageStatus.applyTransactionPassed = $true
  Save-StageStatus

  Invoke-LabSql -ContainerSqlPath $containerAcceptancePath -Prefix 'post-merge-acceptance'
  $stageStatus.postMergeAcceptancePassed = $true
  Save-StageStatus
  Invoke-LabTableCounts -ContainerSqlPath $containerTableCountPath -Prefix 'post-merge'

  Invoke-LabSql -ContainerSqlPath $containerRollbackPath -Prefix 'rollback-transaction'
  $stageStatus.rollbackTransactionPassed = $true
  Save-StageStatus

  Invoke-LabSql -ContainerSqlPath $containerRollbackAcceptancePath -Prefix 'post-rollback-acceptance'
  $stageStatus.postRollbackAcceptancePassed = $true
  Save-StageStatus
  Invoke-LabTableCounts -ContainerSqlPath $containerTableCountPath -Prefix 'post-rollback'

  $containerLogsStdout = Join-Path $outDir 'lab-container-stdout.log'
  $containerLogsStderr = Join-Path $outDir 'lab-container-stderr.log'
  & docker logs $labContainer 1> $containerLogsStdout 2> $containerLogsStderr
} catch {
  $operationError = $_
  try {
    $containerLogsStdout = Join-Path $outDir 'lab-container-stdout.log'
    $containerLogsStderr = Join-Path $outDir 'lab-container-stderr.log'
    & docker logs $labContainer 1> $containerLogsStdout 2> $containerLogsStderr
  } catch {
    # Best-effort failure evidence only.
  }
} finally {
  & docker rm -fv $labContainer *> $null
  $labContainerRemoved = ($LASTEXITCODE -eq 0)
  if (-not $labContainerRemoved) {
    $stillExists = (& docker inspect -f '{{.Id}}' $labContainer 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($stillExists | Out-String).Trim())) {
      $labContainerRemoved = $true
    }
  }
}

$validation = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  confirmationMatched = $true
  sourceContainerInspectOnly = $true
  sourceContainer = $SourcePostgresContainer
  sourceImage = $postgresImage
  labContainer = $labContainer
  labNetworkDisabled = $true
  labContainerRemoved = $labContainerRemoved
  productionDatabaseWrite = $false
  payloadWrite = $false
  migrationGeneration = $false
  schemaPush = $false
  labDatabaseWrite = $true
  mergePerformedInProduction = $false
  rollbackPerformedInProduction = $false
  backupFileModified = $false
  productionExecutionWrapperGenerated = $false
  productionExecutionApproved = $false
}
Write-JsonFile -Path (Join-Path $outDir 'lab-rehearsal-validation.json') -Value $validation

if ($null -ne $operationError) {
  Write-JsonFile -Path (Join-Path $outDir 'lab-rehearsal-failure.json') -Value ([ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString('o')
    message = $operationError.Exception.Message
    stageStatus = $stageStatus
    labContainerRemoved = $labContainerRemoved
    productionDatabaseWrite = $false
  })
  throw $operationError
}
if (-not $labContainerRemoved) {
  throw '隔离 PostgreSQL 演练容器未确认删除。'
}

& node $summaryBuilder `
  --directory $outDir `
  --transaction-review-dir $transactionDir
if ($LASTEXITCODE -ne 0) {
  throw '隔离 merge 往返演练证据汇总失败。'
}

$summary = Get-Content `
  -LiteralPath (Join-Path $outDir 'lab-rehearsal-summary.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
if ($summary.labRoundTripVerified -ne $true -or
    $summary.readyForProductionExecutionPlanning -ne $true -or
    $summary.safety.productionDatabaseWrite -ne $false -or
    $summary.safety.labDatabaseWrite -ne $true -or
    $summary.safety.labNetworkDisabled -ne $true -or
    $summary.safety.labContainerRemoved -ne $true -or
    $summary.safety.productionExecutionWrapperGenerated -ne $false -or
    $summary.safety.productionExecutionApproved -ne $false) {
  throw '隔离演练摘要未证明完整往返与安全边界。'
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
Write-Host 'Test Work merge 隔离恢复库完整往返演练完成' -ForegroundColor Green
Write-Host "TransactionReviewDirectory : $transactionDir"
Write-Host "BackupVerificationDirectory: $backupDir"
Write-Host "OutputDirectory            : $outDir"
Write-Host "Bundle                     : $bundlePath"
Write-Host "SHA256                     : $($bundleHash.Hash)"
Write-Host "BusinessTableCountChecks   : $($summary.businessTableCountChecks)"
Write-Host 'RestoreCompleted           : True'
Write-Host 'BaselineAcceptance         : Passed'
Write-Host 'ApplyTransaction           : Passed'
Write-Host 'PostMergeAcceptance        : Passed'
Write-Host 'RollbackTransaction        : Passed'
Write-Host 'PostRollbackAcceptance     : Passed'
Write-Host 'LabRoundTripVerified       : True'
Write-Host ''
Write-Host 'SourceContainerAccess      : Inspect only'
Write-Host 'ProductionDatabaseWrite    : False'
Write-Host 'PayloadWrite               : False'
Write-Host 'LabDatabaseWrite           : True (isolated disposable container only)'
Write-Host 'LabNetwork                 : Disabled'
Write-Host 'LabContainer               : Removed'
Write-Host 'MergePerformedInProduction : False'
Write-Host 'RollbackInProduction       : False'
Write-Host 'ProductionExecuteWrapper   : Not generated'
Write-Host 'ProductionExecutionApproved: False'
Write-Host 'BackupFileModified         : False'
