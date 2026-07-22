[CmdletBinding()]
param(
  [switch]$Execute,
  [switch]$BackupProbe,
  [string]$ServerUrl = "http://127.0.0.1:3000",
  [int]$DelayMs = 25,
  [int]$MaxRows = 0,
  [string]$PostgresContainer = "baihepailei-postgres"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Execute -and $BackupProbe) {
  throw "-Execute 与 -BackupProbe 不能同时使用"
}

if ($Execute) {
  throw "正式发布已临时禁用：version_roundtrip 恢复草稿会丢失刚发布的补丁。请先运行只读取证流程。"
}

$Original = Join-Path $PSScriptRoot "run-ai-radar-full-coverage-publication-v01.ps1"
$BackupScriptRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\backup")).Path
if (-not (Test-Path -LiteralPath $Original)) {
  throw "找不到 v01 全覆盖发布脚本：$Original"
}

function Get-DotEnvValue {
  param(
    [string]$FilePath,
    [string]$Key
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    return $null
  }

  foreach ($Line in Get-Content -LiteralPath $FilePath -Encoding UTF8) {
    $Trimmed = $Line.Trim()
    if (-not $Trimmed -or $Trimmed.StartsWith('#') -or -not $Trimmed.Contains('=')) {
      continue
    }

    $Separator = $Trimmed.IndexOf('=')
    $Name = $Trimmed.Substring(0, $Separator).Trim()
    if ($Name -ne $Key) {
      continue
    }

    $Value = $Trimmed.Substring($Separator + 1).Trim()
    if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
        ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
      $Value = $Value.Substring(1, $Value.Length - 2)
    }
    return $Value
  }

  return $null
}

function Resolve-DatabaseConnection {
  $Keys = @('DATABASE_URL', 'DATABASE_URI')
  foreach ($Key in $Keys) {
    $Candidate = [Environment]::GetEnvironmentVariable($Key, 'Process')
    if ($Candidate) {
      return @{ Value = $Candidate; Source = "process:$Key" }
    }
  }

  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  $Files = @(
    (Join-Path $RepoRoot '.env.development.local'),
    (Join-Path $RepoRoot '.env.local'),
    (Join-Path $RepoRoot '.env.development'),
    (Join-Path $RepoRoot '.env')
  )

  foreach ($File in $Files) {
    foreach ($Key in $Keys) {
      $Candidate = Get-DotEnvValue -FilePath $File -Key $Key
      if ($Candidate) {
        return @{
          Value = $Candidate
          Source = "file:$([System.IO.Path]::GetFileName($File)):$Key"
        }
      }
    }
  }

  $Checked = ($Files | ForEach-Object { [System.IO.Path]::GetFileName($_) }) -join ', '
  throw "找不到数据库连接；已检查进程变量 DATABASE_URL/DATABASE_URI 与文件：$Checked"
}

function Find-LocalPgDump {
  $Command = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if (-not $Command) {
    $Command = Get-Command pg_dump -ErrorAction SilentlyContinue
  }
  if ($Command) {
    return $Command.Source
  }

  $Patterns = @()
  if ($env:ProgramFiles) {
    $Patterns += (Join-Path $env:ProgramFiles 'PostgreSQL\*\bin\pg_dump.exe')
  }
  if (${env:ProgramFiles(x86)}) {
    $Patterns += (Join-Path ${env:ProgramFiles(x86)} 'PostgreSQL\*\bin\pg_dump.exe')
  }
  if ($env:USERPROFILE) {
    $Patterns += (Join-Path $env:USERPROFILE 'scoop\apps\postgresql*\current\bin\pg_dump.exe')
    $Patterns += (Join-Path $env:USERPROFILE 'scoop\apps\postgresql*\*\bin\pg_dump.exe')
  }
  if ($env:ChocolateyInstall) {
    $Patterns += (Join-Path $env:ChocolateyInstall 'bin\pg_dump.exe')
    $Patterns += (Join-Path $env:ChocolateyInstall 'lib\postgresql*\tools\*\bin\pg_dump.exe')
  }

  $Matches = foreach ($Pattern in $Patterns) {
    Get-Item -Path $Pattern -ErrorAction SilentlyContinue
  }

  return $Matches |
    Where-Object { $_ -and -not $_.PSIsContainer } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

function Test-RunningContainer {
  param([string]$Name)

  $Docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $Docker) {
    return $false
  }

  $Running = (& $Docker.Source inspect --format '{{.State.Running}}' $Name 2>$null | Out-String).Trim()
  return $LASTEXITCODE -eq 0 -and $Running -eq 'true'
}

$Source = Get-Content -LiteralPath $Original -Raw -Encoding UTF8
$OutputNeedle = '& node --test $TestFile 2>&1 | Tee-Object -FilePath $TestOutput'
$OutputReplacement = '& node --test $TestFile 2>&1 | Tee-Object -FilePath $TestOutput | ForEach-Object { Write-Host $_ }'
$PgDumpNeedle = '& pg_dump --format=custom --file=$DumpFile $env:DATABASE_URI'
$PgDumpReplacement = '& pg_dump --dbname=$env:DATABASE_URI --format=custom --file=$DumpFile'

