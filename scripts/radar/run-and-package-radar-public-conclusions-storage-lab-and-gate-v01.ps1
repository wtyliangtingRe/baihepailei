param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$StorageBundle,
  [Parameter(Mandatory = $true)][string]$SchemaReviewBundle,
  [Parameter(Mandatory = $true)][ValidateSet('RUN-ISOLATED-RADAR-PUBLIC-CONCLUSIONS-STORAGE-LAB-V01')][string]$Confirm,
  [string]$ExpectedStorageSHA256 = '642E43B9CBAC02C75D2D473293C7B57B8B0197594262DFA96B065015E89C135E',
  [string]$ExpectedSchemaReviewSHA256 = '297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$ExpectedMigrationCommit = '3ea530cb342bfab5c126e94498d2d94c98413aa0'
$ExpectedReadySHA256 = 'BDA8429DFCF6DBCAAEB90199AC1697196B308013F65DF546F20B46167B49A220'
$ExpectedPlanSHA256 = '72191D11AC163AA09F927353E64B3BDC22D74963D7436A4BF790CE30EE39BC39'
$ExpectedRewriteSHA256 = '1CFF56EB78482C0A5A6BF714E617E8C00A5F90CC1866B76D9081E8BD10DECCFD'
$ApplyAuthorizationPhrase = 'AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01'
$RollbackAuthorizationPhrase = 'AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-ROLLBACK-V01'
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-JsonFile([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
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

function Assert-Manifest([string]$Directory) {
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

function Write-DirectoryManifest([string]$Directory) {
  $files = @(Get-ChildItem -LiteralPath $Directory -Recurse -File | Where-Object { $_.Name -ne 'manifest.json' } | Sort-Object FullName)
  $manifest = @($files | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/')
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{ file = $relative; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
  })
  Write-JsonFile -Path (Join-Path $Directory 'manifest.json') -Value $manifest
  Assert-Manifest $Directory
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
    'exec', '-e', "PGPASSWORD=$Password",
    '-e', 'PGOPTIONS=-c TimeZone=UTC -c client_min_messages=warning',
    $Container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', $User, '-d', $Database, '-f', $ContainerSqlPath
  )
  & docker @args 1> $stdoutPath 2> $stderrPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "==> $Prefix stderr" -ForegroundColor Yellow
    if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
      Get-Content -LiteralPath $stderrPath -Encoding UTF8 | Select-Object -Last 120 | ForEach-Object { Write-Host $_ }
    }
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
    'exec', '-e', "PGPASSWORD=$Password", $Container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', $User, '-d', $Database, '-f', $ContainerSqlPath
  )
  & docker @args 1> $OutputPath 2> $ErrorPath
  if ($LASTEXITCODE -ne 0) { throw "业务表行数查询失败：$OutputPath" }
}

function Read-CountMap([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -ne 2) { throw "无法解析表行数：$line" }
    if ($map.ContainsKey($parts[0])) { throw "表行数结果重复：$($parts[0])" }
    $map[$parts[0]] = [long]$parts[1]
  }
  return $map
}

