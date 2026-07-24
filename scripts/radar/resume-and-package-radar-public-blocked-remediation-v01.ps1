param(
  [Parameter(Mandatory = $true)][string]$ExpectedCurrentBranchHead,
  [Parameter(Mandatory = $true)][string]$InventoryDirectory,
  [Parameter(Mandatory = $true)][string]$InventoryBundle,
  [string]$ExpectedInventoryBundleSHA256 = 'B6825AC48D27B6F8C319CC6E685AD0EA8AAC411D8C2C0ABAF52946D8C23F9121',
  [string]$SourceInventoryBranchHead = '6d5c2e741e9ad7b345fc5ff9c8fd16875eaee9fa',
  [int]$WaveSize = 250
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exportsRoot = (Resolve-Path (Join-Path $repoRoot 'exports')).Path
Set-Location -LiteralPath $repoRoot

$finalizer = Join-Path $PSScriptRoot 'finalize-radar-public-blocked-remediation-waves-v01.mjs'
$testPath = Join-Path $repoRoot 'tests\radar-public-blocked-remediation-resume.test.mjs'

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Test-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest：$manifestPath"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "manifest 文件不存在：$($entry.file)"
    }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.bytes -or
        $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
  return @($manifest).Count
}

foreach ($item in @($finalizer, $testPath)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) {
    throw "缺少 blocked remediation resume 活动文件：$item"
  }
}
if ($WaveSize -lt 1 -or $WaveSize -gt 1000) {
  throw "WaveSize 超出范围：$WaveSize"
}

& node --check $finalizer
if ($LASTEXITCODE -ne 0) {
  throw 'Blocked remediation finalizer parser 检查失败。'
}
& node --test $testPath
if ($LASTEXITCODE -ne 0) {
  throw 'Blocked remediation resume 回归测试失败。'
}

$currentHead = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $currentHead -ne $ExpectedCurrentBranchHead) {
  throw "当前分支 HEAD 不符合预期：$currentHead"
}

