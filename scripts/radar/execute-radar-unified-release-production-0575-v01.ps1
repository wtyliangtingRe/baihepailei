param(
  [Parameter(Mandatory = $true)][string]$Authorization,
  [Parameter(Mandatory = $true)][string]$ExpectedMainHead,
  [Parameter(Mandatory = $true)][string]$Confirm,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# The merged-main authorization manifest binds this stable entrypoint by SHA-256.
# This entrypoint in turn binds the corrected v02 core by its exact Git blob ID.
$inner = Join-Path $PSScriptRoot 'execute-radar-unified-release-production-0575-v02.ps1'
$expectedBlobSha = 'bfb5367013e454c2129ef3e557749d9e8b5aca6e'

if (-not (Test-Path -LiteralPath $inner -PathType Leaf)) {
  throw "缺少 production executor v02：$inner"
}

$actualBlobSha = ([string](& git hash-object -- $inner)).Trim()
if ($LASTEXITCODE -ne 0 -or $actualBlobSha -ne $expectedBlobSha) {
  throw "production executor v02 内容不匹配：actual=$actualBlobSha expected=$expectedBlobSha"
}

& $inner @PSBoundParameters
if ($LASTEXITCODE -ne 0) {
  throw 'production executor v02 执行失败。'
}
