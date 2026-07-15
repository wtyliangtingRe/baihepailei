param(
  [string]$BackupRoot = "D:\Baihepailei-backups",
  [string]$PostgresContainer = "baihepailei-postgres"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-JsonUtf8 {
  param(
    [string]$FilePath,
    $Value
  )

  $Json = $Value | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText(
    $FilePath,
    $Json + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

function Write-CheckpointStatus {
  param(
    [string]$FilePath,
    [string]$State,
    [string]$Message = ""
  )

  Write-JsonUtf8 `
    -FilePath $FilePath `
    -Value ([ordered]@{
      updatedAt = (Get-Date).ToString("o")
      state = $State
      message = $Message
    })
}

function Get-Sha256Compat {
  param([string]$FilePath)

  $Stream = [System.IO.File]::OpenRead($FilePath)
  $Sha256 = [System.Security.Cryptography.SHA256]::Create()

  try {
    $Bytes = $Sha256.ComputeHash($Stream)
    return (($Bytes | ForEach-Object {
      $_.ToString("x2")
    }) -join "").ToUpperInvariant()
  }
  finally {
    $Sha256.Dispose()
    $Stream.Dispose()
  }
}

function Test-RunningContainer {
  param([string]$Name)

  $Docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $Docker) {
    return $false
  }

  $Running = (
    & $Docker.Source inspect `
      --format "{{.State.Running}}" `
      $Name `
      2>$null |
    Out-String
  ).Trim()

  return (
    $LASTEXITCODE -eq 0 -and
    $Running -eq "true"
  )
}

function Get-ContainerEnvValue {
  param(
    [string]$ContainerName,
    [string]$Key
  )

  $Docker = Get-Command docker -ErrorAction Stop
  $Lines = @(
    & $Docker.Source inspect `
      --format "{{range .Config.Env}}{{println .}}{{end}}" `
      $ContainerName `
      2>$null
  )

  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect PostgreSQL container environment: $ContainerName"
  }

  $Prefix = "$Key="

  foreach ($Line in $Lines) {
    $Text = [string]$Line

    if ($Text.StartsWith(
      $Prefix,
      [System.StringComparison]::Ordinal
    )) {
      return $Text.Substring($Prefix.Length)
    }
  }

  return $null
}

function Get-RelativePathCompat {
  param(
    [string]$BasePath,
    [string]$TargetPath
  )

  $BaseFull = [System.IO.Path]::GetFullPath($BasePath)
  $Separator = [string][System.IO.Path]::DirectorySeparatorChar

  if (-not $BaseFull.EndsWith($Separator)) {
    $BaseFull += $Separator
  }

  $BaseUri = New-Object System.Uri($BaseFull)
  $TargetUri = New-Object System.Uri(
    [System.IO.Path]::GetFullPath($TargetPath)
  )

  return [System.Uri]::UnescapeDataString(
    $BaseUri.MakeRelativeUri($TargetUri).ToString()
  ).Replace(
    "/",
    [System.IO.Path]::DirectorySeparatorChar
  )
}

$RepoRoot = (
  Resolve-Path (Join-Path $PSScriptRoot "..\..")
).Path

Push-Location $RepoRoot

$CheckpointDir = $null
$StatusFile = $null
$ContainerDump = $null
$Docker = $null

try {
  $Branch = (git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $Branch) {
    throw "Unable to read the current Git branch."
  }

  $Commit = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $Commit) {
    throw "Unable to read the current Git commit."
  }

  $Origin = (git remote get-url origin 2>$null | Out-String).Trim()

  $BackupRootFull = [System.IO.Path]::GetFullPath($BackupRoot)
  New-Item `
    -ItemType Directory `
    -Force `
    -Path $BackupRootFull |
  Out-Null

  $Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $CheckpointName = "Baihepailei-db-$Timestamp"
  $CheckpointDir = Join-Path $BackupRootFull $CheckpointName
  New-Item `
    -ItemType Directory `
    -Force `
    -Path $CheckpointDir |
  Out-Null

  $StatusFile = Join-Path $CheckpointDir "checkpoint-status.json"
  $ManifestFile = Join-Path $CheckpointDir "checkpoint-manifest.json"
  $ChecksumsFile = Join-Path $CheckpointDir "sha256-checksums.csv"
  $DatabaseDump = Join-Path $CheckpointDir "payload-postgresql.dump"

  Write-CheckpointStatus `
    -FilePath $StatusFile `
    -State "in-progress" `
    -Message "Creating lightweight PostgreSQL-only checkpoint."

  if (-not (Test-RunningContainer -Name $PostgresContainer)) {
    throw "PostgreSQL container '$PostgresContainer' is not running."
  }

  $Docker = Get-Command docker -ErrorAction Stop
  $DatabaseUser = Get-ContainerEnvValue `
    -ContainerName $PostgresContainer `
    -Key "POSTGRES_USER"

  if (-not $DatabaseUser) {
    $DatabaseUser = "postgres"
  }

  $DatabaseName = Get-ContainerEnvValue `
    -ContainerName $PostgresContainer `
    -Key "POSTGRES_DB"

  if (-not $DatabaseName) {
    $DatabaseName = $DatabaseUser
  }

  $ContainerDump = "/tmp/baihepailei-db-checkpoint-$([guid]::NewGuid().ToString('N')).dump"

  & $Docker.Source exec `
    $PostgresContainer `
    pg_dump `
    "--username=$DatabaseUser" `
    "--dbname=$DatabaseName" `
    "--format=custom" `
    "--no-owner" `
    "--no-privileges" `
    "--file=$ContainerDump"

  if ($LASTEXITCODE -ne 0) {
    throw "Container pg_dump failed."
  }

  & $Docker.Source cp `
    "${PostgresContainer}:$ContainerDump" `
    $DatabaseDump

  if ($LASTEXITCODE -ne 0) {
    throw "docker cp failed while exporting the PostgreSQL dump."
  }

  if (
    -not (Test-Path -LiteralPath $DatabaseDump) -or
    (Get-Item -LiteralPath $DatabaseDump).Length -le 0
  ) {
    throw "The exported PostgreSQL dump is missing or empty."
  }

  $Manifest = [ordered]@{
    createdAt = (Get-Date).ToString("o")
    version = "baihepailei-database-only-checkpoint-v0.2"
    checkpointName = $CheckpointName
    checkpointProfile = "database_only"
    repository = $RepoRoot
    branch = $Branch
    commit = $Commit
    origin = $Origin
    includesWorkspace = $false
    includesGitBundle = $false
    includesSecrets = $false
    includesDatabase = $true
    databaseDump = Split-Path -Leaf $DatabaseDump
    databaseDumpMethod = "docker_exec_pg_dump"
    databaseContainer = $PostgresContainer
    databaseName = $DatabaseName
    safety = [ordered]@{
      workspaceCopied = $false
      dataLocalCopied = $false
      gitBundleCreated = $false
      databaseCredentialsPrinted = $false
      databaseRead = $true
      databaseWrite = $false
      payloadWrite = $false
    }
  }

  Write-JsonUtf8 `
    -FilePath $ManifestFile `
    -Value $Manifest

  $ChecksumRows = Get-ChildItem `
    -LiteralPath $CheckpointDir `
    -File |
  Where-Object {
    $_.Name -notin @(
      "sha256-checksums.csv",
      "checkpoint-status.json"
    )
  } |
  ForEach-Object {
    [pscustomobject]@{
      RelativePath = Get-RelativePathCompat `
        -BasePath $CheckpointDir `
        -TargetPath $_.FullName
      Length = $_.Length
      SHA256 = Get-Sha256Compat -FilePath $_.FullName
    }
  }

  $ChecksumRows |
    Export-Csv `
      -LiteralPath $ChecksumsFile `
      -NoTypeInformation `
      -Encoding UTF8

  Write-CheckpointStatus `
    -FilePath $StatusFile `
    -State "complete" `
    -Message "Lightweight PostgreSQL-only checkpoint completed successfully."

  Write-Host ""
  Write-Host `
    "Lightweight database checkpoint completed:" `
    -ForegroundColor Green
  Write-Host $CheckpointDir
  Write-Host "Branch: $Branch"
  Write-Host "Commit: $Commit"
  Write-Host "Database dump: $DatabaseDump"
  Write-Host "Database dump bytes: $((Get-Item -LiteralPath $DatabaseDump).Length)"
  Write-Host "Workspace copied: False"
  Write-Host "Git bundle created: False"
  Write-Host "Database credentials printed: False"
}
catch {
  if (
    $StatusFile -and
    (Test-Path -LiteralPath $StatusFile)
  ) {
    Write-CheckpointStatus `
      -FilePath $StatusFile `
      -State "failed" `
      -Message $_.Exception.Message
  }

  throw
}
finally {
  if ($Docker -and $ContainerDump) {
    & $Docker.Source exec `
      $PostgresContainer `
      rm -f `
      $ContainerDump `
      *> $null
  }

  Pop-Location
}
