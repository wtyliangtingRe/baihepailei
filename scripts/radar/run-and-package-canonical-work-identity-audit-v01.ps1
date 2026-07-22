param(
  [Parameter(Mandatory = $true)][string]$DryRunV02Directory,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

$sourceDir = [System.IO.Path]::GetFullPath($DryRunV02Directory)
if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
  throw "找不到 v02 dry-run 目录：$sourceDir"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\canonical-work-identity-audit-$stamp"
$bundlePath = Join-Path $repoRoot "exports\CANONICAL-WORK-IDENTITY-AUDIT-$stamp.zip"
$auditScript = Join-Path $PSScriptRoot 'audit-canonical-work-identity-v01.ps1'
$summaryBuilder = Join-Path $PSScriptRoot 'build-canonical-work-identity-summary-v01.mjs'

pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File $auditScript `
  -DryRunV02Directory $sourceDir `
  -OutputDirectory $outDir `
  -PostgresContainer $PostgresContainer `
  -Database $Database `
  -DatabaseUser $DatabaseUser

if ($LASTEXITCODE -ne 0) {
  throw 'Canonical Work identity 只读数据库审计失败。'
}

node $summaryBuilder --directory $outDir
if ($LASTEXITCODE -ne 0) {
  throw 'Canonical Work identity 对比摘要生成失败。'
}

$requiredFiles = @(
  'input-identity-alerts.jsonl',
  'work-rows.jsonl',
  'relation-locators.json',
  'related-rows.jsonl',
  'version-relation-locators.json',
  'version-related-rows.jsonl',
  'validation.json',
  'summary.txt',
  'identity-comparison.json',
  'identity-comparison.md',
  'comparison-manifest.json'
)

$missing = @(
  $requiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $outDir $_) -PathType Leaf)
  }
)
if ($missing.Count -gt 0) {
  throw "Canonical identity 审计输出不完整：$($missing -join ', ')"
}

$validation = Get-Content `
  -LiteralPath (Join-Path $outDir 'validation.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 30

if ($validation.jsonValidated -ne $true) {
  throw 'Canonical identity JSON 校验未通过。'
}
if ($validation.transport -ne 'postgres_utf8_base64_to_powershell_utf8') {
  throw "未知传输方式：$($validation.transport)"
}
if ($validation.databaseWrite -ne $false -or $validation.payloadWrite -ne $false) {
  throw 'Canonical identity 审计未证明只读安全。'
}

$comparison = Get-Content `
  -LiteralPath (Join-Path $outDir 'identity-comparison.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100

if ($comparison.safety.canonicalDecisionApplied -ne $false) {
  throw '审计意外应用了 canonical 决定。'
}
if ($comparison.safety.mergePerformed -ne $false) {
  throw '审计意外执行了合并。'
}

$manifestEntries = @(
  Get-ChildItem -LiteralPath $outDir -File |
    Where-Object Name -ne 'manifest.json' |
    Sort-Object Name |
    ForEach-Object {
      $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
      [pscustomobject]@{
        file = $_.Name
        bytes = $_.Length
        sha256 = $hash.Hash.ToLowerInvariant()
      }
    }
)
[System.IO.File]::WriteAllText(
  (Join-Path $outDir 'manifest.json'),
  (($manifestEntries | ConvertTo-Json -Depth 20) + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)

$paths = @(
  Get-ChildItem -LiteralPath $outDir -File |
    Sort-Object Name |
    ForEach-Object FullName
)
Compress-Archive `
  -LiteralPath $paths `
  -DestinationPath $bundlePath `
  -CompressionLevel Optimal `
  -Force

$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Write-Host ''
Write-Host 'Canonical Work identity 只读审计与打包完成' -ForegroundColor Green
Write-Host "SourceDirectory        : $sourceDir"
Write-Host "OutputDirectory        : $outDir"
Write-Host "Bundle                 : $bundlePath"
Write-Host "SHA256                 : $($bundleHash.Hash)"
Write-Host "IdentityAlertGroups    : $($comparison.identityAlertGroups)"
Write-Host "WorkRows               : $($comparison.workRows)"
Write-Host "RelatedRows            : $($comparison.relatedRows)"
Write-Host "VersionRelatedRows     : $($comparison.versionRelatedRows)"
Write-Host ''
Write-Host 'DatabaseWrite          : False'
Write-Host 'PayloadWrite           : False'
Write-Host 'MigrationGeneration    : False'
Write-Host 'SchemaPush             : False'
Write-Host 'CanonicalDecision      : False'
Write-Host 'MergePerformed         : False'
