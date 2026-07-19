param(
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$User = 'baihe',
  [switch]$Apply,
  [string]$Confirm
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedConfirmation = 'NORMALIZE-LEGACY-WORK-VERSION-STATUS'
$Docker = Get-Command docker -ErrorAction Stop

$Running = (& $Docker.Source inspect --format '{{.State.Running}}' $PostgresContainer 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $Running -ne 'true') {
  throw "PostgreSQL container is not running: $PostgresContainer"
}

function Invoke-DatabaseQuery {
  param([string]$Query)

  $output = & $Docker.Source exec -e 'PGOPTIONS=-c client_min_messages=warning' $PostgresContainer psql -X -v ON_ERROR_STOP=1 -U $User -d $Database -At -F "`t" -c $Query
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL command failed.' }
  return @($output | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
}

$CountsQuery = @'
SELECT version_status, COUNT(*)
FROM "_works_v"
GROUP BY version_status
ORDER BY version_status;
'@

$Before = Invoke-DatabaseQuery -Query $CountsQuery
$ArchivedLine = @($Before | Where-Object { $_ -match '^archived\t' }) | Select-Object -First 1
$ArchivedCount = if ($ArchivedLine) { [int](($ArchivedLine -split "`t")[1]) } else { 0 }

$Summary = [ordered]@{
  version = 'normalize-legacy-work-version-status-v0.1'
  mode = if ($Apply) { 'apply' } else { 'dry_run' }
  postgresContainer = $PostgresContainer
  database = $Database
  beforeVersionStatusCounts = $Before
  archivedRows = $ArchivedCount
  payloadWrite = $false
  directPostgresqlWrite = $false
  complete = $false
  safety = [ordered]@{
    onlyTargetTable = '_works_v'
    onlyTargetValue = 'version_status = archived'
    replacementValue = 'draft'
    explicitConfirmationRequired = $ExpectedConfirmation
    checkpointRequiredBeforeApply = $true
  }
}

if (-not $Apply) {
  $Summary.complete = $true
  $Summary.nextStep = if ($ArchivedCount -gt 0) {
    'Create and verify a fresh database checkpoint, then rerun with -Apply -Confirm NORMALIZE-LEGACY-WORK-VERSION-STATUS.'
  } else {
    'No archived version_status rows exist. Start pnpm dev and let Payload push the pending schema columns.'
  }
  $Summary | ConvertTo-Json -Depth 8
  exit 0
}

if ($Confirm -ne $ExpectedConfirmation) {
  throw "Apply requires -Confirm $ExpectedConfirmation"
}

$Transaction = @'
BEGIN;
UPDATE "_works_v"
SET version_status = 'draft'
WHERE version_status = 'archived';
SELECT version_status, COUNT(*)
FROM "_works_v"
GROUP BY version_status
ORDER BY version_status;
COMMIT;
'@
$After = Invoke-DatabaseQuery -Query $Transaction

$Summary.directPostgresqlWrite = $true
$Summary.complete = $true
$Summary.afterVersionStatusCounts = $After
$Summary.nextStep = 'Run pnpm dev again. When Payload asks to create the new humanAssessment columns, choose create column. Only accept deletion warnings for legacy_x_wiki_page fields after reviewing the exact list.'
$Summary | ConvertTo-Json -Depth 8
