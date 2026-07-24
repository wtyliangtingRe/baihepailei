param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [string]$ExpectedAuditBundleSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$originalScriptRoot = $PSScriptRoot
$sourcePath = Join-Path $originalScriptRoot 'run-and-package-radar-public-conclusions-schema-review-v01.ps1'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Missing v01 schema review wrapper: $sourcePath"
}

$content = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8
$content = $content.Replace("`r`n", "`n")

function Replace-Exact {
  param(
    [Parameter(Mandatory = $true)][string]$Needle,
    [Parameter(Mandatory = $true)][string]$Replacement,
    [Parameter(Mandatory = $true)][int]$ExpectedCount
  )

  $actualCount = ([regex]::Matches($script:content, [regex]::Escape($Needle))).Count
  if ($actualCount -ne $ExpectedCount) {
    throw "Expected $ExpectedCount occurrence(s), found ${actualCount}: $Needle"
  }
  $script:content = $script:content.Replace($Needle, $Replacement)
}

Replace-Exact `
  -Needle "& '.\scripts\radar\prepare-radar-public-conclusions-migration-v02.ps1' -CommitAndPush 2>&1 |" `
  -Replacement "& '.\scripts\radar\prepare-radar-public-conclusions-migration-v04.ps1' -CommitAndPush 2>&1 |" `
  -ExpectedCount 1

Replace-Exact `
  -Needle "`$repoRoot = (Resolve-Path (Join-Path `$PSScriptRoot '..\..')).Path" `
  -Replacement "`$repoRoot = (Resolve-Path (Join-Path `$env:RADAR_SCHEMA_REVIEW_SOURCE_ROOT '..\..')).Path" `
  -ExpectedCount 1

$temporaryPath = Join-Path ([System.IO.Path]::GetTempPath()) (
  'run-and-package-radar-public-conclusions-schema-review-v03-' + [guid]::NewGuid().ToString('N') + '.ps1'
)
$savedRootExists = Test-Path 'Env:RADAR_SCHEMA_REVIEW_SOURCE_ROOT'
$savedRoot = [Environment]::GetEnvironmentVariable('RADAR_SCHEMA_REVIEW_SOURCE_ROOT', 'Process')

try {
  [System.IO.File]::WriteAllText(
    $temporaryPath,
    $content,
    [System.Text.UTF8Encoding]::new($false)
  )

  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $temporaryPath,
    [ref]$tokens,
    [ref]$parseErrors
  ) | Out-Null
  if (@($parseErrors).Count -gt 0) {
    $parseErrors | Format-List
    throw 'Patched v03 schema review wrapper failed PowerShell syntax validation.'
  }

  [Environment]::SetEnvironmentVariable('RADAR_SCHEMA_REVIEW_SOURCE_ROOT', $originalScriptRoot, 'Process')
  & $temporaryPath `
    -ExpectedBranchHead $ExpectedBranchHead `
    -AuditBundle $AuditBundle `
    -ExpectedAuditBundleSHA256 $ExpectedAuditBundleSHA256

  if ($LASTEXITCODE -ne 0) {
    throw "Patched v03 schema review wrapper failed with exit code $LASTEXITCODE."
  }
} finally {
  if ($savedRootExists) {
    [Environment]::SetEnvironmentVariable('RADAR_SCHEMA_REVIEW_SOURCE_ROOT', $savedRoot, 'Process')
  } else {
    [Environment]::SetEnvironmentVariable('RADAR_SCHEMA_REVIEW_SOURCE_ROOT', $null, 'Process')
  }
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
}
