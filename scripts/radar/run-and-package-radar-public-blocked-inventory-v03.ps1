param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [Parameter(Mandatory = $true)][string]$ProductionReceiptBundle,
  [string]$ExpectedAuditSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA',
  [string]$ExpectedProductionReceiptSHA256 = 'D1E8114371926C1CDA07D91DD2DB730180D5830ACF691D7CCC6F65DE84CBE6CA',
  [string]$PostgresContainer = 'baihepailei-postgres',
  [int]$Port = 3101,
  [int]$ReadyTimeoutSeconds = 240,
  [int]$WaveSize = 250
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
$innerRunner = Join-Path $PSScriptRoot 'run-and-package-radar-public-blocked-inventory-v02.ps1'
$finalizer = Join-Path $PSScriptRoot 'finalize-radar-public-blocked-remediation-waves-v01.mjs'
$testPath = Join-Path $repoRoot 'tests\radar-public-blocked-inventory.test.mjs'

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-DirectorySet([string]$Pattern) {
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter $Pattern -ErrorAction SilentlyContinue |
    ForEach-Object { $null = $set.Add($_.FullName) }
  return $set
}

function Get-NewDirectory([string]$Pattern, [System.Collections.Generic.HashSet[string]]$Before) {
  $items = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter $Pattern -ErrorAction SilentlyContinue |
    Where-Object { -not $Before.Contains($_.FullName) } |
    Sort-Object LastWriteTimeUtc -Descending)
  if ($items.Count -ne 1) { throw "预期恰好一个新目录 $Pattern，实际：$($items.Count)" }
  return $items[0].FullName
}

function Test-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "缺少 manifest：$manifestPath" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "manifest 文件不存在：$($entry.file)" }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.bytes -or
        $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
  return @($manifest).Count
}

foreach ($item in @($innerRunner, $finalizer, $testPath)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { throw "缺少 blocked remediation 活动文件：$item" }
}
if ($WaveSize -lt 1 -or $WaveSize -gt 1000) { throw "WaveSize 超出范围：$WaveSize" }

& node --check $finalizer
if ($LASTEXITCODE -ne 0) { throw 'Blocked remediation finalizer parser 检查失败。' }
foreach ($item in @($innerRunner, $PSCommandPath)) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($item, [ref]$tokens, [ref]$errors) | Out-Null
  if (@($errors).Count -gt 0) {
    $errors | Format-List
    throw "Blocked remediation PowerShell parser 检查失败：$item"
  }
}
& node --test $testPath
if ($LASTEXITCODE -ne 0) { throw 'Blocked remediation 回归测试失败。' }

$before = Get-DirectorySet 'radar-public-blocked-inventory-*'
& $innerRunner `
  -ExpectedBranchHead $ExpectedBranchHead `
  -AuditBundle $AuditBundle `
  -ProductionReceiptBundle $ProductionReceiptBundle `
  -ExpectedAuditSHA256 $ExpectedAuditSHA256 `
  -ExpectedProductionReceiptSHA256 $ExpectedProductionReceiptSHA256 `
  -PostgresContainer $PostgresContainer `
  -Port $Port `
  -ReadyTimeoutSeconds $ReadyTimeoutSeconds
if ($LASTEXITCODE -ne 0) { throw 'Blocked inventory v02 runner 执行失败。' }

$outDir = Get-NewDirectory 'radar-public-blocked-inventory-*' $before
$stamp = (Split-Path $outDir -Leaf).Replace('radar-public-blocked-inventory-', '')
$inventoryBundle = Join-Path $repoRoot "exports\RADAR-PUBLIC-BLOCKED-INVENTORY-$stamp.zip"
$finalBundle = Join-Path $repoRoot "exports\RADAR-PUBLIC-BLOCKED-REMEDIATION-$stamp.zip"
$remediationDir = Join-Path $outDir 'remediation'

