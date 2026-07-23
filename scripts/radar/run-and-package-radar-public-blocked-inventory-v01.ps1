param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [Parameter(Mandatory = $true)][string]$ProductionReceiptBundle,
  [string]$ExpectedAuditSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA',
  [string]$ExpectedProductionReceiptSHA256 = 'D1E8114371926C1CDA07D91DD2DB730180D5830ACF691D7CCC6F65DE84CBE6CA',
  [string]$PostgresContainer = 'baihepailei-postgres',
  [int]$Port = 3101,
  [int]$ReadyTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-InputFile([string]$Value, [string]$Label) {
  $candidate = if ([System.IO.Path]::IsPathRooted($Value)) {
    [System.IO.Path]::GetFullPath($Value)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "找不到 $Label：$candidate" }
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
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "缺少 manifest.json：$Directory" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "manifest 文件不存在：$($entry.file)" }
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
    $trimmed = ([string]$line).Trim()
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

function Get-DirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path.Replace('\', '/')
  }
  return @($paths)
}

$currentBranch = ([string](git branch --show-current)).Trim()
$currentHead = ([string](git rev-parse HEAD)).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne $ExpectedBranch) { throw "当前分支不正确：$currentBranch" }
if ($currentHead -ne $ExpectedBranchHead) { throw "当前 HEAD 不是已固定 blocked inventory 版本：$currentHead" }
$unexpectedDirty = @(Get-DirtyPaths | Where-Object { $AllowedDirtyFiles -notcontains $_ })
if ($unexpectedDirty.Count -gt 0) { throw "存在预期之外的本地修改：$($unexpectedDirty -join ', ')" }

$builderPath = Join-Path $PSScriptRoot 'build-radar-public-blocked-inventory-v01.mjs'
if (-not (Test-Path -LiteralPath $builderPath -PathType Leaf)) { throw "缺少 blocked inventory builder：$builderPath" }
& node --check $builderPath
if ($LASTEXITCODE -ne 0) { throw 'Blocked inventory builder 语法检查失败。' }

$auditPath = Resolve-InputFile $AuditBundle '最终全量 Radar audit ZIP'
$receiptBundlePath = Resolve-InputFile $ProductionReceiptBundle 'Radar production receipt ZIP'
$auditHash = (Get-FileHash -LiteralPath $auditPath -Algorithm SHA256).Hash
$receiptHash = (Get-FileHash -LiteralPath $receiptBundlePath -Algorithm SHA256).Hash
if ($auditHash -ne $ExpectedAuditSHA256) { throw "Audit ZIP SHA-256 不匹配：$auditHash" }
if ($receiptHash -ne $ExpectedProductionReceiptSHA256) { throw "Production receipt ZIP SHA-256 不匹配：$receiptHash" }

$existingRepoWriters = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
  $command = [string]$_.CommandLine
  -not [string]::IsNullOrWhiteSpace($command) -and
  $command.IndexOf($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
  $command -match '(?i)\b(node|npm|pnpm|yarn|tsx|bun|deno|python|payload|next)\b'
})
if ($existingRepoWriters.Count -gt 0) {
  $descriptions = $existingRepoWriters | ForEach-Object { "PID=$($_.ProcessId) $($_.CommandLine)" }
  throw "检测到本仓库已有 Node/Payload/Next 等进程，请先停止：`n$($descriptions -join "`n")"
}

Import-DotEnvFile (Join-Path $repoRoot '.env')
Import-DotEnvFile (Join-Path $repoRoot '.env.local')
$email = Get-PayloadCredential @('RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL')
$password = Get-PayloadCredential @('RADAR_PAYLOAD_PASSWORD', 'PAYLOAD_EXPORT_PASSWORD', 'PAYLOAD_SEED_PASSWORD')
if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrWhiteSpace($password)) {
  throw '缺少 Payload 只读审计登录凭据。'
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$postgresRunning = ([string](& docker inspect -f '{{.State.Running}}' $PostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $postgresRunning -ne 'true') { throw "PostgreSQL 容器未运行：$PostgresContainer" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-public-blocked-inventory-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-PUBLIC-BLOCKED-INVENTORY-$stamp.zip"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-public-blocked-inventory-' + [Guid]::NewGuid().ToString('N'))
$auditDir = Join-Path $tempRoot 'audit'
$receiptDir = Join-Path $tempRoot 'receipt'
New-Item -ItemType Directory -Path $auditDir, $receiptDir -Force | Out-Null
Expand-Archive -LiteralPath $auditPath -DestinationPath $auditDir -Force
Expand-Archive -LiteralPath $receiptBundlePath -DestinationPath $receiptDir -Force
Test-Manifest $auditDir
Test-Manifest $receiptDir

$auditSummary = Get-Content -LiteralPath (Join-Path $auditDir 'all-remaining-radar-global-audit-summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$productionReceipt = Get-Content -LiteralPath (Join-Path $receiptDir 'production-apply-receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($auditSummary.source.rows -ne 10805 -or $auditSummary.publicTrack.blocked -ne 1805 -or $auditSummary.privateTrack.blocked -ne 1444) {
  throw '输入 audit 摘要不符合锁定的 10,805 / 1,805 / 1,444 基线。'
}
if ($productionReceipt.productionPublicRowsWritten -ne 9000 -or
    $productionReceipt.productionAcceptancePassed -ne $true -or
    $productionReceipt.productionTableDeltasMatched -ne $true) {
  throw '生产 receipt 未证明 9,000 条公共结论成功写入。'
}

$serverStdout = Join-Path $tempRoot 'blocked-inventory-server-stdout.log'
$serverStderr = Join-Path $tempRoot 'blocked-inventory-server-stderr.log'
$serverScript = Join-Path $tempRoot 'start-blocked-inventory-server.ps1'
$baseUrl = "http://127.0.0.1:$Port"
$server = $null
$serverStopped = $false
$escapedRepo = $repoRoot.Replace("'", "''")
$serverText = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$escapedRepo'
`$env:PAYLOAD_DB_PUSH = 'false'
`$env:RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
`$env:PGOPTIONS = '-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning'
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
    if ($server.HasExited) { throw "Blocked inventory 专用 Next 服务器提前退出：$($server.ExitCode)" }
    try {
      $loginBody = @{ email = $email; password = $password } | ConvertTo-Json -Compress
      $login = Invoke-RestMethod -Uri "$baseUrl/api/users/login" -Method Post -ContentType 'application/json' -Body $loginBody -TimeoutSec 8
      if (-not [string]::IsNullOrWhiteSpace([string]$login.token)) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $ready) { throw 'Blocked inventory 专用 Next 服务器未在限时内就绪。' }

  & node $builderPath `
    --audit-dir $auditDir `
    --production-receipt-dir $receiptDir `
    --out-dir $outDir `
    --url $baseUrl
  if ($LASTEXITCODE -ne 0) { throw 'Blocked inventory builder 执行失败。' }
} finally {
  if ($null -ne $server) {
    Stop-ProcessTree -ProcessId $server.Id
    Start-Sleep -Seconds 1
    $serverStopped = $null -eq (Get-Process -Id $server.Id -ErrorAction SilentlyContinue)
  }
}

