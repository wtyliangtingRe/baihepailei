param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AssemblyBundle,
  [Parameter(Mandatory = $true)]
  [ValidateSet('RUN-ISOLATED-RADAR-UNIFIED-1804-INCREMENTAL-STORAGE-LAB-V01')]
  [string]$Confirm,
  [Parameter(Mandatory = $true)][string]$ExpectedAssemblySHA256,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$ExpectedRows = 1804
$ExpectedBaselineRows = 9000
$ExpectedFinalRows = 10804
$AllowedDirtyFiles = @(
  'next-env.d.ts',
  'payload-types.ts',
  'docs/guides/README.md',
  'docs/guides/radar-ai-incremental-publication-runbook-v01.md',
  'docs/guides/radar-publication-safety-v01.md',
  'docs/guides/work-assessment-model-v01.md',
  'docs/guides/radar-dual-track-ai-coverage-policy-v01.md',
  'docs/guides/radar-remaining-1122-phase2-live-guard-closeout-v01.md',
  'docs/guides/radar-work-level-multilingual-research-policy-v01.md',
  'scripts/radar/apply-radar-dual-track-ai-coverage-policy-v01.mjs',
  'scripts/radar/build-radar-remaining-closeout-phase2-v01.mjs',
  'scripts/radar/run-and-package-radar-remaining-closeout-phase2-v01.ps1',
  'tests/radar-dual-track-ai-coverage-policy.test.mjs',
  'tests/radar-remaining-closeout-phase2.test.mjs',
  'docs/guides/radar-unified-1804-incremental-assembly-and-lab-v01.md',
  'scripts/radar/build-radar-unified-incremental-assembly-v01.mjs',
  'scripts/radar/run-and-package-radar-unified-incremental-assembly-v01.ps1',
  'scripts/radar/build-radar-unified-incremental-storage-lab-v01.mjs',
  'scripts/radar/run-and-package-radar-unified-incremental-storage-lab-v01.ps1',
  'scripts/radar/run-and-package-radar-unified-incremental-assembly-and-lab-v01.ps1',
  'tests/radar-unified-incremental-assembly-and-lab.test.mjs'
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Value
  )
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-DirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path.Replace('\', '/')
  }
  return @($paths)
}

function Assert-Manifest {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
  $expected = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
  )
  foreach ($entry in @($manifest)) {
    $relative = ([string]$entry.file).Replace('\', '/')
    $file = Join-Path $Directory ($relative.Replace(
      '/',
      [System.IO.Path]::DirectorySeparatorChar
    ))
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "manifest 文件不存在：$relative"
    }
    $item = Get-Item -LiteralPath $file
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if (
      $item.Length -ne [long]$entry.bytes -or
      $hash.Hash.ToLowerInvariant() -ne
        ([string]$entry.sha256).ToLowerInvariant()
    ) {
      throw "manifest 校验失败：$relative"
    }
    $null = $expected.Add($relative)
  }
  $actual = @(
    Get-ChildItem -LiteralPath $Directory -Recurse -File |
      Where-Object {
        -not (
          $_.Name -eq 'manifest.json' -and
          $_.DirectoryName -eq $Directory
        )
      } |
      ForEach-Object {
        [System.IO.Path]::GetRelativePath(
          $Directory,
          $_.FullName
        ).Replace('\', '/')
      }
  )
  if ($actual.Count -ne $expected.Count) {
    throw "manifest 覆盖数量不一致：actual=$($actual.Count) expected=$($expected.Count)"
  }
  foreach ($relative in $actual) {
    if (-not $expected.Contains($relative)) {
      throw "发现 manifest 未登记文件：$relative"
    }
  }
}

function Write-DirectoryManifest {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $manifestPath = Join-Path $Directory 'manifest.json'
  Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
  $manifest = @(
    Get-ChildItem -LiteralPath $Directory -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        $relative = [System.IO.Path]::GetRelativePath(
          $Directory,
          $_.FullName
        ).Replace('\', '/')
        $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
        [ordered]@{
          file = $relative
          bytes = $_.Length
          sha256 = $hash.Hash.ToLowerInvariant()
        }
      }
  )
  Write-JsonFile -Path $manifestPath -Value $manifest
  Assert-Manifest -Directory $Directory
}

