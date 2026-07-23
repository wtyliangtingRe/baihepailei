param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [string]$SourceFile = 'data_local\staging\ai-radar\v06-package-import-v01\ai-radar-v06-package-import-v01.jsonl',
  [string]$SourceSummaryFile = 'data_local\staging\ai-radar\v06-package-import-v01\ai-radar-v06-package-import-v01-summary.json',
  [string]$ProductionReceiptDirectory = 'exports\test-work-production-apply-20260723-180731',
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe',
  [int]$Port = 3101,
  [int]$ReadyTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-RepoFile([string]$Value, [string]$Label) {
  $candidate = if ([System.IO.Path]::IsPathRooted($Value)) {
    [System.IO.Path]::GetFullPath($Value)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "找不到 $Label：$candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Resolve-RepoDirectory([string]$Value, [string]$Label) {
  $candidate = if ([System.IO.Path]::IsPathRooted($Value)) {
    [System.IO.Path]::GetFullPath($Value)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    throw "找不到 $Label：$candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Test-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "manifest 文件不存在：$($entry.file)"
    }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    $bytes = (Get-Item -LiteralPath $file).Length
    if ($bytes -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
}

function Import-DotEnvFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $trimmed = [string]$line
    $trimmed = $trimmed.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed.StartsWith('export ')) { $trimmed = $trimmed.Substring(7).Trim() }
    $separator = $trimmed.IndexOf('=')
    if ($separator -le 0) { continue }
    $name = $trimmed.Substring(0, $separator).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    if (Test-Path "Env:$name") { continue }
    $value = $trimmed.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Get-PayloadCredential([string[]]$Names) {
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  }
  return $null
}

function Stop-ProcessTree([int]$ProcessId) {
  & taskkill /PID $ProcessId /T /F *> $null
  if ($LASTEXITCODE -ne 0) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -ne $process) { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

$currentBranch = (git branch --show-current).Trim()
$currentHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne 'agent/radar-public-conclusions-v01') {
  throw "当前分支不正确：$currentBranch"
}
if ($currentHead -ne $ExpectedBranchHead) {
  throw "当前 HEAD 不是已固定审计版本：$currentHead"
}

$sourcePath = Resolve-RepoFile $SourceFile 'v0.6 全量来源文件'
$sourceSummaryPath = Resolve-RepoFile $SourceSummaryFile 'v0.6 来源摘要'
$receiptDir = Resolve-RepoDirectory $ProductionReceiptDirectory 'Test Work production receipt 目录'
Test-Manifest $receiptDir
$receiptPath = Resolve-RepoFile (Join-Path $receiptDir 'production-apply-receipt.json') 'Test Work production receipt'

$sourceSummary = Get-Content -LiteralPath $sourceSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($sourceSummary.rowsRead -ne 10805 -or
    $sourceSummary.readyForPayloadPlanning -ne 9364 -or
    $sourceSummary.blockedBeforePayloadPlanning -ne 1441 -or
    $sourceSummary.publicationGuardRows -ne 698) {
  throw 'v0.6 来源摘要不符合锁定的 10,805 条来源全集。'
}

