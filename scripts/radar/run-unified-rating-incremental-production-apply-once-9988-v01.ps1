param(
  [Parameter(Mandatory = $true)][string]$ExpectedToolHead,
  [Parameter(Mandatory = $true)][string]$ProductionCandidatePath,
  [Parameter(Mandatory = $true)][string]$ExpectedProductionCandidateSha256,
  [Parameter(Mandatory = $true)][ValidateSet('APPLY-RADAR-UNIFIED-RATING-INCREMENTAL-9988-ONCE-I-ACCEPT-19976-CREATES')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$PayloadEmail = '',
  [int]$ReadyTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Confirm -ne 'APPLY-RADAR-UNIFIED-RATING-INCREMENTAL-9988-ONCE-I-ACCEPT-19976-CREATES') {
  throw '生产 apply-once 确认字符串不匹配。'
}
if ($ExpectedToolHead -notmatch '^[a-fA-F0-9]{40}$') { throw 'ExpectedToolHead 格式无效。' }
if ($ExpectedProductionCandidateSha256 -notmatch '^[a-fA-F0-9]{64}$') {
  throw 'ExpectedProductionCandidateSha256 格式无效。'
}
$ExpectedToolHead = $ExpectedToolHead.ToLowerInvariant()
$ExpectedProductionCandidateSha256 = $ExpectedProductionCandidateSha256.ToLowerInvariant()

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
. (Join-Path $PSScriptRoot 'lib\radar-unified-rating-incremental-production-9988-v01.ps1')
$config = Get-RadarIncremental9988Config
$allowedDirty = @('next-env.d.ts', 'payload-types.ts')

function Wait-IncrementalProductionMarker(
  [string]$BaseUrl,
  [string]$Nonce,
  [string]$Phase,
  [string]$DatabaseName,
  [string]$CandidateSha256,
  [object]$Process
) {
  if ($null -eq $Process -or -not ($Process -is [System.Diagnostics.Process])) {
    throw '生产 Payload 进程句柄无效。'
  }
  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  do {
    if ($Process.HasExited) { throw "生产 Payload 进程提前退出：$($Process.ExitCode)" }
    try {
      $marker = Invoke-RestMethod `
        -Uri "$BaseUrl/api/radar-unified-rating-incremental-production-marker" `
        -Method Get `
        -Headers @{ 'x-radar-unified-rating-incremental-production-nonce' = $Nonce } `
        -TimeoutSec 10
      if (
        $marker.productionMode -eq $true -and
        [string]$marker.phase -eq $Phase -and
        [string]$marker.database -eq $DatabaseName -and
        [string]$marker.mainHead -eq $ExpectedToolHead -and
        [string]$marker.researchHead -eq $config.ResearchHead -and
        [string]$marker.releaseId -eq $config.ReleaseId -and
        [string]$marker.candidateSha256 -eq $CandidateSha256
      ) { return $marker }
    } catch {}
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw '生产 Payload 未通过增量 marker。'
}

function Start-IncrementalProductionApp(
  [string]$DatabaseUrl,
  [string]$DatabaseName,
  [ValidateSet('plan', 'apply', 'verify')][string]$Phase,
  [string]$Nonce,
  [string]$CandidateSha256,
  [string]$Directory
) {
  $port = Get-RadarFreePort 32000 39999
  $baseUrl = "http://127.0.0.1:$port"
  $pnpmCommand = if ($IsWindows) { 'pnpm.cmd' } else { 'pnpm' }
  $script:process = $null
  $null = Invoke-RadarWithEnvironment -Variables @{
    DATABASE_URL = $DatabaseUrl
    PAYLOAD_DB_PUSH = 'false'
    STEWARDSHIP_NOTICES_SCHEMA_READY = 'true'
    RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
    NEXT_PUBLIC_SERVER_URL = $baseUrl
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_MODE = 'true'
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_NONCE = $Nonce
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_PHASE = $Phase
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_DATABASE = $DatabaseName
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_MAIN_HEAD = $ExpectedToolHead
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_RESEARCH_HEAD = $config.ResearchHead
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_RELEASE_ID = $config.ReleaseId
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_CANDIDATE_SHA256 = $CandidateSha256
  } -Action {
    $script:process = Start-Process -FilePath $pnpmCommand `
      -ArgumentList @('exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', [string]$port) `
      -WorkingDirectory $repoRoot `
      -RedirectStandardOutput (Join-Path $Directory "production-$Phase-app-stdout.txt") `
      -RedirectStandardError (Join-Path $Directory "production-$Phase-app-stderr.txt") `
      -PassThru -NoNewWindow
  }
  $process = Get-RadarActiveProcess $null
  if ($null -eq $process -or -not ($process -is [System.Diagnostics.Process])) {
    throw '生产 Payload 进程句柄无效。'
  }
  try {
    Wait-IncrementalProductionMarker $baseUrl $Nonce $Phase $DatabaseName $CandidateSha256 $process | Out-Null
    return [pscustomobject]@{ Process = $process; BaseUrl = $baseUrl }
  } catch {
    Stop-RadarProcess $process
    throw
  }
}

function Invoke-IncrementalProductionImporter(
  [ValidateSet('plan', 'apply', 'verify')][string]$Mode,
  [string]$BaseUrl,
  [string]$DatabaseName,
  [string]$Nonce,
  [string]$Email,
  [string]$Password,
  [string]$ReleaseDirectory,
  [string]$CandidateSha256,
  [string]$OutputDirectory
) {
  $nodeCode = @'
const module = await import('./scripts/radar/run-unified-rating-incremental-production-import-9988-v01.mjs');
await module.run(process.argv.slice(1));
'@
  Invoke-RadarWithEnvironment -Variables @{
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_NONCE = $Nonce
    RADAR_PAYLOAD_EMAIL = $Email
    RADAR_PAYLOAD_PASSWORD = $Password
  } -Action {
    node --input-type=module -e $nodeCode -- `
      --input $ReleaseDirectory `
      --url $BaseUrl `
      --out-dir $OutputDirectory `
      --mode $Mode `
      --expected-main-head $ExpectedToolHead `
      --expected-research-head $config.ResearchHead `
      --expected-database $DatabaseName `
      --expected-candidate-sha256 $CandidateSha256 `
      --expected-phase $Mode `
      --confirm 'RUN-RADAR-UNIFIED-RATING-INCREMENTAL-PRODUCTION-IMPORT-9988-V01'
    if ($LASTEXITCODE -ne 0) { throw "Incremental production importer $Mode 失败。" }
  }
}

function Assert-ProductionPlanReceipt([object]$Receipt) {
  if (
    $Receipt.accepted -ne $true -or
    [string]$Receipt.mode -ne 'plan' -or
    [string]$Receipt.database -ne 'baihepailei' -or
    [int]$Receipt.rows -ne 9988 -or
    [int]$Receipt.preImport.blockers -ne 0 -or
    [int]$Receipt.preImport.recordStatusCounts.ready_create -ne 9988 -or
    [int]$Receipt.preImport.ratingStatusCounts.ready_create -ne 9988 -or
    $Receipt.productionWrite -ne $false -or
    $Receipt.productionAuthorization -ne $false
  ) { throw '生产 plan receipt 不符合 9,988 + 9,988 create-only 门。' }
}

function Assert-ProductionApplyReceipt([object]$Receipt) {
  if (
    $Receipt.accepted -ne $true -or
    [string]$Receipt.mode -ne 'apply' -or
    [string]$Receipt.database -ne 'baihepailei' -or
    [int]$Receipt.rows -ne 9988 -or
    [int]$Receipt.counts.recordCreate -ne 9988 -or
    [int]$Receipt.counts.ratingCreate -ne 9988 -or
    [int]$Receipt.counts.updateRequests -ne 0 -or
    [int]$Receipt.counts.putRequests -ne 0 -or
    [int]$Receipt.counts.deleteRequests -ne 0 -or
    [int]$Receipt.postImport.blockers -ne 0 -or
    [int]$Receipt.postImport.recordStatusCounts.already_current -ne 9988 -or
    [int]$Receipt.postImport.ratingStatusCounts.already_current -ne 9988 -or
    $Receipt.productionWrite -ne $true -or
    $Receipt.productionAuthorization -ne $true
  ) { throw '生产 apply receipt 不符合 9,988 + 9,988 收敛。' }
}

function Assert-ProductionVerifyReceipt([object]$Receipt) {
  if (
    $Receipt.accepted -ne $true -or
    [string]$Receipt.mode -ne 'verify' -or
    [string]$Receipt.database -ne 'baihepailei' -or
    [int]$Receipt.postImport.blockers -ne 0 -or
    [int]$Receipt.postImport.recordStatusCounts.already_current -ne 9988 -or
    [int]$Receipt.postImport.ratingStatusCounts.already_current -ne 9988 -or
    $Receipt.productionWrite -ne $false -or
    $Receipt.productionAuthorization -ne $false
  ) { throw '生产 verify receipt 不符合 already_current 收敛。' }
}

$unexpectedDirty = @(Get-RadarDirtyPaths | Where-Object { $_ -notin $allowedDirty })
if ($unexpectedDirty.Count -gt 0) { throw "存在预期外本地修改：$($unexpectedDirty -join ', ')" }

git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取网站仓库远端更新失败。' }
$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -notin @('main', 'agent/radar-unified-release-incremental-9988-v01')) {
  throw "生产 apply-once 只允许 main 或精确 PR 分支：$currentBranch"
}
git pull --ff-only origin $currentBranch
if ($LASTEXITCODE -ne 0) { throw '更新当前网站分支失败。' }
$currentHead = (git rev-parse HEAD).Trim().ToLowerInvariant()
$remoteHead = (git rev-parse "origin/$currentBranch").Trim().ToLowerInvariant()
if ($currentHead -ne $ExpectedToolHead -or $remoteHead -ne $ExpectedToolHead) {
  throw "生产 apply-once 工具提交不匹配：branch=$currentBranch local=$currentHead remote=$remoteHead expected=$ExpectedToolHead"
}

$candidatePath = (Resolve-Path -LiteralPath $ProductionCandidatePath).Path
if ((Get-RadarIncrementalFileSha $candidatePath) -ne $ExpectedProductionCandidateSha256) {
  throw 'Production Candidate SHA-256 不匹配。'
}
$candidate = Read-RadarIncrementalJson $candidatePath
if (
  [string]$candidate.schemaVersion -ne 'radar-unified-rating-incremental-production-candidate-9988-v01' -or
  $candidate.accepted -ne $true -or
  [string]$candidate.toolHead -ne $ExpectedToolHead -or
  [string]$candidate.researchHead -ne $config.ResearchHead -or
  [string]$candidate.releaseId -ne $config.ReleaseId -or
  $candidate.applyOnceEligible -ne $true -or
  $candidate.automaticRetryAllowed -ne $false -or
  $candidate.automaticRollbackAllowed -ne $false -or
  $candidate.productionAuthorization -ne $false -or
  [string]$candidate.decision -ne 'accept_incremental_release_9988_for_explicit_production_apply_once_only'
) { throw 'Production Candidate 不符合 apply-once 门。' }

if ((Get-RadarIncrementalFileSha ([string]$candidate.rehearsalEvidence.auditReportPath)) -ne [string]$candidate.rehearsalEvidence.auditReportSha256) {
  throw 'Production Candidate 绑定的审计报告已变化。'
}
if ((Get-RadarIncrementalFileSha ([string]$candidate.rehearsalEvidence.evidenceZipPath)) -ne [string]$candidate.rehearsalEvidence.evidenceZipSha256) {
  throw 'Production Candidate 绑定的 Evidence ZIP 已变化。'
}
if ((Get-RadarIncrementalFileSha ([string]$candidate.freshBackup.path)) -ne [string]$candidate.freshBackup.sha256) {
  throw 'Production Candidate 绑定的 fresh backup 已变化。'
}
if ([long](Get-Item -LiteralPath ([string]$candidate.freshBackup.path)).Length -ne [long]$candidate.freshBackup.bytes) {
  throw 'Production Candidate 绑定的 fresh backup 大小已变化。'
}
foreach ($entry in @($candidate.criticalCodeFiles)) {
  $path = Join-Path $repoRoot ([string]$entry.file)
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "缺少生产关键代码：$($entry.file)" }
  if ((Get-RadarIncrementalFileSha $path) -ne [string]$entry.sha256) { throw "生产关键代码已变化：$($entry.file)" }
}

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
    throw '研究仓库提交不符合 Production Candidate。'
  }
} finally {
  Pop-Location
}
$releaseDirectory = Join-Path $resolvedResearchRepo $config.ReleasePath
foreach ($entry in $config.ReleaseFiles.GetEnumerator()) {
  Assert-RadarFileHash (Join-Path $releaseDirectory $entry.Key) $entry.Value "Release $($entry.Key)" | Out-Null
}

$repoNext = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      [string]$_.CommandLine -match [regex]::Escape($repoRoot) -and
      [string]$_.CommandLine -match '(?i)(next\s+dev|next\\dist\\server\\lib\\start-server)'
    }
)
if ($repoNext.Count -gt 0) {
  throw "本仓库仍有 Next dev 进程，禁止生产 apply-once：$($repoNext.ProcessId -join ', ')"
}

$databaseUrl = [string](Get-RadarConfiguredValue @('DATABASE_URL'))
if ([string]::IsNullOrWhiteSpace($databaseUrl) -or $databaseUrl -notmatch '^postgres(?:ql)?://') {
  throw '无法读取本地生产 DATABASE_URL。'
}
$email = $PayloadEmail.Trim()
if (-not $email) {
  $email = [string](Get-RadarConfiguredValue @('RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL', 'SITE_OWNER_EMAIL'))
  $email = $email.Trim()
}
if (-not $email) { $email = (Read-Host '请输入现有 Payload 管理员邮箱').Trim() }
if (-not $email) { throw 'Payload 管理员邮箱不能为空。' }
$password = [string](Get-RadarConfiguredValue @('RADAR_PAYLOAD_PASSWORD', 'PAYLOAD_EXPORT_PASSWORD', 'PAYLOAD_SEED_PASSWORD'))
$securePassword = $null
$bstr = [IntPtr]::Zero
if (-not $password) {
  $securePassword = Read-Host '请输入现有 Payload 管理员密码（用于真实源库 apply-once）' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
if (-not $password) { throw 'Payload 管理员密码不能为空。' }

$writerContext = Get-RadarIncrementalWriterContext $SourcePostgresContainer
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-rating-incremental-production-9988-v01\production-apply-once-$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$stagePath = Join-Path $outDir 'production-apply-once-stage.json'
$acceptancePath = Join-Path $outDir 'production-apply-once-acceptance.json'
$failurePath = Join-Path $outDir 'production-apply-once-failure.json'
$sqlFiles = New-RadarIncrementalSnapshotSql $outDir
$stage = [ordered]@{
  schemaVersion = 'radar-unified-rating-incremental-production-apply-once-stage-9988-v01'
  startedAt = [DateTime]::UtcNow.ToString('o')
  toolHead = $ExpectedToolHead
  candidateSha256 = $ExpectedProductionCandidateSha256
  writersStopped = $false
  sourceMatchedCandidate = $false
  planPassed = $false
  applyStarted = $false
  applyPassed = $false
  verifyPassed = $false
  postStorageVerified = $false
  protectedFingerprintsUnchanged = $false
  writersRestarted = $false
  sourceDatabaseWrite = $false
  productionAuthorization = $false
  automaticRollbackExecuted = $false
}
Write-RadarJsonFile $stagePath $stage
$app = $null
$writersRestarted = $false
$applyStarted = $false
$applyCompleted = $false
$operationError = $null
$applyReceipt = $null

try {
  Stop-RadarIncrementalWriters $writerContext.Writers
  $stage.writersStopped = $true
  Write-RadarJsonFile $stagePath $stage
  Start-Sleep -Seconds 3

  $sourceBefore = Get-RadarIncrementalSnapshot `
    $SourcePostgresContainer ([string]$candidate.source.database) ([string]$candidate.source.databaseUser) '' `
    $sqlFiles 'source-before-production-apply' $outDir
  Assert-RadarIncrementalSourceState `
    $sourceBefore $SourcePostgresContainer ([string]$candidate.source.database) ([string]$candidate.source.databaseUser) '' `
    $config 'source-before-production-apply'
  Assert-RadarMapsEqual `
    (Convert-RadarIncrementalObjectToMap $candidate.source.counts) $sourceBefore.Counts 'Production Candidate source counts'
  Assert-RadarMapsEqual `
    (Convert-RadarIncrementalObjectToMap $candidate.source.protectedFingerprints) $sourceBefore.Fingerprints `
    'Production Candidate source protected fingerprints'
  $stage.sourceMatchedCandidate = $true
  Write-RadarJsonFile $stagePath $stage

  foreach ($mode in @('plan', 'apply', 'verify')) {
    $nonce = [Guid]::NewGuid().ToString('N')
    $app = Start-IncrementalProductionApp `
      $databaseUrl ([string]$candidate.source.database) $mode $nonce $ExpectedProductionCandidateSha256 $outDir
    $importDir = Join-Path $outDir $mode
    if ($mode -eq 'apply') {
      $applyStarted = $true
      $stage.applyStarted = $true
      $stage.productionAuthorization = $true
      Write-RadarJsonFile $stagePath $stage
    }
    Invoke-IncrementalProductionImporter `
      $mode $app.BaseUrl ([string]$candidate.source.database) $nonce $email $password `
      $releaseDirectory $ExpectedProductionCandidateSha256 $importDir
    Stop-RadarProcess $app.Process
    $app = $null
    $receipt = Read-RadarIncrementalJson (Join-Path $importDir 'accepted-receipt.json')
    if ($mode -eq 'plan') {
      Assert-ProductionPlanReceipt $receipt
      $stage.planPassed = $true
    } elseif ($mode -eq 'apply') {
      Assert-ProductionApplyReceipt $receipt
      $applyReceipt = $receipt
      $applyCompleted = $true
      $stage.applyPassed = $true
      $stage.sourceDatabaseWrite = $true
    } else {
      Assert-ProductionVerifyReceipt $receipt
      $stage.verifyPassed = $true
    }
    Write-RadarJsonFile $stagePath $stage
  }

  $sourceAfter = Get-RadarIncrementalSnapshot `
    $SourcePostgresContainer ([string]$candidate.source.database) ([string]$candidate.source.databaseUser) '' `
    $sqlFiles 'source-after-production-apply' $outDir
  Assert-RadarIncrementalPostCounts $sourceBefore.Counts $sourceAfter.Counts $applyReceipt.expectedStorage
  $stage.postStorageVerified = $true
  Assert-RadarMapsEqual $sourceBefore.Fingerprints $sourceAfter.Fingerprints '生产 apply 前后 protected fingerprints'
  $stage.protectedFingerprintsUnchanged = $true
  Write-RadarJsonFile $stagePath $stage

  Restart-RadarIncrementalWriters $writerContext.Writers
  $writersRestarted = $true
  $stage.writersRestarted = $true
  Write-RadarJsonFile $stagePath $stage

  $acceptance = [ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-production-apply-once-acceptance-9988-v01'
    accepted = $true
    completedAt = [DateTime]::UtcNow.ToString('o')
    toolHead = $ExpectedToolHead
    researchHead = $config.ResearchHead
    releaseId = $config.ReleaseId
    candidatePath = $candidatePath
    candidateSha256 = $ExpectedProductionCandidateSha256
    freshBackupPath = [string]$candidate.freshBackup.path
    freshBackupSha256 = [string]$candidate.freshBackup.sha256
    publicRecordsCreated = 9988
    publicRatingsCreated = 9988
    postRecordsAlreadyCurrent = 9988
    postRatingsAlreadyCurrent = 9988
    blockers = 0
    updates = 0
    puts = 0
    deletes = 0
    sourceDatabaseWrite = $true
    protectedFingerprintsUnchanged = $true
    postStorageVerified = $true
    writersRestarted = $true
    automaticRetryAllowed = $false
    automaticRollbackExecuted = $false
    productionAuthorization = $true
    decision = 'accept_incremental_production_apply_once_9988_v01'
  }
  Write-RadarJsonFile $acceptancePath $acceptance
} catch {
  $operationError = $_
} finally {
  if ($app) { Stop-RadarProcess $app.Process }
  if ($null -eq $operationError -and -not $writersRestarted) {
    Restart-RadarIncrementalWriters $writerContext.Writers
    $writersRestarted = $true
  } elseif ($null -ne $operationError -and -not $applyStarted -and -not $writersRestarted) {
    try {
      Restart-RadarIncrementalWriters $writerContext.Writers
      $writersRestarted = $true
    } catch {}
  }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $password = $null
  $securePassword = $null
}

if ($null -ne $operationError) {
  $recordCreates = 0
  $ratingCreates = 0
  $applyFailure = Join-Path $outDir 'apply\failure-receipt.json'
  if (Test-Path -LiteralPath $applyFailure -PathType Leaf) {
    $failureReceipt = Read-RadarIncrementalJson $applyFailure
    $recordCreates = [int]$failureReceipt.counts.recordCreate
    $ratingCreates = [int]$failureReceipt.counts.ratingCreate
  }
  Write-RadarJsonFile $failurePath ([ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-production-apply-once-failure-9988-v01'
    failedAt = [DateTime]::UtcNow.ToString('o')
    message = $operationError.Exception.Message
    toolHead = $ExpectedToolHead
    candidatePath = $candidatePath
    candidateSha256 = $ExpectedProductionCandidateSha256
    freshBackupPath = [string]$candidate.freshBackup.path
    recordCreates = $recordCreates
    ratingCreates = $ratingCreates
    applyStarted = $applyStarted
    applyCompleted = $applyCompleted
    writersRestarted = $writersRestarted
    sourceDatabaseWriteMayHaveOccurred = $applyStarted
    productionAuthorization = $applyStarted
    automaticRetryAllowed = $false
    automaticRollbackExecuted = $false
    operatorMustInspectBeforeRetry = $true
    operatorMustInspectBeforeWriterRestart = ($applyStarted -and -not $applyCompleted)
  })
  throw $operationError
}

Write-Host ''
Write-Host '9,988 条增量 Release 真实源库 apply-once 已完成。' -ForegroundColor Green
Write-Host "ToolHead                 : $ExpectedToolHead"
Write-Host "ProductionCandidateSHA   : $ExpectedProductionCandidateSha256"
Write-Host 'PublicRecordsCreated     : 9988'
Write-Host 'PublicRatingsCreated     : 9988'
Write-Host 'PostRecordsAlreadyCurrent: 9988'
Write-Host 'PostRatingsAlreadyCurrent: 9988'
Write-Host 'Update / PUT / DELETE    : 0 / 0 / 0'
Write-Host 'SourceDatabaseWrite      : True'
Write-Host 'ProductionAuthorization  : True'
Write-Host "Acceptance               : $acceptancePath"
