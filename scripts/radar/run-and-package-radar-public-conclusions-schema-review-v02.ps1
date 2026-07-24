param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$AuditBundle,
  [string]$ExpectedAuditBundleSHA256 = '7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourcePath = Join-Path $PSScriptRoot 'run-and-package-radar-public-conclusions-schema-review-v01.ps1'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Missing v01 schema review wrapper: $sourcePath"
}

$content = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8
$content = $content.Replace("`r`n", "`n")

$needle = "& '.\scripts\radar\prepare-radar-public-conclusions-migration-v02.ps1' -CommitAndPush 2>&1 |"
$replacement = "& '.\scripts\radar\prepare-radar-public-conclusions-migration-v03.ps1' -CommitAndPush 2>&1 |"
$count = ([regex]::Matches($content, [regex]::Escape($needle))).Count
if ($count -ne 1) {
  throw "Expected exactly one v02 migration preparer call, found $count."
}
$content = $content.Replace($needle, $replacement)

$temporaryPath = Join-Path $PSScriptRoot ('.run-and-package-radar-public-conclusions-schema-review-v02-' + [guid]::NewGuid().ToString('N') + '.ps1')

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
    throw 'Patched v02 schema review wrapper failed PowerShell syntax validation.'
  }

  & $temporaryPath `
    -ExpectedBranchHead $ExpectedBranchHead `
    -AuditBundle $AuditBundle `
    -ExpectedAuditBundleSHA256 $ExpectedAuditBundleSHA256

  if ($LASTEXITCODE -ne 0) {
    throw "Patched v02 schema review wrapper failed with exit code $LASTEXITCODE."
  }
} finally {
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
}
