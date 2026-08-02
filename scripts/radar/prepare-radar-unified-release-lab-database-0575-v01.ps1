param(
  [Parameter(Mandatory = $true)][string]$ExpectedWebsiteHead,
  [Parameter(Mandatory = $true)][ValidateSet('PREPARE-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$ExpectedResearchHead = '6ee4051effa95e19370bb0a2f26500293177212a',
  [string]$ExpectedReleaseSourceCommit = '1555eb3e66cd2f8bb7d5048db1afab969ff819dd',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ExpectedWorks = 35615,
  [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-release-lab-v01'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-JsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, ($json.TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

function Get-FreePort([int]$Minimum, [int]$Maximum) {
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
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
  $args = @('exec')
  if ($Password) { $args += @('-e', "PGPASSWORD=$Password") }
  $args += @($Container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', $User, '-d', $Database, '-f', $ContainerFile)
  & docker @args 1> $OutputFile 2> $ErrorFile
  if ($LASTEXITCODE -ne 0) { throw "执行 SQL 失败：$ContainerFile" }
}

if ($Confirm -ne 'PREPARE-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01') { throw '确认字符串不匹配。' }

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

$releaseDirectory = Join-Path $resolvedResearchRepo 'releases\public\radar-public-release-0001\v01'
$releaseManifestPath = Join-Path $releaseDirectory 'manifest.json'
if (-not (Test-Path -LiteralPath $releaseManifestPath -PathType Leaf)) { throw 'Public Release manifest 不存在。' }
$releaseManifest = Get-Content -LiteralPath $releaseManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$releaseSourceCommit = [string]$releaseManifest.source.commitSha
if ($releaseSourceCommit -ne $ExpectedReleaseSourceCommit) {
  throw "Public Release 来源提交不符合预期：$releaseSourceCommit"
}
if ([int]$releaseManifest.files.records.rowCount -ne 520) { throw 'Public Release manifest 不是 520 条。' }

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$sourceRunning = ([string](& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') { throw '源 PostgreSQL 容器未运行。' }
$postgresImage = ([string](& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresImage)) { throw '无法读取源 PostgreSQL 镜像。' }
$recordsTable = ([string](& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -c "SELECT COALESCE(to_regclass('public.radar_public_records')::text, '');")).Trim()
if ($LASTEXITCODE -ne 0 -or $recordsTable) { throw '源数据库已经存在 radar_public_records，首次演练输入失效。' }
$works = ([string](& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -c 'SELECT count(*) FROM public.works;')).Trim()
if ($works -ne [string]$ExpectedWorks) { throw "源 Works 数量不符合预期：$works" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "data_local\outputs\radar-public-release-v01\lab-database-$stamp"
$backupDir = Join-Path $repoRoot 'data_local\backups\radar-public-release-lab-v01'
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
ORDER BY tablename
\gexec
'@
[System.IO.File]::WriteAllText($countSql, $countSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($fingerprintSql, $fingerprintSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))

$sourceCounts = Join-Path $outDir 'source-table-counts.tsv'
$sourceFingerprints = Join-Path $outDir 'source-protected-fingerprints.tsv'
Invoke-SqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $countSql '/tmp/radar-public-release-counts.sql' $sourceCounts (Join-Path $outDir 'source-counts-stderr.txt')
Invoke-SqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $fingerprintSql '/tmp/radar-public-release-fingerprints.sql' $sourceFingerprints (Join-Path $outDir 'source-fingerprints-stderr.txt')

$backupPath = Join-Path $backupDir "source-$stamp.dump"
$sourceDump = "/tmp/radar-public-release-$stamp.dump"
$labContainer = "baihepailei-radar-public-release-lab-$stamp"
$labDatabase = 'radar_public_release_lab'
$labUser = 'radar_lab'
$labPassword = [Guid]::NewGuid().ToString('N')
$dbPort = Get-FreePort 31000 31999
$containerStarted = $false
$environmentPath = Join-Path $outDir 'radar-public-release-lab-environment-v01.json'

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
  & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_restore --no-owner --no-privileges -U $labUser -d $labDatabase /tmp/source.dump 1> (Join-Path $outDir 'restore-stdout.txt') 2> (Join-Path $outDir 'restore-stderr.txt')
  if ($LASTEXITCODE -ne 0) { throw '恢复临时 PostgreSQL 失败。' }

  $labCounts = Join-Path $outDir 'lab-restored-table-counts.tsv'
  $labFingerprints = Join-Path $outDir 'lab-restored-protected-fingerprints.tsv'
  Invoke-SqlFile $labContainer $labDatabase $labUser $labPassword $countSql '/tmp/counts.sql' $labCounts (Join-Path $outDir 'lab-counts-stderr.txt')
  Invoke-SqlFile $labContainer $labDatabase $labUser $labPassword $fingerprintSql '/tmp/fingerprints.sql' $labFingerprints (Join-Path $outDir 'lab-fingerprints-stderr.txt')
  Assert-MapsEqual (Read-Map $sourceCounts) (Read-Map $labCounts) '源库与隔离 restore 行数'
  Assert-MapsEqual (Read-Map $sourceFingerprints) (Read-Map $labFingerprints) '源库与隔离 restore 指纹'

  $sourcePostCounts = Join-Path $outDir 'source-post-table-counts.tsv'
  $sourcePostFingerprints = Join-Path $outDir 'source-post-protected-fingerprints.tsv'
  Invoke-SqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $countSql '/tmp/radar-public-release-counts-post.sql' $sourcePostCounts (Join-Path $outDir 'source-post-counts-stderr.txt')
  Invoke-SqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $fingerprintSql '/tmp/radar-public-release-fingerprints-post.sql' $sourcePostFingerprints (Join-Path $outDir 'source-post-fingerprints-stderr.txt')
  Assert-MapsEqual (Read-Map $sourceCounts) (Read-Map $sourcePostCounts) '源数据库准备前后行数'
  Assert-MapsEqual (Read-Map $sourceFingerprints) (Read-Map $sourcePostFingerprints) '源数据库准备前后指纹'

  Write-JsonFile $environmentPath ([ordered]@{
    schemaVersion = 'radar-public-release-lab-environment-v01'
    createdAt = [DateTime]::UtcNow.ToString('o')
    websiteCommit = $ExpectedWebsiteHead
    researchHead = $ExpectedResearchHead
    releaseSourceCommit = $releaseSourceCommit
    researchRepo = $resolvedResearchRepo
    releaseDirectory = $releaseDirectory
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
    restoredTableCounts = $labCounts
    restoredProtectedFingerprints = $labFingerprints
    isolatedRestorePassed = $true
    migrationApplied = $false
    publicRecordsWritten = 0
  })

  & docker exec $SourcePostgresContainer rm -f $sourceDump '/tmp/radar-public-release-counts.sql' '/tmp/radar-public-release-fingerprints.sql' '/tmp/radar-public-release-counts-post.sql' '/tmp/radar-public-release-fingerprints-post.sql' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '清理源容器临时文件失败。' }

  Write-Host ''
  Write-Host '隔离数据库已从 fresh 只读 dump 恢复，并通过源库前后不变与克隆一致性核对。' -ForegroundColor Green
  Write-Host "Environment        : $environmentPath"
  Write-Host "ResearchHead       : $ExpectedResearchHead"
  Write-Host "ReleaseSourceCommit: $releaseSourceCommit"
  Write-Host "LabContainer       : $labContainer"
  Write-Host "LabPort            : $dbPort"
  Write-Host 'SourceWrite        : False'
  Write-Host 'Migration          : False'
  Write-Host 'ImportRows         : 0'
} catch {
  if ($containerStarted) { & docker rm -f $labContainer 2>$null | Out-Null }
  Remove-Item -LiteralPath $backupPath, $environmentPath -Force -ErrorAction SilentlyContinue
  & docker exec $SourcePostgresContainer rm -f $sourceDump '/tmp/radar-public-release-counts.sql' '/tmp/radar-public-release-fingerprints.sql' '/tmp/radar-public-release-counts-post.sql' '/tmp/radar-public-release-fingerprints-post.sql' 2>$null | Out-Null
  throw
}
