param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AssemblyBundle,
  [Parameter(Mandatory = $true)][string]$LabEvidenceBundle,
  [Parameter(Mandatory = $true)]
  [ValidateSet('RUN-RADAR-UNIFIED-1804-PRODUCTION-READONLY-GATE-V01')]
  [string]$Confirm,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$ExpectedAssemblySHA256 = (
  '53AD4CD92D5A7186B7D52A5BDC8D6E714573E7C9CC17559D8BF96CD2D194B8B9'
)
$ExpectedLabEvidenceSHA256 = (
  '38AF33DCE50F0536A951D6EED26E85C3E9EA45A251F53588D5AB5E2E8772351C'
)
$ExpectedLabHead = '020f1c91be40cf39ffe8155ca4d2ea73640399bb'
$ExpectedRows = 1804
$ExpectedBaselineRows = 9000
$ExpectedPostApplyRows = 10804

$AllowedDirtyFiles = @(
  'next-env.d.ts',
  'payload-types.ts',
  'docs/guides/radar-unified-1804-production-readonly-gate-v01.md',
  'scripts/radar/run-and-package-radar-unified-1804-production-readonly-gate-v01.ps1',
  'tests/radar-unified-1804-production-readonly-gate.test.mjs'
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
    if ([string]::IsNullOrWhiteSpace([string]$line)) {
      continue
    }

    $path = ([string]$line).Substring(3).Trim()

    if ($path -match ' -> ') {
      $path = ($path -split ' -> ')[-1].Trim()
    }

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

  $manifest = (
    Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
      ConvertFrom-Json -Depth 100
  )

  $expected = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
  )

  foreach ($entry in @($manifest)) {
    $relative = ([string]$entry.file).Replace('\', '/')
    $file = Join-Path $Directory (
      $relative.Replace(
        '/',
        [System.IO.Path]::DirectorySeparatorChar
      )
    )

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
    throw (
      "manifest 覆盖数量不一致：" +
      "actual=$($actual.Count) expected=$($expected.Count)"
    )
  }

  foreach ($relative in $actual) {
    if (-not $expected.Contains($relative)) {
      throw "发现 manifest 未登记文件：$relative"
    }
  }

  return @($manifest)
}

function Write-DirectoryManifest {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $manifestPath = Join-Path $Directory 'manifest.json'

  Remove-Item `
    -LiteralPath $manifestPath `
    -Force `
    -ErrorAction SilentlyContinue

  $manifest = @(
    Get-ChildItem -LiteralPath $Directory -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        $relative = [System.IO.Path]::GetRelativePath(
          $Directory,
          $_.FullName
        ).Replace('\', '/')

        $hash = Get-FileHash `
          -LiteralPath $_.FullName `
          -Algorithm SHA256

        [ordered]@{
          file = $relative
          bytes = $_.Length
          sha256 = $hash.Hash.ToLowerInvariant()
        }
      }
  )

  Write-JsonFile -Path $manifestPath -Value $manifest
  $null = Assert-Manifest -Directory $Directory
}

function Assert-FilesEqual {
  param(
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Actual,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $expectedHash = (
    Get-FileHash `
      -LiteralPath $Expected `
      -Algorithm SHA256
  ).Hash

  $actualHash = (
    Get-FileHash `
      -LiteralPath $Actual `
      -Algorithm SHA256
  ).Hash

  if ($expectedHash -ne $actualHash) {
    Write-Host "ExpectedHash: $expectedHash" `
      -ForegroundColor Yellow
    Write-Host "ActualHash  : $actualHash" `
      -ForegroundColor Yellow

    throw "$Label 不一致。"
  }
}

function Invoke-DockerPsqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$ContainerSqlPath,
    [Parameter(Mandatory = $true)][string]$Prefix,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
  )

  $stdoutPath = Join-Path $OutputDirectory "$Prefix-stdout.txt"
  $stderrPath = Join-Path $OutputDirectory "$Prefix-stderr.txt"
  $options = (
    '-c TimeZone=UTC ' +
    '-c client_min_messages=warning ' +
    '-c default_transaction_read_only=on'
  )

  $arguments = @(
    'exec',
    '-e', 'PGPASSWORD=',
    '-e', "PGOPTIONS=$options",
    $Container,
    'psql',
    '-X',
    '-qAt',
    '-v', 'ON_ERROR_STOP=1',
    '-U', $User,
    '-d', $Database,
    '-f', $ContainerSqlPath
  )

  & docker @arguments `
    1> $stdoutPath `
    2> $stderrPath

  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "==> $Prefix stderr" `
      -ForegroundColor Yellow

    if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
      Get-Content -LiteralPath $stderrPath -Encoding UTF8 |
        Select-Object -Last 160 |
        ForEach-Object { Write-Host $_ }
    }

    throw "$Prefix 执行失败。"
  }

  if ((Get-Item -LiteralPath $stderrPath).Length -ne 0) {
    Get-Content -LiteralPath $stderrPath -Encoding UTF8 |
      ForEach-Object { Write-Host $_ }

    throw "$Prefix 产生了非空 stderr。"
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
    if ([string]::IsNullOrWhiteSpace([string]$line)) {
      continue
    }

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

  $failed = @(
    $checks |
      Where-Object { -not $_.matched }
  )

  if ($checks.Count -eq 0 -or $failed.Count -gt 0) {
    $failed |
      Format-Table |
      Out-String |
      Write-Host

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
    if ([string]::IsNullOrWhiteSpace([string]$line)) {
      continue
    }

    $parts = ([string]$line).Split("`t")

    if ($parts.Count -ne 2) {
      throw "无法解析表行数：$line"
    }

    if ($map.ContainsKey($parts[0])) {
      throw "表行数重复：$($parts[0])"
    }

    $map[$parts[0]] = [long]$parts[1]
  }

  return $map
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
      throw (
        "$Label 表行数不一致：" +
        "$key expected=$($Expected[$key]) actual=$($Actual[$key])"
      )
    }
  }
}

