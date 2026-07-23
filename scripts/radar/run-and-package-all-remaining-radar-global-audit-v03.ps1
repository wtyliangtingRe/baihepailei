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

$sourcePath = Join-Path $PSScriptRoot 'run-and-package-all-remaining-radar-global-audit-v01.ps1'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "找不到 v01 全量审计 runner：$sourcePath"
}

$content = (Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8).Replace("`r`n", "`n").Replace("`r", "`n")

function Replace-Exact([string]$Needle, [string]$Replacement, [int]$Expected = 1) {
  $count = ([regex]::Matches($script:content, [regex]::Escape($Needle))).Count
  if ($count -ne $Expected) {
    throw "精确补丁出现次数不正确；预期 $Expected，实际 $count：$($Needle.Substring(0, [Math]::Min(120, $Needle.Length)))"
  }
  $script:content = $script:content.Replace($Needle, $Replacement)
}

$summaryValidationReplacement = @'
$summary.production.worksRead -ne 35615 -or
    $summary.production.publishedWorksRead -ne 35615 -or
'@
$validationMetadataReplacement = @'
productionWorksRead = 35615
  publishedWorksRead = 35615
'@
$outputReplacement = @'
Write-Host "ProductionWorksRead            : $($summary.production.worksRead)"
Write-Host "PublishedWorksRead             : $($summary.production.publishedWorksRead)"
'@

Replace-Exact `
  "build-all-remaining-radar-global-audit-v02.mjs" `
  "build-all-remaining-radar-global-audit-v03.mjs"

Replace-Exact `
  '$summary.production.worksRead -ne 35615 -or' `
  $summaryValidationReplacement.TrimEnd()

Replace-Exact `
  'productionWorksRead = 35615' `
  $validationMetadataReplacement.TrimEnd()

Replace-Exact `
  'Write-Host "ProductionWorksRead            : $($summary.production.worksRead)"' `
  $outputReplacement.TrimEnd()

$temporaryPath = Join-Path $PSScriptRoot ('.run-and-package-all-remaining-radar-global-audit-v03-' + [guid]::NewGuid().ToString('N') + '.ps1')
[System.IO.File]::WriteAllText($temporaryPath, $content, [System.Text.UTF8Encoding]::new($false))

try {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $temporaryPath,
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null
  if (@($errors).Count -gt 0) {
    $errors | Format-List
    throw '双快照全量审计临时 runner 语法检查失败。'
  }

  & $temporaryPath `
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
    throw "双快照全量审计 runner 返回失败状态：$LASTEXITCODE"
  }
} finally {
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
}
