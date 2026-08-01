param(
  [Parameter(Mandatory = $true)][string]$ExpectedWebsiteHead,
  [Parameter(Mandatory = $true)][ValidateSet('RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$SourcePostgresContainer = 'baihepailei-postgres'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-release-lab-v01'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Invoke-Checked([string]$Label, [scriptblock]$Action) {
  Write-Host ''
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Label 失败（退出码 $LASTEXITCODE）。" }
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
  $createdAtPattern = '"createdAt"\s*:\s*"(?<value>[^"]+)"'
  $createdAtRegex = [regex]::new($createdAtPattern)
  $match = $createdAtRegex.Match($raw)
  if (-not $match.Success) { throw '实验环境缺少 createdAt。' }

  $createdAt = [DateTimeOffset]::ParseExact(
    $match.Groups['value'].Value,
    'o',
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::RoundtripKind
  ).UtcDateTime
  $now = [DateTime]::UtcNow
  if ($createdAt -gt $now.AddMinutes(5)) { throw '实验环境 createdAt 位于未来，拒绝继续。' }
  if ($createdAt -lt $now.AddHours(-4)) { throw '实验环境已超过 4 小时，必须重新从 fresh dump 准备。' }

  # PowerShell 7.5+ may deserialize ISO JSON dates into DateTime. The executor then
  # casts that value to a culture-specific string and can subtract the local UTC
  # offset a second time. RFC 1123 remains a JSON string while preserving UTC.
  $portableCreatedAt = $createdAt.ToString('r', [System.Globalization.CultureInfo]::InvariantCulture)
  $replacement = '"createdAt": "' + $portableCreatedAt + '"'
  $updated = $createdAtRegex.Replace($raw, $replacement, 1)
  [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))

  Write-Host "实验环境 UTC 时间已标准化：$portableCreatedAt" -ForegroundColor Green
}

function Remove-RunLabResources([string]$EnvironmentPath) {
  if (-not (Test-Path -LiteralPath $EnvironmentPath -PathType Leaf)) { return }

  try {
    $lab = Get-Content -LiteralPath $EnvironmentPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
    $labContainer = [string]$lab.labContainer
    if ($labContainer -match '^baihepailei-radar-public-release-lab-[0-9]{8}-[0-9]{6}$') {
      $ids = @(Get-ExactContainerIds $labContainer)
      if ($ids.Count -eq 1) {
        & docker rm -f $labContainer 2>$null | Out-Null
      }
    }

    $backupRoot = [System.IO.Path]::GetFullPath(
      (Join-Path $repoRoot 'data_local\backups\radar-public-release-lab-v01')
    )
    $backupPathValue = [string]$lab.backupPath
    if ($backupPathValue) {
      $backupPath = [System.IO.Path]::GetFullPath($backupPathValue)
      $backupPrefix = $backupRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
      if ($backupPath.StartsWith($backupPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Write-Host "本轮实验资源兜底清理出现警告：$($_.Exception.Message)" -ForegroundColor Yellow
  } finally {
    Remove-Item -LiteralPath $EnvironmentPath -Force -ErrorAction SilentlyContinue
  }
}

if ($Confirm -ne 'RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01') { throw '确认字符串不匹配。' }

$unexpected = @(
  git status --short |
    ForEach-Object { if ($_ -and $_.Length -ge 4) { $_.Substring(3).Trim().Replace('\', '/') } } |
    Where-Object { $_ -and $_ -notin @('next-env.d.ts', 'payload-types.ts') }
)
if ($unexpected.Count -gt 0) { throw "网站仓库存在预期外本地修改：$($unexpected -join ', ')" }

Invoke-Checked '获取远端更新' { git fetch origin }
Invoke-Checked '切换隔离实验室分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到隔离实验室最新提交' { git pull --ff-only origin $ExpectedBranch }

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $ExpectedWebsiteHead -or $remoteHead -ne $ExpectedWebsiteHead) {
  throw "实验室提交不符合预期：local=$localHead remote=$remoteHead expected=$ExpectedWebsiteHead"
}

Ensure-SourcePostgres $SourcePostgresContainer
$runStartedAt = Get-Date

Invoke-Checked 'Phase 1：准备隔离数据库克隆' {
  & pwsh -NoProfile -ExecutionPolicy Bypass `
    -File '.\scripts\radar\prepare-radar-public-release-lab-database-v01.ps1' `
    -ExpectedWebsiteHead $ExpectedWebsiteHead `
    -ResearchRepo $ResearchRepo `
    -SourcePostgresContainer $SourcePostgresContainer `
    -Confirm 'PREPARE-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01'
}

$environmentFile = Get-ChildItem `
    -LiteralPath '.\data_local\outputs\radar-public-release-v01' `
    -Filter 'radar-public-release-lab-environment-v01.json' `
    -File `
    -Recurse |
  Where-Object { $_.LastWriteTime -ge $runStartedAt.AddMinutes(-1) } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $environmentFile) { throw '没有找到本轮生成的隔离环境文件。' }

Write-Host ''
Write-Host "隔离环境：$($environmentFile.FullName)" -ForegroundColor Green

try {
  Convert-LabCreatedAtForExecutor $environmentFile.FullName
  Invoke-Checked 'Phase 2：临时数据库迁移与 520 条导入' {
    & pwsh -NoProfile -ExecutionPolicy Bypass `
      -File '.\scripts\radar\execute-radar-public-release-lab-v01.ps1' `
      -EnvironmentFile $environmentFile.FullName `
      -ExpectedWebsiteHead $ExpectedWebsiteHead `
      -Confirm 'EXECUTE-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01'
  }
} catch {
  Remove-RunLabResources $environmentFile.FullName
  throw
}

Write-Host ''
Write-Host '隔离实验室完整执行成功。' -ForegroundColor Green
Write-Host "WebsiteHead : $ExpectedWebsiteHead"
Write-Host "SourceContainerReusedOrStarted : $SourcePostgresContainer"
Write-Host 'SourceDatabaseWrite : False'
Write-Host 'ProductionAuthorization : False'
