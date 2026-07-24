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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
$builderPath = Join-Path $PSScriptRoot 'build-radar-public-blocked-inventory-v01.mjs'
$innerRunner = Join-Path $PSScriptRoot 'run-and-package-radar-public-blocked-inventory-v01.ps1'
$testPath = Join-Path $repoRoot 'tests\radar-public-blocked-inventory.test.mjs'

foreach ($item in @($builderPath, $innerRunner, $testPath)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { throw "缺少 blocked inventory 活动文件：$item" }
}

& node --check $builderPath
if ($LASTEXITCODE -ne 0) { throw 'Blocked inventory builder 真实 parser 检查失败。' }

foreach ($item in @($innerRunner, $PSCommandPath)) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $item,
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null
  if (@($errors).Count -gt 0) {
    $errors | Format-List
    throw "Blocked inventory PowerShell parser 检查失败：$item"
  }
}

& node --test $testPath
if ($LASTEXITCODE -ne 0) { throw 'Blocked inventory 回归测试失败。' }

& $innerRunner @PSBoundParameters
if ($LASTEXITCODE -ne 0) { throw 'Blocked inventory v01 runner 执行失败。' }
