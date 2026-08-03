param(
  [ValidateSet('DryRun', 'Execute')]
  [string]$Mode = 'DryRun',

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{40}$')]
  [string]$ExpectedToolHead,

  [Parameter(Mandatory = $true)]
  [string]$CandidatePath,

  [Parameter(Mandatory = $true)]
  [string]$IndependentReviewZipPath,

  [Parameter(Mandatory = $true)]
  [string]$BackupPath,

  [Parameter(Mandatory = $true)]
  [string]$Confirm,

  [string]$AuthorizationPath,

  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',

  [string]$SourcePostgresContainer = 'baihepailei-postgres',

  [string]$MaintenanceConfirmation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$SchemaVersion = 'radar-public-metrics-source-schema-apply-once-v01'
$ExpectedDevelopmentBranch =
  'agent/radar-public-metrics-source-schema-apply-once-v01'
$ExpectedMergedPreflightMain =
  'b74ca37648688cb8f475acdbf304186ac36753ff'
$HistoricalCandidateBaseMain =
  'b5ffbe006913218d32b96c131074b7740bf827a0'
$HistoricalCandidateToolHead =
  '978a893e6f72bea8bb292c5dff99dfefb957e22e'
$ExpectedResearchHead =
  'c2fe7847ee8b60b439f8e92025437937ceff06d5'
$ReleaseId = 'RADAR-PUBLIC-METRICS-10563-0001'
$ReleaseRelativePath =
  'releases\public\radar-public-metrics-10563-0001\v01'
$ExpectedMigrationName =
  '20260803_102741_radar_public_metrics_v01'

$ExpectedCandidateSha256 =
  '825294f1a7562dfb2a94ca9d37f7efd79a9300d1af17ae6598db3f3ac02f7d13'
$ExpectedIndependentReviewSha256 =
  '35d14fb183a0e8ae34525ad6234a3a0e03ba42f28e6091598eef1ddf369694d0'
$ExpectedBackupSha256 =
  'd1721811438194b4783d0d05dbb9681d5ed8c2cc052145f09fb0747fcc4abe2f'
$ExpectedBackupBytes = 37207203L

$ExpectedSourceContainerId =
  '89eea3013fbfb18506eb1febef1c76b8d5b171d95737c59388ff6510e4402a1e'
$ExpectedSourceImage = 'postgres:17-alpine'
$ExpectedSourceDatabase = 'baihepailei'
$ExpectedSourceDatabaseUser = 'baihe'

$ExpectedWorks = 35615
$ExpectedPublicRecords = 10563
$ExpectedPublicRatings = 10563
$ExpectedCurrentColumns = 36
$ExpectedMigratedColumns = 44
$ExpectedSourceMigrationCount = 9
$ExpectedMigratedMigrationCount = 10

$AdvisoryLockClassId = 20260803
$AdvisoryLockObjectId = 102741

$DryRunConfirmation =
  'DRY-RUN-RADAR-PUBLIC-METRICS-SOURCE-SCHEMA-APPLY-ONCE-V01'
$MaintenanceConfirmationExpected =
  'SOURCE-WRITES-PAUSED-FOR-RADAR-PUBLIC-METRICS-SCHEMA-V01'

$ExpectedReleaseFiles = [ordered]@{
  'manifest.json' =
    'da4b52eae91224a8bab46aebff69734c6a3d2bc3005de415b027a9e4eba6226d'
  'metrics.jsonl' =
    '1bdfda49f4f72a823efc86de42c565d3bdef162136aef697d0dc1d3bb343a946'
  'review-flags.jsonl' =
    '642881e9760e3d1b0000ee5cbfdd28f58a2afc4b6c7a238f1d753f886d1d2ebe'
  'release-index.jsonl' =
    '4768614dfbd4d703f3946ce61507fa7610a93093603ed4632ba8da7d85242d36'
}

$ExpectedCriticalCode = [ordered]@{
  'src/collections/RadarPublicRatings.ts' =
    '15342a0bf050c3c2843c848d28096786e473aed17c01219dd901919cf6df5ec0'
  'src/migrations/20260803_102741_radar_public_metrics_v01.ts' =
    'ae017019de3b2b138aafe9b5d83a951773e167128d73f4da72722e9a31fa7f08'
  'src/migrations/20260803_102741_radar_public_metrics_v01.json' =
    'ee0d9572cc35eaf10973df9e2c5114d84de775c34cd59318b996df2adfa42026'
  'src/migrations/index.ts' =
    'baa0acb0019ce75a242727d4e2eddc20841d594a5846699a0a262c102daa0e31'
}

$ExpectedExistingColumns = @(
  'id',
  'publication_key',
  'work_id',
  'identity_key',
  'work_id_snapshot',
  'work_site_id',
  'title',
  'core_grade',
  'best_grade',
  'likely_grade',
  'worst_grade',
  'confidence',
  'reasoning_summary',
  'classification_rule',
  'benefit_of_doubt_baseline_applied',
  'human_review_status',
  'human_review_reviewer_identity',
  'human_review_reviewed_at',
  'human_review_decision',
  'human_review_proposed_core_grade',
  'human_review_reasoning',
  'human_review_moderation_state',
  'human_review_blocks_analysis',
  'human_review_blocks_publication',
  'source_release_id',
  'source_commit_sha',
  'source_policy_version',
  'research_snapshot_id',
  'source_rating_campaign_id',
  'source_rating_decision_hash',
  'release_rating_hash',
  'release_ratings_sha256',
  'imported_at',
  'record_status',
  'updated_at',
  'created_at'
)

$MetricColumnNames = @(
  'confidence_percent',
  'evidence_coverage_percent',
  'metrics_policy_version',
  'source_metrics_policy_version',
  'relationship_evidence_state',
  'metrics_source_release_id',
  'metrics_calculation_basis_sha256',
  'requires_metric_review'
)

$ExpectedPreMigrationLedger = @(
  "20260718_072813_existing_schema_baseline_v01`t1",
  "20260718_072843_stewardship_notices_v01`t1",
  "20260723_141905_current_schema_baseline_before_radar_public_v01`t2",
  "20260723_141908_radar_public_conclusions_v01`t2",
  "20260801_101546_current_schema_baseline_before_radar_public_records_v01`t3",
  "20260801_101551_radar_public_records_v01`t3",
  "20260802_030535_radar_public_ratings_v01`t3",
  "20260802_045057_radar_public_record_fact_value_text_v01`t3",
  "20260802_062015_radar_public_record_evidence_role_v01`t3"
)

$ExpectedPostMigrationLedger =
  @($ExpectedPreMigrationLedger) + @("$ExpectedMigrationName`t4")

$ExpectedFingerprints = @(
  "radar_public_ratings_existing_fields`t10563`tb607ac0e33d44ac384dc4a2cc97413ee",
  "radar_public_records`t10563`tccd652d4790bbeb34279181cd62939be",
  "works`t35615`t07632be7da96bb48129f207d3044c85e"
)

$ExpectedMetricIndexes = @(
  'radar_public_ratings_metrics_policy_version_idx',
  'radar_public_ratings_source_metrics_policy_version_idx',
  'radar_public_ratings_metrics_source_release_id_idx',
  'radar_public_ratings_metrics_calculation_basis_sha256_idx'
)

$ExpectedMetricEnum =
  'enum_radar_public_ratings_relationship_evidence_state'

$AllowedFilesSinceMergedPreflightMain = @(
  '.github/workflows/validate-radar-public-metrics-source-schema-apply-once-v01.yml',
  'docs/guides/radar-public-metrics-source-schema-apply-once-v01.md',
  'docs/guides/radar-public-metrics-source-schema-rollback-v01.md',
  'scripts/radar/run-radar-public-metrics-source-schema-apply-once-v01.ps1',
  'tests/radar-public-metrics-source-schema-apply-once.test.mjs'
)

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $Parent = Split-Path -Parent $Path
  if ($Parent) {
    New-Item -ItemType Directory -Path $Parent -Force | Out-Null
  }

  [System.IO.File]::WriteAllText(
    $Path,
    $Content,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Value
  )

  $Json = $Value | ConvertTo-Json -Depth 100
  Write-Utf8File -Path $Path -Content ($Json.TrimEnd() + "`n")
}

function Get-FileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  return (
    Get-FileHash -LiteralPath $Path -Algorithm SHA256
  ).Hash.ToLowerInvariant()
}

function Get-DirtyPaths {
  return @(
    git status --porcelain=v1 --untracked-files=all |
      ForEach-Object {
        if ($_ -and $_.Length -ge 4) {
          $Path = $_.Substring(3).Trim()
          if ($Path -match ' -> ') {
            $Path = ($Path -split ' -> ')[-1].Trim()
          }
          $Path.Replace('\', '/')
        }
      } |
      Where-Object { $_ }
  )
}

function Assert-ExactSequence {
  param(
    [Parameter(Mandatory = $true)][object[]]$Expected,
    [Parameter(Mandatory = $true)][object[]]$Actual,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $ExpectedText = @($Expected | ForEach-Object { [string]$_ }) -join "`n"
  $ActualText = @($Actual | ForEach-Object { [string]$_ }) -join "`n"

  if ($ExpectedText -ne $ActualText) {
    throw @"
$Label 不一致。

Expected:
$ExpectedText

Actual:
$ActualText
"@
  }
}

function Get-ContainerEnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$Name,
    [switch]$AllowEmpty
  )

  $ShellCommand = 'printf "%s" "$' + $Name + '"'
  $Output = @(
    docker exec $Container sh -lc $ShellCommand 2>&1
  ) -join "`n"

  if ($LASTEXITCODE -ne 0) {
    throw "无法读取容器环境变量：$Name"
  }

  $Value = $Output.Trim()
  if (-not $AllowEmpty -and -not $Value) {
    throw "容器环境变量为空：$Name"
  }

  return $Value
}