$OutputOccurrences = ([regex]::Matches($Source, [regex]::Escape($OutputNeedle))).Count
if ($OutputOccurrences -ne 1) {
  throw "v01 测试输出修补点数量异常：$OutputOccurrences"
}
$PgDumpOccurrences = ([regex]::Matches($Source, [regex]::Escape($PgDumpNeedle))).Count
if ($PgDumpOccurrences -ne 1) {
  throw "v01 pg_dump 参数修补点数量异常：$PgDumpOccurrences"
}

$Patched = $Source.Replace($OutputNeedle, $OutputReplacement).Replace($PgDumpNeedle, $PgDumpReplacement)
$TempFile = Join-Path $env:TEMP ("run-ai-radar-full-coverage-publication-v02-" + [guid]::NewGuid().ToString("N") + ".ps1")
$ProbeFile = $null

$OriginalPath = $env:Path
$HadDatabaseUri = Test-Path Env:DATABASE_URI
$PreviousDatabaseUri = if ($HadDatabaseUri) { $env:DATABASE_URI } else { $null }
$HadContainer = Test-Path Env:BAIHEPAILEI_PG_DUMP_CONTAINER
$PreviousContainer = if ($HadContainer) { $env:BAIHEPAILEI_PG_DUMP_CONTAINER } else { $null }

try {
  $Database = Resolve-DatabaseConnection
  $env:DATABASE_URI = $Database.Value
  Write-Host "数据库连接已从 $($Database.Source) 安全解析" -ForegroundColor DarkGray

  $LocalPgDump = Find-LocalPgDump
  if ($LocalPgDump) {
    $PgDumpDirectory = Split-Path -Parent $LocalPgDump
    $env:Path = "$PgDumpDirectory;$env:Path"
    Write-Host "pg_dump 使用本机 PostgreSQL 客户端" -ForegroundColor DarkGray
  }
  elseif (Test-RunningContainer -Name $PostgresContainer) {
    $DockerShim = Join-Path $BackupScriptRoot 'pg_dump.ps1'
    if (-not (Test-Path -LiteralPath $DockerShim)) {
      throw "找不到 Docker pg_dump 适配器：$DockerShim"
    }
    $env:BAIHEPAILEI_PG_DUMP_CONTAINER = $PostgresContainer
    $env:Path = "$BackupScriptRoot;$env:Path"
    Write-Host "pg_dump 使用运行中的 Docker 容器：$PostgresContainer" -ForegroundColor DarkGray
  }
  else {
    throw "本机没有 pg_dump，且 PostgreSQL 容器 '$PostgresContainer' 未运行"
  }

  $ResolvedPgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
  if (-not $ResolvedPgDump) {
    throw "pg_dump 解析失败；不会进入正式发布"
  }

  if ($BackupProbe) {
    $ProbeFile = Join-Path $env:TEMP ("radar-full-coverage-backup-probe-" + [guid]::NewGuid().ToString("N") + ".dump")
    & pg_dump --dbname=$env:DATABASE_URI --format=custom --file=$ProbeFile
    if ($LASTEXITCODE -ne 0) {
      throw "数据库备份探针执行失败"
    }
    if (-not (Test-Path -LiteralPath $ProbeFile)) {
      throw "数据库备份探针没有生成文件"
    }
    $ProbeItem = Get-Item -LiteralPath $ProbeFile
    if ($ProbeItem.Length -le 0) {
      throw "数据库备份探针生成了空文件"
    }

    Write-Host "BackupProbe             : passed" -ForegroundColor Green
    Write-Host "DatabaseConnectionSource: $($Database.Source)"
    Write-Host "PgDumpCommand           : $($ResolvedPgDump.Source)"
    Write-Host "PostgresContainer       : $PostgresContainer"
    Write-Host "ProbeBytes              : $($ProbeItem.Length)"
    Write-Host "PayloadWrite            : False"
    Write-Host "DirectPostgresqlWrite   : False"
    return
  }

  Set-Content -LiteralPath $TempFile -Value $Patched -Encoding UTF8 -NoNewline

  $Arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $TempFile,
    "-ServerUrl", $ServerUrl,
    "-DelayMs", [string]$DelayMs,
    "-MaxRows", [string]$MaxRows
  )
  if ($Execute) {
    $Arguments += "-Execute"
  }

  & pwsh @Arguments
  $ExitCode = $LASTEXITCODE
  if ($ExitCode -ne 0) {
    throw "全覆盖发布 v02 包装器检测到内部流程失败：$ExitCode"
  }
}
finally {
  if ($ProbeFile -and (Test-Path -LiteralPath $ProbeFile)) {
    Remove-Item -LiteralPath $ProbeFile -Force
  }
  if (Test-Path -LiteralPath $TempFile) {
    Remove-Item -LiteralPath $TempFile -Force
  }
  $env:Path = $OriginalPath

  if ($HadDatabaseUri) {
    $env:DATABASE_URI = $PreviousDatabaseUri
  }
  else {
    Remove-Item Env:DATABASE_URI -ErrorAction SilentlyContinue
  }

  if ($HadContainer) {
    $env:BAIHEPAILEI_PG_DUMP_CONTAINER = $PreviousContainer
  }
  else {
    Remove-Item Env:BAIHEPAILEI_PG_DUMP_CONTAINER -ErrorAction SilentlyContinue
  }
}
