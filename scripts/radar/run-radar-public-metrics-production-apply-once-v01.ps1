param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('rehearsal', 'production')]
    [string]$ExecutionMode,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{40}$')]
    [string]$ExpectedToolHead,

    [Parameter(Mandatory = $true)]
    [string]$CandidatePath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ExpectedCandidateSha256,

    [Parameter(Mandatory = $true)]
    [string]$AuthorizationPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ExpectedAuthorizationSha256,

    [Parameter(Mandatory = $true)]
    [string]$ReleaseDirectory,

    [Parameter(Mandatory = $true)]
    [string]$TargetPostgresContainer,

    [Parameter(Mandatory = $true)]
    [string]$TargetDatabase,

    [string]$TargetDatabaseUser = 'baihe',

    [string]$DatabaseUrl = '',

    [string]$PayloadEmail = '',

    [Parameter(Mandatory = $true)]
    [string]$Confirm,

    [int]$ReadyTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ExpectedBranch = 'agent/radar-public-metrics-production-gate-v01'
$ExpectedResearchHead =
    'c2fe7847ee8b60b439f8e92025437937ceff06d5'
$ExpectedReleaseId = 'RADAR-PUBLIC-METRICS-10563-0001'
$ExpectedManifestSha =
    'da4b52eae91224a8bab46aebff69734c6a3d2bc3005de415b027a9e4eba6226d'
$ExpectedMetricsSha =
    '1bdfda49f4f72a823efc86de42c565d3bdef162136aef697d0dc1d3bb343a946'
$ExpectedReleaseChecksumsSha =
    'b3a88c81b449f4636bb7ddfeca6c598998571d794032e761b2eced3bdde420b3'
$ExpectedSourceContainerId =
    '89eea3013fbfb18506eb1febef1c76b8d5b171d95737c59388ff6510e4402a1e'
$ExpectedSourceImage = 'postgres:17-alpine'
$ExpectedSourceDatabase = 'baihepailei'
$RehearsalDatabasePrefix =
    'radar_public_metrics_production_gate_rehearsal_'
$ImporterPath =
    '.\scripts\radar\run-radar-public-metrics-production-import-v01.mjs'
$OutputRoot =
    '.\data_local\outputs\radar-public-metrics-production-gate-v01'
$AdvisoryLockKey1 = 10563
$AdvisoryLockKey2 = 338

$ExpectedProductionConfirm =
    'APPLY-RADAR-PUBLIC-METRICS-10563-ONCE-I-ACCEPT-PRODUCTION-WRITE'
$ExpectedRehearsalConfirm =
    'REHEARSE-RADAR-PUBLIC-METRICS-PRODUCTION-GATE-V01'

$MaximumAuthorizationAgeMinutes = 30
$MaximumClockSkewMinutes = 2
$MaximumBackupAgeMinutes = 30
$MaximumBackupAuthorizationGapMinutes = 15
$MaximumBackupFileTimestampSkewMinutes = 5

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Equal {
    param(
        [AllowNull()][object]$Expected,
        [AllowNull()][object]$Actual,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $ExpectedText = if ($null -eq $Expected) {
        '<null>'
    }
    else {
        [string]$Expected
    }
    $ActualText = if ($null -eq $Actual) {
        '<null>'
    }
    else {
        [string]$Actual
    }

    if ($ExpectedText -cne $ActualText) {
        throw @"
$Label 不一致。

Expected: $ExpectedText
Actual  : $ActualText
"@
    }
}

function Assert-File {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "文件不存在：$Path"
    }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (
        Get-FileHash -LiteralPath $Path -Algorithm SHA256
    ).Hash.ToLowerInvariant()
}

function Write-Utf8 {
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

function Write-Json {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    Write-Utf8 `
        -Path $Path `
        -Content (
            (
                $Value |
                    ConvertTo-Json -Depth 100
            ).TrimEnd() + "`n"
        )
}

function New-DurableControl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $Parent = Split-Path -Parent $Path
    if ($Parent) {
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    }

    $Json = (
        $Value |
            ConvertTo-Json -Depth 100
    ).TrimEnd() + "`n"
    $Bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Json)
    $Stream = $null

    try {
        $Stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $Stream.Write($Bytes, 0, $Bytes.Length)
        $Stream.Flush($true)
    }
    finally {
        if ($Stream) {
            $Stream.Dispose()
        }
    }
}

function Assert-DatabaseUrl {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$ExecutionMode
    )

    $Uri = [uri]$Value
    if ($Uri.Scheme -notin @('postgres', 'postgresql')) {
        throw 'DatabaseUrl scheme 必须是 postgres/postgresql'
    }

    $DatabaseFromUrl = $Uri.AbsolutePath.Trim('/')
    Assert-Equal `
        -Expected $Database `
        -Actual $DatabaseFromUrl `
        -Label 'DatabaseUrl database'

    if ($ExecutionMode -eq 'rehearsal') {
        if ($Uri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
            throw 'Rehearsal DatabaseUrl 必须是 loopback'
        }
        if ($Uri.Port -lt 31000 -or $Uri.Port -gt 31999) {
            throw 'Rehearsal DatabaseUrl port 必须是 31000-31999'
        }
    }
}

function Get-FreePort {
    foreach ($Port in Get-Random -InputObject (32000..39999) -Count 8000) {
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

    throw '没有可用的 Payload 回环端口'
}

function Stop-ProcessTree {
    param([AllowNull()][System.Diagnostics.Process]$Process)

    if (-not $Process) {
        return
    }

    try {
        if (-not $Process.HasExited) {
            if ($IsWindows) {
                taskkill /PID $Process.Id /T /F *> $null
            }
            else {
                Stop-Process -Id $Process.Id -Force
            }
        }
    }
    catch {
        Write-Warning "无法停止进程树：$($Process.Id)"
    }
}

function Invoke-ContainerSql {
    param(
        [Parameter(Mandatory = $true)][string]$Container,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$DatabaseUser,
        [Parameter(Mandatory = $true)][string]$Sql,
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
            -d $Database `
            -c $Sql `
            2>&1
    )

    if ($LASTEXITCODE -ne 0) {
        throw @"
PostgreSQL 查询失败：$Container / $Database

$($Output -join "`n")
"@
    }

    return @(
        $Output |
            ForEach-Object { ([string]$_).TrimEnd() } |
            Where-Object { $_ -ne '' }
    )
}

