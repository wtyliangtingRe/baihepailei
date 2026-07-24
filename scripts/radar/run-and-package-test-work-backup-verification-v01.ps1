param(
  [Parameter(Mandatory = $true)][string]$DryRunV03Directory,
  [Parameter(Mandatory = $true)][string]$ExactBeforeDirectory,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-RepoPath([string]$Value, [string]$Label) {
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

function Test-ArtifactManifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
    ConvertFrom-Json -Depth 50
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

function Assert-ExactSummary([object]$Summary, [string]$Label) {
  if ($Summary.allChecksMatched -ne $true -or
      $Summary.expectedChecks -ne 37 -or
      $Summary.observedChecks -ne 37 -or
      $Summary.matchedChecks -ne 37 -or
      $Summary.failedChecks -ne 0 -or
      $Summary.exactRowChecks -ne 7 -or
      $Summary.relationCountChecks -ne 19 -or
      $Summary.versionRelationCountChecks -ne 11 -or
      $Summary.stderrLineCount -ne 0) {
    throw "$Label 未证明 37 / 37 exact-before 全部匹配。"
  }
}

function Invoke-ExactBeforeRun(
  [string]$Container,
  [string]$User,
  [string]$Db,
  [string]$ContainerSqlPath,
  [string]$Prefix,
  [string]$Password = ''
) {
  $rawStdout = Join-Path $outDir "$Prefix-psql-stdout-raw.tsv"
  $rawStderr = Join-Path $outDir "$Prefix-psql-stderr-raw.txt"
  $parseDir = Join-Path $outDir "$Prefix-parse-temp"
  New-Item -ItemType Directory -Path $parseDir -Force | Out-Null

  $dockerArgs = @('exec')
  if (-not [string]::IsNullOrWhiteSpace($Password)) {
    $dockerArgs += @('-e', "PGPASSWORD=$Password")
  }
  $dockerArgs += @(
    $Container,
    'psql',
    '-X',
    '-qAt',
    '-v', 'ON_ERROR_STOP=1',
    '-F', "`t",
    '-U', $User,
    '-d', $Db,
    '-f', $ContainerSqlPath
  )

  & docker @dockerArgs 1> $rawStdout 2> $rawStderr
  if ($LASTEXITCODE -ne 0) {
    throw "$Prefix exact-before PostgreSQL 只读查询失败。"
  }

  & node $exactParser `
    --sql $sqlPath `
    --expectations $expectationsPath `
    --stdout $rawStdout `
    --stderr $rawStderr `
    --output-dir $parseDir
  if ($LASTEXITCODE -ne 0) {
    throw "$Prefix exact-before 结果未全部匹配。"
  }

  $renameMap = [ordered]@{
    'exact-before-results.jsonl' = "$Prefix-exact-before-results.jsonl"
    'exact-before-run-summary.json' = "$Prefix-exact-before-run-summary.json"
    'exact-before-run-summary.md' = "$Prefix-exact-before-run-summary.md"
    'exact-before-stdout.tsv' = "$Prefix-exact-before-stdout.tsv"
    'exact-before-stderr.txt' = "$Prefix-exact-before-stderr.txt"
  }
  foreach ($sourceName in $renameMap.Keys) {
    Copy-Item `
      -LiteralPath (Join-Path $parseDir $sourceName) `
      -Destination (Join-Path $outDir $renameMap[$sourceName]) `
      -Force
  }
  Remove-Item -LiteralPath $parseDir -Recurse -Force
}

function Invoke-TableCountRun(
  [string]$Container,
  [string]$User,
  [string]$Db,
  [string]$ContainerSqlPath,
  [string]$Prefix,
  [string]$Password = ''
) {
  $stdout = Join-Path $outDir "$Prefix-table-counts.tsv"
  $stderr = Join-Path $outDir "$Prefix-table-counts-stderr.txt"

  $dockerArgs = @('exec')
  if (-not [string]::IsNullOrWhiteSpace($Password)) {
    $dockerArgs += @('-e', "PGPASSWORD=$Password")
  }
  $dockerArgs += @(
    $Container,
    'psql',
    '-X',
    '-qAt',
    '-v', 'ON_ERROR_STOP=1',
    '-F', "`t",
    '-U', $User,
    '-d', $Db,
    '-f', $ContainerSqlPath
  )

  & docker @dockerArgs 1> $stdout 2> $stderr
  if ($LASTEXITCODE -ne 0) {
    throw "$Prefix 全业务表行数只读查询失败。"
  }
}

$dryRunDir = Resolve-RepoPath $DryRunV03Directory 'merge dry-run v03 目录'
$exactDir = Resolve-RepoPath $ExactBeforeDirectory 'exact-before 证据目录'
Test-ArtifactManifest $dryRunDir
Test-ArtifactManifest $exactDir

$v03Summary = Get-Content `
  -LiteralPath (Join-Path $dryRunDir 'merge-dryrun-summary.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
if ($v03Summary.schemaVersion -ne 3 -or
    $v03Summary.exactBeforeAllChecksRequireTrue -ne $true -or
    $v03Summary.safety.databaseWrite -ne $false -or
    $v03Summary.safety.mergePerformed -ne $false) {
  throw 'v03 dry-run 未证明只读执行前安全边界。'
}

$sourceExactSummaryPath = Join-Path $exactDir 'exact-before-run-summary.json'
$sourceExactSummary = Get-Content `
  -LiteralPath $sourceExactSummaryPath `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
Assert-ExactSummary $sourceExactSummary '上传前 exact-before 证据'

$sqlPath = Join-Path $dryRunDir 'exact-before-readonly.sql'
$expectationsPath = Join-Path $dryRunDir 'exact-before-expectations.json'
$sqlHash = (Get-FileHash -LiteralPath $sqlPath -Algorithm SHA256).Hash.ToLowerInvariant()
$expectationsHash = (Get-FileHash -LiteralPath $expectationsPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sqlHash -ne ([string]$sourceExactSummary.sourceSqlSha256).ToLowerInvariant() -or
    $expectationsHash -ne ([string]$sourceExactSummary.sourceExpectationsSha256).ToLowerInvariant()) {
  throw 'exact-before 证据与 v03 SQL / expectations 哈希不一致。'
}

$sqlText = Get-Content -LiteralPath $sqlPath -Raw -Encoding UTF8
if ($sqlText -notmatch '^\s*BEGIN TRANSACTION READ ONLY;' -or
    $sqlText -notmatch 'ROLLBACK;\s*$' -or
    $sqlText -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b') {
  throw 'v03 exact-before SQL 不是受保护的纯只读 SQL。'
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker 不可用。'
}
$sourceRunning = (& docker inspect -f '{{.State.Running}}' $PostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') {
  throw "PostgreSQL 容器未运行：$PostgresContainer"
}
$postgresImage = (& docker inspect -f '{{.Config.Image}}' $PostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresImage)) {
  throw "无法读取 PostgreSQL 镜像：$PostgresContainer"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-backup-verification-$stamp"
$evidenceBundle = Join-Path $repoRoot "exports\TEST-WORK-BACKUP-VERIFICATION-EVIDENCE-$stamp.zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$backupName = "baihepailei-pre-test-work-merge-$stamp.dump"
$backupPath = Join-Path $outDir 'database-backup.dump'
$containerDumpPath = "/tmp/$backupName"
$containerExactSql = "/tmp/test-work-exact-before-$stamp.sql"
$containerCountSql = "/tmp/test-work-table-counts-$stamp.sql"
$verifyContainer = "baihepailei-restore-check-$stamp"
$verifyUser = 'restore_verify'
$verifyDb = 'restore_verify'
$verifyPassword = [Guid]::NewGuid().ToString('N')
$verifyDumpPath = "/tmp/$backupName"
$verifyExactSql = "/tmp/test-work-exact-before.sql"
$verifyCountSql = "/tmp/test-work-table-counts.sql"
$exactParser = Join-Path $PSScriptRoot 'parse-test-work-exact-before-results-v01.mjs'
$summaryBuilder = Join-Path $PSScriptRoot 'build-test-work-backup-verification-summary-v01.mjs'

Copy-Item -LiteralPath $sqlPath -Destination (Join-Path $outDir 'source-exact-before-readonly.sql') -Force
Copy-Item -LiteralPath $expectationsPath -Destination (Join-Path $outDir 'source-exact-before-expectations.json') -Force
Copy-Item -LiteralPath $sourceExactSummaryPath -Destination (Join-Path $outDir 'source-exact-before-run-summary.json') -Force
[System.IO.File]::WriteAllText(
  (Join-Path $outDir 'postgres-image.txt'),
  "$postgresImage`n",
  [System.Text.UTF8Encoding]::new($false)
)

