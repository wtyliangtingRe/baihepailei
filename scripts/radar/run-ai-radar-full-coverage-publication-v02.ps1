[CmdletBinding()]
param(
  [switch]$Execute,
  [string]$ServerUrl = "http://127.0.0.1:3000",
  [int]$DelayMs = 25,
  [int]$MaxRows = 0
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Original = Join-Path $PSScriptRoot "run-ai-radar-full-coverage-publication-v01.ps1"
if (-not (Test-Path -LiteralPath $Original)) {
  throw "找不到 v01 全覆盖发布脚本：$Original"
}

$Source = Get-Content -LiteralPath $Original -Raw -Encoding UTF8
$Needle = '& node --test $TestFile 2>&1 | Tee-Object -FilePath $TestOutput'
$Replacement = '& node --test $TestFile 2>&1 | Tee-Object -FilePath $TestOutput | ForEach-Object { Write-Host $_ }'

$Occurrences = ([regex]::Matches($Source, [regex]::Escape($Needle))).Count
if ($Occurrences -ne 1) {
  throw "v01 测试输出修补点数量异常：$Occurrences"
}

$Patched = $Source.Replace($Needle, $Replacement)
$TempFile = Join-Path $env:TEMP ("run-ai-radar-full-coverage-publication-v02-" + [guid]::NewGuid().ToString("N") + ".ps1")
Set-Content -LiteralPath $TempFile -Value $Patched -Encoding UTF8 -NoNewline

try {
  $Arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $TempFile,
    "-ServerUrl", $ServerUrl,
    "-DelayMs", [string]$DelayMs,
    "-MaxRows", [string]$MaxRows
  )
  if ($Execute) {
    $Arguments += "-Execute"
  }

  & pwsh @Arguments
  $ExitCode = $LASTEXITCODE
  if ($ExitCode -ne 0) {
    throw "全覆盖发布 v02 包装器检测到内部流程失败：$ExitCode"
  }
}
finally {
  if (Test-Path -LiteralPath $TempFile) {
    Remove-Item -LiteralPath $TempFile -Force
  }
}
