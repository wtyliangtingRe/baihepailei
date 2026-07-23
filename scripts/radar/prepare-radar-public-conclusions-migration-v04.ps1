param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$originalScriptRoot = $PSScriptRoot
$sourcePath = Join-Path $originalScriptRoot 'prepare-radar-public-conclusions-migration-v02.ps1'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Missing v02 migration preparer: $sourcePath"
}

$content = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8
$content = $content.Replace("`r`n", "`n")

function Replace-Exact {
  param(
    [Parameter(Mandatory = $true)][string]$Needle,
    [Parameter(Mandatory = $true)][string]$Replacement,
    [Parameter(Mandatory = $true)][int]$ExpectedCount
  )

  $actualCount = ([regex]::Matches($script:content, [regex]::Escape($Needle))).Count
  if ($actualCount -ne $ExpectedCount) {
    throw "Expected $ExpectedCount occurrence(s), found ${actualCount}: $Needle"
  }
  $script:content = $script:content.Replace($Needle, $Replacement)
}

Replace-Exact `
  -Needle '[Parameter(Mandatory = $true)][object[]]$Before,' `
  -Replacement '[Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,' `
  -ExpectedCount 2

Replace-Exact `
  -Needle '[Parameter(Mandatory = $true)][object[]]$After' `
  -Replacement '[Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After' `
  -ExpectedCount 2

Replace-Exact `
  -Needle '$PayloadMigrationDirEnvName = ''PAYLOAD_MIGRATION_DIR''' `
  -Replacement @'
$PayloadMigrationDirEnvName = 'PAYLOAD_MIGRATION_DIR'
$PayloadDbPushEnvName = 'PAYLOAD_DB_PUSH'
'@.TrimEnd() `
  -ExpectedCount 1

Replace-Exact `
  -Needle "Set-Location (Resolve-Path (Join-Path `$PSScriptRoot '..\..'))" `
  -Replacement "Set-Location (Resolve-Path (Join-Path `$env:RADAR_MIGRATION_SOURCE_ROOT '..\..'))" `
  -ExpectedCount 1

$isolatedConfigNeedle = @'
  $isolated = $source.Replace($anchor, $replacement)
  [System.IO.File]::WriteAllText(
'@.TrimEnd()
$isolatedConfigReplacement = @'
  $isolated = $source.Replace($anchor, $replacement)
  $poolAnchor = '    pool: {'
  $poolMatches = [regex]::Matches($isolated, [regex]::Escape($poolAnchor))
  if ($poolMatches.Count -ne 1) {
    throw "无法唯一定位 PostgreSQL pool 配置：$($poolMatches.Count)"
  }
  $poolReplacement = @(
    '    pool: {',
    "      options: '-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning',"
  ) -join "`n"
  $isolated = $isolated.Replace($poolAnchor, $poolReplacement)
  [System.IO.File]::WriteAllText(
'@.TrimEnd()
Replace-Exact `
  -Needle $isolatedConfigNeedle `
  -Replacement $isolatedConfigReplacement `
  -ExpectedCount 1

$configValidationNeedle = @'
  if ($written -notmatch [regex]::Escape($PayloadMigrationDirEnvName)) {
    throw '隔离 Payload 配置没有写入临时 migrationDir。'
  }
'@.TrimEnd()
$configValidationReplacement = @'
  if ($written -notmatch [regex]::Escape($PayloadMigrationDirEnvName)) {
    throw '隔离 Payload 配置没有写入临时 migrationDir。'
  }
  if ($written -notmatch 'default_transaction_read_only=on') {
    throw '隔离 Payload 配置没有强制 PostgreSQL 只读会话。'
  }
'@.TrimEnd()
Replace-Exact `
  -Needle $configValidationNeedle `
  -Replacement $configValidationReplacement `
  -ExpectedCount 1

$baselineEnvironmentNeedle = @'
  Invoke-WithProcessEnvironment -Variables @{
    $PayloadConfigEnvName = $temporaryConfigPath
    $PayloadMigrationDirEnvName = $temporaryMigrationDirectory
    $RadarSchemaEnvName = 'false'
'@.TrimEnd()
$baselineEnvironmentReplacement = @'
  Invoke-WithProcessEnvironment -Variables @{
    $PayloadConfigEnvName = $temporaryConfigPath
    $PayloadMigrationDirEnvName = $temporaryMigrationDirectory
    $PayloadDbPushEnvName = 'false'
    $RadarSchemaEnvName = 'false'
'@.TrimEnd()
Replace-Exact `
  -Needle $baselineEnvironmentNeedle `
  -Replacement $baselineEnvironmentReplacement `
  -ExpectedCount 1

$radarEnvironmentNeedle = @'
  if (Test-Path -LiteralPath $temporaryConfigPath) {
    Remove-Item -LiteralPath $temporaryConfigPath -Force
  }

  Invoke-WithProcessEnvironment -Variables @{
    $PayloadConfigEnvName = $payloadConfigPath
    $RadarSchemaEnvName = 'true'
'@.TrimEnd()
$radarEnvironmentReplacement = @'
  Invoke-WithProcessEnvironment -Variables @{
    $PayloadConfigEnvName = $temporaryConfigPath
    $PayloadMigrationDirEnvName = $repositoryMigrationPath
    $PayloadDbPushEnvName = 'false'
    $RadarSchemaEnvName = 'true'
'@.TrimEnd()
Replace-Exact `
  -Needle $radarEnvironmentNeedle `
  -Replacement $radarEnvironmentReplacement `
  -ExpectedCount 1

$afterRadarNeedle = @'
  }

  $afterMigrationRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
'@.TrimEnd()
$afterRadarReplacement = @'
  }

  if (Test-Path -LiteralPath $temporaryConfigPath) {
    Remove-Item -LiteralPath $temporaryConfigPath -Force
  }

  $afterMigrationRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
'@.TrimEnd()
Replace-Exact `
  -Needle $afterRadarNeedle `
  -Replacement $afterRadarReplacement `
  -ExpectedCount 1

$temporaryPath = Join-Path ([System.IO.Path]::GetTempPath()) (
  'prepare-radar-public-conclusions-migration-v04-' + [guid]::NewGuid().ToString('N') + '.ps1'
)
$savedRootExists = Test-Path 'Env:RADAR_MIGRATION_SOURCE_ROOT'
$savedRoot = [Environment]::GetEnvironmentVariable('RADAR_MIGRATION_SOURCE_ROOT', 'Process')

try {
  [System.IO.File]::WriteAllText(
    $temporaryPath,
    $content,
    [System.Text.UTF8Encoding]::new($false)
  )

  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $temporaryPath,
    [ref]$tokens,
    [ref]$parseErrors
  ) | Out-Null
  if (@($parseErrors).Count -gt 0) {
    $parseErrors | Format-List
    throw 'Patched v04 migration preparer failed PowerShell syntax validation.'
  }

  [Environment]::SetEnvironmentVariable('RADAR_MIGRATION_SOURCE_ROOT', $originalScriptRoot, 'Process')
  $forward = @{}
  if ($CommitAndPush) { $forward.CommitAndPush = $true }
  & $temporaryPath @forward
  if ($LASTEXITCODE -ne 0) {
    throw "Patched v04 migration preparer failed with exit code $LASTEXITCODE."
  }
} finally {
  if ($savedRootExists) {
    [Environment]::SetEnvironmentVariable('RADAR_MIGRATION_SOURCE_ROOT', $savedRoot, 'Process')
  } else {
    [Environment]::SetEnvironmentVariable('RADAR_MIGRATION_SOURCE_ROOT', $null, 'Process')
  }
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
}
