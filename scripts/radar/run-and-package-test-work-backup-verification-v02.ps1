param(
  [Parameter(Mandatory = $true)][string]$DryRunV03Directory,
  [Parameter(Mandatory = $true)][string]$ExactBeforeDirectory,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$originalScriptRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$source = Join-Path $originalScriptRoot 'run-and-package-test-work-backup-verification-v01.ps1'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "找不到备份恢复验证 v01 源脚本：$source"
}

$content = Get-Content -LiteralPath $source -Raw -Encoding UTF8

$scriptRootOccurrences = ([regex]::Matches(
  $content,
  [regex]::Escape('$PSScriptRoot')
)).Count
if ($scriptRootOccurrences -ne 3) {
  throw "预期在 v01 中找到三处 PSScriptRoot，实际为：$scriptRootOccurrences"
}
$escapedOriginalScriptRoot = $originalScriptRoot.Replace("'", "''")
$strictNeedle = 'Set-StrictMode -Version Latest'
$strictReplacement = @"
Set-StrictMode -Version Latest
`$originalScriptRoot = '$escapedOriginalScriptRoot'
"@
$strictOccurrences = ([regex]::Matches($content, [regex]::Escape($strictNeedle))).Count
if ($strictOccurrences -ne 1) {
  throw "预期找到一处 StrictMode 插入点，实际为：$strictOccurrences"
}
$content = $content.Replace($strictNeedle, $strictReplacement.TrimEnd())
$content = $content.Replace('$PSScriptRoot', '$originalScriptRoot')
if ($content.Contains('$PSScriptRoot')) {
  throw '临时备份验证脚本仍包含 PSScriptRoot；拒绝执行。'
}

$insertNeedle = '$operationError = $null'
$insertReplacement = @'
$operationError = $null
$verificationLogStdout = Join-Path $outDir 'verification-container-stdout.log'
$verificationLogStderr = Join-Path $outDir 'verification-container-stderr.log'
'@
$insertOccurrences = ([regex]::Matches($content, [regex]::Escape($insertNeedle))).Count
if ($insertOccurrences -ne 1) {
  throw "预期找到一处日志路径插入点，实际为：$insertOccurrences"
}
$content = $content.Replace($insertNeedle, $insertReplacement)

$stdoutExpression = "(Join-Path `$outDir 'verification-container-stdout.log')"
$stderrExpression = "(Join-Path `$outDir 'verification-container-stderr.log')"
$stdoutOccurrences = ([regex]::Matches($content, [regex]::Escape($stdoutExpression))).Count
$stderrOccurrences = ([regex]::Matches($content, [regex]::Escape($stderrExpression))).Count
if ($stdoutOccurrences -ne 2 -or $stderrOccurrences -ne 2) {
  throw "容器日志重定向数量不符合预期：stdout=$stdoutOccurrences, stderr=$stderrOccurrences"
}
$content = $content.Replace($stdoutExpression, '$verificationLogStdout')
$content = $content.Replace($stderrExpression, '$verificationLogStderr')

$temporary = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  ("run-and-package-test-work-backup-verification-v02-" + [Guid]::NewGuid().ToString('N') + '.ps1')
[System.IO.File]::WriteAllText(
  $temporary,
  $content,
  [System.Text.UTF8Encoding]::new($false)
)

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  $temporary,
  [ref]$tokens,
  [ref]$parseErrors
) | Out-Null
if (@($parseErrors).Count -gt 0) {
  $messages = @($parseErrors | ForEach-Object Message)
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  throw "备份验证临时脚本语法检查失败：$($messages -join ' | ')"
}

$exitCode = 1
try {
  & pwsh `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $temporary `
    -DryRunV03Directory $DryRunV03Directory `
    -ExactBeforeDirectory $ExactBeforeDirectory `
    -PostgresContainer $PostgresContainer `
    -Database $Database `
    -DatabaseUser $DatabaseUser `
    -ReadyTimeoutSeconds $ReadyTimeoutSeconds
  $exitCode = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
  throw 'Test Work PostgreSQL 备份与隔离恢复验证失败。'
}
