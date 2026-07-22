[CmdletBinding()]
param(
  [string]$ServerUrl = "http://127.0.0.1:3000",
  [ValidateRange(1, 5)]
  [int]$MaxRows = 5,
  [ValidateRange(0, 10000)]
  [int]$DelayMs = 100,
  [string]$PostgresContainer = "baihepailei-postgres"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedBranch = "main"
$Confirmation = "PUBLISH-ALL-VALID-AI-FIXED-OR-RANGE-CONCLUSIONS"
$PackageDir = Join-Path (Get-Location) "data_local\outputs\ai-radar\wave5-full-coverage-8183-v01"
$OutRoot = Join-Path (Get-Location) "data_local\staging\ai-radar\full-coverage-direct-overwrite-v02"
$BackupRoot = Join-Path (Get-Location) "data_local\outputs\ai-radar\backups\direct-overwrite-v02"
$CheckpointRoot = Join-Path (Get-Location) "data_local\outputs\ai-radar\checkpoints"
$Runner = ".\scripts\radar\run-ai-radar-full-coverage-direct-overwrite-v02.mjs"
$BackupScriptRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\backup")).Path
$Tests = @(
  ".\tests\ai-radar-full-coverage-publication.test.mjs",
  ".\tests\radar-full-coverage-direct-overwrite-v02.test.mjs",
  ".\tests\radar-full-coverage-direct-overwrite-first5-v02.test.mjs"
)

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
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

  throw "找不到数据库连接；不会进入首批发布"
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

function Ensure-Credentials {
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_EMAIL)) {
    $env:RADAR_PAYLOAD_EMAIL = Read-Host "Payload 管理员邮箱"
  }
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_PASSWORD)) {
    $Secure = Read-Host "Payload 管理员密码" -AsSecureString
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
      $env:RADAR_PAYLOAD_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
    }
  }
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_EMAIL) -or
      [string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_PASSWORD)) {
    throw "Payload 凭据不能为空"
  }
}

function Get-CounterValue {
  param(
    [object]$Counters,
    [string]$Name
  )

  if ($null -eq $Counters) { return 0 }
  if ($Counters.PSObject.Properties.Name -notcontains $Name) { return 0 }
  return [int]$Counters.$Name
}

$CurrentBranch = (git branch --show-current).Trim()
if ($CurrentBranch -ne $ExpectedBranch) {
  throw "首批正式发布只能在 main 分支执行；当前为 $CurrentBranch"
}

if (-not (Test-Path -LiteralPath $PackageDir)) {
  throw "找不到已验证的全覆盖包目录：$PackageDir"
}
if (-not (Test-Path -LiteralPath $Runner)) {
  throw "找不到 direct-overwrite 运行器：$Runner"
}

$OriginalPath = $env:Path
$HadDatabaseUri = Test-Path Env:DATABASE_URI
$PreviousDatabaseUri = if ($HadDatabaseUri) { $env:DATABASE_URI } else { $null }
$HadContainer = Test-Path Env:BAIHEPAILEI_PG_DUMP_CONTAINER
$PreviousContainer = if ($HadContainer) { $env:BAIHEPAILEI_PG_DUMP_CONTAINER } else { $null }
$TestOutput = Join-Path $env:TEMP ("radar-direct-overwrite-first5-tests-" + [guid]::NewGuid().ToString("N") + ".txt")
$Temp = $null