function Invoke-ContainerSql {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$DatabaseUser,
    [Parameter(Mandatory = $true)][string]$DatabaseName,
    [Parameter(Mandatory = $true)][string]$Sql,
    [switch]$ReadOnly
  )

  $Arguments = @('exec')
  if ($ReadOnly) {
    $Arguments += @(
      '-e',
      'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning'
    )
  }

  $Arguments += @(
    $Container,
    'psql',
    '-X',
    '-q',
    '-A',
    '-t',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    $DatabaseUser,
    '-d',
    $DatabaseName,
    '-c',
    $Sql
  )

  $Output = @(& docker @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw @"
PostgreSQL 查询失败：

$($Output -join "`n")
"@
  }

  return @(
    $Output |
      ForEach-Object { ([string]$_).TrimEnd() } |
      Where-Object { $_ -ne '' }
  )
}

function Get-FreeLoopbackPort {
  $Listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
  )

  try {
    $Listener.Start()
    return ([System.Net.IPEndPoint]$Listener.LocalEndpoint).Port
  }
  finally {
    $Listener.Stop()
  }
}

function Get-SourceConnectionIdentity {
  param([Parameter(Mandatory = $true)][string]$Container)

  $Running = (
    docker inspect --format '{{.State.Running}}' $Container
  ).Trim()

  if ($LASTEXITCODE -ne 0 -or $Running -ne 'true') {
    throw "源 PostgreSQL 容器未运行：$Container"
  }

  $ContainerId = (
    docker inspect --format '{{.Id}}' $Container
  ).Trim().ToLowerInvariant()
  $Image = (
    docker inspect --format '{{.Config.Image}}' $Container
  ).Trim()
  $DatabaseUser = Get-ContainerEnvironmentValue `
    -Container $Container `
    -Name 'POSTGRES_USER'
  $DatabaseName = Get-ContainerEnvironmentValue `
    -Container $Container `
    -Name 'POSTGRES_DB'
  $DatabasePassword = Get-ContainerEnvironmentValue `
    -Container $Container `
    -Name 'POSTGRES_PASSWORD' `
    -AllowEmpty

  $InspectJson = @(
    docker inspect $Container 2>&1
  ) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw '读取源 PostgreSQL 容器端口失败'
  }

  $Inspect = $InspectJson | ConvertFrom-Json -Depth 100
  $Bindings = @(
    $Inspect[0].NetworkSettings.Ports.'5432/tcp' |
      Where-Object { $null -ne $_ }
  )
  if ($Bindings.Count -lt 1 -or $Bindings.Count -gt 2) {
    throw '源 PostgreSQL 必须有一到两个 5432/tcp 主机端口映射'
  }

  $AllowedHostIps = @('127.0.0.1', '0.0.0.0', '::', '::1')
  $UnsupportedHostIps = @(
    $Bindings |
      ForEach-Object { [string]$_.HostIp } |
      Where-Object { $_ -notin $AllowedHostIps } |
      Sort-Object -Unique
  )
  if ($UnsupportedHostIps.Count -gt 0) {
    throw "源 PostgreSQL 主机绑定不受支持：$($UnsupportedHostIps -join ', ')"
  }

  $HostPorts = @(
    $Bindings |
      ForEach-Object { [string]$_.HostPort } |
      Where-Object { $_ } |
      Sort-Object -Unique
  )
  if ($HostPorts.Count -ne 1) {
    throw '源 PostgreSQL 的 5432/tcp 映射必须指向同一个唯一主机端口'
  }

  $HostPort = [string]$HostPorts[0]
  if (-not $HostPort -or $HostPort -notmatch '^[0-9]+$') {
    throw '源 PostgreSQL 主机端口无效'
  }

  $IPv4Bindings = @(
    $Bindings |
      Where-Object {
        ([string]$_.HostIp) -in @('127.0.0.1', '0.0.0.0')
      }
  )
  if ($IPv4Bindings.Count -lt 1) {
    throw '源 PostgreSQL 必须包含可通过 127.0.0.1 访问的 IPv4 主机绑定'
  }

  $HostIp = [string]$IPv4Bindings[0].HostIp

  if ($ContainerId -ne $ExpectedSourceContainerId) {
    throw @"
源 PostgreSQL 容器 ID 与候选不一致。

Expected: $ExpectedSourceContainerId
Actual  : $ContainerId

容器若被重建，必须重新做生产只读预检，不能沿用旧候选。
"@
  }

  if ($Image -ne $ExpectedSourceImage) {
    throw "源 PostgreSQL 镜像不一致：$Image"
  }

  if ($DatabaseName -ne $ExpectedSourceDatabase) {
    throw "源数据库名不一致：$DatabaseName"
  }

  if ($DatabaseUser -ne $ExpectedSourceDatabaseUser) {
    throw "源数据库用户不一致：$DatabaseUser"
  }

  $EncodedUser = [Uri]::EscapeDataString($DatabaseUser)
  $EncodedDatabase = [Uri]::EscapeDataString($DatabaseName)
  if ($DatabasePassword) {
    $EncodedPassword = [Uri]::EscapeDataString($DatabasePassword)
    $DatabaseUrl =
      "postgresql://${EncodedUser}:${EncodedPassword}@127.0.0.1:${HostPort}/${EncodedDatabase}"
  }
  else {
    $DatabaseUrl =
      "postgresql://${EncodedUser}@127.0.0.1:${HostPort}/${EncodedDatabase}"
  }

  return [ordered]@{
    container = $Container
    containerId = $ContainerId
    image = $Image
    databaseUser = $DatabaseUser
    databaseName = $DatabaseName
    hostPort = [int]$HostPort
    hostIp = $HostIp
    databaseUrl = $DatabaseUrl
  }
}

function Get-DatabaseSnapshot {
  param(
    [Parameter(Mandatory = $true)][object]$Identity,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [switch]$ReadOnly
  )

  $Prefix = Join-Path $OutputDirectory $Label
  New-Item -ItemType Directory -Path $Prefix -Force | Out-Null

  $SummarySql = @"
SELECT json_build_object(
  'database', current_database(),
  'databaseUser', current_user,
  'transactionReadOnly', current_setting('transaction_read_only'),
  'works', (SELECT count(*) FROM public.works),
  'publicRecords', (
    SELECT count(*)
    FROM public.radar_public_records
    WHERE record_status = 'current'
  ),
  'publicRatings', (
    SELECT count(*)
    FROM public.radar_public_ratings
    WHERE record_status = 'current'
  ),
  'ratingColumns', (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'radar_public_ratings'
  ),
  'payloadMigrations', (
    SELECT count(*)
    FROM public.payload_migrations
  )
)::text;
"@

  $ColumnsSql = @"
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'radar_public_ratings'
ORDER BY ordinal_position;
"@

  $MigrationsSql = @"
SELECT name || E'\t' || batch::text
FROM public.payload_migrations
ORDER BY batch, name;
"@

  $FingerprintsSql = @"
SELECT 'works' || E'\t' || count(*)::text || E'\t' ||
  coalesce(md5(string_agg(md5(to_jsonb(w)::text), '' ORDER BY w.id)), md5(''))
FROM public.works AS w
UNION ALL
SELECT 'radar_public_records' || E'\t' || count(*)::text || E'\t' ||
  coalesce(md5(string_agg(md5(to_jsonb(r)::text), '' ORDER BY r.id)), md5(''))
FROM public.radar_public_records AS r
UNION ALL
SELECT 'radar_public_ratings_existing_fields' || E'\t' ||
  count(*)::text || E'\t' ||
  coalesce(
    md5(
      string_agg(
        md5(
          (
            to_jsonb(r) - ARRAY[
              'confidence_percent',
              'evidence_coverage_percent',
              'metrics_policy_version',
              'source_metrics_policy_version',
              'relationship_evidence_state',
              'metrics_source_release_id',
              'metrics_calculation_basis_sha256',
              'requires_metric_review'
            ]::text[]
          )::text
        ),
        ''
        ORDER BY r.id
      )
    ),
    md5('')
  )
FROM public.radar_public_ratings AS r
ORDER BY 1;
"@

  $ObjectsSql = @"
SELECT json_build_object(
  'enumExists',
    to_regtype('public.enum_radar_public_ratings_relationship_evidence_state')
      IS NOT NULL,
  'indexMetricsPolicyVersion',
    to_regclass('public.radar_public_ratings_metrics_policy_version_idx')
      IS NOT NULL,
  'indexSourceMetricsPolicyVersion',
    to_regclass('public.radar_public_ratings_source_metrics_policy_version_idx')
      IS NOT NULL,
  'indexMetricsSourceReleaseId',
    to_regclass('public.radar_public_ratings_metrics_source_release_id_idx')
      IS NOT NULL,
  'indexMetricsCalculationBasis',
    to_regclass('public.radar_public_ratings_metrics_calculation_basis_sha256_idx')
      IS NOT NULL
)::text;
"@

  $Invoke = @{
    Container = [string]$Identity.container
    DatabaseUser = [string]$Identity.databaseUser
    DatabaseName = [string]$Identity.databaseName
  }
  if ($ReadOnly) {
    $Invoke.ReadOnly = $true
  }

  $SummaryLines = @(Invoke-ContainerSql @Invoke -Sql $SummarySql)
  $ObjectLines = @(Invoke-ContainerSql @Invoke -Sql $ObjectsSql)

  if ($SummaryLines.Count -ne 1) {
    throw "$Label summary 行数不正确"
  }
  if ($ObjectLines.Count -ne 1) {
    throw "$Label object summary 行数不正确"
  }

  $Summary = $SummaryLines[0] | ConvertFrom-Json -Depth 100
  $Objects = $ObjectLines[0] | ConvertFrom-Json -Depth 100
  $Columns = @(Invoke-ContainerSql @Invoke -Sql $ColumnsSql)
  $Migrations = @(Invoke-ContainerSql @Invoke -Sql $MigrationsSql)
  $Fingerprints = @(Invoke-ContainerSql @Invoke -Sql $FingerprintsSql)

  $SummaryPath = Join-Path $Prefix 'summary.json'
  $ObjectsPath = Join-Path $Prefix 'objects.json'
  $ColumnsPath = Join-Path $Prefix 'columns.json'
  $MigrationsPath = Join-Path $Prefix 'migrations.tsv'
  $FingerprintsPath = Join-Path $Prefix 'fingerprints.tsv'

  Write-JsonFile -Path $SummaryPath -Value $Summary
  Write-JsonFile -Path $ObjectsPath -Value $Objects
  Write-JsonFile -Path $ColumnsPath -Value ([ordered]@{
    columns = $Columns
  })
  Write-Utf8File `
    -Path $MigrationsPath `
    -Content (($Migrations -join "`n") + "`n")
  Write-Utf8File `
    -Path $FingerprintsPath `
    -Content (($Fingerprints -join "`n") + "`n")

  return [ordered]@{
    label = $Label
    summary = $Summary
    objects = $Objects
    columns = $Columns
    migrations = $Migrations
    fingerprints = $Fingerprints
    summaryPath = $SummaryPath
    objectsPath = $ObjectsPath
    columnsPath = $ColumnsPath
    migrationsPath = $MigrationsPath
    fingerprintsPath = $FingerprintsPath
  }
}

function Assert-PreMigrationState {
  param(
    [Parameter(Mandatory = $true)][object]$Snapshot,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ([int]$Snapshot.summary.works -ne $ExpectedWorks) {
    throw "$Label Works 不是 $ExpectedWorks"
  }
  if ([int]$Snapshot.summary.publicRecords -ne $ExpectedPublicRecords) {
    throw "$Label Public Records 不是 $ExpectedPublicRecords"
  }
  if ([int]$Snapshot.summary.publicRatings -ne $ExpectedPublicRatings) {
    throw "$Label Public Ratings 不是 $ExpectedPublicRatings"
  }
  if ([int]$Snapshot.summary.ratingColumns -ne $ExpectedCurrentColumns) {
    throw "$Label Public Ratings 列数不是 $ExpectedCurrentColumns"
  }
  if (
    [int]$Snapshot.summary.payloadMigrations -ne
    $ExpectedSourceMigrationCount
  ) {
    throw "$Label migration 数量不是 $ExpectedSourceMigrationCount"
  }

  Assert-ExactSequence `
    -Expected $ExpectedExistingColumns `
    -Actual $Snapshot.columns `
    -Label "$Label 迁移前列顺序"
  Assert-ExactSequence `
    -Expected $ExpectedPreMigrationLedger `
    -Actual $Snapshot.migrations `
    -Label "$Label 迁移前 migration ledger"
  Assert-ExactSequence `
    -Expected $ExpectedFingerprints `
    -Actual $Snapshot.fingerprints `
    -Label "$Label 迁移前既有字段指纹"

  foreach ($Column in $MetricColumnNames) {
    if ($Column -in $Snapshot.columns) {
      throw "$Label 已存在指标列，拒绝重复运行：$Column"
    }
  }

  if ($Snapshot.objects.enumExists -ne $false) {
    throw "$Label 已存在指标 enum，拒绝重复运行"
  }

  foreach ($Property in @(
    'indexMetricsPolicyVersion',
    'indexSourceMetricsPolicyVersion',
    'indexMetricsSourceReleaseId',
    'indexMetricsCalculationBasis'
  )) {
    if ($Snapshot.objects.$Property -ne $false) {
      throw "$Label 已存在指标 index，拒绝重复运行：$Property"
    }
  }

  if (
    $Snapshot.migrations |
      Where-Object {
        $_ -match "^$([regex]::Escape($ExpectedMigrationName))`t"
      }
  ) {
    throw "$Label 已登记目标 migration，Never rerun"
  }
}

