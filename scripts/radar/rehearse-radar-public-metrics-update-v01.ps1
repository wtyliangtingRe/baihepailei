param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedToolHead,

    [Parameter(Mandatory = $true)]
    [string]$CandidatePath,

    [Parameter(Mandatory = $true)]
    [string]$PlanReviewZipPath,

    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [Parameter(Mandatory = $true)]
    [ValidateSet('REHEARSE-RADAR-PUBLIC-METRICS-UPDATE-V01')]
    [string]$Confirm
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBase =
    '62768b16d7f2bba102bb4391999b479b1fda4110'

$ExpectedBranch =
    'agent/radar-public-metrics-update-rehearsal-v01'

$ExpectedResearchHead =
    'c2fe7847ee8b60b439f8e92025437937ceff06d5'

$ExpectedReleaseId =
    'RADAR-PUBLIC-METRICS-10563-0001'

$ExpectedCandidateSha =
    '7c387dba1e5c6bfa9e3fe312c39b7ff203d969386209c02536b821f03f923b21'

$ExpectedPlanReviewZipSha =
    '6f724b85a0f125bc99d3b0074f9f017609b7acff9b91ddfa5bb3b570afa544c5'

$ExpectedSchemaExecutionReceiptSha =
    'aaaf3a2d0e05ed565e673198a9b134717945b56b49038b97243d958d60ed63a2'

$ExpectedBackupSha =
    'e9fc00aa5e66cb4d03c34397da80df21c5b109ccb0bed6b967ad9c41dad3fae5'

$ExpectedBackupBytes = 37207203L

$SourceContainer = 'baihepailei-postgres'
$ExpectedSourceContainerId =
    '89eea3013fbfb18506eb1febef1c76b8d5b171d95737c59388ff6510e4402a1e'
$ExpectedSourceImage = 'postgres:17-alpine'
$DatabaseUser = 'baihe'
$DatabaseName = 'baihepailei'

$ResearchRepo =
    'D:\0GitHubtest\baihepailei-research-data'

$ReleaseRelativePath =
    'releases\public\radar-public-metrics-10563-0001\v01'

$ImporterPath =
    '.\scripts\radar\run-radar-public-metrics-update-rehearsal-v01.mjs'

$OutputRoot =
    '.\data_local\outputs\radar-public-metrics-update-rehearsal-v01'

$ReviewRoot =
    '.\data_local\review-packages\radar-public-metrics-update-rehearsal-v01'

$ExpectedFiles = @(
    '.github/workflows/validate-radar-public-metrics-update-rehearsal-v01.yml',
    'config/radar-public-metrics-update-rehearsal-v01.lock.json',
    'docs/guides/radar-public-metrics-update-rehearsal-v01.md',
    'scripts/radar/rehearse-radar-public-metrics-update-v01.ps1',
    'scripts/radar/run-radar-public-metrics-update-rehearsal-v01.mjs',
    'src/app/(payload)/api/radar-public-metrics-update-rehearsal-marker/route.ts',
    'tests/radar-public-metrics-update-rehearsal.test.mjs'
)

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Equal {
    param(
        [AllowNull()]
        [object]$Expected,

        [AllowNull()]
        [object]$Actual,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $ExpectedText = if ($null -eq $Expected) { '<null>' } else { [string]$Expected }
    $ActualText = if ($null -eq $Actual) { '<null>' } else { [string]$Actual }

    if ($ExpectedText -cne $ActualText) {
        throw @"
$Label 不一致。

Expected: $ExpectedText
Actual  : $ActualText
"@
    }
}

function Assert-File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "文件不存在：$Path"
    }
}

function Get-Sha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return (
        Get-FileHash -LiteralPath $Path -Algorithm SHA256
    ).Hash.ToLowerInvariant()
}

function Write-Utf8 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Content
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

function Write-Json {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    Write-Utf8 `
        -Path $Path `
        -Content ((
            $Value | ConvertTo-Json -Depth 100
        ).TrimEnd() + "`n")
}

function Get-RelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BasePath,

        [Parameter(Mandatory = $true)]
        [string]$FullPath
    )

    return [System.IO.Path]::GetRelativePath(
        $BasePath,
        $FullPath
    ).Replace('\', '/')
}

function Get-FreePort {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Minimum,

        [Parameter(Mandatory = $true)]
        [int]$Maximum
    )

    foreach ($Port in Get-Random -InputObject ($Minimum..$Maximum) -Count ($Maximum - $Minimum + 1)) {
        $Listener = $null
        try {
            $Listener = [System.Net.Sockets.TcpListener]::new(
                [System.Net.IPAddress]::Loopback,
                $Port
            )
            $Listener.Start()
            return $Port
        }
        catch {
            continue
        }
        finally {
            if ($Listener) {
                $Listener.Stop()
            }
        }
    }

    throw "没有可用端口：$Minimum-$Maximum"
}

