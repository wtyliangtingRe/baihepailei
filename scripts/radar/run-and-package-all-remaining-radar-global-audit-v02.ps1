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

$originalScriptRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $originalScriptRoot '..\..')).Path
$innerRunner = Join-Path $originalScriptRoot 'run-and-package-all-remaining-radar-global-audit-v01.ps1'
if (-not (Test-Path -LiteralPath $innerRunner -PathType Leaf)) {
  throw "找不到 v01 全量审计 runner：$innerRunner"
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

function Save-ProcessEnvironment([string]$Name) {
  return [pscustomobject]@{
    Name = $Name
    Exists = Test-Path "Env:$Name"
    Value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  }
}

function Restore-ProcessEnvironment([object]$Saved) {
  if ($Saved.Exists) {
    [Environment]::SetEnvironmentVariable([string]$Saved.Name, [string]$Saved.Value, 'Process')
  } else {
    [Environment]::SetEnvironmentVariable([string]$Saved.Name, $null, 'Process')
  }
}

Set-Location -LiteralPath $repoRoot
Import-DotEnvFile (Join-Path $repoRoot '.env')
Import-DotEnvFile (Join-Path $repoRoot '.env.local')

$savedRadarEmail = Save-ProcessEnvironment 'RADAR_PAYLOAD_EMAIL'
$savedRadarPassword = Save-ProcessEnvironment 'RADAR_PAYLOAD_PASSWORD'
$email = Get-PayloadCredential @('RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL')
$password = Get-PayloadCredential @('RADAR_PAYLOAD_PASSWORD', 'PAYLOAD_EXPORT_PASSWORD', 'PAYLOAD_SEED_PASSWORD')
$securePassword = $null

if ([string]::IsNullOrWhiteSpace($email)) {
  $email = (Read-Host '请输入 Payload 管理员邮箱').Trim()
  if ([string]::IsNullOrWhiteSpace($email)) {
    throw 'Payload 管理员邮箱不能为空。'
  }
}

if ([string]::IsNullOrWhiteSpace($password)) {
  $securePassword = Read-Host '请输入 Payload 管理员密码（输入不会显示）' -AsSecureString
  $password = ConvertFrom-SecureString $securePassword -AsPlainText
  if ([string]::IsNullOrWhiteSpace($password)) {
    throw 'Payload 管理员密码不能为空。'
  }
}

try {
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $email, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $password, 'Process')

  & $innerRunner `
    -ExpectedBranchHead $ExpectedBranchHead `
    -SourceFile $SourceFile `
    -SourceSummaryFile $SourceSummaryFile `
    -ProductionReceiptDirectory $ProductionReceiptDirectory `
    -PostgresContainer $PostgresContainer `
    -Database $Database `
    -DatabaseUser $DatabaseUser `
    -Port $Port `
    -ReadyTimeoutSeconds $ReadyTimeoutSeconds

  if ($LASTEXITCODE -ne 0) {
    throw "v01 全量审计 runner 返回失败状态：$LASTEXITCODE"
  }
} finally {
  Restore-ProcessEnvironment $savedRadarEmail
  Restore-ProcessEnvironment $savedRadarPassword
  $password = $null
  $securePassword = $null
  [GC]::Collect()
}
