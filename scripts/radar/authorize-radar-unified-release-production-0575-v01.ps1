param(
  [Parameter(Mandatory = $true)][string]$Candidate,
  [Parameter(Mandatory = $true)][string]$ExpectedMainHead,
  [Parameter(Mandatory = $true)][ValidateSet('AUTHORIZE-RADAR-UNIFIED-RELEASE-PRODUCTION-0575-V01')][string]$Confirm,
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
$ExpectedWorks = 35615
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$ExpectedMigrationRows = @(
  "20260718_072813_existing_schema_baseline_v01`t1",
  "20260718_072843_stewardship_notices_v01`t1",
  "dev`t-1"
)
$CriticalCodeFiles = @(
  '.github/workflows/validate-radar-unified-release-production-0575-v01.yml',
  'docs/guides/radar-unified-release-production-0575-v01.md',
  'scripts/radar/prepare-radar-unified-release-production-0575-v01.ps1',
  'scripts/radar/authorize-radar-unified-release-production-0575-v01.ps1',
  'scripts/radar/execute-radar-unified-release-production-0575-v01.ps1',
  'scripts/radar/run-unified-release-production-import-0575-v01.mjs',
  'src/app/(payload)/api/radar-unified-release-production-marker/route.ts',
  'tests/radar-unified-release-production-0575-v01.test.mjs',
  'tests/radar-unified-release-production-import-0575-v01.test.mjs'
)

function Write-JsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, ($json.TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
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

function Read-MapFile([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -lt 2) { throw "无法解析 TSV：$line" }
    if ($map.ContainsKey($parts[0])) { throw "TSV 键重复：$($parts[0])" }
    $map[$parts[0]] = ($parts[1..($parts.Count - 1)] -join "`t")
  }
  return $map
}

function Assert-MapsEqual([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  if (($expectedKeys -join "`n") -ne ($actualKeys -join "`n")) { throw "$Label 的键集合不一致。" }
  foreach ($key in $expectedKeys) {
    if ([string]$Expected[$key] -ne [string]$Actual[$key]) { throw "$Label 不一致：$key" }
  }
}

function Invoke-ReadOnlySqlFile(
  [string]$HostFile,
  [string]$ContainerFile,
  [string]$OutputFile,
  [string]$ErrorFile
) {
  & docker cp $HostFile "${SourcePostgresContainer}:$ContainerFile" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "复制只读 SQL 失败：$ContainerFile" }
  try {
    & docker exec `
      -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
      $SourcePostgresContainer `
      psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase -f $ContainerFile `
      1> $OutputFile 2> $ErrorFile
    if ($LASTEXITCODE -ne 0) { throw "执行只读 SQL 失败：$ContainerFile" }
    $stderr = @(Get-Content -LiteralPath $ErrorFile -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($stderr.Count -gt 0) { throw "只读 SQL stderr 非空：$ContainerFile" }
  } finally {
    & docker exec $SourcePostgresContainer rm -f $ContainerFile 2>$null | Out-Null
  }
}

function Assert-FileHash([string]$Path, [string]$Expected, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "找不到 $Label：$Path" }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) { throw "$Label SHA-256 不匹配：$actual" }
  return $actual
}

if ($Confirm -ne 'AUTHORIZE-RADAR-UNIFIED-RELEASE-PRODUCTION-0575-V01') { throw '授权确认字符串不匹配。' }
if ($ExpectedMainHead -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedMainHead 格式无效。' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

$unexpectedDirty = @(Get-DirtyPaths | Where-Object { $_ -notin $AllowedDirtyFiles })
if ($unexpectedDirty.Count -gt 0) { throw "存在预期外本地修改：$($unexpectedDirty -join ', ')" }

git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端状态失败。' }
$currentBranch = (git branch --show-current).Trim()
$currentHead = (git rev-parse HEAD).Trim()
$remoteMain = (git rev-parse origin/main).Trim()
if ($currentBranch -ne 'main') { throw "合并后授权只允许在 main：$currentBranch" }
if ($currentHead -ne $ExpectedMainHead -or $remoteMain -ne $ExpectedMainHead) {
  throw "main 身份不匹配：local=$currentHead remote=$remoteMain expected=$ExpectedMainHead"
}

$candidatePath = (Resolve-Path -LiteralPath $Candidate).Path
$candidateHash = Assert-FileHash $candidatePath $ExpectedCandidateSha256 'production candidate'
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
Assert-FileHash $evidencePath $ExpectedEvidenceSha256 '隔离证据 ZIP' | Out-Null
$releaseDirectory = (Resolve-Path -LiteralPath ([string]$candidateJson.releaseDirectory)).Path
Assert-FileHash (Join-Path $releaseDirectory 'manifest.json') $ExpectedManifestSha256 'Release manifest' | Out-Null
Assert-FileHash (Join-Path $releaseDirectory 'records.jsonl') $ExpectedRecordsSha256 'Release records' | Out-Null
Assert-FileHash (Join-Path $releaseDirectory 'ratings.jsonl') $ExpectedRatingsSha256 'Release ratings' | Out-Null
Assert-FileHash (Join-Path $releaseDirectory 'release-index.jsonl') $ExpectedReleaseIndexSha256 'Release index' | Out-Null

$backupPath = (Resolve-Path -LiteralPath ([string]$candidateJson.backupPath)).Path
$backupItem = Get-Item -LiteralPath $backupPath
if ([long]$backupItem.Length -ne $ExpectedBackupBytes) { throw "P1 备份大小不匹配：$($backupItem.Length)" }
Assert-FileHash $backupPath $ExpectedBackupSha256 'P1 生产前备份' | Out-Null

$sourceCountsPath = (Resolve-Path -LiteralPath ([string]$candidateJson.sourceCountsPath)).Path
$sourceFingerprintsPath = (Resolve-Path -LiteralPath ([string]$candidateJson.sourceFingerprintsPath)).Path
Assert-FileHash $sourceCountsPath ([string]$candidateJson.sourceCountsSha256) 'candidate source counts' | Out-Null
Assert-FileHash $sourceFingerprintsPath ([string]$candidateJson.sourceFingerprintsSha256) 'candidate source fingerprints' | Out-Null
$candidateDirectory = Split-Path -Parent $candidatePath
$tableCountsSql = Join-Path $candidateDirectory 'table-counts.sql'
$protectedFingerprintsSql = Join-Path $candidateDirectory 'protected-fingerprints.sql'
if (-not (Test-Path -LiteralPath $tableCountsSql -PathType Leaf)) { throw "缺少 candidate table-counts.sql：$tableCountsSql" }
if (-not (Test-Path -LiteralPath $protectedFingerprintsSql -PathType Leaf)) { throw "缺少 candidate protected-fingerprints.sql：$protectedFingerprintsSql" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-release-production-0575-v01\authorization-$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$currentCountsPath = Join-Path $outDir 'authorization-source-table-counts.tsv'
$currentFingerprintsPath = Join-Path $outDir 'authorization-source-protected-fingerprints.tsv'
Invoke-ReadOnlySqlFile $tableCountsSql '/tmp/radar-production-authorization-counts.sql' $currentCountsPath (Join-Path $outDir 'authorization-counts-stderr.txt')
Invoke-ReadOnlySqlFile $protectedFingerprintsSql '/tmp/radar-production-authorization-fingerprints.sql' $currentFingerprintsPath (Join-Path $outDir 'authorization-fingerprints-stderr.txt')
Assert-MapsEqual (Read-MapFile $sourceCountsPath) (Read-MapFile $currentCountsPath) 'candidate → authorization source counts'
Assert-MapsEqual (Read-MapFile $sourceFingerprintsPath) (Read-MapFile $currentFingerprintsPath) 'candidate → authorization protected fingerprints'
$currentCounts = Read-MapFile $currentCountsPath
if ([long]$currentCounts['public.works'] -ne $ExpectedWorks) { throw 'Works 数量不匹配。' }
if (@($currentCounts.Keys | Where-Object { $_ -like 'public.radar_public_records*' -or $_ -like 'public.radar_public_ratings*' }).Count -ne 0) {
  throw '新投影表已经存在，拒绝授权。'
}

$migrationRows = @(& docker exec `
  -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
  $SourcePostgresContainer `
  psql -X -qAt -v ON_ERROR_STOP=1 -U $SourceDatabaseUser -d $SourceDatabase `
  -c "SELECT name || E'\t' || batch::text FROM public.payload_migrations ORDER BY name, batch;")
if ($LASTEXITCODE -ne 0 -or ($migrationRows -join "`n") -ne ($ExpectedMigrationRows -join "`n")) {
  throw "授权时 migration 状态不匹配：$($migrationRows -join ', ')"
}

$criticalEntries = @()
foreach ($relativePath in $CriticalCodeFiles) {
  $fullPath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "缺少关键生产代码：$relativePath" }
  $criticalEntries += [ordered]@{
    file = $relativePath
    bytes = [long](Get-Item -LiteralPath $fullPath).Length
    sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$criticalLines = @($criticalEntries | ForEach-Object { "$($_.sha256)  $($_.file)" })
$criticalText = (($criticalLines -join "`n") + "`n")
$criticalManifestPath = Join-Path $outDir 'critical-production-code-SHA256SUMS'
[System.IO.File]::WriteAllText($criticalManifestPath, $criticalText, [System.Text.UTF8Encoding]::new($false))
$criticalRootSha256 = (Get-FileHash -LiteralPath $criticalManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

$authorizationPath = Join-Path $outDir 'radar-unified-release-production-authorization-0575-v01.json'
Write-JsonFile $authorizationPath ([ordered]@{
  schemaVersion = 'radar-unified-release-production-authorization-0575-v01'
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
  decision = 'accept_merged_main_production_execution_gate_0575_v01'
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