if (
  $Confirm -ne
    'RUN-RADAR-UNIFIED-1804-PRODUCTION-READONLY-GATE-V01'
) {
  throw '只读生产 gate 确认字符串不匹配。'
}

foreach ($input in @(
  @($AssemblyBundle, $ExpectedAssemblySHA256, 'assembly'),
  @($LabEvidenceBundle, $ExpectedLabEvidenceSHA256, 'lab evidence')
)) {
  if (-not (Test-Path -LiteralPath $input[0] -PathType Leaf)) {
    throw "找不到 $($input[2]) ZIP：$($input[0])"
  }

  $hash = (
    Get-FileHash `
      -LiteralPath $input[0] `
      -Algorithm SHA256
  ).Hash

  if ($hash -ne $input[1]) {
    throw "$($input[2]) ZIP SHA-256 不匹配：$hash"
  }
}

$unexpectedDirty = @(
  Get-DirtyPaths |
    Where-Object { $AllowedDirtyFiles -notcontains $_ }
)

if ($unexpectedDirty.Count -gt 0) {
  $unexpectedDirty |
    ForEach-Object {
      Write-Host "unexpected dirty: $_" `
        -ForegroundColor Yellow
    }

  throw '存在预期之外的本地修改；未开始只读 gate。'
}

Write-Host ''
Write-Host '==> 锁定 PR #311 分支与提交' `
  -ForegroundColor Cyan

git fetch origin
if ($LASTEXITCODE -ne 0) {
  throw '获取远端更新失败。'
}

git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) {
  throw '切换公共 Radar 分支失败。'
}

git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) {
  throw '更新公共 Radar 分支失败。'
}

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()

if (
  $localHead -ne $ExpectedBranchHead -or
  $remoteHead -ne $ExpectedBranchHead
) {
  throw (
    "只读 gate 提交不符合预期：" +
    "local=$localHead remote=$remoteHead"
  )
}

Write-Host ''
Write-Host '==> 运行只读 gate parser 与回归测试' `
  -ForegroundColor Cyan

$tokens = $null
$errors = $null

$null = (
  [System.Management.Automation.Language.Parser]::ParseFile(
    $PSCommandPath,
    [ref]$tokens,
    [ref]$errors
  )
)

if (@($errors).Count -gt 0) {
  $errors |
    Format-List |
    Out-String |
    Write-Host

  throw '只读 gate PowerShell parser 检查失败。'
}

node --test `
  '.\tests\radar-unified-1804-production-readonly-gate.test.mjs'

