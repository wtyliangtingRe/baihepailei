param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [Parameter(Mandatory = $true)][string]$SchemaReviewBundle,
  [Parameter(Mandatory = $true)][string]$FailedLabDirectory,
  [string]$ExpectedAuditSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA',
  [string]$ExpectedSchemaReviewSHA256 = '297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-JsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText(
    $Path,
    ($json.TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-DirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $item = ([string]$line).Substring(3).Trim()
    if ($item -match ' -> ') { $item = ($item -split ' -> ')[-1].Trim() }
    $paths += $item.Replace('\', '/')
  }
  return @($paths)
}

function Assert-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "manifest 文件不存在：$($entry.file)"
    }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    $bytes = (Get-Item -LiteralPath $file).Length
    if ($bytes -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
}

foreach ($file in @($AuditBundle, $SchemaReviewBundle)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "找不到输入 ZIP：$file"
  }
}
if (-not (Test-Path -LiteralPath $FailedLabDirectory -PathType Container)) {
  throw "找不到失败演练目录：$FailedLabDirectory"
}

$auditPath = (Resolve-Path -LiteralPath $AuditBundle).Path
$schemaReviewPath = (Resolve-Path -LiteralPath $SchemaReviewBundle).Path
$failedLabPath = (Resolve-Path -LiteralPath $FailedLabDirectory).Path
$auditHash = (Get-FileHash -LiteralPath $auditPath -Algorithm SHA256).Hash
$schemaReviewHash = (Get-FileHash -LiteralPath $schemaReviewPath -Algorithm SHA256).Hash
if ($auditHash -ne $ExpectedAuditSHA256) { throw "最终审计 ZIP SHA-256 不匹配：$auditHash" }
if ($schemaReviewHash -ne $ExpectedSchemaReviewSHA256) { throw "Schema review ZIP SHA-256 不匹配：$schemaReviewHash" }

Write-Host ''
Write-Host '==> 锁定公共存储规范化版本' -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端更新失败。' }
git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '切换公共 Radar 分支失败。' }
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新公共 Radar 分支失败。' }
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $ExpectedBranchHead -or $remoteHead -ne $ExpectedBranchHead) {
  throw "存储规范化提交不符合预期：local=$localHead remote=$remoteHead"
}

$unexpectedDirty = @(Get-DirtyPaths | Where-Object { $AllowedDirtyFiles -notcontains $_ })
if (@($unexpectedDirty).Count -gt 0) {
  $unexpectedDirty | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '存在预期之外的本地修改；未生成存储规范化包。'
}

