param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourcePath = Join-Path $PSScriptRoot 'prepare-radar-public-conclusions-migration-v02.ps1'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Missing v02 migration preparer: $sourcePath"
}

$content = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8
$content = $content.Replace("`r`n", "`n")

function Replace-Exact {
  param(
    [Parameter(Mandatory = $true)][string]$Needle,
    [Parameter(Mandatory = $true)][string]$Replacement,
    [Parameter(Mandatory = $true)][int]$ExpectedCount
  )

  $actualCount = ([regex]::Matches($content, [regex]::Escape($Needle))).Count
  if ($actualCount -ne $ExpectedCount) {
    throw "Expected $ExpectedCount occurrence(s), found $actualCount: $Needle"
  }

  $script:content = $content.Replace($Needle, $Replacement)
}

# An empty migration directory is the normal baseline state. PowerShell rejects an
# empty array for a mandatory collection parameter unless AllowEmptyCollection is
# declared, so make both artifact-list helpers parser-safe for the zero-file case.
Replace-Exact `
  -Needle '[Parameter(Mandatory = $true)][object[]]$Before,' `
  -Replacement '[Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,' `
  -ExpectedCount 2

Replace-Exact `
  -Needle '[Parameter(Mandatory = $true)][object[]]$After' `
  -Replacement '[Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After' `
  -ExpectedCount 2

$temporaryPath = Join-Path $PSScriptRoot ('.prepare-radar-public-conclusions-migration-v03-' + [guid]::NewGuid().ToString('N') + '.ps1')

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
    throw 'Patched v03 migration preparer failed PowerShell syntax validation.'
  }

  $forward = @{}
  if ($CommitAndPush) { $forward.CommitAndPush = $true }

  & $temporaryPath @forward
  if ($LASTEXITCODE -ne 0) {
    throw "Patched v03 migration preparer failed with exit code $LASTEXITCODE."
  }
} finally {
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
}