function Get-MetricContentState {
  param([Parameter(Mandatory = $true)][object]$Identity)

  $Sql = @"
SELECT json_build_object(
  'rows', count(*),
  'nonEmptyMetricRows', count(*) FILTER (
    WHERE confidence_percent IS NOT NULL
       OR evidence_coverage_percent IS NOT NULL
       OR metrics_policy_version IS NOT NULL
       OR source_metrics_policy_version IS NOT NULL
       OR relationship_evidence_state IS NOT NULL
       OR metrics_source_release_id IS NOT NULL
       OR metrics_calculation_basis_sha256 IS NOT NULL
       OR requires_metric_review IS DISTINCT FROM false
  ),
  'requiresMetricReviewTrue', count(*) FILTER (
    WHERE requires_metric_review IS TRUE
  ),
  'requiresMetricReviewNull', count(*) FILTER (
    WHERE requires_metric_review IS NULL
  )
)::text
FROM public.radar_public_ratings
WHERE record_status = 'current';
"@

  $Lines = @(
    Invoke-ContainerSql `
      -Container $Identity.container `
      -DatabaseUser $Identity.databaseUser `
      -DatabaseName $Identity.databaseName `
      -Sql $Sql `
      -ReadOnly
  )

  if ($Lines.Count -ne 1) {
    throw '指标内容状态查询行数不正确'
  }

  return $Lines[0] | ConvertFrom-Json -Depth 100
}

function Assert-PostMigrationState {
  param(
    [Parameter(Mandatory = $true)][object]$Before,
    [Parameter(Mandatory = $true)][object]$After,
    [Parameter(Mandatory = $true)][object]$Identity,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ([int]$After.summary.works -ne $ExpectedWorks) {
    throw "$Label Works 数量变化"
  }
  if ([int]$After.summary.publicRecords -ne $ExpectedPublicRecords) {
    throw "$Label Public Records 数量变化"
  }
  if ([int]$After.summary.publicRatings -ne $ExpectedPublicRatings) {
    throw "$Label Public Ratings 数量变化"
  }
  if ([int]$After.summary.ratingColumns -ne $ExpectedMigratedColumns) {
    throw "$Label 列数不是 $ExpectedMigratedColumns"
  }
  if (
    [int]$After.summary.payloadMigrations -ne
    $ExpectedMigratedMigrationCount
  ) {
    throw "$Label migration 数量不是 $ExpectedMigratedMigrationCount"
  }

  Assert-ExactSequence `
    -Expected @($ExpectedExistingColumns + $MetricColumnNames) `
    -Actual $After.columns `
    -Label "$Label 迁移后列顺序"
  Assert-ExactSequence `
    -Expected $ExpectedPostMigrationLedger `
    -Actual $After.migrations `
    -Label "$Label 迁移后 migration ledger"
  Assert-ExactSequence `
    -Expected $Before.fingerprints `
    -Actual $After.fingerprints `
    -Label "$Label 既有字段指纹"
  Assert-ExactSequence `
    -Expected $ExpectedFingerprints `
    -Actual $After.fingerprints `
    -Label "$Label 已知生产指纹"

  if ($After.objects.enumExists -ne $true) {
    throw "$Label 缺少指标 enum"
  }

  foreach ($Property in @(
    'indexMetricsPolicyVersion',
    'indexSourceMetricsPolicyVersion',
    'indexMetricsSourceReleaseId',
    'indexMetricsCalculationBasis'
  )) {
    if ($After.objects.$Property -ne $true) {
      throw "$Label 缺少指标 index：$Property"
    }
  }

  $MetricState = Get-MetricContentState -Identity $Identity
  if (
    [int]$MetricState.rows -ne $ExpectedPublicRatings -or
    [int]$MetricState.nonEmptyMetricRows -ne 0 -or
    [int]$MetricState.requiresMetricReviewTrue -ne 0 -or
    [int]$MetricState.requiresMetricReviewNull -ne 0
  ) {
    throw "$Label 指标字段不是全空/默认 false"
  }

  return $MetricState
}

function Assert-RepositoryBinding {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$ToolHead
  )

  $Dirty = @(Get-DirtyPaths)
  if ($Dirty.Count -gt 0) {
    throw "网站工作区必须干净：$($Dirty -join ', ')"
  }

  git fetch origin
  if ($LASTEXITCODE -ne 0) {
    throw '获取网站远端更新失败'
  }

  $CurrentBranch = (git branch --show-current).Trim()
  $CurrentHead = (git rev-parse HEAD).Trim().ToLowerInvariant()
  $ToolHead = $ToolHead.ToLowerInvariant()

  if ($CurrentHead -ne $ToolHead) {
    throw @"
当前 HEAD 不符合调用者锁定值。

Expected: $ToolHead
Actual  : $CurrentHead
"@
  }

  & git merge-base --is-ancestor $ExpectedMergedPreflightMain $CurrentHead
  if ($LASTEXITCODE -ne 0) {
    throw '当前提交不包含合并后的 PR #335 精确基线'
  }

  if ($Mode -eq 'DryRun') {
    if ($CurrentBranch -ne $ExpectedDevelopmentBranch) {
      throw "DryRun 必须位于工程分支：$ExpectedDevelopmentBranch"
    }

    $RemoteRef = "origin/$ExpectedDevelopmentBranch"
    git show-ref --verify --quiet "refs/remotes/$RemoteRef"
    if ($LASTEXITCODE -eq 0) {
      $RemoteHead = (git rev-parse $RemoteRef).Trim().ToLowerInvariant()
      if ($RemoteHead -ne $CurrentHead) {
        throw '工程分支 local/remote HEAD 不一致'
      }
    }
  }
  else {
    if ($CurrentBranch -ne 'main') {
      throw 'Execute 只允许在 main 上运行'
    }

    $RemoteMain = (git rev-parse 'origin/main').Trim().ToLowerInvariant()
    if ($RemoteMain -ne $CurrentHead) {
      throw 'Execute 要求 local main 与 origin/main 完全一致'
    }
  }

  $Changed = @(
    git diff --name-only `
      "$ExpectedMergedPreflightMain...$CurrentHead" |
      ForEach-Object { ([string]$_).Trim().Replace('\', '/') } |
      Where-Object { $_ }
  )

  foreach ($Path in $Changed) {
    if ($Path -notin $AllowedFilesSinceMergedPreflightMain) {
      throw "基线之后出现未授权文件变化：$Path"
    }
  }

  foreach ($Entry in $ExpectedCriticalCode.GetEnumerator()) {
    $FullPath = Join-Path $RepoRoot $Entry.Key
    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) {
      throw "关键代码缺失：$($Entry.Key)"
    }

    $Actual = Get-FileSha256 $FullPath
    if ($Actual -ne $Entry.Value) {
      throw @"
关键代码 SHA-256 漂移：$($Entry.Key)

Expected: $($Entry.Value)
Actual  : $Actual
"@
    }
  }

  return [ordered]@{
    branch = $CurrentBranch
    head = $CurrentHead
    mergedPreflightMain = $ExpectedMergedPreflightMain
    changedFiles = $Changed
  }
}

function Assert-AssetBinding {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedCandidatePath,
    [Parameter(Mandatory = $true)][string]$ResolvedReviewZipPath,
    [Parameter(Mandatory = $true)][string]$ResolvedBackupPath
  )

  $CandidateSha = Get-FileSha256 $ResolvedCandidatePath
  if ($CandidateSha -ne $ExpectedCandidateSha256) {
    throw 'Candidate SHA-256 不匹配'
  }

  $ReviewSha = Get-FileSha256 $ResolvedReviewZipPath
  if ($ReviewSha -ne $ExpectedIndependentReviewSha256) {
    throw '独立复核 ZIP SHA-256 不匹配'
  }

  $BackupItem = Get-Item -LiteralPath $ResolvedBackupPath
  $BackupSha = Get-FileSha256 $ResolvedBackupPath
  if (
    [long]$BackupItem.Length -ne $ExpectedBackupBytes -or
    $BackupSha -ne $ExpectedBackupSha256
  ) {
    throw '预检 Backup 的 bytes 或 SHA-256 不匹配'
  }

  $Candidate = Get-Content `
    -LiteralPath $ResolvedCandidatePath `
    -Raw `
    -Encoding UTF8 |
      ConvertFrom-Json -Depth 100

  if (
    $Candidate.schemaVersion -ne
      'radar-public-metrics-production-preflight-candidate-v01' -or
    $Candidate.accepted -ne $true -or
    $Candidate.website.baseMain -ne $HistoricalCandidateBaseMain -or
    $Candidate.website.toolHead -ne $HistoricalCandidateToolHead -or
    $Candidate.research.head -ne $ExpectedResearchHead -or
    $Candidate.research.releaseId -ne $ReleaseId -or
    $Candidate.temporaryRehearsal.migrationName -ne
      $ExpectedMigrationName -or
    [int]$Candidate.source.works -ne $ExpectedWorks -or
    [int]$Candidate.source.publicRecords -ne $ExpectedPublicRecords -or
    [int]$Candidate.source.publicRatings -ne $ExpectedPublicRatings -or
    [int]$Candidate.source.ratingColumns -ne $ExpectedCurrentColumns -or
    [int]$Candidate.source.payloadMigrations -ne
      $ExpectedSourceMigrationCount -or
    $Candidate.source.sourceUnchanged -ne $true -or
    $Candidate.authorization.sourceMigration -ne $false -or
    $Candidate.authorization.metricImport -ne $false -or
    $Candidate.authorization.productionAuthorization -ne $false -or
    $Candidate.authorization.historicalApplyOnceRerun -ne $false
  ) {
    throw 'Candidate 身份、计数或未授权边界不符合预期'
  }

  if (
    [long]$Candidate.freshBackup.bytes -ne $ExpectedBackupBytes -or
    [string]$Candidate.freshBackup.sha256 -ne $ExpectedBackupSha256
  ) {
    throw 'Candidate 内记录的 Backup 不匹配'
  }

  foreach ($Entry in $ExpectedReleaseFiles.GetEnumerator()) {
    $CandidateFile = $Candidate.research.files.PSObject.Properties[
      $Entry.Key
    ].Value

    if ([string]$CandidateFile.sha256 -ne $Entry.Value) {
      throw "Candidate Release 文件 SHA 不匹配：$($Entry.Key)"
    }
  }

  return [ordered]@{
    candidate = $Candidate
    candidatePath = $ResolvedCandidatePath
    candidateSha256 = $CandidateSha
    independentReviewPath = $ResolvedReviewZipPath
    independentReviewSha256 = $ReviewSha
    backupPath = $ResolvedBackupPath
    backupBytes = [long]$BackupItem.Length
    backupSha256 = $BackupSha
  }
}

function Add-ResearchWorktree {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedResearchRepo,
    [Parameter(Mandatory = $true)][string]$WorktreePath
  )

  $TrackedDirty = @(
    git -C $ResolvedResearchRepo status --porcelain=v1 --untracked-files=no
  )
  if ($TrackedDirty.Count -gt 0) {
    throw '研究仓库存在已跟踪文件修改'
  }

  git -C $ResolvedResearchRepo fetch origin
  if ($LASTEXITCODE -ne 0) {
    throw '获取研究仓库远端更新失败'
  }

  git -C $ResolvedResearchRepo cat-file -e "$ExpectedResearchHead`^{commit}"
  if ($LASTEXITCODE -ne 0) {
    throw "研究提交不存在：$ExpectedResearchHead"
  }

  git -C $ResolvedResearchRepo worktree add `
    --detach `
    $WorktreePath `
    $ExpectedResearchHead

  if ($LASTEXITCODE -ne 0) {
    throw '建立研究 Release 只读 worktree 失败'
  }
}

function Assert-ResearchRelease {
  param([Parameter(Mandatory = $true)][string]$WorktreePath)

  $ReleaseDirectory = Join-Path $WorktreePath $ReleaseRelativePath
  foreach ($Entry in $ExpectedReleaseFiles.GetEnumerator()) {
    $File = Join-Path $ReleaseDirectory $Entry.Key
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
      throw "Research Release 文件缺失：$($Entry.Key)"
    }

    if ((Get-FileSha256 $File) -ne $Entry.Value) {
      throw "Research Release 文件 SHA 不匹配：$($Entry.Key)"
    }
  }

  $Manifest = Get-Content `
    -LiteralPath (Join-Path $ReleaseDirectory 'manifest.json') `
    -Raw `
    -Encoding UTF8 |
      ConvertFrom-Json -Depth 100

  if (
    $Manifest.releaseId -ne $ReleaseId -or
    [int]$Manifest.counts.metrics -ne $ExpectedPublicRatings -or
    [string]$Manifest.policy.policyId -ne
      'radar-public-metrics-policy-v01' -or
    [string]$Manifest.policy.status -ne 'frozen' -or
    $Manifest.gates.websiteWrite -ne $false -or
    $Manifest.gates.payloadWrite -ne $false -or
    $Manifest.gates.postgresqlWrite -ne $false -or
    $Manifest.gates.productionAuthorization -ne $false
  ) {
    throw 'Research Release 冻结或禁写边界不符合预期'
  }

  return [ordered]@{
    directory = $ReleaseDirectory
    manifest = $Manifest
  }
}

