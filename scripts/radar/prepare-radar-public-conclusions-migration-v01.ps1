param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptPath = Join-Path $PSScriptRoot 'prepare-radar-public-conclusions-migration-v02.ps1'
$arguments = @(
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  $scriptPath
)
if ($CommitAndPush) {
  $arguments += '-CommitAndPush'
}

& pwsh @arguments
exit $LASTEXITCODE