function Get-DatabaseState {
    param(
        [Parameter(Mandatory = $true)][string]$Container,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$DatabaseUser
    )

    $SummaryLines = @(
        Invoke-ContainerSql `
            -Container $Container `
            -Database $Database `
            -DatabaseUser $DatabaseUser `
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
  'migrations', (SELECT count(*) FROM public.payload_migrations),
  'metricRows', (
    SELECT count(*) FROM public.radar_public_ratings
    WHERE record_status = 'current'
      AND (
        confidence_percent IS NOT NULL
        OR evidence_coverage_percent IS NOT NULL
        OR metrics_policy_version IS NOT NULL
        OR source_metrics_policy_version IS NOT NULL
        OR relationship_evidence_state IS NOT NULL
        OR metrics_source_release_id IS NOT NULL
        OR metrics_calculation_basis_sha256 IS NOT NULL
        OR requires_metric_review IS DISTINCT FROM false
      )
  ),
  'reviewTrue', (
    SELECT count(*) FROM public.radar_public_ratings
    WHERE record_status = 'current'
      AND requires_metric_review IS TRUE
  ),
  'reviewFalse', (
    SELECT count(*) FROM public.radar_public_ratings
    WHERE record_status = 'current'
      AND requires_metric_review IS FALSE
  ),
  'reviewNull', (
    SELECT count(*) FROM public.radar_public_ratings
    WHERE record_status = 'current'
      AND requires_metric_review IS NULL
  ),
  'covered', (
    SELECT count(*) FROM public.radar_public_ratings
    WHERE record_status = 'current'
      AND relationship_evidence_state = 'covered'
  ),
  'partial', (
    SELECT count(*) FROM public.radar_public_ratings
    WHERE record_status = 'current'
      AND relationship_evidence_state = 'partial'
  ),
  'uncovered', (
    SELECT count(*) FROM public.radar_public_ratings
    WHERE record_status = 'current'
      AND relationship_evidence_state = 'uncovered'
  )
)::text;
"@
    )

    Assert-Equal -Expected 1 -Actual $SummaryLines.Count -Label 'Database state rows'

    $StrictFingerprints = @(
        Invoke-ContainerSql `
            -Container $Container `
            -Database $Database `
            -DatabaseUser $DatabaseUser `
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
    )

    $BusinessFingerprints = @(
        Invoke-ContainerSql `
            -Container $Container `
            -Database $Database `
            -DatabaseUser $DatabaseUser `
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
SELECT 'radar_public_ratings_existing_business_fields' || E'\t' ||
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
              'requires_metric_review',
              'updated_at'
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

    return [ordered]@{
        summary = $SummaryLines[0] | ConvertFrom-Json -Depth 100
        strictFingerprints = $StrictFingerprints
        businessFingerprints = $BusinessFingerprints
    }
}

