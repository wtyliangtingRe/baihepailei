param(
  [string]$BackupRoot = "D:\Baihepailei-backups",
  [switch]$IncludeSecrets,
  [string]$PostgresContainer = 'baihepailei-postgres'
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

function Find-LocalPgDump {
  $command = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command pg_dump -ErrorAction SilentlyContinue
  }
  if ($command) {
    return $command.Source
  }

  $patterns = @()
  if ($env:ProgramFiles) {
    $patterns += (Join-Path $env:ProgramFiles 'PostgreSQL\*\bin\pg_dump.exe')
  }
  if (${env:ProgramFiles(x86)}) {
    $patterns += (Join-Path ${env:ProgramFiles(x86)} 'PostgreSQL\*\bin\pg_dump.exe')
  }
  if ($env:USERPROFILE) {
    $patterns += (Join-Path $env:USERPROFILE 'scoop\apps\postgresql*\current\bin\pg_dump.exe')
    $patterns += (Join-Path $env:USERPROFILE 'scoop\apps\postgresql*\*\bin\pg_dump.exe')
  }
  if ($env:ChocolateyInstall) {
    $patterns += (Join-Path $env:ChocolateyInstall 'bin\pg_dump.exe')
    $patterns += (Join-Path $env:ChocolateyInstall 'lib\postgresql*\tools\*\bin\pg_dump.exe')
  }

  $matches = foreach ($pattern in $patterns) {
    Get-Item -Path $pattern -ErrorAction SilentlyContinue
  }

  return $matches |
    Where-Object { $_ -and -not $_.PSIsContainer } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

function Test-RunningContainer {
  param([string]$Name)

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    return $false
  }

  $running = (& $docker.Source inspect --format '{{.State.Running}}' $Name 2>$null | Out-String).Trim()
  return $LASTEXITCODE -eq 0 -and $running -eq 'true'
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

$originalPath = $env:Path
$hadPreviousDatabaseUri = Test-Path Env:DATABASE_URI
$previousDatabaseUri = if ($hadPreviousDatabaseUri) { $env:DATABASE_URI } else { $null }
$hadPreviousContainer = Test-Path Env:BAIHEPAILEI_PG_DUMP_CONTAINER
$previousContainer = if ($hadPreviousContainer) { $env:BAIHEPAILEI_PG_DUMP_CONTAINER } else { $null }

try {
  # The existing checkpoint implementation consumes DATABASE_URI. Bridge the
  # project's canonical DATABASE_URL without ever printing the secret value.
  $env:DATABASE_URI = $databaseConnection
  Write-Host "Database connection resolved from $connectionSource" -ForegroundColor DarkGray

  $localPgDump = Find-LocalPgDump
  if ($localPgDump) {
    $pgDumpDirectory = Split-Path -Parent $localPgDump
    $env:Path = "$pgDumpDirectory;$env:Path"
    Write-Host "pg_dump resolved from local PostgreSQL client tools: $localPgDump" -ForegroundColor DarkGray
  }
  elseif (Test-RunningContainer -Name $PostgresContainer) {
    $dockerShim = Join-Path $PSScriptRoot 'pg_dump.ps1'
    if (-not (Test-Path -LiteralPath $dockerShim)) {
      throw "Docker pg_dump shim not found: $dockerShim"
    }
    $env:BAIHEPAILEI_PG_DUMP_CONTAINER = $PostgresContainer
    $env:Path = "$PSScriptRoot;$env:Path"
    Write-Host "pg_dump resolved from running Docker container: $PostgresContainer" -ForegroundColor DarkGray
  }
  else {
    throw "pg_dump was not found locally and PostgreSQL container '$PostgresContainer' is not running. Install PostgreSQL client tools or start the container."
  }

  $resolvedPgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
  if (-not $resolvedPgDump) {
    throw 'pg_dump resolution succeeded conceptually, but PowerShell command discovery still cannot find it.'
  }

  & $checkpointScript `
    -BackupRoot $BackupRoot `
    -IncludeDatabase `
    -IncludeSecrets:$IncludeSecrets
}
finally {
  $env:Path = $originalPath

  if ($hadPreviousDatabaseUri) {
    $env:DATABASE_URI = $previousDatabaseUri
  }
  else {
    Remove-Item Env:DATABASE_URI -ErrorAction SilentlyContinue
  }

  if ($hadPreviousContainer) {
    $env:BAIHEPAILEI_PG_DUMP_CONTAINER = $previousContainer
  }
  else {
    Remove-Item Env:BAIHEPAILEI_PG_DUMP_CONTAINER -ErrorAction SilentlyContinue
  }
}