function Invoke-ContainerSql {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Container,

        [Parameter(Mandatory = $true)]
        [string]$Sql,

        [switch]$ReadOnly
    )

    $PgOptions = if ($ReadOnly) {
        '-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning'
    }
    else {
        '-c TimeZone=UTC -c client_min_messages=warning'
    }

    $Output = @(
        docker exec `
            -e "PGOPTIONS=$PgOptions" `
            $Container `
            psql `
            -X `
            -q `
            -A `
            -t `
            -v 'ON_ERROR_STOP=1' `
            -U $DatabaseUser `
            -d $DatabaseName `
            -c $Sql `
            2>&1
    )

    if ($LASTEXITCODE -ne 0) {
        throw @"
PostgreSQL 查询失败：$Container

$($Output -join "`n")
"@
    }

    return @(
        $Output |
            ForEach-Object { ([string]$_).TrimEnd() } |
            Where-Object { $_ -ne '' }
    )
}

function Get-ProtectedFingerprints {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Container
    )

    return @(
        Invoke-ContainerSql `
            -Container $Container `
            -ReadOnly `
            -Sql @"
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
    )
}

function Get-PublicTableCounts {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Container
    )

    $TableNames = @(
        Invoke-ContainerSql `
            -Container $Container `
            -ReadOnly `
            -Sql @"
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
"@
    )

    $Counts = [ordered]@{}
    foreach ($TableName in $TableNames) {
        if ([string]$TableName -notmatch '^[a-zA-Z0-9_]+$') {
            throw "不安全的表名：$TableName"
        }

        $Rows = @(
            Invoke-ContainerSql `
                -Container $Container `
                -ReadOnly `
                -Sql "SELECT count(*)::text FROM public.\"$TableName\";"
        )

        Assert-Equal `
            -Expected 1 `
            -Actual $Rows.Count `
            -Label "Table count rows：$TableName"

        $Counts[$TableName] = [long]$Rows[0]
    }

    return $Counts
}

function Assert-OnlyAuditAndSessionCountDeltas {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Before,

        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$After
    )

    $BeforeKeys = @($Before.Keys | Sort-Object)
    $AfterKeys = @($After.Keys | Sort-Object)

    Assert-Equal `
        -Expected ($BeforeKeys -join "`n") `
        -Actual ($AfterKeys -join "`n") `
        -Label 'Public table inventory before/after'

    foreach ($TableName in $BeforeKeys) {
        if ($TableName -in @('audit_events', 'users_sessions')) {
            Assert-True `
                -Condition ([long]$After[$TableName] -ge [long]$Before[$TableName]) `
                -Message "允许的审计/会话表发生负增量：$TableName"
            continue
        }

        Assert-Equal `
            -Expected $Before[$TableName] `
            -Actual $After[$TableName] `
            -Label "Unexpected table count delta：$TableName"
    }
}

function Get-MetricState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Container
    )

    $Lines = @(
        Invoke-ContainerSql `
            -Container $Container `
            -ReadOnly `
            -Sql @"
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
  'reviewTrue', count(*) FILTER (WHERE requires_metric_review IS TRUE),
  'reviewFalse', count(*) FILTER (WHERE requires_metric_review IS FALSE),
  'reviewNull', count(*) FILTER (WHERE requires_metric_review IS NULL),
  'relationshipCovered', count(*) FILTER (
    WHERE relationship_evidence_state = 'covered'
  ),
  'relationshipPartial', count(*) FILTER (
    WHERE relationship_evidence_state = 'partial'
  ),
  'relationshipUncovered', count(*) FILTER (
    WHERE relationship_evidence_state = 'uncovered'
  ),
  'metricsReleaseRows', count(*) FILTER (
    WHERE metrics_source_release_id = '$ExpectedReleaseId'
  )
)::text
FROM public.radar_public_ratings
WHERE record_status = 'current';
"@
    )

    Assert-Equal -Expected 1 -Actual $Lines.Count -Label 'Metric-state query rows'
    return $Lines[0] | ConvertFrom-Json -Depth 100
}

function Get-DatabaseSummary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Container
    )

    $Lines = @(
        Invoke-ContainerSql `
            -Container $Container `
            -ReadOnly `
            -Sql @"
SELECT json_build_object(
  'works', (SELECT count(*) FROM public.works),
  'publicRecords', (
    SELECT count(*) FROM public.radar_public_records
    WHERE record_status = 'current'
  ),
  'publicRatings', (
    SELECT count(*) FROM public.radar_public_ratings
    WHERE record_status = 'current'
  ),
  'columns', (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'radar_public_ratings'
  ),
  'migrations', (SELECT count(*) FROM public.payload_migrations)
)::text;
"@
    )

    Assert-Equal -Expected 1 -Actual $Lines.Count -Label 'Database summary rows'
    return $Lines[0] | ConvertFrom-Json -Depth 100
}

function Wait-ForPostgres {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Container
    )

    for ($Attempt = 1; $Attempt -le 90; $Attempt += 1) {
        docker exec $Container pg_isready -U $DatabaseUser -d postgres *> $null
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Start-Sleep -Seconds 1
    }

    throw "临时 PostgreSQL 未就绪：$Container"
}

