param(
  [Parameter(Mandatory=$true)][string]$ResearchInput,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [string]$Acceptance='scripts/radar/fixtures/radar-research-assessment-accepted-0001-v02.json',
  [string]$OutDir='data_local/outputs/ai-radar/research-assessment-v02',
  [string]$PreparedZip='exports/RADAR-REMAINING-CANONICAL-ASSESSMENT-0001-input-v02-review.zip',
  [switch]$Assemble,
  [string]$AssembledZip='exports/RADAR-REMAINING-CANONICAL-ASSESSMENT-0001-assembled-v02-review.zip'
)
$ErrorActionPreference='Stop'
if ($args.Count -gt 0) { throw 'Unknown arguments are rejected; no apply/write/publish flags are supported.' }
$RepoRoot=[System.IO.Path]::GetFullPath((Get-Location).Path)
function Assert-ChildPath([string]$Candidate,[string]$ExpectedRoot,[string]$Label) {
  $Resolved = if ([System.IO.Path]::IsPathRooted($Candidate)) { [System.IO.Path]::GetFullPath($Candidate) } else { [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Candidate)) }
  $Root = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $ExpectedRoot)).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.StartsWith($Root,[System.StringComparison]::OrdinalIgnoreCase)) { throw "$Label must remain under $ExpectedRoot" }
}
Assert-ChildPath $OutDir 'data_local' 'OutDir'
Assert-ChildPath $PreparedZip 'exports' 'PreparedZip'
Assert-ChildPath $AssembledZip 'exports' 'AssembledZip'
& node scripts/radar/prepare-radar-research-assessment-bulk-v02.mjs --input $ResearchInput --expected-sha256 $ExpectedSha256 --acceptance $Acceptance --out-dir $OutDir
if ($LASTEXITCODE -ne 0) { throw 'Preparation failed.' }
if (Test-Path -LiteralPath $PreparedZip) { Remove-Item -LiteralPath $PreparedZip -Force }
Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $PreparedZip -Force
$result=[ordered]@{ preparedZip=$PreparedZip; preparedSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $PreparedZip).Hash; assembledZip=$null; assembledSha256=$null; genuineAssessmentComplete=$false; releaseEligible=$false; normalPublicationGatePass=$false; payloadRead=$false; payloadWrite=$false; payloadPatchRequests=0; directPostgresqlRead=$false; directPostgresqlWrite=$false; modifiesWorks=$false; publishesRatings=$false; productionApplyAuthorized=$false; createsProductionApplyPackage=$false; migrationOrSchemaPush=$false; networkFetch=$false; generatedDataConfinedToDataLocal=$true; reviewArtifactsWrittenUnderExports=$true; arbitraryOutputPathsAllowed=$false }
if ($Assemble) {
  & node scripts/radar/assemble-radar-research-assessment-bulk-v02.mjs --package-dir $OutDir
  if ($LASTEXITCODE -ne 0) { throw 'Assembly is incomplete or invalid; no assembled review ZIP was created.' }
  if (Test-Path -LiteralPath $AssembledZip) { Remove-Item -LiteralPath $AssembledZip -Force }
  Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $AssembledZip -Force
  $result.assembledZip=$AssembledZip; $result.assembledSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $AssembledZip).Hash; $result.genuineAssessmentComplete=$true
}
$result | ConvertTo-Json
