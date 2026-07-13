param(
  [string]$BackupRoot = "D:\Baihepailei-backups",
  [switch]$IncludeSecrets
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-DotEnvValue {
  param(
    [string]$FilePath,
    [string]$Key
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $FilePath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
      continue
    }

    $separator = $trimmed.IndexOf('=')
    $name = $trimmed.Substring(0, $separator).Trim()
    if ($name -ne $Key) {
      continue
    }

    $value = $trimmed.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    return $value
  }

  return $null
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$connectionKeys = @('DATABASE_URL', 'DATABASE_URI')
$envFiles = @(
  (Join-Path $repoRoot '.env.development.local'),
  (Join-Path $repoRoot '.env.local'),
  (Join-Path $repoRoot '.env.development'),
  (Join-Path $repoRoot '.env')
)

$databaseConnection = $null
$connectionSource = $null

foreach ($key in $connectionKeys) {
  $candidate = [Environment]::GetEnvironmentVariable($key, 'Process')
  if ($candidate) {
    $databaseConnection = $candidate
    $connectionSource = "process:$key"
    break
  }
}

if (-not $databaseConnection) {
  foreach ($file in $envFiles) {
    foreach ($key in $connectionKeys) {
      $candidate = Get-DotEnvValue -FilePath $file -Key $key
      if ($candidate) {
        $databaseConnection = $candidate
        $connectionSource = "file:$([System.IO.Path]::GetFileName($file)):$key"
        break
      }
    }
    if ($databaseConnection) {
      break
    }
  }
}

if (-not $databaseConnection) {
  $checkedFiles = ($envFiles | ForEach-Object { [System.IO.Path]::GetFileName($_) }) -join ', '
  throw "Database connection not found. Checked process variables DATABASE_URL/DATABASE_URI and files: $checkedFiles"
}

$checkpointScript = Join-Path $PSScriptRoot 'create-local-checkpoint.ps1'
if (-not (Test-Path -LiteralPath $checkpointScript)) {
  throw "Checkpoint script not found: $checkpointScript"
}

$hadPreviousDatabaseUri = Test-Path Env:DATABASE_URI
$previousDatabaseUri = if ($hadPreviousDatabaseUri) { $env:DATABASE_URI } else { $null }

try {
  # The existing checkpoint implementation consumes DATABASE_URI. Bridge the
  # project's canonical DATABASE_URL without ever printing the secret value.
  $env:DATABASE_URI = $databaseConnection
  Write-Host "Database connection resolved from $connectionSource" -ForegroundColor DarkGray

  & $checkpointScript `
    -BackupRoot $BackupRoot `
    -IncludeDatabase `
    -IncludeSecrets:$IncludeSecrets
}
finally {
  if ($hadPreviousDatabaseUri) {
    $env:DATABASE_URI = $previousDatabaseUri
  }
  else {
    Remove-Item Env:DATABASE_URI -ErrorAction SilentlyContinue
  }
}
