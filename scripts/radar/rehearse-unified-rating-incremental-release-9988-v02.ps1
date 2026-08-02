param(
  [Parameter(Mandatory = $true)][string]$ExpectedToolHead,
  [Parameter(Mandatory = $true)][string]$TransitionPlanDirectory,
  [Parameter(Mandatory = $true)][ValidateSet('REHEARSE-RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-V02')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [string]$PayloadEmail = '',
  [int]$ReadyTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-unified-release-incremental-9988-v01'
$ExpectedBaseMain = '24bd2f8a8d27a91282dd4d3e27ddf5e0804c6a94'
$ExpectedResearchHead = 'c8790df95d1235d8d1aacabfb7c119fec9e1c642'
$ReleaseId = 'RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-0001'
$PreviousReleaseId = 'RADAR-UNIFIED-RATING-RELEASE-0575-0001'
$ExpectedWorks = 35615
$ExpectedExistingRecords = 575
$ExpectedExistingRatings = 575
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$ReleasePath = 'releases\public\radar-unified-rating-incremental-release-9988-0001\v01'
$ExpectedReleaseFiles = [ordered]@{
  'manifest.json' = '40c8e474c5a6614b259c2ab9402e404fab9bf0c9411c2a3590885f7e619fe896'
  'records.jsonl' = '827c5d8c7ea958bf614f2a19db2ad2db2a6847dd7c82d718614a4bcb9cac71a9'
  'ratings.jsonl' = '4c1a55c8cdabbd92bb8c081a28b30b6c2f3e87d370dcfccb89ed776fe0d14d18'
  'release-index.jsonl' = '0412d6e8108d1c0172001cc4986fd376475fdd2dfb52ee1848c14f022ccb419f'
  'identity-review-excluded.jsonl' = 'ad834663fc5b83dd5fbe0e46dd6e28b8684b5b6853e74099929f0f308a55c7a2'
}
$ExpectedExistingProjectionCounts = [ordered]@{
  'public.radar_public_records' = 575
  'public.radar_public_records_facts' = 2387
  'public.radar_public_records_evidence' = 678
  'public.radar_public_records_facts_source_refs' = 2387
  'public.radar_public_ratings' = 575
  'public.radar_public_ratings_matched_classes' = 575
  'public.radar_public_ratings_fact_refs' = 630
  'public.radar_public_ratings_evidence_refs' = 566
  'public.radar_public_ratings_unresolved_dimensions' = 4025
  'public.radar_public_ratings_confirmation_basis' = 637
  'public.radar_public_ratings_public_tag_hints' = 588
  'public.radar_public_ratings_public_warning_template_ids' = 588
  'public.radar_public_ratings_human_review_proposed_profile_changes' = 0
  'public.radar_public_ratings_human_review_additional_evidence_refs' = 0
  'public.radar_unified_release_apply_control' = 1
}
$ExpectedMigrationNames = @(
  '20260718_072813_existing_schema_baseline_v01',
  '20260718_072843_stewardship_notices_v01',
  '20260723_141905_current_schema_baseline_before_radar_public_v01',
  '20260723_141908_radar_public_conclusions_v01',
  '20260801_101546_current_schema_baseline_before_radar_public_records_v01',
  '20260801_101551_radar_public_records_v01',
  '20260802_030535_radar_public_ratings_v01',
  '20260802_045057_radar_public_record_fact_value_text_v01',
  '20260802_062015_radar_public_record_evidence_role_v01'
)

if ($Confirm -ne 'REHEARSE-RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-V02') {
  throw '确认字符串不匹配。'
}
if ($ExpectedToolHead -notmatch '^[a-f0-9]{40}$') {
  throw 'ExpectedToolHead 格式无效。'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
. (Join-Path $PSScriptRoot 'lib\radar-unified-release-production-0575-v01.ps1')

function Get-FileSha([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha([string]$Text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Invoke-SqlText(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$Sql,
  [string]$Prefix,
  [string]$Directory,
  [switch]$ReadOnly
) {
  $hostFile = Join-Path $Directory "$Prefix.sql"
  $stdout = Join-Path $Directory "$Prefix-stdout.txt"
  $stderr = Join-Path $Directory "$Prefix-stderr.txt"
  [System.IO.File]::WriteAllText($hostFile, ($Sql.Trim() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
  Invoke-RadarSqlFile $Container $Database $User $Password $hostFile "/tmp/$Prefix.sql" $stdout $stderr -ReadOnly:$ReadOnly
  return $stdout
}

function New-SnapshotSql([string]$Directory) {
  $countSql = Join-Path $Directory 'table-counts.sql'
  $fingerprintSql = Join-Path $Directory 'protected-fingerprints.sql'
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
  return [pscustomobject]@{ Counts = $countSql; Fingerprints = $fingerprintSql }
}

function Get-Snapshot(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [object]$SqlFiles,
  [string]$Prefix,
  [string]$Directory
) {
  $countsPath = Join-Path $Directory "$Prefix-table-counts.tsv"
  $fingerprintsPath = Join-Path $Directory "$Prefix-protected-fingerprints.tsv"
  Invoke-RadarSqlFile $Container $Database $User $Password $SqlFiles.Counts "/tmp/$Prefix-counts.sql" `
    $countsPath (Join-Path $Directory "$Prefix-counts-stderr.txt") -ReadOnly
  Invoke-RadarSqlFile $Container $Database $User $Password $SqlFiles.Fingerprints "/tmp/$Prefix-fingerprints.sql" `
    $fingerprintsPath (Join-Path $Directory "$Prefix-fingerprints-stderr.txt") -ReadOnly
  return [pscustomobject]@{
    CountsPath = $countsPath
    FingerprintsPath = $fingerprintsPath
    Counts = Read-RadarMapFile $countsPath
    Fingerprints = Read-RadarMapFile $fingerprintsPath
  }
}

function Get-MigrationNames([string]$Container, [string]$Database, [string]$User, [string]$Password) {
  $args = @('exec')
  if (-not [string]::IsNullOrWhiteSpace($Password)) { $args += @('-e', "PGPASSWORD=$Password") }
  $args += @(
    '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning',
    $Container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', $User, '-d', $Database,
    '-c', 'SELECT name FROM public.payload_migrations ORDER BY name;'
  )
  $rows = @(& docker @args | Where-Object { $_ })
  if ($LASTEXITCODE -ne 0) { throw '读取 migration names 失败。' }
  return $rows
}

function Assert-MigrationNames([string[]]$Actual, [string]$Label) {
  $actualSorted = @($Actual | Sort-Object)
  $expectedSorted = @($ExpectedMigrationNames | Sort-Object)
  if (($actualSorted -join "`n") -ne ($expectedSorted -join "`n")) {
    throw "$Label migration names 不匹配：$($actualSorted -join ', ')"
  }
}

function Assert-SourceState([object]$Snapshot, [string]$Container, [string]$Database, [string]$User, [string]$Password, [string]$Label) {
  if ([long]$Snapshot.Counts['public.works'] -ne $ExpectedWorks) {
    throw "$Label Works 数量不匹配。"
  }
  foreach ($entry in $ExpectedExistingProjectionCounts.GetEnumerator()) {
    if (-not $Snapshot.Counts.ContainsKey($entry.Key)) {
      throw "$Label 缺少既有投影表：$($entry.Key)"
    }
    if ([long]$Snapshot.Counts[$entry.Key] -ne [long]$entry.Value) {
      throw "$Label 既有投影行数不匹配：$($entry.Key)=$($Snapshot.Counts[$entry.Key]) expected=$($entry.Value)"
    }
  }
  $markerSql = "SELECT release_id || E'\t' || state FROM public.radar_unified_release_apply_control ORDER BY release_id;"
  $markerPath = Invoke-SqlText $Container $Database $User $Password $markerSql "$Label-previous-marker" $script:outDir -ReadOnly
  $markerRows = @((Get-Content -LiteralPath $markerPath -Encoding UTF8) | Where-Object { $_ })
  if (($markerRows -join "`n") -ne "$PreviousReleaseId`tcompleted") {
    throw "$Label previous apply marker 不匹配：$($markerRows -join ', ')"
  }
  Assert-MigrationNames (Get-MigrationNames $Container $Database $User $Password) $Label
}

function Wait-IncrementalMarker(
  [string]$Url,
  [string]$Nonce,
  [string]$Phase,
  [string]$Database,
  [string]$CandidateSha256,
  [object]$Process
) {
  if ($null -eq $Process -or -not ($Process -is [System.Diagnostics.Process])) {
    throw '临时 Payload 进程句柄无效。'
  }
  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  do {
    if ($Process.HasExited) { throw "临时 Payload 进程提前退出：$($Process.ExitCode)" }
    try {
      $marker = Invoke-RestMethod `
        -Uri "$Url/api/radar-unified-rating-incremental-production-marker" `
        -Method Get `
        -Headers @{ 'x-radar-unified-rating-incremental-production-nonce' = $Nonce } `
        -TimeoutSec 10
      if (
        $marker.productionMode -eq $true -and
        [string]$marker.phase -eq $Phase -and
        [string]$marker.database -eq $Database -and
        [string]$marker.mainHead -eq $ExpectedToolHead -and
        [string]$marker.researchHead -eq $ExpectedResearchHead -and
        [string]$marker.releaseId -eq $ReleaseId -and
        [string]$marker.candidateSha256 -eq $CandidateSha256
      ) { return $marker }
    } catch {}
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "临时 Payload 未通过 $Phase marker。"
}

function Start-TemporaryApp(
  [string]$DatabaseUrl,
  [string]$DatabaseName,
  [string]$Phase,
  [string]$Nonce,
  [string]$CandidateSha256,
  [string]$Prefix,
  [string]$Directory
) {
  $port = Get-RadarFreePort 32000 39999
  $baseUrl = "http://127.0.0.1:$port"
  $pnpmCommand = if ($IsWindows) { (Get-Command pnpm.cmd -ErrorAction Stop).Source } else { (Get-Command pnpm -ErrorAction Stop).Source }
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
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_RESEARCH_HEAD = $ExpectedResearchHead
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_RELEASE_ID = $ReleaseId
    RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_CANDIDATE_SHA256 = $CandidateSha256
  } -Action {
    $script:process = Start-Process -FilePath $pnpmCommand `
      -ArgumentList @('exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', [string]$port) `
      -WorkingDirectory $repoRoot `
      -RedirectStandardOutput (Join-Path $Directory "$Prefix-app-stdout.txt") `
      -RedirectStandardError (Join-Path $Directory "$Prefix-app-stderr.txt") `
      -PassThru -NoNewWindow
  }
  $process = Get-RadarActiveProcess $null
  if ($null -eq $process -or -not ($process -is [System.Diagnostics.Process])) {
    throw '临时 Payload 进程句柄无效。'
  }
  Wait-IncrementalMarker $baseUrl $Nonce $Phase $DatabaseName $CandidateSha256 $process | Out-Null
  return [pscustomobject]@{ Process = $process; BaseUrl = $baseUrl }
}

function Invoke-IncrementalImporter(
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
      --expected-research-head $ExpectedResearchHead `
      --expected-database $DatabaseName `
      --expected-candidate-sha256 $CandidateSha256 `
      --expected-phase $Mode `
      --confirm 'RUN-RADAR-UNIFIED-RATING-INCREMENTAL-PRODUCTION-IMPORT-9988-V01'
    if ($LASTEXITCODE -ne 0) { throw "Incremental importer $Mode 失败。" }
  }
}

function Assert-PlanReceipt([object]$Receipt) {
  if (
    $Receipt.accepted -ne $true -or
    [string]$Receipt.mode -ne 'plan' -or
    [int]$Receipt.rows -ne 9988 -or
    [int]$Receipt.preImport.blockers -ne 0 -or
    [int]$Receipt.preImport.recordStatusCounts.ready_create -ne 9988 -or
    [int]$Receipt.preImport.ratingStatusCounts.ready_create -ne 9988 -or
    $Receipt.productionWrite -ne $false -or
    $Receipt.productionAuthorization -ne $false
  ) { throw '临时库 plan receipt 不符合 9,988 + 9,988 create-only 门。' }
}

function Assert-ApplyReceipt([object]$Receipt) {
  if (
    $Receipt.accepted -ne $true -or
    [string]$Receipt.mode -ne 'apply' -or
    [int]$Receipt.rows -ne 9988 -or
    [int]$Receipt.counts.recordCreate -ne 9988 -or
    [int]$Receipt.counts.ratingCreate -ne 9988 -or
    [int]$Receipt.counts.updateRequests -ne 0 -or
    [int]$Receipt.counts.putRequests -ne 0 -or
    [int]$Receipt.counts.deleteRequests -ne 0 -or
    [int]$Receipt.postImport.blockers -ne 0 -or
    [int]$Receipt.postImport.recordStatusCounts.already_current -ne 9988 -or
    [int]$Receipt.postImport.ratingStatusCounts.already_current -ne 9988
  ) { throw '临时库 apply receipt 不符合 9,988 + 9,988 收敛。' }
}

function Assert-VerifyReceipt([object]$Receipt) {
  if (
    $Receipt.accepted -ne $true -or
    [string]$Receipt.mode -ne 'verify' -or
    [int]$Receipt.postImport.blockers -ne 0 -or
    [int]$Receipt.postImport.recordStatusCounts.already_current -ne 9988 -or
    [int]$Receipt.postImport.ratingStatusCounts.already_current -ne 9988 -or
    $Receipt.productionWrite -ne $false -or
    $Receipt.productionAuthorization -ne $false
  ) { throw '临时库 verify receipt 不符合 already_current 收敛。' }
}

function Assert-PostCounts([hashtable]$Before, [hashtable]$After, [object]$Storage) {
  $increments = [ordered]@{
    'public.radar_public_records' = [long]$Storage.publicRecords
    'public.radar_public_records_facts' = [long]$Storage.facts
    'public.radar_public_records_evidence' = [long]$Storage.evidence
    'public.radar_public_records_facts_source_refs' = [long]$Storage.factSourceRefs
    'public.radar_public_ratings' = [long]$Storage.publicRatings
    'public.radar_public_ratings_matched_classes' = [long]$Storage.matchedClasses
    'public.radar_public_ratings_fact_refs' = [long]$Storage.ratingFactRefs
    'public.radar_public_ratings_evidence_refs' = [long]$Storage.ratingEvidenceRefs
    'public.radar_public_ratings_unresolved_dimensions' = [long]$Storage.unresolvedDimensions
    'public.radar_public_ratings_confirmation_basis' = [long]$Storage.confirmationBasis
    'public.radar_public_ratings_public_tag_hints' = [long]$Storage.publicTagHints
    'public.radar_public_ratings_public_warning_template_ids' = [long]$Storage.publicWarningTemplateIds
    'public.radar_public_ratings_human_review_proposed_profile_changes' = [long]$Storage.proposedProfileChanges
    'public.radar_public_ratings_human_review_additional_evidence_refs' = [long]$Storage.additionalEvidenceRefs
    'public.audit_events' = 19976
    'public.users_sessions' = 3
  }
  $beforeKeys = @($Before.Keys | Sort-Object)
  $afterKeys = @($After.Keys | Sort-Object)
  if (($beforeKeys -join "`n") -ne ($afterKeys -join "`n")) {
    throw '临时库 apply 前后表集合发生变化。'
  }
  foreach ($key in $Before.Keys) {
    $expected = [long]$Before[$key]
    if ($increments.Contains($key)) { $expected += [long]$increments[$key] }
    if ([long]$After[$key] -ne $expected) {
      throw "临时库行数增量错误：$key $($Before[$key]) -> $($After[$key]) expected=$expected"
    }
  }
}

function Restart-Containers([string[]]$Names) {
  foreach ($name in $Names) {
    & docker start $name *> $null
    if ($LASTEXITCODE -ne 0) { throw "恢复 writer 容器失败：$name" }
  }
}

$unexpectedDirty = @(Get-RadarDirtyPaths | Where-Object { $_ -notin $AllowedDirtyFiles })
if ($unexpectedDirty.Count -gt 0) {
  throw "存在预期外本地修改：$($unexpectedDirty -join ', ')"
}

git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取网站仓库远端更新失败。' }
git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '切换 9,988 条演练分支失败。' }
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新 9,988 条演练分支失败。' }
$currentBranch = (git branch --show-current).Trim()
$currentHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($currentBranch -ne $ExpectedBranch -or $currentHead -ne $ExpectedToolHead -or $remoteHead -ne $ExpectedToolHead) {
  throw "演练只允许精确 PR head：branch=$currentBranch local=$currentHead remote=$remoteHead expected=$ExpectedToolHead"
}
& git merge-base --is-ancestor $ExpectedBaseMain $ExpectedToolHead
if ($LASTEXITCODE -ne 0) { throw '演练分支不包含已合并的 575 条生产基线。' }

$transitionRoot = Join-Path $repoRoot 'data_local\outputs\radar-unified-rating-incremental-release-9988-v01'
$resolvedTransitionPlan = (Resolve-Path -LiteralPath $TransitionPlanDirectory).Path
if (-not ($resolvedTransitionPlan -eq $transitionRoot -or $resolvedTransitionPlan.StartsWith($transitionRoot + [IO.Path]::DirectorySeparatorChar))) {
  throw "Transition plan 必须位于：$transitionRoot"
}
$transitionSummaryPath = Join-Path $resolvedTransitionPlan 'transition-summary.json'
$transitionLedgerPath = Join-Path $resolvedTransitionPlan 'transition-ledger.jsonl'
$transitionBlockersPath = Join-Path $resolvedTransitionPlan 'blockers.json'
foreach ($file in @($transitionSummaryPath, $transitionLedgerPath, $transitionBlockersPath)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Transition plan 缺少文件：$file" }
}
$transitionSummary = Get-Content -LiteralPath $transitionSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$transitionBlockers = Get-Content -LiteralPath $transitionBlockersPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$transitionLedgerRows = @((Get-Content -LiteralPath $transitionLedgerPath -Encoding UTF8) | Where-Object { $_ })
if (
  $transitionSummary.accepted -ne $true -or
  [string]$transitionSummary.mainHead -ne $ExpectedBaseMain -or
  [string]$transitionSummary.researchHead -ne $ExpectedResearchHead -or
  [string]$transitionSummary.releaseId -ne $ReleaseId -or
  [int]$transitionSummary.sourceState.works -ne $ExpectedWorks -or
  [int]$transitionSummary.sourceState.currentPublicRecords -ne $ExpectedExistingRecords -or
  [int]$transitionSummary.sourceState.currentPublicRatings -ne $ExpectedExistingRatings -or
  [int]$transitionSummary.transition.rows -ne 9988 -or
  [int]$transitionSummary.transition.blockers -ne 0 -or
  [int]$transitionSummary.transition.recordStatusCounts.ready_create -ne 9988 -or
  [int]$transitionSummary.transition.ratingStatusCounts.ready_create -ne 9988 -or
  [int]$transitionSummary.transition.updates -ne 0 -or
  [int]$transitionSummary.transition.deletes -ne 0 -or
  [int]$transitionLedgerRows.Count -ne 9988 -or
  [int]@($transitionBlockers.blockers).Count -ne 0 -or
  $transitionSummary.safety.payloadContentWrite -ne $false -or
  [int]$transitionSummary.safety.recordCreateRequests -ne 0 -or
  [int]$transitionSummary.safety.ratingCreateRequests -ne 0 -or
  $transitionSummary.safety.productionAuthorization -ne $false
) { throw '绑定的 Transition plan 不符合精确 9,988 + 9,988 create-only 门。' }

$resolvedResearchRepo = (Resolve-Path -LiteralPath $ResearchRepo).Path
Push-Location $resolvedResearchRepo
try {
  git fetch origin
  if ($LASTEXITCODE -ne 0) { throw '获取研究仓库远端更新失败。' }
  git switch main
  if ($LASTEXITCODE -ne 0) { throw '切换研究仓库 main 失败。' }
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw '更新研究仓库 main 失败。' }
  $researchHead = (git rev-parse HEAD).Trim()
  $researchRemote = (git rev-parse origin/main).Trim()
  if ($researchHead -ne $ExpectedResearchHead -or $researchRemote -ne $ExpectedResearchHead) {
    throw "研究仓库提交不符合预期：local=$researchHead remote=$researchRemote expected=$ExpectedResearchHead"
  }
} finally {
  Pop-Location
}

$releaseDirectory = Join-Path $resolvedResearchRepo $ReleasePath
foreach ($entry in $ExpectedReleaseFiles.GetEnumerator()) {
  $file = Join-Path $releaseDirectory $entry.Key
  Assert-RadarFileHash $file $entry.Value "Release $($entry.Key)" | Out-Null
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$sourceRunning = ([string](& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') { throw '源 PostgreSQL 容器未运行。' }
$productionImage = ([string](& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer)).Trim()
$composeProject = ([string](& docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' $SourcePostgresContainer)).Trim()
if ([string]::IsNullOrWhiteSpace($composeProject) -or $composeProject -eq '<no value>') {
  throw '无法确认 Docker Compose project。'
}
$writerContainers = @(& docker ps --filter "label=com.docker.compose.project=$composeProject" --format '{{.Names}}' | Where-Object { $_ -and $_ -ne $SourcePostgresContainer })

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
  $securePassword = Read-Host '请输入现有 Payload 管理员密码（仅用于临时数据库）' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
if (-not $password) { throw 'Payload 管理员密码不能为空。' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-rating-incremental-release-9988-v01\rehearsal-v02-$stamp"
$backupDir = Join-Path $repoRoot 'data_local\backups\radar-unified-rating-incremental-release-9988-v01'
$evidenceDir = Join-Path $repoRoot "exports\radar-unified-rating-incremental-release-9988-v02-$stamp"
$evidenceZip = Join-Path $repoRoot "exports\RADAR-UNIFIED-RATING-INCREMENTAL-REHEARSAL-9988-V02-$stamp.zip"
New-Item -ItemType Directory -Path $outDir, $backupDir, $evidenceDir -Force | Out-Null
$stagePath = Join-Path $outDir 'rehearsal-stage-status.json'
$stage = [ordered]@{
  schemaVersion = 'radar-unified-rating-incremental-rehearsal-stage-9988-v02'
  startedAt = [DateTime]::UtcNow.ToString('o')
  toolHead = $ExpectedToolHead
  researchHead = $ExpectedResearchHead
  releaseId = $ReleaseId
  transitionPlanBound = $true
  sourceAuthenticationPerformed = $false
  sourcePayloadAccess = $false
  writersStopped = $false
  freshBackupCreated = $false
  writersRestartedAfterBackup = $false
  freshBackupRestored = $false
  restoredStateMatched = $false
  rehearsalPlanPassed = $false
  rehearsalApplyPassed = $false
  rehearsalVerifyPassed = $false
  postStorageVerified = $false
  protectedFingerprintsUnchanged = $false
  sourceFinalStateUnchanged = $false
  temporaryDatabaseDestroyed = $false
  sourceDatabaseWrite = $false
  productionAuthorization = $false
  automaticRollbackExecuted = $false
}
Write-RadarJsonFile $stagePath $stage

$sqlFiles = New-SnapshotSql $outDir
$tempContainer = "baihepailei-radar-incremental-rehearsal-v02-$stamp"
$tempUser = 'radar_incremental_lab'
$tempDatabase = 'radar_incremental_rehearsal'
$tempPassword = [Guid]::NewGuid().ToString('N')
$tempPort = Get-RadarFreePort 31000 31999
$tempDatabaseUrl = "postgresql://${tempUser}:${tempPassword}@127.0.0.1:${tempPort}/${tempDatabase}"
$tempCreated = $false
$app = $null
$writersRestarted = $false
$operationError = $null
$freshBackupPath = Join-Path $backupDir "source-before-incremental-rehearsal-v02-$stamp.dump"
$freshBackupContainerPath = "/tmp/source-before-incremental-rehearsal-v02-$stamp.dump"
$candidatePath = Join-Path $outDir 'radar-unified-rating-incremental-rehearsal-candidate-9988-v02.json'
$candidateSha256 = $null

try {
  foreach ($name in $writerContainers) {
    & docker stop -t 30 $name *> $null
    if ($LASTEXITCODE -ne 0) { throw "停止 writer 容器失败：$name" }
  }
  $stage.writersStopped = $true
  Write-RadarJsonFile $stagePath $stage
  Start-Sleep -Seconds 3

  $sourceBaseline = Get-Snapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $sqlFiles 'source-before-backup' $outDir
  Assert-SourceState $sourceBaseline $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' 'source-before-backup'

  & docker exec $SourcePostgresContainer pg_dump -Fc --no-owner --no-privileges `
    -U $SourceDatabaseUser -d $SourceDatabase -f $freshBackupContainerPath
  if ($LASTEXITCODE -ne 0) { throw '创建 fresh backup 失败。' }
  try {
    & docker cp "${SourcePostgresContainer}:$freshBackupContainerPath" $freshBackupPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '复制 fresh backup 失败。' }
  } finally {
    & docker exec $SourcePostgresContainer rm -f $freshBackupContainerPath 2>$null | Out-Null
  }
  $freshBackupBytes = [long](Get-Item -LiteralPath $freshBackupPath).Length
  $freshBackupSha256 = Get-FileSha $freshBackupPath
  if ($freshBackupBytes -le 0) { throw 'fresh backup 为空。' }
  $stage.freshBackupCreated = $true
  Write-RadarJsonFile $stagePath $stage

  $sourceAfterBackup = Get-Snapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $sqlFiles 'source-after-backup' $outDir
  Assert-RadarMapsEqual $sourceBaseline.Counts $sourceAfterBackup.Counts 'fresh backup 前后 source counts'
  Assert-RadarMapsEqual $sourceBaseline.Fingerprints $sourceAfterBackup.Fingerprints 'fresh backup 前后 source fingerprints'

  Restart-Containers $writerContainers
  $writersRestarted = $true
  $stage.writersRestartedAfterBackup = $true
  Write-RadarJsonFile $stagePath $stage

  $criticalCodePaths = @(
    'config/radar-unified-rating-incremental-release-9988-v01.lock.json',
    'scripts/radar/lib/public-release-plan-v01.mjs',
    'scripts/radar/lib/unified-rating-release-plan-v01.mjs',
    'scripts/radar/lib/radar-unified-release-production-0575-v01.ps1',
    'scripts/radar/run-unified-rating-incremental-production-import-9988-v01.mjs',
    'scripts/radar/rehearse-unified-rating-incremental-release-9988-v02.ps1',
    'src/app/(payload)/api/radar-unified-rating-incremental-production-marker/route.ts'
  )
  $criticalCode = @()
  $criticalLines = @()
  foreach ($relative in $criticalCodePaths) {
    $file = Join-Path $repoRoot $relative
    $hash = Get-FileSha $file
    $criticalCode += [ordered]@{ file = $relative; bytes = [long](Get-Item -LiteralPath $file).Length; sha256 = $hash }
    $criticalLines += "$hash  $relative"
  }
  $criticalManifestText = (($criticalLines -join "`n") + "`n")
  $criticalManifestPath = Join-Path $outDir 'critical-code-SHA256SUMS'
  [System.IO.File]::WriteAllText($criticalManifestPath, $criticalManifestText, [System.Text.UTF8Encoding]::new($false))
  $criticalManifestSha256 = Get-TextSha $criticalManifestText

  $candidate = [ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-rehearsal-candidate-9988-v02'
    accepted = $true
    generatedAt = [DateTime]::UtcNow.ToString('o')
    toolHead = $ExpectedToolHead
    baseMain = $ExpectedBaseMain
    researchHead = $ExpectedResearchHead
    releaseId = $ReleaseId
    releaseDirectory = $releaseDirectory
    releaseFiles = $ExpectedReleaseFiles
    transitionPlan = [ordered]@{
      directory = $resolvedTransitionPlan
      summaryPath = $transitionSummaryPath
      summarySha256 = Get-FileSha $transitionSummaryPath
      ledgerPath = $transitionLedgerPath
      ledgerRows = $transitionLedgerRows.Count
      ledgerSha256 = Get-FileSha $transitionLedgerPath
      blockersPath = $transitionBlockersPath
      blockersSha256 = Get-FileSha $transitionBlockersPath
    }
    source = [ordered]@{
      postgresContainer = $SourcePostgresContainer
      database = $SourceDatabase
      works = $ExpectedWorks
      publicRecords = $ExpectedExistingRecords
      publicRatings = $ExpectedExistingRatings
      countsPath = $sourceBaseline.CountsPath
      countsSha256 = Get-FileSha $sourceBaseline.CountsPath
      fingerprintsPath = $sourceBaseline.FingerprintsPath
      fingerprintsSha256 = Get-FileSha $sourceBaseline.FingerprintsPath
      authenticationPerformed = $false
      payloadAccess = $false
    }
    freshBackup = [ordered]@{
      path = $freshBackupPath
      bytes = $freshBackupBytes
      sha256 = $freshBackupSha256
    }
    expectedTransition = [ordered]@{
      recordsReadyCreate = 9988
      ratingsReadyCreate = 9988
      updates = 0
      deletes = 0
      blockers = 0
    }
    expectedStorage = $transitionSummary.expectedStorage
    criticalCodeFiles = $criticalCode
    criticalCodeManifestSha256 = $criticalManifestSha256
    sourceDatabaseWrite = $false
    productionAuthorization = $false
    decision = 'accept_incremental_release_for_temporary_database_rehearsal_only'
  }
  Write-RadarJsonFile $candidatePath $candidate
  $candidateSha256 = Get-FileSha $candidatePath

  & docker run -d --name $tempContainer -p "127.0.0.1:${tempPort}:5432" `
    -e "POSTGRES_USER=$tempUser" -e "POSTGRES_PASSWORD=$tempPassword" -e 'POSTGRES_DB=postgres' $productionImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '启动临时 PostgreSQL 失败。' }
  $tempCreated = $true
  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  $tempReady = $false
  do {
    Start-Sleep -Seconds 2
    & docker exec -e "PGPASSWORD=$tempPassword" $tempContainer pg_isready -U $tempUser -d postgres | Out-Null
    $tempReady = $LASTEXITCODE -eq 0
  } while (-not $tempReady -and [DateTime]::UtcNow -lt $deadline)
  if (-not $tempReady) { throw '临时 PostgreSQL 未就绪。' }

  & docker exec -e "PGPASSWORD=$tempPassword" $tempContainer createdb -U $tempUser -T template0 $tempDatabase
  if ($LASTEXITCODE -ne 0) { throw '创建临时数据库失败。' }
  & docker cp $freshBackupPath "${tempContainer}:/tmp/source.dump" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 fresh backup 到临时 PostgreSQL 失败。' }
  & docker exec -e "PGPASSWORD=$tempPassword" $tempContainer pg_restore -U $tempUser -d $tempDatabase `
    --no-owner --no-privileges --exit-on-error /tmp/source.dump
  if ($LASTEXITCODE -ne 0) { throw '恢复 fresh backup 到临时数据库失败。' }
  $stage.freshBackupRestored = $true
  Write-RadarJsonFile $stagePath $stage

  $restoredBaseline = Get-Snapshot $tempContainer $tempDatabase $tempUser $tempPassword $sqlFiles 'temporary-restored' $outDir
  Assert-RadarMapsEqual $sourceBaseline.Counts $restoredBaseline.Counts 'source → temporary restored counts'
  Assert-RadarMapsEqual $sourceBaseline.Fingerprints $restoredBaseline.Fingerprints 'source → temporary restored fingerprints'
  Assert-SourceState $restoredBaseline $tempContainer $tempDatabase $tempUser $tempPassword 'temporary-restored'
  $stage.restoredStateMatched = $true
  Write-RadarJsonFile $stagePath $stage

  foreach ($mode in @('plan', 'apply', 'verify')) {
    $nonce = [Guid]::NewGuid().ToString('N')
    $app = Start-TemporaryApp $tempDatabaseUrl $tempDatabase $mode $nonce $candidateSha256 "temporary-$mode" $outDir
    $importDir = Join-Path $outDir "temporary-$mode-import"
    Invoke-IncrementalImporter $mode $app.BaseUrl $tempDatabase $nonce $email $password $releaseDirectory $candidateSha256 $importDir
    Stop-RadarProcess $app.Process
    $app = $null
    $receipt = Get-Content -LiteralPath (Join-Path $importDir 'accepted-receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
    if ($mode -eq 'plan') {
      Assert-PlanReceipt $receipt
      $stage.rehearsalPlanPassed = $true
    } elseif ($mode -eq 'apply') {
      Assert-ApplyReceipt $receipt
      $applyReceipt = $receipt
      $stage.rehearsalApplyPassed = $true
    } else {
      Assert-VerifyReceipt $receipt
      $stage.rehearsalVerifyPassed = $true
    }
    Write-RadarJsonFile $stagePath $stage
  }

  $temporaryPost = Get-Snapshot $tempContainer $tempDatabase $tempUser $tempPassword $sqlFiles 'temporary-post-apply' $outDir
  Assert-PostCounts $restoredBaseline.Counts $temporaryPost.Counts $applyReceipt.expectedStorage
  $stage.postStorageVerified = $true
  Assert-RadarMapsEqual $restoredBaseline.Fingerprints $temporaryPost.Fingerprints 'temporary protected fingerprints'
  $stage.protectedFingerprintsUnchanged = $true
  Write-RadarJsonFile $stagePath $stage

  & docker rm -f $tempContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '销毁临时 PostgreSQL 失败。' }
  $tempCreated = $false
  $stage.temporaryDatabaseDestroyed = $true
  Write-RadarJsonFile $stagePath $stage

  $sourceFinal = Get-Snapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $sqlFiles 'source-final' $outDir
  Assert-RadarMapsEqual $sourceBaseline.Counts $sourceFinal.Counts 'rehearsal 前后 source counts'
  Assert-RadarMapsEqual $sourceBaseline.Fingerprints $sourceFinal.Fingerprints 'rehearsal 前后 source fingerprints'
  Assert-SourceState $sourceFinal $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' 'source-final'
  $stage.sourceFinalStateUnchanged = $true
  Write-RadarJsonFile $stagePath $stage

  $acceptance = [ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-rehearsal-acceptance-9988-v02'
    accepted = $true
    completedAt = [DateTime]::UtcNow.ToString('o')
    toolHead = $ExpectedToolHead
    baseMain = $ExpectedBaseMain
    researchHead = $ExpectedResearchHead
    releaseId = $ReleaseId
    candidatePath = $candidatePath
    candidateSha256 = $candidateSha256
    transitionPlanDirectory = $resolvedTransitionPlan
    transitionSummarySha256 = Get-FileSha $transitionSummaryPath
    transitionLedgerSha256 = Get-FileSha $transitionLedgerPath
    freshBackupPath = $freshBackupPath
    freshBackupBytes = $freshBackupBytes
    freshBackupSha256 = $freshBackupSha256
    sourceState = [ordered]@{
      works = $ExpectedWorks
      publicRecords = $ExpectedExistingRecords
      publicRatings = $ExpectedExistingRatings
      authenticationPerformed = $false
      payloadAccess = $false
    }
    rehearsal = [ordered]@{
      publicRecordsCreated = 9988
      publicRatingsCreated = 9988
      postRecordsAlreadyCurrent = 9988
      postRatingsAlreadyCurrent = 9988
      blockers = 0
      updates = 0
      deletes = 0
    }
    expectedStorage = $applyReceipt.expectedStorage
    protectedFingerprintsUnchanged = $true
    sourceCountsUnchanged = $true
    sourceDatabaseWrite = $false
    temporaryDatabaseDestroyed = $true
    automaticRetryAllowed = $false
    automaticRollbackExecuted = $false
    productionAuthorization = $false
    decision = 'accept_incremental_release_9988_for_production_candidate_preparation_only'
  }
  Write-RadarJsonFile (Join-Path $outDir 'rehearsal-acceptance.json') $acceptance

  Copy-Item -Path (Join-Path $outDir '*') -Destination $evidenceDir -Recurse -Force
  Write-RadarManifest $evidenceDir
  Compress-Archive -Path (Join-Path $evidenceDir '*') -DestinationPath $evidenceZip -CompressionLevel Optimal -Force
} catch {
  $operationError = $_
} finally {
  if ($app) { Stop-RadarProcess $app.Process }
  if ($tempCreated) { & docker rm -f $tempContainer 2>$null | Out-Null }
  if (-not $writersRestarted) {
    try {
      Restart-Containers $writerContainers
      $writersRestarted = $true
      $stage.writersRestartedAfterBackup = $true
      Write-RadarJsonFile $stagePath $stage
    } catch {
      if ($null -eq $operationError) { $operationError = $_ }
    }
  }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $password = $null
  $securePassword = $null
}

if ($null -ne $operationError) {
  Write-RadarJsonFile (Join-Path $outDir 'rehearsal-failure.json') ([ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-rehearsal-failure-9988-v02'
    failedAt = [DateTime]::UtcNow.ToString('o')
    message = $operationError.Exception.Message
    transitionPlanDirectory = $resolvedTransitionPlan
    candidatePath = $candidatePath
    candidateSha256 = $candidateSha256
    freshBackupPath = $freshBackupPath
    writerContainersRestarted = $writersRestarted
    sourceAuthenticationPerformed = $false
    sourcePayloadAccess = $false
    sourceDatabaseWrite = $false
    productionAuthorization = $false
    automaticRetryAllowed = $false
    automaticRollbackExecuted = $false
    operatorMustInspectBeforeRetry = $true
  })
  throw $operationError
}

$evidenceSha256 = Get-FileSha $evidenceZip
Write-Host ''
Write-Host '9,988 条增量 Release 临时数据库演练 V02 已完成。' -ForegroundColor Green
Write-Host "ToolHead                 : $ExpectedToolHead"
Write-Host "ResearchHead             : $ExpectedResearchHead"
Write-Host 'PublicRecordsCreated     : 9988'
Write-Host 'PublicRatingsCreated     : 9988'
Write-Host 'PostRecordsAlreadyCurrent: 9988'
Write-Host 'PostRatingsAlreadyCurrent: 9988'
Write-Host 'SourceAuthentication     : False'
Write-Host 'SourcePayloadAccess      : False'
Write-Host 'SourceDatabaseWrite      : False'
Write-Host 'ProductionAuthorization  : False'
Write-Host "FreshBackup              : $freshBackupPath"
Write-Host "Candidate                : $candidatePath"
Write-Host "CandidateSHA256          : $candidateSha256"
Write-Host "EvidenceBundle           : $evidenceZip"
Write-Host "EvidenceSHA256           : $evidenceSha256"
