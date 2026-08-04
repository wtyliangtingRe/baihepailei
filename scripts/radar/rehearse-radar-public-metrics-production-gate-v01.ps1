param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{40}$')]
    [string]$ExpectedToolHead,

    [Parameter(Mandatory = $true)]
    [string]$CandidatePath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ExpectedCandidateSha256,

    [Parameter(Mandatory = $true)]
    [ValidateSet('REHEARSE-RADAR-PUBLIC-METRICS-PRODUCTION-GATE-V01')]
    [string]$Confirm,

    [string]$ResearchRepo =
        'D:\0GitHubtest\baihepailei-research-data',

    [string]$SourcePostgresContainer =
        'baihepailei-postgres'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ExpectedBranch =
    'agent/radar-public-metrics-production-gate-v01'
$ExpectedBase =
    'cba94510c6ed460f821d82179e24d9a61ee28f5c'
$ExpectedResearchHead =
    'c2fe7847ee8b60b439f8e92025437937ceff06d5'
$ExpectedReleaseId =
    'RADAR-PUBLIC-METRICS-10563-0001'
$ExpectedManifestSha =
    'da4b52eae91224a8bab46aebff69734c6a3d2bc3005de415b027a9e4eba6226d'
$ExpectedMetricsSha =
    '1bdfda49f4f72a823efc86de42c565d3bdef162136aef697d0dc1d3bb343a946'
$ExpectedChecksumsSha =
    'b3a88c81b449f4636bb7ddfeca6c598998571d794032e761b2eced3bdde420b3'
$ExpectedSourceContainerId =
    '89eea3013fbfb18506eb1febef1c76b8d5b171d95737c59388ff6510e4402a1e'
$ExpectedSourceImage = 'postgres:17-alpine'
$SourceDatabase = 'baihepailei'
$DatabaseUser = 'baihe'
$ReleasePosixPath =
    'releases/public/radar-public-metrics-10563-0001/v01'
$RunnerPath =
    '.\scripts\radar\run-radar-public-metrics-production-apply-once-v01.ps1'
$OutputRoot =
    '.\data_local\outputs\radar-public-metrics-production-gate-v01'
$BackupRoot =
    '.\data_local\backups\radar-public-metrics-production-gate-v01'
$ReviewRoot =
    '.\data_local\review-packages\radar-public-metrics-production-gate-v01'

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