if ($LASTEXITCODE -ne 0) {
  throw '只读 production gate 回归测试失败。'
}

& docker version | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw 'Docker 不可用。'
}

$sourceRunning = (
  [string](
    & docker inspect `
      -f '{{.State.Running}}' `
      $SourcePostgresContainer
  )
).Trim()

if (
  $LASTEXITCODE -ne 0 -or
  $sourceRunning -ne 'true'
) {
  throw "源 PostgreSQL 容器未运行：$SourcePostgresContainer"
}

$postgresImage = (
  [string](
    & docker inspect `
      -f '{{.Config.Image}}' `
      $SourcePostgresContainer
  )
).Trim()

if (
  $LASTEXITCODE -ne 0 -or
  [string]::IsNullOrWhiteSpace($postgresImage)
) {
  throw '无法读取 PostgreSQL 镜像。'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path (
  $repoRoot
) "exports\radar-unified-1804-production-readonly-gate-$stamp"

$evidenceDir = Join-Path (
  $repoRoot
) "exports\radar-unified-1804-production-readonly-gate-evidence-$stamp"

$evidenceBundle = Join-Path (
  $repoRoot
) "exports\RADAR-UNIFIED-1804-PRODUCTION-READONLY-GATE-EVIDENCE-$stamp.zip"

$tempRoot = Join-Path (
  [System.IO.Path]::GetTempPath()
) (
  "radar-unified-1804-production-readonly-gate-$stamp-" +
  [Guid]::NewGuid().ToString('N')
)

$assemblyDir = Join-Path $tempRoot 'assembly'
$labEvidenceDir = Join-Path $tempRoot 'lab-evidence'

New-Item `
  -ItemType Directory `
  -Path $outDir, $evidenceDir, $assemblyDir, $labEvidenceDir `
  -Force |
  Out-Null

Expand-Archive `
  -LiteralPath $AssemblyBundle `
  -DestinationPath $assemblyDir `
  -Force

Expand-Archive `
  -LiteralPath $LabEvidenceBundle `
  -DestinationPath $labEvidenceDir `
  -Force

$assemblyManifest = Assert-Manifest -Directory $assemblyDir
$labManifest = Assert-Manifest -Directory $labEvidenceDir

$assemblySummaryPath = Join-Path (
  $assemblyDir
) 'radar-unified-incremental-assembly-summary.json'

$readyPath = Join-Path (
  $assemblyDir
) 'public-ai-storage-ready.jsonl'

$assemblySummary = (
  Get-Content `
    -LiteralPath $assemblySummaryPath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
)

$readyHash = (
  Get-FileHash `
    -LiteralPath $readyPath `
    -Algorithm SHA256
).Hash.ToLowerInvariant()

if (
  $assemblySummary.rows -ne $ExpectedRows -or
  $assemblySummary.storageNormalized -ne $ExpectedRows -or
  $assemblySummary.readyForStorageLabPlanning -ne $true -or
  ([string]$assemblySummary.readyFileSha256).ToLowerInvariant() -ne
    $readyHash
) {
  throw 'Assembly 固定门槛或 storage-ready 绑定不匹配。'
}

$labSummaryPath = Join-Path (
  $labEvidenceDir
) 'radar-unified-1804-incremental-storage-lab-summary.json'

$planSummaryPath = Join-Path (
  $labEvidenceDir
) 'lab-sql\radar-unified-incremental-storage-lab-plan-summary.json'

$labSummary = (
  Get-Content `
    -LiteralPath $labSummaryPath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
)

$planSummary = (
  Get-Content `
    -LiteralPath $planSummaryPath `
    -Raw `
    -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
)

