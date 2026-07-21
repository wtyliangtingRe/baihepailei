param(
  [int]$Port = 3100
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Port -ne 3100) {
  throw 'The Radar version-roundtrip lab server must use port 3100.'
}

$labUri = [Environment]::GetEnvironmentVariable('RADAR_LAB_DATABASE_URI', 'Process')
if ([string]::IsNullOrWhiteSpace($labUri)) {
  throw 'RADAR_LAB_DATABASE_URI is required in the child process environment.'
}

$parsed = [System.Uri]$labUri
$databaseName = $parsed.AbsolutePath.Trim('/')
if ($databaseName -notmatch '^baihepailei_radar_lab_[a-z0-9_]+$') {
  throw 'RADAR_LAB_DATABASE_URI does not target an approved lab database name.'
}

$env:DATABASE_URI = $labUri
$env:NEXT_PUBLIC_SERVER_URL = "http://127.0.0.1:$Port"
Remove-Item Env:RADAR_LAB_DATABASE_URI -ErrorAction SilentlyContinue
$labUri = $null

Write-Host "Starting isolated Radar lab server on http://127.0.0.1:$Port" -ForegroundColor Yellow
Write-Host "Lab database name: $databaseName"
Write-Host 'Database credentials printed: False'

pnpm exec next dev --port $Port
