param(
  [string]$BackupRoot = "D:\Baihepailei-backups",
  [switch]$IncludeSecrets,
  [switch]$IncludeDatabase
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backupRootFull = [System.IO.Path]::GetFullPath($BackupRoot)
$repoRootFull = [System.IO.Path]::GetFullPath($repoRoot)

if ($backupRootFull.StartsWith($repoRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'BackupRoot must be outside the repository to avoid recursive copies.'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$checkpointName = "Baihepailei-$timestamp"
$checkpointDir = Join-Path $backupRootFull $checkpointName
$workspaceDir = Join-Path $checkpointDir 'workspace'
$metadataDir = Join-Path $checkpointDir 'metadata'
$statusFile = Join-Path $checkpointDir 'checkpoint-status.json'

New-Item -ItemType Directory -Force -Path $workspaceDir, $metadataDir | Out-Null
Write-CheckpointStatus -FilePath $statusFile -State 'in-progress' -Message 'Checkpoint creation started.'

Push-Location $repoRoot
try {
  $head = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read git HEAD.' }

  $branch = (git branch --show-current).Trim()
  $remote = (git remote get-url origin 2>$null)

  git status --short | Set-Content -Encoding UTF8 (Join-Path $metadataDir 'git-status.txt')
  git log --oneline --decorate -n 100 | Set-Content -Encoding UTF8 (Join-Path $metadataDir 'git-log.txt')
  git branch -avv | Set-Content -Encoding UTF8 (Join-Path $metadataDir 'git-branches.txt')
  git remote -v | Set-Content -Encoding UTF8 (Join-Path $metadataDir 'git-remotes.txt')
  git diff --binary | Set-Content -Encoding UTF8 (Join-Path $metadataDir 'working-tree.patch')
  git diff --cached --binary | Set-Content -Encoding UTF8 (Join-Path $metadataDir 'staged.patch')

  $bundlePath = Join-Path $checkpointDir 'repository.bundle'
  git bundle create $bundlePath --all
  if ($LASTEXITCODE -ne 0) { throw 'git bundle creation failed.' }

  $robocopyArgs = @(
    $repoRoot,
    $workspaceDir,
    '/E',
    '/COPY:DAT',
    '/DCOPY:T',
    '/R:1',
    '/W:1',
    '/XJ',
    '/NFL',
    '/NDL',
    '/NP',
    '/XD',
    (Join-Path $repoRoot '.git'),
    (Join-Path $repoRoot 'node_modules'),
    (Join-Path $repoRoot '.next')
  )

  if (-not $IncludeSecrets) {
    $robocopyArgs += @('/XF', '.env', '.env.local')
  }

  & robocopy @robocopyArgs | Set-Content -Encoding UTF8 (Join-Path $metadataDir 'robocopy.log')
  $robocopyExit = $LASTEXITCODE
  if ($robocopyExit -gt 7) {
    throw "robocopy failed with exit code $robocopyExit"
  }

  $databaseDump = $null
  if ($IncludeDatabase) {
    $databaseUri = $env:DATABASE_URI
    if (-not $databaseUri) {
      $databaseUri = Get-DotEnvValue -FilePath (Join-Path $repoRoot '.env.local') -Key 'DATABASE_URI'
    }
    if (-not $databaseUri) {
      $databaseUri = Get-DotEnvValue -FilePath (Join-Path $repoRoot '.env') -Key 'DATABASE_URI'
    }
    if (-not $databaseUri) {
      throw 'IncludeDatabase was requested, but DATABASE_URI was not found.'
    }

    $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
    if (-not $pgDump) {
      throw 'IncludeDatabase was requested, but pg_dump is not available in PATH.'
    }

    $databaseDump = Join-Path $checkpointDir 'payload-postgresql.dump'
    & $pgDump.Source "--dbname=$databaseUri" '--format=custom' '--no-owner' '--no-privileges' "--file=$databaseDump"
    if ($LASTEXITCODE -ne 0) {
      throw 'pg_dump failed.'
    }
  }

  $manifest = [ordered]@{
    createdAt = (Get-Date).ToString('o')
    checkpointName = $checkpointName
    repository = $repoRoot
    branch = $branch
    commit = $head
    origin = $remote
    includesWorkspace = $true
    includesGitBundle = $true
    includesSecrets = [bool]$IncludeSecrets
    includesDatabase = [bool]$IncludeDatabase
    databaseDump = if ($databaseDump) { Split-Path -Leaf $databaseDump } else { $null }
    excludedDirectories = @('.git', 'node_modules', '.next')
    generatedIndexesCopiedToWorkspace = [bool]((Test-Path (Join-Path $workspaceDir 'public\search-index.json')) -and (Test-Path (Join-Path $workspaceDir 'public\detail-index.json')))
  }

  $manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $checkpointDir 'checkpoint-manifest.json')

  $checksumRows = Get-ChildItem -LiteralPath $checkpointDir -Recurse -File |
    Where-Object { $_.Name -notin @('sha256-checksums.csv', 'checkpoint-status.json') } |
    ForEach-Object {
      [pscustomobject]@{
        RelativePath = Get-RelativePathCompat -BasePath $checkpointDir -TargetPath $_.FullName
        Length = $_.Length
        SHA256 = Get-Sha256Compat -FilePath $_.FullName
      }
    }
  $checksumRows | Export-Csv -NoTypeInformation -Encoding UTF8 (Join-Path $checkpointDir 'sha256-checksums.csv')

  Write-CheckpointStatus -FilePath $statusFile -State 'complete' -Message 'Checkpoint backup completed successfully.'

  Write-Host ""
  Write-Host 'Checkpoint backup completed:' -ForegroundColor Green
  Write-Host $checkpointDir
  Write-Host "Commit: $head"
  Write-Host "Branch: $branch"
  Write-Host "Secrets included: $([bool]$IncludeSecrets)"
  Write-Host "Database included: $([bool]$IncludeDatabase)"
  Write-Host "Generated indexes copied: $($manifest.generatedIndexesCopiedToWorkspace)"
}
catch {
  Write-CheckpointStatus -FilePath $statusFile -State 'failed' -Message $_.Exception.Message
  throw
}
finally {
  Pop-Location
}
