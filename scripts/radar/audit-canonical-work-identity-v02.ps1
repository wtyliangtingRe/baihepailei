param(
  [Parameter(Mandatory = $true)][string]$DryRunV02Directory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$source = Join-Path $PSScriptRoot 'audit-canonical-work-identity-v01.ps1'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "找不到 canonical identity v01 源脚本：$source"
}

$temporary = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  ("audit-canonical-work-identity-v02-" + [Guid]::NewGuid().ToString('N') + '.ps1')

$content = Get-Content -LiteralPath $source -Raw -Encoding UTF8
$needle = 'throw "无效 JSONL：$Path:$lineNumber"'
$replacement = 'throw "无效 JSONL：${Path}:$lineNumber"'

if (-not $content.Contains($needle)) {
  throw '未找到预期的 v01 PowerShell 插值修复点；拒绝执行未知版本。'
}

$content = $content.Replace($needle, $replacement)
[System.IO.File]::WriteAllText(
  $temporary,
  $content,
  [System.Text.UTF8Encoding]::new($false)
)

$exitCode = 1
try {
  & pwsh `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $temporary `
    -DryRunV02Directory $DryRunV02Directory `
    -OutputDirectory $OutputDirectory `
    -PostgresContainer $PostgresContainer `
    -Database $Database `
    -DatabaseUser $DatabaseUser
  $exitCode = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
  throw 'Canonical Work identity v02 只读审计失败。'
}