function Invoke-DockerPsqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Password,
    [Parameter(Mandatory = $true)][string]$ContainerSqlPath,
    [Parameter(Mandatory = $true)][string]$Prefix,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [bool]$ReadOnly = $false
  )

  $stdoutPath = Join-Path $OutputDirectory "$Prefix-stdout.txt"
  $stderrPath = Join-Path $OutputDirectory "$Prefix-stderr.txt"
  $options = '-c TimeZone=UTC -c client_min_messages=warning'
  if ($ReadOnly) {
    $options += ' -c default_transaction_read_only=on'
  }
  $arguments = @(
    'exec',
    '-e', "PGPASSWORD=$Password",
    '-e', "PGOPTIONS=$options",
    $Container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', $User, '-d', $Database,
    '-f', $ContainerSqlPath
  )
  & docker @arguments 1> $stdoutPath 2> $stderrPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "==> $Prefix stderr" -ForegroundColor Yellow
    if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
      Get-Content -LiteralPath $stderrPath -Encoding UTF8 |
        Select-Object -Last 160 |
        ForEach-Object { Write-Host $_ }
    }
    throw "$Prefix 执行失败。"
  }
  return $stdoutPath
}

function Assert-Checks {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $checks = @()
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -ne 4) {
      throw "$Label 无法解析检查行：$line"
    }
    $checks += [pscustomobject]@{
      name = $parts[0]
      actual = $parts[1]
      expected = $parts[2]
      matched = $parts[3].ToLowerInvariant() -eq 'true'
    }
  }
  $failed = @($checks | Where-Object { -not $_.matched })
  if ($checks.Count -eq 0 -or $failed.Count -gt 0) {
    $failed | Format-Table | Out-String | Write-Host
    throw "$Label 未全部通过。"
  }
  return @($checks)
}