Write-Host ''
Write-Host '==> 按 latest-valid-complete 规则生成最终 ledger 与研究波次' -ForegroundColor Cyan
& node $finalizer `
  --inventory-dir $outDir `
  --out-dir $remediationDir `
  --wave-size $WaveSize
if ($LASTEXITCODE -ne 0) { throw 'Blocked remediation finalizer 执行失败。' }

$remediationManifestFiles = Test-Manifest $remediationDir
$summaryPath = Join-Path $remediationDir 'radar-public-blocked-remediation-summary.json'
$summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($summary.ledger.rows -ne 1805 -or
    $summary.ledger.uniqueWorkIds -ne 1805 -or
    $summary.ledger.uniquePublicationKeys -ne 1805 -or
    $summary.currentProductionPublicBaseline -ne 9000 -or
    $summary.conflictPolicy.currentSelection -ne 'latest_valid_complete_identity_resolved' -or
    $summary.conflictPolicy.wholeSnapshotReplacement -ne $true -or
    $summary.conflictPolicy.explicitNullClearsOldValue -ne $true -or
    $summary.conflictPolicy.fieldResidualMergeForbidden -ne $true -or
    $summary.conflictPolicy.decisiveConflictsRemainBlocked -ne $true -or
    $summary.conflictPolicy.historicalCandidatesPreserved -ne $true -or
    $summary.safety.productionDatabaseWrite -ne $false -or
    $summary.safety.productionApplyAuthorized -ne $false) {
  throw 'Blocked remediation summary 未满足固定门槛。'
}

Write-Json -Path (Join-Path $outDir 'blocked-remediation-finalization.json') -Value ([ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  branchHead = $ExpectedBranchHead
  sourceInventoryBundle = $inventoryBundle
  sourceInventoryBundleSupersededByFinalBundle = $true
  remediationManifestFiles = $remediationManifestFiles
  rows = 1805
  currentPublicBaseline = 9000
  waveSize = $summary.ledger.waveSize
  waves = $summary.ledger.waves
  currentSelection = 'latest_valid_complete_identity_resolved'
  wholeSnapshotReplacement = $true
  explicitNullClearsOldValue = $true
  fieldResidualMergeForbidden = $true
  historyPreserved = $true
  decisiveConflictsRemainBlocked = $true
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

$packRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-blocked-remediation-pack-' + [Guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $packRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $outDir -Force | Copy-Item -Destination $packRoot -Recurse -Force
  Compress-Archive -Path (Join-Path $packRoot '*') -DestinationPath $finalBundle -CompressionLevel Optimal -Force
} finally {
  Remove-Item -LiteralPath $packRoot -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path -LiteralPath $finalBundle -PathType Leaf)) { throw 'Blocked remediation final ZIP 未生成。' }
$finalHash = Get-FileHash -LiteralPath $finalBundle -Algorithm SHA256
if (Test-Path -LiteralPath $inventoryBundle -PathType Leaf) {
  Remove-Item -LiteralPath $inventoryBundle -Force
}

Write-Host ''
Write-Host 'Radar 1,805 条 blocked live inventory 与研究波次已完成' -ForegroundColor Green
Write-Host "OutputDirectory                 : $outDir"
Write-Host "Bundle                          : $finalBundle"
Write-Host "BundleSHA256                    : $($finalHash.Hash)"
Write-Host 'BlockedRows                     : 1805'
Write-Host 'CurrentPublicBaseline           : 9000'
Write-Host "LatestValidComplete             : $($summary.ledger.latestValidComplete)"
Write-Host "LatestStructurallyIncomplete    : $($summary.ledger.latestStructurallyValidIncomplete)"
Write-Host "LatestAvailableInvalid          : $($summary.ledger.latestAvailableInvalid)"
Write-Host "MissingCandidate                : $($summary.ledger.missingCandidate)"
Write-Host "WithConflicts                   : $($summary.ledger.withConflicts)"
Write-Host "WithDecisiveConflicts           : $($summary.ledger.withDecisiveConflicts)"
Write-Host "Waves                           : $($summary.ledger.waves)"
Write-Host "WaveSize                        : $($summary.ledger.waveSize)"
Write-Host "ManifestFiles                   : $finalManifestFiles"
Write-Host 'WholeSnapshotReplacement        : True'
Write-Host 'ExplicitNullClearsOldValue       : True'
Write-Host 'FieldResidualMergeForbidden      : True'
Write-Host 'HistoryPreserved                 : True'
Write-Host 'PayloadWrite                    : False'
Write-Host 'PostgreSQLWrite                 : False'
Write-Host 'ProductionApplyAuthorized       : False'
