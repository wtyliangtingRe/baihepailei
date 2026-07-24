param(
  [Parameter(Mandatory = $true)][string]$TransactionReviewDirectory,
  [Parameter(Mandatory = $true)][string]$GateReviewDirectory,
  [Parameter(Mandatory = $true)][string]$DryRunV03Directory,
  [Parameter(Mandatory = $true)][string]$ExactBeforeDirectory,
  [Parameter(Mandatory = $true)][string]$BaselineSchemaAuditDirectory,
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][ValidateSet('AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01')][string]$AuthorizationPhrase,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$source = Join-Path $PSScriptRoot 'execute-test-work-production-apply-once-v01.ps1'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "缺少 v01 production apply runner：$source" }
$content = (Get-Content -LiteralPath $source -Raw -Encoding UTF8).Replace("`r`n", "`n").Replace("`r", "`n")

function Replace-Exact([string]$Needle, [string]$Replacement, [int]$Expected = 1) {
  $count = ([regex]::Matches($script:content, [regex]::Escape($Needle))).Count
  if ($count -ne $Expected) { throw "Production apply v02 patch 预期命中 $Expected 次，实际 $count 次：$($Needle.Substring(0, [Math]::Min(100, $Needle.Length)))" }
  $script:content = $script:content.Replace($Needle, $Replacement)
}

$escapedRoot = $PSScriptRoot.Replace("'", "''")
Replace-Exact `
  "Set-StrictMode -Version Latest`n" `
  "Set-StrictMode -Version Latest`n`n`$originalScriptRoot = '$escapedRoot'`n"

$rootCount = ([regex]::Matches($content, [regex]::Escape('$PSScriptRoot'))).Count
if ($rootCount -lt 4) { throw "Production apply v02 未找到完整 script-root 引用：$rootCount" }
$content = $content.Replace('$PSScriptRoot', '$originalScriptRoot')
if ($content.Contains('$PSScriptRoot')) { throw 'Production apply v02 仍残留临时 script-root 引用。' }

Replace-Exact '  return $set' '  return ,$set'

$oldBlock = @'
  & node (Join-Path $originalScriptRoot 'build-test-work-production-apply-receipt-v01.mjs') `
    --directory $outDir `
    --metadata $metadataPath `
    --stage-status $stageStatusPath `
    --baseline-counts $baselineCountsPath `
    --post-counts $postCountsPath
  if ($LASTEXITCODE -ne 0) { throw 'Production apply receipt 验证与生成失败。' }
  $allAccepted = $true

  Restart-WriterContainers -Names $writerContainers
  $writersRestarted = $true
  Write-Json -Path (Join-Path $outDir 'writer-restart-status.json') -Value ([ordered]@{
    restarted = $true
    containers = $writerContainers
    completedAt = [DateTime]::UtcNow.ToString('o')
  })
'@
$newBlock = @'
  & node (Join-Path $originalScriptRoot 'build-test-work-production-apply-receipt-v01.mjs') `
    --directory $outDir `
    --metadata $metadataPath `
    --stage-status $stageStatusPath `
    --baseline-counts $baselineCountsPath `
    --post-counts $postCountsPath
  if ($LASTEXITCODE -ne 0) { throw 'Production apply acceptance / table-delta 验证失败。' }
  $allAccepted = $true

  Restart-WriterContainers -Names $writerContainers
  $writersRestarted = $true
  $metadata.writerContainersRestarted = $true
  Write-Json -Path $metadataPath -Value $metadata
  & node (Join-Path $originalScriptRoot 'build-test-work-production-apply-receipt-v01.mjs') `
    --directory $outDir `
    --metadata $metadataPath `
    --stage-status $stageStatusPath `
    --baseline-counts $baselineCountsPath `
    --post-counts $postCountsPath
  if ($LASTEXITCODE -ne 0) { throw 'Production apply 最终不可变 receipt 生成失败。' }
  Write-Json -Path (Join-Path $outDir 'writer-restart-status.json') -Value ([ordered]@{
    restarted = $true
    containers = $writerContainers
    completedAt = [DateTime]::UtcNow.ToString('o')
  })
'@
Replace-Exact ($oldBlock.Replace("`r`n", "`n")) ($newBlock.Replace("`r`n", "`n"))

$temporary = Join-Path ([System.IO.Path]::GetTempPath()) "execute-test-work-production-apply-once-v02-$([Guid]::NewGuid().ToString('N')).ps1"
[System.IO.File]::WriteAllText($temporary, $content, [System.Text.UTF8Encoding]::new($false))
try {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($temporary, [ref]$tokens, [ref]$errors) | Out-Null
  if (@($errors).Count -gt 0) {
    $errors | Format-List
    throw 'Production apply v02 临时 runner 语法检查失败。'
  }
  & $temporary @PSBoundParameters
  if ($LASTEXITCODE -ne 0) { throw 'Production apply v02 执行失败。' }
} finally {
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}