function Assert-InitialState {
    param(
        [Parameter(Mandatory = $true)][object]$State,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Assert-Equal -Expected 35615 -Actual $State.summary.works -Label "$Label Works"
    Assert-Equal -Expected 10563 -Actual $State.summary.publicRecords -Label "$Label Public Records"
    Assert-Equal -Expected 10563 -Actual $State.summary.publicRatings -Label "$Label Public Ratings"
    Assert-Equal -Expected 44 -Actual $State.summary.columns -Label "$Label columns"
    Assert-Equal -Expected 10 -Actual $State.summary.migrations -Label "$Label migrations"
    Assert-Equal -Expected 0 -Actual $State.summary.metricRows -Label "$Label metric rows"
    Assert-Equal -Expected 0 -Actual $State.summary.reviewTrue -Label "$Label review true"
    Assert-Equal -Expected 10563 -Actual $State.summary.reviewFalse -Label "$Label review false"
    Assert-Equal -Expected 0 -Actual $State.summary.reviewNull -Label "$Label review null"
}

function Assert-FinalState {
    param(
        [Parameter(Mandatory = $true)][object]$State,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Assert-Equal -Expected 35615 -Actual $State.summary.works -Label "$Label Works"
    Assert-Equal -Expected 10563 -Actual $State.summary.publicRecords -Label "$Label Public Records"
    Assert-Equal -Expected 10563 -Actual $State.summary.publicRatings -Label "$Label Public Ratings"
    Assert-Equal -Expected 44 -Actual $State.summary.columns -Label "$Label columns"
    Assert-Equal -Expected 10 -Actual $State.summary.migrations -Label "$Label migrations"
    Assert-Equal -Expected 10563 -Actual $State.summary.metricRows -Label "$Label metric rows"
    Assert-Equal -Expected 299 -Actual $State.summary.reviewTrue -Label "$Label review true"
    Assert-Equal -Expected 10264 -Actual $State.summary.reviewFalse -Label "$Label review false"
    Assert-Equal -Expected 0 -Actual $State.summary.reviewNull -Label "$Label review null"
    Assert-Equal -Expected 1300 -Actual $State.summary.covered -Label "$Label covered"
    Assert-Equal -Expected 1059 -Actual $State.summary.partial -Label "$Label partial"
    Assert-Equal -Expected 8204 -Actual $State.summary.uncovered -Label "$Label uncovered"
}

function Start-AdvisoryLock {
    param(
        [Parameter(Mandatory = $true)][string]$Container,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$DatabaseUser,
        [Parameter(Mandatory = $true)][string]$OutputDirectory
    )

    $Stdout = Join-Path $OutputDirectory 'advisory-lock.stdout.log'
    $Stderr = Join-Path $OutputDirectory 'advisory-lock.stderr.log'
    $Docker = (Get-Command docker).Source
    $Sql =
        "SELECT pg_advisory_lock($AdvisoryLockKey1, $AdvisoryLockKey2);`nSELECT pg_sleep(86400);`n"
    $LocalSql = Join-Path $OutputDirectory 'advisory-lock.sql'
    $ContainerSql =
        "/tmp/radar-public-metrics-advisory-lock-$([guid]::NewGuid().ToString('N')).sql"
    Write-Utf8 -Path $LocalSql -Content $Sql

    docker cp $LocalSql "${Container}:$ContainerSql"
    if ($LASTEXITCODE -ne 0) {
        throw '复制 advisory-lock SQL 到容器失败'
    }

    $Process = Start-Process `
        -FilePath $Docker `
        -ArgumentList @(
            'exec',
            $Container,
            'psql',
            '-X',
            '-q',
            '-U',
            $DatabaseUser,
            '-d',
            $Database,
            '-v',
            'ON_ERROR_STOP=1',
            '-f',
            $ContainerSql
        ) `
        -RedirectStandardOutput $Stdout `
        -RedirectStandardError $Stderr `
        -PassThru `
        -NoNewWindow

    Start-Sleep -Seconds 2

    if ($Process.HasExited) {
        throw "advisory lock 进程提前退出：$($Process.ExitCode)"
    }

    $Probe = @(
        Invoke-ContainerSql `
            -Container $Container `
            -Database $Database `
            -DatabaseUser $DatabaseUser `
            -Sql @"
SELECT CASE
  WHEN pg_try_advisory_lock($AdvisoryLockKey1, $AdvisoryLockKey2)
  THEN 'unexpected_acquired'
  ELSE 'held'
END;
"@
    )

    Assert-Equal -Expected 1 -Actual $Probe.Count -Label 'Advisory lock probe rows'
    Assert-Equal -Expected 'held' -Actual $Probe[0] -Label 'Advisory lock state'

    return [ordered]@{
        process = $Process
        containerSql = $ContainerSql
    }
}

function Wait-ForMarker {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Nonce,
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][string]$ExecutionMode,
        [Parameter(Mandatory = $true)][bool]$ProductionAuthorization,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$ToolHead,
        [Parameter(Mandatory = $true)][string]$CandidateSha256,
        [Parameter(Mandatory = $true)][string]$SourceContainerId,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process
    )

    $Headers = @{
        'x-radar-public-metrics-production-nonce' = $Nonce
    }
    $Deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)

    do {
        if ($Process.HasExited) {
            throw "Payload 进程提前退出：$($Process.ExitCode)"
        }

        try {
            $Marker = Invoke-RestMethod `
                -Uri $Url `
                -Headers $Headers `
                -Method Get `
                -TimeoutSec 5

            if (
                $Marker.productionMode -eq $true -and
                [string]$Marker.executionMode -eq $ExecutionMode -and
                [bool]$Marker.productionAuthorization -eq
                    $ProductionAuthorization -and
                [string]$Marker.phase -eq $Phase -and
                [string]$Marker.database -eq $Database -and
                [string]$Marker.toolHead -eq $ToolHead -and
                [string]$Marker.researchHead -eq $ExpectedResearchHead -and
                [string]$Marker.releaseId -eq $ExpectedReleaseId -and
                [string]$Marker.candidateSha256 -eq $CandidateSha256 -and
                [string]$Marker.sourceContainerId -eq $SourceContainerId
            ) {
                return $Marker
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    } while ([DateTime]::UtcNow -lt $Deadline)

    throw "Production marker 未就绪：$Url"
}

function Get-PayloadCredential {
    param(
        [string]$RequestedEmail
    )

    $Email = $RequestedEmail.Trim()
    if (-not $Email) {
        $Email = [string](
            $env:RADAR_PAYLOAD_EMAIL ??
            $env:PAYLOAD_EXPORT_EMAIL ??
            $env:PAYLOAD_SEED_EMAIL ??
            $env:SITE_OWNER_EMAIL
        )
        $Email = $Email.Trim()
    }
    if (-not $Email) {
        $Email = (Read-Host '请输入现有 Payload 管理员邮箱').Trim()
    }
    if (-not $Email) {
        throw 'Payload 管理员邮箱不能为空'
    }

    $Password = [string](
        $env:RADAR_PAYLOAD_PASSWORD ??
        $env:PAYLOAD_EXPORT_PASSWORD ??
        $env:PAYLOAD_SEED_PASSWORD
    )
    $SecurePassword = $null
    $Bstr = [IntPtr]::Zero

    if (-not $Password) {
        $SecurePassword =
            Read-Host '请输入现有 Payload 管理员密码' -AsSecureString
        $Bstr =
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
                $SecurePassword
            )
        $Password =
            [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
    }
    if (-not $Password) {
        throw 'Payload 管理员密码不能为空'
    }

    return [ordered]@{
        email = $Email
        password = $Password
        securePassword = $SecurePassword
        bstr = $Bstr
    }
}

function Start-PayloadApp {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$DatabaseUrl,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][string]$ExecutionMode,
        [Parameter(Mandatory = $true)][bool]$ProductionAuthorization,
        [Parameter(Mandatory = $true)][string]$Nonce,
        [Parameter(Mandatory = $true)][string]$ToolHead,
        [Parameter(Mandatory = $true)][string]$CandidateSha256,
        [Parameter(Mandatory = $true)][string]$SourceContainerId,
        [Parameter(Mandatory = $true)][string]$OutputDirectory
    )

    $Port = Get-FreePort
    $BaseUrl = "http://127.0.0.1:$Port"
    $Stdout = Join-Path $OutputDirectory "payload-$Phase.stdout.log"
    $Stderr = Join-Path $OutputDirectory "payload-$Phase.stderr.log"
    $Command = "pnpm exec next dev -H 127.0.0.1 -p $Port"

    $Names = @(
        'DATABASE_URL',
        'PAYLOAD_DB_PUSH',
        'STEWARDSHIP_NOTICES_SCHEMA_READY',
        'RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY',
        'RADAR_PUBLIC_RECORDS_SCHEMA_READY',
        'RADAR_PUBLIC_RATINGS_SCHEMA_READY',
        'NEXT_PUBLIC_SERVER_URL',
        'RADAR_PUBLIC_METRICS_PRODUCTION_MODE',
        'RADAR_PUBLIC_METRICS_PRODUCTION_NONCE',
        'RADAR_PUBLIC_METRICS_PRODUCTION_PHASE',
        'RADAR_PUBLIC_METRICS_PRODUCTION_EXECUTION_MODE',
        'RADAR_PUBLIC_METRICS_PRODUCTION_AUTHORIZATION',
        'RADAR_PUBLIC_METRICS_PRODUCTION_DATABASE',
        'RADAR_PUBLIC_METRICS_PRODUCTION_TOOL_HEAD',
        'RADAR_PUBLIC_METRICS_PRODUCTION_RESEARCH_HEAD',
        'RADAR_PUBLIC_METRICS_PRODUCTION_RELEASE_ID',
        'RADAR_PUBLIC_METRICS_PRODUCTION_CANDIDATE_SHA256',
        'RADAR_PUBLIC_METRICS_PRODUCTION_SOURCE_CONTAINER_ID'
    )
    $Original = [ordered]@{}

    foreach ($Name in $Names) {
        $Original[$Name] =
            [Environment]::GetEnvironmentVariable($Name, 'Process')
    }

    try {
        $env:DATABASE_URL = $DatabaseUrl
        $env:PAYLOAD_DB_PUSH = 'false'
        $env:STEWARDSHIP_NOTICES_SCHEMA_READY = 'true'
        $env:RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
        $env:RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
        $env:RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
        $env:NEXT_PUBLIC_SERVER_URL = $BaseUrl
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_MODE = 'true'
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_NONCE = $Nonce
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_PHASE = $Phase
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_EXECUTION_MODE =
            $ExecutionMode
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_AUTHORIZATION =
            $ProductionAuthorization.ToString().ToLowerInvariant()
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_DATABASE = $Database
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_TOOL_HEAD = $ToolHead
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_RESEARCH_HEAD =
            $ExpectedResearchHead
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_RELEASE_ID =
            $ExpectedReleaseId
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_CANDIDATE_SHA256 =
            $CandidateSha256
        $env:RADAR_PUBLIC_METRICS_PRODUCTION_SOURCE_CONTAINER_ID =
            $SourceContainerId

        $Process = Start-Process `
            -FilePath 'cmd.exe' `
            -ArgumentList @('/d', '/s', '/c', $Command) `
            -WorkingDirectory $RepoRoot `
            -RedirectStandardOutput $Stdout `
            -RedirectStandardError $Stderr `
            -PassThru `
            -WindowStyle Hidden
    }
    finally {
        foreach ($Name in $Names) {
            [Environment]::SetEnvironmentVariable(
                $Name,
                $Original[$Name],
                'Process'
            )
        }
    }

    return [ordered]@{
        process = $Process
        baseUrl = $BaseUrl
        markerUrl =
            "$BaseUrl/api/radar-public-metrics-production-marker"
    }
}

$ExpectedToolHead = $ExpectedToolHead.ToLowerInvariant()
$ExpectedCandidateSha256 =
    $ExpectedCandidateSha256.ToLowerInvariant()
$ExpectedAuthorizationSha256 =
    $ExpectedAuthorizationSha256.ToLowerInvariant()

if ($ExecutionMode -eq 'production') {
    Assert-Equal `
        -Expected $ExpectedProductionConfirm `
        -Actual $Confirm `
        -Label 'Production confirm'
}
else {
    Assert-Equal `
        -Expected $ExpectedRehearsalConfirm `
        -Actual $Confirm `
        -Label 'Rehearsal confirm'
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $RepoRoot

$AppProcess = $null
$AdvisoryProcess = $null
$AdvisoryContainerSql = $null
$Credentials = $null
$WriterContext = $null
$WritersStopped = $false
$WritersRestarted = $false
$ApplyStarted = $false
$ApplyCompleted = $false
$OperationError = $null

Write-Host "`n===== 1. 锁定代码、候选与授权 =====" -ForegroundColor Cyan

$Dirty = @(git status --porcelain=v1 --untracked-files=all)
Assert-Equal -Expected 0 -Actual $Dirty.Count -Label 'Git dirty entries'

git fetch origin
if ($LASTEXITCODE -ne 0) {
    throw 'git fetch origin 失败'
}

$CurrentBranch = (git branch --show-current).Trim()
if ($ExecutionMode -eq 'production') {
    Assert-Equal -Expected 'main' -Actual $CurrentBranch -Label 'Production branch'
}
else {
    Assert-Equal -Expected $ExpectedBranch -Actual $CurrentBranch -Label 'Rehearsal branch'
}

git pull --ff-only origin $CurrentBranch
if ($LASTEXITCODE -ne 0) {
    throw '更新当前分支失败'
}

Assert-Equal `
    -Expected $ExpectedToolHead `
    -Actual (git rev-parse HEAD).Trim().ToLowerInvariant() `
    -Label 'Local tool HEAD'
Assert-Equal `
    -Expected $ExpectedToolHead `
    -Actual (git rev-parse "origin/$CurrentBranch").Trim().ToLowerInvariant() `
    -Label 'Remote tool HEAD'

foreach ($Path in @(
    $CandidatePath,
    $AuthorizationPath,
    $ImporterPath,
    (Join-Path $ReleaseDirectory 'manifest.json'),
    (Join-Path $ReleaseDirectory 'metrics.jsonl'),
    (Join-Path $ReleaseDirectory 'SHA256SUMS')
)) {
    Assert-File -Path $Path
}

Assert-Equal `
    -Expected $ExpectedManifestSha `
    -Actual (
        Get-Sha256 -Path (
            Join-Path $ReleaseDirectory 'manifest.json'
        )
    ) `
    -Label 'Release manifest SHA-256'
Assert-Equal `
    -Expected $ExpectedMetricsSha `
    -Actual (
        Get-Sha256 -Path (
            Join-Path $ReleaseDirectory 'metrics.jsonl'
        )
    ) `
    -Label 'Release metrics SHA-256'
Assert-Equal `
    -Expected $ExpectedReleaseChecksumsSha `
    -Actual (
        Get-Sha256 -Path (
            Join-Path $ReleaseDirectory 'SHA256SUMS'
        )
    ) `
    -Label 'Release SHA256SUMS SHA-256'

Assert-Equal `
    -Expected $ExpectedCandidateSha256 `
    -Actual (Get-Sha256 -Path $CandidatePath) `
    -Label 'Candidate SHA-256'
Assert-Equal `
    -Expected $ExpectedAuthorizationSha256 `
    -Actual (Get-Sha256 -Path $AuthorizationPath) `
    -Label 'Authorization SHA-256'

$Candidate =
    Get-Content -LiteralPath $CandidatePath -Raw |
        ConvertFrom-Json -Depth 100
$Authorization =
    Get-Content -LiteralPath $AuthorizationPath -Raw |
        ConvertFrom-Json -Depth 100

Assert-Equal `
    -Expected 'radar-public-metrics-post-merge-production-preflight-candidate-v01' `
    -Actual $Candidate.schemaVersion `
    -Label 'Candidate schema'
Assert-Equal -Expected 'True' -Actual $Candidate.accepted -Label 'Candidate accepted'
Assert-Equal -Expected $ExpectedResearchHead -Actual $Candidate.research.head -Label 'Candidate Research HEAD'
Assert-Equal -Expected $ExpectedReleaseId -Actual $Candidate.research.releaseId -Label 'Candidate Release'
Assert-Equal -Expected 10563 -Actual $Candidate.plan.wouldUpdate -Label 'Candidate wouldUpdate'
Assert-Equal -Expected 0 -Actual $Candidate.plan.blocked -Label 'Candidate blockers'
Assert-Equal -Expected 'False' -Actual $Candidate.authorization.productionAuthorization -Label 'Candidate production authorization'

$FreshBackupCreatedAt = $null

if ($ExecutionMode -eq 'production') {
    Assert-Equal `
        -Expected 'radar-public-metrics-production-authorization-v01' `
        -Actual $Authorization.schemaVersion `
        -Label 'Production authorization schema'
    Assert-Equal -Expected 'True' -Actual $Authorization.authorized -Label 'Production authorized'
    Assert-Equal -Expected 'production' -Actual $Authorization.executionMode -Label 'Production execution mode'
    Assert-Equal -Expected $ExpectedToolHead -Actual $Authorization.toolHead -Label 'Authorization tool HEAD'
    Assert-Equal -Expected $ExpectedCandidateSha256 -Actual $Authorization.candidateSha256 -Label 'Authorization candidate SHA'
    Assert-Equal -Expected $ExpectedReleaseId -Actual $Authorization.releaseId -Label 'Authorization Release'
    Assert-Equal -Expected $ExpectedSourceContainerId -Actual $Authorization.sourceContainerId -Label 'Authorization source container ID'
    Assert-Equal -Expected $ExpectedSourceDatabase -Actual $Authorization.database -Label 'Authorization database'
    Assert-Equal -Expected 'False' -Actual $Authorization.automaticRetryAllowed -Label 'Authorization retry'
    Assert-Equal -Expected 'False' -Actual $Authorization.automaticRollbackAllowed -Label 'Authorization rollback'
    Assert-Equal `
        -Expected 'authorize_public_metrics_production_apply_once_v01' `
        -Actual $Authorization.decision `
        -Label 'Authorization decision'

    $CreatedAt = [DateTimeOffset]::Parse(
        [string]$Authorization.createdAt
    ).ToUniversalTime()
    $ExpiresAt = [DateTimeOffset]::Parse(
        [string]$Authorization.expiresAt
    ).ToUniversalTime()
    $Now = [DateTimeOffset]::UtcNow

    if (
        $CreatedAt -lt $Now.AddMinutes(
            -$MaximumAuthorizationAgeMinutes
        ) -or
        $CreatedAt -gt $Now.AddMinutes($MaximumClockSkewMinutes)
    ) {
        throw 'Production authorization 创建时间不在允许的新鲜度/时钟偏差窗口'
    }
    if (
        $ExpiresAt -le $Now -or
        $ExpiresAt -le $CreatedAt -or
        $ExpiresAt -gt $CreatedAt.AddMinutes(
            $MaximumAuthorizationAgeMinutes
        )
    ) {
        throw 'Production authorization 有效期不符合严格 30 分钟窗口'
    }

    $FreshBackupCreatedAt = [DateTimeOffset]::Parse(
        [string]$Authorization.freshBackup.createdAt
    ).ToUniversalTime()

    Assert-Equal `
        -Expected $ExpectedSourceContainerId `
        -Actual (
            [string]$Authorization.freshBackup.sourceContainerId
        ).ToLowerInvariant() `
        -Label 'Fresh backup source container ID'
    Assert-Equal `
        -Expected $ExpectedSourceImage `
        -Actual (
            [string]$Authorization.freshBackup.sourceImage
        ) `
        -Label 'Fresh backup source image'
    Assert-Equal `
        -Expected $ExpectedSourceDatabase `
        -Actual (
            [string]$Authorization.freshBackup.sourceDatabase
        ) `
        -Label 'Fresh backup source database'
    Assert-Equal `
        -Expected $TargetDatabaseUser `
        -Actual (
            [string]$Authorization.freshBackup.sourceDatabaseUser
        ) `
        -Label 'Fresh backup source database user'

    if (
        $FreshBackupCreatedAt -lt $Now.AddMinutes(
            -$MaximumBackupAgeMinutes
        ) -or
        $FreshBackupCreatedAt -gt $Now.AddMinutes(
            $MaximumClockSkewMinutes
        )
    ) {
        throw 'Fresh backup 创建时间不在允许的新鲜度/时钟偏差窗口'
    }

    $BackupAuthorizationGapMinutes =
        ($CreatedAt - $FreshBackupCreatedAt).TotalMinutes

    if (
        $FreshBackupCreatedAt -gt $CreatedAt.AddMinutes(
            $MaximumClockSkewMinutes
        ) -or
        $BackupAuthorizationGapMinutes -gt
            $MaximumBackupAuthorizationGapMinutes
    ) {
        throw 'Fresh backup 与 authorization 不在同一受限时间窗口'
    }
}
else {
    Assert-Equal `
        -Expected 'radar-public-metrics-production-gate-rehearsal-authorization-v01' `
        -Actual $Authorization.schemaVersion `
        -Label 'Rehearsal authorization schema'
    Assert-Equal -Expected 'False' -Actual $Authorization.authorized -Label 'Rehearsal authorized'
    Assert-Equal -Expected 'rehearsal' -Actual $Authorization.executionMode -Label 'Rehearsal execution mode'
    Assert-Equal -Expected $ExpectedToolHead -Actual $Authorization.toolHead -Label 'Rehearsal tool HEAD'
    Assert-Equal -Expected $ExpectedCandidateSha256 -Actual $Authorization.candidateSha256 -Label 'Rehearsal candidate SHA'
    Assert-True `
        -Condition $TargetDatabase.StartsWith($RehearsalDatabasePrefix) `
        -Message 'Rehearsal database 名称不安全'
    Assert-Equal -Expected $TargetDatabase -Actual $Authorization.database -Label 'Rehearsal database'
    Assert-Equal -Expected 'False' -Actual $Authorization.automaticRetryAllowed -Label 'Rehearsal retry'
    Assert-Equal -Expected 'False' -Actual $Authorization.automaticRollbackAllowed -Label 'Rehearsal rollback'
    Assert-Equal `
        -Expected 'allow_disposable_production_gate_rehearsal_only' `
        -Actual $Authorization.decision `
        -Label 'Rehearsal decision'
}

$FreshBackupPath = [string]$Authorization.freshBackup.path
$FreshBackupSha256 =
    ([string]$Authorization.freshBackup.sha256).ToLowerInvariant()
$FreshBackupBytes = [long]$Authorization.freshBackup.bytes
Assert-File -Path $FreshBackupPath
$FreshBackupItem = Get-Item -LiteralPath $FreshBackupPath

Assert-Equal `
    -Expected $FreshBackupSha256 `
    -Actual (Get-Sha256 -Path $FreshBackupPath) `
    -Label 'Fresh backup SHA-256'
Assert-Equal `
    -Expected $FreshBackupBytes `
    -Actual $FreshBackupItem.Length `
    -Label 'Fresh backup bytes'

if ($ExecutionMode -eq 'production') {
    $FreshBackupFileTimestamp =
        [DateTimeOffset]::new(
            $FreshBackupItem.LastWriteTimeUtc
        )
    $FreshBackupFileTimestampSkewMinutes =
        [Math]::Abs(
            (
                $FreshBackupFileTimestamp -
                $FreshBackupCreatedAt
            ).TotalMinutes
        )

    if (
        $FreshBackupFileTimestampSkewMinutes -gt
            $MaximumBackupFileTimestampSkewMinutes
    ) {
        throw 'Fresh backup 声明时间与本地文件时间不一致'
    }
}

Write-Host 'Code, Candidate, authorization and fresh backup: exact' -ForegroundColor Green

Write-Host "`n===== 2. 锁定数据库身份与前态 =====" -ForegroundColor Cyan

docker version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker 当前不可用'
}

