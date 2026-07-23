param(
  [Parameter(Mandatory = $true)][string]$StorageBundle,
  [Parameter(Mandatory = $true)][string]$LabBundle,
  [Parameter(Mandatory = $true)][string]$GateBundle,
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][ValidateSet('AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01')][string]$AuthorizationPhrase,
  [string]$ExpectedStorageSHA256 = '642E43B9CBAC02C75D2D473293C7B57B8B0197594262DFA96B065015E89C135E',
  [string]$ExpectedLabSHA256 = 'EB3B1BCBE7B553471157BDED6B027F6850E3927AA9C1226AFFDC63B85EE69825',
  [string]$ExpectedGateSHA256 = 'C0FBEC5B62C3FC45072B9F235C5DF5FEA7462F564226EA7FDD3CE9C723E0E2B5',
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$ExpectedGateHead = '83683b245321863f5c3eb56c079e25d11a81a880'
$ExpectedMigrationCommit = '3ea530cb342bfab5c126e94498d2d94c98413aa0'
$ExpectedReadySHA256 = 'BDA8429DFCF6DBCAAEB90199AC1697196B308013F65DF546F20B46167B49A220'
$ExpectedApplySHA256 = '61F5673A2727D2FDE63590A1A74C2A26C5CFB2EACFA7AE27078F9CD999048DDA'
$ExpectedAcceptanceSHA256 = 'B518CA4CA58F73C5CDDC9916C774B7BE5E8946F622E00388010F32066A1F4F6E'
$ExpectedPreflightSHA256 = 'BA1CA326484611DD090FBA3CDC7566F13D1218CA2F75AED7B3FF308796C92170'
$ExpectedRollbackSHA256 = '24738E9C9510E2D6014D7211E16F0CF7E9D2C852D8B55FF3B839457E268B00BE'
$ExpectedPostRollbackSHA256 = 'FBE7CA5D275BAAC43D0997757534AACA7C12C6F1F48693CA8B5241AEB61BF69F'
$ExpectedApplyPhraseSHA256 = 'CCCB781B5B8EC48A14E5E15C0C2C94506F6AE13E9E4FE16F3C1D49CE3135AC0A'
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Resolve-InputFile([string]$Value, [string]$Label) {
  $candidate = if ([System.IO.Path]::IsPathRooted($Value)) {
    [System.IO.Path]::GetFullPath($Value)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "找不到 $Label：$candidate" }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Assert-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "缺少 manifest.json：$Directory" }
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

function Get-DirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path.Replace('\', '/')
  }
  return @($paths)
}

function Read-CountMap([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -ne 2 -or $parts[1] -notmatch '^-?\d+$') { throw "无法解析表行数：$line" }
    if ($map.ContainsKey($parts[0])) { throw "表行数结果重复：$($parts[0])" }
    $map[$parts[0]] = [long]$parts[1]
  }
  return $map
}

function Compare-CountMaps([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  if (($expectedKeys -join "`n") -ne ($actualKeys -join "`n")) { throw "$Label 表集合不一致。" }
  foreach ($key in $expectedKeys) {
    if ([long]$Expected[$key] -ne [long]$Actual[$key]) {
      throw "$Label 表行数不一致：$key expected=$($Expected[$key]) actual=$($Actual[$key])"
    }
  }
}

function Assert-PostApplyCounts([hashtable]$Baseline, [hashtable]$Post, [string]$Label) {
  if ($Baseline.Count -ne 83) { throw "$Label baseline 表数不是 83：$($Baseline.Count)" }
  if ($Post.Count -ne 87) { throw "$Label post-apply 表数不是 87：$($Post.Count)" }
  foreach ($key in $Baseline.Keys) {
    if (-not $Post.ContainsKey($key)) { throw "$Label 原业务表消失：$key" }
    if ([long]$Post[$key] -ne [long]$Baseline[$key]) {
      throw "$Label 原业务表行数变化：$key before=$($Baseline[$key]) after=$($Post[$key])"
    }
  }
  $expectedRadar = [ordered]@{
    'public.radar_public' = 9000
    'public.radar_public_review_reasons' = 9000
    'public.radar_public_radar_assessment_matched_rules' = 9077
    'public.radar_public_radar_assessment_contradictions' = 0
  }
  foreach ($key in $expectedRadar.Keys) {
    if (-not $Post.ContainsKey($key) -or [long]$Post[$key] -ne [long]$expectedRadar[$key]) {
      throw "$Label Radar 表行数不匹配：$key expected=$($expectedRadar[$key]) actual=$($Post[$key])"
    }
  }
}

function Assert-Checks([string]$Path, [string]$Label, [int]$ExpectedCount) {
  $checks = @()
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -ne 4) { throw "$Label 无法解析检查行：$line" }
    $checks += [pscustomobject]@{
      name = $parts[0]
      actual = $parts[1]
      expected = $parts[2]
      matched = $parts[3].ToLowerInvariant() -eq 'true'
    }
  }
  $failed = @($checks | Where-Object { -not $_.matched -or $_.actual -ne $_.expected })
  if ($checks.Count -ne $ExpectedCount -or $failed.Count -gt 0) {
    $failed | Format-Table | Out-String | Write-Host
    throw "$Label 未全部通过：$($checks.Count) / $ExpectedCount"
  }
  return @($checks)
}