$outDir = (Resolve-Path -LiteralPath $InventoryDirectory).Path
$inventoryBundlePath = (Resolve-Path -LiteralPath $InventoryBundle).Path
if (-not $outDir.StartsWith($exportsRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "InventoryDirectory 必须位于 exports 下：$outDir"
}
if (-not $inventoryBundlePath.StartsWith($exportsRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "InventoryBundle 必须位于 exports 下：$inventoryBundlePath"
}

$leaf = Split-Path $outDir -Leaf
if ($leaf -notmatch '^radar-public-blocked-inventory-(\d{8}-\d{6})$') {
  throw "InventoryDirectory 名称不符合固定格式：$leaf"
}
$stamp = $Matches[1]
$expectedBundleName = "RADAR-PUBLIC-BLOCKED-INVENTORY-$stamp.zip"
if ((Split-Path $inventoryBundlePath -Leaf) -ne $expectedBundleName) {
  throw "InventoryBundle 与目录时间戳不一致：$inventoryBundlePath"
}

$inventoryHash = Get-FileHash -LiteralPath $inventoryBundlePath -Algorithm SHA256
if ($inventoryHash.Hash.ToUpperInvariant() -ne $ExpectedInventoryBundleSHA256.ToUpperInvariant()) {
  throw "InventoryBundle SHA-256 不匹配：$($inventoryHash.Hash)"
}

$sourceManifestFiles = Test-Manifest $outDir
$sourceSummaryPath = Join-Path $outDir 'radar-public-blocked-inventory-summary.json'
$sourceInventoryPath = Join-Path $outDir 'radar-public-blocked-inventory.jsonl'
foreach ($item in @($sourceSummaryPath, $sourceInventoryPath)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) {
    throw "Inventory 缺少必要文件：$item"
  }
}
$sourceSummary = Get-Content -LiteralPath $sourceSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$inventoryRows = 0
foreach ($line in [System.IO.File]::ReadLines($sourceInventoryPath)) {
  if (-not [string]::IsNullOrWhiteSpace($line)) { $inventoryRows += 1 }
}
if ($inventoryRows -ne 1805 -or
    $sourceSummary.inventory.rows -ne 1805 -or
    $sourceSummary.inventory.uniqueWorkIds -ne 1805 -or
    $sourceSummary.currentProduction.currentPublicConclusionsRead -ne 9000 -or
    @($sourceSummary.globalBlockers).Count -ne 0 -or
    $sourceSummary.readyForRemediationPlanning -ne $true -or
    $sourceSummary.safety.payloadWrite -ne $false -or
    $sourceSummary.safety.directPostgresqlWrite -ne $false -or
    $sourceSummary.safety.productionApplyAuthorized -ne $false) {
  throw '现有 blocked inventory 未满足续跑固定门槛。'
}

$remediationDir = Join-Path $outDir 'remediation'
if (Test-Path -LiteralPath $remediationDir) {
  throw "目标 remediation 目录已经存在；为避免覆盖，请先人工核查：$remediationDir"
}
$finalBundle = Join-Path $exportsRoot "RADAR-PUBLIC-BLOCKED-REMEDIATION-$stamp.zip"
if (Test-Path -LiteralPath $finalBundle) {
  throw "最终 ZIP 已存在；为避免覆盖，请先人工核查：$finalBundle"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-blocked-remediation-resume-' + [Guid]::NewGuid().ToString('N'))
$tempRemediation = Join-Path $tempRoot 'remediation'
$packRoot = Join-Path $tempRoot 'pack'
try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

  Write-Host ''
  Write-Host '==> 复用已完成的 1,805 条 inventory，生成 latest-wins ledger 与研究波次' -ForegroundColor Cyan
  & node $finalizer `
    --inventory-dir $outDir `
    --out-dir $tempRemediation `
    --wave-size $WaveSize
  if ($LASTEXITCODE -ne 0) {
    throw 'Blocked remediation finalizer 执行失败。'
  }

  $remediationManifestFiles = Test-Manifest $tempRemediation
  $summaryPath = Join-Path $tempRemediation 'radar-public-blocked-remediation-summary.json'
  $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if ($summary.ledger.rows -ne 1805 -or
      $summary.ledger.uniqueWorkIds -ne 1805 -or
      $summary.ledger.uniquePublicationKeys -ne 1805 -or
      $summary.currentProductionPublicBaseline -ne 9000 -or
      $summary.conflictPolicy.currentSelection -ne 'latest_structurally_valid_identity_resolved' -or
      $summary.conflictPolicy.newestStructurallyValidWins -ne $true -or
      $summary.conflictPolicy.olderCompleteCannotOverrideNewerStructurallyValid -ne $true -or
      $summary.conflictPolicy.wholeSnapshotReplacement -ne $true -or
      $summary.conflictPolicy.explicitNullClearsOldValue -ne $true -or
      $summary.conflictPolicy.fieldResidualMergeForbidden -ne $true -or
      $summary.conflictPolicy.decisiveConflictsBlockLatestSelection -ne $false -or
      $summary.conflictPolicy.decisiveConflictsOverwrittenByLatest -ne $true -or
      $summary.conflictPolicy.historicalCandidatesPreserved -ne $true -or
      $summary.conflictPolicy.hardInvalidCandidatesRemainBlocked -ne $true -or
      $summary.safety.productionDatabaseWrite -ne $false -or
      $summary.safety.productionApplyAuthorized -ne $false) {
    throw 'Blocked remediation summary 未满足 latest-wins 固定门槛。'
  }

  Move-Item -LiteralPath $tempRemediation -Destination $remediationDir

  Write-Json -Path (Join-Path $outDir 'blocked-remediation-finalization.json') -Value ([ordered]@{
    schemaVersion = 3
    generatedAt = [DateTime]::UtcNow.ToString('o')
    sourceInventoryBranchHead = $SourceInventoryBranchHead
    finalizerBranchHead = $ExpectedCurrentBranchHead
    sourceInventoryDirectory = $outDir
    sourceInventoryBundle = $inventoryBundlePath
    sourceInventoryBundleSha256 = $inventoryHash.Hash.ToLowerInvariant()
    sourceInventoryBundleSupersededByFinalBundle = $true
    sourceManifestFiles = $sourceManifestFiles
    remediationManifestFiles = $remediationManifestFiles
    resumedAfterDirectorySetNullBug = $true
    rows = 1805
    currentPublicBaseline = 9000
    waveSize = $summary.ledger.waveSize
    waves = $summary.ledger.waves
    currentSelection = 'latest_structurally_valid_identity_resolved'
    newestStructurallyValidWins = $true
    olderCompleteCannotOverrideNewerStructurallyValid = $true
    wholeSnapshotReplacement = $true
    explicitNullClearsOldValue = $true
    fieldResidualMergeForbidden = $true
    historyPreserved = $true
    decisiveConflictsBlockLatestSelection = $false
    decisiveConflictsOverwrittenByLatest = $true
    hardInvalidCandidatesRemainBlocked = $true
    payloadWrite = $false
    directPostgresqlWrite = $false
    productionDatabaseWrite = $false
    productionApplyAuthorized = $false
  })

  $rootManifestFiles = @(Get-ChildItem -LiteralPath $outDir -File -Recurse |
    Where-Object { -not ($_.Name -eq 'manifest.json' -and $_.DirectoryName -eq $outDir) } |
    Sort-Object FullName)
  $rootManifest = @($rootManifestFiles | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($outDir, $_.FullName).Replace('\', '/')
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{ file = $relative; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
  })
  Write-Json -Path (Join-Path $outDir 'manifest.json') -Value $rootManifest
  $finalManifestFiles = Test-Manifest $outDir

  New-Item -ItemType Directory -Path $packRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $outDir -Force | Copy-Item -Destination $packRoot -Recurse -Force
  Compress-Archive -Path (Join-Path $packRoot '*') -DestinationPath $finalBundle -CompressionLevel Optimal
  if (-not (Test-Path -LiteralPath $finalBundle -PathType Leaf)) {
    throw 'Blocked remediation final ZIP 未生成。'
  }
  $finalHash = Get-FileHash -LiteralPath $finalBundle -Algorithm SHA256

  Remove-Item -LiteralPath $inventoryBundlePath -Force

  Write-Host ''
  Write-Host 'Radar 1,805 条 blocked inventory 已续跑完成，无需重新读取 Payload' -ForegroundColor Green
  Write-Host "OutputDirectory                     : $outDir"
  Write-Host "Bundle                              : $finalBundle"
  Write-Host "BundleSHA256                        : $($finalHash.Hash)"
  Write-Host 'BlockedRows                         : 1805'
  Write-Host 'CurrentPublicBaseline               : 9000'
  Write-Host "LatestStructurallyValidComplete     : $($summary.ledger.latestStructurallyValidComplete)"
  Write-Host "LatestStructurallyValidIncomplete   : $($summary.ledger.latestStructurallyValidIncomplete)"
  Write-Host "LatestAvailableInvalid              : $($summary.ledger.latestAvailableInvalid)"
  Write-Host "MissingCandidate                    : $($summary.ledger.missingCandidate)"
  Write-Host "WithConflicts                       : $($summary.ledger.withConflicts)"
  Write-Host "WithDecisiveConflicts               : $($summary.ledger.withDecisiveConflicts)"
  Write-Host "DecisiveConflictsOverwritten        : $($summary.ledger.decisiveConflictsOverwrittenByLatest)"
  Write-Host "Waves                               : $($summary.ledger.waves)"
  Write-Host "WaveSize                            : $($summary.ledger.waveSize)"
  Write-Host "ManifestFiles                       : $finalManifestFiles"
  Write-Host 'PayloadRead                         : False'
  Write-Host 'PayloadWrite                        : False'
  Write-Host 'PostgreSQLRead                      : False'
  Write-Host 'PostgreSQLWrite                     : False'
  Write-Host 'ProductionApplyAuthorized           : False'
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
