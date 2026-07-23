param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$SchemaReviewBundle,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [Parameter(Mandatory = $true)][ValidateSet('RUN-ISOLATED-RADAR-PUBLIC-CONCLUSIONS-LAB-V01')][string]$Confirm,
  [string]$ExpectedSchemaReviewSHA256 = '297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB',
  [string]$ExpectedAuditSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$ExpectedMigrationCommit = '3ea530cb342bfab5c126e94498d2d94c98413aa0'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-JsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText(
    $Path,
    ($json.TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Test-ArtifactManifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "manifest 文件不存在：$($entry.file)"
    }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    $bytes = (Get-Item -LiteralPath $file).Length
    if ($bytes -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
}

function Invoke-DockerPsqlFile(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$ContainerSqlPath,
  [string]$Prefix,
  [string]$OutputDirectory
) {
  $stdoutPath = Join-Path $OutputDirectory "$Prefix-stdout.txt"
  $stderrPath = Join-Path $OutputDirectory "$Prefix-stderr.txt"
  $args = @(
    'exec',
    '-e', "PGPASSWORD=$Password",
    '-e', 'PGOPTIONS=-c TimeZone=UTC -c client_min_messages=warning',
    $Container,
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', $User, '-d', $Database, '-f', $ContainerSqlPath
  )
  & docker @args 1> $stdoutPath 2> $stderrPath
  if ($LASTEXITCODE -ne 0) {
    throw "$Prefix 在隔离 PostgreSQL 中执行失败。"
  }
  return $stdoutPath
}

function Invoke-TableCounts(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$ContainerSqlPath,
  [string]$OutputPath,
  [string]$ErrorPath
) {
  $args = @(
    'exec',
    '-e', "PGPASSWORD=$Password",
    $Container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', $User, '-d', $Database, '-f', $ContainerSqlPath
  )
  & docker @args 1> $OutputPath 2> $ErrorPath
  if ($LASTEXITCODE -ne 0) { throw "业务表行数查询失败：$OutputPath" }
}

function Read-CountMap([string]$Path) {
  $map = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -ne 2) { throw "无法解析表行数：$line" }
    $map[$parts[0]] = [long]$parts[1]
  }
  return $map
}

function Compare-CountMaps([object]$Expected, [object]$Actual, [string]$Label) {
  $expectedJson = $Expected | ConvertTo-Json -Compress
  $actualJson = $Actual | ConvertTo-Json -Compress
  if ($expectedJson -ne $actualJson) {
    throw "$Label 业务表行数不一致。"
  }
}

function Assert-Checks([string]$Path, [string]$Label) {
  $checks = @()
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -ne 4) { throw "$Label 无法解析检查行：$line" }
    $checks += [pscustomobject]@{
      name = $parts[0]
      actual = $parts[1]
      expected = $parts[2]
      matched = $parts[3].ToLowerInvariant() -eq 'true'
    }
  }
  if ($checks.Count -eq 0 -or @($checks | Where-Object { -not $_.matched }).Count -gt 0) {
    $checks | Where-Object { -not $_.matched } | Format-Table | Out-String | Write-Host
    throw "$Label 未全部通过。"
  }
  return @($checks)
}

if ($Confirm -ne 'RUN-ISOLATED-RADAR-PUBLIC-CONCLUSIONS-LAB-V01') {
  throw '隔离演练确认字符串不匹配。'
}

foreach ($bundle in @($SchemaReviewBundle, $AuditBundle)) {
  if (-not (Test-Path -LiteralPath $bundle -PathType Leaf)) { throw "找不到输入 ZIP：$bundle" }
}
$schemaReviewPath = (Resolve-Path -LiteralPath $SchemaReviewBundle).Path
$auditPath = (Resolve-Path -LiteralPath $AuditBundle).Path
$schemaReviewHash = (Get-FileHash -LiteralPath $schemaReviewPath -Algorithm SHA256).Hash
$auditHash = (Get-FileHash -LiteralPath $auditPath -Algorithm SHA256).Hash
if ($schemaReviewHash -ne $ExpectedSchemaReviewSHA256) { throw "schema review ZIP SHA-256 不匹配：$schemaReviewHash" }
if ($auditHash -ne $ExpectedAuditSHA256) { throw "全量审计 ZIP SHA-256 不匹配：$auditHash" }

