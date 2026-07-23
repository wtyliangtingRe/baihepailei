param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [string]$ExpectedAuditSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA',
  [int]$WaveSize = 250
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
$branch = 'agent/radar-public-conclusions-v01'
$allowedDirty = @('next-env.d.ts', 'payload-types.ts')

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Test-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "缺少 manifest：$manifestPath" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "manifest 文件不存在：$($entry.file)" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $bytes = (Get-Item -LiteralPath $file).Length
    if ($hash -ne ([string]$entry.sha256).ToLowerInvariant() -or $bytes -ne [long]$entry.bytes) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
  return @($manifest).Count
}

Write-Host ''
Write-Host '==> 锁定 blocked ledger 版本' -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端更新失败。' }
git switch $branch
if ($LASTEXITCODE -ne 0) { throw '切换 PR #311 分支失败。' }
git pull --ff-only origin $branch
if ($LASTEXITCODE -ne 0) { throw '更新 PR #311 分支失败。' }
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$branch").Trim()
if ($localHead -ne $ExpectedBranchHead -or $remoteHead -ne $ExpectedBranchHead) {
  throw "blocked ledger HEAD 不符合预期：local=$localHead remote=$remoteHead"
}

$unexpectedDirty = @(
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $path = $path.Replace('\', '/')
    if ($allowedDirty -notcontains $path) { $path }
  }
)
if ($unexpectedDirty.Count -gt 0) { throw "存在预期之外的本地修改：$($unexpectedDirty -join ', ')" }

$auditPath = (Resolve-Path -LiteralPath $AuditBundle).Path
$auditHash = (Get-FileHash -LiteralPath $auditPath -Algorithm SHA256).Hash
if ($auditHash -ne $ExpectedAuditSHA256) { throw "最终审计 ZIP SHA-256 不匹配：$auditHash" }
if ($WaveSize -lt 1 -or $WaveSize -gt 1000) { throw "WaveSize 超出范围：$WaveSize" }

$builderPath = Join-Path $PSScriptRoot 'build-radar-blocked-ledger-v01.mjs'
$testPath = Join-Path $repoRoot 'tests\radar-blocked-ledger.test.mjs'
node --check $builderPath
if ($LASTEXITCODE -ne 0) { throw 'blocked ledger builder parser 失败。' }
node --test $testPath
if ($LASTEXITCODE -ne 0) { throw 'blocked ledger 回归测试失败。' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-blocked-ledger-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-BLOCKED-LEDGER-$stamp.zip"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-blocked-ledger-' + [Guid]::NewGuid().ToString('N'))
$auditDir = Join-Path $tempRoot 'audit'
New-Item -ItemType Directory -Path $auditDir, $outDir -Force | Out-Null

try {
  Write-Host ''
  Write-Host '==> 验证最终审计包并生成 1,805 条 ledger' -ForegroundColor Cyan
  Expand-Archive -LiteralPath $auditPath -DestinationPath $auditDir -Force
  $auditManifestFiles = Test-Manifest $auditDir

  & node $builderPath `
    --audit-dir $auditDir `
    --audit-zip-sha256 $auditHash `
    --out-dir $outDir `
    --wave-size $WaveSize
  if ($LASTEXITCODE -ne 0) { throw 'blocked ledger builder 执行失败。' }

  $ledgerManifestFiles = Test-Manifest $outDir
  $summaryPath = Join-Path $outDir 'radar-blocked-ledger-summary.json'
  $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if ($summary.ledger.rows -ne 1805 -or
      $summary.ledger.uniqueWorkIds -ne 1805 -or
      $summary.ledger.uniquePublicationKeys -ne 1805 -or
      $summary.source.privateBlockedRows -ne 1444 -or
      $summary.policy.currentSelection -ne 'latest_valid_complete_snapshot' -or
      $summary.policy.wholeSnapshotReplacement -ne $true -or
      $summary.policy.historyPreserved -ne $true -or
      $summary.policy.decisiveConflictBlocksPublicReady -ne $true -or
      $summary.safety.productionDatabaseWrite -ne $false -or
      $summary.safety.productionApplyAuthorized -ne $false) {
    throw 'blocked ledger summary 未满足固定门槛。'
  }

  Write-Json -Path (Join-Path $outDir 'blocked-ledger-run-validation.json') -Value ([ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    branch = $branch
    head = $localHead
    auditBundle = $auditPath
    auditBundleSha256 = $auditHash.ToLowerInvariant()
    auditManifestFiles = $auditManifestFiles
    ledgerManifestFilesBeforeValidation = $ledgerManifestFiles
    publicBlockedRows = 1805
    privateBlockedRows = 1444
    currentSelection = 'latest_valid_complete_snapshot'
    wholeSnapshotReplacement = $true
    historyPreserved = $true
    productionDatabaseWrite = $false
    payloadWrite = $false
    productionApplyAuthorized = $false
  })

  $files = @(Get-ChildItem -LiteralPath $outDir -File -Recurse | Where-Object { $_.Name -ne 'manifest.json' } | Sort-Object FullName)
  $manifestRows = @($files | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($outDir, $_.FullName).Replace('\', '/')
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{ file = $relative; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
  })
  Write-Json -Path (Join-Path $outDir 'manifest.json') -Value $manifestRows
  $finalManifestFiles = Test-Manifest $outDir

  $packRoot = Join-Path $tempRoot 'pack'
  New-Item -ItemType Directory -Path $packRoot -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $outDir '*') -Destination $packRoot -Recurse -Force
  Compress-Archive -Path (Join-Path $packRoot '*') -DestinationPath $bundlePath -CompressionLevel Optimal -Force
  if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) { throw 'blocked ledger ZIP 未生成。' }
  $bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

  Write-Host ''
  Write-Host 'Radar blocked ledger 与研究波次包生成完成' -ForegroundColor Green
  Write-Host "OutputDirectory             : $outDir"
  Write-Host "Bundle                      : $bundlePath"
  Write-Host "BundleSHA256                : $($bundleHash.Hash)"
  Write-Host 'PublicBlockedRows           : 1805'
  Write-Host 'PrivateBlockedRows          : 1444'
  Write-Host "ConflictQueueRows           : $($summary.ledger.conflictQueueRows)"
  Write-Host "Waves                       : $($summary.ledger.waves)"
  Write-Host "WaveSize                    : $($summary.ledger.waveSize)"
  Write-Host "ManifestFiles               : $finalManifestFiles"
  Write-Host 'CurrentSelection            : latest_valid_complete_snapshot'
  Write-Host 'WholeSnapshotReplacement    : True'
  Write-Host 'HistoryPreserved            : True'
  Write-Host 'ProductionDatabaseWrite     : False'
  Write-Host 'ProductionApplyAuthorized   : False'
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
