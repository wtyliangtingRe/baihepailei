param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-fA-F0-9]{40}$')]
  [string]$ExpectedToolHead,

  [Parameter(Mandatory = $true)]
  [ValidateSet('PREPARE-RADAR-PUBLIC-METRICS-PRODUCTION-PREFLIGHT-V01')]
  [string]$Confirm,

  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$SourcePostgresContainer = 'baihepailei-postgres'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ExpectedBranch = 'agent/radar-public-metrics-production-preflight-v01'
$ExpectedWebsiteBase = 'b5ffbe006913218d32b96c131074b7740bf827a0'
$ExpectedResearchHead = 'c2fe7847ee8b60b439f8e92025437937ceff06d5'
$ReleaseId = 'RADAR-PUBLIC-METRICS-10563-0001'
$ReleaseRelativePath = 'releases\public\radar-public-metrics-10563-0001\v01'
$ExpectedMigrationName = '20260803_102741_radar_public_metrics_v01'
$ExpectedCurrentRatings = 10563
$ExpectedCurrentColumns = 36
$ExpectedMigratedColumns = 44
$ExpectedSourceMigrationCount = 9
$ExpectedManifestSha256 = 'da4b52eae91224a8bab46aebff69734c6a3d2bc3005de415b027a9e4eba6226d'
$ExpectedReleaseFiles = [ordered]@{
  'manifest.json' = $ExpectedManifestSha256
  'metrics.jsonl' = '1bdfda49f4f72a823efc86de42c565d3bdef162136aef697d0dc1d3bb343a946'
  'review-flags.jsonl' = '642881e9760e3d1b0000ee5cbfdd28f58a2afc4b6c7a238f1d753f886d1d2ebe'
  'release-index.jsonl' = '4768614dfbd4d703f3946ce61507fa7610a93093603ed4632ba8da7d85242d36'
}
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

function Get-ContainerEnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $ShellCommand = 'printf "%s" "$' + $Name + '"'
  $Value = @(
    docker exec $Container sh -lc $ShellCommand 2>&1
  ) -join "`n"

  if ($LASTEXITCODE -ne 0) {
    throw "无法读取容器环境变量：$Name"
  }

  return $Value.Trim()
}

function Invoke-ContainerSql {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$DatabaseUser,
    [Parameter(Mandatory = $true)][string]$DatabaseName,
    [Parameter(Mandatory = $true)][string]$Sql,
    [switch]$ReadOnly
  )

  $Arguments = @(
    'exec'
  )

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

function Get-Snapshot {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$DatabaseUser,
    [Parameter(Mandatory = $true)][string]$DatabaseName,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [switch]$ReadOnly,
    [switch]$IncludeRows
  )

  $Prefix = Join-Path $OutputDirectory $Label
  New-Item -ItemType Directory -Path $Prefix -Force | Out-Null

  $SummarySql = @"