function Start-AdvisoryLock {
  param(
    [Parameter(Mandatory = $true)][object]$Identity,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][string]$RunId
  )

  $ApplicationName = "radar-metrics-schema-lock-$RunId"
  $ApplicationNameBytes =
    [System.Text.Encoding]::ASCII.GetByteCount($ApplicationName)
  if ($ApplicationNameBytes -gt 63) {
    throw "advisory lock application_name 超过 63 bytes：$ApplicationNameBytes"
  }

  $SqlPath = Join-Path $OutputDirectory 'advisory-lock.sql'
  $StdoutPath = Join-Path $OutputDirectory 'advisory-lock.stdout.txt'
  $StderrPath = Join-Path $OutputDirectory 'advisory-lock.stderr.txt'
  $ContainerSqlPath = "/tmp/$ApplicationName.sql"

  $Sql = @"
SET application_name = '$ApplicationName';
SET statement_timeout = '2h';
DO `$radar`$
BEGIN
  IF NOT pg_try_advisory_lock(
    $AdvisoryLockClassId,
    $AdvisoryLockObjectId
  ) THEN
    RAISE EXCEPTION 'RADAR_SOURCE_SCHEMA_LOCK_BUSY';
  END IF;
END
`$radar`$;
SELECT
  pg_backend_pid() AS radar_lock_backend_pid,
  current_setting('application_name') AS radar_lock_application_name
