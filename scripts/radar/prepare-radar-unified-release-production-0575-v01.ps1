param(
  [Parameter(Mandatory = $true)][string]$ExpectedToolHead,
  [Parameter(Mandatory = $true)][ValidateSet('PREPARE-RADAR-UNIFIED-RELEASE-PRODUCTION-0575-V01')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$EvidenceZip = '.\exports\RADAR-UNIFIED-RELEASE-LAB-0575-20260802-150424.zip',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ExpectedWorks = 35615
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-unified-release-production-0575-v01'
$ApprovedLabMainCommit = '6cdc29e28236f487a6e762a5c8871c681a870810'
$ExpectedResearchHead = '728ad2da5f7d3aba03f652b9fd701157b06793ee'
$ReleaseId = 'RADAR-UNIFIED-RATING-RELEASE-0575-0001'
$ExpectedEvidenceSha256 = '59dc908a447500adb39ef9f72bde306268fdf24ec85fdaaeb418dee0fb9be09f'
$ExpectedManifestSha256 = 'e45673fa881d6b3faea0aab0dbfc00cdee29d7ad536b9ccd5b40dfd01f24317d'
$ExpectedRecordsSha256 = '4dcf9e6790fa7175f18b7c91ed3b2f6522ec6d87c623183f0369491b06123605'
$ExpectedRatingsSha256 = '2847b48eb08c2409c94e0380e6351d778421db13466f17138d2a64b20774eef4'
$ExpectedReleaseIndexSha256 = 'b2363f319233c23c0c9c96a77cb5fec47990b1c9fbf125d847a291baef9835bb'
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')

function Write-JsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, ($json.TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

function Read-MapText([string]$Text) {
  $map = @{}
  foreach ($line in ($Text -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -lt 2) { throw "无法解析 TSV 行：$line" }
    $map[$parts[0]] = ($parts[1..($parts.Count - 1)] -join "`t")
  }
  return $map
}

function Read-MapFile([string]$Path) {
  return Read-MapText ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8))
}

function Assert-MapsEqual([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  if (($expectedKeys -join "`n") -ne ($actualKeys -join "`n")) { throw "$Label 的表集合不一致。" }
  foreach ($key in $expectedKeys) {
    if ([string]$Expected[$key] -ne [string]$Actual[$key]) { throw "$Label 不一致：$key" }
  }
}

function Read-ZipEntryText([System.IO.Compression.ZipArchive]$Archive, [string]$Name) {
  $entry = $Archive.Entries | Where-Object { $_.FullName -eq $Name } | Select-Object -First 1
  if (-not $entry) { throw "证据 ZIP 缺少：$Name" }
  $stream = $entry.Open()
  try {
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true, 4096, $false)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally { $stream.Dispose() }
}

function Invoke-SourceSqlFile(
  [string]$HostFile,
  [string]$ContainerFile,
  [string]$OutputFile,
  [string]$ErrorFile
) {
  & docker cp $HostFile "${SourcePostgresContainer}:$ContainerFile" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "复制只读 SQL 失败：$ContainerFile" }
  & docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 `
    -U $SourceDatabaseUser -d $SourceDatabase -f $ContainerFile `
    1> $OutputFile 2> $ErrorFile
  if ($LASTEXITCODE -ne 0) { throw "执行只读 SQL 失败：$ContainerFile" }
}

if ($Confirm -ne 'PREPARE-RADAR-UNIFIED-RELEASE-PRODUCTION-0575-V01') { throw '确认字符串不匹配。' }
if ($ExpectedToolHead -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedToolHead 格式无效。' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

$unexpected = @(
  git status --short |
    ForEach-Object { if ($_ -and $_.Length -ge 4) { $_.Substring(3).Trim().Replace('\', '/') } } |
    Where-Object { $_ -and $_ -notin $AllowedDirtyFiles }
)
if ($unexpected.Count -gt 0) { throw "网站仓库存在预期外本地修改：$($unexpected -join ', ')" }

git fetch origin
git switch $ExpectedBranch
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新生产预检分支失败。' }
$toolHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($toolHead -ne $ExpectedToolHead -or $remoteHead -ne $ExpectedToolHead) {
  throw "生产预检工具提交不符合预期：local=$toolHead remote=$remoteHead expected=$ExpectedToolHead"
}
& git merge-base --is-ancestor $ApprovedLabMainCommit $toolHead
if ($LASTEXITCODE -ne 0) { throw '生产预检工具不包含已验收并合并的隔离实验提交。' }

$evidencePath = (Resolve-Path -LiteralPath $EvidenceZip).Path
$evidenceHash = (Get-FileHash -LiteralPath $evidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($evidenceHash -ne $ExpectedEvidenceSha256) { throw "隔离证据 ZIP SHA 不匹配：$evidenceHash" }

$archive = [System.IO.Compression.ZipFile]::OpenRead($evidencePath)
try {
  $acceptedReceipt = (Read-ZipEntryText $archive 'import/accepted-receipt.json') | ConvertFrom-Json -Depth 100
  $labAcceptance = (Read-ZipEntryText $archive 'lab-acceptance.json') | ConvertFrom-Json -Depth 100
  $evidenceSourceCounts = Read-MapText (Read-ZipEntryText $archive 'source-table-counts.tsv')
  $evidenceSourceFingerprints = Read-MapText (Read-ZipEntryText $archive 'source-protected-fingerprints.tsv')
} finally { $archive.Dispose() }

if (
  $acceptedReceipt.accepted -ne $true -or
  [string]$acceptedReceipt.websiteCommit -ne '069e2d54055c8c8099ac8f37092e2bdb2b3e060c' -or
  [string]$acceptedReceipt.researchHead -ne $ExpectedResearchHead -or
  [string]$acceptedReceipt.releaseId -ne $ReleaseId -or
  [int]$acceptedReceipt.counts.factCreate -ne 575 -or
  [int]$acceptedReceipt.counts.ratingCreate -ne 575 -or
  [int]$acceptedReceipt.postImport.recordStatusCounts.already_current -ne 575 -or
  [int]$acceptedReceipt.postImport.ratingStatusCounts.already_current -ne 575 -or
  $acceptedReceipt.safety.productionAuthorization -ne $false
) { throw '隔离导入回执不符合已验收的 575 + 575 结果。' }
if (
  $labAcceptance.accepted -ne $true -or
  $labAcceptance.protectedFingerprintsUnchanged -ne $true -or
  $labAcceptance.sourceDatabaseWrite -ne $false -or
  $labAcceptance.productionAuthorization -ne $false
) { throw '隔离实验 acceptance 不符合安全边界。' }

$resolvedResearchRepo = (Resolve-Path -LiteralPath $ResearchRepo).Path
Push-Location $resolvedResearchRepo
try {
  git fetch origin
  git switch main
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw '更新研究仓库失败。' }
  $researchHead = (git rev-parse HEAD).Trim()
  if ($researchHead -ne $ExpectedResearchHead) { throw "研究仓库提交不符合预期：$researchHead" }
} finally { Pop-Location }

$releaseDirectory = Join-Path $resolvedResearchRepo 'releases\public\radar-unified-rating-release-0575-0001\v01'
$releaseFiles = [ordered]@{
  'manifest.json' = $ExpectedManifestSha256
  'records.jsonl' = $ExpectedRecordsSha256
  'ratings.jsonl' = $ExpectedRatingsSha256
  'release-index.jsonl' = $ExpectedReleaseIndexSha256
}
foreach ($entry in $releaseFiles.GetEnumerator()) {
  $file = Join-Path $releaseDirectory $entry.Key
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "统一 Release 缺少文件：$($entry.Key)" }
  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $entry.Value) { throw "统一 Release SHA 不匹配：$($entry.Key)" }
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$sourceRunning = ([string](& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') { throw '源 PostgreSQL 容器未运行。' }

$sourceGate = ([string](& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 `
  -U $SourceDatabaseUser -d $SourceDatabase `
  -c "SELECT concat_ws(E'\t', count(*)::text, COALESCE(to_regclass('public.radar_public_records')::text, ''), COALESCE(to_regclass('public.radar_public_ratings')::text, '')) FROM public.works;")).TrimEnd([char[]]@("`r", "`n"))
if ($LASTEXITCODE -ne 0) { throw '读取源数据库边界失败。' }
$gateParts = $sourceGate.Split([char[]]@("`t"), [System.StringSplitOptions]::None)
if ($gateParts.Count -ne 3 -or $gateParts[0] -ne [string]$ExpectedWorks) { throw "源 Works 数量不符合预期：$sourceGate" }
if ($gateParts[1] -or $gateParts[2]) { throw "源库已存在统一 Release 投影表，fresh 生产候选失效：$sourceGate" }

$migrationRows = @(& docker exec $SourcePostgresContainer psql -X -qAt -v ON_ERROR_STOP=1 `
  -U $SourceDatabaseUser -d $SourceDatabase `
  -c "SELECT name || E'\t' || batch::text FROM public.payload_migrations ORDER BY name, batch;")
if ($LASTEXITCODE -ne 0) { throw '读取源数据库 migration 状态失败。' }
$expectedMigrationRows = @(
  "20260718_072813_existing_schema_baseline_v01`t1",
  "20260718_072843_stewardship_notices_v01`t1",
  "dev`t-1"
)
if ((@($migrationRows | Where-Object { $_ }) -join "`n") -ne ($expectedMigrationRows -join "`n")) {
  throw "源数据库 migration 状态不符合 fresh 生产前提：$($migrationRows -join ', ')"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outRoot = Join-Path $repoRoot 'data_local\outputs\radar-unified-release-production-0575-v01'
$outDir = Join-Path $outRoot "production-preflight-$stamp"
$backupDir = Join-Path $repoRoot 'data_local\backups\radar-unified-release-production-0575-v01'
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
Invoke-SourceSqlFile $countSql '/tmp/radar-production-counts.sql' $sourceCounts (Join-Path $outDir 'source-counts-stderr.txt')
Invoke-SourceSqlFile $fingerprintSql '/tmp/radar-production-fingerprints.sql' $sourceFingerprints (Join-Path $outDir 'source-fingerprints-stderr.txt')
Assert-MapsEqual $evidenceSourceCounts (Read-MapFile $sourceCounts) '当前源库与已验收实验源库行数'
Assert-MapsEqual $evidenceSourceFingerprints (Read-MapFile $sourceFingerprints) '当前源库与已验收实验源库保护指纹'

$backupPath = Join-Path $backupDir "source-before-radar-unified-release-$stamp.dump"
$containerBackup = "/tmp/radar-unified-production-$stamp.dump"
& docker exec $SourcePostgresContainer pg_dump -Fc --no-owner --no-privileges `
  -U $SourceDatabaseUser -d $SourceDatabase -f $containerBackup
if ($LASTEXITCODE -ne 0) { throw '创建生产前源数据库备份失败。' }
try {
  & docker cp "${SourcePostgresContainer}:$containerBackup" $backupPath | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { throw '复制生产前备份失败。' }
} finally {
  & docker exec $SourcePostgresContainer rm -f $containerBackup 2>$null | Out-Null
}
if ((Get-Item -LiteralPath $backupPath).Length -le 0) { throw '生产前备份为空。' }
$backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()

$sourcePostCounts = Join-Path $outDir 'source-post-backup-table-counts.tsv'
$sourcePostFingerprints = Join-Path $outDir 'source-post-backup-protected-fingerprints.tsv'
Invoke-SourceSqlFile $countSql '/tmp/radar-production-post-counts.sql' $sourcePostCounts (Join-Path $outDir 'source-post-counts-stderr.txt')
Invoke-SourceSqlFile $fingerprintSql '/tmp/radar-production-post-fingerprints.sql' $sourcePostFingerprints (Join-Path $outDir 'source-post-fingerprints-stderr.txt')
Assert-MapsEqual (Read-MapFile $sourceCounts) (Read-MapFile $sourcePostCounts) '备份前后源库行数'
Assert-MapsEqual (Read-MapFile $sourceFingerprints) (Read-MapFile $sourcePostFingerprints) '备份前后源库保护指纹'

$candidatePath = Join-Path $outDir 'radar-unified-release-production-candidate-0575-v01.json'
Write-JsonFile $candidatePath ([ordered]@{
  schemaVersion = 'radar-unified-release-production-candidate-0575-v01'
  createdAt = [DateTime]::UtcNow.ToString('o')
  toolHead = $toolHead
  approvedLabMainCommit = $ApprovedLabMainCommit
  researchHead = $ExpectedResearchHead
  releaseId = $ReleaseId
  evidenceZip = $evidencePath
  evidenceSha256 = $evidenceHash
  releaseDirectory = $releaseDirectory
  releaseManifestSha256 = $ExpectedManifestSha256
  releaseRecordsSha256 = $ExpectedRecordsSha256
  releaseRatingsSha256 = $ExpectedRatingsSha256
  releaseIndexSha256 = $ExpectedReleaseIndexSha256
  sourceContainer = $SourcePostgresContainer
  sourceDatabase = $SourceDatabase
  sourceDatabaseUser = $SourceDatabaseUser
  expectedWorks = $ExpectedWorks
  sourceMigrationRows = $expectedMigrationRows
  sourceCountsPath = $sourceCounts
  sourceCountsSha256 = (Get-FileHash -LiteralPath $sourceCounts -Algorithm SHA256).Hash.ToLowerInvariant()
  sourceFingerprintsPath = $sourceFingerprints
  sourceFingerprintsSha256 = (Get-FileHash -LiteralPath $sourceFingerprints -Algorithm SHA256).Hash.ToLowerInvariant()
  backupPath = $backupPath
  backupBytes = [long](Get-Item -LiteralPath $backupPath).Length
  backupSha256 = $backupHash
  backupCreated = $true
  sourceDatabaseWrite = $false
  migrationApplied = $false
  publicRecordsWritten = 0
  publicRatingsWritten = 0
  productionAuthorization = $false
  accepted = $true
  decision = 'accept_read_only_production_candidate_preflight_0575_v01'
})

Write-Host ''
Write-Host '统一 Release 生产候选只读预检通过。' -ForegroundColor Green
Write-Host "ToolHead              : $toolHead"
Write-Host "ApprovedLabMainCommit : $ApprovedLabMainCommit"
Write-Host "ResearchHead          : $ExpectedResearchHead"
Write-Host "ReleaseId             : $ReleaseId"
Write-Host "EvidenceSHA256        : $evidenceHash"
Write-Host "BackupPath            : $backupPath"
Write-Host "BackupSHA256          : $backupHash"
Write-Host "Candidate             : $candidatePath"
Write-Host 'SourceDatabaseWrite   : False'
Write-Host 'MigrationApplied      : False'
Write-Host 'PublicRecordsWritten  : 0'
Write-Host 'PublicRatingsWritten  : 0'
Write-Host 'ProductionAuthorization: False'
