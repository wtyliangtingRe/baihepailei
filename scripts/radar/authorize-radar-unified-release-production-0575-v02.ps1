param(
  [Parameter(Mandatory = $true)][string]$Candidate,
  [Parameter(Mandatory = $true)][string]$ExpectedMainHead,
  [Parameter(Mandatory = $true)][ValidateSet('AUTHORIZE-RADAR-UNIFIED-RELEASE-PRODUCTION-0575-V02')][string]$Confirm,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ReleaseId = 'RADAR-UNIFIED-RATING-RELEASE-0575-0001'
$ExpectedCandidateSha256 = '0b18c33987abe2c2eb0c2280acee789415396903d697aface2523312a334de31'
$ExpectedCandidateToolHead = '904cf47294bf71adc37e6e598964faa065a135df'
$ExpectedApprovedLabMainCommit = '6cdc29e28236f487a6e762a5c8871c681a870810'
$ExpectedResearchHead = '728ad2da5f7d3aba03f652b9fd701157b06793ee'
$ExpectedEvidenceSha256 = '59dc908a447500adb39ef9f72bde306268fdf24ec85fdaaeb418dee0fb9be09f'
$ExpectedManifestSha256 = 'e45673fa881d6b3faea0aab0dbfc00cdee29d7ad536b9ccd5b40dfd01f24317d'
$ExpectedRecordsSha256 = '4dcf9e6790fa7175f18b7c91ed3b2f6522ec6d87c623183f0369491b06123605'
$ExpectedRatingsSha256 = '2847b48eb08c2409c94e0380e6351d778421db13466f17138d2a64b20774eef4'
$ExpectedReleaseIndexSha256 = 'b2363f319233c23c0c9c96a77cb5fec47990b1c9fbf125d847a291baef9835bb'
$ExpectedBackupBytes = 29729702
$ExpectedBackupSha256 = 'ea0b1cb68c9f1fde91e5e9f10c12957469b30c37a29097c57cb18fa8b5b13751'
$ExpectedMigrationRows = @(
  "20260718_072813_existing_schema_baseline_v01`t1",
  "20260718_072843_stewardship_notices_v01`t1",
  "dev`t-1"
)
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$CriticalCodeFiles = @(
  '.github/workflows/validate-radar-unified-release-production-0575-v01.yml',
  'docs/guides/radar-unified-release-production-0575-v01.md',
  'scripts/radar/prepare-radar-unified-release-production-0575-v01.ps1',
  'scripts/radar/authorize-radar-unified-release-production-0575-v02.ps1',
  'scripts/radar/execute-radar-unified-release-production-0575-v01.ps1',
  'scripts/radar/run-unified-release-production-import-0575-v01.mjs',
  'scripts/radar/lib/radar-unified-release-production-0575-v01.ps1',
  'src/app/(payload)/api/radar-unified-release-production-marker/route.ts',
  'tests/radar-unified-release-production-0575-v01.test.mjs',
  'tests/radar-unified-release-production-import-0575-v01.test.mjs'
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
. (Join-Path $PSScriptRoot 'lib\radar-unified-release-production-0575-v01.ps1')

function Invoke-AuthorizationReadOnlySql(
  [string]$HostFile,
  [string]$ContainerFile,
  [string]$OutputFile,
  [string]$ErrorFile
) {
  Invoke-RadarSqlFile $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' `
    $HostFile $ContainerFile $OutputFile $ErrorFile -ReadOnly
}

if ($Confirm -ne 'AUTHORIZE-RADAR-UNIFIED-RELEASE-PRODUCTION-0575-V02') { throw '授权确认字符串不匹配。' }
if ($ExpectedMainHead -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedMainHead 格式无效。' }
$unexpectedDirty = @(Get-RadarDirtyPaths | Where-Object { $_ -notin $AllowedDirtyFiles })
if ($unexpectedDirty.Count -gt 0) { throw "存在预期外本地修改：$($unexpectedDirty -join ', ')" }

git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端状态失败。' }
$currentBranch = (git branch --show-current).Trim()
$currentHead = (git rev-parse HEAD).Trim()
$remoteMain = (git rev-parse origin/main).Trim()
if ($currentBranch -ne 'main' -or $currentHead -ne $ExpectedMainHead -or $remoteMain -ne $ExpectedMainHead) {
  throw "授权只允许精确 main：branch=$currentBranch local=$currentHead remote=$remoteMain"
}

$candidatePath = (Resolve-Path -LiteralPath $Candidate).Path
$candidateHash = Assert-RadarFileHash $candidatePath $ExpectedCandidateSha256 'production candidate'
$candidateJson = Get-Content -LiteralPath $candidatePath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if (
  [string]$candidateJson.schemaVersion -ne 'radar-unified-release-production-candidate-0575-v01' -or
  [string]$candidateJson.toolHead -ne $ExpectedCandidateToolHead -or
  [string]$candidateJson.approvedLabMainCommit -ne $ExpectedApprovedLabMainCommit -or
  [string]$candidateJson.researchHead -ne $ExpectedResearchHead -or
  [string]$candidateJson.releaseId -ne $ReleaseId -or
  [string]$candidateJson.evidenceSha256 -ne $ExpectedEvidenceSha256 -or
  [string]$candidateJson.releaseManifestSha256 -ne $ExpectedManifestSha256 -or
  [string]$candidateJson.releaseRecordsSha256 -ne $ExpectedRecordsSha256 -or
  [string]$candidateJson.releaseRatingsSha256 -ne $ExpectedRatingsSha256 -or
  [string]$candidateJson.releaseIndexSha256 -ne $ExpectedReleaseIndexSha256 -or
  [long]$candidateJson.backupBytes -ne $ExpectedBackupBytes -or
  [string]$candidateJson.backupSha256 -ne $ExpectedBackupSha256 -or
  $candidateJson.backupCreated -ne $true -or
  $candidateJson.sourceDatabaseWrite -ne $false -or
  $candidateJson.migrationApplied -ne $false -or
  [int]$candidateJson.publicRecordsWritten -ne 0 -or
  [int]$candidateJson.publicRatingsWritten -ne 0 -or
  $candidateJson.productionAuthorization -ne $false -or
  $candidateJson.accepted -ne $true
) { throw 'production candidate 字段不符合已验收绑定。' }
if ((@($candidateJson.sourceMigrationRows) -join "`n") -ne ($ExpectedMigrationRows -join "`n")) {
  throw 'candidate migration 起始状态不匹配。'
}

$evidencePath = (Resolve-Path -LiteralPath ([string]$candidateJson.evidenceZip)).Path
Assert-RadarFileHash $evidencePath $ExpectedEvidenceSha256 '隔离证据 ZIP' | Out-Null
$releaseDirectory = (Resolve-Path -LiteralPath ([string]$candidateJson.releaseDirectory)).Path
Assert-RadarFileHash (Join-Path $releaseDirectory 'manifest.json') $ExpectedManifestSha256 'Release manifest' | Out-Null
Assert-RadarFileHash (Join-Path $releaseDirectory 'records.jsonl') $ExpectedRecordsSha256 'Release records' | Out-Null
Assert-RadarFileHash (Join-Path $releaseDirectory 'ratings.jsonl') $ExpectedRatingsSha256 'Release ratings' | Out-Null
Assert-RadarFileHash (Join-Path $releaseDirectory 'release-index.jsonl') $ExpectedReleaseIndexSha256 'Release index' | Out-Null

$backupPath = (Resolve-Path -LiteralPath ([string]$candidateJson.backupPath)).Path
$backupItem = Get-Item -LiteralPath $backupPath
if ([long]$backupItem.Length -ne $ExpectedBackupBytes) { throw 'P1 backup 大小发生变化。' }
Assert-RadarFileHash $backupPath $ExpectedBackupSha256 'P1 backup' | Out-Null
$sourceCountsPath = (Resolve-Path -LiteralPath ([string]$candidateJson.sourceCountsPath)).Path
$sourceFingerprintsPath = (Resolve-Path -LiteralPath ([string]$candidateJson.sourceFingerprintsPath)).Path
Assert-RadarFileHash $sourceCountsPath ([string]$candidateJson.sourceCountsSha256) 'candidate source counts' | Out-Null
Assert-RadarFileHash $sourceFingerprintsPath ([string]$candidateJson.sourceFingerprintsSha256) 'candidate source fingerprints' | Out-Null

$candidateDirectory = Split-Path -Parent $candidatePath
$tableCountsSql = Join-Path $candidateDirectory 'table-counts.sql'
$protectedFingerprintsSql = Join-Path $candidateDirectory 'protected-fingerprints.sql'
if (-not (Test-Path -LiteralPath $tableCountsSql -PathType Leaf)) { throw '缺少 candidate table-counts.sql。' }
if (-not (Test-Path -LiteralPath $protectedFingerprintsSql -PathType Leaf)) { throw '缺少 candidate protected-fingerprints.sql。' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-release-production-0575-v01\authorization-$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$currentCountsPath = Join-Path $outDir 'authorization-source-table-counts.tsv'
$currentFingerprintsPath = Join-Path $outDir 'authorization-source-protected-fingerprints.tsv'
Invoke-AuthorizationReadOnlySql $tableCountsSql '/tmp/radar-production-authorization-counts.sql' $currentCountsPath (Join-Path $outDir 'authorization-counts-stderr.txt')
Invoke-AuthorizationReadOnlySql $protectedFingerprintsSql '/tmp/radar-production-authorization-fingerprints.sql' $currentFingerprintsPath (Join-Path $outDir 'authorization-fingerprints-stderr.txt')
Assert-RadarMapsEqual (Read-RadarMapFile $sourceCountsPath) (Read-RadarMapFile $currentCountsPath) 'candidate → authorization counts'
Assert-RadarMapsEqual (Read-RadarMapFile $sourceFingerprintsPath) (Read-RadarMapFile $currentFingerprintsPath) 'candidate → authorization fingerprints'
$currentCounts = Read-RadarMapFile $currentCountsPath
if ([long]$currentCounts['public.works'] -ne 35615) { throw 'Works 数量不匹配。' }
if (@($currentCounts.Keys | Where-Object {
  $_ -like 'public.radar_public_records*' -or
  $_ -like 'public.radar_public_ratings*' -or
  $_ -eq 'public.radar_unified_release_apply_control'
}).Count -ne 0) { throw '目标表或 apply-control 表已经存在。' }

$migrationRows = @(& docker exec `
  -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
  $SourcePostgresContainer `
  psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase `
  -c "SELECT name || E'\t' || batch::text FROM public.payload_migrations ORDER BY name, batch;")
if ($LASTEXITCODE -ne 0 -or ($migrationRows -join "`n") -ne ($ExpectedMigrationRows -join "`n")) {
  throw '授权时 migration 状态不匹配。'
}

$criticalEntries = @()
foreach ($relativePath in $CriticalCodeFiles) {
  $fullPath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "缺少关键代码：$relativePath" }
  $criticalEntries += [ordered]@{
    file = $relativePath
    bytes = [long](Get-Item -LiteralPath $fullPath).Length
    sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$criticalText = ((@($criticalEntries | ForEach-Object { "$($_.sha256)  $($_.file)" }) -join "`n") + "`n")
$criticalManifestPath = Join-Path $outDir 'critical-production-code-SHA256SUMS'
[System.IO.File]::WriteAllText($criticalManifestPath, $criticalText, [System.Text.UTF8Encoding]::new($false))
$criticalRootSha256 = (Get-FileHash -LiteralPath $criticalManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

$authorizationPath = Join-Path $outDir 'radar-unified-release-production-authorization-0575-v01.json'
Write-RadarJsonFile $authorizationPath ([ordered]@{
  schemaVersion = 'radar-unified-release-production-authorization-0575-v01'
  authorizationToolVersion = 'v02'
  createdAt = [DateTime]::UtcNow.ToString('o')
  releaseId = $ReleaseId
  mainHead = $currentHead
  candidatePath = $candidatePath
  candidateSha256 = $candidateHash
  candidateToolHead = $ExpectedCandidateToolHead
  approvedLabMainCommit = $ExpectedApprovedLabMainCommit
  researchHead = $ExpectedResearchHead
  evidencePath = $evidencePath
  evidenceSha256 = $ExpectedEvidenceSha256
  releaseDirectory = $releaseDirectory
  releaseManifestSha256 = $ExpectedManifestSha256
  releaseRecordsSha256 = $ExpectedRecordsSha256
  releaseRatingsSha256 = $ExpectedRatingsSha256
  releaseIndexSha256 = $ExpectedReleaseIndexSha256
  p1BackupPath = $backupPath
  p1BackupBytes = [long]$backupItem.Length
  p1BackupSha256 = $ExpectedBackupSha256
  sourceCountsPath = $currentCountsPath
  sourceCountsSha256 = (Get-FileHash -LiteralPath $currentCountsPath -Algorithm SHA256).Hash.ToLowerInvariant()
  sourceFingerprintsPath = $currentFingerprintsPath
  sourceFingerprintsSha256 = (Get-FileHash -LiteralPath $currentFingerprintsPath -Algorithm SHA256).Hash.ToLowerInvariant()
  sourceMigrationRows = $ExpectedMigrationRows
  criticalCodeManifestPath = $criticalManifestPath
  criticalCodeManifestSha256 = $criticalRootSha256
  criticalCodeFiles = $criticalEntries
  sourceDatabaseWrite = $false
  migrationApplied = $false
  publicRecordsWritten = 0
  publicRatingsWritten = 0
  readyForExplicitApply = $true
  productionAuthorization = $false
  accepted = $true
  decision = 'accept_merged_main_production_execution_gate_0575_v02'
})

Write-Host ''
Write-Host '统一 Release 合并后生产执行门授权通过（仍未写数据库）。' -ForegroundColor Green
Write-Host "MainHead                : $currentHead"
Write-Host "CandidateSHA256         : $candidateHash"
Write-Host "P1BackupSHA256          : $ExpectedBackupSha256"
Write-Host "CriticalCodeRootSHA256  : $criticalRootSha256"
Write-Host "Authorization           : $authorizationPath"
Write-Host 'SourceDatabaseWrite     : False'
Write-Host 'ProductionAuthorization : False'
Write-Host 'ReadyForExplicitApply   : True'