if (
  ([string]$labSummary.head) -ne $ExpectedLabHead -or
  ([string]$labSummary.assemblyBundleSha256).ToUpperInvariant() -ne
    $ExpectedAssemblySHA256 -or
  $labSummary.baselinePublicRows -ne $ExpectedBaselineRows -or
  $labSummary.incrementalRowsAppliedInLab -ne $ExpectedRows -or
  $labSummary.postApplyPublicRows -ne $ExpectedPostApplyRows -or
  $labSummary.originalPublicRowsUnchanged -ne $true -or
  $labSummary.nonRadarTablesUnchanged -ne $true -or
  $labSummary.baselineRestored -ne $true -or
  $labSummary.sequenceStateRestored -ne $true -or
  $labSummary.productionDatabaseWrite -ne $false -or
  $labSummary.productionApplyAuthorized -ne $false
) {
  throw '隔离 lab summary 不满足 production gate 前置条件。'
}

if (
  $planSummary.inputRows -ne $ExpectedRows -or
  $planSummary.baselineRows -ne $ExpectedBaselineRows -or
  $planSummary.finalRows -ne $ExpectedPostApplyRows -or
  $planSummary.productionApplyAuthorized -ne $false -or
  ([string]$planSummary.assemblyBundleSha256).ToUpperInvariant() -ne
    $ExpectedAssemblySHA256
) {
  throw '隔离 lab plan summary 不满足固定门槛。'
}

$sqlFiles = [ordered]@{
  acceptance = 'lab-sql\incremental-acceptance.sql'
  apply = 'lab-sql\incremental-apply.sql.lab-only'
  baselineFingerprint = 'lab-sql\baseline-only-fingerprint.sql'
  fullFingerprint = 'lab-sql\full-radar-fingerprint.sql'
  postRollback = 'lab-sql\incremental-post-rollback-acceptance.sql'
  productionPreflight = 'lab-sql\production-readonly-preflight.sql'
  rollback = 'lab-sql\incremental-rollback.sql.lab-only'
  sequenceState = 'lab-sql\radar-sequence-state.sql'
}

foreach ($entry in $sqlFiles.GetEnumerator()) {
  $file = Join-Path $labEvidenceDir $entry.Value
  $hash = (
    Get-FileHash `
      -LiteralPath $file `
      -Algorithm SHA256
  ).Hash.ToLowerInvariant()

  $expected = (
    [string]$planSummary.sqlSha256.($entry.Key)
  ).ToLowerInvariant()

  if ($hash -ne $expected) {
    throw "SQL SHA-256 不匹配：$($entry.Key)"
  }
}

$referenceTriples = @(
  @(
    'production-pre-backup-preflight-stdout.txt',
    'production-post-backup-preflight-stdout.txt',
    'production-final-preflight-stdout.txt'
  ),
  @(
    'production-pre-backup-fingerprint-stdout.txt',
    'production-post-backup-fingerprint-stdout.txt',
    'production-final-fingerprint-stdout.txt'
  ),
  @(
    'production-pre-backup-sequence-stdout.txt',
    'production-post-backup-sequence-stdout.txt',
    'production-final-sequence-stdout.txt'
  ),
  @(
    'production-pre-backup-table-counts-stdout.txt',
    'production-post-backup-table-counts-stdout.txt',
    'production-final-table-counts-stdout.txt'
  )
)

foreach ($triple in $referenceTriples) {
  $first = Join-Path $labEvidenceDir $triple[0]
  $second = Join-Path $labEvidenceDir $triple[1]
  $third = Join-Path $labEvidenceDir $triple[2]

  Assert-FilesEqual $first $second "隔离证据内部一致性：$($triple[0])"
  Assert-FilesEqual $first $third "隔离证据最终一致性：$($triple[0])"
}

$referenceFinalPreflight = Join-Path (
  $labEvidenceDir
) 'production-final-preflight-stdout.txt'

$referenceFinalFingerprint = Join-Path (
  $labEvidenceDir
) 'production-final-fingerprint-stdout.txt'

$referenceFinalSequence = Join-Path (
  $labEvidenceDir
) 'production-final-sequence-stdout.txt'

$referenceFinalCounts = Join-Path (
  $labEvidenceDir
) 'production-final-table-counts-stdout.txt'

$referenceChecks = Assert-Checks `
  -Path $referenceFinalPreflight `
  -Label '隔离证据 production-final preflight'