function Compare-CountMaps([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  if (($expectedKeys -join "`n") -ne ($actualKeys -join "`n")) {
    throw "$Label 业务表集合不一致。"
  }
  foreach ($key in $expectedKeys) {
    if ([long]$Expected[$key] -ne [long]$Actual[$key]) {
      throw "$Label 表行数不一致：$key expected=$($Expected[$key]) actual=$($Actual[$key])"
    }
  }
}

function Assert-Checks([string]$Path, [string]$Label) {
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
  $failed = @($checks | Where-Object { -not $_.matched })
  if ($checks.Count -eq 0 -or $failed.Count -gt 0) {
    $failed | Format-Table | Out-String | Write-Host
    throw "$Label 未全部通过。"
  }
  return @($checks)
}

function Copy-TreeWithoutBackup([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Where-Object { $_.Name -ne 'database-backup.dump' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

if ($Confirm -ne 'RUN-ISOLATED-RADAR-PUBLIC-CONCLUSIONS-STORAGE-LAB-V01') {
  throw '隔离演练确认字符串不匹配。'
}
foreach ($bundle in @($StorageBundle, $SchemaReviewBundle)) {
  if (-not (Test-Path -LiteralPath $bundle -PathType Leaf)) { throw "找不到输入 ZIP：$bundle" }
}
$storagePath = (Resolve-Path -LiteralPath $StorageBundle).Path
$schemaReviewPath = (Resolve-Path -LiteralPath $SchemaReviewBundle).Path
$storageHash = (Get-FileHash -LiteralPath $storagePath -Algorithm SHA256).Hash
$schemaReviewHash = (Get-FileHash -LiteralPath $schemaReviewPath -Algorithm SHA256).Hash
if ($storageHash -ne $ExpectedStorageSHA256) { throw "存储规范化 ZIP SHA-256 不匹配：$storageHash" }
if ($schemaReviewHash -ne $ExpectedSchemaReviewSHA256) { throw "schema review ZIP SHA-256 不匹配：$schemaReviewHash" }

$unexpectedDirty = @(Get-DirtyPaths | Where-Object { $AllowedDirtyFiles -notcontains $_ })
if ($unexpectedDirty.Count -gt 0) {
  $unexpectedDirty | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '存在预期之外的本地修改；未开始隔离演练。'
}

Write-Host ''
Write-Host '==> 锁定 storage-normalized lab 分支与提交' -ForegroundColor Cyan
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
Write-Host '==> 运行 storage-normalized lab 与 gate 回归测试' -ForegroundColor Cyan
node --check '.\scripts\radar\build-radar-public-conclusions-storage-lab-sql-v01.mjs'
if ($LASTEXITCODE -ne 0) { throw 'storage-normalized lab SQL builder 语法检查失败。' }
node --test `
  '.\tests\radar-public-conclusions-storage-lab-and-gate.test.mjs' `
  '.\tests\radar-public-storage-normalization.test.mjs' `
  '.\tests\radar-public-conclusions.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'storage-normalized lab 与 gate 回归测试失败。' }

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$sourceRunning = ([string](& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') { throw "源 PostgreSQL 容器未运行：$SourcePostgresContainer" }
$postgresImage = ([string](& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresImage)) { throw '无法读取生产 PostgreSQL 镜像。' }

$productionRadarTable = ([string](& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -c "SELECT COALESCE(to_regclass('public.radar_public')::text, '');")).Trim()
if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($productionRadarTable)) {
  throw '生产库已存在 radar_public；首次建表 gate 输入失效。'
}
$productionWorks = ([string](& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -c 'SELECT count(*) FROM public.works;')).Trim()
if ($LASTEXITCODE -ne 0 -or $productionWorks -ne '35615') { throw "生产 Works 数量不符合预期：$productionWorks" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-public-conclusions-storage-lab-$stamp"
$labBundlePath = Join-Path $repoRoot "exports\RADAR-PUBLIC-CONCLUSIONS-STORAGE-LAB-$stamp.zip"
$gateDir = Join-Path $repoRoot "exports\radar-public-conclusions-production-gate-$stamp"
$gateBundlePath = Join-Path $repoRoot "exports\RADAR-PUBLIC-CONCLUSIONS-PRODUCTION-GATE-$stamp.zip"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-storage-lab-$stamp-" + [Guid]::NewGuid().ToString('N'))
$storageDir = Join-Path $tempRoot 'storage'
$schemaReviewDir = Join-Path $tempRoot 'schema-review'
$sqlDir = Join-Path $outDir 'lab-sql'
$labPackDir = Join-Path $tempRoot 'lab-pack'
$gatePackDir = Join-Path $tempRoot 'gate-pack'
New-Item -ItemType Directory -Path $storageDir, $schemaReviewDir, $sqlDir, $labPackDir, $gateDir, $gatePackDir -Force | Out-Null
Expand-Archive -LiteralPath $storagePath -DestinationPath $storageDir -Force
Expand-Archive -LiteralPath $schemaReviewPath -DestinationPath $schemaReviewDir -Force
Assert-Manifest $storageDir
Assert-Manifest $schemaReviewDir

node '.\scripts\radar\build-radar-public-conclusions-storage-lab-sql-v01.mjs' `
  --storage-dir $storageDir `
  --schema-review-dir $schemaReviewDir `
  --storage-zip-sha256 $storageHash `
  --schema-review-zip-sha256 $schemaReviewHash `
  --out-dir $sqlDir
if ($LASTEXITCODE -ne 0) { throw 'storage-normalized lab SQL 构建失败。' }

$readyPath = Join-Path $storageDir 'public-ai-storage-ready.jsonl'
if ((Get-FileHash -LiteralPath $readyPath -Algorithm SHA256).Hash -ne $ExpectedReadySHA256) { throw '解压后的 storage-ready SHA-256 不匹配。' }
$backupPath = Join-Path $outDir 'database-backup.dump'
$sourceDumpPath = "/tmp/radar-storage-lab-$stamp.dump"
$labContainer = "baihepailei-radar-storage-lab-$stamp"
$labUser = 'radar_lab'
$labDatabase = 'radar_lab'
$labPassword = [Guid]::NewGuid().ToString('N')
$containerDumpPath = '/tmp/database-backup.dump'
$containerReadyPath = '/tmp/public-ai-storage-ready.jsonl'
$containerApplyPath = '/tmp/radar-public-storage-apply.sql.lab-only'
$containerAcceptancePath = '/tmp/radar-public-storage-acceptance.sql'
$containerRollbackPath = '/tmp/radar-public-storage-rollback.sql.lab-only'
$containerPostRollbackPath = '/tmp/radar-public-storage-post-rollback-acceptance.sql'
$containerPreflightPath = '/tmp/radar-public-production-preflight.sql'
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
  sourceContainerTempFilesRemoved = $false
  labContainerRemoved = $false
  labEvidencePackageCompleted = $false
  productionGatePackageCompleted = $false
}
Write-JsonFile $stageStatusPath $stageStatus

$labContainerCreated = $false
$labContainerRemoved = $false
$sourceTempRemoved = $false
$labPackageCompleted = $false
$gatePackageCompleted = $false

try {
  Write-Host ''
  Write-Host '==> 创建同窗口 fresh backup 与生产基线' -ForegroundColor Cyan
  docker cp $countSqlPath "${SourcePostgresContainer}:$containerCountsPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制计数 SQL 到生产容器失败。' }
  $productionPreCountsPath = Join-Path $outDir 'production-pre-backup-table-counts.tsv'
  Invoke-TableCounts $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $containerCountsPath $productionPreCountsPath (Join-Path $outDir 'production-pre-backup-table-counts-stderr.txt')

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
  & pg_restore --list $backupPath 1> (Join-Path $outDir 'backup-archive-list.txt') 2> (Join-Path $outDir 'backup-archive-list-stderr.txt')
  if ($LASTEXITCODE -ne 0) { throw '本地 pg_restore --list 校验失败。' }

  $productionPostCountsPath = Join-Path $outDir 'production-post-backup-table-counts.tsv'
  Invoke-TableCounts $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $containerCountsPath $productionPostCountsPath (Join-Path $outDir 'production-post-backup-table-counts-stderr.txt')
  $productionPreCounts = Read-CountMap $productionPreCountsPath
  $productionPostCounts = Read-CountMap $productionPostCountsPath
  Compare-CountMaps $productionPreCounts $productionPostCounts 'backup 前后生产基线'
  $stageStatus.freshBackupCreated = $true
  Write-JsonFile $stageStatusPath $stageStatus

  Write-Host ''
  Write-Host '==> 启动 --network none 隔离 PostgreSQL 并完整恢复' -ForegroundColor Cyan
  & docker run -d --name $labContainer --network none `
    -e "POSTGRES_USER=$labUser" -e "POSTGRES_PASSWORD=$labPassword" -e 'POSTGRES_DB=postgres' `
    $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '隔离 PostgreSQL 容器启动失败。' }
  $labContainerCreated = $true

  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  $ready = $false
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
  if ($LASTEXITCODE -ne 0) { throw '复制恢复输入到隔离容器失败。' }
  & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_restore `
    -U $labUser -d $labDatabase --no-owner --no-privileges --exit-on-error $containerDumpPath
  if ($LASTEXITCODE -ne 0) { throw 'fresh backup 在隔离数据库恢复失败。' }

  $labBaselineCountsPath = Join-Path $outDir 'lab-baseline-table-counts.tsv'
  Invoke-TableCounts $labContainer $labDatabase $labUser $labPassword $containerCountsPath $labBaselineCountsPath (Join-Path $outDir 'lab-baseline-table-counts-stderr.txt')
  $labBaselineCounts = Read-CountMap $labBaselineCountsPath
  Compare-CountMaps $productionPostCounts $labBaselineCounts '生产 → 隔离恢复'
  $stageStatus.isolatedRestorePassed = $true
  Write-JsonFile $stageStatusPath $stageStatus

  Write-Host ''
  Write-Host '==> 在隔离数据库执行 schema + 9000 条 storage-normalized 写入' -ForegroundColor Cyan
  docker cp $readyPath "${labContainer}:$containerReadyPath" | Out-Null
  foreach ($copy in @(
    @((Join-Path $sqlDir 'radar-public-storage-apply.sql.lab-only'), $containerApplyPath),
    @((Join-Path $sqlDir 'radar-public-storage-acceptance.sql'), $containerAcceptancePath),
    @((Join-Path $sqlDir 'radar-public-storage-rollback.sql.lab-only'), $containerRollbackPath),
    @((Join-Path $sqlDir 'radar-public-storage-post-rollback-acceptance.sql'), $containerPostRollbackPath),
    @((Join-Path $sqlDir 'radar-public-production-preflight.sql'), $containerPreflightPath)
  )) {
    docker cp $copy[0] "${labContainer}:$($copy[1])" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "复制隔离 SQL 失败：$($copy[0])" }
  }

  $labPreflightOutput = Invoke-DockerPsqlFile $labContainer $labDatabase $labUser $labPassword $containerPreflightPath 'lab-preflight' $outDir
  $labPreflightChecks = Assert-Checks $labPreflightOutput 'lab preflight'
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
  Write-Host '==> 在隔离数据库执行 exact rollback 与 baseline 恢复' -ForegroundColor Cyan
  Invoke-DockerPsqlFile $labContainer $labDatabase $labUser $labPassword $containerRollbackPath 'rollback' $outDir | Out-Null
  $stageStatus.rollbackPassed = $true
  $labPostRollbackCountsPath = Join-Path $outDir 'lab-post-rollback-table-counts.tsv'
  Invoke-TableCounts $labContainer $labDatabase $labUser $labPassword $containerCountsPath $labPostRollbackCountsPath (Join-Path $outDir 'lab-post-rollback-table-counts-stderr.txt')
  Compare-CountMaps $labBaselineCounts (Read-CountMap $labPostRollbackCountsPath) 'rollback 后 baseline'
  $postRollbackOutput = Invoke-DockerPsqlFile $labContainer $labDatabase $labUser $labPassword $containerPostRollbackPath 'post-rollback-acceptance' $outDir
  $rollbackChecks = Assert-Checks $postRollbackOutput 'post-rollback acceptance'
  $stageStatus.baselineRestored = $true
  Write-JsonFile $stageStatusPath $stageStatus

  & docker rm -f $labContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '删除隔离 PostgreSQL 容器失败。' }
  $labContainerRemoved = $true
  $stageStatus.labContainerRemoved = $true
  & docker exec $SourcePostgresContainer rm -f $sourceDumpPath $containerCountsPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '清理生产容器临时文件失败。' }
  $sourceTempRemoved = $true
  $stageStatus.sourceContainerTempFilesRemoved = $true

  $productionRadarAfter = ([string](& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -c "SELECT COALESCE(to_regclass('public.radar_public')::text, '');")).Trim()
  if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($productionRadarAfter)) {
    throw '演练后生产库 Radar schema 状态异常。'
  }

  $planSummary = Get-Content -LiteralPath (Join-Path $sqlDir 'radar-public-storage-lab-plan-summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  $labSummary = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    branch = $ExpectedBranch
    head = $localHead
    migrationCommit = $ExpectedMigrationCommit
    storageBundleSha256 = $storageHash.ToLowerInvariant()
    schemaReviewBundleSha256 = $schemaReviewHash.ToLowerInvariant()
    normalizedReadySha256 = $ExpectedReadySHA256.ToLowerInvariant()
    storageWritePlanSha256 = $ExpectedPlanSHA256.ToLowerInvariant()
    rewriteMapSha256 = $ExpectedRewriteSHA256.ToLowerInvariant()
    freshBackupBytes = $backupBytes
    freshBackupSha256 = $backupHash.Hash.ToLowerInvariant()
    postgresImage = $postgresImage
    productionWorks = 35615
    productionBusinessTableCount = $productionPostCounts.Count
    restoredBusinessTableCount = $labBaselineCounts.Count
    publicRowsApplied = 9000
    reviewReasonRows = $planSummary.reviewReasonRows
    matchedRuleRows = $planSummary.matchedRuleRows
    contradictionRows = $planSummary.contradictionRows
    labPreflightChecks = $labPreflightChecks.Count
    labPreflightChecksPassed = @($labPreflightChecks | Where-Object { $_.matched }).Count
    postApplyChecks = $acceptanceChecks.Count
    postApplyChecksPassed = @($acceptanceChecks | Where-Object { $_.matched }).Count
    postRollbackChecks = $rollbackChecks.Count
    postRollbackChecksPassed = @($rollbackChecks | Where-Object { $_.matched }).Count
    productionDatabaseWrite = $false
    productionMigrationExecuted = $false
    payloadWrite = $false
    labDatabaseWrite = $true
    schemaApplyPassed = $true
    dataApplyPassed = $true
    rollbackPassed = $true
    baselineRestored = $true
    sourceContainerTempFilesRemoved = $true
    labContainerRemoved = $true
    labRehearsalPassed = $true
    productionApplyAuthorized = $false
    productionRollbackAuthorized = $false
  }
  Write-JsonFile (Join-Path $outDir 'radar-public-conclusions-storage-lab-summary.json') $labSummary
  $stageStatus.labEvidencePackageCompleted = $true
  Write-JsonFile $stageStatusPath $stageStatus
  Write-DirectoryManifest $outDir
  Copy-TreeWithoutBackup $outDir $labPackDir
  Compress-Archive -Path (Join-Path $labPackDir '*') -DestinationPath $labBundlePath -CompressionLevel Optimal -Force
  $labBundleHash = Get-FileHash -LiteralPath $labBundlePath -Algorithm SHA256
  $labPackageCompleted = $true

  Write-Host ''
  Write-Host '==> 自动生成 production execution gate（不含执行能力）' -ForegroundColor Cyan
  Copy-Item -LiteralPath (Join-Path $sqlDir 'radar-public-production-preflight.sql') -Destination (Join-Path $gateDir 'production-preflight.sql')
  Copy-Item -LiteralPath (Join-Path $sqlDir 'radar-public-storage-apply.sql.lab-only') -Destination (Join-Path $gateDir 'production-apply.sql.disabled')
  Copy-Item -LiteralPath (Join-Path $sqlDir 'radar-public-storage-acceptance.sql') -Destination (Join-Path $gateDir 'production-acceptance.sql')
  Copy-Item -LiteralPath (Join-Path $sqlDir 'radar-public-storage-rollback.sql.lab-only') -Destination (Join-Path $gateDir 'production-rollback.sql.disabled')
  Copy-Item -LiteralPath (Join-Path $sqlDir 'radar-public-storage-post-rollback-acceptance.sql') -Destination (Join-Path $gateDir 'production-post-rollback-acceptance.sql')
  Copy-Item -LiteralPath (Join-Path $sqlDir 'radar-public-storage-lab-plan-summary.json') -Destination $gateDir
  Copy-Item -LiteralPath (Join-Path $outDir 'radar-public-conclusions-storage-lab-summary.json') -Destination $gateDir
  Copy-Item -LiteralPath $productionPostCountsPath -Destination (Join-Path $gateDir 'production-baseline-table-counts.tsv')

  $sqlHashes = [ordered]@{}
  foreach ($fileName in @(
    'production-preflight.sql',
    'production-apply.sql.disabled',
    'production-acceptance.sql',
    'production-rollback.sql.disabled',
    'production-post-rollback-acceptance.sql'
  )) {
    $sqlHashes[$fileName] = (Get-FileHash -LiteralPath (Join-Path $gateDir $fileName) -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $gateSummary = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    status = 'ready_for_explicit_production_apply_authorization'
    branch = $ExpectedBranch
    head = $localHead
    migrationCommit = $ExpectedMigrationCommit
    storageBundleSha256 = $storageHash.ToLowerInvariant()
    schemaReviewBundleSha256 = $schemaReviewHash.ToLowerInvariant()
    labEvidenceBundleSha256 = $labBundleHash.Hash.ToLowerInvariant()
    freshBackupBytes = $backupBytes
    freshBackupSha256 = $backupHash.Hash.ToLowerInvariant()
    normalizedReadySha256 = $ExpectedReadySHA256.ToLowerInvariant()
    storageWritePlanSha256 = $ExpectedPlanSHA256.ToLowerInvariant()
    rewriteMapSha256 = $ExpectedRewriteSHA256.ToLowerInvariant()
    publicRows = 9000
    productionWorks = 35615
    productionRadarSchemaAbsent = $true
    productionBaselineTableCount = $productionPostCounts.Count
    sqlSha256 = $sqlHashes
    labRehearsalPassed = $true
    baselineRestored = $true
    productionDatabaseWrite = $false
    productionMigrationExecuted = $false
    productionRowsWritten = 0
    productionApplyAuthorized = $false
    rollbackAuthorized = $false
    applyAuthorizationPhrase = $ApplyAuthorizationPhrase
    rollbackAuthorizationPhrase = $RollbackAuthorizationPhrase
    prMergeAuthorized = $false
  }
  Write-JsonFile (Join-Path $gateDir 'radar-public-conclusions-production-gate-summary.json') $gateSummary
  Write-DirectoryManifest $gateDir
  Copy-TreeWithoutBackup $gateDir $gatePackDir
  Compress-Archive -Path (Join-Path $gatePackDir '*') -DestinationPath $gateBundlePath -CompressionLevel Optimal -Force
  $gateBundleHash = Get-FileHash -LiteralPath $gateBundlePath -Algorithm SHA256
  $gatePackageCompleted = $true
  $stageStatus.productionGatePackageCompleted = $true
  Write-JsonFile $stageStatusPath $stageStatus

  Write-Host ''
  Write-Host 'Storage-normalized Radar 隔离演练与 production gate 已完成' -ForegroundColor Green
  Write-Host "OutputDirectory           : $outDir"
  Write-Host "LabEvidenceBundle         : $labBundlePath"
  Write-Host "LabEvidenceBundleSHA256   : $($labBundleHash.Hash)"
  Write-Host "ProductionGateBundle      : $gateBundlePath"
  Write-Host "ProductionGateBundleSHA256: $($gateBundleHash.Hash)"
  Write-Host "LocalFreshBackup          : $backupPath"
  Write-Host "LocalFreshBackupSHA256    : $($backupHash.Hash)"
  Write-Host 'PublicRowsAppliedInLab    : 9000'
  Write-Host "PostApplyChecks           : $($acceptanceChecks.Count) / $($acceptanceChecks.Count)"
  Write-Host "PostRollbackChecks        : $($rollbackChecks.Count) / $($rollbackChecks.Count)"
  Write-Host 'BaselineRestored          : True'
  Write-Host 'ProductionDatabaseWrite   : False'
  Write-Host 'ProductionRowsWritten     : 0'
  Write-Host 'ProductionApplyAuthorized : False'
  Write-Host "ApplyAuthorizationPhrase  : $ApplyAuthorizationPhrase"
  Write-Host "RollbackAuthorizationPhrase: $RollbackAuthorizationPhrase"
} finally {
  if ($labContainerCreated -and -not $labContainerRemoved) {
    docker rm -f $labContainer 2>$null | Out-Null
    $stageStatus.labContainerRemoved = $true
  }
  if (-not $sourceTempRemoved) {
    docker exec $SourcePostgresContainer rm -f $sourceDumpPath $containerCountsPath 2>$null | Out-Null
    $stageStatus.sourceContainerTempFilesRemoved = $true
  }
  if (-not $labPackageCompleted -or -not $gatePackageCompleted) {
    if (Test-Path -LiteralPath $stageStatusPath -PathType Leaf) { Write-JsonFile $stageStatusPath $stageStatus }
  }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
