[CmdletBinding()]
param(
  [string]$Binding = 'scripts/radar/fixtures/radar-next-10000-campaign-accepted-sources-v01.json',
  [string]$OutputDir = 'data_local/outputs/ai-radar/research-campaign-next-10000-v01',
  [string]$ReviewZip = 'exports/RADAR-NEXT-CANONICAL-RESEARCH-10000-0001-input-v01-review.zip',
  [string]$PackageId = 'RADAR-NEXT-CANONICAL-RESEARCH-10000-0001'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dataLocalRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'data_local'))
$exportsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'exports'))
$resolvedOutput = [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDir))
$resolvedZip = [IO.Path]::GetFullPath((Join-Path $repoRoot $ReviewZip))
$outputPrefix = $dataLocalRoot.TrimEnd('\') + '\'
$exportsPrefix = $exportsRoot.TrimEnd('\') + '\'

if (-not $resolvedOutput.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDir must remain under data_local: $resolvedOutput"
}
if (-not $resolvedZip.StartsWith($exportsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "ReviewZip must remain under exports: $resolvedZip"
}
if ([IO.Path]::GetExtension($resolvedZip) -ne '.zip') {
  throw "ReviewZip must end in .zip"
}

Push-Location $repoRoot
try {
  node scripts/radar/prepare-radar-next-10000-campaign-v01.mjs `
    --binding $Binding `
    --output-dir $OutputDir `
    --package-id $PackageId | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Campaign preparation failed or reported an eligible-row shortfall."
  }

  New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($resolvedZip)) | Out-Null
  if (Test-Path -LiteralPath $resolvedZip) {
    Remove-Item -LiteralPath $resolvedZip -Force
  }
  Compress-Archive -Path (Join-Path $resolvedOutput '*') -DestinationPath $resolvedZip -CompressionLevel Optimal
  $sha256 = (Get-FileHash -LiteralPath $resolvedZip -Algorithm SHA256).Hash

  node scripts/radar/prepare-radar-next-10000-campaign-v01.mjs `
    --validate-zip $ReviewZip `
    --expected-sha256 $sha256 `
    --staging-dir data_local/staging/radar-next-10000-campaign-zip-validation-v01 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Prepared review ZIP validation failed."
  }

  $summary = Get-Content -Raw (Join-Path $resolvedOutput 'aggregate/campaign-summary-v01.json') | ConvertFrom-Json
  [pscustomobject]@{
    packageId = $PackageId
    outputDirectory = $resolvedOutput
    reviewZip = $resolvedZip
    reviewZipSha256 = $sha256
    selectedRows = $summary.inputRows
    waveCount = $summary.structure.waveCount
    chunkCount = $summary.structure.chunkCount
    chunkSize = $summary.structure.chunkSize
    emptyResponseSlots = $summary.structure.emptyResponseSlots
    canonicalRowsScanned = $summary.coverage.canonicalRowsScanned
    priorCoveredExclusions = $summary.coverage.totalPriorCoveredExclusions
    eligibleRows = $summary.coverage.remainingEligibleRows
    blockers = $summary.structuralBlockers
    warnings = $summary.warnings
    safety = $summary.safety
  } | ConvertTo-Json -Depth 8
}
finally {
  Pop-Location
}