\gset
\echo RADAR_SOURCE_SCHEMA_LOCK_ACQUIRED|:radar_lock_backend_pid|:radar_lock_application_name
SELECT pg_sleep(7200);
"@
  Write-Utf8File -Path $SqlPath -Content ($Sql.TrimEnd() + "`n")

  docker cp $SqlPath "$($Identity.container):$ContainerSqlPath" |
    Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw '复制 advisory lock SQL 失败'
  }

  $Arguments = @(
    'exec',
    '-i',
    [string]$Identity.container,
    'psql',
    '-X',
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    [string]$Identity.databaseUser,
    '-d',
    [string]$Identity.databaseName,
    '-f',
    $ContainerSqlPath
  )

  $Process = Start-Process `
    -FilePath 'docker' `
    -ArgumentList $Arguments `
    -PassThru `
    -NoNewWindow `
    -RedirectStandardOutput $StdoutPath `
    -RedirectStandardError $StderrPath

  $MarkerPattern =
    'RADAR_SOURCE_SCHEMA_LOCK_ACQUIRED\|(?<pid>[0-9]+)\|(?<application>[A-Za-z0-9-]+)'
  $MarkerMatch = $null

  foreach ($Attempt in 1..200) {
    if (Test-Path -LiteralPath $StdoutPath) {
      $OutputText = Get-Content `
        -LiteralPath $StdoutPath `
        -Raw `
        -ErrorAction SilentlyContinue

      if ($OutputText) {
        $CandidateMatch = [regex]::Match(
          $OutputText,
          $MarkerPattern
        )
        if ($CandidateMatch.Success) {
          $MarkerMatch = $CandidateMatch
          break
        }
      }
    }

    if ($Process.HasExited) {
      break
    }

    Start-Sleep -Milliseconds 100
  }

  if (-not $MarkerMatch) {
    $OutputText = ''
    $ErrorText = ''

    if (Test-Path -LiteralPath $StdoutPath) {
      $OutputText = Get-Content -LiteralPath $StdoutPath -Raw
    }
    if (Test-Path -LiteralPath $StderrPath) {
      $ErrorText = Get-Content -LiteralPath $StderrPath -Raw
    }

    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }

    docker exec $Identity.container rm -f $ContainerSqlPath 2>$null |
      Out-Null

    throw @"
无法获取 PostgreSQL advisory lock。

stdout:
$OutputText

stderr:
$ErrorText
"@
  }

  $BackendPid = [int]$MarkerMatch.Groups['pid'].Value
  $ObservedApplicationName =
    $MarkerMatch.Groups['application'].Value.Trim()

  $Lock = [ordered]@{
    process = $Process
    backendPid = $BackendPid
    applicationName = $ApplicationName
    containerSqlPath = $ContainerSqlPath
    stdoutPath = $StdoutPath
    stderrPath = $StderrPath
  }

  if ($ObservedApplicationName -cne $ApplicationName) {
    Stop-AdvisoryLock `
      -Identity $Identity `
      -Lock $Lock

    throw @"
advisory lock application_name 被服务端改变。

Expected: $ApplicationName
Actual  : $ObservedApplicationName
"@
  }

  $VerifySql = @"
SELECT count(*)::text
FROM pg_locks AS l
JOIN pg_stat_activity AS a
  ON a.pid = l.pid
WHERE l.locktype = 'advisory'
  AND l.database = (
    SELECT oid
    FROM pg_database
    WHERE datname = current_database()
  )
  AND l.classid = $AdvisoryLockClassId
  AND l.objid = $AdvisoryLockObjectId
  AND l.objsubid = 2
  AND l.pid = $BackendPid
  AND l.granted
  AND a.datname = current_database()
  AND a.application_name = '$ApplicationName';
"@
  $Count = @(
    Invoke-ContainerSql `
      -Container $Identity.container `
      -DatabaseUser $Identity.databaseUser `
      -DatabaseName $Identity.databaseName `
      -Sql $VerifySql `
      -ReadOnly
  )

  if ($Count.Count -ne 1 -or [int]$Count[0] -ne 1) {
    Stop-AdvisoryLock `
      -Identity $Identity `
      -Lock $Lock

    throw 'advisory lock 获取后 PID / key 验证失败'
  }

  return $Lock
}

