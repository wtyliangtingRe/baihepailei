param(
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\work-normalization-candidates-$stamp"
$bundlePath = Join-Path $repoRoot "exports\WORK-NORMALIZATION-CANDIDATES-$stamp.zip"
$auditScript = Join-Path $PSScriptRoot 'audit-work-normalization-candidates-v02.ps1'

& pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File $auditScript `
  -PostgresContainer $PostgresContainer `
  -Database $Database `
  -DatabaseUser $DatabaseUser `
  -OutputDirectory $outDir

if ($LASTEXITCODE -ne 0) {
  throw 'Work 规范化候选审计失败。'
}

$requiredFiles = @(
  'counts.json',
  'human-normalization-candidates.jsonl',
  'schema-retirement-exceptions.jsonl',
  'rank-retirement-candidates.jsonl',
  'validation.json',
  'manifest.json',
  'summary.txt'
)

$missingFiles = @(
  $requiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $outDir $_))
  }
)
if ($missingFiles.Count -gt 0) {
  throw "审计输出不完整：$($missingFiles -join ', ')"
}

$validation = Get-Content `
  -LiteralPath (Join-Path $outDir 'validation.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 20

if ($validation.jsonValidated -ne $true) {
  throw '审计 JSON 未通过有效性校验。'
}
if ($validation.transport -ne 'postgres_utf8_base64_to_powershell_utf8') {
  throw "未知审计传输方式：$($validation.transport)"
}

$paths = @(
  $requiredFiles | ForEach-Object { Join-Path $outDir $_ }
)
Compress-Archive `
  -LiteralPath $paths `
  -DestinationPath $bundlePath `
  -CompressionLevel Optimal `
  -Force

$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Write-Host ''
Write-Host 'Work 规范化候选审计与打包完成' -ForegroundColor Green
Write-Host "AuditDirectory : $outDir"
Write-Host "Bundle         : $bundlePath"
Write-Host "SHA256         : $($bundleHash.Hash)"
Write-Host 'UTF8Transport   : Verified'
Write-Host 'JsonValidation  : Passed'
Write-Host ''
Write-Host 'DatabaseWrite  : False'
Write-Host 'PayloadWrite   : False'
Write-Host 'MigrationRun   : False'
Write-Host 'SchemaPush     : False'
Write-Host 'TrackedFileWrite: False'
