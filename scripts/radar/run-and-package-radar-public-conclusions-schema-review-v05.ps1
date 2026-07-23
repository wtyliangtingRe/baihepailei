param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [string]$ExpectedAuditBundleSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-DirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path.Replace('\', '/')
  }
  return @($paths)
}

function Assert-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "审计 ZIP 缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "审计 manifest 文件不存在：$($entry.file)"
    }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    $bytes = (Get-Item -LiteralPath $file).Length
    if ($bytes -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "审计 manifest 校验失败：$($entry.file)"
    }
  }
}

function Remove-GeneratedMigrationPaths {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Paths)

  foreach ($path in $Paths) {
    if ($path -eq 'src/migrations/index.ts') {
      git restore --worktree -- 'src/migrations/index.ts' 2>$null
      continue
    }
    $full = Join-Path $repoRoot $path
    if (Test-Path -LiteralPath $full -PathType Leaf) {
      Remove-Item -LiteralPath $full -Force
    }
  }
}

if (-not (Test-Path -LiteralPath $AuditBundle -PathType Leaf)) {
  throw "找不到最终全量审计 ZIP：$AuditBundle"
}
$auditBundlePath = (Resolve-Path -LiteralPath $AuditBundle).Path
$auditBundleHash = (Get-FileHash -LiteralPath $auditBundlePath -Algorithm SHA256).Hash
if ($auditBundleHash -ne $ExpectedAuditBundleSHA256) {
  throw "最终全量审计 ZIP SHA-256 不匹配：$auditBundleHash"
}

$unexpectedDirty = @(Get-DirtyPaths | Where-Object { $AllowedDirtyFiles -notcontains $_ })
if ($unexpectedDirty.Count -gt 0) {
  $unexpectedDirty | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '存在预期之外的本地修改；未生成 migration。'
}

Write-Host ''
Write-Host '==> 锁定 schema review 起始提交' -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端分支失败。' }
git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '切换公共 Radar 分支失败。' }
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新公共 Radar 分支失败。' }

$beforeHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($beforeHead -ne $ExpectedBranchHead -or $remoteHead -ne $ExpectedBranchHead) {
  throw "起始提交不符合预期：local=$beforeHead remote=$remoteHead"
}

