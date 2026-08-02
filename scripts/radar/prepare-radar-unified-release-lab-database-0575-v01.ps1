param(
  [Parameter(Mandatory = $true)][string]$ExpectedWebsiteHead,
  [Parameter(Mandatory = $true)][ValidateSet('PREPARE-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$ExpectedResearchHead = '728ad2da5f7d3aba03f652b9fd701157b06793ee',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ExpectedWorks = 35615,
  [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-unified-release-lab-0575-v01'
$ReleaseId = 'RADAR-UNIFIED-RATING-RELEASE-0575-0001'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-JsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, ($json.TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

function Get-FreePort([int]$Minimum, [int]$Maximum) {
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    $port = Get-Random -Minimum $Minimum -Maximum ($Maximum + 1)
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try { $listener.Start(); return $port } catch { continue } finally { try { $listener.Stop() } catch {} }
  }
  throw '找不到空闲的 loopback 实验端口。'
}

function Read-Map([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -lt 2) { throw "无法解析：$line" }
    $map[$parts[0]] = ($parts[1..($parts.Count - 1)] -join "`t")
  }
  return $map
}

function Assert-MapsEqual([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  if (($expectedKeys -join "`n") -ne ($actualKeys -join "`n")) { throw "$Label 的表集合不一致。" }
  foreach ($key in $expectedKeys) {
    if ([string]$Expected[$key] -ne [string]$Actual[$key]) { throw "$Label 不一致：$key" }
  }
}

function Invoke-SqlFile(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$HostFile,
  [string]$ContainerFile,
  [string]$OutputFile,
  [string]$ErrorFile
) {
  & docker cp $HostFile "${Container}:$ContainerFile" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "复制 SQL 失败：$ContainerFile" }
  $arguments = @('exec')
  if ($Password) { $arguments += @('-e', "PGPASSWORD=$Password") }
  $arguments += @($Container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', $User, '-d', $Database, '-f', $ContainerFile)
  & docker @arguments 1> $OutputFile 2> $ErrorFile
  if ($LASTEXITCODE -ne 0) { throw "执行 SQL 失败：$ContainerFile" }
}

function Assert-Release([string]$ResearchRoot) {
  $lockPath = Join-Path $repoRoot 'config\radar-unified-rating-release-0575-v01.lock.json'
  $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if ([string]$lock.releaseId -ne $ReleaseId) { throw '网站 Release lock ID 不匹配。' }
  if ([string]$lock.researchCommitSha -ne $ExpectedResearchHead) { throw '网站 Release lock 研究提交不匹配。' }
  if ($lock.productionAuthorization -ne $false) { throw '网站 Release lock 意外授权生产。' }

  $directory = Join-Path $ResearchRoot 'releases\public\radar-unified-rating-release-0575-0001\v01'
  $files = [ordered]@{
    'manifest.json' = [string]$lock.manifestSha256
    'records.jsonl' = [string]$lock.recordsSha256
    'ratings.jsonl' = [string]$lock.ratingsSha256
    'release-index.jsonl' = [string]$lock.releaseIndexSha256
  }
  foreach ($entry in $files.GetEnumerator()) {
    $file = Join-Path $directory $entry.Key
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "统一 Release 缺少文件：$($entry.Key)" }
    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.Value) { throw "统一 Release SHA 不匹配：$($entry.Key)" }
  }
  $manifest = Get-Content -LiteralPath (Join-Path $directory 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if (
    [string]$manifest.releaseId -ne $ReleaseId -or
    [int]$manifest.counts.records -ne 575 -or
    [int]$manifest.counts.ratings -ne 575 -or
    $manifest.gates.productionAuthorization -ne $false
  ) { throw '统一 Release manifest 不符合 575 条封闭包。' }
  return [pscustomobject]@{ Directory = $directory; Lock = $lock; Manifest = $manifest }
}

if ($Confirm -ne 'PREPARE-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01') { throw '确认字符串不匹配。' }

$unexpected = @(
  git status --short |
    ForEach-Object { if ($_ -and $_.Length -ge 4) { $_.Substring(3).Trim().Replace('\', '/') } } |
    Where-Object { $_ -and $_ -notin @('next-env.d.ts', 'payload-types.ts') }
)
if ($unexpected.Count -gt 0) { throw "网站仓库存在预期外本地修改：$($unexpected -join ', ')" }

git fetch origin
git switch $ExpectedBranch
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新网站实验室分支失败。' }
$websiteHead = (git rev-parse HEAD).Trim()
$websiteRemoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($websiteHead -ne $ExpectedWebsiteHead -or $websiteRemoteHead -ne $ExpectedWebsiteHead) {
  throw "网站提交不符合预期：local=$websiteHead remote=$websiteRemoteHead"
}

$resolvedResearchRepo = (Resolve-Path $ResearchRepo).Path
Push-Location $resolvedResearchRepo
try {
  git fetch origin
  git switch main
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw '更新研究仓库失败。' }
  $researchHead = (git rev-parse HEAD).Trim()
  if ($researchHead -ne $ExpectedResearchHead) { throw "研究提交不符合预期：$researchHead" }
} finally { Pop-Location }
$release = Assert-Release $resolvedResearchRepo

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$sourceRunning = ([string](& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') { throw '源 PostgreSQL 容器未运行。' }
$postgresImage = ([string](& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresImage)) { throw '无法读取源 PostgreSQL 镜像。' }

$sourceGate = ([string](& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 `
  -U $SourceDatabaseUser -d $SourceDatabase `
  -c "SELECT concat_ws(E'\t', count(*)::text, COALESCE(to_regclass('public.radar_public_records')::text, ''), COALESCE(to_regclass('public.radar_public_ratings')::text, '')) FROM public.works;")).TrimEnd([char[]]@("`r", "`n"))
if ($LASTEXITCODE -ne 0) { throw '读取源数据库边界失败。' }
$gateParts = $sourceGate.Split([char[]]@("`t"), [System.StringSplitOptions]::None)
if ($gateParts.Count -ne 3 -or $gateParts[0] -ne [string]$ExpectedWorks) { throw "源 Works 数量不符合预期：$sourceGate" }
if ($gateParts[1] -or $gateParts[2]) { throw "源库已存在统一 Release 表，fresh 演练输入失效：$sourceGate" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outRoot = Join-Path $repoRoot 'data_local\outputs\radar-unified-release-lab-0575-v01'
$outDir = Join-Path $outRoot "lab-database-$stamp"
$backupDir = Join-Path $repoRoot 'data_local\backups\radar-unified-release-lab-0575-v01'
New-Item -ItemType Directory -Path $outDir, $backupDir -Force | Out-Null
$countSql = Join-Path $outDir 'table-counts.sql'
$fingerprintSql = Join-Path $outDir 'protected-fingerprints.sql'
$countSqlContent = @'
\pset tuples_only on
\pset format unaligned
SELECT format('SELECT %L || E''\t'' || count(*)::text FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
'@
$fingerprintSqlContent = @'
\pset tuples_only on
\pset format unaligned
SELECT format('SELECT %L || E''\t'' || count(*)::text || E''\t'' || COALESCE(md5(string_agg(row_hash, '''' ORDER BY row_hash)), md5('''')) FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM %I.%I AS t) AS rows;', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname = 'public'
  AND (tablename IN ('works', '_works_v') OR tablename LIKE 'radar_public%' OR tablename LIKE 'radar_research_records%')
  AND tablename NOT LIKE 'radar_public_records%'
  AND tablename NOT LIKE 'radar_public_ratings%'
ORDER BY tablename
\gexec
'@
[System.IO.File]::WriteAllText($countSql, $countSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($fingerprintSql, $fingerprintSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))

$sourceCounts = Join-Path $outDir 'source-table-counts.tsv'
$sourceFingerprints = Join-Path $outDir 'source-protected-fingerprints.tsv'
Invoke-SqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $countSql '/tmp/radar-unified-counts.sql' $sourceCounts (Join-Path $outDir 'source-counts-stderr.txt')
Invoke-SqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $fingerprintSql '/tmp/radar-unified-fingerprints.sql' $sourceFingerprints (Join-Path $outDir 'source-fingerprints-stderr.txt')

$backupPath = Join-Path $backupDir "source-$stamp.dump"
$sourceDump = "/tmp/radar-unified-release-$stamp.dump"
$labContainer = "baihepailei-radar-unified-release-lab-$stamp"
$labDatabase = 'radar_unified_release_lab'
$labUser = 'radar_lab'
$labPassword = [Guid]::NewGuid().ToString('N')
$dbPort = Get-FreePort 31000 31999
$containerStarted = $false
$environmentPath = Join-Path $outDir 'radar-unified-release-lab-environment-0575-v01.json'

try {
  & docker exec $SourcePostgresContainer pg_dump -Fc --no-owner --no-privileges -U $SourceDatabaseUser -d $SourceDatabase -f $sourceDump
  if ($LASTEXITCODE -ne 0) { throw '创建源数据库只读 dump 失败。' }
  & docker cp "${SourcePostgresContainer}:$sourceDump" $backupPath | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { throw '复制源数据库 dump 失败。' }
  if ((Get-Item -LiteralPath $backupPath).Length -le 0) { throw '源数据库 dump 为空。' }
  $backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()

  & docker run -d --name $labContainer -e "POSTGRES_USER=$labUser" -e "POSTGRES_PASSWORD=$labPassword" -e "POSTGRES_DB=$labDatabase" -p "127.0.0.1:${dbPort}:5432" $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '启动临时 PostgreSQL 失败。' }
  $containerStarted = $true
  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  do {
    & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_isready -U $labUser -d $labDatabase | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($LASTEXITCODE -ne 0) { throw '临时 PostgreSQL 未就绪。' }

  & docker cp $backupPath "${labContainer}:/tmp/source.dump" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 dump 到临时 PostgreSQL 失败。' }
  & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_restore --no-owner --no-privileges -U $labUser -d $labDatabase /tmp/source.dump `
    1> (Join-Path $outDir 'restore-stdout.txt') 2> (Join-Path $outDir 'restore-stderr.txt')
  if ($LASTEXITCODE -ne 0) { throw '恢复临时 PostgreSQL 失败。' }

  $labCounts = Join-Path $outDir 'lab-restored-table-counts.tsv'
  $labFingerprints = Join-Path $outDir 'lab-restored-protected-fingerprints.tsv'
  Invoke-SqlFile $labContainer $labDatabase $labUser $labPassword $countSql '/tmp/counts.sql' $labCounts (Join-Path $outDir 'lab-counts-stderr.txt')
  Invoke-SqlFile $labContainer $labDatabase $labUser $labPassword $fingerprintSql '/tmp/fingerprints.sql' $labFingerprints (Join-Path $outDir 'lab-fingerprints-stderr.txt')
  Assert-MapsEqual (Read-Map $sourceCounts) (Read-Map $labCounts) '源库与隔离 restore 行数'
  Assert-MapsEqual (Read-Map $sourceFingerprints) (Read-Map $labFingerprints) '源库与隔离 restore 指纹'

  $sourcePostCounts = Join-Path $outDir 'source-post-table-counts.tsv'
  $sourcePostFingerprints = Join-Path $outDir 'source-post-protected-fingerprints.tsv'
  Invoke-SqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $countSql '/tmp/radar-unified-counts-post.sql' $sourcePostCounts (Join-Path $outDir 'source-post-counts-stderr.txt')
  Invoke-SqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $fingerprintSql '/tmp/radar-unified-fingerprints-post.sql' $sourcePostFingerprints (Join-Path $outDir 'source-post-fingerprints-stderr.txt')
  Assert-MapsEqual (Read-Map $sourceCounts) (Read-Map $sourcePostCounts) '源数据库准备前后行数'
  Assert-MapsEqual (Read-Map $sourceFingerprints) (Read-Map $sourcePostFingerprints) '源数据库准备前后指纹'

  Write-JsonFile $environmentPath ([ordered]@{
    schemaVersion = 'radar-unified-release-lab-environment-0575-v01'
    createdAt = [DateTime]::UtcNow.ToString('o')
    websiteCommit = $ExpectedWebsiteHead
    researchHead = $ExpectedResearchHead
    releaseId = $ReleaseId
    researchRepo = $resolvedResearchRepo
    releaseDirectory = $release.Directory
    sourceContainer = $SourcePostgresContainer
    sourceDatabase = $SourceDatabase
    sourceDatabaseWrite = $false
    sourcePostcheckPassed = $true
    sourceTableCounts = $sourceCounts
    sourceProtectedFingerprints = $sourceFingerprints
    sourcePostTableCounts = $sourcePostCounts
    sourcePostProtectedFingerprints = $sourcePostFingerprints
    backupPath = $backupPath
    backupSha256 = $backupHash
    labContainer = $labContainer
    labDatabase = $labDatabase
    labUser = $labUser
    labPassword = $labPassword
    labPort = $dbPort
    databaseUrl = "postgresql://${labUser}:${labPassword}@127.0.0.1:${dbPort}/${labDatabase}"
    labRestoredTableCounts = $labCounts
    labRestoredProtectedFingerprints = $labFingerprints
    isolatedRestorePassed = $true
    migrationApplied = $false
    publicRecordsWritten = 0
    publicRatingsWritten = 0
    productionAuthorization = $false
  })

  Write-Host ''
  Write-Host '统一 Release 隔离数据库准备完成。' -ForegroundColor Green
  Write-Host "EnvironmentFile : $environmentPath"
  Write-Host "BackupSha256    : $backupHash"
  Write-Host "LabContainer    : $labContainer"
  Write-Host "LabPort         : $dbPort"
  Write-Host 'SourceDatabaseWrite : False'
  Write-Host 'MigrationApplied    : False'
  Write-Host 'PublicRecordsWritten: 0'
  Write-Host 'PublicRatingsWritten: 0'
} catch {
  if ($containerStarted) { & docker rm -f $labContainer 2>$null | Out-Null }
  Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $environmentPath -Force -ErrorAction SilentlyContinue
  throw
} finally {
  & docker exec $SourcePostgresContainer rm -f $sourceDump 2>$null | Out-Null
}
