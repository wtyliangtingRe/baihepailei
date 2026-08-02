param(
  [Parameter(Mandatory = $true)][string]$ExpectedToolHead,
  [Parameter(Mandatory = $true)][string]$AuditReportPath,
  [Parameter(Mandatory = $true)][string]$ExpectedAuditReportSha256,
  [Parameter(Mandatory = $true)][string]$EvidenceZip,
  [Parameter(Mandatory = $true)][string]$ExpectedEvidenceSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedRehearsalCandidateSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedRehearsalToolHead,
  [Parameter(Mandatory = $true)][ValidateSet('PREPARE-RADAR-UNIFIED-RATING-INCREMENTAL-PRODUCTION-CANDIDATE-9988-V01')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Confirm -ne 'PREPARE-RADAR-UNIFIED-RATING-INCREMENTAL-PRODUCTION-CANDIDATE-9988-V01') {
  throw '确认字符串不匹配。'
}
foreach ($pair in @(
  @{ Name = 'ExpectedToolHead'; Value = $ExpectedToolHead; Pattern = '^[a-fA-F0-9]{40}$' },
  @{ Name = 'ExpectedAuditReportSha256'; Value = $ExpectedAuditReportSha256; Pattern = '^[a-fA-F0-9]{64}$' },
  @{ Name = 'ExpectedEvidenceSha256'; Value = $ExpectedEvidenceSha256; Pattern = '^[a-fA-F0-9]{64}$' },
  @{ Name = 'ExpectedRehearsalCandidateSha256'; Value = $ExpectedRehearsalCandidateSha256; Pattern = '^[a-fA-F0-9]{64}$' },
  @{ Name = 'ExpectedRehearsalToolHead'; Value = $ExpectedRehearsalToolHead; Pattern = '^[a-fA-F0-9]{40}$' }
)) {
  if ([string]$pair.Value -notmatch [string]$pair.Pattern) { throw "$($pair.Name) 格式无效。" }
}

$ExpectedToolHead = $ExpectedToolHead.ToLowerInvariant()
$ExpectedAuditReportSha256 = $ExpectedAuditReportSha256.ToLowerInvariant()
$ExpectedEvidenceSha256 = $ExpectedEvidenceSha256.ToLowerInvariant()
$ExpectedRehearsalCandidateSha256 = $ExpectedRehearsalCandidateSha256.ToLowerInvariant()
$ExpectedRehearsalToolHead = $ExpectedRehearsalToolHead.ToLowerInvariant()

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
. (Join-Path $PSScriptRoot 'lib\radar-unified-rating-incremental-production-9988-v01.ps1')
$config = Get-RadarIncremental9988Config
$allowedDirty = @('next-env.d.ts', 'payload-types.ts')

$unexpectedDirty = @(Get-RadarDirtyPaths | Where-Object { $_ -notin $allowedDirty })
if ($unexpectedDirty.Count -gt 0) { throw "存在预期外本地修改：$($unexpectedDirty -join ', ')" }

git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取网站仓库远端更新失败。' }
$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -notin @('main', 'agent/radar-unified-release-incremental-9988-v01')) {
  throw "生产候选只允许 main 或精确 PR 分支：$currentBranch"
}
git pull --ff-only origin $currentBranch
if ($LASTEXITCODE -ne 0) { throw '更新当前网站分支失败。' }
$currentHead = (git rev-parse HEAD).Trim().ToLowerInvariant()
$remoteHead = (git rev-parse "origin/$currentBranch").Trim().ToLowerInvariant()
if ($currentHead -ne $ExpectedToolHead -or $remoteHead -ne $ExpectedToolHead) {
  throw "生产候选工具提交不匹配：branch=$currentBranch local=$currentHead remote=$remoteHead expected=$ExpectedToolHead"
}
& git merge-base --is-ancestor $config.PreviousMain $ExpectedToolHead
if ($LASTEXITCODE -ne 0) { throw '当前工具 head 不包含 575 条生产基线。' }

