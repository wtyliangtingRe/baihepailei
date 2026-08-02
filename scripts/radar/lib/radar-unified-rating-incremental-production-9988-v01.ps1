$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'radar-unified-release-production-0575-v01.ps1')

function Get-RadarIncremental9988Config {
  return [ordered]@{
    ReleaseId = 'RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-0001'
    ResearchHead = 'c8790df95d1235d8d1aacabfb7c119fec9e1c642'
    PreviousMain = '24bd2f8a8d27a91282dd4d3e27ddf5e0804c6a94'
    ExpectedWorks = 35615
    ExistingRecords = 575
    ExistingRatings = 575
    NewRows = 9988
    ReleasePath = 'releases\public\radar-unified-rating-incremental-release-9988-0001\v01'
    ReleaseFiles = [ordered]@{
      'manifest.json' = '40c8e474c5a6614b259c2ab9402e404fab9bf0c9411c2a3590885f7e619fe896'
      'records.jsonl' = '827c5d8c7ea958bf614f2a19db2ad2db2a6847dd7c82d718614a4bcb9cac71a9'
      'ratings.jsonl' = '4c1a55c8cdabbd92bb8c081a28b30b6c2f3e87d370dcfccb89ed776fe0d14d18'
      'release-index.jsonl' = '0412d6e8108d1c0172001cc4986fd376475fdd2dfb52ee1848c14f022ccb419f'
      'identity-review-excluded.jsonl' = 'ad834663fc5b83dd5fbe0e46dd6e28b8684b5b6853e74099929f0f308a55c7a2'
    }
    ExistingProjectionCounts = [ordered]@{
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
    ExpectedStorage = [ordered]@{
      publicRecords = 9988
      facts = 39952
      evidence = 12673
      factSourceRefs = 50692
      publicRatings = 9988
      matchedClasses = 9988
      ratingFactRefs = 39952
      ratingEvidenceRefs = 12673
      unresolvedDimensions = 107832
      confirmationBasis = 42637
      publicTagHints = 10484
      publicWarningTemplateIds = 10484
      proposedProfileChanges = 0
      additionalEvidenceRefs = 0
    }
    MigrationNames = @(
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
  }
}

function Get-RadarIncrementalFileSha([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-RadarIncrementalJson([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "找不到 JSON：$Path" }
  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
}

function Assert-RadarIncrementalTrue([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function New-RadarIncrementalSnapshotSql([string]$Directory) {
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

function Get-RadarIncrementalSnapshot(
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

function Get-RadarIncrementalMigrationNames(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password
) {
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

function Assert-RadarIncrementalMigrationNames([string[]]$Actual, [object]$Config, [string]$Label) {
  $actualSorted = @($Actual | Sort-Object)
  $expectedSorted = @($Config.MigrationNames | Sort-Object)
  if (($actualSorted -join "`n") -ne ($expectedSorted -join "`n")) {
    throw "$Label migration names 不匹配：$($actualSorted -join ', ')"
  }
}

function Assert-RadarIncrementalSourceState(
  [object]$Snapshot,
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [object]$Config,
  [string]$Label
) {
  if ([long]$Snapshot.Counts['public.works'] -ne [long]$Config.ExpectedWorks) {
    throw "$Label Works 数量不匹配。"
  }
  foreach ($entry in $Config.ExistingProjectionCounts.GetEnumerator()) {
    if (-not $Snapshot.Counts.ContainsKey($entry.Key)) { throw "$Label 缺少既有投影表：$($entry.Key)" }
    if ([long]$Snapshot.Counts[$entry.Key] -ne [long]$entry.Value) {
      throw "$Label 既有投影数量不匹配：$($entry.Key)"
    }
  }
  Assert-RadarIncrementalMigrationNames `
    (Get-RadarIncrementalMigrationNames $Container $Database $User $Password) $Config $Label
}

function Convert-RadarIncrementalMap([hashtable]$Map) {
  $out = [ordered]@{}
  foreach ($key in @($Map.Keys | Sort-Object)) { $out[$key] = [string]$Map[$key] }
  return $out
}

function Convert-RadarIncrementalObjectToMap([object]$Value) {
  $out = @{}
  foreach ($property in $Value.PSObject.Properties) { $out[$property.Name] = [string]$property.Value }
  return $out
}

function Assert-RadarIncrementalPostCounts(
  [hashtable]$Before,
  [hashtable]$After,
  [object]$Storage
) {
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
  if (($beforeKeys -join "`n") -ne ($afterKeys -join "`n")) { throw '生产 apply 前后表集合发生变化。' }
  foreach ($key in $Before.Keys) {
    $expected = [long]$Before[$key]
    if ($increments.Contains($key)) { $expected += [long]$increments[$key] }
    if ([long]$After[$key] -ne $expected) {
      throw "生产行数增量错误：$key $($Before[$key]) -> $($After[$key]) expected=$expected"
    }
  }
}

function Get-RadarIncrementalWriterContext([string]$SourcePostgresContainer) {
  & docker version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
  $sourceRunning = ([string](& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer)).Trim()
  if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') { throw '源 PostgreSQL 容器未运行。' }
  $composeProject = ([string](& docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' $SourcePostgresContainer)).Trim()
  if ([string]::IsNullOrWhiteSpace($composeProject) -or $composeProject -eq '<no value>') {
    throw '无法确认 Docker Compose project。'
  }
  $writers = @(& docker ps --filter "label=com.docker.compose.project=$composeProject" --format '{{.Names}}' |
    Where-Object { $_ -and $_ -ne $SourcePostgresContainer })
  return [pscustomobject]@{ ComposeProject = $composeProject; Writers = $writers }
}

function Stop-RadarIncrementalWriters([string[]]$Names) {
  foreach ($name in $Names) {
    & docker stop -t 30 $name *> $null
    if ($LASTEXITCODE -ne 0) { throw "停止 writer 容器失败：$name" }
  }
}

function Restart-RadarIncrementalWriters([string[]]$Names) {
  foreach ($name in $Names) {
    & docker start $name *> $null
    if ($LASTEXITCODE -ne 0) { throw "恢复 writer 容器失败：$name" }
  }
}

function Assert-RadarIncrementalAuditReport(
  [object]$Audit,
  [string]$ExpectedEvidenceSha256,
  [string]$ExpectedRehearsalCandidateSha256,
  [string]$ExpectedRehearsalToolHead,
  [object]$Config
) {
  if (
    [string]$Audit.schemaVersion -ne 'radar-unified-rating-incremental-rehearsal-evidence-audit-9988-v01' -or
    $Audit.accepted -ne $true -or
    [string]$Audit.evidenceSha256 -ne $ExpectedEvidenceSha256 -or
    [string]$Audit.candidateSha256 -ne $ExpectedRehearsalCandidateSha256 -or
    [string]$Audit.toolHead -ne $ExpectedRehearsalToolHead -or
    [string]$Audit.researchHead -ne [string]$Config.ResearchHead -or
    [string]$Audit.releaseId -ne [string]$Config.ReleaseId -or
    [int]$Audit.createLedgerRows -ne 19976 -or
    [int]$Audit.recordCreates -ne 9988 -or
    [int]$Audit.ratingCreates -ne 9988 -or
    [int]$Audit.postRecordsAlreadyCurrent -ne 9988 -or
    [int]$Audit.postRatingsAlreadyCurrent -ne 9988 -or
    $Audit.sourceCountsUnchanged -ne $true -or
    $Audit.protectedFingerprintsUnchanged -ne $true -or
    [string]$Audit.temporaryDatabase -ne 'radar_incremental_rehearsal' -or
    $Audit.temporaryDatabaseDestroyed -ne $true -or
    $Audit.sourceAuthentication -ne $false -or
    $Audit.sourcePayloadAccess -ne $false -or
    $Audit.sourceDatabaseWrite -ne $false -or
    $Audit.productionAuthorization -ne $false -or
    $Audit.databaseBackupIncluded -ne $false -or
    $Audit.credentialsIncluded -ne $false -or
    [string]$Audit.decision -ne 'accept_independent_incremental_rehearsal_evidence_9988_v01'
  ) { throw '独立审计报告不符合生产候选准备门。' }
}
