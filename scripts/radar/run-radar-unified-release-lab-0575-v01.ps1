param(
  [Parameter(Mandatory = $true)][string]$ExpectedWebsiteHead,
  [Parameter(Mandatory = $true)][ValidateSet('RUN-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$SourcePostgresContainer = 'baihepailei-postgres'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-unified-release-lab-0575-v01'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Invoke-Checked([string]$Label, [scriptblock]$Action) {
  Write-Host ''
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Label 失败（退出码 $LASTEXITCODE）。" }
}

function Invoke-WithEnvironment([hashtable]$Variables, [scriptblock]$Action) {
  $saved = @{}
  foreach ($name in $Variables.Keys) {
    $saved[$name] = [pscustomobject]@{
      Exists = Test-Path "Env:$name"
      Value = [Environment]::GetEnvironmentVariable([string]$name, 'Process')
    }
    [Environment]::SetEnvironmentVariable([string]$name, [string]$Variables[$name], 'Process')
  }
  try { & $Action } finally {
    foreach ($name in $Variables.Keys) {
      if ($saved[$name].Exists) {
        [Environment]::SetEnvironmentVariable([string]$name, [string]$saved[$name].Value, 'Process')
      } else {
        [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process')
      }
    }
  }
}

function Get-ConfiguredValue([string[]]$Names) {
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return [pscustomobject]@{ Value = $value.Trim(); Source = "process:$name" }
    }
  }
  foreach ($envFile in @('.env.development.local', '.env.local', '.env.development', '.env')) {
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { continue }
    $lines = @(Microsoft.PowerShell.Management\Get-Content -LiteralPath $envFile -Encoding UTF8)
    foreach ($name in $Names) {
      $escaped = [regex]::Escape($name)
      $line = $lines | Where-Object { $_ -match "^\s*$escaped\s*=" } | Select-Object -First 1
      if ($line) {
        $value = (($line -split '=', 2)[1].Trim()).Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($value)) {
          return [pscustomobject]@{ Value = $value; Source = "$envFile`:$name" }
        }
      }
    }
  }
  return $null
}

function ConvertFrom-SecureStringInMemory([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-LabAdministratorCredentials {
  $emailResult = Get-ConfiguredValue @('RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL', 'SITE_OWNER_EMAIL')
  $passwordResult = Get-ConfiguredValue @('RADAR_PAYLOAD_PASSWORD', 'PAYLOAD_EXPORT_PASSWORD', 'PAYLOAD_SEED_PASSWORD')

  if ($emailResult) {
    $email = [string]$emailResult.Value
    $emailSource = [string]$emailResult.Source
  } else {
    $email = (Read-Host '请输入已存在的 Payload owner/admin 邮箱').Trim()
    $emailSource = 'interactive-email-prompt'
  }
  if ([string]::IsNullOrWhiteSpace($email)) { throw 'Payload 管理员邮箱不能为空。' }
  try { [void][System.Net.Mail.MailAddress]::new($email) } catch { throw 'Payload 管理员邮箱格式无效。' }

  if ($passwordResult) {
    $password = [string]$passwordResult.Value
    $passwordSource = [string]$passwordResult.Source
  } else {
    $securePassword = Read-Host '请输入该 Payload 账号密码（输入不会显示）' -AsSecureString
    $password = ConvertFrom-SecureStringInMemory $securePassword
    $securePassword = $null
    $passwordSource = 'interactive-secure-prompt'
  }
  if ([string]::IsNullOrWhiteSpace($password)) { throw 'Payload 管理员密码不能为空。' }

  return [pscustomobject]@{
    Email = $email
    Password = $password
    EmailSource = $emailSource
    PasswordSource = $passwordSource
  }
}

function Get-ExactContainerIds([string]$Name) {
  return @(
    docker ps -aq --filter "name=^/${Name}$" |
      ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ }
  )
}

function Ensure-SourcePostgres([string]$Name) {
  & docker version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
  $ids = @(Get-ExactContainerIds $Name)
  if ($ids.Count -gt 1) { throw "发现多个同名源 PostgreSQL 容器：$Name" }
  if ($ids.Count -eq 0) {
    Write-Host "未找到 $Name；由 Docker Compose 创建。" -ForegroundColor Yellow
    & docker compose up -d postgres
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 创建源 PostgreSQL 失败。' }
    $ids = @(Get-ExactContainerIds $Name)
    if ($ids.Count -ne 1) { throw "Compose 完成后仍无法唯一定位源容器：$Name" }
  } else {
    $running = ([string](& docker inspect -f '{{.State.Running}}' $Name)).Trim()
    if ($LASTEXITCODE -ne 0) { throw "无法读取源容器状态：$Name" }
    if ($running -ne 'true') {
      Write-Host "源容器已存在但未运行，正在启动：$Name" -ForegroundColor Yellow
      & docker start $Name | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "启动源容器失败：$Name" }
    } else {
      Write-Host "复用正在运行的源容器：$Name" -ForegroundColor Green
    }
  }
  $finalRunning = ([string](& docker inspect -f '{{.State.Running}}' $Name)).Trim()
  if ($LASTEXITCODE -ne 0 -or $finalRunning -ne 'true') { throw "源容器未处于运行状态：$Name" }
}

function Convert-LabCreatedAtForExecutor([string]$Path) {
  $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  $pattern = '"createdAt"\s*:\s*"(?<value>[^"]+)"'
  $regex = [regex]::new($pattern)
  $match = $regex.Match($raw)
  if (-not $match.Success) { throw '实验环境缺少 createdAt。' }
  $createdAt = [DateTimeOffset]::ParseExact(
    $match.Groups['value'].Value,
    'o',
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::RoundtripKind
  ).UtcDateTime
  $now = [DateTime]::UtcNow
  if ($createdAt -gt $now.AddMinutes(5)) { throw '实验环境 createdAt 位于未来。' }
  if ($createdAt -lt $now.AddHours(-4)) { throw '实验环境已超过 4 小时。' }
  $portable = $createdAt.ToString('r', [System.Globalization.CultureInfo]::InvariantCulture)
  $updated = $regex.Replace($raw, ('"createdAt": "' + $portable + '"'), 1)
  [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
  Write-Host "实验环境 UTC 时间已标准化：$portable" -ForegroundColor Green
}

function Remove-RunLabResources([string]$EnvironmentPath) {
  if (-not (Test-Path -LiteralPath $EnvironmentPath -PathType Leaf)) { return }
  try {
    $lab = Get-Content -LiteralPath $EnvironmentPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
    $labContainer = [string]$lab.labContainer
    if ($labContainer -match '^baihepailei-radar-unified-release-lab-[0-9]{8}-[0-9]{6}$') {
      $ids = @(Get-ExactContainerIds $labContainer)
      if ($ids.Count -eq 1) { & docker rm -f $labContainer 2>$null | Out-Null }
    }
    $backupRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'data_local\backups\radar-unified-release-lab-0575-v01'))
    $backupValue = [string]$lab.backupPath
    if ($backupValue) {
      $backupPath = [System.IO.Path]::GetFullPath($backupValue)
      $backupPrefix = $backupRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
      if ($backupPath.StartsWith($backupPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Write-Host "本轮实验资源兜底清理警告：$($_.Exception.Message)" -ForegroundColor Yellow
  } finally {
    Remove-Item -LiteralPath $EnvironmentPath -Force -ErrorAction SilentlyContinue
  }
}

if ($Confirm -ne 'RUN-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01') { throw '确认字符串不匹配。' }
$unexpected = @(
  git status --short |
    ForEach-Object { if ($_ -and $_.Length -ge 4) { $_.Substring(3).Trim().Replace('\', '/') } } |
    Where-Object { $_ -and $_ -notin @('next-env.d.ts', 'payload-types.ts') }
)
if ($unexpected.Count -gt 0) { throw "网站仓库存在预期外本地修改：$($unexpected -join ', ')" }

Invoke-Checked '获取远端更新' { git fetch origin }
Invoke-Checked '切换统一 Release 隔离实验室分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到隔离实验室最新提交' { git pull --ff-only origin $ExpectedBranch }
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $ExpectedWebsiteHead -or $remoteHead -ne $ExpectedWebsiteHead) {
  throw "实验室提交不符合预期：local=$localHead remote=$remoteHead expected=$ExpectedWebsiteHead"
}

Write-Host ''
Write-Host '==> 预检 Payload 管理员凭据' -ForegroundColor Cyan
$credentials = Get-LabAdministratorCredentials
Write-Host "管理员邮箱来源：$($credentials.EmailSource)" -ForegroundColor Green
Write-Host "管理员密码来源：$($credentials.PasswordSource)" -ForegroundColor Green
Write-Host '凭据仅保留在当前进程内存中，不写入文件或命令参数。' -ForegroundColor Green

$environmentFile = $null
try {
  Ensure-SourcePostgres $SourcePostgresContainer
  $runStartedAt = Get-Date

  Invoke-Checked 'Phase 1：准备统一 Release 隔离数据库克隆' {
    & pwsh -NoProfile -ExecutionPolicy Bypass `
      -File '.\scripts\radar\prepare-radar-unified-release-lab-database-0575-v01.ps1' `
      -ExpectedWebsiteHead $ExpectedWebsiteHead `
      -ResearchRepo $ResearchRepo `
      -SourcePostgresContainer $SourcePostgresContainer `
      -Confirm 'PREPARE-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01'
  }

  $environmentFile = Get-ChildItem `
      -LiteralPath '.\data_local\outputs\radar-unified-release-lab-0575-v01' `
      -Filter 'radar-unified-release-lab-environment-0575-v01.json' `
      -File -Recurse |
    Where-Object { $_.LastWriteTime -ge $runStartedAt.AddMinutes(-1) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $environmentFile) { throw '没有找到本轮生成的统一 Release 隔离环境文件。' }

  Write-Host ''
  Write-Host "隔离环境：$($environmentFile.FullName)" -ForegroundColor Green
  try {
    Convert-LabCreatedAtForExecutor $environmentFile.FullName
    Invoke-WithEnvironment -Variables @{
      RADAR_PAYLOAD_EMAIL = [string]$credentials.Email
      RADAR_PAYLOAD_PASSWORD = [string]$credentials.Password
    } -Action {
      Invoke-Checked 'Phase 2：临时迁移与 575 + 575 导入验收' {
        & pwsh -NoProfile -ExecutionPolicy Bypass `
          -File '.\scripts\radar\execute-radar-unified-release-lab-0575-v01.ps1' `
          -EnvironmentFile $environmentFile.FullName `
          -ExpectedWebsiteHead $ExpectedWebsiteHead `
          -Confirm 'EXECUTE-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01'
      }
    }
  } catch {
    Remove-RunLabResources $environmentFile.FullName
    throw
  }
} finally {
  if ($credentials) {
    $credentials.Password = $null
    $credentials.Email = $null
  }
  $credentials = $null
}

Write-Host ''
Write-Host '统一 575 条 Release 隔离实验室完整执行成功。' -ForegroundColor Green
Write-Host "WebsiteHead : $ExpectedWebsiteHead"
Write-Host "SourceContainerReusedOrStarted : $SourcePostgresContainer"
Write-Host 'SourceDatabaseWrite : False'
Write-Host 'ProductionAuthorization : False'
