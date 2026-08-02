param(
  [Parameter(Mandatory = $true)][string]$Candidate,
  [Parameter(Mandatory = $true)][string]$ExpectedToolHead,
  [Parameter(Mandatory = $true)][ValidateSet('REHEARSE-RADAR-UNIFIED-RELEASE-PRODUCTION-GATE-0575-V01')][string]$Confirm,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-unified-release-production-0575-v01'
$ReleaseId = 'RADAR-UNIFIED-RATING-RELEASE-0575-0001'
$ExpectedCandidateSha256 = '0b18c33987abe2c2eb0c2280acee789415396903d697aface2523312a334de31'
$ExpectedResearchHead = '728ad2da5f7d3aba03f652b9fd701157b06793ee'
$ExpectedEvidenceSha256 = '59dc908a447500adb39ef9f72bde306268fdf24ec85fdaaeb418dee0fb9be09f'
$ExpectedLegacySchemaSha256 = 'bb4bc33661c989e91dc7fda964f4023f3ef175582fe9e95449f568348eb17c7d'
$ExpectedP1BackupBytes = 29729702
$ExpectedP1BackupSha256 = 'ea0b1cb68c9f1fde91e5e9f10c12957469b30c37a29097c57cb18fa8b5b13751'
$ExpectedMigrationRows = @(
  "20260718_072813_existing_schema_baseline_v01`t1",
  "20260718_072843_stewardship_notices_v01`t1",
  "dev`t-1"
)
$ExpectedFinalMigrationNames = @(
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
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$CriticalFiles = @(
  'scripts/radar/execute-radar-unified-release-production-0575-v01.ps1',
  'scripts/radar/execute-radar-unified-release-production-0575-v02.ps1',
  'scripts/radar/run-unified-release-production-import-0575-v01.mjs',
  'scripts/radar/lib/radar-unified-release-production-0575-v01.ps1',
  'src/app/(payload)/api/radar-unified-release-production-marker/route.ts'
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
. (Join-Path $PSScriptRoot 'lib\radar-unified-release-production-0575-v01.ps1')

function Invoke-RehearsalSqlText(
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

function Get-RehearsalMigrationRows([string]$Container, [string]$Database, [string]$User, [string]$Password) {
  $args = @('exec')
  if (-not [string]::IsNullOrWhiteSpace($Password)) { $args += @('-e', "PGPASSWORD=$Password") }
  $args += @(
    '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning',
    $Container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', $User, '-d', $Database,
    '-c', "SELECT name || E'\t' || batch::text FROM public.payload_migrations ORDER BY name, batch;"
  )
  $rows = @(& docker @args)
  if ($LASTEXITCODE -ne 0) { throw '读取 migration rows 失败。' }
  return $rows
}

function Assert-RehearsalMigrationRows([string[]]$Actual, [string[]]$Expected, [string]$Label) {
  if (($Actual -join "`n") -ne ($Expected -join "`n")) { throw "$Label migration rows 不匹配。" }
}

function Assert-RehearsalMigrationNames([string[]]$Rows, [string[]]$Expected, [string]$Label) {
  $actualNames = @($Rows | ForEach-Object { ([string]$_).Split("`t")[0] } | Sort-Object)
  $expectedNames = @($Expected | Sort-Object)
  if (($actualNames -join "`n") -ne ($expectedNames -join "`n")) { throw "$Label migration names 不匹配。" }
}

function Get-RehearsalSnapshot(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$CandidateDirectory,
  [string]$Prefix,
  [string]$Directory
) {
  $counts = Join-Path $Directory "$Prefix-table-counts.tsv"
  $fingerprints = Join-Path $Directory "$Prefix-protected-fingerprints.tsv"
  Invoke-RadarSqlFile $Container $Database $User $Password `
    (Join-Path $CandidateDirectory 'table-counts.sql') "/tmp/$Prefix-counts.sql" `
    $counts (Join-Path $Directory "$Prefix-counts-stderr.txt") -ReadOnly
  Invoke-RadarSqlFile $Container $Database $User $Password `
    (Join-Path $CandidateDirectory 'protected-fingerprints.sql') "/tmp/$Prefix-fingerprints.sql" `
    $fingerprints (Join-Path $Directory "$Prefix-fingerprints-stderr.txt") -ReadOnly
  return [pscustomobject]@{
    CountsPath = $counts
    FingerprintsPath = $fingerprints
    Counts = Read-RadarMapFile $counts
    Fingerprints = Read-RadarMapFile $fingerprints
  }
}

function Assert-RehearsalInitialState([object]$Snapshot, [string]$Label) {
  if ([long]$Snapshot.Counts['public.works'] -ne 35615) { throw "$Label Works 数量不匹配。" }
  $targets = @($Snapshot.Counts.Keys | Where-Object {
    $_ -like 'public.radar_public_records*' -or
    $_ -like 'public.radar_public_ratings*' -or
    $_ -eq 'public.radar_unified_release_apply_control'
  })
  if ($targets.Count -ne 0) { throw "$Label 已存在目标表：$($targets -join ', ')" }
}

function New-RehearsalMarker(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$CodeManifestSha256,
  [string]$Prefix,
  [string]$Directory
) {
  $sql = @"
BEGIN;
DO `$marker`$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('$ReleaseId', 0)) THEN
    RAISE EXCEPTION 'rehearsal advisory lock is busy';
  END IF;
  IF to_regclass('public.radar_unified_release_apply_control') IS NOT NULL THEN
    RAISE EXCEPTION 'apply control table already exists';
  END IF;
END
`$marker`$;
CREATE TABLE public.radar_unified_release_apply_control (
  release_id text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('started', 'completed', 'failed')),
  main_head text NOT NULL,
  candidate_sha256 text NOT NULL,
  evidence_sha256 text NOT NULL,
  code_manifest_sha256 text NOT NULL,
  p1_backup_sha256 text NOT NULL,
  fresh_backup_sha256 text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failure_stage text
);
INSERT INTO public.radar_unified_release_apply_control (
  release_id, state, main_head, candidate_sha256, evidence_sha256,
  code_manifest_sha256, p1_backup_sha256, fresh_backup_sha256
) VALUES (
  '$ReleaseId', 'started', '$ExpectedToolHead', '$ExpectedCandidateSha256',
  '$ExpectedEvidenceSha256', '$CodeManifestSha256',
  '$ExpectedP1BackupSha256', '$ExpectedP1BackupSha256'
);
COMMIT;
"@
  Invoke-RehearsalSqlText $Container $Database $User $Password $sql "$Prefix-create-marker" $Directory | Out-Null
}

function Complete-RehearsalMarker(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$Prefix,
  [string]$Directory
) {
  $sql = @"
BEGIN;
DO `$check`$
BEGIN
  UPDATE public.radar_unified_release_apply_control
  SET state = 'completed', completed_at = now(), failure_stage = NULL
  WHERE release_id = '$ReleaseId' AND state = 'started';
  IF NOT FOUND THEN RAISE EXCEPTION 'rehearsal marker completion failed'; END IF;
END
`$check`$;
COMMIT;
"@
  Invoke-RehearsalSqlText $Container $Database $User $Password $sql "$Prefix-complete-marker" $Directory | Out-Null
}

function Invoke-RehearsalMigrationReconciliation(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$Prefix,
  [string]$Directory
) {
  Assert-RehearsalMigrationRows (Get-RehearsalMigrationRows $Container $Database $User $Password) $ExpectedMigrationRows "$Prefix pre-reconciliation"
  $legacySchema = Get-RadarNormalizedLegacySchema $Container $Database $User $Password
  $legacyPath = Join-Path $Directory "$Prefix-legacy-schema.sql"
  [System.IO.File]::WriteAllText($legacyPath, $legacySchema, [System.Text.UTF8Encoding]::new($false))
  $legacyHash = (Get-FileHash -LiteralPath $legacyPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($legacyHash -ne $ExpectedLegacySchemaSha256) { throw "$Prefix legacy schema SHA-256 不匹配：$legacyHash" }
  $sql = @'
BEGIN;
LOCK TABLE public.payload_migrations IN ACCESS EXCLUSIVE MODE;
DO $gate$
DECLARE dev_count integer; historical_count integer; later_count integer;
BEGIN
  SELECT count(*) INTO dev_count FROM public.payload_migrations WHERE name = 'dev' AND batch = -1;
  SELECT count(*) INTO historical_count FROM public.payload_migrations
    WHERE name IN ('20260723_141905_current_schema_baseline_before_radar_public_v01', '20260723_141908_radar_public_conclusions_v01');
  SELECT count(*) INTO later_count FROM public.payload_migrations
    WHERE name IN (
      '20260801_101546_current_schema_baseline_before_radar_public_records_v01',
      '20260801_101551_radar_public_records_v01',
      '20260802_030535_radar_public_ratings_v01',
      '20260802_045057_radar_public_record_fact_value_text_v01',
      '20260802_062015_radar_public_record_evidence_role_v01'
    );
  IF dev_count <> 1 OR historical_count <> 0 OR later_count <> 0 THEN
    RAISE EXCEPTION 'migration reconciliation precondition failed';
  END IF;
END
$gate$;
DELETE FROM public.payload_migrations WHERE name = 'dev' AND batch = -1;
INSERT INTO public.payload_migrations (name, batch, updated_at, created_at) VALUES
  ('20260723_141905_current_schema_baseline_before_radar_public_v01', 2, now(), now()),
  ('20260723_141908_radar_public_conclusions_v01', 2, now(), now());
COMMIT;
'@
  Invoke-RehearsalSqlText $Container $Database $User $Password $sql "$Prefix-reconcile-migrations" $Directory | Out-Null
}

function Invoke-RehearsalPayloadMigrations([string]$DatabaseUrl, [string]$Directory) {
  Invoke-RadarWithEnvironment -Variables @{
    DATABASE_URL = $DatabaseUrl
    PAYLOAD_DB_PUSH = 'false'
    STEWARDSHIP_NOTICES_SCHEMA_READY = 'true'
    RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
  } -Action {
    pnpm payload migrate 1> (Join-Path $Directory 'rehearsal-payload-migrate-stdout.txt') 2> (Join-Path $Directory 'rehearsal-payload-migrate-stderr.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Rehearsal Payload migrations 失败。' }
  }
}

function Start-RehearsalPayloadApp(
  [string]$DatabaseUrl,
  [string]$DatabaseName,
  [string]$Nonce,
  [string]$Directory
) {
  $port = Get-RadarFreePort 32000 39999
  $baseUrl = "http://127.0.0.1:$port"
  $pnpmCommand = if ($IsWindows) { (Get-Command pnpm.cmd -ErrorAction Stop).Source } else { (Get-Command pnpm -ErrorAction Stop).Source }
  $process = $null
  Invoke-RadarWithEnvironment -Variables @{
    DATABASE_URL = $DatabaseUrl
    PAYLOAD_DB_PUSH = 'false'
    STEWARDSHIP_NOTICES_SCHEMA_READY = 'true'
    RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
    NEXT_PUBLIC_SERVER_URL = $baseUrl
    RADAR_UNIFIED_RELEASE_PRODUCTION_MODE = 'true'
    RADAR_UNIFIED_RELEASE_PRODUCTION_NONCE = $Nonce
    RADAR_UNIFIED_RELEASE_PRODUCTION_PHASE = 'apply'
    RADAR_UNIFIED_RELEASE_PRODUCTION_DATABASE = $DatabaseName
    RADAR_UNIFIED_RELEASE_PRODUCTION_MAIN_HEAD = $ExpectedToolHead
    RADAR_UNIFIED_RELEASE_PRODUCTION_RESEARCH_HEAD = $ExpectedResearchHead
    RADAR_UNIFIED_RELEASE_PRODUCTION_RELEASE_ID = $ReleaseId
    RADAR_UNIFIED_RELEASE_PRODUCTION_CANDIDATE_SHA256 = $ExpectedCandidateSha256
  } -Action {
    $script:process = Start-Process -FilePath $pnpmCommand `
      -ArgumentList @('exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', [string]$port) `
      -WorkingDirectory $repoRoot `
      -RedirectStandardOutput (Join-Path $Directory 'rehearsal-app-stdout.txt') `
      -RedirectStandardError (Join-Path $Directory 'rehearsal-app-stderr.txt') `
      -PassThru -NoNewWindow
  }
  Wait-RadarProductionMarker $baseUrl $Nonce 'apply' $DatabaseName $ExpectedToolHead $ExpectedResearchHead $ReleaseId $ExpectedCandidateSha256 $process $ReadyTimeoutSeconds | Out-Null
  return [pscustomobject]@{ Process = $process; BaseUrl = $baseUrl }
}

function Assert-RehearsalReceipt([object]$Receipt) {
  if (
    $Receipt.accepted -ne $true -or
    [string]$Receipt.mode -ne 'apply' -or
    [int]$Receipt.rows -ne 575 -or
    [int]$Receipt.counts.factCreate -ne 575 -or
    [int]$Receipt.counts.ratingCreate -ne 575 -or
    [int]$Receipt.counts.updateRequests -ne 0 -or
    [int]$Receipt.counts.putRequests -ne 0 -or
    [int]$Receipt.counts.deleteRequests -ne 0 -or
    [int]$Receipt.postImport.blockers -ne 0 -or
    [int]$Receipt.postImport.recordStatusCounts.already_current -ne 575 -or
    [int]$Receipt.postImport.ratingStatusCounts.already_current -ne 575
  ) { throw 'Rehearsal importer receipt 不符合 575 + 575 收敛。' }
}

function Assert-RehearsalPostCounts([hashtable]$Before, [hashtable]$After, [object]$Storage) {
  foreach ($key in $Before.Keys) {
    if (-not $After.ContainsKey($key)) { throw "Rehearsal 缺少原表：$key" }
    $beforeValue = [long]$Before[$key]
    $afterValue = [long]$After[$key]
    if ($key -eq 'public.audit_events') {
      if ($afterValue -ne $beforeValue + 1150) { throw 'Rehearsal audit_events 增量错误。' }
    } elseif ($key -eq 'public.payload_migrations') {
      if ($afterValue -ne $beforeValue + 6) { throw 'Rehearsal payload_migrations 净增量错误。' }
    } elseif ($key -eq 'public.users_sessions') {
      if ($afterValue -ne $beforeValue + 1) { throw 'Rehearsal users_sessions 增量错误。' }
    } elseif ($afterValue -ne $beforeValue) {
      throw "Rehearsal 原表发生预期外变化：$key"
    }
  }
  $expectedNew = [ordered]@{
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
    'public.radar_unified_release_apply_control' = 1
  }
  $newKeys = @($After.Keys | Where-Object { -not $Before.ContainsKey($_) } | Sort-Object)
  if (($newKeys -join "`n") -ne (@($expectedNew.Keys | Sort-Object) -join "`n")) { throw 'Rehearsal 新表集合不匹配。' }
  foreach ($key in $expectedNew.Keys) {
    if ([long]$After[$key] -ne [long]$expectedNew[$key]) { throw "Rehearsal 新表行数不匹配：$key" }
  }
}

if ($Confirm -ne 'REHEARSE-RADAR-UNIFIED-RELEASE-PRODUCTION-GATE-0575-V01') { throw '演练确认字符串不匹配。' }
if ($ExpectedToolHead -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedToolHead 格式无效。' }
$unexpectedDirty = @(Get-RadarDirtyPaths | Where-Object { $_ -notin $AllowedDirtyFiles })
if ($unexpectedDirty.Count -gt 0) { throw "存在预期外本地修改：$($unexpectedDirty -join ', ')" }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端状态失败。' }
$currentBranch = (git branch --show-current).Trim()
$currentHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($currentBranch -ne $ExpectedBranch -or $currentHead -ne $ExpectedToolHead -or $remoteHead -ne $ExpectedToolHead) {
  throw "演练只允许精确 PR 分支：branch=$currentBranch local=$currentHead remote=$remoteHead"
}

$candidatePath = (Resolve-Path -LiteralPath $Candidate).Path
Assert-RadarFileHash $candidatePath $ExpectedCandidateSha256 'production candidate' | Out-Null
$candidateJson = Get-Content -LiteralPath $candidatePath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if (
  [string]$candidateJson.schemaVersion -ne 'radar-unified-release-production-candidate-0575-v01' -or
  [string]$candidateJson.researchHead -ne $ExpectedResearchHead -or
  [string]$candidateJson.releaseId -ne $ReleaseId -or
  [string]$candidateJson.evidenceSha256 -ne $ExpectedEvidenceSha256 -or
  [long]$candidateJson.backupBytes -ne $ExpectedP1BackupBytes -or
  [string]$candidateJson.backupSha256 -ne $ExpectedP1BackupSha256 -or
  $candidateJson.sourceDatabaseWrite -ne $false -or
  $candidateJson.productionAuthorization -ne $false -or
  $candidateJson.accepted -ne $true
) { throw 'Candidate 不符合已验收绑定。' }

$backupPath = (Resolve-Path -LiteralPath ([string]$candidateJson.backupPath)).Path
if ([long](Get-Item -LiteralPath $backupPath).Length -ne $ExpectedP1BackupBytes) { throw 'P1 backup 大小不匹配。' }
Assert-RadarFileHash $backupPath $ExpectedP1BackupSha256 'P1 backup' | Out-Null
Assert-RadarFileHash ([string]$candidateJson.evidenceZip) $ExpectedEvidenceSha256 'evidence ZIP' | Out-Null
$candidateDirectory = Split-Path -Parent $candidatePath
$releaseDirectory = (Resolve-Path -LiteralPath ([string]$candidateJson.releaseDirectory)).Path

$email = Get-RadarConfiguredValue @('RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL', 'SITE_OWNER_EMAIL')
$password = Get-RadarConfiguredValue @('RADAR_PAYLOAD_PASSWORD', 'PAYLOAD_EXPORT_PASSWORD', 'PAYLOAD_SEED_PASSWORD')
$securePassword = $null
$bstr = [IntPtr]::Zero
if (-not $email) { throw '无法解析 Payload 管理员邮箱。' }
if (-not $password) {
  $securePassword = Read-Host '请输入现有 Payload 管理员密码' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}

$postgresRunning = ([string](& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $postgresRunning -ne 'true') { throw '源 PostgreSQL 容器未运行。' }
$productionImage = ([string](& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer)).Trim()
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-release-production-0575-v01\gate-rehearsal-$stamp"
$evidenceDir = Join-Path $repoRoot "exports\radar-unified-release-production-gate-rehearsal-0575-$stamp"
$evidenceZip = Join-Path $repoRoot "exports\RADAR-UNIFIED-RELEASE-PRODUCTION-GATE-REHEARSAL-0575-$stamp.zip"
New-Item -ItemType Directory -Path $outDir, $evidenceDir -Force | Out-Null

$criticalLines = @()
foreach ($relative in $CriticalFiles) {
  $file = Join-Path $repoRoot $relative
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "缺少关键代码：$relative" }
  $criticalLines += "$((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant())  $relative"
}
$codeManifestPath = Join-Path $outDir 'critical-code-SHA256SUMS'
[System.IO.File]::WriteAllText($codeManifestPath, (($criticalLines -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))
$codeManifestSha256 = (Get-FileHash -LiteralPath $codeManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

$tempContainer = "baihepailei-radar-production-gate-rehearsal-$stamp"
$tempUser = 'radar_gate_rehearsal'
$tempDatabase = 'radar_unified_release_gate_rehearsal'
$tempPassword = [Guid]::NewGuid().ToString('N')
$tempPort = Get-RadarFreePort 31000 31999
$tempDatabaseUrl = "postgresql://${tempUser}:${tempPassword}@127.0.0.1:${tempPort}/${tempDatabase}"
$tempCreated = $false
$app = $null
$success = $false

try {
  $sourceBefore = Get-RehearsalSnapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $candidateDirectory 'source-before-rehearsal' $outDir
  Assert-RehearsalInitialState $sourceBefore 'source before rehearsal'
  Assert-RadarMapsEqual (Read-RadarMapFile ([string]$candidateJson.sourceCountsPath)) $sourceBefore.Counts 'candidate → source counts'
  Assert-RadarMapsEqual (Read-RadarMapFile ([string]$candidateJson.sourceFingerprintsPath)) $sourceBefore.Fingerprints 'candidate → source fingerprints'
  Assert-RehearsalMigrationRows (Get-RehearsalMigrationRows $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '') $ExpectedMigrationRows 'source before rehearsal'

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
  & docker cp $backupPath "${tempContainer}:/tmp/p1-backup.dump" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 P1 backup 到临时容器失败。' }
  & docker exec -e "PGPASSWORD=$tempPassword" $tempContainer pg_restore -U $tempUser -d $tempDatabase --no-owner --no-privileges --exit-on-error /tmp/p1-backup.dump
  if ($LASTEXITCODE -ne 0) { throw '恢复 P1 backup 失败。' }

  $restored = Get-RehearsalSnapshot $tempContainer $tempDatabase $tempUser $tempPassword $candidateDirectory 'rehearsal-restored' $outDir
  Assert-RadarMapsEqual $sourceBefore.Counts $restored.Counts 'source → restored counts'
  Assert-RadarMapsEqual $sourceBefore.Fingerprints $restored.Fingerprints 'source → restored fingerprints'
  New-RehearsalMarker $tempContainer $tempDatabase $tempUser $tempPassword $codeManifestSha256 'rehearsal' $outDir
  Invoke-RehearsalMigrationReconciliation $tempContainer $tempDatabase $tempUser $tempPassword 'rehearsal' $outDir
  Invoke-RehearsalPayloadMigrations $tempDatabaseUrl $outDir
  Assert-RehearsalMigrationNames (Get-RehearsalMigrationRows $tempContainer $tempDatabase $tempUser $tempPassword) $ExpectedFinalMigrationNames 'rehearsal after migrations'

  $nonce = [Guid]::NewGuid().ToString('N')
  $app = Start-RehearsalPayloadApp $tempDatabaseUrl $tempDatabase $nonce $outDir
  $importDir = Join-Path $outDir 'import'
  Invoke-RadarWithEnvironment -Variables @{
    RADAR_UNIFIED_RELEASE_PRODUCTION_NONCE = $nonce
    RADAR_PAYLOAD_EMAIL = $email
    RADAR_PAYLOAD_PASSWORD = $password
  } -Action {
    node '.\scripts\radar\run-unified-release-production-import-0575-v01.mjs' `
      --input $releaseDirectory `
      --url $app.BaseUrl `
      --out-dir $importDir `
      --mode 'apply' `
      --expected-main-head $ExpectedToolHead `
      --expected-research-head $ExpectedResearchHead `
      --expected-database $tempDatabase `
      --expected-candidate-sha256 $ExpectedCandidateSha256 `
      --expected-phase 'apply' `
      --confirm 'RUN-RADAR-UNIFIED-RELEASE-PRODUCTION-IMPORT-0575-V01'
    if ($LASTEXITCODE -ne 0) { throw '临时生产 importer 演练失败。' }
  }
  Stop-RadarProcess $app.Process
  $app = $null
  $receipt = Get-Content -LiteralPath (Join-Path $importDir 'accepted-receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  Assert-RehearsalReceipt $receipt
  Complete-RehearsalMarker $tempContainer $tempDatabase $tempUser $tempPassword 'rehearsal' $outDir

  $post = Get-RehearsalSnapshot $tempContainer $tempDatabase $tempUser $tempPassword $candidateDirectory 'rehearsal-post-apply' $outDir
  Assert-RehearsalPostCounts $restored.Counts $post.Counts $receipt.expectedStorage
  Assert-RadarMapsEqual $restored.Fingerprints $post.Fingerprints 'rehearsal protected fingerprints'

  $sourceAfter = Get-RehearsalSnapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $candidateDirectory 'source-after-rehearsal' $outDir
  Assert-RadarMapsEqual $sourceBefore.Counts $sourceAfter.Counts 'source before/after rehearsal counts'
  Assert-RadarMapsEqual $sourceBefore.Fingerprints $sourceAfter.Fingerprints 'source before/after rehearsal fingerprints'
  Assert-RehearsalMigrationRows (Get-RehearsalMigrationRows $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '') $ExpectedMigrationRows 'source after rehearsal'

  Write-RadarJsonFile (Join-Path $outDir 'gate-rehearsal-acceptance.json') ([ordered]@{
    schemaVersion = 'radar-unified-release-production-gate-rehearsal-0575-v01'
    accepted = $true
    completedAt = [DateTime]::UtcNow.ToString('o')
    toolHead = $ExpectedToolHead
    researchHead = $ExpectedResearchHead
    releaseId = $ReleaseId
    candidateSha256 = $ExpectedCandidateSha256
    p1BackupSha256 = $ExpectedP1BackupSha256
    codeManifestSha256 = $codeManifestSha256
    recordCreates = 575
    ratingCreates = 575
    postRecordsAlreadyCurrent = 575
    postRatingsAlreadyCurrent = 575
    sourceDatabaseWrite = $false
    sourceCountsUnchanged = $true
    sourceFingerprintsUnchanged = $true
    productionAuthorization = $false
    decision = 'accept_source_readonly_production_gate_rehearsal_0575_v01'
  })

  & docker rm -f $tempContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '销毁临时 PostgreSQL 失败。' }
  $tempCreated = $false
  Copy-Item -Path (Join-Path $outDir '*') -Destination $evidenceDir -Recurse -Force
  Write-RadarManifest $evidenceDir
  Compress-Archive -Path (Join-Path $evidenceDir '*') -DestinationPath $evidenceZip -CompressionLevel Optimal -Force
  $success = $true
} finally {
  if ($app) { Stop-RadarProcess $app.Process }
  if ($tempCreated) { & docker rm -f $tempContainer 2>$null | Out-Null }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $password = $null
}

if (-not $success) { throw 'Production gate source-readonly rehearsal 未通过。' }
$evidenceHash = (Get-FileHash -LiteralPath $evidenceZip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ''
Write-Host '统一 Release 生产执行门临时克隆演练通过。' -ForegroundColor Green
Write-Host "ToolHead               : $ExpectedToolHead"
Write-Host 'SourceDatabaseWrite    : False'
Write-Host 'RecordCreates          : 575'
Write-Host 'RatingCreates          : 575'
Write-Host 'ProductionAuthorization: False'
Write-Host "EvidenceBundle         : $evidenceZip"
Write-Host "EvidenceSHA256         : $evidenceHash"
