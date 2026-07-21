param(
  [ValidateSet('Inspect', 'Execute')]
  [string]$Mode = 'Inspect',

  [string]$CandidateManifest = 'data_local/staging/ai-radar/v06-single-targeted-publication-v01/rc-v06-single-cab8a120e61ea9f8f26e/candidate-manifest.json',

  [string]$CheckpointDump = 'D:/Baihepailei-backups/Baihepailei-20260721-165805/payload-postgresql.dump',

  [string]$ExpectedDumpSha256 = '2fa9aaf14a57fd9b48a594571be9a4863e26c707b2f3620894842f46e57ec5c2',

  [string]$LabDatabase = '',

  [int]$ExpectedVersionsRead = 7,

  [string]$ExpectedCleanVersionId = '8744',

  [string]$ExpectedOriginalDraftVersionId = '79558',

  [string]$Confirmation = '',

  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RequiredConfirmation = 'EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V06-ONLY'
$InnerConfirmation = 'EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V05-ONLY'
$MainDatabase = 'baihepailei'
$MaintenanceDatabase = 'postgres'
$PostgresContainer = 'baihepailei-postgres'
$PostgresUser = 'baihe'
$LabUrl = 'http://127.0.0.1:3100'
$ExpectedPublicTableCount = 83
$LabScript = 'scripts/radar/lab-ai-radar-v06-draft-restore-roundtrip-v05.mjs'
$LabTest = 'tests/ai-radar-v06-draft-restore-roundtrip-lab-v05.test.mjs'
$RunnerTest = 'tests/ai-radar-v06-draft-restore-roundtrip-runner-v06.test.mjs'
$OutputRoot = 'data_local/staging/ai-radar/v06-draft-restore-roundtrip-lab-v05'
$ProofRoot = 'data_local/staging/ai-radar/v06-draft-restore-roundtrip-lab-proof-v06'
$ExpectedPatchFields = @(
  '_status',
  'evidenceStrength',
  'radarAssessment',
  'rank',
  'ratingNotice',
  'reviewReasons',
  'reviewStatus'
) | Sort-Object
$ForbiddenPatchFields = @(
  'humanAssessment',
  'humanReviewNote',
  'humanReviewedAt',
  'humanReviewedBy'
)

function Get-RepositoryRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot '../..')
  return $root.Path
}

function Get-DatabaseConnectionCount {
  param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9_]+$')]
    [string]$DatabaseName
  )

  $result = (
    docker exec `
      $PostgresContainer `
      psql `
      "--username=$PostgresUser" `
      "--dbname=$MaintenanceDatabase" `
      --tuples-only `
      --no-align `
      --command "SELECT count(*) FROM pg_stat_activity WHERE datname = '$DatabaseName';" |
    Out-String
  ).Trim()

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to read PostgreSQL connection count for $DatabaseName."
  }
  if ($result -notmatch '^\d+$') {
    throw "Invalid PostgreSQL connection count for $DatabaseName: $result"
  }
  return [int]$result
}

function Get-ActiveLabDatabase {
  $rows = @(
    docker exec `
      $PostgresContainer `
      psql `
      "--username=$PostgresUser" `
      "--dbname=$MaintenanceDatabase" `
      --tuples-only `
      --no-align `
      --command "SELECT datname || '|' || count(*) FROM pg_stat_activity WHERE datname LIKE 'baihepailei_radar_lab_%' GROUP BY datname ORDER BY datname;"
  )

  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to discover active Radar lab databases.'
  }

  $active = @(
    foreach ($row in $rows) {
      $text = ([string]$row).Trim()
      if ($text -match '^([^|]+)\|(\d+)$') {
        [pscustomobject]@{
          Database = $Matches[1]
          Connections = [int]$Matches[2]
        }
      }
    }
  )

  if ($active.Count -ne 1) {
    throw "Expected exactly one active Radar lab database; found $($active.Count)."
  }
  return [string]$active[0].Database
}