function Invoke-PsqlFile(
  [string]$Container,
  [string]$TargetDatabase,
  [string]$TargetUser,
  [string]$Password,
  [string]$HostSqlPath,
  [string]$ContainerSqlPath,
  [string]$Prefix,
  [string]$OutputDirectory,
  [switch]$ReadOnly
) {
  $stdoutPath = Join-Path $OutputDirectory "$Prefix-stdout.txt"
  $stderrPath = Join-Path $OutputDirectory "$Prefix-stderr.txt"
  & docker cp $HostSqlPath "${Container}:$ContainerSqlPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "复制 SQL 失败：$Prefix" }
  $pgOptions = if ($ReadOnly) {
    '-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning'
  } else {
    '-c TimeZone=UTC -c client_min_messages=warning'
  }
  $args = @('exec')
  if (-not [string]::IsNullOrWhiteSpace($Password)) { $args += @('-e', "PGPASSWORD=$Password") }
  $args += @('-e', "PGOPTIONS=$pgOptions", $Container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', $TargetUser, '-d', $TargetDatabase, '-f', $ContainerSqlPath)
  & docker @args 1> $stdoutPath 2> $stderrPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "==> $Prefix stderr" -ForegroundColor Yellow
    if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
      Get-Content -LiteralPath $stderrPath -Encoding UTF8 | Select-Object -Last 120 | ForEach-Object { Write-Host $_ }
    }
    throw "$Prefix 执行失败。"
  }
  $stderrLines = @(Get-Content -LiteralPath $stderrPath -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  if ($stderrLines.Count -gt 0) { throw "$Prefix stderr 非空：$($stderrLines.Count)" }
  return $stdoutPath
}