SELECT json_build_object(
  'database', current_database(),
  'databaseUser', current_user,
  'transactionReadOnly', current_setting('transaction_read_only'),
  'works', (SELECT count(*) FROM public.works),
  'publicRecords', (SELECT count(*) FROM public.radar_public_records WHERE record_status = 'current'),
  'publicRatings', (SELECT count(*) FROM public.radar_public_ratings WHERE record_status = 'current'),
  'ratingColumns', (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'radar_public_ratings'
  ),
  'payloadMigrations', (SELECT count(*) FROM public.payload_migrations)
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
SELECT 'radar_public_ratings_existing_fields' || E'\t' || count(*)::text || E'\t' ||
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

  $Invoke = @{
    Container = $Container
    DatabaseUser = $DatabaseUser
    DatabaseName = $DatabaseName
  }
  if ($ReadOnly) {
    $Invoke.ReadOnly = $true
  }

  $SummaryLines = @(
    Invoke-ContainerSql @Invoke -Sql $SummarySql
  )
  if ($SummaryLines.Count -ne 1) {
    throw "$Label summary 行数不正确"
  }

  $Summary = $SummaryLines[0] | ConvertFrom-Json -Depth 100
  $Columns = @(Invoke-ContainerSql @Invoke -Sql $ColumnsSql)
  $Migrations = @(Invoke-ContainerSql @Invoke -Sql $MigrationsSql)
  $Fingerprints = @(Invoke-ContainerSql @Invoke -Sql $FingerprintsSql)

  $SummaryPath = Join-Path $Prefix 'summary.json'
  $ColumnsPath = Join-Path $Prefix 'columns.json'
  $MigrationsPath = Join-Path $Prefix 'migrations.tsv'
  $FingerprintsPath = Join-Path $Prefix 'fingerprints.tsv'

  Write-JsonFile -Path $SummaryPath -Value $Summary
  Write-JsonFile -Path $ColumnsPath -Value ([ordered]@{ columns = $Columns })
  Write-Utf8File -Path $MigrationsPath -Content (($Migrations -join "`n") + "`n")
  Write-Utf8File -Path $FingerprintsPath -Content (($Fingerprints -join "`n") + "`n")

  $RowsPath = $null
  if ($IncludeRows) {
    $RowsSql = @"
SELECT row_to_json(r)::text
FROM public.radar_public_ratings AS r
WHERE r.record_status = 'current'
ORDER BY r.id;
"@

    $Rows = @(Invoke-ContainerSql @Invoke -Sql $RowsSql)
    $RowsPath = Join-Path $Prefix 'ratings-current.jsonl'
    Write-Utf8File -Path $RowsPath -Content (($Rows -join "`n") + "`n")
  }

  return [ordered]@{
    label = $Label
    summary = $Summary
    columns = $Columns
    migrations = $Migrations
    fingerprints = $Fingerprints
    summaryPath = $SummaryPath
    columnsPath = $ColumnsPath
    migrationsPath = $MigrationsPath
    fingerprintsPath = $FingerprintsPath
    rowsPath = $RowsPath
  }
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

function Assert-SourceState {
  param(
    [Parameter(Mandatory = $true)][object]$Snapshot,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ([int]$Snapshot.summary.publicRatings -ne $ExpectedCurrentRatings) {
    throw "$Label Public Ratings 不是 $ExpectedCurrentRatings"
  }

  if ([int]$Snapshot.summary.publicRecords -ne $ExpectedCurrentRatings) {
    throw "$Label Public Records 不是 $ExpectedCurrentRatings"
  }

  if ([int]$Snapshot.summary.ratingColumns -ne $ExpectedCurrentColumns) {
    throw "$Label Public Ratings 列数不是 $ExpectedCurrentColumns"
  }

  if ([int]$Snapshot.summary.payloadMigrations -ne $ExpectedSourceMigrationCount) {
    throw "$Label payload_migrations 数量不是 $ExpectedSourceMigrationCount"
  }

  foreach ($Column in $MetricColumnNames) {
    if ($Column -in $Snapshot.columns) {
      throw "$Label 已存在指标列：$Column"
    }
  }
}

function Assert-CloneMigratedState {
  param(
    [Parameter(Mandatory = $true)][object]$Before,
    [Parameter(Mandatory = $true)][object]$After
  )

  if ([int]$After.summary.publicRatings -ne $ExpectedCurrentRatings) {
    throw '临时库迁移后 Public Ratings 数量变化'
  }

  if ([int]$After.summary.publicRecords -ne $ExpectedCurrentRatings) {
    throw '临时库迁移后 Public Records 数量变化'
  }

  if ([int]$After.summary.ratingColumns -ne $ExpectedMigratedColumns) {
    throw "临时库迁移后列数不是 $ExpectedMigratedColumns"
  }

  if (
    [int]$After.summary.payloadMigrations -ne
    ([int]$Before.summary.payloadMigrations + 1)
  ) {
    throw '临时库 payload_migrations 没有准确增加 1'
  }

  foreach ($Column in $MetricColumnNames) {
    if ($Column -notin $After.columns) {
      throw "临时库迁移后缺少指标列：$Column"
    }
  }

  Assert-ExactSequence `
    -Expected $Before.fingerprints `
    -Actual $After.fingerprints `
    -Label '临时库既有数据指纹'

  $ExpectedMigrationLine = "$ExpectedMigrationName`t4"
  $NewRows = @(
    $After.migrations |
      Where-Object { $_ -notin $Before.migrations }
  )

  if ($NewRows.Count -ne 1) {
    throw "临时库迁移记录增量不是 1：$($NewRows -join ', ')"
  }

  if ($NewRows[0] -notmatch "^$([regex]::Escape($ExpectedMigrationName))`t[0-9]+$") {
    throw "临时库新增的迁移记录不是 $ExpectedMigrationName：$($NewRows[0])"
  }
}

function Assert-PlannerBeforeSchema {
  param([Parameter(Mandatory = $true)][object]$Summary)

  if (
    $Summary.releaseId -ne $ReleaseId -or
    [int]$Summary.releaseRows -ne $ExpectedCurrentRatings -or
    [int]$Summary.databaseCurrentRows -ne $ExpectedCurrentRatings -or
    $Summary.schemaReady -ne $false -or
    [int]$Summary.statusCounts.blocked -ne $ExpectedCurrentRatings -or
    [int]$Summary.statusCounts.missingRating -ne 0 -or
    [int]$Summary.statusCounts.identityMismatch -ne 0 -or
    [int]$Summary.statusCounts.wouldUpdate -ne 0 -or
    [int]$Summary.wouldUpdateAfterSchema -ne $ExpectedCurrentRatings
  ) {
    throw '源库迁移前 planner 结果不符合 10,563 条 schema-blocked 预期'
  }
}

function Assert-PlannerAfterSchema {
  param([Parameter(Mandatory = $true)][object]$Summary)

  if (
    $Summary.releaseId -ne $ReleaseId -or
    [int]$Summary.releaseRows -ne $ExpectedCurrentRatings -or
    [int]$Summary.databaseCurrentRows -ne $ExpectedCurrentRatings -or
    $Summary.schemaReady -ne $true -or
    [int]$Summary.statusCounts.wouldUpdate -ne $ExpectedCurrentRatings -or
    [int]$Summary.statusCounts.alreadyCurrent -ne 0 -or
    [int]$Summary.statusCounts.missingRating -ne 0 -or
    [int]$Summary.statusCounts.identityMismatch -ne 0 -or
    [int]$Summary.statusCounts.blocked -ne 0
  ) {
    throw '临时库迁移后 planner 结果不符合 10,563 条 wouldUpdate 预期'
  }
}

if ($Confirm -ne 'PREPARE-RADAR-PUBLIC-METRICS-PRODUCTION-PREFLIGHT-V01') {
  throw '确认字符串不匹配'
}

$ExpectedToolHead = $ExpectedToolHead.ToLowerInvariant()
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $RepoRoot

Write-Host "`n===== 锁定网站工具提交 =====" -ForegroundColor Cyan

$DirtyBefore = @(Get-DirtyPaths)
if ($DirtyBefore.Count -gt 0) {
  throw "网站工作区必须干净：$($DirtyBefore -join ', ')"
}

git fetch origin
if ($LASTEXITCODE -ne 0) {
  throw '获取网站远端更新失败'
}

$CurrentBranch = (git branch --show-current).Trim()
$CurrentHead = (git rev-parse HEAD).Trim().ToLowerInvariant()
$RemoteHead = (git rev-parse "origin/$ExpectedBranch").Trim().ToLowerInvariant()

if ($CurrentBranch -ne $ExpectedBranch) {
  throw "当前分支不是 $ExpectedBranch"
}

if (
  $CurrentHead -ne $ExpectedToolHead -or
  $RemoteHead -ne $ExpectedToolHead
) {
  throw @"
网站工具提交不匹配。

Local : $CurrentHead
Remote: $RemoteHead
Expect: $ExpectedToolHead
"@
}

& git merge-base --is-ancestor $ExpectedWebsiteBase $ExpectedToolHead
if ($LASTEXITCODE -ne 0) {
  throw '当前工具提交不包含已合并的网站 Schema 基线'
}

Write-Host "Tool head: $ExpectedToolHead" -ForegroundColor Green

Write-Host "`n===== 锁定研究 Release =====" -ForegroundColor Cyan

$ResolvedResearchRepo = (Resolve-Path -LiteralPath $ResearchRepo).Path
$ResearchDirty = @(
  git -C $ResolvedResearchRepo status --porcelain=v1 --untracked-files=no
)
if ($ResearchDirty.Count -gt 0) {
  throw '研究仓库存在已跟踪文件修改，停止建立只读 worktree'
}

git -C $ResolvedResearchRepo fetch origin
if ($LASTEXITCODE -ne 0) {
  throw '获取研究仓库远端更新失败'
}

git -C $ResolvedResearchRepo cat-file -e "$ExpectedResearchHead`^{commit}"
if ($LASTEXITCODE -ne 0) {
  throw "研究提交不存在：$ExpectedResearchHead"
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$OutputRoot = Join-Path $RepoRoot 'data_local\outputs\radar-public-metrics-production-preflight-v01'
$OutputDirectory = Join-Path $OutputRoot "preflight-$Stamp"
$BackupDirectory = Join-Path $RepoRoot 'data_local\backups\radar-public-metrics-production-preflight-v01'
$ResearchWorktree = Join-Path $RepoRoot "data_local\worktrees\radar-public-metrics-$Stamp"
New-Item -ItemType Directory -Path $OutputDirectory, $BackupDirectory, (Split-Path -Parent $ResearchWorktree) -Force | Out-Null

$TempContainer = "radar-metrics-preflight-$Stamp".ToLowerInvariant()
$BackupPath = Join-Path $BackupDirectory "source-before-radar-public-metrics-$Stamp.dump"
$BackupContainerPath = "/tmp/source-before-radar-public-metrics-$Stamp.dump"
$FailurePath = Join-Path $OutputDirectory 'preflight-failure.json'
$CandidatePath = Join-Path $OutputDirectory 'production-preflight-candidate.json'
$ReceiptPath = Join-Path $OutputDirectory 'production-preflight-receipt.json'
$OperationError = $null
$ResearchWorktreeAdded = $false
$TempContainerCreated = $false
$SourceBefore = $null
$SourceAfter = $null
$CloneBefore = $null
$CloneAfter = $null
$BackupSha256 = $null
$BackupBytes = 0
$TempPort = $null

try {
  git -C $ResolvedResearchRepo worktree add --detach $ResearchWorktree $ExpectedResearchHead
  if ($LASTEXITCODE -ne 0) {
    throw '建立研究 Release 只读 worktree 失败'
  }
  $ResearchWorktreeAdded = $true

  $ReleaseDirectory = Join-Path $ResearchWorktree $ReleaseRelativePath
  foreach ($Entry in $ExpectedReleaseFiles.GetEnumerator()) {
    $File = Join-Path $ReleaseDirectory $Entry.Key
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
      throw "Release 文件缺失：$($Entry.Key)"
    }

    $ActualHash = Get-FileSha256 $File
    if ($ActualHash -ne $Entry.Value) {
      throw "Release SHA-256 不匹配：$($Entry.Key)"
    }
  }

  $Manifest = Get-Content `
    -LiteralPath (Join-Path $ReleaseDirectory 'manifest.json') `
    -Raw `
    -Encoding UTF8 |
      ConvertFrom-Json -Depth 100

  if (
    $Manifest.releaseId -ne $ReleaseId -or
    [int]$Manifest.counts.metrics -ne $ExpectedCurrentRatings -or
    [string]$Manifest.policy.policyId -ne 'radar-public-metrics-policy-v01' -or
    [string]$Manifest.policy.status -ne 'frozen' -or
    $Manifest.gates.websiteWrite -ne $false -or
    $Manifest.gates.payloadWrite -ne $false -or
    $Manifest.gates.postgresqlWrite -ne $false -or
    $Manifest.gates.productionAuthorization -ne $false -or
    $Manifest.gates.canonicalRatingReleaseRewrite -ne $false
  ) {
    throw '研究 Release 的冻结或禁写边界不符合预期'
  }

  Write-Host "Research head: $ExpectedResearchHead" -ForegroundColor Green
  Write-Host "Release rows : $ExpectedCurrentRatings" -ForegroundColor Green

  Write-Host "`n===== 读取源 PostgreSQL 身份 =====" -ForegroundColor Cyan

  docker version | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker 不可用'
  }

  $SourceRunning = (
    docker inspect --format '{{.State.Running}}' $SourcePostgresContainer
  ).Trim()

  if ($LASTEXITCODE -ne 0 -or $SourceRunning -ne 'true') {
    throw "源 PostgreSQL 容器未运行：$SourcePostgresContainer"
  }

  $SourceDatabaseUser = Get-ContainerEnvironmentValue `
    -Container $SourcePostgresContainer `
    -Name 'POSTGRES_USER'
  $SourceDatabase = Get-ContainerEnvironmentValue `
    -Container $SourcePostgresContainer `
    -Name 'POSTGRES_DB'
  $SourceImage = (
    docker inspect --format '{{.Config.Image}}' $SourcePostgresContainer
  ).Trim()
  $SourceContainerId = (
    docker inspect --format '{{.Id}}' $SourcePostgresContainer
  ).Trim()

  if (-not $SourceDatabaseUser -or -not $SourceDatabase -or -not $SourceImage) {
    throw '无法解析源 PostgreSQL 身份'
  }

  Write-Host "Container: $SourcePostgresContainer"
  Write-Host "Image    : $SourceImage"
  Write-Host "Database : $SourceDatabase"

  Write-Host "`n===== 源数据库只读快照与迁移前计划 =====" -ForegroundColor Cyan

  $SourceBefore = Get-Snapshot `
    -Container $SourcePostgresContainer `
    -DatabaseUser $SourceDatabaseUser `
    -DatabaseName $SourceDatabase `
    -Label 'source-before' `
    -OutputDirectory $OutputDirectory `
    -ReadOnly `
    -IncludeRows

  Assert-SourceState -Snapshot $SourceBefore -Label '源数据库'

  $PlanBeforeDirectory = Join-Path $OutputDirectory 'plan-before-schema'
  $PlannerBeforeStdout = Join-Path $OutputDirectory 'planner-before-schema.stdout.txt'
  $PlannerBeforeStderr = Join-Path $OutputDirectory 'planner-before-schema.stderr.txt'
  node `
    '.\scripts\radar\plan-radar-public-metrics-overlay-v01.mjs' `
    --release-dir $ReleaseDirectory `
    --database-snapshot $SourceBefore.rowsPath `
    --database-columns $SourceBefore.columnsPath `
    --output-dir $PlanBeforeDirectory `
    1> $PlannerBeforeStdout `
    2> $PlannerBeforeStderr

  if ($LASTEXITCODE -ne 0) {
    throw '源数据库迁移前 planner 失败'
  }

  $PlanBeforeSummary = Get-Content `
    -LiteralPath (Join-Path $PlanBeforeDirectory 'summary.json') `
    -Raw `
    -Encoding UTF8 |
      ConvertFrom-Json -Depth 100
  Assert-PlannerBeforeSchema -Summary $PlanBeforeSummary

  Write-Host "Pre-schema plan: 10,563 schema-blocked" -ForegroundColor Green

  Write-Host "`n===== 创建新鲜一致性备份 =====" -ForegroundColor Cyan

  docker exec `
    -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
    $SourcePostgresContainer `
    pg_dump `
    -Fc `
    --no-owner `
    --no-privileges `
    -U $SourceDatabaseUser `
    -d $SourceDatabase `
    -f $BackupContainerPath

  if ($LASTEXITCODE -ne 0) {
    throw '创建源数据库新鲜备份失败'
  }

  try {
    docker cp `
      "${SourcePostgresContainer}:$BackupContainerPath" `
      $BackupPath | Out-Null

    if ($LASTEXITCODE -ne 0) {
      throw '复制源数据库备份失败'
    }
  }
  finally {
    docker exec $SourcePostgresContainer rm -f $BackupContainerPath 2>$null | Out-Null
  }

  if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
    throw '本地备份文件不存在'
  }

  $BackupBytes = [long](Get-Item -LiteralPath $BackupPath).Length
  if ($BackupBytes -le 0) {
    throw '本地备份文件为空'
  }
  $BackupSha256 = Get-FileSha256 $BackupPath

  Write-Host "Backup bytes : $BackupBytes"
  Write-Host "Backup SHA256: $BackupSha256" -ForegroundColor Yellow

  Write-Host "`n===== 恢复到一次性临时 PostgreSQL =====" -ForegroundColor Cyan

  $TempPort = Get-FreeLoopbackPort

  docker run `
    -d `
    --name $TempContainer `
    -e POSTGRES_HOST_AUTH_METHOD=trust `
    -e "POSTGRES_USER=$SourceDatabaseUser" `
    -e "POSTGRES_DB=$SourceDatabase" `
    -p "127.0.0.1:${TempPort}:5432" `
    $SourceImage | Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw '建立一次性临时 PostgreSQL 容器失败'
  }
  $TempContainerCreated = $true

  $Ready = $false
  foreach ($Attempt in 1..60) {
    docker exec `
      $TempContainer `
      pg_isready `
      -U $SourceDatabaseUser `
      -d $SourceDatabase `
      2>$null | Out-Null

    if ($LASTEXITCODE -eq 0) {
      $Ready = $true
      break
    }

    Start-Sleep -Seconds 1
  }

  if (-not $Ready) {
    throw '一次性临时 PostgreSQL 未就绪'
  }

  docker cp $BackupPath "${TempContainer}:/tmp/source.dump" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw '复制备份到临时 PostgreSQL 失败'
  }

  $RestoreStdout = Join-Path $OutputDirectory 'temporary-restore.stdout.txt'
  $RestoreStderr = Join-Path $OutputDirectory 'temporary-restore.stderr.txt'
  docker exec `
    $TempContainer `
    pg_restore `
    --exit-on-error `
    --no-owner `
    --no-privileges `
    -U $SourceDatabaseUser `
    -d $SourceDatabase `
    /tmp/source.dump `
    1> $RestoreStdout `
    2> $RestoreStderr

  if ($LASTEXITCODE -ne 0) {
    throw '恢复备份到一次性临时 PostgreSQL 失败'
  }

  docker exec $TempContainer rm -f /tmp/source.dump | Out-Null

  $CloneBefore = Get-Snapshot `
    -Container $TempContainer `
    -DatabaseUser $SourceDatabaseUser `
    -DatabaseName $SourceDatabase `
    -Label 'temporary-before-migration' `
    -OutputDirectory $OutputDirectory `
    -IncludeRows

  Assert-SourceState -Snapshot $CloneBefore -Label '临时恢复数据库'
  Assert-ExactSequence `
    -Expected $SourceBefore.fingerprints `
    -Actual $CloneBefore.fingerprints `
    -Label '源数据库与临时恢复数据库既有数据指纹'
  Assert-ExactSequence `
    -Expected $SourceBefore.migrations `
    -Actual $CloneBefore.migrations `
    -Label '源数据库与临时恢复数据库迁移状态'

  Write-Host "Temporary restore: exact source match" -ForegroundColor Green

  Write-Host "`n===== 仅在临时库执行 additive migration =====" -ForegroundColor Cyan

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

  $MigrationLog = Join-Path $OutputDirectory 'temporary-migration.log'
  try {
    $env:DATABASE_URL = "postgresql://${SourceDatabaseUser}@127.0.0.1:${TempPort}/${SourceDatabase}"
    $env:PAYLOAD_DB_PUSH = 'false'
    $env:RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
    $env:NEXT_TELEMETRY_DISABLED = '1'

    $DatabaseUrlGatePath = Join-Path $OutputDirectory 'temporary-database-url-gate.json'
    $DatabaseUrlGateScript = @'
const value = process.env.DATABASE_URL || ''
const parsed = new URL(value)
if (parsed.hostname !== '127.0.0.1') throw new Error('DATABASE_URL is not loopback')
if (!parsed.port) throw new Error('DATABASE_URL has no explicit port')
if (!parsed.pathname || parsed.pathname === '/') throw new Error('DATABASE_URL has no database')
process.stdout.write(JSON.stringify({host: parsed.hostname, port: parsed.port, database: parsed.pathname.slice(1)}) + '\n')
'@
    node -e $DatabaseUrlGateScript 1> $DatabaseUrlGatePath

    if ($LASTEXITCODE -ne 0) {
      throw '临时 DATABASE_URL 安全门失败'
    }

    pnpm exec payload migrate *> $MigrationLog
    $MigrationExitCode = $LASTEXITCODE
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
        [Environment]::SetEnvironmentVariable($Name, $null, 'Process')
      }
    }
  }

  if ($MigrationExitCode -ne 0) {
    $Tail = @(
      Get-Content -LiteralPath $MigrationLog -Tail 80 -ErrorAction SilentlyContinue
    ) -join "`n"
    throw "临时库 migration 失败：`n$Tail"
  }

  $CloneAfter = Get-Snapshot `
    -Container $TempContainer `
    -DatabaseUser $SourceDatabaseUser `
    -DatabaseName $SourceDatabase `
    -Label 'temporary-after-migration' `
    -OutputDirectory $OutputDirectory `
    -IncludeRows

  Assert-CloneMigratedState -Before $CloneBefore -After $CloneAfter

  $PlanAfterDirectory = Join-Path $OutputDirectory 'plan-after-schema'
  $PlannerAfterStdout = Join-Path $OutputDirectory 'planner-after-schema.stdout.txt'
  $PlannerAfterStderr = Join-Path $OutputDirectory 'planner-after-schema.stderr.txt'
  node `
    '.\scripts\radar\plan-radar-public-metrics-overlay-v01.mjs' `
    --release-dir $ReleaseDirectory `
    --database-snapshot $CloneAfter.rowsPath `
    --database-columns $CloneAfter.columnsPath `
    --output-dir $PlanAfterDirectory `
    1> $PlannerAfterStdout `
    2> $PlannerAfterStderr

  if ($LASTEXITCODE -ne 0) {
    throw '临时库迁移后 planner 失败'
  }

  $PlanAfterSummary = Get-Content `
    -LiteralPath (Join-Path $PlanAfterDirectory 'summary.json') `
    -Raw `
    -Encoding UTF8 |
      ConvertFrom-Json -Depth 100
  Assert-PlannerAfterSchema -Summary $PlanAfterSummary

  Write-Host "Temporary migration: 36 -> 44 columns" -ForegroundColor Green
  Write-Host "Post-schema plan   : 10,563 wouldUpdate" -ForegroundColor Green

  Write-Host "`n===== 验证源数据库始终未变化 =====" -ForegroundColor Cyan

  $SourceAfter = Get-Snapshot `
    -Container $SourcePostgresContainer `
    -DatabaseUser $SourceDatabaseUser `
    -DatabaseName $SourceDatabase `
    -Label 'source-after' `
    -OutputDirectory $OutputDirectory `
    -ReadOnly

  Assert-SourceState -Snapshot $SourceAfter -Label '最终源数据库'
  Assert-ExactSequence `
    -Expected $SourceBefore.columns `
    -Actual $SourceAfter.columns `
    -Label '源数据库列集合'
  Assert-ExactSequence `
    -Expected $SourceBefore.migrations `
    -Actual $SourceAfter.migrations `
    -Label '源数据库 payload_migrations'
  Assert-ExactSequence `
    -Expected $SourceBefore.fingerprints `
    -Actual $SourceAfter.fingerprints `
    -Label '源数据库数据指纹'

  Write-Host "Source data      : UNCHANGED" -ForegroundColor Green
  Write-Host "Source schema    : UNCHANGED" -ForegroundColor Green
  Write-Host "Source migrations: UNCHANGED" -ForegroundColor Green

  Write-Host "`n===== 生成只读生产预检候选 =====" -ForegroundColor Cyan

  $CriticalPaths = @(
    '.github/workflows/validate-radar-public-metrics-overlay-v01.yml',
    '.github/workflows/validate-radar-public-metrics-production-preflight-v01.yml',
    'docs/guides/radar-public-metrics-overlay-v01.md',
    'docs/guides/radar-public-metrics-production-preflight-v01.md',
    'scripts/radar/plan-radar-public-metrics-overlay-v01.mjs',
    'scripts/radar/prepare-radar-public-metrics-production-preflight-v01.ps1',
    'src/collections/RadarPublicRatings.ts',
    'src/migrations/20260803_102741_radar_public_metrics_v01.ts',
    'src/migrations/20260803_102741_radar_public_metrics_v01.json',
    'src/migrations/index.ts'
  )

  $CriticalCode = @()
  foreach ($RelativePath in $CriticalPaths) {
    $FullPath = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) {
      throw "候选缺少关键代码：$RelativePath"
    }

    $CriticalCode += [ordered]@{
      path = $RelativePath
      bytes = [long](Get-Item -LiteralPath $FullPath).Length
      sha256 = Get-FileSha256 $FullPath
    }
  }

  $ReleaseFiles = [ordered]@{}
  foreach ($Entry in $ExpectedReleaseFiles.GetEnumerator()) {
    $File = Join-Path $ReleaseDirectory $Entry.Key
    $ReleaseFiles[$Entry.Key] = [ordered]@{
      bytes = [long](Get-Item -LiteralPath $File).Length
      sha256 = Get-FileSha256 $File
    }
  }

  $Candidate = [ordered]@{
    schemaVersion = 'radar-public-metrics-production-preflight-candidate-v01'
    accepted = $true
    generatedAt = [DateTime]::UtcNow.ToString('o')
    website = [ordered]@{
      branch = $ExpectedBranch
      baseMain = $ExpectedWebsiteBase
      toolHead = $ExpectedToolHead
      exactMergedMainAncestor = $true
    }
    research = [ordered]@{
      repository = 'wtyliangtingRe/baihepailei-research-data'
      head = $ExpectedResearchHead
      releaseId = $ReleaseId
      releasePath = $ReleaseRelativePath.Replace('\', '/')
      files = $ReleaseFiles
      policyId = [string]$Manifest.policy.policyId
      policySha256 = [string]$Manifest.policy.sha256
      releaseDecision = [string]$Manifest.decision
    }
    source = [ordered]@{
      postgresContainer = $SourcePostgresContainer
      postgresContainerId = $SourceContainerId
      postgresImage = $SourceImage
      database = $SourceDatabase
      databaseUser = $SourceDatabaseUser
      works = [int]$SourceBefore.summary.works
      publicRecords = [int]$SourceBefore.summary.publicRecords
      publicRatings = [int]$SourceBefore.summary.publicRatings
      ratingColumns = [int]$SourceBefore.summary.ratingColumns
      payloadMigrations = [int]$SourceBefore.summary.payloadMigrations
      fingerprintsSha256 = Get-FileSha256 $SourceBefore.fingerprintsPath
      columnsSha256 = Get-FileSha256 $SourceBefore.columnsPath
      migrationsSha256 = Get-FileSha256 $SourceBefore.migrationsPath
      sourceUnchanged = $true
    }
    freshBackup = [ordered]@{
      path = $BackupPath
      bytes = $BackupBytes
      sha256 = $BackupSha256
      retainedLocallyOnly = $true
      includedInEvidence = $false
    }
    temporaryRehearsal = [ordered]@{
      sourceRestoreExact = $true
      columnsBefore = [int]$CloneBefore.summary.ratingColumns
      columnsAfter = [int]$CloneAfter.summary.ratingColumns
      migrationsBefore = [int]$CloneBefore.summary.payloadMigrations
      migrationsAfter = [int]$CloneAfter.summary.payloadMigrations
      migrationName = $ExpectedMigrationName
      existingDataFingerprintUnchanged = $true
      plannerBeforeSchema = [ordered]@{
        schemaReady = $false
        blocked = [int]$PlanBeforeSummary.statusCounts.blocked
        wouldUpdateAfterSchema = [int]$PlanBeforeSummary.wouldUpdateAfterSchema
        missingRating = [int]$PlanBeforeSummary.statusCounts.missingRating
        identityMismatch = [int]$PlanBeforeSummary.statusCounts.identityMismatch
      }
      plannerAfterSchema = [ordered]@{
        schemaReady = $true
        wouldUpdate = [int]$PlanAfterSummary.statusCounts.wouldUpdate
        alreadyCurrent = [int]$PlanAfterSummary.statusCounts.alreadyCurrent
        missingRating = [int]$PlanAfterSummary.statusCounts.missingRating
        identityMismatch = [int]$PlanAfterSummary.statusCounts.identityMismatch
        blocked = [int]$PlanAfterSummary.statusCounts.blocked
      }
      temporaryContainerWillBeRemoved = $true
    }
    criticalCode = $CriticalCode
    authorization = [ordered]@{
      sourceMigration = $false
      metricImport = $false
      payloadWrite = $false
      postgresqlContentWrite = $false
      worksMutation = $false
      humanAssessmentMutation = $false
      productionAuthorization = $false
      historicalApplyOnceRerun = $false
    }
    nextGate = 'independent_review_before_source_migration_authorization'
    decision = 'accept_metrics_schema_production_preflight_candidate_only'
  }

  Write-JsonFile -Path $CandidatePath -Value $Candidate
  $CandidateSha256 = Get-FileSha256 $CandidatePath

  $Receipt = [ordered]@{
    schemaVersion = 'radar-public-metrics-production-preflight-receipt-v01'
    accepted = $true
    completedAt = [DateTime]::UtcNow.ToString('o')
    candidatePath = $CandidatePath
    candidateSha256 = $CandidateSha256
    backupPath = $BackupPath
    backupBytes = $BackupBytes
    backupSha256 = $BackupSha256
    sourceDataUnchanged = $true
    sourceSchemaUnchanged = $true
    sourceMigrationsUnchanged = $true
    temporaryMigrationExecuted = $true
    sourceMigrationExecuted = $false
    metricImportExecuted = $false
    productionAuthorization = $false
    decision = 'accept_metrics_production_preflight_receipt_v01'
  }
  Write-JsonFile -Path $ReceiptPath -Value $Receipt

  $SecretPattern = '(?i)(postgres(?:ql)?://|password\s*[:=]|payload_secret|jwt_secret|private[_ -]?key)'
  $TextFiles = @(
    Get-ChildItem -LiteralPath $OutputDirectory -Recurse -File |
      Where-Object {
        $_.Extension -in @('.json', '.jsonl', '.txt', '.tsv', '.md', '.log') -or
        $_.Name -eq 'SHA256SUMS'
      }
  )

  foreach ($File in $TextFiles) {
    $Match = Select-String `
      -LiteralPath $File.FullName `
      -Pattern $SecretPattern `
      -Quiet
    if ($Match) {
      throw "证据目录含潜在敏感内容：$($File.FullName)"
    }
  }

  $ChecksumPath = Join-Path $OutputDirectory 'SHA256SUMS.txt'
  $ChecksumLines = @(
    Get-ChildItem -LiteralPath $OutputDirectory -Recurse -File |
      Where-Object { $_.FullName -ne $ChecksumPath } |
      Sort-Object FullName |
      ForEach-Object {
        $Relative = [System.IO.Path]::GetRelativePath(
          $OutputDirectory,
          $_.FullName
        ).Replace('\', '/')
        "$(Get-FileSha256 $_.FullName)  $Relative"
      }
  )
  Write-Utf8File -Path $ChecksumPath -Content (($ChecksumLines -join "`n") + "`n")

  Write-Host "Candidate SHA256: $CandidateSha256" -ForegroundColor Yellow
}
catch {
  $OperationError = $_
}
finally {
  if ($TempContainerCreated) {
    docker rm -f -v $TempContainer 2>$null | Out-Null
  }

  if ($ResearchWorktreeAdded) {
    git -C $ResolvedResearchRepo worktree remove --force $ResearchWorktree 2>$null | Out-Null
    git -C $ResolvedResearchRepo worktree prune 2>$null | Out-Null
  }
}

if ($null -ne $OperationError) {
  try {
    Write-JsonFile -Path $FailurePath -Value ([ordered]@{
      schemaVersion = 'radar-public-metrics-production-preflight-failure-v01'
      failedAt = [DateTime]::UtcNow.ToString('o')
      message = $OperationError.Exception.Message
      websiteToolHead = $ExpectedToolHead
      researchHead = $ExpectedResearchHead
      releaseId = $ReleaseId
      backupPath = $BackupPath
      backupBytes = $BackupBytes
      backupSha256 = $BackupSha256
      temporaryContainerRemoved = $true
      sourceMigrationExecuted = $false
      metricImportExecuted = $false
      productionAuthorization = $false
      inspectBeforeRetry = $true
    })
  }
  catch {
    # Preserve the original failure.
  }

  throw $OperationError
}

$DirtyAfter = @(Get-DirtyPaths)
if ($DirtyAfter.Count -gt 0) {
  throw "预检运行后网站工作区出现修改：$($DirtyAfter -join ', ')"
}

Write-Host "`n===== 生产只读预检完成 =====" -ForegroundColor Cyan
Write-Host "Output   : $OutputDirectory"
Write-Host "Candidate: $CandidatePath"
Write-Host "Backup   : $BackupPath"
Write-Host ''
Write-Host 'Source data       : UNCHANGED' -ForegroundColor Green
Write-Host 'Source schema     : UNCHANGED' -ForegroundColor Green
Write-Host 'Source migrations : UNCHANGED' -ForegroundColor Green
Write-Host 'Temporary migrate : TRUE' -ForegroundColor Green
Write-Host 'Metrics wouldUpdate: 10,563' -ForegroundColor Green
Write-Host 'Source migration  : FALSE' -ForegroundColor Green
Write-Host 'Metric import     : FALSE' -ForegroundColor Green
Write-Host 'Production auth   : FALSE' -ForegroundColor Green