$tableCountSqlPath = Join-Path $outDir 'database-table-counts-readonly.sql'
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

$sourceTempFilesRemoved = $false
$verificationContainerRemoved = $false
$operationError = $null

try {
  & docker cp $sqlPath "${PostgresContainer}:$containerExactSql"
  if ($LASTEXITCODE -ne 0) {
    throw '复制 exact-before SQL 到 PostgreSQL 容器失败。'
  }
  & docker cp $tableCountSqlPath "${PostgresContainer}:$containerCountSql"
  if ($LASTEXITCODE -ne 0) {
    throw '复制表计数 SQL 到 PostgreSQL 容器失败。'
  }

  Invoke-ExactBeforeRun `
    -Container $PostgresContainer `
    -User $DatabaseUser `
    -Db $Database `
    -ContainerSqlPath $containerExactSql `
    -Prefix 'production-pre'
  Invoke-TableCountRun `
    -Container $PostgresContainer `
    -User $DatabaseUser `
    -Db $Database `
    -ContainerSqlPath $containerCountSql `
    -Prefix 'production-pre'

  & docker exec $PostgresContainer rm -f $containerDumpPath
  if ($LASTEXITCODE -ne 0) {
    throw '清理 PostgreSQL 容器旧临时 dump 失败。'
  }

  $pgDumpStdout = Join-Path $outDir 'pg-dump-stdout.txt'
  $pgDumpStderr = Join-Path $outDir 'pg-dump-stderr.txt'
  & docker exec $PostgresContainer `
    pg_dump `
    -U $DatabaseUser `
    -d $Database `
    -Fc `
    -Z 9 `
    --no-owner `
    --no-privileges `
    --serializable-deferrable `
    --file $containerDumpPath `
    1> $pgDumpStdout `
    2> $pgDumpStderr
  if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL 自定义格式备份失败。'
  }

  & docker exec $PostgresContainer test -s $containerDumpPath
  if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL 容器中的 dump 为空或不存在。'
  }

  $restoreListPath = Join-Path $outDir 'pg-restore-list.txt'
  $restoreListStderr = Join-Path $outDir 'pg-restore-list-stderr.txt'
  & docker exec $PostgresContainer `
    pg_restore --list $containerDumpPath `
    1> $restoreListPath `
    2> $restoreListStderr
  if ($LASTEXITCODE -ne 0) {
    throw 'pg_restore --list 无法读取备份。'
  }

  & docker cp "${PostgresContainer}:$containerDumpPath" $backupPath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    throw '从 PostgreSQL 容器复制备份到主机失败。'
  }

  Invoke-ExactBeforeRun `
    -Container $PostgresContainer `
    -User $DatabaseUser `
    -Db $Database `
    -ContainerSqlPath $containerExactSql `
    -Prefix 'production-post'
  Invoke-TableCountRun `
    -Container $PostgresContainer `
    -User $DatabaseUser `
    -Db $Database `
    -ContainerSqlPath $containerCountSql `
    -Prefix 'production-post'

  $containerId = (& docker run `
    -d `
    --name $verifyContainer `
    -e "POSTGRES_USER=$verifyUser" `
    -e "POSTGRES_PASSWORD=$verifyPassword" `
    -e "POSTGRES_DB=$verifyDb" `
    $postgresImage).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
    throw '启动隔离 PostgreSQL 恢复验证容器失败。'
  }

  $ready = $false
  $attempts = [Math]::Max(1, [Math]::Ceiling($ReadyTimeoutSeconds / 2))
  for ($index = 0; $index -lt $attempts; $index += 1) {
    & docker exec `
      -e "PGPASSWORD=$verifyPassword" `
      $verifyContainer `
      pg_isready `
      -U $verifyUser `
      -d $verifyDb `
      *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    throw '隔离 PostgreSQL 恢复验证容器未在限时内就绪。'
  }

  & docker cp $backupPath "${verifyContainer}:$verifyDumpPath"
  if ($LASTEXITCODE -ne 0) {
    throw '复制备份到隔离恢复容器失败。'
  }
  & docker cp $sqlPath "${verifyContainer}:$verifyExactSql"
  if ($LASTEXITCODE -ne 0) {
    throw '复制 exact-before SQL 到隔离恢复容器失败。'
  }
  & docker cp $tableCountSqlPath "${verifyContainer}:$verifyCountSql"
  if ($LASTEXITCODE -ne 0) {
    throw '复制表计数 SQL 到隔离恢复容器失败。'
  }

  $restoreStdout = Join-Path $outDir 'pg-restore-stdout.txt'
  $restoreStderr = Join-Path $outDir 'pg-restore-stderr.txt'
  & docker exec `
    -e "PGPASSWORD=$verifyPassword" `
    $verifyContainer `
    pg_restore `
    --exit-on-error `
    --no-owner `
    --no-privileges `
    -U $verifyUser `
    -d $verifyDb `
    $verifyDumpPath `
    1> $restoreStdout `
    2> $restoreStderr
  if ($LASTEXITCODE -ne 0) {
    throw '隔离 PostgreSQL 数据库恢复失败。'
  }

  Invoke-ExactBeforeRun `
    -Container $verifyContainer `
    -User $verifyUser `
    -Db $verifyDb `
    -ContainerSqlPath $verifyExactSql `
    -Prefix 'restore' `
    -Password $verifyPassword
  Invoke-TableCountRun `
    -Container $verifyContainer `
    -User $verifyUser `
    -Db $verifyDb `
    -ContainerSqlPath $verifyCountSql `
    -Prefix 'restore' `
    -Password $verifyPassword

  & docker logs $verifyContainer `
    1> (Join-Path $outDir 'verification-container-stdout.log') `
    2> (Join-Path $outDir 'verification-container-stderr.log')
} catch {
  $operationError = $_
  try {
    & docker logs $verifyContainer `
      1> (Join-Path $outDir 'verification-container-stdout.log') `
      2> (Join-Path $outDir 'verification-container-stderr.log')
  } catch {
    # Best-effort failure evidence only.
  }
} finally {
  & docker exec $PostgresContainer `
    rm -f $containerDumpPath $containerExactSql $containerCountSql `
    *> $null
  $sourceTempFilesRemoved = ($LASTEXITCODE -eq 0)

  & docker rm -fv $verifyContainer *> $null
  $verificationContainerRemoved = ($LASTEXITCODE -eq 0)
  if (-not $verificationContainerRemoved) {
    $stillExists = (& docker inspect -f '{{.Id}}' $verifyContainer 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($stillExists | Out-String).Trim())) {
      $verificationContainerRemoved = $true
    }
  }
}

if ($null -ne $operationError) {
  throw $operationError
}
if (-not $sourceTempFilesRemoved) {
  throw '生产 PostgreSQL 容器临时文件未确认删除。'
}
if (-not $verificationContainerRemoved) {
  throw '隔离恢复验证容器未确认删除。'
}

& node $summaryBuilder --directory $outDir
if ($LASTEXITCODE -ne 0) {
  throw '备份恢复验证证据汇总失败。'
}

$summary = Get-Content `
  -LiteralPath (Join-Path $outDir 'backup-verification-summary.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
if ($summary.backupRestoreVerified -ne $true -or
    $summary.productionCountsStableDuringBackup -ne $true -or
    $summary.restoredCountsMatchProduction -ne $true -or
    $summary.safety.productionDatabaseWrite -ne $false -or
    $summary.safety.ephemeralVerificationDatabaseWrite -ne $true -or
    $summary.safety.ephemeralVerificationContainerRemoved -ne $true) {
  throw '备份恢复验证摘要未证明完整安全门槛。'
}

$evidenceManifestPath = Join-Path $outDir 'evidence-manifest.json'
$evidenceManifest = Get-Content `
  -LiteralPath $evidenceManifestPath `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 50
$evidencePaths = @(
  @($evidenceManifest) | ForEach-Object {
    Join-Path $outDir ([string]$_.file)
  }
)
$evidencePaths += $evidenceManifestPath
Compress-Archive `
  -LiteralPath $evidencePaths `
  -DestinationPath $evidenceBundle `
  -CompressionLevel Optimal `
  -Force

$evidenceBundleHash = Get-FileHash -LiteralPath $evidenceBundle -Algorithm SHA256

Write-Host ''
Write-Host 'Test Work PostgreSQL 备份与隔离恢复验证完成' -ForegroundColor Green
Write-Host "DryRunV03Directory        : $dryRunDir"
Write-Host "ExactBeforeDirectory      : $exactDir"
Write-Host "OutputDirectory           : $outDir"
Write-Host "Backup                    : $backupPath"
Write-Host "BackupBytes               : $($summary.backupBytes)"
Write-Host "BackupSHA256              : $($summary.backupSha256)"
Write-Host "EvidenceBundle            : $evidenceBundle"
Write-Host "EvidenceBundleSHA256      : $($evidenceBundleHash.Hash)"
Write-Host "BusinessTableCountChecks  : $($summary.businessTableCountChecks)"
Write-Host 'ProductionPreExactChecks  : 37 / 37'
Write-Host 'ProductionPostExactChecks : 37 / 37'
Write-Host 'RestoreExactChecks        : 37 / 37'
Write-Host 'BackupRestoreVerified     : True'
Write-Host ''
Write-Host 'ProductionDatabaseWrite   : False'
Write-Host 'PayloadWrite              : False'
Write-Host 'MigrationGeneration       : False'
Write-Host 'SchemaPush                : False'
Write-Host 'MergePerformed            : False'
Write-Host 'HostBackupFileWrite       : True'
Write-Host 'EphemeralDatabaseWrite    : True (isolated container only)'
Write-Host 'VerificationContainer     : Removed'
Write-Host 'ProductionTempFiles       : Removed'
Write-Host ''
Write-Host '请保留本地 database-backup.dump；只需上传较小的 EvidenceBundle。' -ForegroundColor Yellow