Write-Host ''
Write-Host '==> 运行公共存储规范化 parser 与回归测试' -ForegroundColor Cyan
node --check '.\scripts\radar\lib\public-conclusion-storage-v01.mjs'
if ($LASTEXITCODE -ne 0) { throw '公共存储规范化 library 语法检查失败。' }
node --check '.\scripts\radar\build-radar-public-storage-normalization-v01.mjs'
if ($LASTEXITCODE -ne 0) { throw '公共存储规范化 builder 语法检查失败。' }
node --test `
  '.\tests\radar-public-storage-normalization.test.mjs' `
  '.\tests\radar-public-conclusions-lab-rehearsal.test.mjs' `
  '.\tests\radar-public-conclusions.test.mjs'
if ($LASTEXITCODE -ne 0) { throw '公共存储规范化回归测试失败。' }

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-public-storage-normalization-' + [Guid]::NewGuid().ToString('N'))
$auditDir = Join-Path $tempRoot 'audit'
$schemaReviewDir = Join-Path $tempRoot 'schema-review'
New-Item -ItemType Directory -Path $auditDir, $schemaReviewDir -Force | Out-Null
Expand-Archive -LiteralPath $auditPath -DestinationPath $auditDir -Force
Expand-Archive -LiteralPath $schemaReviewPath -DestinationPath $schemaReviewDir -Force
Assert-Manifest $auditDir
Assert-Manifest $schemaReviewDir

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-public-storage-normalization-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-PUBLIC-STORAGE-NORMALIZATION-$stamp.zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

try {
  Write-Host ''
  Write-Host '==> 生成 9,000 条 storage-normalized 公共写入包' -ForegroundColor Cyan
  node '.\scripts\radar\build-radar-public-storage-normalization-v01.mjs' `
    --audit-dir $auditDir `
    --schema-review-dir $schemaReviewDir `
    --failed-lab-dir $failedLabPath `
    --audit-zip-sha256 $auditHash `
    --schema-review-zip-sha256 $schemaReviewHash `
    --out-dir $outDir
  if ($LASTEXITCODE -ne 0) { throw '公共存储规范化 builder 执行失败。' }

  $summaryPath = Join-Path $outDir 'radar-public-storage-normalization-summary.json'
  $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  $expectedGrades = [ordered]@{ S = 8; A = 267; B = 675; C = 868; D = 7032; E = 138; F = 12 }
  $actualGrades = [ordered]@{}
  foreach ($grade in @('S', 'A', 'B', 'C', 'D', 'E', 'F')) {
    $actualGrades[$grade] = [int]$summary.invariants.gradeCounts.$grade
  }
  if ($summary.normalization.rows -ne 9000 -or
      $summary.normalization.assessedAtChangedRows -ne 9000 -or
      $summary.normalization.conclusionHashChangedRows -ne 9000 -or
      $summary.normalization.unchangedBusinessFieldRows -ne 9000 -or
      $summary.invariants.uniquePublicationKeys -ne 9000 -or
      $summary.invariants.uniqueWorkIds -ne 9000 -or
      $summary.invariants.uniqueOldConclusionHashes -ne 9000 -or
      $summary.invariants.uniqueNewConclusionHashes -ne 9000 -or
      (($actualGrades | ConvertTo-Json -Compress) -ne ($expectedGrades | ConvertTo-Json -Compress)) -or
      $summary.invariants.businessAuditSuperseded -ne $false -or
      $summary.invariants.migrationDdlSuperseded -ne $false -or
      $summary.invariants.oldPublicWritePlanSuperseded -ne $true -or
      $summary.invariants.oldReadyFileMustNotBeWritten -ne $true -or
      $summary.safety.productionDatabaseWrite -ne $false -or
      $summary.safety.payloadWrite -ne $false -or
      $summary.safety.productionApplyAuthorized -ne $false -or
      $summary.readyForStoragePlanReview -ne $true) {
    throw '公共存储规范化摘要未达到固定门槛。'
  }

  $normalizedReadyPath = Join-Path $outDir 'public-ai-storage-ready.jsonl'
  $rewriteMapPath = Join-Path $outDir 'public-conclusion-storage-rewrite-map.jsonl'
  $storagePlanPath = Join-Path $outDir 'public-conclusions-storage-write-plan.jsonl'
  foreach ($file in @($normalizedReadyPath, $rewriteMapPath, $storagePlanPath)) {
    $lineCount = @(Get-Content -LiteralPath $file -Encoding UTF8).Count
    if ($lineCount -ne 9000) { throw "规范化输出行数不是 9000：$file ($lineCount)" }
  }

  Write-JsonFile -Path (Join-Path $outDir 'storage-normalization-run-validation.json') -Value ([ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    branch = $ExpectedBranch
    head = $localHead
    auditZipSha256 = $auditHash.ToLowerInvariant()
    schemaReviewZipSha256 = $schemaReviewHash.ToLowerInvariant()
    failedLabDirectory = [System.IO.Path]::GetFileName($failedLabPath)
    normalizedRows = 9000
    businessFieldsChanged = $false
    assessedAtChangedRows = 9000
    conclusionHashChangedRows = 9000
    oldDataPlanSuperseded = $true
    businessAuditSuperseded = $false
    migrationDdlSuperseded = $false
    payloadRead = $false
    payloadWrite = $false
    productionDatabaseRead = $false
    productionDatabaseWrite = $false
    migrationExecuted = $false
    schemaPush = $false
    productionApplyAuthorized = $false
    rollbackAuthorized = $false
  })

  $files = @(Get-ChildItem -LiteralPath $outDir -File | Where-Object { $_.Name -ne 'manifest.json' } | Sort-Object Name)
  $manifest = @($files | ForEach-Object {
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{ file = $_.Name; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
  })
  Write-JsonFile -Path (Join-Path $outDir 'manifest.json') -Value $manifest
  foreach ($entry in $manifest) {
    $file = Join-Path $outDir ([string]$entry.file)
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "最终规范化 manifest 校验失败：$($entry.file)"
    }
  }

  $paths = @((Get-ChildItem -LiteralPath $outDir -File | Sort-Object Name).FullName)
  Compress-Archive -LiteralPath $paths -DestinationPath $bundlePath -CompressionLevel Optimal -Force
  $bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

  Write-Host ''
  Write-Host 'Radar 公共存储规范化包生成完成' -ForegroundColor Green
  Write-Host "OutputDirectory             : $outDir"
  Write-Host "Bundle                      : $bundlePath"
  Write-Host "BundleSHA256                : $($bundleHash.Hash)"
  Write-Host "NormalizedReadySHA256       : $($summary.outputs.normalizedReadyFileSha256)"
  Write-Host "StorageWritePlanSHA256      : $($summary.outputs.storageWritePlanSha256)"
  Write-Host "RewriteMapSHA256            : $($summary.outputs.rewriteMapSha256)"
  Write-Host 'Rows                        : 9000'
  Write-Host 'BusinessFieldsChanged       : False'
  Write-Host 'AssessedAtChangedRows       : 9000'
  Write-Host 'ConclusionHashChangedRows   : 9000'
  Write-Host 'OldDataPlanSuperseded       : True'
  Write-Host 'BusinessAuditSuperseded     : False'
  Write-Host 'MigrationDdlSuperseded      : False'
  Write-Host 'ProductionDatabaseWrite     : False'
  Write-Host 'ProductionApplyAuthorized   : False'
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