function Stop-AdvisoryLock {
  param(
    [Parameter(Mandatory = $true)][object]$Identity,
    [Parameter(Mandatory = $true)][object]$Lock
  )

  $CleanupError = $null

  try {
    $TerminateSql = @"
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid = $($Lock.backendPid)
  AND datname = current_database()
  AND application_name = '$($Lock.applicationName)';
"@
    Invoke-ContainerSql `
      -Container $Identity.container `
      -DatabaseUser $Identity.databaseUser `
      -DatabaseName $Identity.databaseName `
      -Sql $TerminateSql |
        Out-Null
  }
  catch {
    $CleanupError = $_
  }

  try {
    if ($Lock.process -and -not $Lock.process.HasExited) {
      Stop-Process -Id $Lock.process.Id -Force -ErrorAction SilentlyContinue
    }
  }
  catch {
    if (-not $CleanupError) {
      $CleanupError = $_
    }
  }

  $Released = $false
  foreach ($Attempt in 1..100) {
    try {
      $ReleaseSql = @"
SELECT count(*)::text
FROM pg_locks
WHERE locktype = 'advisory'
  AND classid = $AdvisoryLockClassId
  AND objid = $AdvisoryLockObjectId
  AND objsubid = 2
  AND pid = $($Lock.backendPid)
  AND granted;
"@
      $Remaining = @(
        Invoke-ContainerSql `
          -Container $Identity.container `
          -DatabaseUser $Identity.databaseUser `
          -DatabaseName $Identity.databaseName `
          -Sql $ReleaseSql `
          -ReadOnly
      )

      if (
        $Remaining.Count -eq 1 -and
        [int]$Remaining[0] -eq 0
      ) {
        $Released = $true
        break
      }
    }
    catch {
      if (-not $CleanupError) {
        $CleanupError = $_
      }
    }

    Start-Sleep -Milliseconds 100
  }

  docker exec $Identity.container rm -f $Lock.containerSqlPath 2>$null |
    Out-Null

  if (-not $Released) {
    throw "advisory lock backend 未确认释放：$($Lock.backendPid)"
  }

  if ($CleanupError) {
    Write-Warning "advisory lock 清理期间发生非阻断错误：$($CleanupError.Exception.Message)"
  }
}

function Assert-NoOtherActiveTransactions {
  param(
    [Parameter(Mandatory = $true)][object]$Identity,
    [Parameter(Mandatory = $true)][object]$Lock
  )

  $Sql = @"
SELECT count(*)::text
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND pid <> $($Lock.backendPid)
  AND state <> 'idle';
"@

  $Lines = @(
    Invoke-ContainerSql `
      -Container $Identity.container `
      -DatabaseUser $Identity.databaseUser `
      -DatabaseName $Identity.databaseName `
      -Sql $Sql `
      -ReadOnly
  )

  if ($Lines.Count -ne 1 -or [int]$Lines[0] -ne 0) {
    throw '检测到其他 active transaction；请停止写入流量后重试'
  }
}
function New-DatabaseDump {
  param(
    [Parameter(Mandatory = $true)][object]$Identity,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][string]$RunId
  )

  $ContainerPath = "/tmp/radar-source-schema-$RunId.dump"

  docker exec `
    -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
    $Identity.container `
    pg_dump `
    -Fc `
    --no-owner `
    --no-privileges `
    -U $Identity.databaseUser `
    -d $Identity.databaseName `
    -f $ContainerPath

  if ($LASTEXITCODE -ne 0) {
    throw '创建 apply-time PostgreSQL backup 失败'
  }

  try {
    docker cp `
      "$($Identity.container):$ContainerPath" `
      $DestinationPath |
        Out-Null

    if ($LASTEXITCODE -ne 0) {
      throw '复制 apply-time PostgreSQL backup 失败'
    }
  }
  finally {
    docker exec $Identity.container rm -f $ContainerPath 2>$null |
      Out-Null
  }

  $Item = Get-Item -LiteralPath $DestinationPath
  if ([long]$Item.Length -le 0) {
    throw 'apply-time PostgreSQL backup 为空'
  }

  return [ordered]@{
    path = $DestinationPath
    bytes = [long]$Item.Length
    sha256 = Get-FileSha256 $DestinationPath
  }
}

function Wait-PostgresReady {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$DatabaseUser,
    [Parameter(Mandatory = $true)][string]$DatabaseName
  )

  foreach ($Attempt in 1..60) {
    docker exec `
      $Container `
      pg_isready `
      -U $DatabaseUser `
      -d $DatabaseName `
      2>$null |
        Out-Null

    if ($LASTEXITCODE -eq 0) {
      return
    }

    Start-Sleep -Seconds 1
  }

  throw '一次性临时 PostgreSQL 未就绪'
}

function Invoke-PayloadMigration {
  param(
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][ValidateSet('temporary', 'source')]
    [string]$Target
  )

  $Parsed = [Uri]$DatabaseUrl
  if ($Parsed.Host -notin @('127.0.0.1', 'localhost')) {
    throw "$Target DATABASE_URL 不是 loopback"
  }
  if ($Parsed.Port -le 0) {
    throw "$Target DATABASE_URL 缺少明确端口"
  }

  $EnvironmentNames = @(
    'DATABASE_URL',
    'PAYLOAD_DB_PUSH',
    'RADAR_PUBLIC_RATINGS_SCHEMA_READY',
    'NEXT_TELEMETRY_DISABLED'
  )
  $SavedEnvironment = @{}
  foreach ($Name in $EnvironmentNames) {
    $SavedEnvironment[$Name] = [ordered]@{
      exists = Test-Path "Env:$Name"
      value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
  }

  try {
    $env:DATABASE_URL = $DatabaseUrl
    $env:PAYLOAD_DB_PUSH = 'false'
    $env:RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
    $env:NEXT_TELEMETRY_DISABLED = '1'

    pnpm exec payload migrate *> $LogPath
    $ExitCode = $LASTEXITCODE
  }
  finally {
    foreach ($Name in $SavedEnvironment.Keys) {
      if ($SavedEnvironment[$Name].exists) {
        [Environment]::SetEnvironmentVariable(
          $Name,
          [string]$SavedEnvironment[$Name].value,
          'Process'
        )
      }
      else {
        [Environment]::SetEnvironmentVariable(
          $Name,
          $null,
          'Process'
        )
      }
    }
  }

  if ($ExitCode -ne 0) {
    $Tail = @(
      Get-Content `
        -LiteralPath $LogPath `
        -Tail 100 `
        -ErrorAction SilentlyContinue
    ) -join "`n"

    throw "$Target Payload migration 失败：`n$Tail"
  }
}

function Invoke-TemporaryRehearsal {
  param(
    [Parameter(Mandatory = $true)][object]$SourceBefore,
    [Parameter(Mandatory = $true)][object]$SourceIdentity,
    [Parameter(Mandatory = $true)][string]$DumpPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][string]$RunId
  )

  $TempContainer = "radar-metrics-schema-rehearsal-$RunId".ToLowerInvariant()
  $TempPort = Get-FreeLoopbackPort
  $TempCreated = $false

  try {
    docker run `
      -d `
      --name $TempContainer `
      -e POSTGRES_HOST_AUTH_METHOD=trust `
      -e "POSTGRES_USER=$($SourceIdentity.databaseUser)" `
      -e "POSTGRES_DB=$($SourceIdentity.databaseName)" `
      -p "127.0.0.1:${TempPort}:5432" `
      $SourceIdentity.image |
        Out-Null

    if ($LASTEXITCODE -ne 0) {
      throw '建立一次性临时 PostgreSQL 容器失败'
    }
    $TempCreated = $true

    Wait-PostgresReady `
      -Container $TempContainer `
      -DatabaseUser $SourceIdentity.databaseUser `
      -DatabaseName $SourceIdentity.databaseName

    docker cp $DumpPath "${TempContainer}:/tmp/source.dump" |
      Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw '复制 backup 到临时 PostgreSQL 失败'
    }

    $RestoreStdout = Join-Path $OutputDirectory 'temporary-restore.stdout.txt'
    $RestoreStderr = Join-Path $OutputDirectory 'temporary-restore.stderr.txt'

    docker exec `
      $TempContainer `
      pg_restore `
      --exit-on-error `
      --no-owner `
      --no-privileges `
      -U $SourceIdentity.databaseUser `
      -d $SourceIdentity.databaseName `
      /tmp/source.dump `
      1> $RestoreStdout `
      2> $RestoreStderr

    if ($LASTEXITCODE -ne 0) {
      throw '恢复 backup 到一次性临时 PostgreSQL 失败'
    }

    docker exec $TempContainer rm -f /tmp/source.dump |
      Out-Null

    $TempIdentity = [ordered]@{
      container = $TempContainer
      databaseUser = $SourceIdentity.databaseUser
      databaseName = $SourceIdentity.databaseName
      databaseUrl =
        "postgresql://$([Uri]::EscapeDataString($SourceIdentity.databaseUser))" +
        "@127.0.0.1:${TempPort}/" +
        "$([Uri]::EscapeDataString($SourceIdentity.databaseName))"
    }

    $Before = Get-DatabaseSnapshot `
      -Identity $TempIdentity `
      -Label 'temporary-before-migration' `
      -OutputDirectory $OutputDirectory

    Assert-PreMigrationState `
      -Snapshot $Before `
      -Label '一次性临时库'

    Assert-ExactSequence `
      -Expected $SourceBefore.fingerprints `
      -Actual $Before.fingerprints `
      -Label '源库与临时库既有字段指纹'
    Assert-ExactSequence `
      -Expected $SourceBefore.columns `
      -Actual $Before.columns `
      -Label '源库与临时库列'
    Assert-ExactSequence `
      -Expected $SourceBefore.migrations `
      -Actual $Before.migrations `
      -Label '源库与临时库 migration ledger'

    $MigrationLog = Join-Path $OutputDirectory 'temporary-migration.log'
    Invoke-PayloadMigration `
      -DatabaseUrl $TempIdentity.databaseUrl `
      -LogPath $MigrationLog `
      -Target temporary

    $After = Get-DatabaseSnapshot `
      -Identity $TempIdentity `
      -Label 'temporary-after-migration' `
      -OutputDirectory $OutputDirectory

    $MetricState = Assert-PostMigrationState `
      -Before $Before `
      -After $After `
      -Identity $TempIdentity `
      -Label '一次性临时库'

    return [ordered]@{
      container = $TempContainer
      port = $TempPort
      before = $Before
      after = $After
      metricState = $MetricState
      exactRestore = $true
      migrationExecuted = $true
      removed = $true
    }
  }
  finally {
    if ($TempCreated) {
      docker rm -f -v $TempContainer 2>$null |
        Out-Null
    }
  }
}

function Get-ExpectedExecuteConfirmation {
  param([Parameter(Mandatory = $true)][string]$AuthorizedMainHead)

  return (
    'EXECUTE-ONCE-RADAR-PUBLIC-METRICS-SOURCE-SCHEMA-V01::' +
    $AuthorizedMainHead.ToLowerInvariant() +
    '::RADAR-PUBLIC-METRICS-10563-0001::' +
    $ExpectedCandidateSha256 +
    '::' +
    $ExpectedBackupSha256 +
    '::20260803_102741_radar_public_metrics_v01::NO-METRIC-IMPORT'
  )
}

