param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [Parameter(Mandatory = $true)][string]$ProductionReceiptBundle,
  [string]$ExpectedAuditSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA',
  [string]$ExpectedProductionReceiptSHA256 = 'D1E8114371926C1CDA07D91DD2DB730180D5830ACF691D7CCC6F65DE84CBE6CA',
  [string]$PostgresContainer = 'baihepailei-postgres',
  [int]$Port = 3101,
  [int]$ReadyTimeoutSeconds = 240,
  [int]$WaveSize = 250,
  [int]$HeartbeatSeconds = 5
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
$innerRunner = Join-Path $PSScriptRoot 'run-and-package-radar-public-blocked-inventory-v03.ps1'
$testPath = Join-Path $repoRoot 'tests\radar-public-blocked-inventory-token-readonly.test.mjs'

function Quote-Literal([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

foreach ($item in @($innerRunner, $testPath)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) {
    throw "缺少 token-readonly runner 活动文件：$item"
  }
}
if ($HeartbeatSeconds -lt 1 -or $HeartbeatSeconds -gt 60) {
  throw "HeartbeatSeconds 超出范围：$HeartbeatSeconds"
}

& node --test $testPath
if ($LASTEXITCODE -ne 0) {
  throw 'Token-gated read-only wrapper 回归测试失败。'
}

$tokenBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
$auditToken = [Convert]::ToHexString($tokenBytes).ToLowerInvariant()
$auditEmail = 'radar-readonly-audit@localhost.invalid'

$previousToken = [Environment]::GetEnvironmentVariable('RADAR_READONLY_AUDIT_TOKEN', 'Process')
$previousEmail = [Environment]::GetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', 'Process')
$previousPassword = [Environment]::GetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', 'Process')
$monitorScript = Join-Path $repoRoot ('exports\.radar-blocked-token-monitor-' + [Guid]::NewGuid().ToString('N') + '.ps1')
$monitor = $null
$beforeNames = @(
  Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter 'radar-public-blocked-inventory-*' -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name
)
$beforeLiteral = '@(' + (($beforeNames | ForEach-Object { Quote-Literal $_ }) -join ',') + ')'
$repoLiteral = Quote-Literal $repoRoot
$parentPidValue = $PID
$monitorText = @"
`$ErrorActionPreference = 'SilentlyContinue'
`$repoRoot = $repoLiteral
`$parentPid = $parentPidValue
`$port = $Port
`$heartbeat = $HeartbeatSeconds
`$before = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach (`$name in $beforeLiteral) { `$null = `$before.Add([string]`$name) }
`$started = [DateTime]::UtcNow
while (`$null -ne (Get-Process -Id `$parentPid -ErrorAction SilentlyContinue)) {
  `$elapsed = [int]([DateTime]::UtcNow - `$started).TotalSeconds
  `$listener = @(Get-NetTCPConnection -LocalPort `$port -State Listen -ErrorAction SilentlyContinue)
  `$newDirs = @(Get-ChildItem -LiteralPath (Join-Path `$repoRoot 'exports') -Directory -Filter 'radar-public-blocked-inventory-*' -ErrorAction SilentlyContinue |
    Where-Object { -not `$before.Contains(`$_.Name) } |
    Sort-Object LastWriteTimeUtc -Descending)
  `$nodeChildren = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    `$cmd = [string]`$_.CommandLine
    -not [string]::IsNullOrWhiteSpace(`$cmd) -and
    `$cmd.IndexOf(`$repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    `$cmd -match '(?i)\b(node|next|pnpm)\b'
  })
  `$stage = if (`$newDirs.Count -gt 0) {
    "正在读取或整理 API 数据；输出目录=`$(`$newDirs[0].Name)"
  } elseif (`$listener.Count -gt 0) {
    '本机 3101 已监听；正在使用一次性令牌读取 Payload Local API'
  } elseif (`$nodeChildren.Count -gt 0) {
    "正在执行测试、检查 Docker 或启动 Next；相关 Node 进程=`$(`$nodeChildren.Count)"
  } else {
    '正在进入真实 runner；尚未启动 3101'
  }
  Write-Host ("[只读令牌状态 {0}s] {1}" -f `$elapsed, `$stage) -ForegroundColor DarkCyan
  Start-Sleep -Seconds `$heartbeat
}
"@
[System.IO.File]::WriteAllText($monitorScript, $monitorText, [System.Text.UTF8Encoding]::new($false))

try {
  [Environment]::SetEnvironmentVariable('RADAR_READONLY_AUDIT_TOKEN', $auditToken, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $auditEmail, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $auditToken, 'Process')

  Write-Host ''
  Write-Host '已生成一次性本机只读令牌；不再需要 Payload 邮箱或密码。' -ForegroundColor Green
  Write-Host '数据库继续强制只读；标准生产登录与 REST 行为保持不变。' -ForegroundColor Cyan

  $monitor = Start-Process -FilePath (Get-Command pwsh).Source `
    -ArgumentList @('-NoProfile', '-File', ('"' + $monitorScript + '"')) `
    -NoNewWindow `
    -PassThru

  & $innerRunner `
    -ExpectedBranchHead $ExpectedBranchHead `
    -AuditBundle $AuditBundle `
    -ProductionReceiptBundle $ProductionReceiptBundle `
    -ExpectedAuditSHA256 $ExpectedAuditSHA256 `
    -ExpectedProductionReceiptSHA256 $ExpectedProductionReceiptSHA256 `
    -PostgresContainer $PostgresContainer `
    -Port $Port `
    -ReadyTimeoutSeconds $ReadyTimeoutSeconds `
    -WaveSize $WaveSize
  if ($LASTEXITCODE -ne 0) {
    throw 'Radar public blocked inventory v03 执行失败。'
  }
} finally {
  if ($null -ne $monitor -and -not $monitor.HasExited) {
    Stop-Process -Id $monitor.Id -Force -ErrorAction SilentlyContinue
  }
  [Environment]::SetEnvironmentVariable('RADAR_READONLY_AUDIT_TOKEN', $previousToken, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $previousEmail, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $previousPassword, 'Process')
  $auditToken = $null
  [Array]::Clear($tokenBytes, 0, $tokenBytes.Length)
  Remove-Item -LiteralPath $monitorScript -Force -ErrorAction SilentlyContinue
}