$auditPath = (Resolve-Path -LiteralPath $AuditReportPath).Path
$zipPath = (Resolve-Path -LiteralPath $EvidenceZip).Path
if ((Get-RadarIncrementalFileSha $auditPath) -ne $ExpectedAuditReportSha256) { throw '独立审计报告 SHA-256 不匹配。' }
if ((Get-RadarIncrementalFileSha $zipPath) -ne $ExpectedEvidenceSha256) { throw 'Evidence ZIP SHA-256 不匹配。' }
$audit = Read-RadarIncrementalJson $auditPath
Assert-RadarIncrementalAuditReport `
  $audit $ExpectedEvidenceSha256 $ExpectedRehearsalCandidateSha256 $ExpectedRehearsalToolHead $config

$resolvedResearchRepo = (Resolve-Path -LiteralPath $ResearchRepo).Path
Push-Location $resolvedResearchRepo
try {
  git fetch origin
  if ($LASTEXITCODE -ne 0) { throw '获取研究仓库远端更新失败。' }
  git switch main
  if ($LASTEXITCODE -ne 0) { throw '切换研究仓库 main 失败。' }
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw '更新研究仓库 main 失败。' }
  $researchHead = (git rev-parse HEAD).Trim().ToLowerInvariant()
  $researchRemote = (git rev-parse origin/main).Trim().ToLowerInvariant()
  if ($researchHead -ne $config.ResearchHead -or $researchRemote -ne $config.ResearchHead) {
    throw "研究仓库提交不匹配：local=$researchHead remote=$researchRemote expected=$($config.ResearchHead)"
  }
} finally {
  Pop-Location
}
$releaseDirectory = Join-Path $resolvedResearchRepo $config.ReleasePath
foreach ($entry in $config.ReleaseFiles.GetEnumerator()) {
  Assert-RadarFileHash (Join-Path $releaseDirectory $entry.Key) $entry.Value "Release $($entry.Key)" | Out-Null
}

$writerContext = Get-RadarIncrementalWriterContext $SourcePostgresContainer
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-rating-incremental-production-candidate-9988-v01\candidate-$stamp"
$backupDir = Join-Path $repoRoot 'data_local\backups\radar-unified-rating-incremental-release-9988-v01'
New-Item -ItemType Directory -Path $outDir, $backupDir -Force | Out-Null
$backupPath = Join-Path $backupDir "source-before-incremental-production-candidate-9988-v01-$stamp.dump"
$backupContainerPath = "/tmp/source-before-incremental-production-candidate-9988-v01-$stamp.dump"
$candidatePath = Join-Path $outDir 'production-candidate.json'
$receiptPath = Join-Path $outDir 'production-candidate-preparation-receipt.json'
$failurePath = Join-Path $outDir 'production-candidate-preparation-failure.json'
$sqlFiles = New-RadarIncrementalSnapshotSql $outDir
$writersRestarted = $false
$operationError = $null
$candidateSha256 = $null

try {
  Stop-RadarIncrementalWriters $writerContext.Writers
  Start-Sleep -Seconds 3

  $sourceBefore = Get-RadarIncrementalSnapshot `
    $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $sqlFiles 'source-before-candidate-backup' $outDir
  Assert-RadarIncrementalSourceState `
    $sourceBefore $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $config 'source-before-candidate-backup'

  & docker exec $SourcePostgresContainer pg_dump -Fc --no-owner --no-privileges `
    -U $SourceDatabaseUser -d $SourceDatabase -f $backupContainerPath
  if ($LASTEXITCODE -ne 0) { throw '创建生产候选 fresh backup 失败。' }
  try {
    & docker cp "${SourcePostgresContainer}:$backupContainerPath" $backupPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '复制生产候选 fresh backup 失败。' }
  } finally {
    & docker exec $SourcePostgresContainer rm -f $backupContainerPath 2>$null | Out-Null
  }
  $backupBytes = [long](Get-Item -LiteralPath $backupPath).Length
  if ($backupBytes -le 0) { throw '生产候选 fresh backup 为空。' }
  $backupSha256 = Get-RadarIncrementalFileSha $backupPath

  $sourceAfter = Get-RadarIncrementalSnapshot `
    $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $sqlFiles 'source-after-candidate-backup' $outDir
  Assert-RadarMapsEqual $sourceBefore.Counts $sourceAfter.Counts '生产候选备份前后 source counts'
  Assert-RadarMapsEqual $sourceBefore.Fingerprints $sourceAfter.Fingerprints '生产候选备份前后 source fingerprints'

  Restart-RadarIncrementalWriters $writerContext.Writers
  $writersRestarted = $true

  $criticalPaths = @(
    'config/radar-unified-rating-incremental-release-9988-v01.lock.json',
    'scripts/radar/lib/public-release-plan-v01.mjs',
    'scripts/radar/lib/unified-rating-release-plan-v01.mjs',
    'scripts/radar/lib/radar-unified-release-production-0575-v01.ps1',
    'scripts/radar/lib/radar-unified-rating-incremental-production-9988-v01.ps1',
    'scripts/radar/run-unified-rating-incremental-production-import-9988-v01.mjs',
    'scripts/radar/prepare-unified-rating-incremental-production-candidate-9988-v01.ps1',
    'scripts/radar/run-unified-rating-incremental-production-apply-once-9988-v01.ps1',
    'src/app/(payload)/api/radar-unified-rating-incremental-production-marker/route.ts'
  )
  $critical = @()
  $criticalLines = @()
  foreach ($relative in $criticalPaths) {
    $path = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "缺少生产关键代码：$relative" }
    $sha = Get-RadarIncrementalFileSha $path
    $critical += [ordered]@{ file = $relative; bytes = [long](Get-Item -LiteralPath $path).Length; sha256 = $sha }
    $criticalLines += "$sha  $relative"
  }
  $criticalManifestPath = Join-Path $outDir 'critical-code-SHA256SUMS'
  [System.IO.File]::WriteAllText(
    $criticalManifestPath,
    (($criticalLines -join "`n") + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )

  $candidate = [ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-production-candidate-9988-v01'
    accepted = $true
    generatedAt = [DateTime]::UtcNow.ToString('o')
    toolHead = $ExpectedToolHead
    branch = $currentBranch
    researchHead = $config.ResearchHead
    releaseId = $config.ReleaseId
    releaseDirectory = $releaseDirectory
    releaseFiles = $config.ReleaseFiles
    rehearsalEvidence = [ordered]@{
      auditReportPath = $auditPath
      auditReportSha256 = $ExpectedAuditReportSha256
      evidenceZipPath = $zipPath
      evidenceZipSha256 = $ExpectedEvidenceSha256
      rehearsalCandidateSha256 = $ExpectedRehearsalCandidateSha256
      rehearsalToolHead = $ExpectedRehearsalToolHead
      decision = [string]$audit.decision
    }
    source = [ordered]@{
      postgresContainer = $SourcePostgresContainer
      database = $SourceDatabase
      databaseUser = $SourceDatabaseUser
      works = $config.ExpectedWorks
      publicRecords = $config.ExistingRecords
      publicRatings = $config.ExistingRatings
      counts = Convert-RadarIncrementalMap $sourceBefore.Counts
      protectedFingerprints = Convert-RadarIncrementalMap $sourceBefore.Fingerprints
      countsPath = $sourceBefore.CountsPath
      countsSha256 = Get-RadarIncrementalFileSha $sourceBefore.CountsPath
      fingerprintsPath = $sourceBefore.FingerprintsPath
      fingerprintsSha256 = Get-RadarIncrementalFileSha $sourceBefore.FingerprintsPath
      authenticationPerformed = $false
      payloadAccess = $false
      databaseWrite = $false
    }
    freshBackup = [ordered]@{
      path = $backupPath
      bytes = $backupBytes
      sha256 = $backupSha256
    }
    expectedTransition = [ordered]@{
      recordsReadyCreate = 9988
      ratingsReadyCreate = 9988
      recordCreates = 9988
      ratingCreates = 9988
      updates = 0
      puts = 0
      deletes = 0
      blockers = 0
    }
    expectedStorage = $config.ExpectedStorage
    criticalCodeFiles = $critical
    criticalCodeManifestPath = $criticalManifestPath
    criticalCodeManifestSha256 = Get-RadarIncrementalFileSha $criticalManifestPath
    applyOnceEligible = $true
    automaticRetryAllowed = $false
    automaticRollbackAllowed = $false
    productionAuthorization = $false
    decision = 'accept_incremental_release_9988_for_explicit_production_apply_once_only'
  }
  Write-RadarJsonFile $candidatePath $candidate
  $candidateSha256 = Get-RadarIncrementalFileSha $candidatePath

  $receipt = [ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-production-candidate-preparation-9988-v01'
    accepted = $true
    completedAt = [DateTime]::UtcNow.ToString('o')
    toolHead = $ExpectedToolHead
    researchHead = $config.ResearchHead
    releaseId = $config.ReleaseId
    candidatePath = $candidatePath
    candidateSha256 = $candidateSha256
    freshBackupPath = $backupPath
    freshBackupBytes = $backupBytes
    freshBackupSha256 = $backupSha256
    sourceCountsUnchangedDuringBackup = $true
    protectedFingerprintsUnchangedDuringBackup = $true
    sourceAuthentication = $false
    sourcePayloadAccess = $false
    sourceDatabaseWrite = $false
    writersRestarted = $true
    applyOnceEligible = $true
    productionAuthorization = $false
    decision = 'accept_production_candidate_preparation_9988_v01'
  }
  Write-RadarJsonFile $receiptPath $receipt
} catch {
  $operationError = $_
} finally {
  if (-not $writersRestarted) {
    try {
      Restart-RadarIncrementalWriters $writerContext.Writers
      $writersRestarted = $true
    } catch {
      if ($null -eq $operationError) { $operationError = $_ }
    }
  }
}