Import-DotEnvFile (Join-Path $repoRoot '.env')
Import-DotEnvFile (Join-Path $repoRoot '.env.local')
$email = Get-PayloadCredential @('RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL')
$password = Get-PayloadCredential @('RADAR_PAYLOAD_PASSWORD', 'PAYLOAD_EXPORT_PASSWORD', 'PAYLOAD_SEED_PASSWORD')
if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrWhiteSpace($password)) {
  throw '缺少 Payload 审计登录凭据；不会启动审计服务器。'
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$running = (& docker inspect -f '{{.State.Running}}' $PostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
  throw "PostgreSQL 容器未运行：$PostgresContainer"
}

$schemaStdout = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-global-audit-schema-" + [guid]::NewGuid().ToString('N') + '.txt')
$schemaStderr = "$schemaStdout.stderr"
& docker exec `
  -e 'PGOPTIONS=-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning' `
  $PostgresContainer `
  psql -X -qAt -v ON_ERROR_STOP=1 -U $DatabaseUser -d $Database `
  -c "SELECT CASE WHEN to_regclass('public.radar_public') IS NULL THEN 'false' ELSE 'true' END;" `
  1> $schemaStdout 2> $schemaStderr
if ($LASTEXITCODE -ne 0) {
  throw '读取 radar_public schema 状态失败。'
}
$schemaErrors = @(Get-Content -LiteralPath $schemaStderr -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($schemaErrors.Count -ne 0) { throw 'radar_public schema 只读查询 stderr 非空。' }
$publicSchemaReady = (Get-Content -LiteralPath $schemaStdout -Raw -Encoding UTF8).Trim().ToLowerInvariant()
if ($publicSchemaReady -notin @('true', 'false')) { throw "无法解析 radar_public schema 状态：$publicSchemaReady" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\all-remaining-radar-global-audit-$stamp"
$bundlePath = Join-Path $repoRoot "exports\ALL-REMAINING-RADAR-GLOBAL-AUDIT-$stamp.zip"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("baihepailei-global-radar-audit-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$serverStdout = Join-Path $tempRoot 'audit-server-stdout.log'
$serverStderr = Join-Path $tempRoot 'audit-server-stderr.log'
$serverScript = Join-Path $tempRoot 'start-audit-server.ps1'
$baseUrl = "http://127.0.0.1:$Port"
$server = $null
$serverStopped = $false

$escapedRepo = $repoRoot.Replace("'", "''")
$serverText = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$escapedRepo'
`$env:PAYLOAD_DB_PUSH = 'false'
`$env:RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = '$publicSchemaReady'
pnpm exec next dev -p $Port
"@
[System.IO.File]::WriteAllText($serverScript, $serverText, [System.Text.UTF8Encoding]::new($false))

try {
  $server = Start-Process `
    -FilePath (Get-Command pwsh).Source `
    -ArgumentList @('-NoProfile', '-File', $serverScript) `
    -RedirectStandardOutput $serverStdout `
    -RedirectStandardError $serverStderr `
    -PassThru `
    -WindowStyle Hidden

  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  $ready = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($server.HasExited) {
      throw "审计专用 Next 服务器提前退出：$($server.ExitCode)"
    }
    try {
      $loginBody = @{ email = $email; password = $password } | ConvertTo-Json -Compress
      $login = Invoke-RestMethod `
        -Uri "$baseUrl/api/users/login" `
        -Method Post `
        -ContentType 'application/json' `
        -Body $loginBody `
        -TimeoutSec 8
      if (-not [string]::IsNullOrWhiteSpace([string]$login.token)) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ready) { throw '审计专用 Next 服务器未在限时内就绪。' }

  & node (Join-Path $PSScriptRoot 'build-all-remaining-radar-global-audit-v02.mjs') `
    --source $sourcePath `
    --source-summary $sourceSummaryPath `
    --production-receipt $receiptPath `
    --out-dir $outDir `
    --url $baseUrl `
    --public-schema-ready $publicSchemaReady
  if ($LASTEXITCODE -ne 0) { throw '全量剩余 Radar 唯一审计失败。' }
} finally {
  if ($null -ne $server) {
    Stop-ProcessTree -ProcessId $server.Id
    Start-Sleep -Seconds 1
    $serverStopped = $null -eq (Get-Process -Id $server.Id -ErrorAction SilentlyContinue)
  }
}

if (-not $serverStopped) { throw '审计专用 Next 服务器未确认停止。' }
if (-not (Test-Path -LiteralPath $outDir -PathType Container)) { throw '全量审计输出目录不存在。' }

