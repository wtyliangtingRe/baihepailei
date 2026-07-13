param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-ArgumentValue {
  param(
    [string[]]$Items,
    [string]$Prefix
  )

  foreach ($item in $Items) {
    if ($item.StartsWith($Prefix, [System.StringComparison]::Ordinal)) {
      return $item.Substring($Prefix.Length)
    }
  }
  return $null
}

$container = $env:BAIHEPAILEI_PG_DUMP_CONTAINER
if (-not $container) {
  throw 'Docker pg_dump shim requires BAIHEPAILEI_PG_DUMP_CONTAINER.'
}

$databaseUri = Get-ArgumentValue -Items $Arguments -Prefix '--dbname='
$outputFile = Get-ArgumentValue -Items $Arguments -Prefix '--file='
if (-not $databaseUri) {
  throw 'Docker pg_dump shim did not receive --dbname.'
}
if (-not $outputFile) {
  throw 'Docker pg_dump shim did not receive --file.'
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  throw 'Docker pg_dump fallback was selected, but docker is not available.'
}

$running = (& $docker.Source inspect --format '{{.State.Running}}' $container 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
  throw "PostgreSQL Docker container is not running: $container"
}

try {
  $uri = [System.Uri]$databaseUri
} catch {
  throw 'DATABASE_URL is not a valid PostgreSQL URI.'
}

$userInfoParts = $uri.UserInfo.Split(':', 2)
$username = if ($userInfoParts.Count -ge 1) { [System.Uri]::UnescapeDataString($userInfoParts[0]) } else { '' }
$password = if ($userInfoParts.Count -ge 2) { [System.Uri]::UnescapeDataString($userInfoParts[1]) } else { '' }
$databaseName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
if (-not $username) {
  throw 'DATABASE_URL does not contain a PostgreSQL username.'
}
if (-not $databaseName) {
  throw 'DATABASE_URL does not contain a database name.'
}

$outputFullPath = [System.IO.Path]::GetFullPath($outputFile)
$outputDirectory = Split-Path -Parent $outputFullPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$containerDump = "/tmp/baihepailei-payload-$([guid]::NewGuid().ToString('N')).dump"
try {
  $dockerArgs = @('exec')
  if ($password) {
    $dockerArgs += @('-e', "PGPASSWORD=$password")
  }
  $dockerArgs += @(
    $container,
    'pg_dump',
    '--host=127.0.0.1',
    '--port=5432',
    "--username=$username",
    "--dbname=$databaseName",
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    "--file=$containerDump"
  )

  & $docker.Source @dockerArgs
  if ($LASTEXITCODE -ne 0) {
    throw 'pg_dump inside the PostgreSQL Docker container failed.'
  }

  & $docker.Source cp "${container}:${containerDump}" $outputFullPath
  if ($LASTEXITCODE -ne 0) {
    throw 'docker cp failed while copying the PostgreSQL dump to the checkpoint.'
  }

  if (-not (Test-Path -LiteralPath $outputFullPath)) {
    throw 'Docker pg_dump completed but the host dump file was not created.'
  }
  if ((Get-Item -LiteralPath $outputFullPath).Length -le 0) {
    throw 'Docker pg_dump created an empty host dump file.'
  }
}
finally {
  & $docker.Source exec $container rm -f $containerDump *> $null
}
