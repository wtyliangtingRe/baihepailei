param([Parameter(Mandatory=$true)][string]$ResearchInput,[string]$ExpectedSha256,[string]$OutDir='data_local/outputs/ai-radar/research-assessment-v02',[string]$ZipPath='exports/RADAR-REMAINING-CANONICAL-ASSESSMENT-0001-input-v02-review.zip')
$ErrorActionPreference='Stop'
if ($args.Count -gt 0) { throw 'This review-only wrapper accepts no apply, write, or production flags.' }
$nodeArgs = @('scripts/radar/prepare-radar-research-assessment-bulk-v02.mjs', '--input', $ResearchInput, '--out-dir', $OutDir)
if ($ExpectedSha256) { $nodeArgs += @('--expected-sha256', $ExpectedSha256) }
& node @nodeArgs
if ($LASTEXITCODE -ne 0) { throw 'Preparation failed; review ZIP was not created.' }
if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $ZipPath -Force
$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash
[pscustomobject]@{ zipPath=$ZipPath; sha256=$hash; payloadRead=$false; payloadWrite=$false; directPostgresqlWrite=$false; modifiesWorks=$false; publishesRatings=$false; productionApplyAuthorized=$false } | ConvertTo-Json