function Wait-ForMarker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [Parameter(Mandatory = $true)]
        [string]$Nonce
    )

    $Headers = @{
        'x-radar-public-metrics-update-rehearsal-nonce' = $Nonce
    }

    for ($Attempt = 1; $Attempt -le 180; $Attempt += 1) {
        try {
            $Response = Invoke-RestMethod `
                -Uri $Url `
                -Headers $Headers `
                -Method Get `
                -TimeoutSec 5

            if ($Response.rehearsalMode -eq $true) {
                return $Response
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }

    throw "临时 Payload marker 未就绪：$Url"
}

function Stop-ProcessTree {
    param(
        [AllowNull()]
        [System.Diagnostics.Process]$Process
    )

    if (-not $Process) {
        return
    }

    try {
        if (-not $Process.HasExited) {
            taskkill /PID $Process.Id /T /F *> $null
        }
    }
    catch {
        Write-Warning "无法停止临时 Payload 进程树：$($Process.Id)"
    }
}

if ($Confirm -ne 'REHEARSE-RADAR-PUBLIC-METRICS-UPDATE-V01') {
    throw '确认字符串不匹配。'
}

foreach ($Pair in @(
    @{ Name = 'ExpectedToolHead'; Value = $ExpectedToolHead; Pattern = '^[a-fA-F0-9]{40}$' },
    @{ Name = 'Candidate'; Value = $ExpectedCandidateSha; Pattern = '^[a-f0-9]{64}$' },
    @{ Name = 'Plan review'; Value = $ExpectedPlanReviewZipSha; Pattern = '^[a-f0-9]{64}$' }
)) {
    if ([string]$Pair.Value -notmatch [string]$Pair.Pattern) {
        throw "$($Pair.Name) 格式无效。"
    }
}

$ExpectedToolHead = $ExpectedToolHead.ToLowerInvariant()
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $RepoRoot

$TempContainer = $null
$TempPort = $null
$AppPort = $null
$AppProcess = $null
$ResearchWorktree = $null
$ResearchWorktreeAdded = $false
$RunDirectory = $null
$StageDirectory = $null
$OriginalEnvironment = @{}
$SensitiveBstr = [IntPtr]::Zero
$PasswordPlain = $null

try {
    Write-Host "`n===== 1. 锁定工程分支与只读候选 =====" -ForegroundColor Cyan

    Assert-Equal `
        -Expected $ExpectedBranch `
        -Actual (git branch --show-current).Trim() `
        -Label 'Current branch'

    Assert-Equal `
        -Expected $ExpectedToolHead `
        -Actual (git rev-parse HEAD).Trim().ToLowerInvariant() `
        -Label 'Current tool HEAD'

    git fetch origin
    if ($LASTEXITCODE -ne 0) { throw 'git fetch origin 失败' }

    Assert-Equal `
        -Expected $ExpectedBase `
        -Actual (git rev-parse origin/main).Trim().ToLowerInvariant() `
        -Label 'origin/main'

    $Dirty = @(git status --porcelain=v1 --untracked-files=all)
    Assert-Equal -Expected 0 -Actual $Dirty.Count -Label 'Git dirty entries'

    $Changed = @(
        git diff --name-only "$ExpectedBase...$ExpectedToolHead"
    )
    Assert-Equal `
        -Expected (@($ExpectedFiles | Sort-Object) -join "`n") `
        -Actual (@($Changed | ForEach-Object { $_.Replace('\', '/') } | Sort-Object) -join "`n") `
        -Label 'Reviewed file boundary'

    foreach ($Path in @(
        $CandidatePath,
        $PlanReviewZipPath,
        $BackupPath,
        $ImporterPath
    )) {
        Assert-File -Path $Path
    }

    Assert-Equal `
        -Expected $ExpectedCandidateSha `
        -Actual (Get-Sha256 -Path $CandidatePath) `
        -Label 'Candidate SHA-256'

    Assert-Equal `
        -Expected $ExpectedPlanReviewZipSha `
        -Actual (Get-Sha256 -Path $PlanReviewZipPath) `
        -Label 'Plan review ZIP SHA-256'

    Assert-Equal `
        -Expected $ExpectedBackupSha `
        -Actual (Get-Sha256 -Path $BackupPath) `
        -Label 'Apply-time backup SHA-256'

    Assert-Equal `
        -Expected $ExpectedBackupBytes `
        -Actual (Get-Item -LiteralPath $BackupPath).Length `
        -Label 'Apply-time backup bytes'

    $PlanCandidate = Get-Content `
        -LiteralPath $CandidatePath `
        -Raw `
        -Encoding UTF8 |
        ConvertFrom-Json -Depth 100

    Assert-Equal `
        -Expected $ExpectedSchemaExecutionReceiptSha `
        -Actual (
            [string]$PlanCandidate.schemaExecution.executionReceiptSha256
        ).ToLowerInvariant() `
        -Label 'Candidate schema execution receipt SHA-256'

    Assert-Equal `
        -Expected $ExpectedBackupSha `
        -Actual (
            [string]$PlanCandidate.schemaExecution.applyTimeBackupSha256
        ).ToLowerInvariant() `
        -Label 'Candidate apply-time backup SHA-256'

    Assert-Equal `
        -Expected $ExpectedBackupBytes `
        -Actual $PlanCandidate.schemaExecution.applyTimeBackupBytes `
        -Label 'Candidate apply-time backup bytes'

    node --check $ImporterPath
    if ($LASTEXITCODE -ne 0) { throw 'Importer syntax check failed' }

    node --test '.\tests\radar-public-metrics-update-rehearsal.test.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Rehearsal tests failed' }

    Write-Host 'Engineering package and reviewed candidate: exact' -ForegroundColor Green

    Write-Host "`n===== 2. 锁定源库只读前态 =====" -ForegroundColor Cyan

    docker version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker 当前不可用' }

    Assert-Equal `
        -Expected $ExpectedSourceContainerId `
        -Actual (docker inspect --format '{{.Id}}' $SourceContainer).Trim().ToLowerInvariant() `
        -Label 'Source container ID'

    Assert-Equal `
        -Expected $ExpectedSourceImage `
        -Actual (docker inspect --format '{{.Config.Image}}' $SourceContainer).Trim() `
        -Label 'Source image'

    $SourceBeforeSummary = Get-DatabaseSummary -Container $SourceContainer
    $SourceBeforeFingerprints = Get-ProtectedFingerprints -Container $SourceContainer
    $SourceBeforeMetricState = Get-MetricState -Container $SourceContainer
    $SourceBeforeTableCounts = Get-PublicTableCounts -Container $SourceContainer

    Assert-Equal -Expected 35615 -Actual $SourceBeforeSummary.works -Label 'Source Works'
    Assert-Equal -Expected 10563 -Actual $SourceBeforeSummary.publicRecords -Label 'Source Public Records'
    Assert-Equal -Expected 10563 -Actual $SourceBeforeSummary.publicRatings -Label 'Source Public Ratings'
    Assert-Equal -Expected 44 -Actual $SourceBeforeSummary.columns -Label 'Source columns'
    Assert-Equal -Expected 10 -Actual $SourceBeforeSummary.migrations -Label 'Source migrations'
    Assert-Equal -Expected 0 -Actual $SourceBeforeMetricState.nonEmptyMetricRows -Label 'Source metric rows'

    Write-Host 'Source database: exact and read-only' -ForegroundColor Green

    Write-Host "`n===== 3. 建立冻结 Research worktree =====" -ForegroundColor Cyan

    git -C $ResearchRepo fetch origin
    if ($LASTEXITCODE -ne 0) { throw 'Research fetch failed' }

    & git -C $ResearchRepo cat-file -e "$ExpectedResearchHead^{commit}"
    if ($LASTEXITCODE -ne 0) { throw 'Research commit missing' }

    $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $RunId = "$Stamp-$([guid]::NewGuid().ToString('N').Substring(0, 8))"

    New-Item -ItemType Directory -Path $OutputRoot, $ReviewRoot -Force | Out-Null
    $RunDirectory = Join-Path $OutputRoot "rehearsal-$RunId"
    New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null

    $ResearchWorktree = Join-Path `
        $RepoRoot `
        "data_local\worktrees\radar-public-metrics-update-$RunId"
    New-Item -ItemType Directory -Path (Split-Path -Parent $ResearchWorktree) -Force | Out-Null

    git -C $ResearchRepo worktree add --detach $ResearchWorktree $ExpectedResearchHead
    if ($LASTEXITCODE -ne 0) { throw 'Research worktree add failed' }
    $ResearchWorktreeAdded = $true

    $ReleaseDirectory = Join-Path $ResearchWorktree $ReleaseRelativePath
    Assert-File -Path (Join-Path $ReleaseDirectory 'manifest.json')
    Assert-File -Path (Join-Path $ReleaseDirectory 'metrics.jsonl')

    Write-Host "`n===== 4. 恢复即时备份到一次性临时 PostgreSQL =====" -ForegroundColor Cyan

    $TempPort = Get-FreePort -Minimum 31000 -Maximum 31999
    $AppPort = Get-FreePort -Minimum 32000 -Maximum 39999
    $TempContainer = "radar-metrics-update-rehearsal-$RunId"

    docker run `
        -d `
        --name $TempContainer `
        -e "POSTGRES_USER=$DatabaseUser" `
        -e "POSTGRES_DB=$DatabaseName" `
        -e 'POSTGRES_HOST_AUTH_METHOD=trust' `
        -p "127.0.0.1:${TempPort}:5432" `
        $ExpectedSourceImage | Out-Null

    if ($LASTEXITCODE -ne 0) { throw '启动临时 PostgreSQL 失败' }

    Wait-ForPostgres -Container $TempContainer

    docker cp $BackupPath "${TempContainer}:/tmp/source.dump"
    if ($LASTEXITCODE -ne 0) { throw '复制 backup 到临时容器失败' }

    docker exec $TempContainer dropdb -U $DatabaseUser --if-exists $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'dropdb 失败' }

    docker exec $TempContainer createdb -U $DatabaseUser $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'createdb 失败' }

    docker exec $TempContainer pg_restore `
        -U $DatabaseUser `
        -d $DatabaseName `
        --no-owner `
        --no-privileges `
        /tmp/source.dump
    if ($LASTEXITCODE -ne 0) { throw 'pg_restore 失败' }

    $TempRestoredSummary =
        Get-DatabaseSummary -Container $TempContainer

    $TempRestoredFingerprints =
        Get-ProtectedFingerprints -Container $TempContainer

    Assert-Equal `
        -Expected 35615 `
        -Actual $TempRestoredSummary.works `
        -Label 'Temp restored Works'

    Assert-Equal `
        -Expected 10563 `
        -Actual $TempRestoredSummary.publicRecords `
        -Label 'Temp restored Public Records'

    Assert-Equal `
        -Expected 10563 `
        -Actual $TempRestoredSummary.publicRatings `
        -Label 'Temp restored Public Ratings'

    Assert-Equal `
        -Expected 36 `
        -Actual $TempRestoredSummary.columns `
        -Label 'Temp restored columns'

    Assert-Equal `
        -Expected 9 `
        -Actual $TempRestoredSummary.migrations `
        -Label 'Temp restored migrations'

    Assert-Equal `
        -Expected ($SourceBeforeFingerprints -join "`n") `
        -Actual ($TempRestoredFingerprints -join "`n") `
        -Label 'Source/restored protected fingerprints'

    $MigrationDatabaseUrl =
        "postgresql://${DatabaseUser}@127.0.0.1:${TempPort}/${DatabaseName}"

    $DatabaseUrlBeforeMigration =
        [Environment]::GetEnvironmentVariable(
            'DATABASE_URL',
            'Process'
        )

    try {
        $env:DATABASE_URL = $MigrationDatabaseUrl

        pnpm exec payload migrate

        if ($LASTEXITCODE -ne 0) {
            throw 'Disposable schema migration failed'
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable(
            'DATABASE_URL',
            $DatabaseUrlBeforeMigration,
            'Process'
        )
    }

    $TempBeforeSummary = Get-DatabaseSummary -Container $TempContainer
    $TempBeforeFingerprints = Get-ProtectedFingerprints -Container $TempContainer
    $TempBeforeMetricState = Get-MetricState -Container $TempContainer
    $TempBeforeTableCounts = Get-PublicTableCounts -Container $TempContainer

    Assert-Equal -Expected 35615 -Actual $TempBeforeSummary.works -Label 'Temp before Works'
    Assert-Equal -Expected 10563 -Actual $TempBeforeSummary.publicRecords -Label 'Temp before Public Records'
    Assert-Equal -Expected 10563 -Actual $TempBeforeSummary.publicRatings -Label 'Temp before Public Ratings'
    Assert-Equal -Expected 44 -Actual $TempBeforeSummary.columns -Label 'Temp before columns'
    Assert-Equal -Expected 10 -Actual $TempBeforeSummary.migrations -Label 'Temp before migrations'
    Assert-Equal -Expected 0 -Actual $TempBeforeMetricState.nonEmptyMetricRows -Label 'Temp before metric rows'
    Assert-Equal `
        -Expected ($SourceBeforeFingerprints -join "`n") `
        -Actual ($TempBeforeFingerprints -join "`n") `
        -Label 'Source/temp protected fingerprints'

    Write-Host 'Disposable restore: exact 44 / 10 and metrics empty' -ForegroundColor Green

    Write-Host "`n===== 5. 获取 Payload 管理员凭据 =====" -ForegroundColor Cyan

    $Email = [string](
        $env:RADAR_PAYLOAD_EMAIL ??
        $env:PAYLOAD_EXPORT_EMAIL ??
        $env:PAYLOAD_SEED_EMAIL ??
        $env:SITE_OWNER_EMAIL
    )
    $Email = $Email.Trim()

    if (-not $Email) {
        $Email = (Read-Host '输入现有 Payload owner/admin 邮箱').Trim()
    }
    if (-not $Email) { throw 'Payload 管理员邮箱为空' }

    $PasswordPlain = [string](
        $env:RADAR_PAYLOAD_PASSWORD ??
        $env:PAYLOAD_EXPORT_PASSWORD ??
        $env:PAYLOAD_SEED_PASSWORD
    )

    if (-not $PasswordPlain) {
        $SecurePassword = Read-Host '输入现有 Payload owner/admin 密码' -AsSecureString
        $SensitiveBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
        $PasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($SensitiveBstr)
    }
    if (-not $PasswordPlain) { throw 'Payload 管理员密码为空' }

    $Nonce = [guid]::NewGuid().ToString('N')
    $DatabaseUrl = "postgresql://${DatabaseUser}@127.0.0.1:${TempPort}/${DatabaseName}"

    $EnvironmentNames = @(
        'DATABASE_URL',
        'RADAR_PAYLOAD_EMAIL',
        'RADAR_PAYLOAD_PASSWORD',
        'RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_NONCE',
        'RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_PHASE',
        'RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_DATABASE',
        'RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_TOOL_HEAD',
        'RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_RESEARCH_HEAD',
        'RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_RELEASE_ID',
        'RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_CANDIDATE_SHA256'
    )

    foreach ($Name in $EnvironmentNames) {
        $OriginalEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }

    $env:DATABASE_URL = $DatabaseUrl
    $env:RADAR_PAYLOAD_EMAIL = $Email
    $env:RADAR_PAYLOAD_PASSWORD = $PasswordPlain
    $env:RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_NONCE = $Nonce
    $env:RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_DATABASE = $DatabaseName
    $env:RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_TOOL_HEAD = $ExpectedToolHead
    $env:RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_RESEARCH_HEAD = $ExpectedResearchHead
    $env:RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_RELEASE_ID = $ExpectedReleaseId
    $env:RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_CANDIDATE_SHA256 = $ExpectedCandidateSha

    $BaseUrl = "http://127.0.0.1:$AppPort"
    $MarkerUrl = "$BaseUrl/api/radar-public-metrics-update-rehearsal-marker"

    Write-Host "`n===== 6. 启动临时 Payload 并执行 plan/apply/verify =====" -ForegroundColor Cyan

    foreach ($Phase in @('plan', 'apply', 'verify')) {
        $env:RADAR_PUBLIC_METRICS_UPDATE_REHEARSAL_PHASE = $Phase
        $PhaseOutput = Join-Path $RunDirectory $Phase
        New-Item -ItemType Directory -Path $PhaseOutput -Force | Out-Null

        $AppStdout = Join-Path $RunDirectory "payload-$Phase.stdout.log"
        $AppStderr = Join-Path $RunDirectory "payload-$Phase.stderr.log"
        $PhaseLog = Join-Path $RunDirectory "$Phase.stdout.log"
        $Command = "pnpm exec next dev -H 127.0.0.1 -p $AppPort"

        $AppProcess = Start-Process `
            -FilePath 'cmd.exe' `
            -ArgumentList @('/d', '/s', '/c', $Command) `
            -WorkingDirectory $RepoRoot `
            -RedirectStandardOutput $AppStdout `
            -RedirectStandardError $AppStderr `
            -PassThru `
            -WindowStyle Hidden

        try {
            $Marker = Wait-ForMarker -Url $MarkerUrl -Nonce $Nonce
            Assert-Equal -Expected $Phase -Actual $Marker.phase -Label "Marker phase：$Phase"

            node $ImporterPath `
                --release-dir $ReleaseDirectory `
                --url $BaseUrl `
                --out-dir $PhaseOutput `
                --mode $Phase `
                --expected-tool-head $ExpectedToolHead `
                --expected-research-head $ExpectedResearchHead `
                --expected-database $DatabaseName `
                --expected-candidate-sha256 $ExpectedCandidateSha `
                --expected-phase $Phase `
                --confirm 'RUN-RADAR-PUBLIC-METRICS-UPDATE-REHEARSAL-V01' `
                2>&1 | Tee-Object -FilePath $PhaseLog

            if ($LASTEXITCODE -ne 0) {
                throw "Metrics rehearsal phase failed：$Phase"
            }
        }
        finally {
            Stop-ProcessTree -Process $AppProcess
            $AppProcess = $null
            Start-Sleep -Seconds 2
        }
    }

    Write-Host "`n===== 7. 验证临时库后态与源库未变 =====" -ForegroundColor Cyan

    $TempAfterSummary = Get-DatabaseSummary -Container $TempContainer
    $TempAfterFingerprints = Get-ProtectedFingerprints -Container $TempContainer
    $TempAfterMetricState = Get-MetricState -Container $TempContainer
    $TempAfterTableCounts = Get-PublicTableCounts -Container $TempContainer

    Assert-Equal -Expected 35615 -Actual $TempAfterSummary.works -Label 'Temp after Works'
    Assert-Equal -Expected 10563 -Actual $TempAfterSummary.publicRecords -Label 'Temp after Public Records'
    Assert-Equal -Expected 10563 -Actual $TempAfterSummary.publicRatings -Label 'Temp after Public Ratings'
    Assert-Equal -Expected 44 -Actual $TempAfterSummary.columns -Label 'Temp after columns'
    Assert-Equal -Expected 10 -Actual $TempAfterSummary.migrations -Label 'Temp after migrations'
    Assert-Equal `
        -Expected ($TempBeforeFingerprints -join "`n") `
        -Actual ($TempAfterFingerprints -join "`n") `
        -Label 'Temp existing-field fingerprints'

    Assert-Equal -Expected 10563 -Actual $TempAfterMetricState.rows -Label 'Temp metric rows'
    Assert-Equal -Expected 10563 -Actual $TempAfterMetricState.nonEmptyMetricRows -Label 'Temp non-empty metric rows'
    Assert-Equal -Expected 299 -Actual $TempAfterMetricState.reviewTrue -Label 'Temp review true'
    Assert-Equal -Expected 10264 -Actual $TempAfterMetricState.reviewFalse -Label 'Temp review false'
    Assert-Equal -Expected 0 -Actual $TempAfterMetricState.reviewNull -Label 'Temp review null'
    Assert-Equal -Expected 1300 -Actual $TempAfterMetricState.relationshipCovered -Label 'Temp covered'
    Assert-Equal -Expected 1059 -Actual $TempAfterMetricState.relationshipPartial -Label 'Temp partial'
    Assert-Equal -Expected 8204 -Actual $TempAfterMetricState.relationshipUncovered -Label 'Temp uncovered'
    Assert-Equal -Expected 10563 -Actual $TempAfterMetricState.metricsReleaseRows -Label 'Temp Release rows'

    $ApplyReceiptPath = Join-Path $RunDirectory 'apply\accepted-receipt.json'
    $VerifyReceiptPath = Join-Path $RunDirectory 'verify\accepted-receipt.json'
    Assert-File -Path $ApplyReceiptPath
    Assert-File -Path $VerifyReceiptPath

    $ApplyReceipt = Get-Content -LiteralPath $ApplyReceiptPath -Raw | ConvertFrom-Json -Depth 100
    $VerifyReceipt = Get-Content -LiteralPath $VerifyReceiptPath -Raw | ConvertFrom-Json -Depth 100

    Assert-Equal -Expected 10563 -Actual $ApplyReceipt.counts.metricPatch -Label 'Metric PATCH count'
    Assert-Equal -Expected 0 -Actual $ApplyReceipt.counts.postCreate -Label 'POST create count'
    Assert-Equal -Expected 0 -Actual $ApplyReceipt.counts.put -Label 'PUT count'
    Assert-Equal -Expected 0 -Actual $ApplyReceipt.counts.delete -Label 'DELETE count'
    Assert-Equal -Expected 'False' -Actual $ApplyReceipt.productionAuthorization -Label 'Production authorization'
    Assert-Equal -Expected 10563 -Actual $VerifyReceipt.statusCounts.alreadyCurrent -Label 'Verify already current'

    $ApplyRequests = @(
        Get-Content -LiteralPath (Join-Path $RunDirectory 'apply\http-requests.jsonl') |
            Where-Object { $_ } |
            ForEach-Object { $_ | ConvertFrom-Json -Depth 100 }
    )

    Assert-Equal `
        -Expected 10563 `
        -Actual @($ApplyRequests | Where-Object { $_.method -eq 'PATCH' }).Count `
        -Label 'Logged PATCH requests'
    Assert-Equal `
        -Expected 1 `
        -Actual @($ApplyRequests | Where-Object { $_.method -eq 'POST' }).Count `
        -Label 'Logged POST requests'
    Assert-Equal `
        -Expected 0 `
        -Actual @($ApplyRequests | Where-Object { $_.method -eq 'PUT' }).Count `
        -Label 'Logged PUT requests'
    Assert-Equal `
        -Expected 0 `
        -Actual @($ApplyRequests | Where-Object { $_.method -eq 'DELETE' }).Count `
        -Label 'Logged DELETE requests'

    Assert-OnlyAuditAndSessionCountDeltas `
        -Before $TempBeforeTableCounts `
        -After $TempAfterTableCounts

    $SourceAfterSummary = Get-DatabaseSummary -Container $SourceContainer
    $SourceAfterFingerprints = Get-ProtectedFingerprints -Container $SourceContainer
    $SourceAfterMetricState = Get-MetricState -Container $SourceContainer
    $SourceAfterTableCounts = Get-PublicTableCounts -Container $SourceContainer

    Assert-Equal `
        -Expected ($SourceBeforeSummary | ConvertTo-Json -Compress) `
        -Actual ($SourceAfterSummary | ConvertTo-Json -Compress) `
        -Label 'Source summary before/after'
    Assert-Equal `
        -Expected ($SourceBeforeFingerprints -join "`n") `
        -Actual ($SourceAfterFingerprints -join "`n") `
        -Label 'Source fingerprints before/after'
    Assert-Equal `
        -Expected ($SourceBeforeMetricState | ConvertTo-Json -Compress) `
        -Actual ($SourceAfterMetricState | ConvertTo-Json -Compress) `
        -Label 'Source metric state before/after'
    Assert-Equal `
        -Expected ($SourceBeforeTableCounts | ConvertTo-Json -Compress) `
        -Actual ($SourceAfterTableCounts | ConvertTo-Json -Compress) `
        -Label 'Source public table counts before/after'

    Write-Host 'Disposable update converged; source database unchanged' -ForegroundColor Green

    Write-Host "`n===== 8. 生成闭合演练证据 ZIP =====" -ForegroundColor Cyan

    $StageDirectory = Join-Path $ReviewRoot "rehearsal-$RunId-evidence-v01"
    New-Item -ItemType Directory -Path $StageDirectory -Force | Out-Null

    Copy-Item -LiteralPath $CandidatePath -Destination (Join-Path $StageDirectory 'production-import-plan-candidate.json') -Force
    Copy-Item -LiteralPath $PlanReviewZipPath -Destination (Join-Path $StageDirectory 'readonly-plan-independent-review-v01.zip') -Force
    Copy-Item -LiteralPath $RunDirectory -Destination (Join-Path $StageDirectory 'run-output') -Recurse -Force

    Write-Json -Path (Join-Path $StageDirectory 'source-before.json') -Value ([ordered]@{
        summary = $SourceBeforeSummary
        fingerprints = $SourceBeforeFingerprints
        metricState = $SourceBeforeMetricState
        tableCounts = $SourceBeforeTableCounts
    })
    Write-Json -Path (Join-Path $StageDirectory 'source-after.json') -Value ([ordered]@{
        summary = $SourceAfterSummary
        fingerprints = $SourceAfterFingerprints
        metricState = $SourceAfterMetricState
        tableCounts = $SourceAfterTableCounts
    })
    Write-Json -Path (Join-Path $StageDirectory 'temporary-before.json') -Value ([ordered]@{
        summary = $TempBeforeSummary
        fingerprints = $TempBeforeFingerprints
        metricState = $TempBeforeMetricState
        tableCounts = $TempBeforeTableCounts
    })
    Write-Json -Path (Join-Path $StageDirectory 'temporary-after.json') -Value ([ordered]@{
        summary = $TempAfterSummary
        fingerprints = $TempAfterFingerprints
        metricState = $TempAfterMetricState
        tableCounts = $TempAfterTableCounts
    })

    $Acceptance = [ordered]@{
        schemaVersion = 'radar-public-metrics-update-rehearsal-acceptance-v01'
        accepted = $true
        completedAt = [DateTime]::UtcNow.ToString('o')
        toolHead = $ExpectedToolHead
        baseMain = $ExpectedBase
        researchHead = $ExpectedResearchHead
        releaseId = $ExpectedReleaseId
        candidateSha256 = $ExpectedCandidateSha
        planReviewZipSha256 = $ExpectedPlanReviewZipSha
        schemaExecutionReceiptSha256 =
            $ExpectedSchemaExecutionReceiptSha
        backupSha256 = $ExpectedBackupSha
        source = [ordered]@{
            unchanged = $true
            works = 35615
            publicRecords = 10563
            publicRatings = 10563
            columns = 44
            migrations = 10
            nonEmptyMetricRows = 0
        }
        temporary = [ordered]@{
            initialWouldUpdate = 10563
            patchRequests = 10563
            postAlreadyCurrent = 10563
            nonEmptyMetricRows = 10563
            reviewTrue = 299
            reviewFalse = 10264
            relationshipCovered = 1300
            relationshipPartial = 1059
            relationshipUncovered = 8204
            existingFingerprintsUnchanged = $true
        }
        boundaries = [ordered]@{
            disposableDatabaseOnly = $true
            productionAuthorization = $false
            sourceDatabaseWrite = $false
            publicRecordWrite = $false
            worksWrite = $false
            humanReviewWrite = $false
            postCreateRequests = 0
            putRequests = 0
            deleteRequests = 0
        }
        decision = 'accept_disposable_update_only_rehearsal_evidence_v01'
    }

    Write-Json -Path (Join-Path $StageDirectory 'ACCEPTANCE.json') -Value $Acceptance

    $Readme = @"
# Radar Public Metrics update-only disposable rehearsal

- tool head: ``$ExpectedToolHead``
- base main: ``$ExpectedBase``
- Research head: ``$ExpectedResearchHead``
- Release: ``$ExpectedReleaseId``
- source database write: false
- temporary initial plan: 10,563 wouldUpdate
- temporary PATCH requests: 10,563
- temporary post-plan: 10,563 alreadyCurrent
- POST create / PUT / DELETE: 0 / 0 / 0
- existing fields and protected fingerprints: unchanged
- production authorization: false

This evidence accepts only the disposable update-only rehearsal. It does not
create a production candidate and does not authorize source database updates.
"@
    Write-Utf8 -Path (Join-Path $StageDirectory 'README.md') -Content ($Readme.TrimEnd() + "`n")

    $ManifestPath = Join-Path $StageDirectory 'SHA256SUMS.txt'
    $ManifestFullPath = [System.IO.Path]::GetFullPath($ManifestPath)
    $ManifestLines = @(
        Get-ChildItem -LiteralPath $StageDirectory -File -Recurse |
            Where-Object {
                -not [string]::Equals(
                    $_.FullName,
                    $ManifestFullPath,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            } |
            Sort-Object FullName |
            ForEach-Object {
                $Relative = Get-RelativePath -BasePath $StageDirectory -FullPath $_.FullName
                "$(Get-Sha256 -Path $_.FullName)  $Relative"
            }
    )
    Write-Utf8 -Path $ManifestPath -Content (($ManifestLines -join "`n") + "`n")

    $ZipPath = Join-Path $ReviewRoot "rehearsal-$RunId-evidence-v01.zip"
    Compress-Archive -Path (Join-Path $StageDirectory '*') -DestinationPath $ZipPath -CompressionLevel Optimal

    $ZipSha = Get-Sha256 -Path $ZipPath
    $ZipBytes = (Get-Item -LiteralPath $ZipPath).Length
    $DownloadPath = Join-Path (Join-Path $HOME 'Downloads') (Split-Path -Leaf $ZipPath)
    Copy-Item -LiteralPath $ZipPath -Destination $DownloadPath -Force

    Assert-Equal -Expected $ZipSha -Actual (Get-Sha256 -Path $DownloadPath) -Label 'Downloads evidence ZIP SHA-256'

    Write-Host "`n===== Metrics update-only 演练完成 =====" -ForegroundColor Cyan
    Write-Host "Upload this evidence ZIP:"
    Write-Host $DownloadPath
    Write-Host "`nEvidence ZIP SHA-256:"
    Write-Host $ZipSha
    Write-Host "`nEvidence ZIP bytes:"
    Write-Host $ZipBytes
    Write-Host ''
    Write-Host '临时库：10,563 PATCH 并收敛。' -ForegroundColor Green
    Write-Host '源数据库：未写入。' -ForegroundColor Green
    Write-Host 'POST create / PUT / DELETE：0 / 0 / 0。' -ForegroundColor Green
    Write-Host '生产授权：未创建。' -ForegroundColor Green
}
finally {
    Stop-ProcessTree -Process $AppProcess

    foreach ($Name in $OriginalEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable(
            $Name,
            $OriginalEnvironment[$Name],
            'Process'
        )
    }

    $PasswordPlain = $null
    if ($SensitiveBstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($SensitiveBstr)
        $SensitiveBstr = [IntPtr]::Zero
    }

    if ($TempContainer) {
        docker rm -f -v $TempContainer *> $null
    }

    if ($ResearchWorktreeAdded -and $ResearchWorktree) {
        git -C $ResearchRepo worktree remove --force $ResearchWorktree 2>$null | Out-Null
        git -C $ResearchRepo worktree prune 2>$null | Out-Null
    }

    if ($StageDirectory -and (Test-Path -LiteralPath $StageDirectory -PathType Container)) {
        Remove-Item -LiteralPath $StageDirectory -Recurse -Force
    }
}