function Get-PublicTableCount {
  param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9_]+$')]
    [string]$DatabaseName
  )

  $result = (
    docker exec `
      $PostgresContainer `
      psql `
      "--username=$PostgresUser" `
      "--dbname=$DatabaseName" `
      --tuples-only `
      --no-align `
      --command "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';" |
    Out-String
  ).Trim()

  if ($LASTEXITCODE -ne 0 -or $result -notmatch '^\d+$') {
    throw "Failed to read public table count for $DatabaseName."
  }
  return [int]$result
}

function Get-NewestRunDirectory {
  param(
    [Parameter(Mandatory)]
    [datetime]$StartedAt
  )

  $root = Join-Path (Get-Location) $OutputRoot
  if (-not (Test-Path -LiteralPath $root)) {
    return $null
  }

  return Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $StartedAt.AddSeconds(-3) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

function Read-RunSummary {
  param(
    [Parameter(Mandatory)]
    [string]$RunDirectory
  )

  $summaryFile = Join-Path $RunDirectory 'summary.json'
  if (-not (Test-Path -LiteralPath $summaryFile)) {
    throw "Lab summary does not exist: $summaryFile"
  }

  return Get-Content -LiteralPath $summaryFile -Raw -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
}

function Invoke-LabInspect {
  $startedAt = Get-Date
  & node `
    --env-file=.env `
    $LabScript `
    --candidate-manifest $CandidateManifest `
    --url $LabUrl
  $exitCode = $LASTEXITCODE
  $runDirectory = Get-NewestRunDirectory -StartedAt $startedAt

  if ($exitCode -ne 0) {
    throw "Read-only v0.5 inspect failed with exit code $exitCode."
  }
  if (-not $runDirectory) {
    throw 'Read-only v0.5 inspect did not create an evidence directory.'
  }

  $summary = Read-RunSummary -RunDirectory $runDirectory
  if (
    $summary.ok -ne $true -or
    [string]$summary.status -ne 'inspect_ready_for_draft_restore_lab_execution' -or
    [int]$summary.safety.payloadWriteRequests -ne 0 -or
    $summary.safety.mainDatabaseTargeted -ne $false -or
    $summary.safety.localApiRestoreUsed -ne $false
  ) {
    throw 'Read-only v0.5 inspect did not satisfy the safety gate.'
  }

  return [pscustomobject]@{
    Summary = $summary
    RunDirectory = $runDirectory
  }
}

function New-DatabaseProof {
  param(
    [Parameter(Mandatory)]
    [string]$DatabaseName,
    [Parameter(Mandatory)]
    [int]$MainConnections,
    [Parameter(Mandatory)]
    [int]$LabConnections,
    [Parameter(Mandatory)]
    [int]$PublicTableCount,
    [Parameter(Mandatory)]
    [string]$DumpSha256
  )

  $proofDirectory = Join-Path (Join-Path (Get-Location) $ProofRoot) (Get-Date -Format 'yyyyMMddHHmmss')
  New-Item -ItemType Directory -Force -Path $proofDirectory | Out-Null
  $proofFile = Join-Path $proofDirectory 'lab-database-proof.json'

  $proof = [ordered]@{
    generatedAt = [datetimeoffset]::Now.ToString('o')
    version = 'ai-radar-v06-lab-database-proof-v0.1'
    serverUrl = $LabUrl
    databaseName = $DatabaseName
    mainDatabase = $MainDatabase
    mainDatabaseConnections = $MainConnections
    labDatabaseConnections = $LabConnections
    publicTableCount = $PublicTableCount
    sourceDumpSha256 = $DumpSha256
    candidateManifest = $CandidateManifest
    candidateManifestSha256 = (
      Get-FileHash -LiteralPath $CandidateManifest -Algorithm SHA256
    ).Hash.ToLowerInvariant()
  }

  [IO.File]::WriteAllText(
    $proofFile,
    ($proof | ConvertTo-Json -Depth 20),
    [Text.UTF8Encoding]::new($false)
  )

  return $proofFile
}

$repoRoot = Get-RepositoryRoot
Set-Location $repoRoot

$CandidateManifest = (Resolve-Path $CandidateManifest).Path
$CheckpointDump = (Resolve-Path $CheckpointDump).Path

$currentBranch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne 'agent/radar-v06-version-roundtrip-lab-v01') {
  throw 'This runner is restricted to the reviewed PR #288 laboratory branch.'
}

$unexpectedDirtyFiles = @(
  git status --short |
    Where-Object {
      $_ -and
      $_ -notmatch '^\s*M\s+next-env\.d\.ts$' -and
      $_ -notmatch '^\s*M\s+payload-types\.ts$'
    }
)
if ($unexpectedDirtyFiles.Count -gt 0) {
  $unexpectedDirtyFiles | ForEach-Object { Write-Host $_ }
  throw 'Unexpected local changes are present.'
}

if (-not $SkipTests) {
  & node --check $LabScript
  if ($LASTEXITCODE -ne 0) { throw 'v0.5 lab syntax check failed.' }

  & node --test $LabTest $RunnerTest
  if ($LASTEXITCODE -ne 0) { throw 'Draft restore laboratory tests failed.' }
}

$candidate = Get-Content -LiteralPath $CandidateManifest -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
$patchFields = @($candidate.expected.patch.PSObject.Properties.Name | Sort-Object)
$patchDifference = @(Compare-Object -ReferenceObject $ExpectedPatchFields -DifferenceObject $patchFields)
if ($patchDifference.Count -ne 0) {
  throw 'Candidate patch fields do not match the reviewed allowlist.'
}
$presentForbiddenFields = @($patchFields | Where-Object { $_ -in $ForbiddenPatchFields })
if ($presentForbiddenFields.Count -gt 0) {
  throw "Candidate patch contains human-review fields: $($presentForbiddenFields -join ', ')"
}
if ([string]$candidate.expected.patch._status -ne 'published') {
  throw 'Candidate patch must explicitly publish.'
}

$expectedHash = $ExpectedDumpSha256.ToLowerInvariant()
$candidateHash = ([string]$candidate.files.checkpointDump.sha256).ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $CheckpointDump -Algorithm SHA256).Hash.ToLowerInvariant()
if ($candidateHash -ne $expectedHash -or $actualHash -ne $expectedHash) {
  throw 'Candidate and checkpoint dump hashes do not close.'
}

if ([string]::IsNullOrWhiteSpace($LabDatabase)) {
  $LabDatabase = Get-ActiveLabDatabase
}
if ($LabDatabase -notmatch '^baihepailei_radar_lab_[a-z0-9_]+$') {
  throw 'Lab database name is not approved.'
}

$mainConnections = Get-DatabaseConnectionCount -DatabaseName $MainDatabase
$labConnections = Get-DatabaseConnectionCount -DatabaseName $LabDatabase
$publicTableCount = Get-PublicTableCount -DatabaseName $LabDatabase
$portListening = Test-NetConnection `
  -ComputerName '127.0.0.1' `
  -Port 3100 `
  -InformationLevel Quiet `
  -WarningAction SilentlyContinue

if ($mainConnections -ne 0) { throw 'The formal database has active connections.' }
if ($labConnections -lt 1) { throw 'The lab database has no application connection.' }
if ($publicTableCount -ne $ExpectedPublicTableCount) { throw 'The lab database table count is unexpected.' }
if (-not $portListening) { throw 'Port 3100 is not listening.' }

$passwordWasInjected = $false
if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_PASSWORD)) {
  $securePassword = Read-Host 'Payload administrator password (input hidden)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $env:RADAR_PAYLOAD_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $passwordWasInjected = $true
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $passwordPointer = [IntPtr]::Zero
    $securePassword = $null
  }
}

try {
  $inspect = Invoke-LabInspect
  $inspectSummary = $inspect.Summary

  [pscustomobject]@{
    Mode = $Mode
    TargetId = $inspectSummary.target.id
    Title = $inspectSummary.target.title
    LabDatabase = $LabDatabase
    VersionsRead = $inspectSummary.versionsRead
    CleanVersionId = $inspectSummary.baseline.cleanPublishedContentVersionId
    OriginalDraftVersionId = $inspectSummary.baseline.originalDraftVersionId
    PayloadWriteRequests = $inspectSummary.safety.payloadWriteRequests
    MainDatabaseTargeted = $inspectSummary.safety.mainDatabaseTargeted
    InspectEvidenceDirectory = $inspect.RunDirectory
  } | Format-List

  if ($Mode -eq 'Inspect') {
    Write-Host 'Read-only laboratory inspection verified.' -ForegroundColor Green
    return
  }

  if ($Confirmation -ne $RequiredConfirmation) {
    throw "Execute mode requires -Confirmation $RequiredConfirmation"
  }
  if ([int]$inspectSummary.versionsRead -ne $ExpectedVersionsRead) {
    throw 'Execute mode requires a freshly restored laboratory database.'
  }
  if ([string]$inspectSummary.baseline.cleanPublishedContentVersionId -ne $ExpectedCleanVersionId) {
    throw 'Clean published-content version ID does not match the reviewed baseline.'
  }
  if ([string]$inspectSummary.baseline.originalDraftVersionId -ne $ExpectedOriginalDraftVersionId) {
    throw 'Original draft version ID does not match the reviewed baseline.'
  }

  $mainConnections = Get-DatabaseConnectionCount -DatabaseName $MainDatabase
  $labConnections = Get-DatabaseConnectionCount -DatabaseName $LabDatabase
  if ($mainConnections -ne 0 -or $labConnections -lt 1) {
    throw 'Database isolation changed after inspect.'
  }

  $proofFile = New-DatabaseProof `
    -DatabaseName $LabDatabase `
    -MainConnections $mainConnections `
    -LabConnections $labConnections `
    -PublicTableCount $publicTableCount `
    -DumpSha256 $actualHash

  $executeStartedAt = Get-Date
  $env:RADAR_VERSION_ROUNDTRIP_LAB = 'YES'
  try {
    & node `
      --env-file=.env `
      $LabScript `
      --candidate-manifest $CandidateManifest `
      --url $LabUrl `
      --lab-database $LabDatabase `
      --database-proof $proofFile `
      --confirmation $InnerConfirmation `
      --execute-lab
    $executeExitCode = $LASTEXITCODE
  }
  finally {
    Remove-Item Env:RADAR_VERSION_ROUNDTRIP_LAB -ErrorAction SilentlyContinue
  }

  $executeRunDirectory = Get-NewestRunDirectory -StartedAt $executeStartedAt
  if (-not $executeRunDirectory) {
    throw 'Execute mode did not create an evidence directory.'
  }
  $executeSummary = Read-RunSummary -RunDirectory $executeRunDirectory

  if (
    $executeExitCode -ne 0 -or
    $executeSummary.ok -ne $true -or
    [string]$executeSummary.status -ne 'draft_restore_roundtrip_lab_verified' -or
    [int]$executeSummary.payloadWriteRequests -ne 3 -or
    $executeSummary.safety.mainDatabaseTargeted -ne $false -or
    $executeSummary.safety.directPostgresqlWrite -ne $false -or
    [int]$executeSummary.safety.restoreAsDraftRequests -ne 2 -or
    [int]$executeSummary.safety.partialPublishedPatchRequests -ne 1 -or
    [int]$executeSummary.safety.genericRestoreWithoutDraftRequests -ne 0 -or
    [int]$executeSummary.safety.wholeDocumentDraftPatchRequests -ne 0 -or
    $executeSummary.safety.localApiRestoreUsed -ne $false -or
    $executeSummary.safety.restRestoreDraftQueryExplicit -ne $true
  ) {
    throw "Laboratory execution failed. Preserve the server, database, proof, and evidence directory: $executeRunDirectory"
  }

  [pscustomobject]@{
    Status = $executeSummary.status
    PayloadWriteRequests = $executeSummary.payloadWriteRequests
    RestoreAsDraftRequests = $executeSummary.safety.restoreAsDraftRequests
    PartialPublishedPatchRequests = $executeSummary.safety.partialPublishedPatchRequests
    MainDatabaseTargeted = $executeSummary.safety.mainDatabaseTargeted
    DirectPostgresqlWrite = $executeSummary.safety.directPostgresqlWrite
    ProofFile = $proofFile
    EvidenceDirectory = $executeRunDirectory
  } | Format-List

  Write-Host 'Draft restore roundtrip laboratory verified.' -ForegroundColor Green
}
finally {
  if ($passwordWasInjected) {
    Remove-Item Env:RADAR_PAYLOAD_PASSWORD -ErrorAction SilentlyContinue
  }
}
