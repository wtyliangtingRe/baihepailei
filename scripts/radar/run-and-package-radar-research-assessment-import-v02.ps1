[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputZip,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedSha256,
  [string]$Acceptance = 'scripts/radar/fixtures/radar-research-assessment-import-accepted-0001-v02.json',
  [string]$OutputDir = 'data_local/outputs/ai-radar/research-assessment-import-v02',
  [string]$StagingDir = 'data_local/staging/ai-radar/research-assessment-import-v02/package',
  [string]$ReviewZip = 'exports/RADAR-REMAINING-CANONICAL-ASSESSMENT-0001-import-v02-review.zip'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $repoRoot
try {
  $dataLocalRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'data_local'))
  $exportsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'exports'))
  $resolvedOutput = [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDir))
  $resolvedStaging = [IO.Path]::GetFullPath((Join-Path $repoRoot $StagingDir))
  $resolvedReviewZip = [IO.Path]::GetFullPath((Join-Path $repoRoot $ReviewZip))
  $dataPrefix = $dataLocalRoot.TrimEnd('\') + '\'
  $exportsPrefix = $exportsRoot.TrimEnd('\') + '\'
  if (-not $resolvedOutput.StartsWith($dataPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'OutputDir must remain under data_local' }
  if (-not $resolvedStaging.StartsWith($dataPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'StagingDir must remain under data_local' }
  if (-not $resolvedReviewZip.StartsWith($exportsPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'ReviewZip must remain under exports' }

  node scripts/radar/import-radar-research-assessment-v02.mjs --input $InputZip --expected-sha256 $ExpectedSha256 --acceptance $Acceptance --out-dir $OutputDir --staging-dir $StagingDir
  if ($LASTEXITCODE -ne 0) { throw "Importer exited with code $LASTEXITCODE" }
  node scripts/radar/plan-radar-research-assessment-v02-dryrun.mjs --out-dir $OutputDir
  if ($LASTEXITCODE -ne 0) { throw "Planner exited with code $LASTEXITCODE" }

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReviewZip -Parent) | Out-Null
  if (Test-Path -LiteralPath $resolvedReviewZip) { Remove-Item -LiteralPath $resolvedReviewZip -Force }
  Compress-Archive -Path (Join-Path $resolvedOutput '*') -DestinationPath $resolvedReviewZip -CompressionLevel Optimal
  [pscustomobject]@{
    reviewZip = $resolvedReviewZip
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedReviewZip).Hash
    generatedDataConfinedToDataLocal = $true
    reviewArtifactsWrittenUnderExports = $true
    arbitraryOutputPathsAllowed = $false
    dryRunOnly = $true
  } | ConvertTo-Json
}
finally {
  Pop-Location
}