Write-Host ''
Write-Host '==> 锁定隔离演练分支与提交' -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端更新失败。' }
git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '切换公共 Radar 分支失败。' }
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新公共 Radar 分支失败。' }
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $ExpectedBranchHead -or $remoteHead -ne $ExpectedBranchHead) {
  throw "隔离演练提交不符合预期：local=$localHead remote=$remoteHead"
}
git merge-base --is-ancestor $ExpectedMigrationCommit HEAD
if ($LASTEXITCODE -ne 0) { throw '当前提交不包含已审阅 Radar migration commit。' }

Write-Host ''
Write-Host '==> 运行隔离演练构建器与 runner 回归测试' -ForegroundColor Cyan
node --check '.\scripts\radar\build-radar-public-conclusions-lab-sql-v01.mjs'
if ($LASTEXITCODE -ne 0) { throw '隔离演练 SQL builder 语法检查失败。' }
node --test `
  '.\tests\radar-public-conclusions-lab-rehearsal.test.mjs' `
  '.\tests\radar-public-conclusions-direct-runner.test.mjs' `
  '.\tests\radar-public-conclusions.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'Radar 公共结论隔离演练回归测试失败。' }

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$sourceRunning = (& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') {
  throw "源 PostgreSQL 容器未运行：$SourcePostgresContainer"
}
$postgresImage = (& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresImage)) {
  throw '无法读取生产 PostgreSQL 镜像。'
}

$productionRadarTable = (& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -c "SELECT COALESCE(to_regclass('public.radar_public')::text, '');").Trim()
if ($LASTEXITCODE -ne 0 -or $productionRadarTable) { throw '生产库已存在 radar_public；当前首次建表演练输入失效。' }
$productionWorks = (& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -c 'SELECT count(*) FROM public.works;').Trim()
if ($LASTEXITCODE -ne 0 -or $productionWorks -ne '35615') { throw "生产 Works 数量不符合预期：$productionWorks" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-public-conclusions-lab-rehearsal-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-PUBLIC-CONCLUSIONS-LAB-REHEARSAL-$stamp.zip"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-public-lab-$stamp-" + [Guid]::NewGuid().ToString('N'))
$schemaReviewDir = Join-Path $tempRoot 'schema-review'
$auditDir = Join-Path $tempRoot 'audit'
$sqlDir = Join-Path $outDir 'lab-sql'
New-Item -ItemType Directory -Path $schemaReviewDir, $auditDir, $sqlDir -Force | Out-Null
Expand-Archive -LiteralPath $schemaReviewPath -DestinationPath $schemaReviewDir -Force
Expand-Archive -LiteralPath $auditPath -DestinationPath $auditDir -Force
Test-ArtifactManifest $schemaReviewDir
Test-ArtifactManifest $auditDir

node '.\scripts\radar\build-radar-public-conclusions-lab-sql-v01.mjs' `
  --audit-dir $auditDir `
  --schema-review-dir $schemaReviewDir `
  --audit-zip-sha256 $auditHash `
  --schema-review-zip-sha256 $schemaReviewHash `
  --out-dir $sqlDir
if ($LASTEXITCODE -ne 0) { throw '隔离演练 SQL 构建失败。' }

$readyPath = Join-Path $auditDir 'public-ai-ready.jsonl'
$backupPath = Join-Path $outDir 'database-backup.dump'
$sourceDumpPath = "/tmp/radar-public-lab-$stamp.dump"
$labContainer = "baihepailei-radar-public-lab-$stamp"
$labUser = 'radar_lab'
$labDatabase = 'radar_lab'
$labPassword = [Guid]::NewGuid().ToString('N')
$containerDumpPath = '/tmp/database-backup.dump'
$containerReadyPath = '/tmp/public-ai-ready.jsonl'
$containerApplyPath = '/tmp/radar-public-lab-apply.sql.lab-only'
$containerAcceptancePath = '/tmp/radar-public-lab-acceptance.sql'
$containerRollbackPath = '/tmp/radar-public-lab-rollback.sql.lab-only'
$containerPostRollbackPath = '/tmp/radar-public-lab-post-rollback-acceptance.sql'
$containerCountsPath = '/tmp/business-table-counts.sql'

