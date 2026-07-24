param(
  [Parameter(Mandatory = $true)][string]$TransactionReviewDirectory,
  [Parameter(Mandatory = $true)][string]$GateReviewDirectory,
  [Parameter(Mandatory = $true)][string]$DryRunV03Directory,
  [Parameter(Mandatory = $true)][string]$ExactBeforeDirectory,
  [Parameter(Mandatory = $true)][string]$BaselineSchemaAuditDirectory,
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][ValidateSet('AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01')][string]$AuthorizationPhrase,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-Directory([string]$Value, [string]$Label) {
  $candidate = if ([System.IO.Path]::IsPathRooted($Value)) {
    [System.IO.Path]::GetFullPath($Value)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    throw "找不到 $Label：$candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Test-Manifest([string]$Directory, [string]$Name = 'manifest.json') {
  $manifestPath = Join-Path $Directory $Name
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "缺少 $Name：$Directory" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "manifest 文件不存在：$($entry.file)" }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    $bytes = (Get-Item -LiteralPath $file).Length
    if ($bytes -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
}

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-DirectorySet([string]$Pattern) {
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter $Pattern -ErrorAction SilentlyContinue |
    ForEach-Object { $null = $set.Add($_.FullName) }
  return $set
}

function Get-NewDirectory([string]$Pattern, [System.Collections.Generic.HashSet[string]]$Before) {
  $items = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter $Pattern |
    Where-Object { -not $Before.Contains($_.FullName) } |
    Sort-Object LastWriteTimeUtc -Descending)
  if ($items.Count -ne 1) { throw "预期恰好一个新目录 $Pattern，实际：$($items.Count)" }
  return $items[0].FullName
}