if (-not $serverStopped) { throw 'Blocked inventory 专用 Next 服务器未确认停止。' }
if (-not (Test-Path -LiteralPath $outDir -PathType Container)) { throw 'Blocked inventory 输出目录不存在。' }
Copy-Item -LiteralPath $serverStdout -Destination (Join-Path $outDir 'blocked-inventory-server-stdout.log') -Force
Copy-Item -LiteralPath $serverStderr -Destination (Join-Path $outDir 'blocked-inventory-server-stderr.log') -Force

$summaryPath = Join-Path $outDir 'radar-public-blocked-inventory-summary.json'
$summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($summary.inventory.rows -ne 1805 -or
    $summary.inventory.uniqueWorkIds -ne 1805 -or
    $summary.currentProduction.draftWorksRead -ne 35615 -or
    $summary.currentProduction.publishedWorksRead -ne 35615 -or
    $summary.currentProduction.currentPublicConclusionsRead -ne 9000 -or
    $summary.globalBlockers.Count -ne 0 -or
    $summary.readyForRemediationPlanning -ne $true -or
    $summary.safety.payloadWrite -ne $false -or
    $summary.safety.directPostgresqlWrite -ne $false) {
  throw 'Blocked inventory 摘要未达到只读修复规划门槛。'
}

Write-Json -Path (Join-Path $outDir 'blocked-inventory-run-validation.json') -Value ([ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  branchHead = $currentHead
  auditBundleSha256 = $auditHash.ToLowerInvariant()
  productionReceiptBundleSha256 = $receiptHash.ToLowerInvariant()
  inventoryRows = 1805
  uniqueWorkIds = 1805
  draftWorksRead = 35615
  publishedWorksRead = 35615
  currentPublicConclusionsRead = 9000
  latestValidConflictPolicyApplied = $true
  dedicatedAuditServerPort = $Port
  dedicatedAuditServerStopped = $serverStopped
  databaseReadOnlyEnforcedByPgOptions = $true
  payloadRead = $true
  payloadWrite = $false
  payloadPatchRequests = 0
  directPostgresqlWrite = $false
  migrationGenerated = $false
  migrationExecuted = $false
  schemaPush = $false
  productionApplyAuthorized = $false
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
Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Radar 公共 blocked inventory 已完成' -ForegroundColor Green
Write-Host "OutputDirectory                 : $outDir"
Write-Host "Bundle                          : $bundlePath"
Write-Host "BundleSHA256                    : $($bundleHash.Hash)"
Write-Host "InventoryRows                   : $($summary.inventory.rows)"
Write-Host "UniqueWorkIds                   : $($summary.inventory.uniqueWorkIds)"
Write-Host "WithConflicts                   : $($summary.inventory.withConflicts)"
Write-Host "WithDecisiveConflicts           : $($summary.inventory.withDecisiveConflicts)"
Write-Host "WithHumanTrack                  : $($summary.inventory.withHumanTrack)"
Write-Host "CurrentPublicConclusionsRead    : $($summary.currentProduction.currentPublicConclusionsRead)"
Write-Host "GlobalBlockers                  : $($summary.globalBlockers.Count)"
Write-Host "ReadyForRemediationPlanning     : $($summary.readyForRemediationPlanning)"
Write-Host 'PayloadWrite                    : False'
Write-Host 'PostgreSQLWrite                 : False'
Write-Host 'ProductionApplyAuthorized       : False'
Write-Host 'DedicatedAuditServer            : Stopped'
