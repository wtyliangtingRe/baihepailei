param(
  [Parameter(Mandatory = $true)][string]$Candidate,
  [Parameter(Mandatory = $true)][string]$ExpectedMainHead,
  [Parameter(Mandatory = $true)][ValidateSet('AUTHORIZE-RADAR-UNIFIED-RELEASE-PRODUCTION-0575-V01')][string]$Confirm,
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

throw 'Production authorizer v01 is superseded. Use authorize-radar-unified-release-production-0575-v02.ps1.'
