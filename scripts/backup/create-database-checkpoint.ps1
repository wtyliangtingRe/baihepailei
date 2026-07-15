param(
  [string]$BackupRoot = "D:\Baihepailei-backups",
  [switch]$IncludeSecrets,
  [string]$PostgresContainer = 'baihepailei-postgres'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-CheckpointStatus {
  param(
    [string]$FilePath,
    [string]$State,
    [string]$Message = ''
  )

  [ordered]@{
    updatedAt = (Get-Date).ToString('o')
    state = $State
    message = $Message
  } | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 $FilePath
}

function Get-Sha256Compat {
  param([string]$FilePath)

  $stream = [System.IO.File]::OpenRead($FilePath)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha256.ComputeHash($stream)
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').ToUpperInvariant()
  }
  finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Get-RelativePathCompat {
  param(
    [string]$BasePath,
    [string]$TargetPath
  )

  $baseFull = [System.IO.Path]::GetFullPath($BasePath)
  $separator = [string][System.IO.Path]::DirectorySeparatorChar
  if (-not $baseFull.EndsWith($separator)) {
    $baseFull += $separator
  }

  $baseUri = New-Object System.Uri($baseFull)
  $targetUri = New-Object System.Uri([System.IO.Path]::GetFullPath($TargetPath))
  $relativeUri = $baseUri.MakeRelativeUri($targetUri)
  return [System.Uri]::UnescapeDataString($relativeUri.ToString()).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
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

function Get-ContainerEnvValue {
  param(
    [string]$ContainerName,
    [string]$Key
  )

  $docker = Get-Command docker -ErrorAction Stop
  $lines = @(& $docker.Source inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $ContainerName 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect PostgreSQL container environment: $ContainerName"
  }

  $prefix = "$Key="
  foreach ($line in $lines) {
    $text = [string]$line
    if ($text.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
      return $text.Substring($prefix.Length)
    }
  }

  return $null
}

$script = Join-Path $PSScriptRoot 'create-local-checkpoint.ps1'
if (-not (Test-Path -LiteralPath $script)) {
  throw "Checkpoint implementation not found: $script"
}

$backupRootFull = [System.IO.Path]::GetFullPath($BackupRoot)
New-Item -ItemType Directory -Force -Path $backupRootFull | Out-Null
$before = @{}
Get-ChildItem -LiteralPath $backupRootFull -Directory -Filter 'Baihepailei-*' -ErrorAction SilentlyContinue |
  ForEach-Object { $before[$_.FullName] = $true }

$checkpointDir = $null
$statusFile = $null
$containerDump = $null
$docker = $null

try {
  $baseArguments = @{ BackupRoot = $backupRootFull }
  if ($IncludeSecrets) {
    $baseArguments.IncludeSecrets = $true
  }

  # First create the ordinary complete workspace/Git checkpoint. Database
  # material is appended below so no DATABASE_URI or database password needs
  # to be copied into the repository or command history.
  & $script @baseArguments

  $created = @(Get-ChildItem -LiteralPath $backupRootFull -Directory -Filter 'Baihepailei-*' |
    Where-Object { -not $before.ContainsKey($_.FullName) } |
    Sort-Object CreationTime)
  if ($created.Count -ne 1) {
    throw "Expected exactly one newly-created checkpoint directory, found $($created.Count)."
  }

  $checkpointDir = $created[0].FullName
  $statusFile = Join-Path $checkpointDir 'checkpoint-status.json'
  $manifestFile = Join-Path $checkpointDir 'checkpoint-manifest.json'
  if (-not (Test-Path -LiteralPath $statusFile) -or -not (Test-Path -LiteralPath $manifestFile)) {
    throw 'Base checkpoint completed without the required status or manifest file.'
  }

  Write-CheckpointStatus -FilePath $statusFile -State 'in-progress' -Message 'Adding PostgreSQL dump from the running local container.'

  if (-not (Test-RunningContainer -Name $PostgresContainer)) {
    throw "PostgreSQL container '$PostgresContainer' is not running and DATABASE_URI-free backup cannot continue."
  }

  $docker = Get-Command docker -ErrorAction Stop
  $databaseUser = Get-ContainerEnvValue -ContainerName $PostgresContainer -Key 'POSTGRES_USER'
  if (-not $databaseUser) {
    $databaseUser = 'postgres'
  }
  $databaseName = Get-ContainerEnvValue -ContainerName $PostgresContainer -Key 'POSTGRES_DB'
  if (-not $databaseName) {
    $databaseName = $databaseUser
  }

  $databaseDump = Join-Path $checkpointDir 'payload-postgresql.dump'
  $containerDump = "/tmp/baihepailei-checkpoint-$([guid]::NewGuid().ToString('N')).dump"

  & $docker.Source exec $PostgresContainer pg_dump `
    "--username=$databaseUser" `
    "--dbname=$databaseName" `
    '--format=custom' `
    '--no-owner' `
    '--no-privileges' `
    "--file=$containerDump"
  if ($LASTEXITCODE -ne 0) {
    throw 'Container pg_dump failed.'
  }

  & $docker.Source cp "${PostgresContainer}:$containerDump" $databaseDump
  if ($LASTEXITCODE -ne 0) {
    throw 'docker cp failed while exporting the PostgreSQL dump.'
  }
  if (-not (Test-Path -LiteralPath $databaseDump) -or (Get-Item -LiteralPath $databaseDump).Length -le 0) {
    throw 'The exported PostgreSQL dump is missing or empty.'
  }

  $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
  $manifest.includesDatabase = $true
  $manifest.databaseDump = Split-Path -Leaf $databaseDump
  $manifest | Add-Member -NotePropertyName databaseDumpMethod -NotePropertyValue 'docker_exec_pg_dump' -Force
  $manifest | Add-Member -NotePropertyName databaseContainer -NotePropertyValue $PostgresContainer -Force
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $manifestFile

  $checksumsFile = Join-Path $checkpointDir 'sha256-checksums.csv'
  $checksumRows = Get-ChildItem -LiteralPath $checkpointDir -Recurse -File |
    Where-Object { $_.Name -notin @('sha256-checksums.csv', 'checkpoint-status.json') } |
    ForEach-Object {
      [pscustomobject]@{
        RelativePath = Get-RelativePathCompat -BasePath $checkpointDir -TargetPath $_.FullName
        Length = $_.Length
        SHA256 = Get-Sha256Compat -FilePath $_.FullName
      }
    }
  $checksumRows | Export-Csv -NoTypeInformation -Encoding UTF8 $checksumsFile

  Write-CheckpointStatus -FilePath $statusFile -State 'complete' -Message 'Checkpoint backup completed successfully with PostgreSQL dump.'

  Write-Host ''
  Write-Host 'Database checkpoint completed:' -ForegroundColor Green
  Write-Host $checkpointDir
  Write-Host "PostgreSQL container: $PostgresContainer"
  Write-Host "Database dump: $databaseDump"
  Write-Host "Database dump bytes: $((Get-Item -LiteralPath $databaseDump).Length)"
  Write-Host 'Database credentials printed: False'
}
catch {
  if ($statusFile -and (Test-Path -LiteralPath $statusFile)) {
    Write-CheckpointStatus -FilePath $statusFile -State 'failed' -Message $_.Exception.Message
  }
  throw
}
finally {
  if ($docker -and $containerDump) {
    & $docker.Source exec $PostgresContainer rm -f $containerDump *> $null
  }
}