function Invoke-TableCounts(
  [string]$Container,
  [string]$TargetDatabase,
  [string]$TargetUser,
  [string]$Password,
  [string]$ContainerSqlPath,
  [string]$Prefix,
  [string]$OutputDirectory
) {
  $stdoutPath = Join-Path $OutputDirectory "$Prefix-table-counts.tsv"
  $stderrPath = Join-Path $OutputDirectory "$Prefix-table-counts-stderr.txt"
  $args = @('exec')
  if (-not [string]::IsNullOrWhiteSpace($Password)) { $args += @('-e', "PGPASSWORD=$Password") }
  $args += @('-e', 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning', $Container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', $TargetUser, '-d', $TargetDatabase, '-f', $ContainerSqlPath)
  & docker @args 1> $stdoutPath 2> $stderrPath
  if ($LASTEXITCODE -ne 0) { throw "表行数查询失败：$Prefix" }
  $stderrLines = @(Get-Content -LiteralPath $stderrPath -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  if ($stderrLines.Count -gt 0) { throw "表行数查询 stderr 非空：$Prefix" }
  return $stdoutPath
}

function Assert-NoOtherClientSessions([string]$Label) {
  for ($attempt = 1; $attempt -le 2; $attempt += 1) {
    $value = ([string](& docker exec -e 'PGOPTIONS=-c default_transaction_read_only=on' $PostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $DatabaseUser -d $Database -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';")).Trim()
    if ($LASTEXITCODE -ne 0 -or $value -ne '0') { throw "$Label 检测到其他数据库客户端连接：$value" }
    if ($attempt -eq 1) { Start-Sleep -Seconds 2 }
  }
}

function Restart-WriterContainers([string[]]$Names) {
  $failed = @()
  foreach ($name in $Names) {
    & docker start $name *> $null
    if ($LASTEXITCODE -ne 0) { $failed += $name }
  }
  if ($failed.Count -gt 0) { throw "恢复 writer 容器失败：$($failed -join ', ')" }
}

if ($AuthorizationPhrase -ne 'AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01') { throw 'Production apply 授权不匹配。' }
$phraseBytes = [System.Text.Encoding]::UTF8.GetBytes($AuthorizationPhrase)
$phraseHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($phraseBytes))
if ($phraseHash -ne $ExpectedApplyPhraseSHA256) { throw 'Production apply 授权哈希不匹配。' }

$currentBranch = ([string](git branch --show-current)).Trim()
$currentHead = ([string](git rev-parse HEAD)).Trim()
if ($currentBranch -ne $ExpectedBranch) { throw "当前分支不正确：$currentBranch" }
if ($currentHead -ne $ExpectedBranchHead) { throw "当前 HEAD 不符合执行 runner：$currentHead" }
git merge-base --is-ancestor $ExpectedGateHead HEAD
if ($LASTEXITCODE -ne 0) { throw '当前分支不包含已验收 gate HEAD。' }
git merge-base --is-ancestor $ExpectedMigrationCommit HEAD
if ($LASTEXITCODE -ne 0) { throw '当前分支不包含已验收 migration commit。' }
$unexpectedDirty = @(Get-DirtyPaths | Where-Object { $AllowedDirtyFiles -notcontains $_ })
if ($unexpectedDirty.Count -gt 0) { throw "存在预期之外的本地修改：$($unexpectedDirty -join ', ')" }

$storagePath = Resolve-InputFile $StorageBundle 'storage normalization ZIP'
$labPath = Resolve-InputFile $LabBundle 'storage lab ZIP'
$gatePath = Resolve-InputFile $GateBundle 'production gate ZIP'
$storageHash = (Get-FileHash -LiteralPath $storagePath -Algorithm SHA256).Hash
$labHash = (Get-FileHash -LiteralPath $labPath -Algorithm SHA256).Hash
$gateHash = (Get-FileHash -LiteralPath $gatePath -Algorithm SHA256).Hash
if ($storageHash -ne $ExpectedStorageSHA256) { throw "Storage ZIP SHA-256 不匹配：$storageHash" }
if ($labHash -ne $ExpectedLabSHA256) { throw "Lab ZIP SHA-256 不匹配：$labHash" }
if ($gateHash -ne $ExpectedGateSHA256) { throw "Gate ZIP SHA-256 不匹配：$gateHash" }

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-production-apply-' + [Guid]::NewGuid().ToString('N'))
$storageDir = Join-Path $tempRoot 'storage'
$labDir = Join-Path $tempRoot 'lab'
$gateDir = Join-Path $tempRoot 'gate'
New-Item -ItemType Directory -Path $storageDir, $labDir, $gateDir -Force | Out-Null
Expand-Archive -LiteralPath $storagePath -DestinationPath $storageDir -Force
Expand-Archive -LiteralPath $labPath -DestinationPath $labDir -Force
Expand-Archive -LiteralPath $gatePath -DestinationPath $gateDir -Force
Assert-Manifest $storageDir
Assert-Manifest $labDir
Assert-Manifest $gateDir

$gateSummaryPath = Join-Path $gateDir 'radar-public-conclusions-production-gate-summary.json'
$labSummaryPath = Join-Path $labDir 'radar-public-conclusions-storage-lab-summary.json'
$storageSummaryPath = Join-Path $storageDir 'radar-public-storage-normalization-summary.json'
$gateSummary = Get-Content -LiteralPath $gateSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$labSummary = Get-Content -LiteralPath $labSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$storageSummary = Get-Content -LiteralPath $storageSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($gateSummary.status -ne 'ready_for_explicit_production_apply_authorization' -or
    $gateSummary.productionApplyAuthorized -ne $false -or
    $gateSummary.applyAuthorizationPhrase -ne $AuthorizationPhrase -or
    $gateSummary.labRehearsalPassed -ne $true -or
    $gateSummary.baselineRestored -ne $true -or
    $gateSummary.productionRadarSchemaAbsent -ne $true -or
    $gateSummary.productionRowsWritten -ne 0 -or
    $gateSummary.head -ne $ExpectedGateHead -or
    $gateSummary.labEvidenceBundleSha256 -ne $ExpectedLabSHA256.ToLowerInvariant() -or
    $gateSummary.storageBundleSha256 -ne $ExpectedStorageSHA256.ToLowerInvariant()) {
  throw 'Production gate 摘要未满足固定 apply 前置条件。'
}
if ($labSummary.labRehearsalPassed -ne $true -or
    $labSummary.publicRowsApplied -ne 9000 -or
    $labSummary.postApplyChecksPassed -ne 22 -or
    $labSummary.postRollbackChecksPassed -ne 17 -or
    $labSummary.baselineRestored -ne $true -or
    $labSummary.productionDatabaseWrite -ne $false) {
  throw 'Storage lab 摘要未满足固定门槛。'
}
if ($storageSummary.normalization.rows -ne 9000 -or
    $storageSummary.invariants.uniquePublicationKeys -ne 9000 -or
    $storageSummary.invariants.uniqueWorkIds -ne 9000 -or
    $storageSummary.invariants.businessAuditSuperseded -ne $false -or
    $storageSummary.invariants.migrationDdlSuperseded -ne $false) {
  throw 'Storage normalization 摘要未满足固定门槛。'
}

$readyPath = Join-Path $storageDir 'public-ai-storage-ready.jsonl'
$preflightPath = Join-Path $gateDir 'production-preflight.sql'
$applyPath = Join-Path $gateDir 'production-apply.sql.disabled'
$acceptancePath = Join-Path $gateDir 'production-acceptance.sql'
$rollbackPath = Join-Path $gateDir 'production-rollback.sql.disabled'
$postRollbackPath = Join-Path $gateDir 'production-post-rollback-acceptance.sql'
$gateBaselinePath = Join-Path $gateDir 'production-baseline-table-counts.tsv'
if ((Get-FileHash -LiteralPath $readyPath -Algorithm SHA256).Hash -ne $ExpectedReadySHA256) { throw 'Storage-ready 文件 SHA-256 不匹配。' }
if ((Get-FileHash -LiteralPath $preflightPath -Algorithm SHA256).Hash -ne $ExpectedPreflightSHA256) { throw 'Preflight SQL SHA-256 不匹配。' }
if ((Get-FileHash -LiteralPath $applyPath -Algorithm SHA256).Hash -ne $ExpectedApplySHA256) { throw 'Apply SQL SHA-256 不匹配。' }
if ((Get-FileHash -LiteralPath $acceptancePath -Algorithm SHA256).Hash -ne $ExpectedAcceptanceSHA256) { throw 'Acceptance SQL SHA-256 不匹配。' }
if ((Get-FileHash -LiteralPath $rollbackPath -Algorithm SHA256).Hash -ne $ExpectedRollbackSHA256) { throw 'Rollback SQL SHA-256 不匹配。' }
if ((Get-FileHash -LiteralPath $postRollbackPath -Algorithm SHA256).Hash -ne $ExpectedPostRollbackSHA256) { throw 'Post-rollback SQL SHA-256 不匹配。' }
$gateBaseline = Read-CountMap $gateBaselinePath
if ($gateBaseline.Count -ne 83) { throw "Gate baseline 表数不是 83：$($gateBaseline.Count)" }

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$postgresRunning = ([string](& docker inspect -f '{{.State.Running}}' $PostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $postgresRunning -ne 'true') { throw "PostgreSQL 容器未运行：$PostgresContainer" }
$productionImage = ([string](& docker inspect -f '{{.Config.Image}}' $PostgresContainer)).Trim()
if ($productionImage -ne [string]$labSummary.postgresImage -or $productionImage -ne 'postgres:17-alpine') {
  throw "生产 PostgreSQL 镜像与演练不一致：$productionImage"
}
$composeProject = ([string](& docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' $PostgresContainer)).Trim()
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

$executionId = "radar-public-production-apply-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$outDir = Join-Path $repoRoot "exports\$executionId"
$bundlePath = Join-Path $repoRoot "exports\RADAR-PUBLIC-CONCLUSIONS-PRODUCTION-APPLY-RECEIPT-$($executionId.Replace('radar-public-production-apply-','')).zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$startedAt = [DateTime]::UtcNow.ToString('o')
Copy-Item -LiteralPath $gateSummaryPath -Destination (Join-Path $outDir 'bound-production-gate-summary.json')
Copy-Item -LiteralPath $labSummaryPath -Destination (Join-Path $outDir 'bound-storage-lab-summary.json')
Copy-Item -LiteralPath $storageSummaryPath -Destination (Join-Path $outDir 'bound-storage-normalization-summary.json')

$tableCountSqlPath = Join-Path $outDir 'business-table-counts-readonly.sql'
$tableCountSql = @'
\pset tuples_only on
\pset format unaligned
SELECT format(
  'SELECT %L || E''\t'' || count(*)::text FROM %I.%I;',
  schemaname || '.' || tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
'@
[System.IO.File]::WriteAllText($tableCountSqlPath, $tableCountSql.TrimStart(), [System.Text.UTF8Encoding]::new($false))

$writerContainers = @(& docker ps --filter "label=com.docker.compose.project=$composeProject" --format '{{.Names}}' | Where-Object { $_ -and $_ -ne $PostgresContainer })
Write-Json -Path (Join-Path $outDir 'maintenance-window.json') -Value ([ordered]@{
  executionId = $executionId
  startedAt = $startedAt
  composeProject = $composeProject
  productionContainer = $PostgresContainer
  writerContainersToStop = $writerContainers
  localWriterProcessesDetected = 0
})

$stageStatus = [ordered]@{
  schemaVersion = 1
  productionDatabaseWriteAuthorized = $true
  freshBackupCreated = $false
  freshBackupArchiveListed = $false
  freshBackupRestoreVerified = $false
  freshWindowLabPreflightPassed = $false
  freshWindowLabApplyPassed = $false
  freshWindowLabAcceptancePassed = $false
  freshWindowLabRollbackPassed = $false
  freshWindowLabBaselineRestored = $false
  productionPreflightPassed = $false
  productionApplyCommitted = $false
  productionAcceptancePassed = $false
  productionTableDeltasMatched = $false
  writerContainersRestarted = $false
  rollbackAutomaticallyExecuted = $false
  productionRollbackAuthorized = $false
}
$stageStatusPath = Join-Path $outDir 'production-apply-stage-status.json'
Write-Json $stageStatusPath $stageStatus

$applyCommitted = $false
$allAccepted = $false
$writersRestarted = $false
$operationError = $null
$labContainer = "baihepailei-radar-production-window-lab-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$labContainerCreated = $false
$sourceDumpPath = "/tmp/$executionId.dump"
$backupPath = Join-Path $outDir 'database-backup.dump'
$productionReadyPath = "/tmp/$executionId-public-ai-storage-ready.jsonl"
$productionApplyPath = "/tmp/$executionId-apply.sql"
$productionAcceptancePath = "/tmp/$executionId-acceptance.sql"
$productionPreflightPath = "/tmp/$executionId-preflight.sql"
$productionCountPath = "/tmp/$executionId-counts.sql"

try {
  foreach ($name in $writerContainers) {
    & docker stop -t 30 $name *> $null
    if ($LASTEXITCODE -ne 0) { throw "停止 writer 容器失败：$name" }
  }
  Start-Sleep -Seconds 3
  Assert-NoOtherClientSessions '维护窗口开始'

  & docker cp $tableCountSqlPath "${PostgresContainer}:$productionCountPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制生产表计数 SQL 失败。' }
  $preBackupPreflightOutput = Invoke-PsqlFile $PostgresContainer $Database $DatabaseUser '' $preflightPath $productionPreflightPath 'production-pre-backup-preflight' $outDir -ReadOnly
  Assert-Checks $preBackupPreflightOutput 'production pre-backup preflight' 2 | Out-Null
  $preBackupCountsPath = Invoke-TableCounts $PostgresContainer $Database $DatabaseUser '' $productionCountPath 'production-pre-backup' $outDir
  Compare-CountMaps $gateBaseline (Read-CountMap $preBackupCountsPath) 'gate → production pre-backup'

  & docker exec $PostgresContainer pg_dump -U $DatabaseUser -d $Database --format=custom --compress=6 --serializable-deferrable --no-owner --no-privileges --file=$sourceDumpPath
  if ($LASTEXITCODE -ne 0) { throw '同窗口 production pg_dump 失败。' }
  & docker cp "${PostgresContainer}:$sourceDumpPath" $backupPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制同窗口 fresh backup 到宿主机失败。' }
  $backupHash = Get-FileHash -LiteralPath $backupPath -Algorithm SHA256
  $backupBytes = (Get-Item -LiteralPath $backupPath).Length
  if ($backupBytes -le 0) { throw '同窗口 fresh backup 为空。' }
  $stageStatus.freshBackupCreated = $true
  Write-Json $stageStatusPath $stageStatus

  $postBackupPreflightOutput = Invoke-PsqlFile $PostgresContainer $Database $DatabaseUser '' $preflightPath $productionPreflightPath 'production-post-backup-preflight' $outDir -ReadOnly
  Assert-Checks $postBackupPreflightOutput 'production post-backup preflight' 2 | Out-Null
  $postBackupCountsPath = Invoke-TableCounts $PostgresContainer $Database $DatabaseUser '' $productionCountPath 'production-post-backup' $outDir
  Compare-CountMaps (Read-CountMap $preBackupCountsPath) (Read-CountMap $postBackupCountsPath) 'production backup 前后'
  Assert-NoOtherClientSessions 'Fresh backup 后'

  $labUser = 'radar_apply_lab'
  $labDatabase = 'radar_apply_lab'
  $labPassword = [Guid]::NewGuid().ToString('N')
  & docker run -d --name $labContainer --network none -e "POSTGRES_USER=$labUser" -e "POSTGRES_PASSWORD=$labPassword" -e 'POSTGRES_DB=postgres' $productionImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '启动同窗口隔离 PostgreSQL 失败。' }
  $labContainerCreated = $true
  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  $ready = $false
  do {
    Start-Sleep -Seconds 2
    & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_isready -U $labUser -d postgres | Out-Null
    $ready = $LASTEXITCODE -eq 0
  } while (-not $ready -and (Get-Date) -lt $deadline)
  if (-not $ready) { throw '同窗口隔离 PostgreSQL 未在时限内就绪。' }

  & docker exec -e "PGPASSWORD=$labPassword" $labContainer createdb -U $labUser -T template0 $labDatabase
  if ($LASTEXITCODE -ne 0) { throw '创建同窗口隔离数据库失败。' }
  & docker cp $backupPath "${labContainer}:/tmp/database-backup.dump" | Out-Null
  & docker cp $readyPath "${labContainer}:/tmp/public-ai-storage-ready.jsonl" | Out-Null
  & docker cp $tableCountSqlPath "${labContainer}:/tmp/business-table-counts.sql" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制同窗口隔离输入失败。' }
  & docker exec $labContainer pg_restore --list /tmp/database-backup.dump 1> (Join-Path $outDir 'fresh-backup-archive-list.txt') 2> (Join-Path $outDir 'fresh-backup-archive-list-stderr.txt')
  if ($LASTEXITCODE -ne 0) { throw '同窗口 fresh backup archive list 失败。' }
  $stageStatus.freshBackupArchiveListed = $true
  Write-Json $stageStatusPath $stageStatus
  & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_restore -U $labUser -d $labDatabase --no-owner --no-privileges --exit-on-error /tmp/database-backup.dump
  if ($LASTEXITCODE -ne 0) { throw '同窗口 fresh backup 完整恢复失败。' }
  $stageStatus.freshBackupRestoreVerified = $true
  Write-Json $stageStatusPath $stageStatus

  $labPreflightOutput = Invoke-PsqlFile $labContainer $labDatabase $labUser $labPassword $preflightPath '/tmp/production-preflight.sql' 'fresh-lab-preflight' $outDir -ReadOnly
  Assert-Checks $labPreflightOutput 'fresh-window lab preflight' 2 | Out-Null
  $stageStatus.freshWindowLabPreflightPassed = $true
  $labBaselineCountsPath = Invoke-TableCounts $labContainer $labDatabase $labUser $labPassword '/tmp/business-table-counts.sql' 'fresh-lab-baseline' $outDir
  Compare-CountMaps $gateBaseline (Read-CountMap $labBaselineCountsPath) 'gate → fresh-window lab'

  $null = Invoke-PsqlFile $labContainer $labDatabase $labUser $labPassword $applyPath '/tmp/production-apply.sql' 'fresh-lab-apply' $outDir
  $stageStatus.freshWindowLabApplyPassed = $true
  Write-Json $stageStatusPath $stageStatus
  $labAcceptanceOutput = Invoke-PsqlFile $labContainer $labDatabase $labUser $labPassword $acceptancePath '/tmp/production-acceptance.sql' 'fresh-lab-acceptance' $outDir -ReadOnly
  Assert-Checks $labAcceptanceOutput 'fresh-window lab acceptance' 22 | Out-Null
  $labPostCountsPath = Invoke-TableCounts $labContainer $labDatabase $labUser $labPassword '/tmp/business-table-counts.sql' 'fresh-lab-post-apply' $outDir
  Assert-PostApplyCounts (Read-CountMap $labBaselineCountsPath) (Read-CountMap $labPostCountsPath) 'fresh-window lab post-apply'
  $stageStatus.freshWindowLabAcceptancePassed = $true
  Write-Json $stageStatusPath $stageStatus

  $null = Invoke-PsqlFile $labContainer $labDatabase $labUser $labPassword $rollbackPath '/tmp/production-rollback.sql' 'fresh-lab-rollback' $outDir
  $stageStatus.freshWindowLabRollbackPassed = $true
  Write-Json $stageStatusPath $stageStatus
  $labPostRollbackOutput = Invoke-PsqlFile $labContainer $labDatabase $labUser $labPassword $postRollbackPath '/tmp/production-post-rollback.sql' 'fresh-lab-post-rollback-acceptance' $outDir -ReadOnly
  Assert-Checks $labPostRollbackOutput 'fresh-window lab post-rollback acceptance' 17 | Out-Null
  $labFinalCountsPath = Invoke-TableCounts $labContainer $labDatabase $labUser $labPassword '/tmp/business-table-counts.sql' 'fresh-lab-post-rollback' $outDir
  Compare-CountMaps (Read-CountMap $labBaselineCountsPath) (Read-CountMap $labFinalCountsPath) 'fresh-window lab rollback baseline'
  $stageStatus.freshWindowLabBaselineRestored = $true
  Write-Json $stageStatusPath $stageStatus
  & docker rm -f $labContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '删除同窗口隔离 PostgreSQL 失败。' }
  $labContainerCreated = $false

  Assert-NoOtherClientSessions 'Production apply 前最终检查'
  $finalPreflightOutput = Invoke-PsqlFile $PostgresContainer $Database $DatabaseUser '' $preflightPath $productionPreflightPath 'production-final-preflight' $outDir -ReadOnly
  Assert-Checks $finalPreflightOutput 'production final preflight' 2 | Out-Null
  $productionBaselineCountsPath = Invoke-TableCounts $PostgresContainer $Database $DatabaseUser '' $productionCountPath 'production-final-baseline' $outDir
  Compare-CountMaps $gateBaseline (Read-CountMap $productionBaselineCountsPath) 'gate → production final baseline'
  $stageStatus.productionPreflightPassed = $true
  Write-Json $stageStatusPath $stageStatus

  & docker cp $readyPath "${PostgresContainer}:$productionReadyPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 storage-ready JSONL 到生产容器失败。' }
  & docker cp $applyPath "${PostgresContainer}:$productionApplyPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 production apply SQL 失败。' }
  $productionApplyStdout = Join-Path $outDir 'production-apply-stdout.txt'
  $productionApplyStderr = Join-Path $outDir 'production-apply-stderr.txt'
  & docker exec -e 'PGOPTIONS=-c TimeZone=UTC -c client_min_messages=warning' $PostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $DatabaseUser -d $Database -f $productionApplyPath 1> $productionApplyStdout 2> $productionApplyStderr
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $productionApplyStderr -PathType Leaf) {
      Get-Content -LiteralPath $productionApplyStderr -Encoding UTF8 | Select-Object -Last 120 | ForEach-Object { Write-Host $_ }
    }
    throw 'Production apply transaction 失败；没有获准自动 rollback。'
  }
  $applyCommitted = $true
  $stageStatus.productionApplyCommitted = $true
  Write-Json $stageStatusPath $stageStatus

  $productionAcceptanceOutput = Invoke-PsqlFile $PostgresContainer $Database $DatabaseUser '' $acceptancePath $productionAcceptancePath 'production-acceptance' $outDir -ReadOnly
  $productionChecks = Assert-Checks $productionAcceptanceOutput 'production acceptance' 22
  $stageStatus.productionAcceptancePassed = $true
  Write-Json $stageStatusPath $stageStatus
  $productionPostCountsPath = Invoke-TableCounts $PostgresContainer $Database $DatabaseUser '' $productionCountPath 'production-post-apply' $outDir
  Assert-PostApplyCounts (Read-CountMap $productionBaselineCountsPath) (Read-CountMap $productionPostCountsPath) 'production post-apply'
  $stageStatus.productionTableDeltasMatched = $true
  $allAccepted = $true
  Write-Json $stageStatusPath $stageStatus

  Restart-WriterContainers $writerContainers
  $writersRestarted = $true
  $stageStatus.writerContainersRestarted = $true
  Write-Json $stageStatusPath $stageStatus
  Write-Json -Path (Join-Path $outDir 'writer-restart-status.json') -Value ([ordered]@{
    restarted = $true
    containers = $writerContainers
    completedAt = [DateTime]::UtcNow.ToString('o')
  })

  $gateManifestHash = (Get-FileHash -LiteralPath (Join-Path $gateDir 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  $metadata = [ordered]@{
    executionId = $executionId
    branchHead = $currentHead
    gateHead = $ExpectedGateHead
    migrationCommit = $ExpectedMigrationCommit
    startedAt = $startedAt
    productionContainer = $PostgresContainer
    productionImage = $productionImage
    authorizationPhraseSha256 = $phraseHash.ToLowerInvariant()
    storageBundleSha256 = $storageHash.ToLowerInvariant()
    labBundleSha256 = $labHash.ToLowerInvariant()
    gateBundleSha256 = $gateHash.ToLowerInvariant()
    gateManifestSha256 = $gateManifestHash
    applySqlSha256 = $ExpectedApplySHA256.ToLowerInvariant()
    acceptanceSqlSha256 = $ExpectedAcceptanceSHA256.ToLowerInvariant()
    preflightSqlSha256 = $ExpectedPreflightSHA256.ToLowerInvariant()
    rollbackSqlSha256 = $ExpectedRollbackSHA256.ToLowerInvariant()
    normalizedReadySha256 = $ExpectedReadySHA256.ToLowerInvariant()
    freshBackupBytes = $backupBytes
    freshBackupSha256 = $backupHash.Hash.ToLowerInvariant()
    freshBackupPath = $backupPath
    writerContainersStopped = $writerContainers
    writerContainersRestarted = $true
  }
  $metadataPath = Join-Path $outDir 'production-apply-metadata.json'
  Write-Json $metadataPath $metadata
  & node (Join-Path $PSScriptRoot 'build-radar-public-conclusions-production-apply-receipt-v01.mjs') --directory $outDir --metadata $metadataPath --stage-status $stageStatusPath --baseline-counts $productionBaselineCountsPath --post-counts $productionPostCountsPath --acceptance-output $productionAcceptanceOutput
  if ($LASTEXITCODE -ne 0) { throw 'Production apply 最终 receipt 验证或生成失败。' }

  $packRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-production-receipt-pack-' + [Guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path $packRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $outDir -File | Where-Object { $_.Name -ne 'database-backup.dump' } | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $packRoot -Force
    }
    Compress-Archive -Path (Join-Path $packRoot '*') -DestinationPath $bundlePath -CompressionLevel Optimal -Force
  } finally {
    Remove-Item -LiteralPath $packRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) { throw 'Production apply receipt ZIP 未生成。' }
} catch {
  $operationError = $_
} finally {
  if ($labContainerCreated) { & docker rm -f $labContainer *> $null }
  & docker exec $PostgresContainer rm -f $sourceDumpPath $productionReadyPath $productionApplyPath $productionAcceptancePath $productionPreflightPath $productionCountPath *> $null
  if (-not $applyCommitted -or $allAccepted) {
    if (-not $writersRestarted) {
      try {
        Restart-WriterContainers $writerContainers
        $writersRestarted = $true
        $stageStatus.writerContainersRestarted = $true
        Write-Json $stageStatusPath $stageStatus
      } catch {
        if ($null -eq $operationError) { $operationError = $_ }
      }
    }
  }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($null -ne $operationError) {
  Write-Json -Path (Join-Path $outDir 'production-apply-failure.json') -Value ([ordered]@{
    schemaVersion = 1
    executionId = $executionId
    failedAt = [DateTime]::UtcNow.ToString('o')
    message = $operationError.Exception.Message
    productionApplyCommitted = $applyCommitted
    productionAcceptancePassed = $allAccepted
    postCommitFailure = ($applyCommitted -and -not $allAccepted)
    writerContainersRestarted = $writersRestarted
    writerContainersIntentionallyLeftPaused = ($applyCommitted -and -not $allAccepted)
    freshBackupPath = $backupPath
    rollbackAutomaticallyExecuted = $false
    productionRollbackAuthorized = $false
  })
  throw $operationError
}

$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256
$receipt = Get-Content -LiteralPath (Join-Path $outDir 'production-apply-receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
Write-Host ''
Write-Host 'Radar 公共结论 production apply 已提交并通过独立验收' -ForegroundColor Green
Write-Host "ExecutionId                    : $executionId"
Write-Host "OutputDirectory                : $outDir"
Write-Host "EvidenceBundle                 : $bundlePath"
Write-Host "EvidenceBundleSHA256           : $($bundleHash.Hash)"
Write-Host "LocalFreshBackup               : $backupPath"
Write-Host "LocalFreshBackupSHA256         : $($receipt.freshBackupSha256)"
Write-Host "ProductionApplyReceiptSHA256   : $($receipt.productionApplyReceiptSha256)"
Write-Host 'ProductionSchemaApplied        : True'
Write-Host 'ProductionPublicRowsWritten    : 9000'
Write-Host 'ProductionAcceptanceChecks     : 22 / 22'
Write-Host 'ExistingProductionTables       : 83 unchanged'
Write-Host 'RadarTableCounts               : 9000 / 9000 / 9077 / 0'
Write-Host 'WriterContainers               : Restarted'
Write-Host 'PayloadMigrationCommand        : False'
Write-Host 'PayloadWrite                    : False'
Write-Host 'PRMergeAuthorized               : False'
Write-Host 'RollbackAutomaticallyRun       : False'
Write-Host 'ProductionRollbackAuthorized   : False'