Copy-Item -LiteralPath $serverStdout -Destination (Join-Path $outDir 'audit-server-stdout.log') -Force
Copy-Item -LiteralPath $serverStderr -Destination (Join-Path $outDir 'audit-server-stderr.log') -Force
Copy-Item -LiteralPath $schemaStdout -Destination (Join-Path $outDir 'public-schema-readonly-stdout.txt') -Force
Copy-Item -LiteralPath $schemaStderr -Destination (Join-Path $outDir 'public-schema-readonly-stderr.txt') -Force

$summaryPath = Join-Path $outDir 'all-remaining-radar-global-audit-summary.json'
$summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($summary.source.rows -ne 10805 -or
    $summary.production.worksRead -ne 35615 -or
    $summary.globalBlockers.Count -ne 0 -or
    $summary.readyForSingleExecutionPlanning -ne $true -or
    $summary.safety.payloadWrite -ne $false -or
    $summary.safety.directPostgresqlWrite -ne $false) {
  throw '全量审计摘要未达到直接执行规划门槛。'
}

Write-Json -Path (Join-Path $outDir 'audit-run-validation.json') -Value ([ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  branchHead = $currentHead
  sourceRows = 10805
  productionWorksRead = 35615
  publicSchemaReady = ($publicSchemaReady -eq 'true')
  dedicatedAuditServerPort = $Port
  dedicatedAuditServerStopped = $serverStopped
  payloadRead = $true
  payloadWrite = $false
  payloadPatchRequests = 0
  postgresqlSchemaReadOnly = $true
  postgresqlWrite = $false
  migrationGenerated = $false
  migrationExecuted = $false
  schemaPush = $false
  readyForSingleExecutionPlanning = $true
})

$files = @(Get-ChildItem -LiteralPath $outDir -File | Where-Object Name -ne 'manifest.json' | Sort-Object Name)
$manifest = @($files | ForEach-Object {
  $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
  [ordered]@{ file = $_.Name; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
})
Write-Json -Path (Join-Path $outDir 'manifest.json') -Value $manifest

foreach ($entry in $manifest) {
  $file = Join-Path $outDir ([string]$entry.file)
  $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
  if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
    throw "最终 manifest 校验失败：$($entry.file)"
  }
}

$paths = @((Get-ChildItem -LiteralPath $outDir -File | Sort-Object Name).FullName)
Compress-Archive -LiteralPath $paths -DestinationPath $bundlePath -CompressionLevel Optimal -Force
$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Remove-Item -LiteralPath $schemaStdout, $schemaStderr -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '全量剩余 Radar 唯一审计完成' -ForegroundColor Green
Write-Host "OutputDirectory                : $outDir"
Write-Host "Bundle                         : $bundlePath"
Write-Host "SHA256                         : $($bundleHash.Hash)"
Write-Host "SourceRows                     : $($summary.source.rows)"
Write-Host "ProductionWorksRead            : $($summary.production.worksRead)"
Write-Host "PrivateReadyToWrite            : $($summary.privateTrack.readyToWrite)"
Write-Host "PrivateAlreadyCurrent          : $($summary.privateTrack.alreadyCurrent)"
Write-Host "PrivateBlocked                 : $($summary.privateTrack.blocked)"
Write-Host "PublicReadyToWrite             : $($summary.publicTrack.readyToWrite)"
Write-Host "PublicAlreadyCurrent           : $($summary.publicTrack.alreadyCurrent)"
Write-Host "PublicBlocked                  : $($summary.publicTrack.blocked)"
Write-Host "PublicSchemaCreationRequired   : $($summary.publicTrack.schemaCreationRequired)"
Write-Host "DiscardedTestAssessmentRows    : $($summary.discardedTestAssessmentRows)"
Write-Host "GlobalBlockers                 : $($summary.globalBlockers.Count)"
Write-Host "ReadyForSingleExecutionPlanning: $($summary.readyForSingleExecutionPlanning)"
Write-Host ''
Write-Host 'PayloadWrite                   : False'
Write-Host 'PostgreSQLWrite                : False'
Write-Host 'MigrationGenerated             : False'
Write-Host 'SchemaPush                     : False'
Write-Host 'DedicatedAuditServer           : Stopped'