try {
  $TestLines = @(& node --test @Tests 2>&1)
  $TestExit = $LASTEXITCODE
  $TestLines | ForEach-Object { Write-Host $_ }
  $TestLines | Set-Content -LiteralPath $TestOutput -Encoding UTF8
  if ($TestExit -ne 0) {
    throw "首批 direct-overwrite 回归测试失败"
  }

  Ensure-Credentials

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
    throw "pg_dump 解析失败；不会进入首批发布"
  }

  $Head = (git rev-parse HEAD).Trim()
  $RunId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfffZ")
  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null

  $DumpFile = Join-Path $BackupRoot "RADAR-DIRECT-OVERWRITE-FIRST5-$RunId.dump"
  & pg_dump --dbname=$env:DATABASE_URI --format=custom --file=$DumpFile
  if ($LASTEXITCODE -ne 0) {
    throw "首批发布数据库备份失败"
  }
  if (-not (Test-Path -LiteralPath $DumpFile)) {
    throw "首批发布数据库备份文件不存在"
  }
  $DumpItem = Get-Item -LiteralPath $DumpFile
  if ($DumpItem.Length -le 0) {
    throw "首批发布数据库备份为空"
  }

  $BackupProofFile = Join-Path $BackupRoot "RADAR-DIRECT-OVERWRITE-FIRST5-$RunId-proof.json"
  $BackupProof = [ordered]@{
    version = "ai-radar-full-coverage-backup-proof-v0.1"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    gitCommit = $Head
    dumpFile = $DumpFile
    dumpBytes = $DumpItem.Length
    dumpSha256 = Get-Sha256 $DumpFile
    databaseConnectionSource = $Database.Source
    pgDumpCommand = $ResolvedPgDump.Source
    directPostgresqlWrite = $false
  }
  $BackupProof | ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath $BackupProofFile -Encoding UTF8

  $StartedAt = Get-Date
  New-Item -ItemType Directory -Path $OutRoot -Force | Out-Null

  $NodeArgs = @(
    $Runner,
    "--package-dir", $PackageDir,
    "--url", $ServerUrl,
    "--out-root", $OutRoot,
    "--execute",
    "--confirmation", $Confirmation,
    "--backup-proof", $BackupProofFile,
    "--delay-ms", [string]$DelayMs,
    "--max-rows", [string]$MaxRows
  )
  & node @NodeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "首批 direct-overwrite 执行失败；不要直接重跑"
  }

  $ExecutionSummaryFile = Get-ChildItem -LiteralPath $OutRoot -Recurse -File -Filter "execution-summary.json" |
    Where-Object { $_.LastWriteTime -ge $StartedAt.AddSeconds(-2) } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $ExecutionSummaryFile) {
    throw "没有找到本次首批 execution-summary.json"
  }

  $RunDir = Split-Path -Parent $ExecutionSummaryFile.FullName
  $ExecutionLedgerFile = Join-Path $RunDir "execution-ledger.jsonl"
  $PlanSummaryFile = Join-Path $RunDir "publication-plan-summary.json"
  if (-not (Test-Path -LiteralPath $ExecutionLedgerFile)) {
    throw "没有找到本次首批 execution-ledger.jsonl"
  }
  if (-not (Test-Path -LiteralPath $PlanSummaryFile)) {
    throw "没有找到本次首批 publication-plan-summary.json"
  }

  $ExecutionSummary = Get-Content -LiteralPath $ExecutionSummaryFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  $Counters = $ExecutionSummary.counters
  $Completed = Get-CounterValue -Counters $Counters -Name "completed_verified"
  $Failed = Get-CounterValue -Counters $Counters -Name "execution_failed"
  $DirectPublished = Get-CounterValue -Counters $Counters -Name "publication_direct_field_publish_latest_ai_overwrite"
  $AlreadyPublished = Get-CounterValue -Counters $Counters -Name "publication_already_published"

  if ($Completed -ne $MaxRows) {
    throw "首批完成验证数量异常：$Completed，预期 $MaxRows"
  }
  if ($Failed -ne 0) {
    throw "首批执行包含失败：$Failed"
  }
  if (($DirectPublished + $AlreadyPublished) -ne $MaxRows) {
    throw "首批发布策略计数异常"
  }
  if ($ExecutionSummary.safety.versionRoundtripUsedWhenDraftUnrelatedFieldsDiffer -ne $false) {
    throw "首批摘要错误地声明使用 version roundtrip"
  }
  if ($ExecutionSummary.safety.humanAssessmentMutation -ne $false) {
    throw "首批摘要声明人工字段发生修改"
  }
  if ($ExecutionSummary.safety.wholeDraftPublication -ne $false) {
    throw "首批摘要声明整份草稿被发布"
  }

  $Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-direct-overwrite-first5-checkpoint-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $Temp | Out-Null
  Copy-Item -LiteralPath $BackupProofFile -Destination (Join-Path $Temp "backup-proof.json")
  Copy-Item -LiteralPath $ExecutionSummaryFile.FullName -Destination (Join-Path $Temp "execution-summary.json")
  Copy-Item -LiteralPath $ExecutionLedgerFile -Destination (Join-Path $Temp "execution-ledger.jsonl")
  Copy-Item -LiteralPath $PlanSummaryFile -Destination (Join-Path $Temp "publication-plan-summary.json")
  Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $Temp "test-output.txt")

  $Manifest = [ordered]@{
    version = "ai-radar-full-coverage-direct-overwrite-first5-checkpoint-v0.2"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    gitCommit = $Head
    mode = "execute-first5"
    maxRows = $MaxRows
    completedVerified = $Completed
    directPublished = $DirectPublished
    alreadyPublished = $AlreadyPublished
    executionFailed = $Failed
    backupDumpFile = $DumpFile
    backupDumpBytes = $DumpItem.Length
    backupDumpSha256 = Get-Sha256 $DumpFile
    safety = [ordered]@{
      directPostgresqlWrite = $false
      versionRestore = $false
      versionRoundtrip = $false
      wholeDraftPublication = $false
      humanAssessmentMutation = $false
      latestAiOverwritesOlderDraftAi = $true
      stopOnFirstFailure = $true
    }
  }
  $Manifest | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath (Join-Path $Temp "checkpoint-manifest.json") -Encoding UTF8

  $SumLines = @()
  Get-ChildItem -LiteralPath $Temp -File | Sort-Object Name | ForEach-Object {
    $SumLines += "$(Get-Sha256 $_.FullName)  $($_.Name)"
  }
  $SumLines | Set-Content -LiteralPath (Join-Path $Temp "SHA256SUMS.txt") -Encoding UTF8

  $CheckpointPath = Join-Path $CheckpointRoot "RADAR-FULL-COVERAGE-DIRECT-OVERWRITE-FIRST5-checkpoint-v02.zip"
  if (Test-Path -LiteralPath $CheckpointPath) {
    Remove-Item -LiteralPath $CheckpointPath -Force
  }
  Compress-Archive -Path (Join-Path $Temp "*") -DestinationPath $CheckpointPath -CompressionLevel Optimal

  Write-Host ""
  Write-Host "Mode                    : direct-overwrite-first5" -ForegroundColor Green
  Write-Host "GitCommit               : $Head"
  Write-Host "MaxRows                 : $MaxRows"
  Write-Host "CompletedVerified       : $Completed"
  Write-Host "DirectPublished         : $DirectPublished"
  Write-Host "AlreadyPublished        : $AlreadyPublished"
  Write-Host "ExecutionFailed         : $Failed"
  Write-Host "BackupDumpBytes         : $($DumpItem.Length)"
  Write-Host "BackupDumpSha256        : $(Get-Sha256 $DumpFile)"
  Write-Host "VersionRestore          : False"
  Write-Host "VersionRoundtrip        : False"
  Write-Host "WholeDraftPublication   : False"
  Write-Host "HumanAssessmentMutation : False"
  Write-Host "CheckpointZip           : $CheckpointPath"
  Write-Host "CheckpointZipSha256     : $(Get-Sha256 $CheckpointPath)"
}
finally {
  if ($Temp -and (Test-Path -LiteralPath $Temp)) {
    Remove-Item -LiteralPath $Temp -Recurse -Force
  }
  if (Test-Path -LiteralPath $TestOutput) {
    Remove-Item -LiteralPath $TestOutput -Force
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
