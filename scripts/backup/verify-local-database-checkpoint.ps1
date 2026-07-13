param(
  [Parameter(Mandatory = $true)]
  [string]$CheckpointPath,
  [string]$OutputDir = 'data_local\staging\ai-radar\release-candidate-v01',
  [string]$PostgresContainer = 'baihepailei-postgres'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-LocalPgRestore {
  $command = Get-Command pg_restore.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command pg_restore -ErrorAction SilentlyContinue
  }
  if ($command) {
    return $command.Source
  }

  $patterns = @()
  if ($env:ProgramFiles) {
    $patterns += (Join-Path $env:ProgramFiles 'PostgreSQL\*\bin\pg_restore.exe')
  }
  if (${env:ProgramFiles(x86)}) {
    $patterns += (Join-Path ${env:ProgramFiles(x86)} 'PostgreSQL\*\bin\pg_restore.exe')
  }
  if ($env:USERPROFILE) {
    $patterns += (Join-Path $env:USERPROFILE 'scoop\apps\postgresql*\current\bin\pg_restore.exe')
    $patterns += (Join-Path $env:USERPROFILE 'scoop\apps\postgresql*\*\bin\pg_restore.exe')
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

$checkpointFull = (Resolve-Path -LiteralPath $CheckpointPath).Path
$manifestFile = Join-Path $checkpointFull 'checkpoint-manifest.json'
$statusFile = Join-Path $checkpointFull 'checkpoint-status.json'
$checksumsFile = Join-Path $checkpointFull 'sha256-checksums.csv'

foreach ($requiredFile in @($manifestFile, $statusFile, $checksumsFile)) {
  if (-not (Test-Path -LiteralPath $requiredFile)) {
    throw "Checkpoint verification file is missing: $requiredFile"
  }
}

$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$status = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
if ($status.state -ne 'complete') {
  throw "Checkpoint is not complete: $($status.state)"
}
if ($manifest.includesDatabase -ne $true) {
  throw 'Checkpoint manifest does not include a database dump.'
}
if (-not $manifest.databaseDump) {
  throw 'Checkpoint manifest has no databaseDump filename.'
}

$dumpFile = Join-Path $checkpointFull ([string]$manifest.databaseDump)
if (-not (Test-Path -LiteralPath $dumpFile)) {
  throw "Checkpoint database dump is missing: $dumpFile"
}
$dumpItem = Get-Item -LiteralPath $dumpFile
if ($dumpItem.Length -le 0) {
  throw 'Checkpoint database dump is empty.'
}

$dumpHash = (Get-FileHash -LiteralPath $dumpFile -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumRows = Import-Csv -LiteralPath $checksumsFile
$checksumRow = $checksumRows | Where-Object {
  ([string]$_.RelativePath).Replace('/', '\') -eq ([string]$manifest.databaseDump).Replace('/', '\')
} | Select-Object -First 1
if (-not $checksumRow) {
  throw 'Database dump is not listed in sha256-checksums.csv.'
}
if (([string]$checksumRow.SHA256).ToLowerInvariant() -ne $dumpHash) {
  throw 'Database dump SHA-256 does not match sha256-checksums.csv.'
}

$outputFull = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $outputFull | Out-Null
$listFile = Join-Path $outputFull 'database-restore-list-v01.txt'
$reportFile = Join-Path $outputFull 'database-restore-verification-v01.json'

$method = $null
$pgRestoreVersion = $null
$listLines = @()
$localPgRestore = Find-LocalPgRestore

if ($localPgRestore) {
  $method = 'local_pg_restore'
  $pgRestoreVersion = (& $localPgRestore --version | Out-String).Trim()
  $listLines = @(& $localPgRestore --list $dumpFile 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw 'Local pg_restore --list rejected the checkpoint dump.'
  }
}
elif (Test-RunningContainer -Name $PostgresContainer) {
  $method = 'docker_pg_restore'
  $docker = Get-Command docker -ErrorAction Stop
  $containerDump = "/tmp/baihepailei-verify-$([guid]::NewGuid().ToString('N')).dump"
  try {
    & $docker.Source cp $dumpFile "${PostgresContainer}:${containerDump}"
    if ($LASTEXITCODE -ne 0) {
      throw 'docker cp failed while preparing restore-list verification.'
    }

    $pgRestoreVersion = (& $docker.Source exec $PostgresContainer pg_restore --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
      throw 'Unable to read pg_restore version from the PostgreSQL container.'
    }

    $listLines = @(& $docker.Source exec $PostgresContainer pg_restore --list $containerDump 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw 'Container pg_restore --list rejected the checkpoint dump.'
    }
  }
  finally {
    & $docker.Source exec $PostgresContainer rm -f $containerDump *> $null
  }
}
else {
  throw "pg_restore was not found locally and PostgreSQL container '$PostgresContainer' is not running."
}

$listLines | Set-Content -LiteralPath $listFile -Encoding UTF8
$listEntryCount = @($listLines | Where-Object {
  $line = ([string]$_).Trim()
  $line -and -not $line.StartsWith(';')
}).Count
if ($listEntryCount -le 0) {
  throw 'pg_restore --list succeeded but reported no archive entries.'
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToString('o')
  version = 'database-restore-verification-v0.1'
  verified = $true
  checkpointPath = $checkpointFull
  checkpointBranch = [string]$manifest.branch
  checkpointCommit = [string]$manifest.commit
  dumpFile = $dumpFile
  dumpSizeBytes = [long]$dumpItem.Length
  dumpSha256 = $dumpHash
  checksumMatched = $true
  method = $method
  postgresContainer = if ($method -eq 'docker_pg_restore') { $PostgresContainer } else { $null }
  pgRestoreVersion = $pgRestoreVersion
  listEntryCount = $listEntryCount
  listFile = $listFile
  safety = [ordered]@{
    databaseRead = $false
    databaseWrite = $false
    dumpArchiveRead = $true
    restoreExecuted = $false
    payloadWrite = $false
  }
}

$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportFile -Encoding UTF8

Write-Host ''
Write-Host 'Database checkpoint restore-list verification passed:' -ForegroundColor Green
Write-Host "Dump: $dumpFile"
Write-Host "SHA-256: $dumpHash"
Write-Host "Method: $method"
Write-Host "pg_restore: $pgRestoreVersion"
Write-Host "Archive entries: $listEntryCount"
Write-Host "Report: $reportFile"