$ContainerId = (
    docker inspect --format '{{.Id}}' $TargetPostgresContainer
).Trim().ToLowerInvariant()
$ContainerImage = (
    docker inspect --format '{{.Config.Image}}' $TargetPostgresContainer
).Trim()

if ($ExecutionMode -eq 'production') {
    Assert-Equal -Expected $ExpectedSourceContainerId -Actual $ContainerId -Label 'Source container ID'
    Assert-Equal -Expected $ExpectedSourceImage -Actual $ContainerImage -Label 'Source image'
    Assert-Equal -Expected $ExpectedSourceDatabase -Actual $TargetDatabase -Label 'Source database'
}
else {
    Assert-True `
        -Condition $TargetPostgresContainer.StartsWith(
            'radar-metrics-production-gate-rehearsal-'
        ) `
        -Message 'Rehearsal container 名称不安全'
    Assert-Equal -Expected $ExpectedSourceImage -Actual $ContainerImage -Label 'Rehearsal image'
}

$ActualDatabaseLines = @(
    Invoke-ContainerSql `
        -Container $TargetPostgresContainer `
        -Database $TargetDatabase `
        -DatabaseUser $TargetDatabaseUser `
        -ReadOnly `
        -Sql 'SELECT current_database();'
)
Assert-Equal `
    -Expected 1 `
    -Actual $ActualDatabaseLines.Count `
    -Label 'current_database rows'
Assert-Equal `
    -Expected $TargetDatabase `
    -Actual $ActualDatabaseLines[0] `
    -Label 'current_database exact identity'

$Before = Get-DatabaseState `
    -Container $TargetPostgresContainer `
    -Database $TargetDatabase `
    -DatabaseUser $TargetDatabaseUser
Assert-InitialState -State $Before -Label 'Before'

if ($ExecutionMode -eq 'production') {
    Assert-Equal `
        -Expected ($Candidate.source.protectedFingerprints -join "`n") `
        -Actual ($Before.strictFingerprints -join "`n") `
        -Label 'Candidate/source strict fingerprints'
}

Write-Host 'Database identity and initial state: exact' -ForegroundColor Green

$RunId =
    "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$RunDirectory =
    Join-Path $OutputRoot "apply-once-$ExecutionMode-$RunId"
New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null

$ControlRoot =
    Join-Path $OutputRoot 'apply-control'
New-Item -ItemType Directory -Path $ControlRoot -Force | Out-Null
$ControlName =
    "$ExecutionMode-$TargetDatabase-$ExpectedCandidateSha256.json"
$ControlPath = Join-Path $ControlRoot $ControlName

if (Test-Path -LiteralPath $ControlPath) {
    throw "durable apply-control marker 已存在，禁止自动重跑：$ControlPath"
}

$Control = [ordered]@{
    schemaVersion =
        'radar-public-metrics-production-apply-control-v01'
    executionMode = $ExecutionMode
    database = $TargetDatabase
    targetContainerId = $ContainerId
    toolHead = $ExpectedToolHead
    candidateSha256 = $ExpectedCandidateSha256
    authorizationPath = (Resolve-Path -LiteralPath $AuthorizationPath).Path
    authorizationSha256 = $ExpectedAuthorizationSha256
    freshBackupPath = (Resolve-Path -LiteralPath $FreshBackupPath).Path
    freshBackupSha256 = $FreshBackupSha256
    freshBackupBytes = $FreshBackupBytes
    freshBackupCreatedAt = $(if ($FreshBackupCreatedAt) {
        $FreshBackupCreatedAt.ToString('o')
    }
    else {
        $null
    })
    freshBackupSourceContainerId =
        [string]$Authorization.freshBackup.sourceContainerId
    freshBackupSourceImage =
        [string]$Authorization.freshBackup.sourceImage
    freshBackupSourceDatabase =
        [string]$Authorization.freshBackup.sourceDatabase
    freshBackupSourceDatabaseUser =
        [string]$Authorization.freshBackup.sourceDatabaseUser
    createdAt = [DateTime]::UtcNow.ToString('o')
    state = 'prepared'
    planPassed = $false
    applyStarted = $false
    applyPassed = $false
    verifyPassed = $false
    operatorConfirmationRequired =
        ($ExecutionMode -eq 'production')
    operatorConfirmedAt = $null
    targetDatabaseWrite = $false
    sourceDatabaseWrite = $false
    productionAuthorization = ($ExecutionMode -eq 'production')
    automaticRetryAllowed = $false
    automaticRollbackAllowed = $false
}
New-DurableControl -Path $ControlPath -Value $Control

try {
    Write-Host "`n===== 3. 隔离 writer 并取得 advisory lock =====" -ForegroundColor Cyan

    if ($ExecutionMode -eq 'production') {
        $Library =
            Join-Path `
                $PSScriptRoot `
                'lib\radar-unified-rating-incremental-production-9988-v01.ps1'
        Assert-File -Path $Library
        . $Library

        $WriterContext =
            Get-RadarIncrementalWriterContext $TargetPostgresContainer
        Stop-RadarIncrementalWriters $WriterContext.Writers
        $WritersStopped = $true
        Start-Sleep -Seconds 3
    }

    $AdvisoryLock = Start-AdvisoryLock `
        -Container $TargetPostgresContainer `
        -Database $TargetDatabase `
        -DatabaseUser $TargetDatabaseUser `
        -OutputDirectory $RunDirectory
    $AdvisoryProcess = $AdvisoryLock.process
    $AdvisoryContainerSql = $AdvisoryLock.containerSql

    Write-Host 'Writer isolation and advisory lock: active' -ForegroundColor Green

    if (-not $DatabaseUrl.Trim()) {
        if ($ExecutionMode -eq 'production') {
            $DatabaseUrl = [string](
                $env:DATABASE_URL ??
                $env:PAYLOAD_DATABASE_URL
            )
        }
    }
    if (-not $DatabaseUrl.Trim()) {
        throw 'DatabaseUrl 不能为空'
    }

    Assert-DatabaseUrl `
        -Value $DatabaseUrl `
        -Database $TargetDatabase `
        -ExecutionMode $ExecutionMode

    if ($ExecutionMode -eq 'production') {
        Assert-RadarIncrementalDatabaseUrl `
            $DatabaseUrl `
            $TargetPostgresContainer `
            $TargetDatabase |
            Out-Null
    }

    $Credentials = Get-PayloadCredential -RequestedEmail $PayloadEmail
    $env:RADAR_PAYLOAD_EMAIL = [string]$Credentials.email
    $env:RADAR_PAYLOAD_PASSWORD = [string]$Credentials.password

    Write-Host "`n===== 4. 执行 plan / apply / verify =====" -ForegroundColor Cyan

    foreach ($Phase in @('plan', 'apply', 'verify')) {
        $PhaseDirectory = Join-Path $RunDirectory $Phase
        New-Item -ItemType Directory -Path $PhaseDirectory -Force | Out-Null
        $Nonce = [guid]::NewGuid().ToString('N')
        $ProductionAuthorization = ($ExecutionMode -eq 'production')

        $App = Start-PayloadApp `
            -RepoRoot $RepoRoot `
            -DatabaseUrl $DatabaseUrl `
            -Database $TargetDatabase `
            -Phase $Phase `
            -ExecutionMode $ExecutionMode `
            -ProductionAuthorization $ProductionAuthorization `
            -Nonce $Nonce `
            -ToolHead $ExpectedToolHead `
            -CandidateSha256 $ExpectedCandidateSha256 `
            -SourceContainerId $ContainerId `
            -OutputDirectory $RunDirectory
        $AppProcess = $App.process

        try {
            Wait-ForMarker `
                -Url $App.markerUrl `
                -Nonce $Nonce `
                -Phase $Phase `
                -ExecutionMode $ExecutionMode `
                -ProductionAuthorization $ProductionAuthorization `
                -Database $TargetDatabase `
                -ToolHead $ExpectedToolHead `
                -CandidateSha256 $ExpectedCandidateSha256 `
                -SourceContainerId $ContainerId `
                -Process $AppProcess |
                Out-Null

            if ($Phase -eq 'apply') {
                $ApplyStarted = $true
                $Control.state = 'apply_started'
                $Control.applyStarted = $true
                Write-Json -Path $ControlPath -Value $Control
            }

            $env:RADAR_PUBLIC_METRICS_PRODUCTION_NONCE = $Nonce
            $env:RADAR_PUBLIC_METRICS_PRODUCTION_AUTHORIZATION =
                $ProductionAuthorization.ToString().ToLowerInvariant()

            node $ImporterPath `
                --release-dir $ReleaseDirectory `
                --url $App.baseUrl `
                --out-dir $PhaseDirectory `
                --mode $Phase `
                --execution-mode $ExecutionMode `
                --expected-tool-head $ExpectedToolHead `
                --expected-research-head $ExpectedResearchHead `
                --expected-database $TargetDatabase `
                --expected-candidate-sha256 $ExpectedCandidateSha256 `
                --expected-phase $Phase `
                --expected-source-container-id $ContainerId `
                --confirm 'RUN-RADAR-PUBLIC-METRICS-PRODUCTION-IMPORT-V01'

            if ($LASTEXITCODE -ne 0) {
                throw "Production importer phase 失败：$Phase"
            }
        }
        finally {
            Stop-ProcessTree -Process $AppProcess
            $AppProcess = $null
            $env:RADAR_PUBLIC_METRICS_PRODUCTION_NONCE = $null
            $env:RADAR_PUBLIC_METRICS_PRODUCTION_AUTHORIZATION = $null
            Start-Sleep -Seconds 2
        }

        $ReceiptPath =
            Join-Path $PhaseDirectory 'accepted-receipt.json'
        Assert-File -Path $ReceiptPath
        $Receipt =
            Get-Content -LiteralPath $ReceiptPath -Raw |
                ConvertFrom-Json -Depth 100

        Assert-Equal -Expected $ExecutionMode -Actual $Receipt.executionMode -Label "$Phase execution mode"
        Assert-Equal -Expected $Phase -Actual $Receipt.mode -Label "$Phase receipt mode"
        Assert-Equal -Expected $TargetDatabase -Actual $Receipt.database -Label "$Phase database"

        if ($Phase -eq 'plan') {
            Assert-Equal -Expected 10563 -Actual $Receipt.statusCounts.wouldUpdate -Label 'Plan wouldUpdate'
            Assert-Equal -Expected 0 -Actual $Receipt.statusCounts.blocked -Label 'Plan blocked'
            Assert-Equal -Expected 'False' -Actual $Receipt.databaseWrite -Label 'Plan database write'
            $Control.planPassed = $true
            $Control.state = 'plan_passed'
        }
        elseif ($Phase -eq 'apply') {
            Assert-Equal -Expected 10563 -Actual $Receipt.counts.metricPatch -Label 'Apply PATCH'
            Assert-Equal -Expected 0 -Actual $Receipt.counts.postCreate -Label 'Apply POST create'
            Assert-Equal -Expected 0 -Actual $Receipt.counts.put -Label 'Apply PUT'
            Assert-Equal -Expected 0 -Actual $Receipt.counts.delete -Label 'Apply DELETE'
            Assert-Equal -Expected 10563 -Actual $Receipt.postStatusCounts.alreadyCurrent -Label 'Apply alreadyCurrent'

            if ($ExecutionMode -eq 'production') {
                Assert-Equal `
                    -Expected 'True' `
                    -Actual $Receipt.operatorConfirmationRequired `
                    -Label 'Immediate operator confirmation required'

                $OperatorConfirmedAt =
                    [DateTimeOffset]::Parse(
                        [string]$Receipt.operatorConfirmedAt
                    ).ToUniversalTime()
                $ReceiptCompletedAt =
                    [DateTimeOffset]::Parse(
                        [string]$Receipt.completedAt
                    ).ToUniversalTime()

                if (
                    $OperatorConfirmedAt -gt $ReceiptCompletedAt -or
                    $OperatorConfirmedAt -gt
                        [DateTimeOffset]::UtcNow.AddMinutes(
                            $MaximumClockSkewMinutes
                        )
                ) {
                    throw 'Immediate operator confirmation timestamp 不合法'
                }

                $Control.operatorConfirmedAt =
                    $OperatorConfirmedAt.ToString('o')
            }
            else {
                Assert-Equal `
                    -Expected 'False' `
                    -Actual $Receipt.operatorConfirmationRequired `
                    -Label 'Rehearsal immediate confirmation'
                Assert-Equal `
                    -Expected $null `
                    -Actual $Receipt.operatorConfirmedAt `
                    -Label 'Rehearsal confirmation timestamp'
            }

            $ApplyCompleted = $true
            $Control.applyPassed = $true
            $Control.targetDatabaseWrite = $true
            $Control.sourceDatabaseWrite =
                ($ExecutionMode -eq 'production')
            $Control.state = 'apply_passed'
        }
        else {
            Assert-Equal -Expected 10563 -Actual $Receipt.statusCounts.alreadyCurrent -Label 'Verify alreadyCurrent'
            Assert-Equal -Expected 0 -Actual $Receipt.statusCounts.blocked -Label 'Verify blocked'
            Assert-Equal -Expected 'False' -Actual $Receipt.databaseWrite -Label 'Verify database write'
            $Control.verifyPassed = $true
            $Control.state = 'verify_passed'
        }

        Write-Json -Path $ControlPath -Value $Control
    }

    Write-Host "`n===== 5. 验证后态与受保护字段 =====" -ForegroundColor Cyan

    $After = Get-DatabaseState `
        -Container $TargetPostgresContainer `
        -Database $TargetDatabase `
        -DatabaseUser $TargetDatabaseUser
    Assert-FinalState -State $After -Label 'After'
    Assert-Equal `
        -Expected ($Before.businessFingerprints -join "`n") `
        -Actual ($After.businessFingerprints -join "`n") `
        -Label 'Protected business fingerprints'

    $Control.state = 'completed'
    $Control.completedAt = [DateTime]::UtcNow.ToString('o')
    Write-Json -Path $ControlPath -Value $Control
    $ControlSha256 = Get-Sha256 -Path $ControlPath

    Write-Json `
        -Path (Join-Path $RunDirectory 'accepted-apply-once-receipt.json') `
        -Value ([ordered]@{
            schemaVersion =
                'radar-public-metrics-production-apply-once-acceptance-v01'
            accepted = $true
            completedAt = [DateTime]::UtcNow.ToString('o')
            executionMode = $ExecutionMode
            toolHead = $ExpectedToolHead
            candidateSha256 = $ExpectedCandidateSha256
            authorizationSha256 = $ExpectedAuthorizationSha256
            database = $TargetDatabase
            targetContainerId = $ContainerId
            freshBackupPath = $FreshBackupPath
            freshBackupSha256 = $FreshBackupSha256
            freshBackupBytes = $FreshBackupBytes
            metricPatch = 10563
            finalAlreadyCurrent = 10563
            postCreate = 0
            put = 0
            delete = 0
            protectedBusinessFingerprintsUnchanged = $true
            applyControlPath = (Resolve-Path -LiteralPath $ControlPath).Path
            applyControlSha256 = $ControlSha256
            targetDatabaseWrite = $true
            sourceDatabaseWrite = ($ExecutionMode -eq 'production')
            productionAuthorization = ($ExecutionMode -eq 'production')
            automaticRetryAllowed = $false
            automaticRollbackExecuted = $false
            decision = $(
                if ($ExecutionMode -eq 'production') {
                    'accept_production_public_metrics_apply_once_v01'
                }
                else {
                    'accept_disposable_public_metrics_production_gate_rehearsal_v01'
                }
            )
        })

    if ($ExecutionMode -eq 'production' -and $WritersStopped) {
        Restart-RadarIncrementalWriters $WriterContext.Writers
        $WritersRestarted = $true
    }

    Write-Host 'Plan/apply/verify converged; protected fields unchanged' -ForegroundColor Green
}
catch {
    $OperationError = $_
}
finally {
    Stop-ProcessTree -Process $AppProcess
    Stop-ProcessTree -Process $AdvisoryProcess

    if ($AdvisoryContainerSql) {
        docker exec `
            $TargetPostgresContainer `
            rm -f $AdvisoryContainerSql `
            *> $null
    }

    if ($Credentials) {
        if ($Credentials.bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR(
                $Credentials.bstr
            )
        }
        $Credentials.password = $null
        $Credentials.securePassword = $null
    }
    $env:RADAR_PAYLOAD_PASSWORD = $null
    $env:RADAR_PUBLIC_METRICS_PRODUCTION_NONCE = $null
    $env:RADAR_PUBLIC_METRICS_PRODUCTION_AUTHORIZATION = $null

    if (
        $ExecutionMode -eq 'production' -and
        $WritersStopped -and
        -not $WritersRestarted -and
        -not $ApplyStarted
    ) {
        try {
            Restart-RadarIncrementalWriters $WriterContext.Writers
            $WritersRestarted = $true
        }
        catch {
        }
    }
}

if ($null -ne $OperationError) {
    $Failure = [ordered]@{
        schemaVersion =
            'radar-public-metrics-production-apply-once-failure-v01'
        accepted = $false
        failedAt = [DateTime]::UtcNow.ToString('o')
        executionMode = $ExecutionMode
        toolHead = $ExpectedToolHead
        candidateSha256 = $ExpectedCandidateSha256
        authorizationSha256 = $ExpectedAuthorizationSha256
        database = $TargetDatabase
        targetContainerId = $ContainerId
        applyStarted = $ApplyStarted
        applyCompleted = $ApplyCompleted
        targetDatabaseWriteMayHaveOccurred = $ApplyStarted
        sourceDatabaseWriteMayHaveOccurred =
            ($ExecutionMode -eq 'production' -and $ApplyStarted)
        productionAuthorization =
            ($ExecutionMode -eq 'production')
        writersRestarted = $WritersRestarted
        automaticRetryAllowed = $false
        automaticRollbackExecuted = $false
        operatorMustInspectBeforeAnyFurtherAction = $true
        operatorMustInspectBeforeWriterRestart =
            ($WritersStopped -and -not $WritersRestarted)
        message = $OperationError.Exception.Message
    }
    Write-Json `
        -Path (Join-Path $RunDirectory 'failed-apply-once-receipt.json') `
        -Value $Failure

    if (Test-Path -LiteralPath $ControlPath) {
        $Control.state = 'failed'
        $Control.failedAt = [DateTime]::UtcNow.ToString('o')
        $Control.failureReceipt =
            (Join-Path $RunDirectory 'failed-apply-once-receipt.json')
        Write-Json -Path $ControlPath -Value $Control
    }

    throw $OperationError
}

Write-Host ''
Write-Host '===== Public Metrics apply-once gate completed =====' `
    -ForegroundColor Green
Write-Host "Execution mode          : $ExecutionMode"
Write-Host "Tool HEAD               : $ExpectedToolHead"
Write-Host "Candidate SHA-256       : $ExpectedCandidateSha256"
Write-Host "Authorization SHA-256   : $ExpectedAuthorizationSha256"
Write-Host 'Metric PATCH            : 10563'
Write-Host 'Final alreadyCurrent    : 10563'
Write-Host 'POST create / PUT / DELETE: 0 / 0 / 0'
Write-Host "Production authorization: $($ExecutionMode -eq 'production')"
Write-Host "Run directory           : $RunDirectory"
Write-Host "Apply-control marker    : $ControlPath"