$tableCountSqlPath = Join-Path $outDir 'all-public-table-counts.sql'
Write-TableCountSql -Path $tableCountSqlPath

$backupPath = Join-Path $outDir 'database-backup.dump'
$sourcePrefix = "/tmp/radar-unified-1804-production-readonly-gate-$stamp"
$sourceDumpPath = "$sourcePrefix.dump"
$sourcePreflightPath = "$sourcePrefix-preflight.sql"
$sourceFingerprintPath = "$sourcePrefix-fingerprint.sql"
$sourceSequencePath = "$sourcePrefix-sequence.sql"
$sourceCountsPath = "$sourcePrefix-counts.sql"

$stageStatusPath = Join-Path $outDir 'gate-stage-status.json'

$stageStatus = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  branchAndHeadLocked = $true
  artifactManifestsPassed = $true
  labEvidenceAccepted = $true
  currentProductionMatchesAcceptedBaseline = $false
  freshBackupCreated = $false
  backupArchiveValidated = $false
  backupWindowStable = $false
  sourceContainerTempFilesRemoved = $false
  evidencePackageCompleted = $false
  productionDatabaseRead = $false
  productionDatabaseWrite = $false
  productionPayloadRead = $false
  productionPayloadWrite = $false
  productionApplyAuthorized = $false
  readyForProductionExecutionPackage = $false
}

Write-JsonFile `
  -Path $stageStatusPath `
  -Value $stageStatus

$sourceTempRemoved = $false
$evidenceCompleted = $false