function Assert-Authorization {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedAuthorizationPath,
    [Parameter(Mandatory = $true)][string]$CurrentHead
  )

  $Authorization = Get-Content `
    -LiteralPath $ResolvedAuthorizationPath `
    -Raw `
    -Encoding UTF8 |
      ConvertFrom-Json -Depth 100

  $ExpectedStatement = (
    'AUTHORIZE SOURCE SCHEMA MIGRATION ONLY; ' +
    'DO NOT IMPORT RADAR PUBLIC METRICS; NEVER RERUN'
  )

  if (
    $Authorization.schemaVersion -ne
      'radar-public-metrics-source-schema-authorization-v01' -or
    $Authorization.productionAuthorization -ne $true -or
    $Authorization.scope -ne 'source-schema-migration-only' -or
    $Authorization.authorizedMainHead.ToLowerInvariant() -ne
      $CurrentHead.ToLowerInvariant() -or
    $Authorization.releaseId -ne $ReleaseId -or
    $Authorization.candidateSha256 -ne $ExpectedCandidateSha256 -or
    $Authorization.independentReviewSha256 -ne
      $ExpectedIndependentReviewSha256 -or
    $Authorization.backupSha256 -ne $ExpectedBackupSha256 -or
    $Authorization.migrationName -ne $ExpectedMigrationName -or
    $Authorization.metricImportAuthorized -ne $false -or
    $Authorization.historicalApplyOnceRerun -ne $false -or
    $Authorization.approvalStatement -ne $ExpectedStatement -or
    -not $Authorization.approvedAt
  ) {
    throw '生产授权文件不符合 source-schema-only 精确授权契约'
  }

  return $Authorization
}

function Assert-NoHistoricalExecutionReceipt {
  param([Parameter(Mandatory = $true)][string]$OutputRoot)

  if (-not (Test-Path -LiteralPath $OutputRoot -PathType Container)) {
    return
  }

  $Receipts = @(
    Get-ChildItem `
      -LiteralPath $OutputRoot `
      -Filter 'source-schema-execution-receipt.json' `
      -File `
      -Recurse `
      -ErrorAction SilentlyContinue
  )

  foreach ($ReceiptFile in $Receipts) {
    try {
      $Receipt = Get-Content `
        -LiteralPath $ReceiptFile.FullName `
        -Raw `
        -Encoding UTF8 |
          ConvertFrom-Json -Depth 100

      if (
        $Receipt.executed -eq $true -and
        $Receipt.migrationName -eq $ExpectedMigrationName -and
        $Receipt.candidateSha256 -eq $ExpectedCandidateSha256
      ) {
        throw "检测到历史成功执行回执，Never rerun：$($ReceiptFile.FullName)"
      }
    }
    catch {
      if ($_.Exception.Message -match 'Never rerun') {
        throw
      }
    }
  }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $RepoRoot

$ExpectedToolHead = $ExpectedToolHead.ToLowerInvariant()
$ResolvedCandidatePath = (
  Resolve-Path -LiteralPath $CandidatePath
).Path
$ResolvedReviewZipPath = (
  Resolve-Path -LiteralPath $IndependentReviewZipPath
).Path
$ResolvedBackupPath = (
  Resolve-Path -LiteralPath $BackupPath
).Path
$ResolvedResearchRepo = (
  Resolve-Path -LiteralPath $ResearchRepo
).Path

if ($Mode -eq 'DryRun') {
  if ($Confirm -ne $DryRunConfirmation) {
    throw 'DryRun 确认字符串不匹配'
  }

  if ($AuthorizationPath) {
    throw 'DryRun 不接受 AuthorizationPath'
  }
}
else {
  if (-not $AuthorizationPath) {
    throw 'Execute 必须提供新的 AuthorizationPath'
  }

  if ($MaintenanceConfirmation -ne $MaintenanceConfirmationExpected) {
    throw 'Execute 维护窗口确认字符串不匹配'
  }
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$RunId = "$Stamp-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$OutputRoot = Join-Path `
  $RepoRoot `
  'data_local\outputs\radar-public-metrics-source-schema-apply-once-v01'
$OutputDirectory = Join-Path $OutputRoot "$($Mode.ToLowerInvariant())-$RunId"
$BackupDirectory = Join-Path `
  $RepoRoot `
  'data_local\backups\radar-public-metrics-source-schema-apply-once-v01'
$ResearchWorktree = Join-Path `
  $RepoRoot `
  "data_local\worktrees\radar-public-metrics-source-schema-$RunId"
$FailurePath = Join-Path $OutputDirectory 'source-schema-failure.json'
$DryRunReceiptPath = Join-Path $OutputDirectory 'source-schema-dryrun-receipt.json'
$ExecutionReceiptPath = Join-Path `
  $OutputDirectory `
  'source-schema-execution-receipt.json'

New-Item `
  -ItemType Directory `
  -Path $OutputDirectory, $BackupDirectory, (Split-Path -Parent $ResearchWorktree) `
  -Force |
    Out-Null

$ResearchWorktreeAdded = $false
$SourceIdentity = $null
$AdvisoryLock = $null
$SourceBefore = $null
$SourceImmediatelyBefore = $null
$SourceAfter = $null
$Rehearsal = $null
$ApplyTimeBackup = $null
$OperationError = $null
$Executed = $false

try {
  Write-Host "`n===== 锁定代码与证据 =====" -ForegroundColor Cyan

  $RepositoryBinding = Assert-RepositoryBinding `
    -RepoRoot $RepoRoot `
    -ToolHead $ExpectedToolHead

  $AssetBinding = Assert-AssetBinding `
    -ResolvedCandidatePath $ResolvedCandidatePath `
    -ResolvedReviewZipPath $ResolvedReviewZipPath `
    -ResolvedBackupPath $ResolvedBackupPath

  Assert-NoHistoricalExecutionReceipt -OutputRoot $OutputRoot

  Add-ResearchWorktree `
    -ResolvedResearchRepo $ResolvedResearchRepo `
    -WorktreePath $ResearchWorktree
  $ResearchWorktreeAdded = $true

  $ResearchBinding = Assert-ResearchRelease `
    -WorktreePath $ResearchWorktree

  Write-Host "Merged preflight main: $ExpectedMergedPreflightMain"
  Write-Host "Current tool head     : $ExpectedToolHead"
  Write-Host "Candidate SHA-256     : $ExpectedCandidateSha256"
  Write-Host "Review ZIP SHA-256    : $ExpectedIndependentReviewSha256"
  Write-Host "Backup SHA-256        : $ExpectedBackupSha256"
  Write-Host "Research Release      : $ReleaseId" -ForegroundColor Green

  Write-Host "`n===== 锁定源 PostgreSQL =====" -ForegroundColor Cyan

  docker version | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker 不可用'
  }

  $SourceIdentity = Get-SourceConnectionIdentity `
    -Container $SourcePostgresContainer

  $AdvisoryLock = Start-AdvisoryLock `
    -Identity $SourceIdentity `
    -OutputDirectory $OutputDirectory `
    -RunId $RunId

  Write-Host "PostgreSQL advisory lock: acquired" -ForegroundColor Green

  $SourceBefore = Get-DatabaseSnapshot `
    -Identity $SourceIdentity `
    -Label 'source-before' `
    -OutputDirectory $OutputDirectory `
    -ReadOnly

  Assert-PreMigrationState `
    -Snapshot $SourceBefore `
    -Label '源数据库'

  Write-Host "Source pre-state: exact 36 columns / 9 migrations" `
    -ForegroundColor Green

  Write-Host "`n===== 一次性临时数据库完整演练 =====" `
    -ForegroundColor Cyan

  $Rehearsal = Invoke-TemporaryRehearsal `
    -SourceBefore $SourceBefore `
    -SourceIdentity $SourceIdentity `
    -DumpPath $ResolvedBackupPath `
    -OutputDirectory $OutputDirectory `
    -RunId $RunId

  Write-Host "Temporary rehearsal: 36 -> 44 / 9 -> 10" `
    -ForegroundColor Green
  Write-Host "Temporary metric rows: 0" -ForegroundColor Green

  $SourceImmediatelyBefore = Get-DatabaseSnapshot `
    -Identity $SourceIdentity `
    -Label 'source-after-rehearsal' `
    -OutputDirectory $OutputDirectory `
    -ReadOnly

  Assert-PreMigrationState `
    -Snapshot $SourceImmediatelyBefore `
    -Label '演练后源数据库'

  Assert-ExactSequence `
    -Expected $SourceBefore.fingerprints `
    -Actual $SourceImmediatelyBefore.fingerprints `
    -Label '演练期间源数据库既有字段指纹'
  Assert-ExactSequence `
    -Expected $SourceBefore.columns `
    -Actual $SourceImmediatelyBefore.columns `
    -Label '演练期间源数据库列'
  Assert-ExactSequence `
    -Expected $SourceBefore.migrations `
    -Actual $SourceImmediatelyBefore.migrations `
    -Label '演练期间源数据库 migration ledger'

  if ($Mode -eq 'DryRun') {
    $DryRunReceipt = [ordered]@{
      schemaVersion = "$SchemaVersion-dryrun-receipt"
      accepted = $true
      completedAt = [DateTime]::UtcNow.ToString('o')
      mode = 'DryRun'
      website = $RepositoryBinding
      historicalCandidate = [ordered]@{
        baseMain = $HistoricalCandidateBaseMain
        toolHead = $HistoricalCandidateToolHead
        candidateSha256 = $ExpectedCandidateSha256
      }
      research = [ordered]@{
        head = $ExpectedResearchHead
        releaseId = $ReleaseId
      }
      independentReviewSha256 = $ExpectedIndependentReviewSha256
      backup = [ordered]@{
        bytes = $ExpectedBackupBytes
        sha256 = $ExpectedBackupSha256
      }
      source = [ordered]@{
        containerId = $SourceIdentity.containerId
        columns = [int]$SourceBefore.summary.ratingColumns
        migrations = [int]$SourceBefore.summary.payloadMigrations
        unchanged = $true
      }
      rehearsal = [ordered]@{
        exactRestore = $true
        migrationName = $ExpectedMigrationName
        columnsBefore = [int]$Rehearsal.before.summary.ratingColumns
        columnsAfter = [int]$Rehearsal.after.summary.ratingColumns
        migrationsBefore = [int]$Rehearsal.before.summary.payloadMigrations
        migrationsAfter = [int]$Rehearsal.after.summary.payloadMigrations
        nonEmptyMetricRows = [int]$Rehearsal.metricState.nonEmptyMetricRows
      }
      authorization = [ordered]@{
        sourceMigration = $false
        metricImport = $false
        productionAuthorization = $false
        historicalApplyOnceRerun = $false
      }
      executed = $false
      decision = 'accept_source_schema_apply_once_dryrun_only'
    }

    Write-JsonFile `
      -Path $DryRunReceiptPath `
      -Value $DryRunReceipt

    Write-Host "`n===== DryRun 完成 =====" -ForegroundColor Cyan
    Write-Host "Source migration : false" -ForegroundColor Green
    Write-Host "Metric import    : false" -ForegroundColor Green
    Write-Host "Authorization    : false" -ForegroundColor Green
    Write-Host "Receipt          : $DryRunReceiptPath"
    return
  }

  Write-Host "`n===== 验证新的明确生产授权 =====" -ForegroundColor Cyan

  $ResolvedAuthorizationPath = (
    Resolve-Path -LiteralPath $AuthorizationPath
  ).Path
  $Authorization = Assert-Authorization `
    -ResolvedAuthorizationPath $ResolvedAuthorizationPath `
    -CurrentHead $RepositoryBinding.head

  $ExpectedExecuteConfirm = Get-ExpectedExecuteConfirmation `
    -AuthorizedMainHead $RepositoryBinding.head

  if ($Confirm -ne $ExpectedExecuteConfirm) {
    throw 'Execute 长确认字符串不匹配'
  }

  Assert-NoOtherActiveTransactions `
    -Identity $SourceIdentity `
    -Lock $AdvisoryLock

  Write-Host "Production authorization: exact source-schema-only" `
    -ForegroundColor Yellow
  Write-Host "Metric import authorization: false" `
    -ForegroundColor Green

  Write-Host "`n===== 创建执行前新鲜回滚备份 =====" `
    -ForegroundColor Cyan

  $ApplyTimeBackupPath = Join-Path `
    $BackupDirectory `
    "source-immediately-before-radar-public-metrics-schema-$RunId.dump"

  $ApplyTimeBackup = New-DatabaseDump `
    -Identity $SourceIdentity `
    -DestinationPath $ApplyTimeBackupPath `
    -RunId $RunId

  Write-Host "Apply-time backup bytes : $($ApplyTimeBackup.bytes)"
  Write-Host "Apply-time backup SHA256: $($ApplyTimeBackup.sha256)" `
    -ForegroundColor Yellow

  $SourceImmediatelyBefore = Get-DatabaseSnapshot `
    -Identity $SourceIdentity `
    -Label 'source-immediately-before-execute' `
    -OutputDirectory $OutputDirectory `
    -ReadOnly

  Assert-PreMigrationState `
    -Snapshot $SourceImmediatelyBefore `
    -Label '执行前源数据库'
  Assert-ExactSequence `
    -Expected $SourceBefore.fingerprints `
    -Actual $SourceImmediatelyBefore.fingerprints `
    -Label '执行前最终既有字段指纹'

  Assert-NoOtherActiveTransactions `
    -Identity $SourceIdentity `
    -Lock $AdvisoryLock

  Write-Host "`n===== 执行唯一 additive migration =====" `
    -ForegroundColor Yellow

  $SourceMigrationLog = Join-Path `
    $OutputDirectory `
    'source-migration.log'

  Invoke-PayloadMigration `
    -DatabaseUrl $SourceIdentity.databaseUrl `
    -LogPath $SourceMigrationLog `
    -Target source

  $Executed = $true

  Write-Host "`n===== 执行后完整验证 =====" -ForegroundColor Cyan

  $SourceAfter = Get-DatabaseSnapshot `
    -Identity $SourceIdentity `
    -Label 'source-after' `
    -OutputDirectory $OutputDirectory `
    -ReadOnly

  $SourceMetricState = Assert-PostMigrationState `
    -Before $SourceImmediatelyBefore `
    -After $SourceAfter `
    -Identity $SourceIdentity `
    -Label '源数据库'

  $ExecutionReceipt = [ordered]@{
    schemaVersion = "$SchemaVersion-execution-receipt"
    accepted = $true
    completedAt = [DateTime]::UtcNow.ToString('o')
    executed = $true
    migrationName = $ExpectedMigrationName
    website = $RepositoryBinding
    authorization = [ordered]@{
      path = $ResolvedAuthorizationPath
      approvedAt = [string]$Authorization.approvedAt
      scope = [string]$Authorization.scope
      productionAuthorization = $true
      metricImportAuthorized = $false
      historicalApplyOnceRerun = $false
    }
    research = [ordered]@{
      head = $ExpectedResearchHead
      releaseId = $ReleaseId
    }
    candidateSha256 = $ExpectedCandidateSha256
    independentReviewSha256 = $ExpectedIndependentReviewSha256
    preflightBackup = [ordered]@{
      bytes = $ExpectedBackupBytes
      sha256 = $ExpectedBackupSha256
    }
    applyTimeBackup = $ApplyTimeBackup
    sourceBefore = [ordered]@{
      works = [int]$SourceImmediatelyBefore.summary.works
      publicRecords = [int]$SourceImmediatelyBefore.summary.publicRecords
      publicRatings = [int]$SourceImmediatelyBefore.summary.publicRatings
      columns = [int]$SourceImmediatelyBefore.summary.ratingColumns
      migrations = [int]$SourceImmediatelyBefore.summary.payloadMigrations
      fingerprints = $SourceImmediatelyBefore.fingerprints
    }
    sourceAfter = [ordered]@{
      works = [int]$SourceAfter.summary.works
      publicRecords = [int]$SourceAfter.summary.publicRecords
      publicRatings = [int]$SourceAfter.summary.publicRatings
      columns = [int]$SourceAfter.summary.ratingColumns
      migrations = [int]$SourceAfter.summary.payloadMigrations
      fingerprints = $SourceAfter.fingerprints
      nonEmptyMetricRows = [int]$SourceMetricState.nonEmptyMetricRows
    }
    boundaries = [ordered]@{
      metricImportExecuted = $false
      payloadContentWrite = $false
      worksMutation = $false
      publicRecordsMutation = $false
      existingPublicRatingsFieldsMutation = $false
      historicalApplyOnceRerun = $false
    }
    decision = 'source_schema_migration_applied_once_and_verified'
  }

  Write-JsonFile `
    -Path $ExecutionReceiptPath `
    -Value $ExecutionReceipt

  Write-Host "`n===== Execute 完成 =====" -ForegroundColor Cyan
  Write-Host "Source schema    : 36 -> 44" -ForegroundColor Green
  Write-Host "Migrations       : 9 -> 10" -ForegroundColor Green
  Write-Host "Existing data    : UNCHANGED" -ForegroundColor Green
  Write-Host "Metric content   : EMPTY" -ForegroundColor Green
  Write-Host "Metric import    : false" -ForegroundColor Green
  Write-Host "Never rerun      : enforced" -ForegroundColor Green
  Write-Host "Receipt          : $ExecutionReceiptPath"
  Write-Host "Rollback backup  : $($ApplyTimeBackup.path)" `
    -ForegroundColor Yellow
}
catch {
  $OperationError = $_

  $Failure = [ordered]@{
    schemaVersion = "$SchemaVersion-failure"
    failedAt = [DateTime]::UtcNow.ToString('o')
    mode = $Mode
    executed = $Executed
    migrationName = $ExpectedMigrationName
    candidateSha256 = $ExpectedCandidateSha256
    backupSha256 = $ExpectedBackupSha256
    applyTimeBackup = $ApplyTimeBackup
    error = $_.Exception.Message
    metricImportExecuted = $false
    rollbackRequired = $Executed
    rollbackGuide =
      'docs/guides/radar-public-metrics-source-schema-rollback-v01.md'
  }

  try {
    Write-JsonFile -Path $FailurePath -Value $Failure
  }
  catch {
    Write-Warning "写入失败回执失败：$($_.Exception.Message)"
  }
}
finally {
  if ($AdvisoryLock -and $SourceIdentity) {
    Stop-AdvisoryLock `
      -Identity $SourceIdentity `
      -Lock $AdvisoryLock
  }

  if ($ResearchWorktreeAdded) {
    git -C $ResolvedResearchRepo worktree remove `
      --force `
      $ResearchWorktree `
      2>$null |
        Out-Null
    git -C $ResolvedResearchRepo worktree prune 2>$null |
      Out-Null
  }
}

if ($OperationError) {
  throw $OperationError
}