function Write-TableCountSql {
  param([Parameter(Mandatory = $true)][string]$Path)

  $sql = @'
\pset tuples_only on
\pset format unaligned
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT format(
  'SELECT %L || E''\t'' || count(*)::text FROM %I.%I;',
  schemaname || '.' || tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
COMMIT;
'@
  [System.IO.File]::WriteAllText(
    $Path,
    $sql.TrimStart(),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Read-CountMap {
  param([Parameter(Mandatory = $true)][string]$Path)

  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -ne 2) { throw "无法解析表行数：$line" }
    if ($map.ContainsKey($parts[0])) { throw "表行数重复：$($parts[0])" }
    $map[$parts[0]] = [long]$parts[1]
  }
  return $map
}

function Filter-NonRadarCountMap {
  param([Parameter(Mandatory = $true)][hashtable]$Map)

  $filtered = @{}
  foreach ($key in $Map.Keys) {
    if (-not ([string]$key).StartsWith('public.radar_public')) {
      $filtered[$key] = [long]$Map[$key]
    }
  }
  return $filtered
}

function Compare-CountMaps {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Expected,
    [Parameter(Mandatory = $true)][hashtable]$Actual,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  if (($expectedKeys -join "`n") -ne ($actualKeys -join "`n")) {
    throw "$Label 表集合不一致。"
  }
  foreach ($key in $expectedKeys) {
    if ([long]$Expected[$key] -ne [long]$Actual[$key]) {
      throw "$Label 表行数不一致：$key expected=$($Expected[$key]) actual=$($Actual[$key])"
    }
  }
}

function Assert-FilesEqual {
  param(
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Actual,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $expectedHash = (Get-FileHash -LiteralPath $Expected -Algorithm SHA256).Hash
  $actualHash = (Get-FileHash -LiteralPath $Actual -Algorithm SHA256).Hash
  if ($expectedHash -ne $actualHash) {
    Write-Host "ExpectedHash: $expectedHash" -ForegroundColor Yellow
    Write-Host "ActualHash  : $actualHash" -ForegroundColor Yellow
    throw "$Label 不一致。"
  }
}

function Write-SequenceRestoreSql {
  param(
    [Parameter(Mandatory = $true)][string]$StatePath,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )

  $allowed = @(
    'radar_public_id_seq',
    'radar_public_review_reasons_id_seq'
  )
  $statements = @(
    '\set ON_ERROR_STOP on',
    'BEGIN ISOLATION LEVEL SERIALIZABLE;'
  )
  $seen = @{}
  foreach ($line in Get-Content -LiteralPath $StatePath -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -ne 3) { throw "无法解析 sequence 状态：$line" }
    $name = $parts[0]
    if ($allowed -notcontains $name -or $seen.ContainsKey($name)) {
      throw "sequence 状态包含异常名称：$name"
    }
    if ($parts[1] -notmatch '^\d+$') { throw "sequence 值无效：$line" }
    if ($parts[2] -notin @('true', 'false', 't', 'f')) {
      throw "sequence is_called 无效：$line"
    }
    $called = if ($parts[2] -in @('true', 't')) { 'true' } else { 'false' }
    $statements += "SELECT setval('public.$name', $($parts[1]), $called);"
    $seen[$name] = $true
  }
  if ($seen.Count -ne $allowed.Count) {
    throw "sequence 状态行数异常：$($seen.Count)"
  }
  $statements += 'COMMIT;'
  [System.IO.File]::WriteAllText(
    $OutputPath,
    (($statements -join [Environment]::NewLine) + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

if ($Confirm -ne 'RUN-ISOLATED-RADAR-UNIFIED-1804-INCREMENTAL-STORAGE-LAB-V01') {
  throw '隔离演练确认字符串不匹配。'
}
if (-not (Test-Path -LiteralPath $AssemblyBundle -PathType Leaf)) {
  throw "找不到 assembly ZIP：$AssemblyBundle"
}
$assemblyPath = (Resolve-Path -LiteralPath $AssemblyBundle).Path
$assemblyHash = (Get-FileHash -LiteralPath $assemblyPath -Algorithm SHA256).Hash
if ($assemblyHash -ne $ExpectedAssemblySHA256) {
  throw "Assembly ZIP SHA-256 不匹配：$assemblyHash"
}

$unexpectedDirty = @(
  Get-DirtyPaths |
    Where-Object { $AllowedDirtyFiles -notcontains $_ }
)
if ($unexpectedDirty.Count -gt 0) {
  $unexpectedDirty | ForEach-Object {
    Write-Host "unexpected dirty: $_" -ForegroundColor Yellow
  }
  throw '存在预期之外的本地修改；未开始隔离演练。'
}

Write-Host ''
Write-Host '==> 锁定 PR #311 分支与提交' -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端更新失败。' }
git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '切换公共 Radar 分支失败。' }
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新公共 Radar 分支失败。' }
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $ExpectedBranchHead -or $remoteHead -ne $ExpectedBranchHead) {
  throw "隔离演练提交不符合预期：local=$localHead remote=$remoteHead"
}

Write-Host ''
Write-Host '==> 运行增量 storage lab 语法与回归测试' -ForegroundColor Cyan
node --check '.\scripts\radar\build-radar-unified-incremental-storage-lab-v01.mjs'
if ($LASTEXITCODE -ne 0) { throw '增量 lab SQL builder 语法检查失败。' }
node --test `
  '.\tests\radar-unified-incremental-assembly-and-lab.test.mjs' `
  '.\tests\radar-public-storage-normalization.test.mjs'
if ($LASTEXITCODE -ne 0) { throw '增量 storage lab 回归测试失败。' }

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$sourceRunning = ([string](& docker inspect -f '{{.State.Running}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRunning -ne 'true') {
  throw "源 PostgreSQL 容器未运行：$SourcePostgresContainer"
}
$postgresImage = ([string](& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresImage)) {
  throw '无法读取 PostgreSQL 镜像。'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-unified-1804-incremental-storage-lab-$stamp"
$evidenceDir = Join-Path $repoRoot "exports\radar-unified-1804-incremental-storage-lab-evidence-$stamp"
$evidenceBundle = Join-Path $repoRoot "exports\RADAR-UNIFIED-1804-INCREMENTAL-STORAGE-LAB-EVIDENCE-$stamp.zip"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  "radar-unified-1804-incremental-storage-lab-$stamp-" +
  [Guid]::NewGuid().ToString('N')
)
$assemblyDir = Join-Path $tempRoot 'assembly'
$sqlDir = Join-Path $outDir 'lab-sql'
New-Item -ItemType Directory -Path $assemblyDir, $sqlDir, $outDir -Force | Out-Null

Expand-Archive -LiteralPath $assemblyPath -DestinationPath $assemblyDir -Force
Assert-Manifest -Directory $assemblyDir
$readyPath = Join-Path $assemblyDir 'public-ai-storage-ready.jsonl'
$assemblySummaryPath = Join-Path $assemblyDir 'radar-unified-incremental-assembly-summary.json'
$assemblySummary = Get-Content -LiteralPath $assemblySummaryPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
$readyHash = (Get-FileHash -LiteralPath $readyPath -Algorithm SHA256).Hash
if (
  $assemblySummary.rows -ne $ExpectedRows -or
  $assemblySummary.storageNormalized -ne $ExpectedRows -or
  $assemblySummary.readyForStorageLabPlanning -ne $true -or
  ([string]$assemblySummary.readyFileSha256).ToUpperInvariant() -ne $readyHash
) {
  throw '统一 assembly storage-ready JSONL 绑定或门槛不匹配。'
}

node '.\scripts\radar\build-radar-unified-incremental-storage-lab-v01.mjs' `
  --assembly-dir $assemblyDir `
  --assembly-zip-sha256 $assemblyHash `
  --out-dir $sqlDir
if ($LASTEXITCODE -ne 0) { throw '增量 storage lab SQL 构建失败。' }

$planSummaryPath = Join-Path $sqlDir 'radar-unified-incremental-storage-lab-plan-summary.json'
$planSummary = Get-Content -LiteralPath $planSummaryPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
if (
  $planSummary.inputRows -ne $ExpectedRows -or
  $planSummary.baselineRows -ne $ExpectedBaselineRows -or
  $planSummary.finalRows -ne $ExpectedFinalRows -or
  $planSummary.productionApplyAuthorized -ne $false
) {
  throw '统一增量 lab plan summary 不符合固定门槛。'
}

$backupPath = Join-Path $outDir 'database-backup.dump'
$tableCountSqlPath = Join-Path $outDir 'all-public-table-counts.sql'
Write-TableCountSql -Path $tableCountSqlPath

$sourcePrefix = "/tmp/radar-unified-1804-incremental-storage-lab-$stamp"
$sourceDumpPath = "$sourcePrefix.dump"
$sourcePreflightPath = "$sourcePrefix-preflight.sql"
$sourceFingerprintPath = "$sourcePrefix-fingerprint.sql"
$sourceSequencePath = "$sourcePrefix-sequence.sql"
$sourceCountsPath = "$sourcePrefix-counts.sql"

$labContainer = "baihepailei-radar-unified-1804-incremental-lab-$stamp"
$labUser = 'radar_lab'
$labDatabase = 'radar_lab'
$labPassword = [Guid]::NewGuid().ToString('N')
$containerDumpPath = '/tmp/database-backup.dump'
$containerReadyPath = '/tmp/radar-unified-incremental-storage-ready.jsonl'
$containerPreflightPath = '/tmp/production-readonly-preflight.sql'
$containerApplyPath = '/tmp/incremental-apply.sql.lab-only'
$containerAcceptancePath = '/tmp/incremental-acceptance.sql'
$containerRollbackPath = '/tmp/incremental-rollback.sql.lab-only'
$containerPostRollbackPath = '/tmp/incremental-post-rollback-acceptance.sql'
$containerBaselineFingerprintPath = '/tmp/baseline-only-fingerprint.sql'
$containerFullFingerprintPath = '/tmp/full-radar-fingerprint.sql'
$containerSequencePath = '/tmp/radar-sequence-state.sql'
$containerSequenceRestorePath = '/tmp/radar-sequence-restore.sql.lab-only'
$containerCountsPath = '/tmp/all-public-table-counts.sql'

$stageStatusPath = Join-Path $outDir 'lab-stage-status.json'
$stageStatus = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  productionReadOnlyPreflightPassed = $false
  productionDatabaseWrite = $false
  freshBackupCreated = $false
  isolatedRestorePassed = $false
  incrementalRowsApplied = 0
  postApplyAcceptancePassed = $false
  original9000Unchanged = $false
  nonRadarTablesUnchanged = $false
  rollbackPassed = $false
  sequencesRestored = $false
  baselineRestored = $false
  productionFinalReadOnlyCheckPassed = $false
  sourceContainerTempFilesRemoved = $false
  labContainerRemoved = $false
  evidencePackageCompleted = $false
  productionApplyAuthorized = $false
}
Write-JsonFile -Path $stageStatusPath -Value $stageStatus

$labContainerCreated = $false
$labContainerRemoved = $false
$sourceTempRemoved = $false
$evidenceCompleted = $false

try {
  Write-Host ''
  Write-Host '==> 生产库只读 preflight、指纹与表计数' -ForegroundColor Cyan
  foreach ($copy in @(
    @((Join-Path $sqlDir 'production-readonly-preflight.sql'), $sourcePreflightPath),
    @((Join-Path $sqlDir 'full-radar-fingerprint.sql'), $sourceFingerprintPath),
    @((Join-Path $sqlDir 'radar-sequence-state.sql'), $sourceSequencePath),
    @($tableCountSqlPath, $sourceCountsPath)
  )) {
    docker cp $copy[0] "${SourcePostgresContainer}:$($copy[1])" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "复制只读 SQL 到源容器失败：$($copy[0])" }
  }

  $productionPreflightBefore = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourcePreflightPath `
    -Prefix 'production-pre-backup-preflight' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $productionPreflightChecks = Assert-Checks `
    -Path $productionPreflightBefore `
    -Label 'production pre-backup preflight'

  $productionFingerprintBefore = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceFingerprintPath `
    -Prefix 'production-pre-backup-fingerprint' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $productionSequenceBefore = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceSequencePath `
    -Prefix 'production-pre-backup-sequence' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $productionCountsBeforePath = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceCountsPath `
    -Prefix 'production-pre-backup-table-counts' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $stageStatus.productionReadOnlyPreflightPassed = $true
  Write-JsonFile -Path $stageStatusPath -Value $stageStatus

  Write-Host ''
  Write-Host '==> 创建同窗口 fresh production backup' -ForegroundColor Cyan
  & docker exec $SourcePostgresContainer pg_dump `
    -U $SourceDatabaseUser `
    -d $SourceDatabase `
    --format=custom `
    --compress=6 `
    --serializable-deferrable `
    --no-owner `
    --no-privileges `
    --file=$sourceDumpPath
  if ($LASTEXITCODE -ne 0) { throw '生产数据库 fresh pg_dump 失败。' }
  docker cp "${SourcePostgresContainer}:$sourceDumpPath" $backupPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 fresh backup 到宿主机失败。' }
  $backupHash = Get-FileHash -LiteralPath $backupPath -Algorithm SHA256
  $backupBytes = (Get-Item -LiteralPath $backupPath).Length
  if ($backupBytes -le 0) { throw 'fresh backup 为空。' }

  $backupDirectory = Split-Path -Parent $backupPath
  $backupFileName = Split-Path -Leaf $backupPath
  $backupMount = "${backupDirectory}:/backup:ro"
  & docker run --rm --network none `
    -v $backupMount `
    $postgresImage `
    pg_restore --list "/backup/$backupFileName" `
    1> (Join-Path $outDir 'backup-archive-list.txt') `
    2> (Join-Path $outDir 'backup-archive-list-stderr.txt')
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore --list 校验 fresh backup 失败。' }

  $productionPreflightAfter = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourcePreflightPath `
    -Prefix 'production-post-backup-preflight' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $null = Assert-Checks `
    -Path $productionPreflightAfter `
    -Label 'production post-backup preflight'
  $productionFingerprintAfter = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceFingerprintPath `
    -Prefix 'production-post-backup-fingerprint' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $productionSequenceAfter = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceSequencePath `
    -Prefix 'production-post-backup-sequence' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $productionCountsAfterPath = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceCountsPath `
    -Prefix 'production-post-backup-table-counts' `
    -OutputDirectory $outDir `
    -ReadOnly $true

  Assert-FilesEqual $productionFingerprintBefore $productionFingerprintAfter 'backup 前后生产 Radar 指纹'
  Assert-FilesEqual $productionSequenceBefore $productionSequenceAfter 'backup 前后生产 Radar sequence'
  $productionCountsBefore = Read-CountMap $productionCountsBeforePath
  $productionCountsAfter = Read-CountMap $productionCountsAfterPath
  Compare-CountMaps $productionCountsBefore $productionCountsAfter 'backup 前后生产表计数'
  $stageStatus.freshBackupCreated = $true
  Write-JsonFile -Path $stageStatusPath -Value $stageStatus

  Write-Host ''
  Write-Host '==> 启动 --network none 隔离 PostgreSQL 并完整恢复' -ForegroundColor Cyan
  & docker run -d --name $labContainer --network none `
    -e "POSTGRES_USER=$labUser" `
    -e "POSTGRES_PASSWORD=$labPassword" `
    -e 'POSTGRES_DB=postgres' `
    $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '隔离 PostgreSQL 容器启动失败。' }
  $labContainerCreated = $true

  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  $ready = $false
  do {
    Start-Sleep -Seconds 2
    & docker exec -e "PGPASSWORD=$labPassword" $labContainer `
      pg_isready -U $labUser -d postgres | Out-Null
    $ready = $LASTEXITCODE -eq 0
  } while (-not $ready -and (Get-Date) -lt $deadline)
  if (-not $ready) { throw '隔离 PostgreSQL 未在时限内就绪。' }

  & docker exec -e "PGPASSWORD=$labPassword" $labContainer `
    createdb -U $labUser -T template0 $labDatabase
  if ($LASTEXITCODE -ne 0) { throw '创建隔离数据库失败。' }
  docker cp $backupPath "${labContainer}:$containerDumpPath" | Out-Null
  docker cp $tableCountSqlPath "${labContainer}:$containerCountsPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制恢复输入到隔离容器失败。' }
  & docker exec -e "PGPASSWORD=$labPassword" $labContainer pg_restore `
    -U $labUser `
    -d $labDatabase `
    --no-owner `
    --no-privileges `
    --exit-on-error `
    $containerDumpPath
  if ($LASTEXITCODE -ne 0) { throw 'fresh backup 在隔离数据库恢复失败。' }

  foreach ($copy in @(
    @($readyPath, $containerReadyPath),
    @((Join-Path $sqlDir 'production-readonly-preflight.sql'), $containerPreflightPath),
    @((Join-Path $sqlDir 'incremental-apply.sql.lab-only'), $containerApplyPath),
    @((Join-Path $sqlDir 'incremental-acceptance.sql'), $containerAcceptancePath),
    @((Join-Path $sqlDir 'incremental-rollback.sql.lab-only'), $containerRollbackPath),
    @((Join-Path $sqlDir 'incremental-post-rollback-acceptance.sql'), $containerPostRollbackPath),
    @((Join-Path $sqlDir 'baseline-only-fingerprint.sql'), $containerBaselineFingerprintPath),
    @((Join-Path $sqlDir 'full-radar-fingerprint.sql'), $containerFullFingerprintPath),
    @((Join-Path $sqlDir 'radar-sequence-state.sql'), $containerSequencePath)
  )) {
    docker cp $copy[0] "${labContainer}:$($copy[1])" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "复制隔离输入失败：$($copy[0])" }
  }

  $labPreflightOutput = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerPreflightPath `
    -Prefix 'lab-preflight' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $labPreflightChecks = Assert-Checks -Path $labPreflightOutput -Label 'lab preflight'

  $labBaselineCountsPath = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerCountsPath `
    -Prefix 'lab-baseline-table-counts' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $labBaselineCounts = Read-CountMap $labBaselineCountsPath
  Compare-CountMaps $productionCountsAfter $labBaselineCounts '生产 → 隔离恢复表计数'

  $labBaselineFingerprint = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerFullFingerprintPath `
    -Prefix 'lab-baseline-full-fingerprint' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  Assert-FilesEqual $productionFingerprintAfter $labBaselineFingerprint '生产 → 隔离恢复 Radar 指纹'

  $labBaselineSequence = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerSequencePath `
    -Prefix 'lab-baseline-sequence' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  Assert-FilesEqual $productionSequenceAfter $labBaselineSequence '生产 → 隔离恢复 Radar sequence'
  $stageStatus.isolatedRestorePassed = $true
  Write-JsonFile -Path $stageStatusPath -Value $stageStatus

  Write-Host ''
  Write-Host '==> 在隔离数据库录入 1,804 条 storage-normalized 公共结论' -ForegroundColor Cyan
  Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerApplyPath `
    -Prefix 'incremental-apply' `
    -OutputDirectory $outDir | Out-Null
  $stageStatus.incrementalRowsApplied = $ExpectedRows
  Write-JsonFile -Path $stageStatusPath -Value $stageStatus

  $labPostApplyCountsPath = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerCountsPath `
    -Prefix 'lab-post-apply-table-counts' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $labPostApplyCounts = Read-CountMap $labPostApplyCountsPath
  Compare-CountMaps `
    (Filter-NonRadarCountMap $labBaselineCounts) `
    (Filter-NonRadarCountMap $labPostApplyCounts) `
    'apply 后非 Radar 表'
  $stageStatus.nonRadarTablesUnchanged = $true

  $labPostApplyBaselineFingerprint = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerBaselineFingerprintPath `
    -Prefix 'lab-post-apply-baseline-fingerprint' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  Assert-FilesEqual $labBaselineFingerprint $labPostApplyBaselineFingerprint 'apply 后原 9000 条指纹'
  $stageStatus.original9000Unchanged = $true

  $acceptanceOutput = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerAcceptancePath `
    -Prefix 'incremental-acceptance' `
    -OutputDirectory $outDir `
    -ReadOnly $false
  $acceptanceChecks = Assert-Checks -Path $acceptanceOutput -Label 'incremental post-apply acceptance'
  $stageStatus.postApplyAcceptancePassed = $true
  Write-JsonFile -Path $stageStatusPath -Value $stageStatus

  Write-Host ''
  Write-Host '==> 隔离库执行 exact rollback、sequence 恢复与 baseline 复核' -ForegroundColor Cyan
  Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerRollbackPath `
    -Prefix 'incremental-rollback' `
    -OutputDirectory $outDir | Out-Null
  $stageStatus.rollbackPassed = $true

  $sequenceRestorePath = Join-Path $outDir 'radar-sequence-restore.sql.lab-only'
  Write-SequenceRestoreSql `
    -StatePath $labBaselineSequence `
    -OutputPath $sequenceRestorePath
  docker cp $sequenceRestorePath "${labContainer}:$containerSequenceRestorePath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制 sequence restore SQL 失败。' }
  Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerSequenceRestorePath `
    -Prefix 'sequence-restore' `
    -OutputDirectory $outDir | Out-Null
  $stageStatus.sequencesRestored = $true

  $postRollbackOutput = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerPostRollbackPath `
    -Prefix 'post-rollback-acceptance' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $rollbackChecks = Assert-Checks -Path $postRollbackOutput -Label 'post-rollback acceptance'

  $labPostRollbackCountsPath = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerCountsPath `
    -Prefix 'lab-post-rollback-table-counts' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  Compare-CountMaps `
    $labBaselineCounts `
    (Read-CountMap $labPostRollbackCountsPath) `
    'rollback 后全部 public 表'

  $labPostRollbackFingerprint = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerFullFingerprintPath `
    -Prefix 'lab-post-rollback-full-fingerprint' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  Assert-FilesEqual $labBaselineFingerprint $labPostRollbackFingerprint 'rollback 后 Radar 指纹'

  $labPostRollbackSequence = Invoke-DockerPsqlFile `
    -Container $labContainer `
    -Database $labDatabase `
    -User $labUser `
    -Password $labPassword `
    -ContainerSqlPath $containerSequencePath `
    -Prefix 'lab-post-rollback-sequence' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  Assert-FilesEqual $labBaselineSequence $labPostRollbackSequence 'rollback 后 Radar sequence'
  $stageStatus.baselineRestored = $true
  Write-JsonFile -Path $stageStatusPath -Value $stageStatus

  & docker rm -f $labContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '删除隔离 PostgreSQL 容器失败。' }
  $labContainerRemoved = $true
  $stageStatus.labContainerRemoved = $true

  & docker exec $SourcePostgresContainer rm -f `
    $sourceDumpPath `
    $sourcePreflightPath `
    $sourceFingerprintPath `
    $sourceSequencePath `
    $sourceCountsPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '清理源容器临时文件失败。' }
  $sourceTempRemoved = $true
  $stageStatus.sourceContainerTempFilesRemoved = $true

  Write-Host ''
  Write-Host '==> 最后一次生产库只读零漂移检查' -ForegroundColor Cyan
  foreach ($copy in @(
    @((Join-Path $sqlDir 'production-readonly-preflight.sql'), $sourcePreflightPath),
    @((Join-Path $sqlDir 'full-radar-fingerprint.sql'), $sourceFingerprintPath),
    @((Join-Path $sqlDir 'radar-sequence-state.sql'), $sourceSequencePath),
    @($tableCountSqlPath, $sourceCountsPath)
  )) {
    docker cp $copy[0] "${SourcePostgresContainer}:$($copy[1])" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "复制最终只读 SQL 失败：$($copy[0])" }
  }

  $productionFinalPreflight = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourcePreflightPath `
    -Prefix 'production-final-preflight' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $productionFinalChecks = Assert-Checks -Path $productionFinalPreflight -Label 'production final preflight'
  $productionFinalFingerprint = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceFingerprintPath `
    -Prefix 'production-final-fingerprint' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $productionFinalSequence = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceSequencePath `
    -Prefix 'production-final-sequence' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  $productionFinalCountsPath = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -Password '' `
    -ContainerSqlPath $sourceCountsPath `
    -Prefix 'production-final-table-counts' `
    -OutputDirectory $outDir `
    -ReadOnly $true
  Assert-FilesEqual $productionFingerprintAfter $productionFinalFingerprint '演练前后生产 Radar 指纹'
  Assert-FilesEqual $productionSequenceAfter $productionFinalSequence '演练前后生产 Radar sequence'
  Compare-CountMaps $productionCountsAfter (Read-CountMap $productionFinalCountsPath) '演练前后生产表计数'
  $stageStatus.productionFinalReadOnlyCheckPassed = $true

  & docker exec $SourcePostgresContainer rm -f `
    $sourcePreflightPath `
    $sourceFingerprintPath `
    $sourceSequencePath `
    $sourceCountsPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '清理最终源容器临时文件失败。' }
  $sourceTempRemoved = $true
  $stageStatus.sourceContainerTempFilesRemoved = $true

  $labSummary = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    version = 'radar-unified-1804-incremental-storage-lab-runner-v0.1'
    branch = $ExpectedBranch
    head = $localHead
    assemblyBundleSha256 = $assemblyHash.ToLowerInvariant()
    assemblyReadySha256 = $readyHash.ToLowerInvariant()
    freshBackupBytes = $backupBytes
    freshBackupSha256 = $backupHash.Hash.ToLowerInvariant()
    postgresImage = $postgresImage
    baselinePublicRows = $ExpectedBaselineRows
    incrementalRowsAppliedInLab = $ExpectedRows
    postApplyPublicRows = $ExpectedFinalRows
    originalPublicRowsUnchanged = $true
    nonRadarTablesUnchanged = $true
    rollbackRowsRemoved = $ExpectedRows
    sequenceStateRestored = $true
    baselineRestored = $true
    productionPreflightChecks = $productionPreflightChecks.Count
    labPreflightChecks = $labPreflightChecks.Count
    postApplyChecks = $acceptanceChecks.Count
    postRollbackChecks = $rollbackChecks.Count
    productionFinalChecks = $productionFinalChecks.Count
    productionDatabaseRead = $true
    productionDatabaseWrite = $false
    payloadRead = $false
    payloadWrite = $false
    labDatabaseWrite = $true
    labNetworkDisabled = $true
    labContainerRemoved = $true
    sourceContainerTempFilesRemoved = $true
    productionApplyAuthorized = $false
    productionGateGenerated = $false
    nextStep = 'Upload the unified evidence ZIP for independent validation before a production gate is created.'
  }
  Write-JsonFile `
    -Path (Join-Path $outDir 'radar-unified-1804-incremental-storage-lab-summary.json') `
    -Value $labSummary
  $stageStatus.evidencePackageCompleted = $true
  Write-JsonFile -Path $stageStatusPath -Value $stageStatus

  New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
  Get-ChildItem -LiteralPath $outDir -Force |
    Where-Object { $_.Name -ne 'database-backup.dump' } |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $evidenceDir -Recurse -Force
    }
  Write-DirectoryManifest -Directory $evidenceDir
  Compress-Archive `
    -Path (Join-Path $evidenceDir '*') `
    -DestinationPath $evidenceBundle `
    -CompressionLevel Optimal `
    -Force
  if (-not (Test-Path -LiteralPath $evidenceBundle -PathType Leaf)) {
    throw '隔离演练 evidence ZIP 未生成。'
  }
  $evidenceHash = Get-FileHash -LiteralPath $evidenceBundle -Algorithm SHA256
  $evidenceCompleted = $true

  Write-Host ''
  Write-Host '1,804 条统一增量 storage 隔离录入与 exact rollback 已完成～' -ForegroundColor Green
  Write-Host "OutputDirectory       : $outDir"
  Write-Host "EvidenceDirectory     : $evidenceDir"
  Write-Host "EvidenceBundle        : $evidenceBundle"
  Write-Host "EvidenceBundleSHA256  : $($evidenceHash.Hash)"
  Write-Host "LocalFreshBackup      : $backupPath"
  Write-Host "LocalFreshBackupSHA256: $($backupHash.Hash)"
  Write-Host "BaselineRows          : $ExpectedBaselineRows"
  Write-Host "IncrementalRowsInLab  : $ExpectedRows"
  Write-Host "PostApplyRows         : $ExpectedFinalRows"
  Write-Host "Original9000Unchanged : True"
  Write-Host "BaselineRestored      : True"
  Write-Host "ProductionDatabaseWrite: False"
  Write-Host "ProductionRowsWritten : 0"
  Write-Host "ProductionApplyAuthorized: False"
} finally {
  if ($labContainerCreated -and -not $labContainerRemoved) {
    docker rm -f $labContainer 2>$null | Out-Null
    $stageStatus.labContainerRemoved = $true
  }
  if (-not $sourceTempRemoved) {
    docker exec $SourcePostgresContainer rm -f `
      $sourceDumpPath `
      $sourcePreflightPath `
      $sourceFingerprintPath `
      $sourceSequencePath `
      $sourceCountsPath 2>$null | Out-Null
    $stageStatus.sourceContainerTempFilesRemoved = $true
  }
  if (-not $evidenceCompleted -and (Test-Path -LiteralPath $stageStatusPath -PathType Leaf)) {
    Write-JsonFile -Path $stageStatusPath -Value $stageStatus
  }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