try {
  Write-Host ''
  Write-Host '==> 复制只读 SQL 到生产 PostgreSQL 容器' `
    -ForegroundColor Cyan

  foreach ($copy in @(
    @(
      (Join-Path $labEvidenceDir 'lab-sql\production-readonly-preflight.sql'),
      $sourcePreflightPath
    ),
    @(
      (Join-Path $labEvidenceDir 'lab-sql\full-radar-fingerprint.sql'),
      $sourceFingerprintPath
    ),
    @(
      (Join-Path $labEvidenceDir 'lab-sql\radar-sequence-state.sql'),
      $sourceSequencePath
    ),
    @($tableCountSqlPath, $sourceCountsPath)
  )) {
    docker cp `
      $copy[0] `
      "${SourcePostgresContainer}:$($copy[1])" |
      Out-Null

    if ($LASTEXITCODE -ne 0) {
      throw "复制只读 SQL 到源容器失败：$($copy[0])"
    }
  }

  Write-Host ''
  Write-Host '==> 当前生产库只读 exact-before gate' `
    -ForegroundColor Cyan

  $currentPreflight = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -ContainerSqlPath $sourcePreflightPath `
    -Prefix 'gate-pre-backup-preflight' `
    -OutputDirectory $outDir

  $currentChecks = Assert-Checks `
    -Path $currentPreflight `
    -Label 'gate pre-backup preflight'

  $currentFingerprint = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -ContainerSqlPath $sourceFingerprintPath `
    -Prefix 'gate-pre-backup-fingerprint' `
    -OutputDirectory $outDir

  $currentSequence = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -ContainerSqlPath $sourceSequencePath `
    -Prefix 'gate-pre-backup-sequence' `
    -OutputDirectory $outDir

  $currentCounts = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -ContainerSqlPath $sourceCountsPath `
    -Prefix 'gate-pre-backup-table-counts' `
    -OutputDirectory $outDir

  Assert-FilesEqual `
    $referenceFinalPreflight `
    $currentPreflight `
    '当前生产 preflight 与已验收 baseline'

  Assert-FilesEqual `
    $referenceFinalFingerprint `
    $currentFingerprint `
    '当前生产 Radar 指纹与已验收 baseline'

  Assert-FilesEqual `
    $referenceFinalSequence `
    $currentSequence `
    '当前生产 Radar sequence 与已验收 baseline'

  Compare-CountMaps `
    (Read-CountMap $referenceFinalCounts) `
    (Read-CountMap $currentCounts) `
    '当前生产全表计数与已验收 baseline'

  $stageStatus.currentProductionMatchesAcceptedBaseline = $true
  $stageStatus.productionDatabaseRead = $true

  Write-JsonFile `
    -Path $stageStatusPath `
    -Value $stageStatus

  Write-Host ''
  Write-Host '==> 创建最终执行门 fresh production backup' `
    -ForegroundColor Cyan

  & docker exec $SourcePostgresContainer pg_dump `
    -U $SourceDatabaseUser `
    -d $SourceDatabase `
    --format=custom `
    --compress=6 `
    --serializable-deferrable `
    --no-owner `
    --no-privileges `
    --file=$sourceDumpPath

  if ($LASTEXITCODE -ne 0) {
    throw '生产数据库 fresh pg_dump 失败。'
  }

  docker cp `
    "${SourcePostgresContainer}:$sourceDumpPath" `
    $backupPath |
    Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw '复制 final-gate fresh backup 到宿主机失败。'
  }

  $backupHash = (
    Get-FileHash `
      -LiteralPath $backupPath `
      -Algorithm SHA256
  ).Hash

  $backupBytes = (
    Get-Item -LiteralPath $backupPath
  ).Length

  if ($backupBytes -le 0) {
    throw 'final-gate fresh backup 为空。'
  }

  $stageStatus.freshBackupCreated = $true

  $backupDirectory = Split-Path -Parent $backupPath
  $backupFileName = Split-Path -Leaf $backupPath
  $backupMount = "${backupDirectory}:/backup:ro"

  & docker run `
    --rm `
    --network none `
    -v $backupMount `
    $postgresImage `
    pg_restore `
    --list `
    "/backup/$backupFileName" `
    1> (Join-Path $outDir 'backup-archive-list.txt') `
    2> (Join-Path $outDir 'backup-archive-list-stderr.txt')

  if ($LASTEXITCODE -ne 0) {
    throw 'pg_restore --list 校验 final-gate backup 失败。'
  }

  $backupListStderr = Join-Path (
    $outDir
  ) 'backup-archive-list-stderr.txt'

  if ((Get-Item -LiteralPath $backupListStderr).Length -ne 0) {
    throw 'pg_restore --list 产生了非空 stderr。'
  }

  $stageStatus.backupArchiveValidated = $true

  Write-Host ''
  Write-Host '==> backup 后再次确认生产零漂移' `
    -ForegroundColor Cyan

  $afterPreflight = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -ContainerSqlPath $sourcePreflightPath `
    -Prefix 'gate-post-backup-preflight' `
    -OutputDirectory $outDir

  $afterChecks = Assert-Checks `
    -Path $afterPreflight `
    -Label 'gate post-backup preflight'

  $afterFingerprint = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -ContainerSqlPath $sourceFingerprintPath `
    -Prefix 'gate-post-backup-fingerprint' `
    -OutputDirectory $outDir

  $afterSequence = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -ContainerSqlPath $sourceSequencePath `
    -Prefix 'gate-post-backup-sequence' `
    -OutputDirectory $outDir

  $afterCounts = Invoke-DockerPsqlFile `
    -Container $SourcePostgresContainer `
    -Database $SourceDatabase `
    -User $SourceDatabaseUser `
    -ContainerSqlPath $sourceCountsPath `
    -Prefix 'gate-post-backup-table-counts' `
    -OutputDirectory $outDir

  Assert-FilesEqual `
    $currentPreflight `
    $afterPreflight `
    'gate backup 前后 preflight'

  Assert-FilesEqual `
    $currentFingerprint `
    $afterFingerprint `
    'gate backup 前后 Radar 指纹'

  Assert-FilesEqual `
    $currentSequence `
    $afterSequence `
    'gate backup 前后 Radar sequence'

  Compare-CountMaps `
    (Read-CountMap $currentCounts) `
    (Read-CountMap $afterCounts) `
    'gate backup 前后全表计数'

  Assert-FilesEqual `
    $referenceFinalPreflight `
    $afterPreflight `
    'gate backup 后 preflight 与已验收 baseline'

  Assert-FilesEqual `
    $referenceFinalFingerprint `
    $afterFingerprint `
    'gate backup 后 Radar 指纹与已验收 baseline'

  Assert-FilesEqual `
    $referenceFinalSequence `
    $afterSequence `
    'gate backup 后 sequence 与已验收 baseline'

  Compare-CountMaps `
    (Read-CountMap $referenceFinalCounts) `
    (Read-CountMap $afterCounts) `
    'gate backup 后全表计数与已验收 baseline'

  $stageStatus.backupWindowStable = $true
  $stageStatus.readyForProductionExecutionPackage = $true

  Write-Host ''
  Write-Host '==> 清理源容器临时文件后封装证据' `
    -ForegroundColor Cyan

  & docker exec $SourcePostgresContainer rm -f `
    $sourceDumpPath `
    $sourcePreflightPath `
    $sourceFingerprintPath `
    $sourceSequencePath `
    $sourceCountsPath |
    Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw '只读 gate 源容器临时文件清理失败。'
  }

  $sourceTempRemoved = $true
  $stageStatus.sourceContainerTempFilesRemoved = $true
  $stageStatus.evidencePackageCompleted = $true

  Write-JsonFile `
    -Path $stageStatusPath `
    -Value $stageStatus

  $summary = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    version = 'radar-unified-1804-production-readonly-gate-v0.1'
    branch = $ExpectedBranch
    head = $ExpectedBranchHead
    assemblyBundleSha256 = $ExpectedAssemblySHA256.ToLowerInvariant()
    labEvidenceBundleSha256 = (
      $ExpectedLabEvidenceSHA256.ToLowerInvariant()
    )
    assemblyManifestFiles = $assemblyManifest.Count
    labEvidenceManifestFiles = $labManifest.Count
    expectedProductionBaselineRows = $ExpectedBaselineRows
    expectedProductionCreateRows = $ExpectedRows
    expectedPostApplyRows = $ExpectedPostApplyRows
    acceptedBaselinePreflightChecks = $referenceChecks.Count
    currentPreflightChecks = $currentChecks.Count
    postBackupPreflightChecks = $afterChecks.Count
    currentProductionMatchesAcceptedBaseline = $true
    backupWindowStable = $true
    freshBackupBytes = $backupBytes
    freshBackupSha256 = $backupHash.ToLowerInvariant()
    backupArchiveValidated = $true
    productionDatabaseRead = $true
    productionDatabaseWrite = $false
    productionPayloadRead = $false
    productionPayloadWrite = $false
    productionApplyAuthorized = $false
    productionApplyExecuted = $false
    writableSqlCopiedToProduction = $false
    sourceContainerTempFilesRemoved = $true
    evidencePackageCompleted = $true
    readyForProductionExecutionPackage = $true
    nextStep = (
      'Upload this read-only gate evidence ZIP. ' +
      'A separate production execution package and explicit approval ' +
      'phrase are still required.'
    )
  }

  $summaryPath = Join-Path (
    $outDir
  ) 'radar-unified-1804-production-readonly-gate-summary.json'

  Write-JsonFile `
    -Path $summaryPath `
    -Value $summary

  Copy-Item `
    -LiteralPath $summaryPath `
    -Destination $evidenceDir `
    -Force

  Copy-Item `
    -LiteralPath $stageStatusPath `
    -Destination $evidenceDir `
    -Force

  Copy-Item `
    -LiteralPath $assemblySummaryPath `
    -Destination (
      Join-Path $evidenceDir 'source-assembly-summary.json'
    ) `
    -Force

  Copy-Item `
    -LiteralPath $labSummaryPath `
    -Destination (
      Join-Path $evidenceDir 'source-lab-summary.json'
    ) `
    -Force

  Copy-Item `
    -LiteralPath $planSummaryPath `
    -Destination (
      Join-Path $evidenceDir 'source-lab-plan-summary.json'
    ) `
    -Force

  foreach ($file in @(
    'all-public-table-counts.sql',
    'gate-pre-backup-preflight-stdout.txt',
    'gate-pre-backup-preflight-stderr.txt',
    'gate-pre-backup-fingerprint-stdout.txt',
    'gate-pre-backup-fingerprint-stderr.txt',
    'gate-pre-backup-sequence-stdout.txt',
    'gate-pre-backup-sequence-stderr.txt',
    'gate-pre-backup-table-counts-stdout.txt',
    'gate-pre-backup-table-counts-stderr.txt',
    'gate-post-backup-preflight-stdout.txt',
    'gate-post-backup-preflight-stderr.txt',
    'gate-post-backup-fingerprint-stdout.txt',
    'gate-post-backup-fingerprint-stderr.txt',
    'gate-post-backup-sequence-stdout.txt',
    'gate-post-backup-sequence-stderr.txt',
    'gate-post-backup-table-counts-stdout.txt',
    'gate-post-backup-table-counts-stderr.txt',
    'backup-archive-list.txt',
    'backup-archive-list-stderr.txt'
  )) {
    Copy-Item `
      -LiteralPath (Join-Path $outDir $file) `
      -Destination $evidenceDir `
      -Force
  }

  foreach ($file in @(
    'production-final-preflight-stdout.txt',
    'production-final-fingerprint-stdout.txt',
    'production-final-sequence-stdout.txt',
    'production-final-table-counts-stdout.txt'
  )) {
    Copy-Item `
      -LiteralPath (Join-Path $labEvidenceDir $file) `
      -Destination (
        Join-Path $evidenceDir "accepted-$file"
      ) `
      -Force
  }

  foreach ($file in @(
    'production-readonly-preflight.sql',
    'full-radar-fingerprint.sql',
    'radar-sequence-state.sql'
  )) {
    Copy-Item `
      -LiteralPath (
        Join-Path $labEvidenceDir "lab-sql\$file"
      ) `
      -Destination $evidenceDir `
      -Force
  }

  Write-DirectoryManifest -Directory $evidenceDir

  Compress-Archive `
    -Path (Join-Path $evidenceDir '*') `
    -DestinationPath $evidenceBundle `
    -CompressionLevel Optimal `
    -Force

  $evidenceHash = (
    Get-FileHash `
      -LiteralPath $evidenceBundle `
      -Algorithm SHA256
  ).Hash

  $stageStatus.evidencePackageCompleted = $true

  Write-JsonFile `
    -Path $stageStatusPath `
    -Value $stageStatus

  $evidenceCompleted = $true

  Write-Host ''
  Write-Host (
    '1,804 条统一生产只读 gate 已通过～'
  ) -ForegroundColor Green

  Write-Host "OutputDirectory        : $outDir"
  Write-Host "EvidenceBundle         : $evidenceBundle"
  Write-Host "EvidenceBundleSHA256   : $evidenceHash"
  Write-Host "LocalFreshBackup       : $backupPath"
  Write-Host "LocalFreshBackupSHA256 : $backupHash"
  Write-Host "ProductionBaselineRows : $ExpectedBaselineRows"
  Write-Host "PlannedCreateRows      : $ExpectedRows"
  Write-Host "PlannedPostApplyRows   : $ExpectedPostApplyRows"
  Write-Host "ProductionDatabaseWrite: False"
  Write-Host "ProductionApplyExecuted: False"
  Write-Host "ProductionApplyAuthorized: False"
  Write-Host "ReadyForExecutionPackage: True"
}
finally {
  & docker exec $SourcePostgresContainer rm -f `
    $sourceDumpPath `
    $sourcePreflightPath `
    $sourceFingerprintPath `
    $sourceSequencePath `
    $sourceCountsPath |
    Out-Null

  if ($LASTEXITCODE -eq 0) {
    $sourceTempRemoved = $true
  }

  if (Test-Path -LiteralPath $stageStatusPath -PathType Leaf) {
    try {
      $latest = (
        Get-Content `
          -LiteralPath $stageStatusPath `
          -Raw `
          -Encoding UTF8 |
        ConvertFrom-Json -Depth 100
      )

      $latest.sourceContainerTempFilesRemoved = $sourceTempRemoved
      $latest.evidencePackageCompleted = $evidenceCompleted

      Write-JsonFile `
        -Path $stageStatusPath `
        -Value $latest
    }
    catch {
      Write-Host (
        "无法更新 gate stage status：" +
        $_.Exception.Message
      ) -ForegroundColor Yellow
    }
  }

  Remove-Item `
    -LiteralPath $tempRoot `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue
}