function Get-FreePort {
    param(
        [Parameter(Mandatory = $true)][int]$Minimum,
        [Parameter(Mandatory = $true)][int]$Maximum
    )

    foreach (
        $Port in
            Get-Random `
                -InputObject ($Minimum..$Maximum) `
                -Count ($Maximum - $Minimum + 1)
    ) {
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

function Wait-ForPostgres {
    param(
        [Parameter(Mandatory = $true)][string]$Container,
        [Parameter(Mandatory = $true)][string]$Database
    )

    for ($Attempt = 1; $Attempt -le 90; $Attempt += 1) {
        docker exec `
            $Container `
            pg_isready `
            -U $DatabaseUser `
            -d $Database `
            *> $null

        if ($LASTEXITCODE -eq 0) {
            return
        }

        Start-Sleep -Seconds 1
    }

    throw "临时 PostgreSQL 未就绪：$Container"
}

function Invoke-ReadOnlySql {
    param(
        [Parameter(Mandatory = $true)][string]$Container,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$Sql
    )

    $Output = @(
        docker exec `
            -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
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
只读 SQL 失败：$Container / $Database

$($Output -join "`n")
"@
    }

    return @(
        $Output |
            ForEach-Object { ([string]$_).TrimEnd() } |
            Where-Object { $_ -ne '' }
    )
}

function Get-State {
    param(
        [Parameter(Mandatory = $true)][string]$Container,
        [Parameter(Mandatory = $true)][string]$Database
    )

    $Summary = @(
        Invoke-ReadOnlySql `
            -Container $Container `
            -Database $Database `
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
  )
)::text;
"@
    )

    Assert-Equal -Expected 1 -Actual $Summary.Count -Label 'State summary rows'

    $Fingerprints = @(
        Invoke-ReadOnlySql `
            -Container $Container `
            -Database $Database `
            -Sql @"
SELECT 'works' || E'\t' || count(*)::text || E'\t' ||
  coalesce(md5(string_agg(md5(to_jsonb(w)::text), '' ORDER BY w.id)), md5(''))
FROM public.works AS w
UNION ALL
SELECT 'radar_public_records' || E'\t' || count(*)::text || E'\t' ||
  coalesce(md5(string_agg(md5(to_jsonb(r)::text), '' ORDER BY r.id)), md5(''))
FROM public.radar_public_records AS r
UNION ALL
SELECT 'radar_public_ratings_full' || E'\t' || count(*)::text || E'\t' ||
  coalesce(md5(string_agg(md5(to_jsonb(r)::text), '' ORDER BY r.id)), md5(''))
FROM public.radar_public_ratings AS r
ORDER BY 1;
"@
    )

    return [ordered]@{
        summary = $Summary[0] | ConvertFrom-Json -Depth 100
        fingerprints = $Fingerprints
    }
}

function Add-Checksums {
    param(
        [Parameter(Mandatory = $true)][string]$Directory
    )

    $Files = @(
        Get-ChildItem `
            -LiteralPath $Directory `
            -File `
            -Recurse |
            Where-Object { $_.Name -ne 'SHA256SUMS.txt' } |
            Sort-Object FullName
    )

    $Lines = foreach ($File in $Files) {
        $Relative =
            [System.IO.Path]::GetRelativePath(
                $Directory,
                $File.FullName
            ).Replace('\', '/')
        "$(Get-Sha256 -Path $File.FullName)  $Relative"
    }

    Write-Utf8 `
        -Path (Join-Path $Directory 'SHA256SUMS.txt') `
        -Content (($Lines -join "`n") + "`n")
}

$ExpectedToolHead = $ExpectedToolHead.ToLowerInvariant()
$ExpectedCandidateSha256 =
    $ExpectedCandidateSha256.ToLowerInvariant()

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $RepoRoot

$TempContainer = $null
$TempPort = $null
$ExportRoot = $null
$ReviewDirectory = $null
$RunDirectory = $null

try {
    Write-Host "`n===== 1. 锁定 PR #338 与源库只读前态 =====" `
        -ForegroundColor Cyan

    Assert-Equal `
        -Expected $ExpectedBranch `
        -Actual (git branch --show-current).Trim() `
        -Label 'Current branch'

    git fetch origin
    if ($LASTEXITCODE -ne 0) {
        throw 'git fetch origin 失败'
    }

    Assert-Equal `
        -Expected $ExpectedToolHead `
        -Actual (git rev-parse HEAD).Trim().ToLowerInvariant() `
        -Label 'Local tool HEAD'
    Assert-Equal `
        -Expected $ExpectedToolHead `
        -Actual (
            git rev-parse "origin/$ExpectedBranch"
        ).Trim().ToLowerInvariant() `
        -Label 'Remote tool HEAD'
    Assert-Equal `
        -Expected $ExpectedBase `
        -Actual (git rev-parse origin/main).Trim().ToLowerInvariant() `
        -Label 'origin/main'

    $Dirty = @(git status --porcelain=v1 --untracked-files=all)
    Assert-Equal -Expected 0 -Actual $Dirty.Count -Label 'Git dirty entries'

    foreach ($Path in @($CandidatePath, $RunnerPath)) {
        Assert-File -Path $Path
    }
    Assert-Equal `
        -Expected $ExpectedCandidateSha256 `
        -Actual (Get-Sha256 -Path $CandidatePath) `
        -Label 'Candidate SHA-256'

    docker version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker 当前不可用'
    }

    Assert-Equal `
        -Expected $ExpectedSourceContainerId `
        -Actual (
            docker inspect `
                --format '{{.Id}}' `
                $SourcePostgresContainer
        ).Trim().ToLowerInvariant() `
        -Label 'Source container ID'
    Assert-Equal `
        -Expected $ExpectedSourceImage `
        -Actual (
            docker inspect `
                --format '{{.Config.Image}}' `
                $SourcePostgresContainer
        ).Trim() `
        -Label 'Source image'

    $SourceBefore =
        Get-State `
            -Container $SourcePostgresContainer `
            -Database $SourceDatabase

    Assert-Equal -Expected 35615 -Actual $SourceBefore.summary.works -Label 'Source Works'
    Assert-Equal -Expected 10563 -Actual $SourceBefore.summary.publicRecords -Label 'Source Public Records'
    Assert-Equal -Expected 10563 -Actual $SourceBefore.summary.publicRatings -Label 'Source Public Ratings'
    Assert-Equal -Expected 44 -Actual $SourceBefore.summary.columns -Label 'Source columns'
    Assert-Equal -Expected 10 -Actual $SourceBefore.summary.migrations -Label 'Source migrations'
    Assert-Equal -Expected 0 -Actual $SourceBefore.summary.metricRows -Label 'Source metric rows'

    Write-Host 'Source database: exact and read-only' -ForegroundColor Green

    $RunId =
        "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0, 8))"

    New-Item `
        -ItemType Directory `
        -Path $OutputRoot, $BackupRoot, $ReviewRoot `
        -Force |
        Out-Null

    $ReviewDirectory =
        Join-Path $ReviewRoot "rehearsal-$RunId"
    New-Item `
        -ItemType Directory `
        -Path $ReviewDirectory `
        -Force |
        Out-Null

    Write-Json `
        -Path (Join-Path $ReviewDirectory 'source-before.json') `
        -Value $SourceBefore

    Write-Host "`n===== 2. 创建同窗口新鲜源库备份 =====" `
        -ForegroundColor Cyan

    $BackupPath =
        Join-Path `
            $BackupRoot `
            "source-immediately-before-production-gate-rehearsal-$RunId.dump"
    $ContainerBackup =
        "/tmp/radar-public-metrics-production-gate-$RunId.dump"

    docker exec `
        $SourcePostgresContainer `
        pg_dump `
        -U $DatabaseUser `
        -d $SourceDatabase `
        -Fc `
        -f $ContainerBackup

    if ($LASTEXITCODE -ne 0) {
        throw '源库 fresh pg_dump 失败'
    }

    docker cp `
        "${SourcePostgresContainer}:$ContainerBackup" `
        $BackupPath

    if ($LASTEXITCODE -ne 0) {
        throw '复制 fresh backup 失败'
    }

    docker exec `
        $SourcePostgresContainer `
        rm -f $ContainerBackup

    $BackupSha = Get-Sha256 -Path $BackupPath
    $BackupBytes =
        (Get-Item -LiteralPath $BackupPath).Length

    Write-Json `
        -Path (Join-Path $ReviewDirectory 'fresh-backup-binding.json') `
        -Value ([ordered]@{
            path = (Resolve-Path -LiteralPath $BackupPath).Path
            sha256 = $BackupSha
            bytes = $BackupBytes
            sourceContainerId = $ExpectedSourceContainerId
            sourceImage = $ExpectedSourceImage
            sourceDatabase = $SourceDatabase
            createdAt = [DateTime]::UtcNow.ToString('o')
            sourceDatabaseWrite = $false
        })

    Write-Host "Fresh backup: $BackupSha / $BackupBytes bytes" `
        -ForegroundColor Green

    Write-Host "`n===== 3. 导出冻结 Release 到短路径 =====" `
        -ForegroundColor Cyan

    git -C $ResearchRepo fetch origin
    if ($LASTEXITCODE -ne 0) {
        throw 'Research fetch 失败'
    }

    git -C $ResearchRepo cat-file -e "$ExpectedResearchHead^{commit}"
    if ($LASTEXITCODE -ne 0) {
        throw 'Research commit 不存在'
    }

    $ExportRoot =
        Join-Path `
            $RepoRoot `
            "data_local\temp\metrics-production-gate-release-$RunId"
    New-Item -ItemType Directory -Path $ExportRoot -Force | Out-Null
    $ExportZip = Join-Path $ExportRoot 'release.zip'

    git -C $ResearchRepo archive `
        --format=zip `
        "--output=$ExportZip" `
        $ExpectedResearchHead `
        $ReleasePosixPath

    if ($LASTEXITCODE -ne 0) {
        throw '冻结 Release archive 失败'
    }

    Expand-Archive `
        -LiteralPath $ExportZip `
        -DestinationPath $ExportRoot `
        -Force

    $ReleaseDirectory =
        Join-Path `
            $ExportRoot `
            $ReleasePosixPath.Replace('/', '\')

    foreach ($Name in @(
        'manifest.json',
        'metrics.jsonl',
        'review-flags.jsonl',
        'release-index.jsonl',
        'SHA256SUMS'
    )) {
        Assert-File -Path (Join-Path $ReleaseDirectory $Name)
    }

    Assert-Equal `
        -Expected $ExpectedManifestSha `
        -Actual (Get-Sha256 -Path (Join-Path $ReleaseDirectory 'manifest.json')) `
        -Label 'Release manifest SHA-256'
    Assert-Equal `
        -Expected $ExpectedMetricsSha `
        -Actual (Get-Sha256 -Path (Join-Path $ReleaseDirectory 'metrics.jsonl')) `
        -Label 'Release metrics SHA-256'
    Assert-Equal `
        -Expected $ExpectedChecksumsSha `
        -Actual (Get-Sha256 -Path (Join-Path $ReleaseDirectory 'SHA256SUMS')) `
        -Label 'Release SHA256SUMS SHA-256'

    Write-Json `
        -Path (Join-Path $ReviewDirectory 'release-binding.json') `
        -Value ([ordered]@{
            researchHead = $ExpectedResearchHead
            releaseId = $ExpectedReleaseId
            manifestSha256 =
                Get-Sha256 -Path (
                    Join-Path $ReleaseDirectory 'manifest.json'
                )
            metricsSha256 =
                Get-Sha256 -Path (
                    Join-Path $ReleaseDirectory 'metrics.jsonl'
                )
            checksumsSha256 =
                Get-Sha256 -Path (
                    Join-Path $ReleaseDirectory 'SHA256SUMS'
                )
        })

    Write-Host 'Frozen Release export: exact 5-file inventory' `
        -ForegroundColor Green

    Write-Host "`n===== 4. 恢复 fresh backup 到一次性 PostgreSQL =====" `
        -ForegroundColor Cyan

    $TempPort = Get-FreePort -Minimum 31000 -Maximum 31999
    $DatabaseSuffix =
        "$(Get-Date -Format 'yyMMddHHmmss')_$([guid]::NewGuid().ToString('N').Substring(0, 3))"
    $TempDatabase =
        "radar_public_metrics_production_gate_rehearsal_$DatabaseSuffix"

    if (
        [System.Text.Encoding]::UTF8.GetByteCount($TempDatabase) -gt 63
    ) {
        throw 'Disposable database identifier exceeds 63 UTF-8 bytes'
    }

    $TempContainer =
        "radar-metrics-production-gate-rehearsal-$RunId"

    docker run `
        -d `
        --name $TempContainer `
        -e "POSTGRES_USER=$DatabaseUser" `
        -e 'POSTGRES_DB=postgres' `
        -e 'POSTGRES_HOST_AUTH_METHOD=trust' `
        -p "127.0.0.1:${TempPort}:5432" `
        $ExpectedSourceImage |
        Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw '启动临时 PostgreSQL 失败'
    }

    Wait-ForPostgres `
        -Container $TempContainer `
        -Database 'postgres'

    docker exec `
        $TempContainer `
        createdb `
        -U $DatabaseUser `
        $TempDatabase

    if ($LASTEXITCODE -ne 0) {
        throw '创建临时数据库失败'
    }

    docker cp `
        $BackupPath `
        "${TempContainer}:/tmp/source.dump"

    if ($LASTEXITCODE -ne 0) {
        throw '复制 backup 到临时容器失败'
    }

    docker exec `
        $TempContainer `
        pg_restore `
        -U $DatabaseUser `
        -d $TempDatabase `
        --no-owner `
        --no-privileges `
        /tmp/source.dump

    if ($LASTEXITCODE -ne 0) {
        throw 'pg_restore 失败'
    }

    $TempBefore =
        Get-State `
            -Container $TempContainer `
            -Database $TempDatabase

    Assert-Equal `
        -Expected (
            $SourceBefore.summary |
                ConvertTo-Json -Compress
        ) `
        -Actual (
            $TempBefore.summary |
                ConvertTo-Json -Compress
        ) `
        -Label 'Source/restored summary'
    Assert-Equal `
        -Expected ($SourceBefore.fingerprints -join "`n") `
        -Actual ($TempBefore.fingerprints -join "`n") `
        -Label 'Source/restored fingerprints'

    Write-Json `
        -Path (Join-Path $ReviewDirectory 'temp-before.json') `
        -Value $TempBefore

    Write-Host 'Disposable restore: exact 44 / 10 and metrics empty' `
        -ForegroundColor Green

    Write-Host "`n===== 5. 生成 rehearsal-only authorization =====" `
        -ForegroundColor Cyan

    $AuthorizationPath =
        Join-Path `
            $ReviewDirectory `
            'rehearsal-authorization.json'

    $Authorization = [ordered]@{
        schemaVersion =
            'radar-public-metrics-production-gate-rehearsal-authorization-v01'
        authorized = $false
        executionMode = 'rehearsal'
        createdAt = [DateTime]::UtcNow.ToString('o')
        toolHead = $ExpectedToolHead
        candidateSha256 = $ExpectedCandidateSha256
        releaseId = $ExpectedReleaseId
        database = $TempDatabase
        targetContainer = $TempContainer
        freshBackup = [ordered]@{
            path = (Resolve-Path -LiteralPath $BackupPath).Path
            sha256 = $BackupSha
            bytes = $BackupBytes
        }
        productionAuthorization = $false
        automaticRetryAllowed = $false
        automaticRollbackAllowed = $false
        decision =
            'allow_disposable_production_gate_rehearsal_only'
    }
    Write-Json -Path $AuthorizationPath -Value $Authorization
    $AuthorizationSha =
        Get-Sha256 -Path $AuthorizationPath

    Write-Host "Rehearsal authorization SHA-256: $AuthorizationSha" `
        -ForegroundColor Green

    Write-Host "`n===== 6. 运行真实 production gate 的 rehearsal 模式 =====" `
        -ForegroundColor Cyan

    $DatabaseUrl =
        "postgresql://${DatabaseUser}@127.0.0.1:${TempPort}/${TempDatabase}"

    & pwsh `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $RunnerPath `
        -ExecutionMode rehearsal `
        -ExpectedToolHead $ExpectedToolHead `
        -CandidatePath $CandidatePath `
        -ExpectedCandidateSha256 $ExpectedCandidateSha256 `
        -AuthorizationPath $AuthorizationPath `
        -ExpectedAuthorizationSha256 $AuthorizationSha `
        -ReleaseDirectory $ReleaseDirectory `
        -TargetPostgresContainer $TempContainer `
        -TargetDatabase $TempDatabase `
        -TargetDatabaseUser $DatabaseUser `
        -DatabaseUrl $DatabaseUrl `
        -Confirm 'REHEARSE-RADAR-PUBLIC-METRICS-PRODUCTION-GATE-V01'

    if ($LASTEXITCODE -ne 0) {
        throw "production gate rehearsal 失败：$LASTEXITCODE"
    }

    $RunDirectory =
        Get-ChildItem `
            -LiteralPath $OutputRoot `
            -Directory `
            -Filter 'apply-once-rehearsal-*' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $RunDirectory) {
        throw '找不到 production gate rehearsal 输出目录'
    }

    $AcceptancePath =
        Join-Path `
            $RunDirectory.FullName `
            'accepted-apply-once-receipt.json'
    Assert-File -Path $AcceptancePath

    $Acceptance =
        Get-Content -LiteralPath $AcceptancePath -Raw |
            ConvertFrom-Json -Depth 100

    Assert-Equal -Expected 'True' -Actual $Acceptance.accepted -Label 'Gate acceptance'
    Assert-Equal -Expected 'rehearsal' -Actual $Acceptance.executionMode -Label 'Gate execution mode'
    Assert-Equal -Expected 10563 -Actual $Acceptance.metricPatch -Label 'Gate PATCH'
    Assert-Equal -Expected 10563 -Actual $Acceptance.finalAlreadyCurrent -Label 'Gate alreadyCurrent'
    Assert-Equal -Expected 0 -Actual $Acceptance.postCreate -Label 'Gate POST create'
    Assert-Equal -Expected 0 -Actual $Acceptance.put -Label 'Gate PUT'
    Assert-Equal -Expected 0 -Actual $Acceptance.delete -Label 'Gate DELETE'
    Assert-Equal -Expected 'False' -Actual $Acceptance.productionAuthorization -Label 'Gate production authorization'
    Assert-Equal -Expected 'True' -Actual $Acceptance.targetDatabaseWrite -Label 'Gate target database write'
    Assert-Equal -Expected 'False' -Actual $Acceptance.sourceDatabaseWrite -Label 'Gate source database write'

    $ApplyControlPath = [string]$Acceptance.applyControlPath
    $ApplyControlSha256 =
        ([string]$Acceptance.applyControlSha256).ToLowerInvariant()
    Assert-File -Path $ApplyControlPath
    Assert-Equal `
        -Expected $ApplyControlSha256 `
        -Actual (Get-Sha256 -Path $ApplyControlPath) `
        -Label 'Apply-control SHA-256'

    $ApplyControl =
        Get-Content -LiteralPath $ApplyControlPath -Raw |
            ConvertFrom-Json -Depth 100

    Assert-Equal -Expected 'completed' -Actual $ApplyControl.state -Label 'Apply-control state'
    Assert-Equal -Expected 'True' -Actual $ApplyControl.planPassed -Label 'Apply-control plan'
    Assert-Equal -Expected 'True' -Actual $ApplyControl.applyStarted -Label 'Apply-control apply started'
    Assert-Equal -Expected 'True' -Actual $ApplyControl.applyPassed -Label 'Apply-control apply'
    Assert-Equal -Expected 'True' -Actual $ApplyControl.verifyPassed -Label 'Apply-control verify'
    Assert-Equal -Expected 'True' -Actual $ApplyControl.targetDatabaseWrite -Label 'Apply-control target write'
    Assert-Equal -Expected 'False' -Actual $ApplyControl.sourceDatabaseWrite -Label 'Apply-control source write'
    Assert-Equal -Expected 'False' -Actual $ApplyControl.productionAuthorization -Label 'Apply-control production authorization'

    Write-Host 'Disposable production gate converged' `
        -ForegroundColor Green

    Write-Host "`n===== 7. 证明源库未变化并生成 evidence ZIP =====" `
        -ForegroundColor Cyan

    $SourceAfter =
        Get-State `
            -Container $SourcePostgresContainer `
            -Database $SourceDatabase

    Assert-Equal `
        -Expected (
            $SourceBefore |
                ConvertTo-Json -Compress -Depth 100
        ) `
        -Actual (
            $SourceAfter |
                ConvertTo-Json -Compress -Depth 100
        ) `
        -Label 'Source before/after'

    Write-Json `
        -Path (Join-Path $ReviewDirectory 'source-after.json') `
        -Value $SourceAfter

    Copy-Item `
        -LiteralPath $AcceptancePath `
        -Destination (
            Join-Path `
                $ReviewDirectory `
                'accepted-apply-once-receipt.json'
        )

    Copy-Item `
        -LiteralPath $AuthorizationPath `
        -Destination (
            Join-Path `
                $ReviewDirectory `
                'rehearsal-authorization-copy.json'
        )

    Copy-Item `
        -LiteralPath $CandidatePath `
        -Destination (
            Join-Path `
                $ReviewDirectory `
                'post-merge-production-preflight-candidate.json'
        )

    Copy-Item `
        -LiteralPath $ApplyControlPath `
        -Destination (
            Join-Path `
                $ReviewDirectory `
                'apply-control-marker.json'
        )

    $RunnerEvidence =
        Join-Path $ReviewDirectory 'runner-evidence'
    Copy-Item `
        -LiteralPath $RunDirectory.FullName `
        -Destination $RunnerEvidence `
        -Recurse

    Write-Json `
        -Path (Join-Path $ReviewDirectory 'rehearsal-summary.json') `
        -Value ([ordered]@{
            schemaVersion =
                'radar-public-metrics-production-gate-rehearsal-summary-v01'
            accepted = $true
            completedAt = [DateTime]::UtcNow.ToString('o')
            toolHead = $ExpectedToolHead
            candidateSha256 = $ExpectedCandidateSha256
            researchHead = $ExpectedResearchHead
            releaseId = $ExpectedReleaseId
            freshBackupSha256 = $BackupSha
            freshBackupBytes = $BackupBytes
            disposableDatabase = $TempDatabase
            metricPatch = 10563
            finalAlreadyCurrent = 10563
            postCreate = 0
            put = 0
            delete = 0
            sourceDatabaseUnchanged = $true
            targetDatabaseWrite = $true
            sourceDatabaseWrite = $false
            applyControlSha256 = $ApplyControlSha256
            applyControlState = 'completed'
            productionAuthorization = $false
            automaticRetryAllowed = $false
            automaticRollbackExecuted = $false
            decision =
                'accept_disposable_public_metrics_production_gate_rehearsal_v01'
        })

    Add-Checksums -Directory $ReviewDirectory

    $ReviewZip =
        Join-Path `
            $HOME `
            "Downloads\public-metrics-production-gate-$RunId-evidence-v01.zip"

    if (Test-Path -LiteralPath $ReviewZip) {
        Remove-Item -LiteralPath $ReviewZip -Force
    }

    Compress-Archive `
        -Path (Join-Path $ReviewDirectory '*') `
        -DestinationPath $ReviewZip `
        -CompressionLevel Optimal

    $ReviewZipSha = Get-Sha256 -Path $ReviewZip
    $ReviewZipBytes =
        (Get-Item -LiteralPath $ReviewZip).Length

    Write-Host ''
    Write-Host '===== Public Metrics production gate rehearsal 完成 =====' `
        -ForegroundColor Green
    Write-Host "Evidence ZIP:"
    Write-Host $ReviewZip
    Write-Host "`nEvidence ZIP SHA-256:"
    Write-Host $ReviewZipSha
    Write-Host "`nEvidence ZIP bytes:"
    Write-Host $ReviewZipBytes
    Write-Host "`nMetric PATCH：10,563。"
    Write-Host "Final alreadyCurrent：10,563。"
    Write-Host "POST create / PUT / DELETE：0 / 0 / 0。"
    Write-Host "源数据库写入：未执行。"
    Write-Host "生产授权：未创建。"
    Write-Host "禁止自动重跑；失败时必须独立检查。"
}
finally {
    if ($TempContainer) {
        docker rm -f $TempContainer *> $null
    }

    if ($ExportRoot -and (Test-Path -LiteralPath $ExportRoot)) {
        Remove-Item `
            -LiteralPath $ExportRoot `
            -Recurse `
            -Force `
            -ErrorAction SilentlyContinue
    }
}