if ($null -ne $operationError) {
  Write-RadarJsonFile $failurePath ([ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-production-candidate-preparation-failure-9988-v01'
    failedAt = [DateTime]::UtcNow.ToString('o')
    message = $operationError.Exception.Message
    candidatePath = $candidatePath
    candidateSha256 = $candidateSha256
    freshBackupPath = $backupPath
    writersRestarted = $writersRestarted
    sourceAuthentication = $false
    sourcePayloadAccess = $false
    sourceDatabaseWrite = $false
    productionAuthorization = $false
    automaticRetryAllowed = $false
    operatorMustInspectBeforeRetry = $true
  })
  throw $operationError
}

Write-Host ''
Write-Host '9,988 条增量 Release 最终生产候选已冻结。' -ForegroundColor Green
Write-Host "ToolHead               : $ExpectedToolHead"
Write-Host "ResearchHead           : $($config.ResearchHead)"
Write-Host "AuditReportSHA256       : $ExpectedAuditReportSha256"
Write-Host "EvidenceSHA256          : $ExpectedEvidenceSha256"
Write-Host "FreshBackup             : $backupPath"
Write-Host "FreshBackupSHA256       : $backupSha256"
Write-Host "ProductionCandidate     : $candidatePath"
Write-Host "ProductionCandidateSHA  : $candidateSha256"
Write-Host 'SourceDatabaseWrite     : False'
Write-Host 'ProductionAuthorization : False'
