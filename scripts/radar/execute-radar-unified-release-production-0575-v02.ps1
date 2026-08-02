param(
  [Parameter(Mandatory = $true)][string]$Authorization,
  [Parameter(Mandatory = $true)][string]$ExpectedMainHead,
  [Parameter(Mandatory = $true)][string]$Confirm,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ReleaseId = 'RADAR-UNIFIED-RATING-RELEASE-0575-0001'
$ExpectedCandidateSha256 = '0b18c33987abe2c2eb0c2280acee789415396903d697aface2523312a334de31'
$ExpectedResearchHead = '728ad2da5f7d3aba03f652b9fd701157b06793ee'
$ExpectedLegacySchemaSha256 = 'bb4bc33661c989e91dc7fda964f4023f3ef175582fe9e95449f568348eb17c7d'
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
. (Join-Path $PSScriptRoot 'lib\radar-unified-release-production-0575-v01.ps1')

function Invoke-RadarSqlText(
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

function Get-RadarMigrationRows([string]$Container, [string]$Database, [string]$User, [string]$Password) {
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

function Assert-RadarMigrationRows([string[]]$Actual, [string[]]$Expected, [string]$Label) {
  if (($Actual -join "`n") -ne ($Expected -join "`n")) {
    throw "$Label migration rows 不匹配：$($Actual -join ', ')"
  }
}

function Assert-RadarMigrationNames([string[]]$Rows, [string[]]$Expected, [string]$Label) {
  $actualNames = @($Rows | ForEach-Object { ([string]$_).Split("`t")[0] } | Sort-Object)
  $expectedNames = @($Expected | Sort-Object)
  if (($actualNames -join "`n") -ne ($expectedNames -join "`n")) {
    throw "$Label migration names 不匹配：$($actualNames -join ', ')"
  }
}

function Assert-RadarCriticalCode([object]$AuthorizationJson) {
  $manifestLines = @()
  foreach ($entry in @($AuthorizationJson.criticalCodeFiles)) {
    $file = Join-Path $repoRoot ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "缺少关键代码：$($entry.file)" }
    $bytes = [long](Get-Item -LiteralPath $file).Length
    $sha = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($bytes -ne [long]$entry.bytes -or $sha -ne [string]$entry.sha256) { throw "关键代码已变化：$($entry.file)" }
    $manifestLines += "$sha  $($entry.file)"
  }
  $text = (($manifestLines -join "`n") + "`n")
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $hash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
  if ($hash -ne [string]$AuthorizationJson.criticalCodeManifestSha256) { throw '关键代码 root SHA-256 不匹配。' }
}

function Get-RadarSnapshot(
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

function Assert-RadarInitialState([object]$Snapshot, [string]$Label) {
  if ([long]$Snapshot.Counts['public.works'] -ne 35615) { throw "$Label Works 数量不匹配。" }
  $newTables = @($Snapshot.Counts.Keys | Where-Object {
    $_ -like 'public.radar_public_records*' -or
    $_ -like 'public.radar_public_ratings*' -or
    $_ -eq 'public.radar_unified_release_apply_control'
  })
  if ($newTables.Count -ne 0) { throw "$Label 已存在目标或 apply-control 表：$($newTables -join ', ')" }
}

function New-RadarApplyMarker(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [object]$AuthorizationJson,
  [string]$FreshBackupSha256,
  [string]$Prefix,
  [string]$Directory
) {
  $sql = @"
BEGIN;
DO `$marker`$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('$ReleaseId', 0)) THEN
    RAISE EXCEPTION 'production advisory lock is busy';
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
  '$ReleaseId', 'started', '$ExpectedMainHead', '$ExpectedCandidateSha256',
  '$([string]$AuthorizationJson.evidenceSha256)', '$([string]$AuthorizationJson.criticalCodeManifestSha256)',
  '$([string]$AuthorizationJson.p1BackupSha256)', '$FreshBackupSha256'
);
COMMIT;
"@
  Invoke-RadarSqlText $Container $Database $User $Password $sql "$Prefix-create-apply-marker" $Directory | Out-Null
}

function Set-RadarApplyMarkerState(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [ValidateSet('completed', 'failed')][string]$State,
  [string]$Prefix,
  [string]$Directory
) {
  $completion = if ($State -eq 'completed') { 'now()' } else { 'NULL' }
  $failure = if ($State -eq 'failed') { "'executor_failure'" } else { 'NULL' }
  $sql = @"
BEGIN;
DO `$check`$
BEGIN
  UPDATE public.radar_unified_release_apply_control
  SET state = '$State', completed_at = $completion, failure_stage = $failure
  WHERE release_id = '$ReleaseId' AND state = 'started';
  IF NOT FOUND THEN RAISE EXCEPTION 'apply marker state transition failed'; END IF;
END
`$check`$;
COMMIT;
"@
  Invoke-RadarSqlText $Container $Database $User $Password $sql "$Prefix-set-marker-$State" $Directory | Out-Null
}

function Invoke-RadarHistoricalReconciliation(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$Prefix,
  [string]$Directory
) {
  Assert-RadarMigrationRows (Get-RadarMigrationRows $Container $Database $User $Password) $ExpectedMigrationRows "$Prefix pre-reconciliation"
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
  Invoke-RadarSqlText $Container $Database $User $Password $sql "$Prefix-reconcile-migrations" $Directory | Out-Null
}

function Invoke-RadarPayloadMigrations([string]$DatabaseUrl, [string]$Prefix, [string]$Directory) {
  Invoke-RadarWithEnvironment -Variables @{
    DATABASE_URL = $DatabaseUrl
    PAYLOAD_DB_PUSH = 'false'
    STEWARDSHIP_NOTICES_SCHEMA_READY = 'true'
    RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
  } -Action {
    pnpm payload migrate 1> (Join-Path $Directory "$Prefix-payload-migrate-stdout.txt") 2> (Join-Path $Directory "$Prefix-payload-migrate-stderr.txt")
    if ($LASTEXITCODE -ne 0) { throw "$Prefix Payload migrations 失败。" }
  }
}

function Start-RadarPayloadApp(
  [string]$DatabaseUrl,
  [string]$DatabaseName,
  [string]$Phase,
  [string]$Nonce,
  [string]$Prefix,
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
    RADAR_UNIFIED_RELEASE_PRODUCTION_PHASE = $Phase
    RADAR_UNIFIED_RELEASE_PRODUCTION_DATABASE = $DatabaseName
    RADAR_UNIFIED_RELEASE_PRODUCTION_MAIN_HEAD = $ExpectedMainHead
    RADAR_UNIFIED_RELEASE_PRODUCTION_RESEARCH_HEAD = $ExpectedResearchHead
    RADAR_UNIFIED_RELEASE_PRODUCTION_RELEASE_ID = $ReleaseId
    RADAR_UNIFIED_RELEASE_PRODUCTION_CANDIDATE_SHA256 = $ExpectedCandidateSha256
  } -Action {
    $script:process = Start-Process -FilePath $pnpmCommand `
      -ArgumentList @('exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', [string]$port) `
      -WorkingDirectory $repoRoot `
      -RedirectStandardOutput (Join-Path $Directory "$Prefix-app-stdout.txt") `
      -RedirectStandardError (Join-Path $Directory "$Prefix-app-stderr.txt") `
      -PassThru -NoNewWindow
  }
  Wait-RadarProductionMarker $baseUrl $Nonce $Phase $DatabaseName $ExpectedMainHead $ExpectedResearchHead $ReleaseId $ExpectedCandidateSha256 $process $ReadyTimeoutSeconds | Out-Null
  return [pscustomobject]@{ Process = $process; BaseUrl = $baseUrl }
}

function Invoke-RadarImporter(
  [string]$BaseUrl,
  [string]$DatabaseName,
  [string]$Nonce,
  [string]$Email,
  [string]$Password,
  [string]$ReleaseDirectory,
  [string]$OutputDirectory
) {
  Invoke-RadarWithEnvironment -Variables @{
    RADAR_UNIFIED_RELEASE_PRODUCTION_NONCE = $Nonce
    RADAR_PAYLOAD_EMAIL = $Email
    RADAR_PAYLOAD_PASSWORD = $Password
  } -Action {
    node '.\scripts\radar\run-unified-release-production-import-0575-v01.mjs' `
      --input $ReleaseDirectory `
      --url $BaseUrl `
      --out-dir $OutputDirectory `
      --mode 'apply' `
      --expected-main-head $ExpectedMainHead `
      --expected-research-head $ExpectedResearchHead `
      --expected-database $DatabaseName `
      --expected-candidate-sha256 $ExpectedCandidateSha256 `
      --expected-phase 'apply' `
      --confirm 'RUN-RADAR-UNIFIED-RELEASE-PRODUCTION-IMPORT-0575-V01'
    if ($LASTEXITCODE -ne 0) { throw 'Production importer apply 失败。' }
  }
}

function Assert-RadarImporterReceipt([object]$Receipt, [string]$Label) {
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
  ) { throw "$Label importer receipt 不符合 575 + 575 收敛。" }
}

function Assert-RadarPostCounts([hashtable]$Before, [hashtable]$After, [object]$Storage, [string]$Label) {
  foreach ($key in $Before.Keys) {
    if (-not $After.ContainsKey($key)) { throw "$Label 缺少原表：$key" }
    $beforeValue = [long]$Before[$key]
    $afterValue = [long]$After[$key]
    if ($key -eq 'public.audit_events') {
      if ($afterValue -ne $beforeValue + 1150) { throw "$Label audit_events 增量错误。" }
    } elseif ($key -eq 'public.payload_migrations') {
      if ($afterValue -ne $beforeValue + 6) { throw "$Label payload_migrations 净增量错误。" }
    } elseif ($key -eq 'public.users_sessions') {
      if ($afterValue -ne $beforeValue + 1) { throw "$Label users_sessions 增量错误。" }
    } elseif ($afterValue -ne $beforeValue) {
      throw "$Label 原表发生预期外变化：$key $beforeValue -> $afterValue"
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
  $expectedKeys = @($expectedNew.Keys | Sort-Object)
  if (($newKeys -join "`n") -ne ($expectedKeys -join "`n")) { throw "$Label 新表集合不匹配：$($newKeys -join ', ')" }
  foreach ($key in $expectedNew.Keys) {
    if ([long]$After[$key] -ne [long]$expectedNew[$key]) { throw "$Label 新表行数不匹配：$key" }
  }
}

function Restart-RadarContainers([string[]]$Names) {
  foreach ($name in $Names) {
    & docker start $name *> $null
    if ($LASTEXITCODE -ne 0) { throw "恢复 writer 容器失败：$name" }
  }
}

$expectedConfirm = "APPLY-$ReleaseId-ON-MAIN-$ExpectedMainHead"
if ($Confirm -ne $expectedConfirm) { throw 'Production apply 参数确认字符串不匹配。' }
if ($ExpectedMainHead -notmatch '^[a-f0-9]{40}$') { throw 'ExpectedMainHead 格式无效。' }
$unexpectedDirty = @(Get-RadarDirtyPaths | Where-Object { $_ -notin $AllowedDirtyFiles })
if ($unexpectedDirty.Count -gt 0) { throw "存在预期外本地修改：$($unexpectedDirty -join ', ')" }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端状态失败。' }
$currentBranch = (git branch --show-current).Trim()
$currentHead = (git rev-parse HEAD).Trim()
$remoteMain = (git rev-parse origin/main).Trim()
if ($currentBranch -ne 'main' -or $currentHead -ne $ExpectedMainHead -or $remoteMain -ne $ExpectedMainHead) {
  throw "Production apply 只允许精确 main：branch=$currentBranch local=$currentHead remote=$remoteMain"
}

$authorizationPath = (Resolve-Path -LiteralPath $Authorization).Path
$authorizationJson = Get-Content -LiteralPath $authorizationPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if (
  [string]$authorizationJson.schemaVersion -ne 'radar-unified-release-production-authorization-0575-v01' -or
  [string]$authorizationJson.authorizationToolVersion -ne 'v02' -or
  $authorizationJson.accepted -ne $true -or
  $authorizationJson.readyForExplicitApply -ne $true -or
  $authorizationJson.productionAuthorization -ne $false -or
  [string]$authorizationJson.mainHead -ne $ExpectedMainHead -or
  [string]$authorizationJson.releaseId -ne $ReleaseId -or
  [string]$authorizationJson.researchHead -ne $ExpectedResearchHead -or
  [string]$authorizationJson.candidateSha256 -ne $ExpectedCandidateSha256
) { throw 'Authorization receipt 不符合生产执行门。' }
Assert-RadarCriticalCode $authorizationJson
Assert-RadarFileHash ([string]$authorizationJson.candidatePath) $ExpectedCandidateSha256 'candidate' | Out-Null
Assert-RadarFileHash ([string]$authorizationJson.evidencePath) ([string]$authorizationJson.evidenceSha256) 'evidence ZIP' | Out-Null
Assert-RadarFileHash ([string]$authorizationJson.p1BackupPath) ([string]$authorizationJson.p1BackupSha256) 'P1 backup' | Out-Null
if ([long](Get-Item -LiteralPath ([string]$authorizationJson.p1BackupPath)).Length -ne [long]$authorizationJson.p1BackupBytes) {
  throw 'P1 backup 大小发生变化。'
}

$candidatePath = (Resolve-Path -LiteralPath ([string]$authorizationJson.candidatePath)).Path
$candidateDirectory = Split-Path -Parent $candidatePath
$releaseDirectory = (Resolve-Path -LiteralPath ([string]$authorizationJson.releaseDirectory)).Path
$sourceDatabaseUrl = Get-RadarConfiguredValue @('DATABASE_URL', 'DATABASE_URI')
if (-not $sourceDatabaseUrl) { throw '无法解析源数据库 DATABASE_URL。' }
try {
  $sourceUrl = [Uri]$sourceDatabaseUrl
  if ($sourceUrl.AbsolutePath.Trim('/') -ne $SourceDatabase) { throw 'DATABASE_URL 数据库名不匹配。' }
} catch { throw 'DATABASE_URL 无效或数据库名不匹配。' }
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
$composeProject = ([string](& docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' $SourcePostgresContainer)).Trim()
if ([string]::IsNullOrWhiteSpace($composeProject) -or $composeProject -eq '<no value>') { throw '无法确认 Docker Compose project。' }
$writerContainers = @(& docker ps --filter "label=com.docker.compose.project=$composeProject" --format '{{.Names}}' | Where-Object { $_ -and $_ -ne $SourcePostgresContainer })

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-release-production-0575-v01\production-apply-$stamp"
$backupDir = Join-Path $repoRoot 'data_local\backups\radar-unified-release-production-0575-v01'
$evidenceDir = Join-Path $repoRoot "exports\radar-unified-release-production-0575-$stamp"
$evidenceZip = Join-Path $repoRoot "exports\RADAR-UNIFIED-RELEASE-PRODUCTION-0575-$stamp.zip"
New-Item -ItemType Directory -Path $outDir, $backupDir, $evidenceDir -Force | Out-Null
$stagePath = Join-Path $outDir 'production-stage-status.json'
$stage = [ordered]@{
  schemaVersion = 'radar-unified-release-production-stage-0575-v02'
  startedAt = [DateTime]::UtcNow.ToString('o')
  mainHead = $ExpectedMainHead
  candidateSha256 = $ExpectedCandidateSha256
  writersStopped = $false
  freshBackupCreated = $false
  freshBackupRestored = $false
  rehearsalPlanPassed = $false
  rehearsalApplyPassed = $false
  rehearsalVerifyPassed = $false
  finalSourcePreflightPassed = $false
  durableMarkerCreated = $false
  migrationsApplied = $false
  productionImportApplied = $false
  productionVerifyPassed = $false
  postApplyStorageVerified = $false
  durableMarkerCompleted = $false
  writersRestarted = $false
  automaticRollbackExecuted = $false
}
Write-RadarJsonFile $stagePath $stage

$tempContainer = "baihepailei-radar-production-rehearsal-$stamp"
$tempUser = 'radar_apply_lab'
$tempDatabase = 'radar_unified_release_rehearsal'
$tempPassword = [Guid]::NewGuid().ToString('N')
$tempPort = Get-RadarFreePort 31000 31999
$tempDatabaseUrl = "postgresql://${tempUser}:${tempPassword}@127.0.0.1:${tempPort}/${tempDatabase}"
$tempCreated = $false
$app = $null
$markerCreated = $false
$productionCompleted = $false
$writersRestarted = $false
$operationError = $null
$freshBackupPath = Join-Path $backupDir "source-before-unified-release-apply-$stamp.dump"
$freshBackupContainerPath = "/tmp/source-before-unified-release-apply-$stamp.dump"

try {
  foreach ($name in $writerContainers) {
    & docker stop -t 30 $name *> $null
    if ($LASTEXITCODE -ne 0) { throw "停止 writer 容器失败：$name" }
  }
  $stage.writersStopped = $true
  Write-RadarJsonFile $stagePath $stage
  Start-Sleep -Seconds 3

  $sourceBaseline = Get-RadarSnapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $candidateDirectory 'source-before-fresh-backup' $outDir
  Assert-RadarInitialState $sourceBaseline 'source before fresh backup'
  Assert-RadarMapsEqual (Read-RadarMapFile ([string]$authorizationJson.sourceCountsPath)) $sourceBaseline.Counts 'authorization → source counts'
  Assert-RadarMapsEqual (Read-RadarMapFile ([string]$authorizationJson.sourceFingerprintsPath)) $sourceBaseline.Fingerprints 'authorization → source fingerprints'
  Assert-RadarMigrationRows (Get-RadarMigrationRows $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '') $ExpectedMigrationRows 'source before fresh backup'

  & docker exec $SourcePostgresContainer pg_dump -Fc --no-owner --no-privileges -U $SourceDatabaseUser -d $SourceDatabase -f $freshBackupContainerPath
  if ($LASTEXITCODE -ne 0) { throw '创建同窗口 fresh backup 失败。' }
  try {
    & docker cp "${SourcePostgresContainer}:$freshBackupContainerPath" $freshBackupPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '复制同窗口 fresh backup 失败。' }
  } finally {
    & docker exec $SourcePostgresContainer rm -f $freshBackupContainerPath 2>$null | Out-Null
  }
  $freshBackupBytes = [long](Get-Item -LiteralPath $freshBackupPath).Length
  $freshBackupSha256 = (Get-FileHash -LiteralPath $freshBackupPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($freshBackupBytes -le 0) { throw '同窗口 fresh backup 为空。' }
  $stage.freshBackupCreated = $true
  Write-RadarJsonFile $stagePath $stage

  $sourceAfterBackup = Get-RadarSnapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $candidateDirectory 'source-after-fresh-backup' $outDir
  Assert-RadarMapsEqual $sourceBaseline.Counts $sourceAfterBackup.Counts 'fresh backup 前后 counts'
  Assert-RadarMapsEqual $sourceBaseline.Fingerprints $sourceAfterBackup.Fingerprints 'fresh backup 前后 fingerprints'

  & docker run -d --name $tempContainer -p "127.0.0.1:${tempPort}:5432" `
    -e "POSTGRES_USER=$tempUser" -e "POSTGRES_PASSWORD=$tempPassword" -e 'POSTGRES_DB=postgres' $productionImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '启动 production rehearsal PostgreSQL 失败。' }
  $tempCreated = $true
  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  $tempReady = $false
  do {
    Start-Sleep -Seconds 2
    & docker exec -e "PGPASSWORD=$tempPassword" $tempContainer pg_isready -U $tempUser -d postgres | Out-Null
    $tempReady = $LASTEXITCODE -eq 0
  } while (-not $tempReady -and [DateTime]::UtcNow -lt $deadline)
  if (-not $tempReady) { throw 'Production rehearsal PostgreSQL 未就绪。' }
  & docker exec -e "PGPASSWORD=$tempPassword" $tempContainer createdb -U $tempUser -T template0 $tempDatabase
  if ($LASTEXITCODE -ne 0) { throw '创建 production rehearsal database 失败。' }
  & docker cp $freshBackupPath "${tempContainer}:/tmp/source.dump" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 fresh backup 到 rehearsal 失败。' }
  & docker exec -e "PGPASSWORD=$tempPassword" $tempContainer pg_restore -U $tempUser -d $tempDatabase --no-owner --no-privileges --exit-on-error /tmp/source.dump
  if ($LASTEXITCODE -ne 0) { throw '完整恢复 fresh backup 失败。' }
  $stage.freshBackupRestored = $true
  Write-RadarJsonFile $stagePath $stage

  $rehearsalBaseline = Get-RadarSnapshot $tempContainer $tempDatabase $tempUser $tempPassword $candidateDirectory 'rehearsal-restored' $outDir
  Assert-RadarMapsEqual $sourceBaseline.Counts $rehearsalBaseline.Counts 'source → rehearsal restored counts'
  Assert-RadarMapsEqual $sourceBaseline.Fingerprints $rehearsalBaseline.Fingerprints 'source → rehearsal restored fingerprints'
  New-RadarApplyMarker $tempContainer $tempDatabase $tempUser $tempPassword $authorizationJson $freshBackupSha256 'rehearsal' $outDir
  Invoke-RadarHistoricalReconciliation $tempContainer $tempDatabase $tempUser $tempPassword 'rehearsal' $outDir
  Invoke-RadarPayloadMigrations $tempDatabaseUrl 'rehearsal' $outDir
  Assert-RadarMigrationNames (Get-RadarMigrationRows $tempContainer $tempDatabase $tempUser $tempPassword) $ExpectedFinalMigrationNames 'rehearsal after migrations'

  $nonce = [Guid]::NewGuid().ToString('N')
  $app = Start-RadarPayloadApp $tempDatabaseUrl $tempDatabase 'apply' $nonce 'rehearsal-apply' $outDir
  $rehearsalImportDir = Join-Path $outDir 'rehearsal-apply-import'
  Invoke-RadarImporter $app.BaseUrl $tempDatabase $nonce $email $password $releaseDirectory $rehearsalImportDir
  Stop-RadarProcess $app.Process
  $app = $null
  $rehearsalReceipt = Get-Content -LiteralPath (Join-Path $rehearsalImportDir 'accepted-receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  Assert-RadarImporterReceipt $rehearsalReceipt 'rehearsal'
  $stage.rehearsalPlanPassed = $true
  $stage.rehearsalApplyPassed = $true
  $stage.rehearsalVerifyPassed = $true
  Write-RadarJsonFile $stagePath $stage
  Set-RadarApplyMarkerState $tempContainer $tempDatabase $tempUser $tempPassword 'completed' 'rehearsal' $outDir
  $rehearsalPost = Get-RadarSnapshot $tempContainer $tempDatabase $tempUser $tempPassword $candidateDirectory 'rehearsal-post-apply' $outDir
  Assert-RadarPostCounts $rehearsalBaseline.Counts $rehearsalPost.Counts $rehearsalReceipt.expectedStorage 'rehearsal post-apply'
  Assert-RadarMapsEqual $rehearsalBaseline.Fingerprints $rehearsalPost.Fingerprints 'rehearsal protected fingerprints'
  & docker rm -f $tempContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '销毁 production rehearsal PostgreSQL 失败。' }
  $tempCreated = $false

  $sourceFinalPreflight = Get-RadarSnapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $candidateDirectory 'source-final-preflight' $outDir
  Assert-RadarMapsEqual $sourceBaseline.Counts $sourceFinalPreflight.Counts 'source final preflight counts'
  Assert-RadarMapsEqual $sourceBaseline.Fingerprints $sourceFinalPreflight.Fingerprints 'source final preflight fingerprints'
  Assert-RadarMigrationRows (Get-RadarMigrationRows $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '') $ExpectedMigrationRows 'source final preflight'
  Assert-RadarInitialState $sourceFinalPreflight 'source final preflight'
  $stage.finalSourcePreflightPassed = $true
  Write-RadarJsonFile $stagePath $stage

  Write-Host ''
  Write-Host '即将进行第一次源数据库写入。请输入完整确认字符串：' -ForegroundColor Yellow
  Write-Host $expectedConfirm -ForegroundColor Yellow
  $typedConfirm = Read-Host
  if ($typedConfirm -ne $expectedConfirm) { throw '交互确认字符串不匹配，未写源数据库。' }

  New-RadarApplyMarker $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $authorizationJson $freshBackupSha256 'production' $outDir
  $markerCreated = $true
  $stage.durableMarkerCreated = $true
  Write-RadarJsonFile $stagePath $stage

  Invoke-RadarHistoricalReconciliation $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' 'production' $outDir
  Invoke-RadarPayloadMigrations $sourceDatabaseUrl 'production' $outDir
  Assert-RadarMigrationNames (Get-RadarMigrationRows $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '') $ExpectedFinalMigrationNames 'production after migrations'
  $stage.migrationsApplied = $true
  Write-RadarJsonFile $stagePath $stage

  $nonce = [Guid]::NewGuid().ToString('N')
  $app = Start-RadarPayloadApp $sourceDatabaseUrl $SourceDatabase 'apply' $nonce 'production-apply' $outDir
  $productionImportDir = Join-Path $outDir 'production-apply-import'
  Invoke-RadarImporter $app.BaseUrl $SourceDatabase $nonce $email $password $releaseDirectory $productionImportDir
  Stop-RadarProcess $app.Process
  $app = $null
  $productionReceipt = Get-Content -LiteralPath (Join-Path $productionImportDir 'accepted-receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  Assert-RadarImporterReceipt $productionReceipt 'production'
  $stage.productionImportApplied = $true
  $stage.productionVerifyPassed = $true
  Write-RadarJsonFile $stagePath $stage

  $sourcePost = Get-RadarSnapshot $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' $candidateDirectory 'source-post-apply' $outDir
  Assert-RadarPostCounts $sourceBaseline.Counts $sourcePost.Counts $productionReceipt.expectedStorage 'production post-apply'
  Assert-RadarMapsEqual $sourceBaseline.Fingerprints $sourcePost.Fingerprints 'production protected fingerprints'
  $stage.postApplyStorageVerified = $true
  Write-RadarJsonFile $stagePath $stage
  Set-RadarApplyMarkerState $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' 'completed' 'production' $outDir
  $stage.durableMarkerCompleted = $true
  $productionCompleted = $true
  Write-RadarJsonFile $stagePath $stage

  Restart-RadarContainers $writerContainers
  $writersRestarted = $true
  $stage.writersRestarted = $true
  Write-RadarJsonFile $stagePath $stage

  Write-RadarJsonFile (Join-Path $outDir 'production-acceptance.json') ([ordered]@{
    schemaVersion = 'radar-unified-release-production-acceptance-0575-v02'
    accepted = $true
    completedAt = [DateTime]::UtcNow.ToString('o')
    mainHead = $ExpectedMainHead
    researchHead = $ExpectedResearchHead
    releaseId = $ReleaseId
    candidateSha256 = $ExpectedCandidateSha256
    evidenceSha256 = [string]$authorizationJson.evidenceSha256
    codeManifestSha256 = [string]$authorizationJson.criticalCodeManifestSha256
    p1BackupSha256 = [string]$authorizationJson.p1BackupSha256
    freshBackupPath = $freshBackupPath
    freshBackupBytes = $freshBackupBytes
    freshBackupSha256 = $freshBackupSha256
    publicRecords = 575
    publicRatings = 575
    postFactsAlreadyCurrent = 575
    postRatingsAlreadyCurrent = 575
    protectedFingerprintsUnchanged = $true
    durableApplyMarkerCompleted = $true
    automaticRollbackExecuted = $false
    productionAuthorization = $true
    decision = 'accept_unified_release_production_apply_0575_v02'
  })

  Copy-Item -Path (Join-Path $outDir '*') -Destination $evidenceDir -Recurse -Force
  Write-RadarManifest $evidenceDir
  Compress-Archive -Path (Join-Path $evidenceDir '*') -DestinationPath $evidenceZip -CompressionLevel Optimal -Force
} catch {
  $operationError = $_
} finally {
  if ($app) { Stop-RadarProcess $app.Process }
  if ($tempCreated) { & docker rm -f $tempContainer 2>$null | Out-Null }
  if ($markerCreated -and -not $productionCompleted) {
    try { Set-RadarApplyMarkerState $SourcePostgresContainer $SourceDatabase $SourceDatabaseUser '' 'failed' 'production-failure' $outDir } catch {}
  }
  if ((-not $markerCreated -or $productionCompleted) -and -not $writersRestarted) {
    try {
      Restart-RadarContainers $writerContainers
      $writersRestarted = $true
      $stage.writersRestarted = $true
      Write-RadarJsonFile $stagePath $stage
    } catch {
      if ($null -eq $operationError) { $operationError = $_ }
    }
  }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $password = $null
}

if ($null -ne $operationError) {
  Write-RadarJsonFile (Join-Path $outDir 'production-failure.json') ([ordered]@{
    schemaVersion = 'radar-unified-release-production-failure-0575-v02'
    failedAt = [DateTime]::UtcNow.ToString('o')
    message = $operationError.Exception.Message
    durableMarkerCreated = $markerCreated
    productionCompleted = $productionCompleted
    writerContainersRestarted = $writersRestarted
    writerContainersIntentionallyLeftPaused = ($markerCreated -and -not $productionCompleted)
    freshBackupPath = $freshBackupPath
    automaticRetryAllowed = $false
    automaticRollbackExecuted = $false
    productionRollbackAuthorized = $false
  })
  throw $operationError
}

$evidenceHash = (Get-FileHash -LiteralPath $evidenceZip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ''
Write-Host '统一 Release 生产录入已完成并通过后验验证。' -ForegroundColor Green
Write-Host "MainHead                 : $ExpectedMainHead"
Write-Host 'PublicRecordsCreated     : 575'
Write-Host 'PublicRatingsCreated     : 575'
Write-Host "FreshBackup              : $freshBackupPath"
Write-Host "EvidenceBundle           : $evidenceZip"
Write-Host "EvidenceSHA256           : $evidenceHash"
Write-Host 'AutomaticRollbackExecuted: False'