function Invoke-ReadOnlySql([string]$SqlPath, [string]$Prefix) {
  $containerPath = "/tmp/test-work-production-$executionId-$Prefix.sql"
  $stdout = Join-Path $outDir "$Prefix-stdout.txt"
  $stderr = Join-Path $outDir "$Prefix-stderr.txt"
  try {
    & docker cp $SqlPath "${PostgresContainer}:$containerPath"
    if ($LASTEXITCODE -ne 0) { throw "复制只读 SQL 失败：$Prefix" }
    & docker exec `
      -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
      $PostgresContainer `
      psql -X -q -v ON_ERROR_STOP=1 -U $DatabaseUser -d $Database -f $containerPath `
      1> $stdout 2> $stderr
    if ($LASTEXITCODE -ne 0) { throw "生产只读 SQL 失败：$Prefix" }
    $stderrLines = @(Get-Content -LiteralPath $stderr -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($stderrLines.Count -ne 0) { throw "生产只读 SQL stderr 非空：$Prefix ($($stderrLines.Count))" }
  } finally {
    & docker exec $PostgresContainer rm -f $containerPath *> $null
  }
}

function Invoke-TableCounts([string]$Prefix) {
  $containerPath = "/tmp/test-work-production-$executionId-$Prefix-counts.sql"
  $stdout = Join-Path $outDir "$Prefix-table-counts.tsv"
  $stderr = Join-Path $outDir "$Prefix-table-counts-stderr.txt"
  try {
    & docker cp $tableCountSqlPath "${PostgresContainer}:$containerPath"
    if ($LASTEXITCODE -ne 0) { throw "复制表计数 SQL 失败：$Prefix" }
    & docker exec `
      -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
      $PostgresContainer `
      psql -X -qAt -v ON_ERROR_STOP=1 -F "`t" -U $DatabaseUser -d $Database -f $containerPath `
      1> $stdout 2> $stderr
    if ($LASTEXITCODE -ne 0) { throw "生产表计数失败：$Prefix" }
    $rows = @(Get-Content -LiteralPath $stdout -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($rows.Count -ne 83) { throw "生产业务表计数不是 83：$Prefix = $($rows.Count)" }
    $stderrLines = @(Get-Content -LiteralPath $stderr -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($stderrLines.Count -ne 0) { throw "生产表计数 stderr 非空：$Prefix" }
    return $stdout
  } finally {
    & docker exec $PostgresContainer rm -f $containerPath *> $null
  }
}

function Assert-NoOtherClientSessions([string]$Label) {
  for ($attempt = 1; $attempt -le 2; $attempt += 1) {
    $value = (& docker exec `
      -e 'PGOPTIONS=-c default_transaction_read_only=on' `
      $PostgresContainer `
      psql -X -qAt -v ON_ERROR_STOP=1 -U $DatabaseUser -d $Database `
      -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';").Trim()
    if ($LASTEXITCODE -ne 0 -or $value -ne '0') { throw "$Label 检测到其他数据库客户端连接：$value" }
    if ($attempt -eq 1) { Start-Sleep -Seconds 2 }
  }
}

function Restart-WriterContainers {
  param([string[]]$Names)
  $failed = @()
  foreach ($name in $Names) {
    & docker start $name *> $null
    if ($LASTEXITCODE -ne 0) { $failed += $name }
  }
  if ($failed.Count -gt 0) { throw "恢复 writer 容器失败：$($failed -join ', ')" }
}

if ($AuthorizationPhrase -ne 'AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01') { throw 'Production apply 授权不匹配。' }
$currentHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $currentHead -ne $ExpectedBranchHead) { throw "分支 HEAD 不符合已审阅值：$currentHead" }
$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -ne 'agent/radar-public-conclusions-v01') { throw "当前分支不正确：$currentBranch" }

$transactionDir = Resolve-Directory $TransactionReviewDirectory 'transaction review 目录'
$gateDir = Resolve-Directory $GateReviewDirectory 'production gate review 目录'
$dryRunDir = Resolve-Directory $DryRunV03Directory 'merge dry-run v03 目录'
$exactDir = Resolve-Directory $ExactBeforeDirectory 'exact-before 目录'
$baselineSchemaDir = Resolve-Directory $BaselineSchemaAuditDirectory 'baseline schema audit 目录'
Test-Manifest $transactionDir
Test-Manifest $gateDir
Test-Manifest $dryRunDir
Test-Manifest $exactDir
Test-Manifest $baselineSchemaDir

$review = Get-Content -LiteralPath (Join-Path $transactionDir 'transaction-review.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$gate = Get-Content -LiteralPath (Join-Path $gateDir 'production-execution-gate-review.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($gate.evidenceChainVerified -ne $true -or
    $gate.readyToRequestProductionApplyAuthorization -ne $true -or
    $gate.productionApplyAuthorized -ne $false -or
    $gate.authorization.applyPhrase -ne $AuthorizationPhrase -or
    $gate.executionWindowRequirements.freshBackupRequired -ne $true -or
    $gate.executionWindowRequirements.freshBackupRestoreVerificationRequiredBeforeApply -ne $true) {
  throw 'Production gate review 未满足 apply runner 前置条件。'
}
if ($review.operationCounts.workUpdates -ne 4 -or
    $review.operationCounts.factualChildReparents -ne 3 -or
    $review.operationCounts.testAssessmentChildDeletes -ne 17 -or
    $review.operationCounts.feedbackArchives -ne 3 -or
    $review.operationCounts.exactBeforeRows -ne 1146) {
  throw '事务操作数量发生漂移。'
}

$transactionManifestHash = (Get-FileHash -LiteralPath (Join-Path $transactionDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$gateManifestHash = (Get-FileHash -LiteralPath (Join-Path $gateDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$applyPath = Join-Path $transactionDir 'merge-transaction.sql.disabled'
$postAcceptancePath = Join-Path $gateDir 'production-post-merge-acceptance-readonly.sql'
$preflightPath = Join-Path $gateDir 'production-preflight-readonly.sql'
$applyHash = (Get-FileHash -LiteralPath $applyPath -Algorithm SHA256).Hash.ToLowerInvariant()
$acceptanceHash = (Get-FileHash -LiteralPath $postAcceptancePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($transactionManifestHash -ne ([string]$gate.sourceHashes.transactionManifestSha256).ToLowerInvariant() -or
    $applyHash -ne ([string]$gate.sourceHashes.applySqlSha256).ToLowerInvariant() -or
    $acceptanceHash -ne ([string]$gate.sourceHashes.acceptanceSqlSha256).ToLowerInvariant()) {
  throw 'Production gate 与 transaction review 哈希绑定失败。'
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$running = (& docker inspect -f '{{.State.Running}}' $PostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or $running -ne 'true') { throw "PostgreSQL 容器未运行：$PostgresContainer" }
$productionImage = (& docker inspect -f '{{.Config.Image}}' $PostgresContainer).Trim()
if ($productionImage -ne [string]$gate.executionWindowRequirements.productionContainerImageMustMatchRehearsedImage) {
  throw "生产 PostgreSQL 镜像与演练不一致：$productionImage"
}
$composeProject = (& docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' $PostgresContainer).Trim()
if ([string]::IsNullOrWhiteSpace($composeProject) -or $composeProject -eq '<no value>') { throw '无法确认 Docker Compose project。' }

$hostWriterProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
  $command = [string]$_.CommandLine
  -not [string]::IsNullOrWhiteSpace($command) -and
  $command.IndexOf($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
  $command -match '(?i)\b(node|npm|pnpm|yarn|tsx|bun|deno|python|payload|next)\b'
})
if ($hostWriterProcesses.Count -gt 0) {
  $descriptions = $hostWriterProcesses | ForEach-Object { "PID=$($_.ProcessId) $($_.CommandLine)" }
  throw "检测到可能写数据库的本地进程，请先停止：`n$($descriptions -join "`n")"
}

$executionId = "test-work-production-apply-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$outDir = Join-Path $repoRoot "exports\$executionId"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-PRODUCTION-APPLY-RECEIPT-$($executionId.Replace('test-work-production-apply-','')).zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$startedAt = [DateTime]::UtcNow.ToString('o')

$tableCountSqlPath = Join-Path $outDir 'business-table-counts-readonly.sql'
$tableCountSql = @'
BEGIN TRANSACTION READ ONLY;
SELECT format('SELECT %L AS table_name, count(*)::bigint AS row_count FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
ROLLBACK;
'@
[System.IO.File]::WriteAllText($tableCountSqlPath, ($tableCountSql.Trim() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))

$writerContainers = @(& docker ps --filter "label=com.docker.compose.project=$composeProject" --format '{{.Names}}' |
  Where-Object { $_ -and $_ -ne $PostgresContainer })
Write-Json -Path (Join-Path $outDir 'maintenance-window.json') -Value ([ordered]@{
  executionId = $executionId
  startedAt = $startedAt
  composeProject = $composeProject
  productionContainer = $PostgresContainer
  writerContainersToStop = $writerContainers
  localWriterProcessesDetected = 0
})

$applyCommitted = $false
$allAccepted = $false
$writersRestarted = $false
$operationError = $null
$freshBackupDir = $null
$freshSchemaDir = $null
$tempApplyPath = "/tmp/$executionId-apply.sql"
try {
  foreach ($name in $writerContainers) {
    & docker stop -t 30 $name *> $null
    if ($LASTEXITCODE -ne 0) { throw "停止 writer 容器失败：$name" }
  }
  Start-Sleep -Seconds 3
  Assert-NoOtherClientSessions '维护窗口开始'

  $backupBefore = Get-DirectorySet 'test-work-backup-verification-*'
  & (Join-Path $PSScriptRoot 'run-and-package-test-work-backup-verification-v02.ps1') `
    -DryRunV03Directory $dryRunDir `
    -ExactBeforeDirectory $exactDir `
    -PostgresContainer $PostgresContainer `
    -Database $Database `
    -DatabaseUser $DatabaseUser
  if ($LASTEXITCODE -ne 0) { throw 'Fresh execution-window backup verification 失败。' }
  $freshBackupDir = Get-NewDirectory 'test-work-backup-verification-*' $backupBefore
  $freshBackupSummary = Get-Content -LiteralPath (Join-Path $freshBackupDir 'backup-verification-summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if ($freshBackupSummary.backupRestoreVerified -ne $true -or $freshBackupSummary.businessTableCountChecks -ne 83) {
    throw 'Fresh backup 未通过完整恢复验证。'
  }

  $schemaBefore = Get-DirectorySet 'test-work-write-schema-audit-*'
  & (Join-Path $PSScriptRoot 'run-and-package-test-work-write-schema-audit-v01.ps1') `
    -DryRunV03Directory $dryRunDir `
    -BackupVerificationDirectory $freshBackupDir `
    -PostgresContainer $PostgresContainer `
    -Database $Database `
    -DatabaseUser $DatabaseUser
  if ($LASTEXITCODE -ne 0) { throw 'Fresh schema audit 失败。' }
  $freshSchemaDir = Get-NewDirectory 'test-work-write-schema-audit-*' $schemaBefore

  $schemaFiles = @(
    'table-metadata.jsonl','column-metadata.jsonl','constraints.jsonl','indexes.jsonl',
    'triggers.jsonl','policies.jsonl','enum-labels.jsonl','sequence-metadata.jsonl','unique-definitions.json'
  )
  $schemaDiffs = @()
  foreach ($name in $schemaFiles) {
    $beforeHash = (Get-FileHash -LiteralPath (Join-Path $baselineSchemaDir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    $freshHash = (Get-FileHash -LiteralPath (Join-Path $freshSchemaDir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($beforeHash -ne $freshHash) { $schemaDiffs += $name }
  }
  if ($schemaDiffs.Count -gt 0) { throw "Fresh schema fingerprint 漂移：$($schemaDiffs -join ', ')" }
  Write-Json -Path (Join-Path $outDir 'fresh-schema-fingerprint.json') -Value ([ordered]@{
    matched = $true
    files = $schemaFiles
    baselineDirectory = $baselineSchemaDir
    freshDirectory = $freshSchemaDir
  })

  Assert-NoOtherClientSessions 'Fresh backup 与 schema 审计后'
  Invoke-ReadOnlySql -SqlPath $preflightPath -Prefix 'production-preflight'
  $baselineCountsPath = Invoke-TableCounts -Prefix 'baseline'
  Assert-NoOtherClientSessions 'Apply 前最终检查'

  & docker cp $applyPath "${PostgresContainer}:$tempApplyPath"
  if ($LASTEXITCODE -ne 0) { throw '复制 production apply SQL 失败。' }
  $applyStdout = Join-Path $outDir 'apply-transaction-stdout.txt'
  $applyStderr = Join-Path $outDir 'apply-transaction-stderr.txt'
  & docker exec `
    -e 'PGOPTIONS=-c TimeZone=UTC -c client_min_messages=warning' `
    $PostgresContainer `
    psql -X -q -v ON_ERROR_STOP=1 -U $DatabaseUser -d $Database -f $tempApplyPath `
    1> $applyStdout 2> $applyStderr
  if ($LASTEXITCODE -ne 0) { throw 'Production apply transaction 失败；事务未获准提交。' }
  $applyCommitted = $true

  Invoke-ReadOnlySql -SqlPath $postAcceptancePath -Prefix 'post-merge-acceptance'
  $postCountsPath = Invoke-TableCounts -Prefix 'post-merge'

  $stageStatus = [ordered]@{
    freshBackupRestoreVerified = $true
    freshSchemaFingerprintMatched = $true
    productionPreflightPassed = $true
    applyCommitted = $true
    postMergeAcceptancePassed = $true
  }
  $stageStatusPath = Join-Path $outDir 'production-apply-stage-status.json'
  Write-Json -Path $stageStatusPath -Value $stageStatus

  $metadata = [ordered]@{
    executionId = $executionId
    branchHead = $currentHead
    startedAt = $startedAt
    productionContainer = $PostgresContainer
    productionImage = $productionImage
    targetWorkIds = @(32186,10097,32094,25561)
    authorizationPhrase = $AuthorizationPhrase
    transactionManifestSha256 = $transactionManifestHash
    gateManifestSha256 = $gateManifestHash
    applySqlSha256 = $applyHash
    acceptanceSqlSha256 = $acceptanceHash
    freshBackupBytes = [long]$freshBackupSummary.backupBytes
    freshBackupSha256 = [string]$freshBackupSummary.backupSha256
    freshBackupPath = (Join-Path $freshBackupDir 'database-backup.dump')
    writerContainersStopped = $writerContainers
    writerContainersRestarted = $false
  }
  $metadataPath = Join-Path $outDir 'production-apply-metadata.json'
  Write-Json -Path $metadataPath -Value $metadata

  & node (Join-Path $PSScriptRoot 'build-test-work-production-apply-receipt-v01.mjs') `
    --directory $outDir `
    --metadata $metadataPath `
    --stage-status $stageStatusPath `
    --baseline-counts $baselineCountsPath `
    --post-counts $postCountsPath
  if ($LASTEXITCODE -ne 0) { throw 'Production apply receipt 验证与生成失败。' }
  $allAccepted = $true

  Restart-WriterContainers -Names $writerContainers
  $writersRestarted = $true
  Write-Json -Path (Join-Path $outDir 'writer-restart-status.json') -Value ([ordered]@{
    restarted = $true
    containers = $writerContainers
    completedAt = [DateTime]::UtcNow.ToString('o')
  })

  $manifestFiles = @(Get-ChildItem -LiteralPath $outDir -File | Where-Object Name -ne 'manifest.json' | Sort-Object Name)
  $manifestRows = @($manifestFiles | ForEach-Object {
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{ file = $_.Name; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
  })
  Write-Json -Path (Join-Path $outDir 'manifest.json') -Value $manifestRows
  $paths = @((Get-ChildItem -LiteralPath $outDir -File | Sort-Object Name).FullName)
  Compress-Archive -LiteralPath $paths -DestinationPath $bundlePath -CompressionLevel Optimal -Force
} catch {
  $operationError = $_
} finally {
  & docker exec $PostgresContainer rm -f $tempApplyPath *> $null
  if (-not $applyCommitted -or $allAccepted) {
    if (-not $writersRestarted) {
      try { Restart-WriterContainers -Names $writerContainers; $writersRestarted = $true } catch { if ($null -eq $operationError) { $operationError = $_ } }
    }
  }
}

if ($null -ne $operationError) {
  Write-Json -Path (Join-Path $outDir 'production-apply-failure.json') -Value ([ordered]@{
    executionId = $executionId
    failedAt = [DateTime]::UtcNow.ToString('o')
    message = $operationError.Exception.Message
    applyCommitted = $applyCommitted
    postCommitFailure = ($applyCommitted -and -not $allAccepted)
    writerContainersRestarted = $writersRestarted
    writerContainersIntentionallyLeftPaused = ($applyCommitted -and -not $allAccepted)
    freshBackupDirectory = $freshBackupDir
    freshSchemaDirectory = $freshSchemaDir
    rollbackAutomaticallyExecuted = $false
    rollbackAuthorized = $false
  })
  throw $operationError
}

$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256
$receipt = Get-Content -LiteralPath (Join-Path $outDir 'production-apply-receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
Write-Host ''
Write-Host 'Test Work production apply 已完成并通过独立验收' -ForegroundColor Green
Write-Host "ExecutionId                  : $executionId"
Write-Host "OutputDirectory              : $outDir"
Write-Host "EvidenceBundle               : $bundlePath"
Write-Host "EvidenceBundleSHA256         : $($bundleHash.Hash)"
Write-Host "FreshBackupDirectory         : $freshBackupDir"
Write-Host "FreshBackupSHA256            : $($receipt.freshBackupSha256)"
Write-Host "FreshSchemaDirectory         : $freshSchemaDir"
Write-Host "ProductionMergeReceiptSHA256 : $($receipt.productionMergeReceiptSha256)"
Write-Host 'BusinessTableCountChecks     : 83'
Write-Host 'ApplyCommitted               : True'
Write-Host 'PostMergeAcceptance          : Passed'
Write-Host 'PostMergeTableDeltas         : Matched'
Write-Host 'WriterContainers             : Restarted'
Write-Host 'RollbackAutomaticallyRun     : False'
Write-Host 'ProductionRollbackAuthorized : False'
Write-Host 'MigrationGeneration          : False'
Write-Host 'SchemaPush                    : False'
Write-Host 'PayloadWrite                  : False'
