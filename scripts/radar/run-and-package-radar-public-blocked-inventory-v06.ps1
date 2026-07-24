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
$testPath = Join-Path $repoRoot 'tests\radar-public-blocked-inventory-direct-progress.test.mjs'

function Get-DotEnvValue([string]$Path, [string[]]$Names) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $trimmed = ([string]$line).Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed.StartsWith('export ')) { $trimmed = $trimmed.Substring(7).Trim() }
    $separator = $trimmed.IndexOf('=')
    if ($separator -le 0) { continue }
    $name = $trimmed.Substring(0, $separator).Trim()
    if ($Names -notcontains $name) { continue }
    $value = $trimmed.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  }
  return $null
}

function Get-FirstProcessEnvironmentValue([string[]]$Names) {
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  }
  return $null
}

function Read-MaskedPlainText([string]$Prompt) {
  if ([Console]::IsInputRedirected) { throw '密码输入需要交互式 PowerShell 终端，当前输入被重定向。' }
  Write-Host ''
  Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor DarkCyan
  Write-Host '需要 Payload 管理员密码' -ForegroundColor Cyan
  Write-Host '用途：仅登录本机临时只读审计服务器；不会写入文件或日志。'
  Write-Host '输入时每个字符显示 *；Backspace 可删除；Enter 确认；Esc 或 Ctrl+C 取消。'
  Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor DarkCyan
  Write-Host -NoNewline "$Prompt`: "
  $builder = [System.Text.StringBuilder]::new()
  while ($true) {
    $key = [Console]::ReadKey($true)
    $cancelled = $key.Key -eq [ConsoleKey]::Escape -or (($key.Modifiers -band [ConsoleModifiers]::Control) -and $key.Key -eq [ConsoleKey]::C)
    if ($cancelled) { Write-Host ''; throw '用户取消了 Payload 密码输入。' }
    if ($key.Key -eq [ConsoleKey]::Enter) { Write-Host ''; break }
    if ($key.Key -eq [ConsoleKey]::Backspace) {
      if ($builder.Length -gt 0) { $builder.Length -= 1; [Console]::Write("`b `b") }
      continue
    }
    if (-not [char]::IsControl($key.KeyChar)) { [void]$builder.Append($key.KeyChar); [Console]::Write('*') }
  }
  return $builder.ToString()
}

function Quote-Literal([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

foreach ($item in @($innerRunner, $testPath)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { throw "缺少 direct-progress runner 活动文件：$item" }
}
if ($HeartbeatSeconds -lt 1 -or $HeartbeatSeconds -gt 60) { throw "HeartbeatSeconds 超出范围：$HeartbeatSeconds" }

& node --test $testPath
if ($LASTEXITCODE -ne 0) { throw 'Direct progress wrapper 回归测试失败。' }

$email = Get-FirstProcessEnvironmentValue @('RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL', 'SITE_OWNER_EMAIL')
if ([string]::IsNullOrWhiteSpace($email)) {
  foreach ($path in @((Join-Path $repoRoot '.env'), (Join-Path $repoRoot '.env.local'))) {
    $email = Get-DotEnvValue $path @('SITE_OWNER_EMAIL', 'RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL')
    if (-not [string]::IsNullOrWhiteSpace($email)) { break }
  }
}
if ([string]::IsNullOrWhiteSpace($email)) {
  $email = ([string](Read-Host '请输入 Payload 管理员邮箱')).Trim()
} else {
  $replacementEmail = ([string](Read-Host "Payload 管理员邮箱（直接回车使用 $email）")).Trim()
  if (-not [string]::IsNullOrWhiteSpace($replacementEmail)) { $email = $replacementEmail }
}
if ([string]::IsNullOrWhiteSpace($email)) { throw 'Payload 管理员邮箱不能为空。' }
$password = Read-MaskedPlainText '请输入 Payload 管理员密码'
if ([string]::IsNullOrWhiteSpace($password)) { throw 'Payload 管理员密码不能为空。' }

$previousEmail = [Environment]::GetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', 'Process')
$previousPassword = [Environment]::GetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', 'Process')
$monitorScript = Join-Path $repoRoot ('exports\.radar-blocked-direct-monitor-' + [Guid]::NewGuid().ToString('N') + '.ps1')
$monitor = $null
$beforeNames = @(
  Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter 'radar-public-blocked-inventory-*' -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name
)
$beforeLiteral = '@(' + (($beforeNames | ForEach-Object { Quote-Literal $_ }) -join ',') + ')'
$repoLiteral = Quote-Literal $repoRoot
$monitorText = @"
`$ErrorActionPreference = 'SilentlyContinue'
`$repoRoot = $repoLiteral
`$parentPid = $PID
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
    -not [string]::IsNullOrWhiteSpace(`$cmd) -and `$cmd.IndexOf(`$repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and `$cmd -match '(?i)\b(node|next|pnpm)\b'
  })
  `$stage = if (`$newDirs.Count -gt 0) {
    "正在读取或整理 API 数据；输出目录=`$(`$newDirs[0].Name)"
  } elseif (`$listener.Count -gt 0) {
    '本机 3101 已监听；正在登录 Payload 或分页读取 API'
  } elseif (`$nodeChildren.Count -gt 0) {
    "正在执行测试、检查 Docker 或启动 Next；相关 Node 进程=`$(`$nodeChildren.Count)"
  } else {
    '正在进入真实 runner；尚未启动 3101'
  }
  Write-Host ("[直接运行状态 {0}s] {1}" -f `$elapsed, `$stage) -ForegroundColor DarkCyan
  Start-Sleep -Seconds `$heartbeat
}
"@
[System.IO.File]::WriteAllText($monitorScript, $monitorText, [System.Text.UTF8Encoding]::new($false))

try {
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $email, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $password, 'Process')

  Write-Host ''
  Write-Host '凭据已接收。真正任务将在当前终端直接运行，不再使用隐藏任务子进程。' -ForegroundColor Green
  Write-Host '下面会原样显示第三轮测试和任何真实错误；独立监视器只负责补充状态。' -ForegroundColor Cyan

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
  if ($LASTEXITCODE -ne 0) { throw 'Radar public blocked inventory v03 执行失败。' }
} finally {
  if ($null -ne $monitor -and -not $monitor.HasExited) {
    Stop-Process -Id $monitor.Id -Force -ErrorAction SilentlyContinue
  }
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $previousEmail, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $previousPassword, 'Process')
  $password = $null
  Remove-Item -LiteralPath $monitorScript -Force -ErrorAction SilentlyContinue
}