Write-Host ''
Write-Host '==> 运行 direct-runner 与 schema review 安全测试' -ForegroundColor Cyan
node --check '.\scripts\radar\build-radar-public-conclusions-schema-review-v01.mjs'
if ($LASTEXITCODE -ne 0) { throw 'v01 schema review builder 语法检查失败。' }
node --check '.\scripts\radar\build-radar-public-conclusions-schema-review-v02.mjs'
if ($LASTEXITCODE -ne 0) { throw 'v02 schema review builder 语法检查失败。' }
node --test `
  '.\tests\radar-public-conclusions.test.mjs' `
  '.\tests\radar-public-migration-baseline.test.mjs' `
  '.\tests\radar-assessment-presentation.test.mjs' `
  '.\tests\radar-public-conclusions-schema-review.test.mjs' `
  '.\tests\radar-public-conclusions-direct-runner.test.mjs'
if ($LASTEXITCODE -ne 0) { throw '公共 Radar schema review 回归测试失败。' }

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-public-schema-review-' + [guid]::NewGuid().ToString('N'))
$auditExtract = Join-Path $tempRoot 'audit'
New-Item -ItemType Directory -Path $auditExtract -Force | Out-Null
Expand-Archive -LiteralPath $auditBundlePath -DestinationPath $auditExtract -Force
Assert-Manifest $auditExtract

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-public-conclusions-schema-review-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-PUBLIC-CONCLUSIONS-SCHEMA-REVIEW-$stamp.zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$migrationLog = Join-Path $outDir 'migration-generation.log'
$generatedPaths = @()
$commitCreated = $false
$pushCompleted = $false

try {
  Write-Host ''
  Write-Host '==> 生成 Radar-only 加法 migration（先不提交、不推送、不执行）' -ForegroundColor Cyan
  & '.\scripts\radar\prepare-radar-public-conclusions-migration-v05.ps1' 2>&1 |
    Tee-Object -FilePath $migrationLog
  if ($LASTEXITCODE -ne 0) {
    throw "Radar-only migration 生成失败：$LASTEXITCODE"
  }

  $generatedPaths = @(Get-DirtyPaths | Where-Object { $AllowedDirtyFiles -notcontains $_ })
  $expectedIndex = @($generatedPaths | Where-Object { $_ -eq 'src/migrations/index.ts' })
  $baselineTs = @($generatedPaths | Where-Object { $_ -match '^src/migrations/.+current_schema_baseline_before_radar_public_v01\.ts$' })
  $baselineJson = @($generatedPaths | Where-Object { $_ -match '^src/migrations/.+current_schema_baseline_before_radar_public_v01\.json$' })
  $radarTs = @($generatedPaths | Where-Object { $_ -match '^src/migrations/.+radar_public_conclusions_v01\.ts$' })
  $radarJson = @($generatedPaths | Where-Object { $_ -match '^src/migrations/.+radar_public_conclusions_v01\.json$' })
  if ($generatedPaths.Count -ne 5 -or $expectedIndex.Count -ne 1 -or $baselineTs.Count -ne 1 -or $baselineJson.Count -ne 1 -or $radarTs.Count -ne 1 -or $radarJson.Count -ne 1) {
    $generatedPaths | ForEach-Object { Write-Host "generated: $_" -ForegroundColor Yellow }
    throw '生成文件集合不符合唯一的 5 文件门槛。'
  }

  git add -- @generatedPaths
  if ($LASTEXITCODE -ne 0) { throw '暂存生成的 migration 文件失败。' }
  $staged = @(git diff --cached --name-only | Sort-Object)
  $expectedStaged = @($generatedPaths | Sort-Object)
  if (($staged -join "`n") -ne ($expectedStaged -join "`n")) {
    $staged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
    throw '暂存区包含预期之外的文件。'
  }

  git commit -m 'Add Radar public conclusions migration'
  if ($LASTEXITCODE -ne 0) { throw '本地 migration commit 失败。' }
  $commitCreated = $true
  $afterHead = (git rev-parse HEAD).Trim()
  if ($afterHead -eq $beforeHead) { throw '本地 migration commit 没有产生新 HEAD。' }

  $changedPaths = @(git diff --name-only "$beforeHead..$afterHead")
  $actualCommitted = @($changedPaths | Sort-Object)
  if (($actualCommitted -join "`n") -ne ($expectedStaged -join "`n")) {
    throw 'migration commit 文件集合与生成集合不一致。'
  }
  [System.IO.File]::WriteAllLines(
    (Join-Path $outDir 'migration-commit-files.txt'),
    @($changedPaths),
    [System.Text.UTF8Encoding]::new($false)
  )

  Write-Host ''
  Write-Host '==> 绑定 9,000 条写入计划并抽取禁用态 exact SQL' -ForegroundColor Cyan
  node '.\scripts\radar\build-radar-public-conclusions-schema-review-v02.mjs' `
    --audit-dir $auditExtract `
    --audit-zip-sha256 $auditBundleHash `
    --baseline-ts (Join-Path $repoRoot $baselineTs[0]) `
    --baseline-snapshot (Join-Path $repoRoot $baselineJson[0]) `
    --migration-ts (Join-Path $repoRoot $radarTs[0]) `
    --migration-snapshot (Join-Path $repoRoot $radarJson[0]) `
    --before-head $beforeHead `
    --after-head $afterHead `
    --out-dir $outDir
  if ($LASTEXITCODE -ne 0) { throw 'schema review builder 失败。' }

  $summaryPath = Join-Path $outDir 'radar-public-conclusions-schema-review-summary.json'
  $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if ($summary.audit.publicReadyRows -ne 9000 -or
      $summary.dataPlan.rows -ne 9000 -or
      $summary.dataPlan.uniquePublicationKeys -ne 9000 -or
      $summary.dataPlan.uniqueWorkIds -ne 9000 -or
      $summary.schema.radarOnly -ne $true -or
      $summary.schema.additive -ne $true -or
      $summary.status.productionRowsWritten -ne 0 -or
      $summary.status.productionWriteAuthorized -ne $false -or
      $summary.safety.productionDatabaseWrite -ne $false -or
      $summary.safety.productionMigrationExecuted -ne $false) {
    throw 'schema review 摘要未达到只读审阅门槛。'
  }

  Write-Json -Path (Join-Path $outDir 'schema-review-run-validation.json') -Value ([ordered]@{
    schemaVersion = 3
    generatedAt = [DateTime]::UtcNow.ToString('o')
    beforeHead = $beforeHead
    afterHead = $afterHead
    auditBundle = [System.IO.Path]::GetFileName($auditBundlePath)
    auditBundleSha256 = $auditBundleHash.ToLowerInvariant()
    auditManifestVerified = $true
    migrationCommitFiles = @($changedPaths)
    publicReadyRows = 9000
    privateRowsWritten = 0
    publicRowsWritten = 0
    payloadWorksPatch = $false
    productionDatabaseReadForMigrationCreate = $true
    productionDatabaseSessionReadOnly = $true
    payloadDbPush = $false
    productionDatabaseWrite = $false
    productionMigrationExecuted = $false
    schemaPush = $false
    productionWriteAuthorized = $false
    rollbackAuthorized = $false
    remotePushDeferredUntilPackageComplete = $true
  })

  $files = @(Get-ChildItem -LiteralPath $outDir -File | Where-Object Name -ne 'manifest.json' | Sort-Object Name)
  $manifest = @($files | ForEach-Object {
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{ file = $_.Name; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
  })
  Write-Json -Path (Join-Path $outDir 'manifest.json') -Value $manifest
  foreach ($entry in $manifest) {
    $file = Join-Path $outDir ([string]$entry.file)
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "最终 schema review manifest 校验失败：$($entry.file)"
    }
  }

  $paths = @((Get-ChildItem -LiteralPath $outDir -File | Sort-Object Name).FullName)
  Compress-Archive -LiteralPath $paths -DestinationPath $bundlePath -CompressionLevel Optimal -Force
  $bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

  Write-Host ''
  Write-Host '==> review 包完整后才推送 migration commit' -ForegroundColor Cyan
  git push origin $ExpectedBranch
  if ($LASTEXITCODE -ne 0) { throw 'migration commit 推送失败。' }
  $pushCompleted = $true
  $afterRemoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
  if ($afterRemoteHead -ne $afterHead) { throw '远端 HEAD 未与已审阅 migration commit 对齐。' }

  Write-Host ''
  Write-Host 'Radar 公共结论 schema review 包生成完成' -ForegroundColor Green
  Write-Host "OutputDirectory          : $outDir"
  Write-Host "Bundle                   : $bundlePath"
  Write-Host "SHA256                   : $($bundleHash.Hash)"
  Write-Host "BeforeHead               : $beforeHead"
  Write-Host "AfterHead                : $afterHead"
  Write-Host 'PublicReadyRows          : 9000'
  Write-Host 'UniquePublicationKeys    : 9000'
  Write-Host 'UniqueWorkIds            : 9000'
  Write-Host 'PostgreSQLSessionReadOnly: True'
  Write-Host 'RemotePushAfterReview    : True'
  Write-Host 'SchemaGenerated          : True'
  Write-Host 'SchemaReviewed           : False'
  Write-Host 'LabRehearsed             : False'
  Write-Host 'ProductionMigrationRun   : False'
  Write-Host 'ProductionRowsWritten    : 0'
  Write-Host 'ProductionWriteAuthorized: False'
  Write-Host 'RollbackAuthorized       : False'
} catch {
  if (-not $pushCompleted) {
    if ($commitCreated) {
      git reset --mixed $beforeHead 2>$null
    }
    Remove-GeneratedMigrationPaths -Paths @($generatedPaths)
    Remove-Item -LiteralPath $bundlePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $outDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  throw
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