$countSqlPath = Join-Path $outDir 'business-table-counts.sql'
$countSql = @'
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
  AND tablename NOT LIKE 'radar_public%'
ORDER BY tablename
\gexec
'@
[System.IO.File]::WriteAllText($countSqlPath, $countSql.TrimStart(), [System.Text.UTF8Encoding]::new($false))

$stageStatusPath = Join-Path $outDir 'lab-stage-status.json'
$stageStatus = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  productionPreflightPassed = $true
  productionDatabaseWrite = $false
  freshBackupCreated = $false
  isolatedRestorePassed = $false
  schemaApplyPassed = $false
  dataRowsApplied = 0
  postApplyAcceptancePassed = $false
  rollbackPassed = $false
  baselineRestored = $false
  labContainerRemoved = $false
}
Write-JsonFile $stageStatusPath $stageStatus

try {
  Write-Host ''
  Write-Host '==> 读取生产业务表基线并创建 fresh 只读备份' -ForegroundColor Cyan
  docker cp $countSqlPath "${SourcePostgresContainer}:$containerCountsPath" | Out-Null
  $productionCountsPath = Join-Path $outDir 'production-pre-table-counts.tsv'
  $productionCountsError = Join-Path $outDir 'production-pre-table-counts-stderr.txt'
  & docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -f $containerCountsPath 1> $productionCountsPath 2> $productionCountsError
  if ($LASTEXITCODE -ne 0) { throw '读取生产业务表基线失败。' }

  & docker exec $SourcePostgresContainer pg_dump `
    -U $SourceDatabaseUser -d $SourceDatabase `
    --format=custom --compress=6 --serializable-deferrable `
    --no-owner --no-privileges --file=$sourceDumpPath
  if ($LASTEXITCODE -ne 0) { throw '生产数据库 fresh pg_dump 失败。' }
  docker cp "${SourcePostgresContainer}:$sourceDumpPath" $backupPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 fresh backup 到宿主机失败。' }
  $backupHash = Get-FileHash -LiteralPath $backupPath -Algorithm SHA256
  $backupBytes = (Get-Item -LiteralPath $backupPath).Length
  if ($backupBytes -le 0) { throw 'fresh backup 为空。' }
  $stageStatus.freshBackupCreated = $true
  Write-JsonFile $stageStatusPath $stageStatus

  Write-Host ''
  Write-Host '==> 启动无网络隔离 PostgreSQL 并恢复 fresh backup' -ForegroundColor Cyan
  & docker run -d --name $labContainer --network none `
    -e "POSTGRES_USER=$labUser" `
    -e "POSTGRES_PASSWORD=$labPassword" `
    -e 'POSTGRES_DB=postgres' `
    $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '隔离 PostgreSQL 容器启动失败。' }

  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  do {
    Start-Sleep -Seconds 2
    & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_isready -U $labUser -d postgres | Out-Null
    $ready = $LASTEXITCODE -eq 0
  } while (-not $ready -and (Get-Date) -lt $deadline)
  if (-not $ready) { throw '隔离 PostgreSQL 未在时限内就绪。' }

  & docker exec -e "PGPASSWORD=$labPassword" $labContainer createdb -U $labUser -T template0 $labDatabase
  if ($LASTEXITCODE -ne 0) { throw '创建隔离数据库失败。' }
  docker cp $backupPath "${labContainer}:$containerDumpPath" | Out-Null
  docker cp $countSqlPath "${labContainer}:$containerCountsPath" | Out-Null
  & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_restore `
    -U $labUser -d $labDatabase --no-owner --no-privileges --exit-on-error $containerDumpPath
  if ($LASTEXITCODE -ne 0) { throw 'fresh backup 在隔离数据库恢复失败。' }

  $labBaselineCountsPath = Join-Path $outDir 'lab-baseline-table-counts.tsv'
  Invoke-TableCounts $labContainer $labDatabase $labUser $labPassword $containerCountsPath $labBaselineCountsPath (Join-Path $outDir 'lab-baseline-table-counts-stderr.txt')
  $productionCounts = Read-CountMap $productionCountsPath
  $labBaselineCounts = Read-CountMap $labBaselineCountsPath
  Compare-CountMaps $productionCounts $labBaselineCounts '生产 → 隔离恢复'
  $stageStatus.isolatedRestorePassed = $true
  Write-JsonFile $stageStatusPath $stageStatus

  Write-Host ''
  Write-Host '==> 在隔离数据库执行 schema + 9000 行写入' -ForegroundColor Cyan
  docker cp $readyPath "${labContainer}:$containerReadyPath" | Out-Null
  docker cp (Join-Path $sqlDir 'radar-public-lab-apply.sql.lab-only') "${labContainer}:$containerApplyPath" | Out-Null
  docker cp (Join-Path $sqlDir 'radar-public-lab-acceptance.sql') "${labContainer}:$containerAcceptancePath" | Out-Null
  docker cp (Join-Path $sqlDir 'radar-public-lab-rollback.sql.lab-only') "${labContainer}:$containerRollbackPath" | Out-Null
  docker cp (Join-Path $sqlDir 'radar-public-lab-post-rollback-acceptance.sql') "${labContainer}:$containerPostRollbackPath" | Out-Null

  Invoke-DockerPsqlFile $labContainer $labDatabase $labUser $labPassword $containerApplyPath 'apply' $outDir | Out-Null
  $stageStatus.schemaApplyPassed = $true
  $stageStatus.dataRowsApplied = 9000
  Write-JsonFile $stageStatusPath $stageStatus

  $labPostApplyCountsPath = Join-Path $outDir 'lab-post-apply-nonradar-table-counts.tsv'
  Invoke-TableCounts $labContainer $labDatabase $labUser $labPassword $containerCountsPath $labPostApplyCountsPath (Join-Path $outDir 'lab-post-apply-table-counts-stderr.txt')
  Compare-CountMaps $labBaselineCounts (Read-CountMap $labPostApplyCountsPath) 'apply 后非 Radar 表'

  $acceptanceOutput = Invoke-DockerPsqlFile $labContainer $labDatabase $labUser $labPassword $containerAcceptancePath 'acceptance' $outDir
  $acceptanceChecks = Assert-Checks $acceptanceOutput 'post-apply acceptance'
  $stageStatus.postApplyAcceptancePassed = $true
  Write-JsonFile $stageStatusPath $stageStatus

  Write-Host ''
  Write-Host '==> 在隔离数据库执行 rollback 并验证 baseline 恢复' -ForegroundColor Cyan
  Invoke-DockerPsqlFile $labContainer $labDatabase $labUser $labPassword $containerRollbackPath 'rollback' $outDir | Out-Null
  $stageStatus.rollbackPassed = $true
  Write-JsonFile $stageStatusPath $stageStatus

  $labPostRollbackCountsPath = Join-Path $outDir 'lab-post-rollback-table-counts.tsv'
  Invoke-TableCounts $labContainer $labDatabase $labUser $labPassword $containerCountsPath $labPostRollbackCountsPath (Join-Path $outDir 'lab-post-rollback-table-counts-stderr.txt')
  Compare-CountMaps $labBaselineCounts (Read-CountMap $labPostRollbackCountsPath) 'rollback 后 baseline'
  $postRollbackOutput = Invoke-DockerPsqlFile $labContainer $labDatabase $labUser $labPassword $containerPostRollbackPath 'post-rollback-acceptance' $outDir
  $rollbackChecks = Assert-Checks $postRollbackOutput 'post-rollback acceptance'
  $stageStatus.baselineRestored = $true
  Write-JsonFile $stageStatusPath $stageStatus

  $planSummary = Get-Content -LiteralPath (Join-Path $sqlDir 'radar-public-lab-plan-summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  $summary = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    branch = $ExpectedBranch
    head = $localHead
    migrationCommit = $ExpectedMigrationCommit
    schemaReviewZipSha256 = $schemaReviewHash.ToLowerInvariant()
    auditZipSha256 = $auditHash.ToLowerInvariant()
    freshBackupBytes = $backupBytes
    freshBackupSha256 = $backupHash.Hash.ToLowerInvariant()
    postgresImage = $postgresImage
    productionWorks = 35615
    productionBusinessTableCount = $productionCounts.Count
    restoredBusinessTableCount = $labBaselineCounts.Count
    publicRowsApplied = 9000
    reviewReasonRows = $planSummary.reviewReasonRows
    matchedRuleRows = $planSummary.matchedRuleRows
    contradictionRows = $planSummary.contradictionRows
    postApplyChecks = $acceptanceChecks.Count
    postApplyChecksPassed = @($acceptanceChecks | Where-Object matched).Count
    postRollbackChecks = $rollbackChecks.Count
    postRollbackChecksPassed = @($rollbackChecks | Where-Object matched).Count
    productionDatabaseWrite = $false
    productionMigrationExecuted = $false
    payloadWrite = $false
    labDatabaseWrite = $true
    schemaApplyPassed = $true
    dataApplyPassed = $true
    rollbackPassed = $true
    baselineRestored = $true
    labRehearsalPassed = $true
    productionApplyAuthorized = $false
    productionRollbackAuthorized = $false
  }
  Write-JsonFile (Join-Path $outDir 'radar-public-conclusions-lab-rehearsal-summary.json') $summary

  $evidenceFiles = @(Get-ChildItem -LiteralPath $outDir -Recurse -File | Where-Object { $_.FullName -ne $backupPath } | Sort-Object FullName)
  $manifest = @($evidenceFiles | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($outDir, $_.FullName).Replace('\', '/')
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{ file = $relative; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
  })
  Write-JsonFile (Join-Path $outDir 'manifest.json') $manifest
  $zipFiles = @((Get-ChildItem -LiteralPath $outDir -Recurse -File | Where-Object { $_.FullName -ne $backupPath }).FullName)
  Compress-Archive -LiteralPath $zipFiles -DestinationPath $bundlePath -CompressionLevel Optimal -Force
  $bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

  Write-Host ''
  Write-Host 'Radar 公共结论隔离往返演练通过' -ForegroundColor Green
  Write-Host "OutputDirectory          : $outDir"
  Write-Host "EvidenceBundle           : $bundlePath"
  Write-Host "EvidenceBundleSHA256     : $($bundleHash.Hash)"
  Write-Host "LocalFreshBackup         : $backupPath"
  Write-Host "LocalFreshBackupSHA256   : $($backupHash.Hash)"
  Write-Host 'PublicRowsApplied        : 9000'
  Write-Host "PostApplyChecks          : $($acceptanceChecks.Count) / $($acceptanceChecks.Count)"
  Write-Host "PostRollbackChecks       : $($rollbackChecks.Count) / $($rollbackChecks.Count)"
  Write-Host 'BaselineRestored         : True'
  Write-Host 'ProductionDatabaseWrite  : False'
  Write-Host 'ProductionMigrationRun   : False'
  Write-Host 'LabDatabaseWrite         : True'
  Write-Host 'LabContainer             : Removed (after cleanup)'
  Write-Host 'ProductionApplyAuthorized: False'
} finally {
  docker rm -f $labContainer 2>$null | Out-Null
  $stageStatus.labContainerRemoved = $true
  Write-JsonFile $stageStatusPath $stageStatus
  docker exec $SourcePostgresContainer rm -f $sourceDumpPath $containerCountsPath 2>$null | Out-Null
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
