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
$testPath = Join-Path $repoRoot 'tests\radar-public-blocked-inventory-visible-progress.test.mjs'

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

function Quote-PowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Write-NewLogLines([string]$Path, [ref]$Index, [switch]$ErrorStream) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
  if ($lines.Count -le $Index.Value) { return }
  for ($i = $Index.Value; $i -lt $lines.Count; $i += 1) {
    if ($ErrorStream) { Write-Host $lines[$i] -ForegroundColor DarkYellow } else { Write-Host $lines[$i] }
  }
  $Index.Value = $lines.Count
}

foreach ($item in @($innerRunner, $testPath)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { throw "缺少 visible-progress runner 活动文件：$item" }
}
if ($HeartbeatSeconds -lt 1 -or $HeartbeatSeconds -gt 60) { throw "HeartbeatSeconds 超出范围：$HeartbeatSeconds" }

& node --test $testPath
if ($LASTEXITCODE -ne 0) { throw 'Visible progress wrapper 回归测试失败。' }

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
$monitorRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-blocked-visible-progress-' + [Guid]::NewGuid().ToString('N'))
$childScript = Join-Path $monitorRoot 'run-inner.ps1'
$stdoutPath = Join-Path $monitorRoot 'stdout.log'
$stderrPath = Join-Path $monitorRoot 'stderr.log'
$child = $null
$stdoutIndex = 0
$stderrIndex = 0
$startedAt = [DateTime]::UtcNow
$beforeOutputDirs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter 'radar-public-blocked-inventory-*' -ErrorAction SilentlyContinue |
  ForEach-Object { $null = $beforeOutputDirs.Add($_.FullName) }

try {
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $email, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $password, 'Process')
  New-Item -ItemType Directory -Path $monitorRoot -Force | Out-Null

  $inner = Quote-PowerShellLiteral $innerRunner
  $scriptText = @"
`$ErrorActionPreference = 'Stop'
& $inner `
  -ExpectedBranchHead $(Quote-PowerShellLiteral $ExpectedBranchHead) `
  -AuditBundle $(Quote-PowerShellLiteral $AuditBundle) `
  -ProductionReceiptBundle $(Quote-PowerShellLiteral $ProductionReceiptBundle) `
  -ExpectedAuditSHA256 $(Quote-PowerShellLiteral $ExpectedAuditSHA256) `
  -ExpectedProductionReceiptSHA256 $(Quote-PowerShellLiteral $ExpectedProductionReceiptSHA256) `
  -PostgresContainer $(Quote-PowerShellLiteral $PostgresContainer) `
  -Port $Port `
  -ReadyTimeoutSeconds $ReadyTimeoutSeconds `
  -WaveSize $WaveSize
if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }
"@
  [System.IO.File]::WriteAllText($childScript, $scriptText, [System.Text.UTF8Encoding]::new($false))

  Write-Host ''
  Write-Host '凭据已接收，启动可见进度模式。' -ForegroundColor Green
  Write-Host '内部测试与 API 读取日志会实时显示；静默阶段每隔数秒输出状态。' -ForegroundColor Cyan

  $child = Start-Process -FilePath (Get-Command pwsh).Source `
    -ArgumentList @('-NoProfile', '-File', $childScript) `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru `
    -WindowStyle Hidden

  $lastHeartbeat = [DateTime]::MinValue
  while (-not $child.HasExited) {
    Start-Sleep -Milliseconds 500
    Write-NewLogLines $stdoutPath ([ref]$stdoutIndex)
    Write-NewLogLines $stderrPath ([ref]$stderrIndex) -ErrorStream

    if (([DateTime]::UtcNow - $lastHeartbeat).TotalSeconds -ge $HeartbeatSeconds) {
      $lastHeartbeat = [DateTime]::UtcNow
      $elapsed = [int]([DateTime]::UtcNow - $startedAt).TotalSeconds
      $listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
      $newOutput = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter 'radar-public-blocked-inventory-*' -ErrorAction SilentlyContinue |
        Where-Object { -not $beforeOutputDirs.Contains($_.FullName) } |
        Sort-Object LastWriteTimeUtc -Descending)
      $stage = if ($newOutput.Count -gt 0) {
        "正在读取/整理 API 数据；输出目录=$($newOutput[0].Name)"
      } elseif ($listener.Count -gt 0) {
        '本机只读服务已监听；正在登录或分页读取 API'
      } else {
        '正在校验输入、检查 Docker 或启动本机只读服务'
      }
      Write-Host ("[运行状态 {0}s] {1}；子进程 PID={2}" -f $elapsed, $stage, $child.Id) -ForegroundColor DarkCyan
    }
  }

  Write-NewLogLines $stdoutPath ([ref]$stdoutIndex)
  Write-NewLogLines $stderrPath ([ref]$stderrIndex) -ErrorStream
  if ($child.ExitCode -ne 0) {
    $tail = if (Test-Path -LiteralPath $stderrPath) { @(Get-Content -LiteralPath $stderrPath -Tail 40 -Encoding UTF8) -join "`n" } else { '' }
    throw "Radar public blocked inventory v03 失败，exit=$($child.ExitCode)。`n$tail"
  }
} finally {
  if ($null -ne $child -and -not $child.HasExited) {
    & taskkill /PID $child.Id /T /F *> $null
  }
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $previousEmail, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $previousPassword, 'Process')
  $password = $null
  Remove-Item -LiteralPath $monitorRoot -Recurse -Force -ErrorAction SilentlyContinue
}
