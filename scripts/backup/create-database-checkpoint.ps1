param(
  [string]$BackupRoot = "D:\Baihepailei-backups",
  [switch]$IncludeSecrets
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script = Join-Path $PSScriptRoot 'create-local-checkpoint.ps1'
if (-not (Test-Path -LiteralPath $script)) {
  throw "Checkpoint implementation not found: $script"
}

$arguments = @{
  BackupRoot = $BackupRoot
  IncludeDatabase = $true
}
if ($IncludeSecrets) {
  $arguments.IncludeSecrets = $true
}

& $script @arguments
