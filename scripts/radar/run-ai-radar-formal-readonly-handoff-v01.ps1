param(
  [ValidateSet('Inspect', 'Export')]
  [string]$Mode = 'Inspect',

  [int]$Limit = 0,

  [int]$AssessmentBatchSize = 250,

  [int]$ResearchBatchSize = 100,

  [int]$IdentityBatchSize = 100,

  [int]$ChunkSize = 25,

  [int]$AssessmentHandoffBatchLimit = 1,

  [string]$Confirmation = '',

  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = 'ai-radar-formal-readonly-handoff-v0.1'
$RequiredConfirmation = 'EXPORT-FORMAL-AI-RADAR-READONLY-HANDOFF-V01'
$FormalUrl = 'http://127.0.0.1:3000'
$MainDatabase = 'baihepailei'
$MaintenanceDatabase = 'postgres'
$PostgresContainer = 'baihepailei-postgres'
$PostgresUser = 'baihe'
$ExpectedPublicTableCount = 83
$MinimumExpectedFullCatalogWorks = 35000
$ReviewBranch = 'agent/radar-formal-readonly-handoff-v01'
$OutputRoot = 'data_local/staging/ai-radar/formal-readonly-handoff-v01'
$BuildInputScript = 'scripts/radar/build-ai-radar-input-v01.mjs'
$FullCatalogScript = 'scripts/radar/run-ai-radar-full-catalog-preparation-v01.mjs'
$PrepareHandoffScript = 'scripts/radar/prepare-ai-radar-assessment-handoff-v01.mjs'
$RunnerTest = 'tests/ai-radar-formal-readonly-handoff-v01.test.mjs'

function Get-RepositoryRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot '../..')
  return $root.Path
}

function Assert-IntegerRange {
  param(
    [Parameter(Mandatory)]
    [string]$Name,
    [Parameter(Mandatory)]
    [int]$Value,
    [Parameter(Mandatory)]
    [int]$Minimum,
    [Parameter(Mandatory)]
    [int]$Maximum
  )

  if ($Value -lt $Minimum -or $Value -gt $Maximum) {
    throw "$Name must be an integer from $Minimum to $Maximum."
  }
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

  if ($LASTEXITCODE -ne 0 -or $result -notmatch '^\d+$') {
    throw "Failed to read PostgreSQL connection count for $DatabaseName."
  }

  return [int]$result
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

function Invoke-NodeLogged {
  param(
    [Parameter(Mandatory)]
    [string[]]$Arguments,
    [Parameter(Mandatory)]
    [string]$FailureMessage
  )

  $nodeOutput = @(
    & node @Arguments 2>&1
  )
  $exitCode = $LASTEXITCODE
  $nodeOutput | ForEach-Object { Write-Host $_ }

  if ($exitCode -ne 0) {
    throw "$FailureMessage Exit code: $exitCode"
  }
}

function Read-Json {
  param(
    [Parameter(Mandatory)]
    [string]$File
  )

  if (-not (Test-Path -LiteralPath $File)) {
    throw "Required JSON file does not exist: $File"
  }

  return Get-Content -LiteralPath $File -Raw -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
}

function Write-Json {
  param(
    [Parameter(Mandatory)]
    [string]$File,
    [Parameter(Mandatory)]
    [object]$Value
  )

  $parent = Split-Path -Parent $File
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  [IO.File]::WriteAllText(
    $File,
    (($Value | ConvertTo-Json -Depth 100) + "`n"),
    [Text.UTF8Encoding]::new($false)
  )
}

function Write-UploadPlan {
  param(
    [Parameter(Mandatory)]
    [string]$File,
    [Parameter(Mandatory)]
    [object[]]$Packages,
    [Parameter(Mandatory)]
    [string]$RunRoot
  )

  $lines = @(
    '# AI Radar 正式库只读审核包上传计划',
    '',
    '本目录来自正式数据库的只读导出。没有执行 Works PATCH、发布或 PostgreSQL 写入。',
    '',
    "运行目录：$RunRoot",
    '',
    '## 上传顺序',
    ''
  )

  if ($Packages.Count -eq 0) {
    $lines += '- 当前没有 ready_for_ai_assessment 批次。请查看 queue 汇总。'
  }
  else {
    foreach ($package in $Packages) {
      $lines += "### $($package.batchId)"
      $lines += ''
      $lines += "- 作品数：$($package.rowCount)"
      $lines += "- 分块数：$($package.chunkCount)"
      $lines += "- 第一个上传文件：$($package.firstUploadFile)"
      $lines += "- 交接清单：$($package.handoffManifest)"
      $lines += ''
    }
  }

  $lines += @(
    '## 安全边界',
    '',
    '- 只读取 `http://127.0.0.1:3000`。',
    '- 只允许正式数据库 `baihepailei` 存在应用连接。',
    '- 所有产物仅写入被 Git 忽略的 `data_local`。',
    '- AI 输出仍需经过组装、规则解析和人工复核，不能直接发布。',
    ''
  )

  [IO.File]::WriteAllText(
    $File,
    ($lines -join "`n"),
    [Text.UTF8Encoding]::new($false)
  )
}

Assert-IntegerRange -Name 'Limit' -Value $Limit -Minimum 0 -Maximum 1000000
Assert-IntegerRange -Name 'AssessmentBatchSize' -Value $AssessmentBatchSize -Minimum 10 -Maximum 2000
Assert-IntegerRange -Name 'ResearchBatchSize' -Value $ResearchBatchSize -Minimum 10 -Maximum 2000
Assert-IntegerRange -Name 'IdentityBatchSize' -Value $IdentityBatchSize -Minimum 10 -Maximum 2000
Assert-IntegerRange -Name 'ChunkSize' -Value $ChunkSize -Minimum 5 -Maximum 100
Assert-IntegerRange -Name 'AssessmentHandoffBatchLimit' -Value $AssessmentHandoffBatchLimit -Minimum 0 -Maximum 1000

$repoRoot = Get-RepositoryRoot
Set-Location $repoRoot

$currentBranch = (git branch --show-current).Trim()
$currentCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $currentCommit) {
  throw 'Unable to resolve the current Git commit.'
}

if ($Mode -eq 'Export' -and $currentBranch -ne 'main') {
  throw 'Formal export mode is restricted to the merged main branch.'
}
if ($Mode -eq 'Inspect' -and $currentBranch -notin @('main', $ReviewBranch)) {
  throw 'Inspect mode is restricted to main or the dedicated review branch.'
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

if (-not (Test-Path -LiteralPath '.env')) {
  throw '.env is required, but its contents will not be printed.'
}

if (-not $SkipTests) {
  foreach ($script in @($BuildInputScript, $FullCatalogScript, $PrepareHandoffScript)) {
    Invoke-NodeLogged `
      -Arguments @('--check', $script) `
      -FailureMessage "Syntax check failed for $script."
  }

  Invoke-NodeLogged `
    -Arguments @(
      '--test',
      'tests/ai-radar-input-audit.test.mjs',
      'tests/radar-full-catalog-queue.test.mjs',
      'tests/radar-assessment-handoff.test.mjs',
      $RunnerTest
    ) `
    -FailureMessage 'Formal read-only handoff tests failed.'
}

$mainConnections = Get-DatabaseConnectionCount -DatabaseName $MainDatabase
$publicTableCount = Get-PublicTableCount -DatabaseName $MainDatabase
$portListening = Test-NetConnection `
  -ComputerName '127.0.0.1' `
  -Port 3000 `
  -InformationLevel Quiet `
  -WarningAction SilentlyContinue

if ($mainConnections -lt 1) {
  throw 'The formal database has no application connection.'
}
if ($publicTableCount -ne $ExpectedPublicTableCount) {
  throw "The formal database table count is unexpected: $publicTableCount"
}
if (-not $portListening) {
  throw 'Formal Payload port 3000 is not listening.'
}

$emailWasInjected = $false
$passwordWasInjected = $false

if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_EMAIL)) {
  $resolvedEmail = @(
    $env:PAYLOAD_EXPORT_EMAIL,
    $env:SITE_OWNER_EMAIL
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1

  if ([string]::IsNullOrWhiteSpace($resolvedEmail)) {
    $resolvedEmail = Read-Host 'Payload administrator email'
  }
  if ([string]::IsNullOrWhiteSpace($resolvedEmail)) {
    throw 'Payload administrator email is required.'
  }

  $env:RADAR_PAYLOAD_EMAIL = [string]$resolvedEmail
  $emailWasInjected = $true
}

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

$runId = "$(Get-Date -Format 'yyyyMMddHHmmss')-$($currentCommit.Substring(0, 12))"
$modeDirectory = $Mode.ToLowerInvariant()
$runRoot = Join-Path (Join-Path $OutputRoot $modeDirectory) $runId
if (Test-Path -LiteralPath $runRoot) {
  throw "Refusing to reuse output directory: $runRoot"
}
New-Item -ItemType Directory -Force -Path $runRoot | Out-Null

try {
  if ($Mode -eq 'Inspect') {
    $packetFile = Join-Path $runRoot 'inspect-packet.jsonl'
    $summaryFile = Join-Path $runRoot 'inspect-summary.json'

    Invoke-NodeLogged `
      -Arguments @(
        '--env-file=.env',
        $BuildInputScript,
        '--url', $FormalUrl,
        '--limit', '1',
        '--out-dir', $runRoot,
        '--output', $packetFile,
        '--summary', $summaryFile
      ) `
      -FailureMessage 'Formal read-only inspect failed.'

    $summary = Read-Json -File $summaryFile
    if (
      [int]$summary.worksRead -ne 1 -or
      [int]$summary.packetsWritten -ne 1 -or
      $summary.safety.payloadRead -ne $true -or
      $summary.safety.payloadWrite -ne $false -or
      $summary.safety.directPostgresqlWrite -ne $false -or
      $summary.safety.modifiesWorks -ne $false
    ) {
      throw 'Formal inspect summary did not satisfy the read-only gate.'
    }

    $firstLine = Get-Content -LiteralPath $packetFile -Encoding UTF8 -TotalCount 1
    $packet = $firstLine | ConvertFrom-Json -Depth 100

    [pscustomobject]@{
      Mode = $Mode
      Version = $Version
      Branch = $currentBranch
      Commit = $currentCommit
      FormalUrl = $FormalUrl
      Database = $MainDatabase
      DatabaseConnections = $mainConnections
      PublicTableCount = $publicTableCount
      WorksRead = $summary.worksRead
      FirstWorkId = $packet.workId
      FirstTitle = $packet.title
      PayloadWrite = $summary.safety.payloadWrite
      DirectPostgresqlWrite = $summary.safety.directPostgresqlWrite
      OutputDirectory = $runRoot
    } | Format-List

    Write-Host 'Formal database read-only inspection verified.' -ForegroundColor Green
    return
  }

  if ($Confirmation -ne $RequiredConfirmation) {
    throw "Export mode requires -Confirmation $RequiredConfirmation"
  }

  $catalogArgs = @(
    '--env-file=.env',
    $FullCatalogScript,
    '--url', $FormalUrl,
    '--out-dir', $runRoot,
    '--batch-size', [string]$AssessmentBatchSize,
    '--research-batch-size', [string]$ResearchBatchSize,
    '--identity-batch-size', [string]$IdentityBatchSize
  )
  if ($Limit -gt 0) {
    $catalogArgs += @('--limit', [string]$Limit)
  }

  Invoke-NodeLogged `
    -Arguments $catalogArgs `
    -FailureMessage 'Formal catalog read-only export failed.'

  $catalogSummaryFile = Join-Path $runRoot 'full-catalog-preparation-summary-v01.json'
  $catalogSummary = Read-Json -File $catalogSummaryFile
  if (
    $catalogSummary.safety.payloadRead -ne $true -or
    $catalogSummary.safety.payloadWrite -ne $false -or
    $catalogSummary.safety.directPostgresqlWrite -ne $false -or
    $catalogSummary.safety.modifiesWorks -ne $false -or
    $catalogSummary.queue.allRowsAccountedFor -ne $true
  ) {
    throw 'Formal catalog summary did not satisfy the read-only accounting gate.'
  }

  if ($Limit -eq 0 -and [int]$catalogSummary.raw.worksRead -lt $MinimumExpectedFullCatalogWorks) {
    throw "Full formal catalog export read too few Works: $($catalogSummary.raw.worksRead)"
  }

  $batchManifestFile = Join-Path $runRoot 'queue/catalog-batch-manifest-v01.json'
  $batchManifest = Read-Json -File $batchManifestFile
  $assessmentBatches = @(
    $batchManifest.batches |
      Where-Object { [string]$_.queue -eq 'ready_for_ai_assessment' } |
      Sort-Object index
  )

  $selectedBatches = if ($AssessmentHandoffBatchLimit -eq 0) {
    @($assessmentBatches)
  }
  else {
    @($assessmentBatches | Select-Object -First $AssessmentHandoffBatchLimit)
  }

  $handoffRoot = Join-Path $runRoot 'handoffs'
  $packages = @()
  foreach ($entry in $selectedBatches) {
    Invoke-NodeLogged `
      -Arguments @(
        '--env-file=.env',
        $PrepareHandoffScript,
        '--batch-id', [string]$entry.batchId,
        '--manifest', $batchManifestFile,
        '--out-dir', $handoffRoot,
        '--chunk-size', [string]$ChunkSize
      ) `
      -FailureMessage "Assessment handoff preparation failed for $($entry.batchId)."

    $batchSlug = ([string]$entry.batchId).ToLowerInvariant()
    $handoffSummaryFile = Join-Path (Join-Path $handoffRoot $batchSlug) 'handoff-summary.json'
    $handoffSummary = Read-Json -File $handoffSummaryFile
    if (
      $handoffSummary.safety.payloadWrite -ne $false -or
      $handoffSummary.safety.directPostgresqlWrite -ne $false -or
      $handoffSummary.safety.modifiesWorks -ne $false
    ) {
      throw "Handoff safety gate failed for $($entry.batchId)."
    }

    $packages += [pscustomobject]@{
      batchId = [string]$entry.batchId
      rowCount = [int]$handoffSummary.rowCount
      chunkCount = [int]$handoffSummary.chunkCount
      firstUploadFile = [string]$handoffSummary.firstUploadFile
      handoffManifest = [string]$handoffSummary.handoffManifest
      outputDirectory = [string]$handoffSummary.outputDirectory
    }
  }

  $mainConnectionsAfter = Get-DatabaseConnectionCount -DatabaseName $MainDatabase
  $publicTableCountAfter = Get-PublicTableCount -DatabaseName $MainDatabase
  if ($mainConnectionsAfter -lt 1 -or $publicTableCountAfter -ne $ExpectedPublicTableCount) {
    throw 'Formal database topology changed during the read-only export.'
  }

  $uploadPlanFile = Join-Path $runRoot 'UPLOAD_PLAN.md'
  Write-UploadPlan -File $uploadPlanFile -Packages $packages -RunRoot $runRoot

  $finalSummaryFile = Join-Path $runRoot 'formal-readonly-handoff-summary-v01.json'
  $finalSummary = [ordered]@{
    generatedAt = [datetimeoffset]::Now.ToString('o')
    version = $Version
    branch = $currentBranch
    commit = $currentCommit
    serverUrl = $FormalUrl
    database = $MainDatabase
    databaseConnectionsBefore = $mainConnections
    databaseConnectionsAfter = $mainConnectionsAfter
    publicTableCountBefore = $publicTableCount
    publicTableCountAfter = $publicTableCountAfter
    limit = if ($Limit -gt 0) { $Limit } else { $null }
    catalog = [ordered]@{
      worksRead = [int]$catalogSummary.raw.worksRead
      packetsWritten = [int]$catalogSummary.raw.packetsWritten
      cleanRows = [int]$catalogSummary.audit.cleanRows
      allRowsAccountedFor = [bool]$catalogSummary.queue.allRowsAccountedFor
      byQueue = $catalogSummary.queue.byQueue
      batchCounts = $catalogSummary.queue.batchCounts
      catalogSummary = $catalogSummaryFile
      batchManifest = $batchManifestFile
      batchManifestSha256 = (Get-FileHash -LiteralPath $batchManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    handoffs = [ordered]@{
      availableAssessmentBatches = $assessmentBatches.Count
      preparedAssessmentBatches = $packages.Count
      requestedBatchLimit = $AssessmentHandoffBatchLimit
      chunkSize = $ChunkSize
      packages = $packages
      firstUploadFile = if ($packages.Count) { $packages[0].firstUploadFile } else { $null }
      uploadPlan = $uploadPlanFile
    }
    safety = [ordered]@{
      payloadRead = $true
      payloadWrite = $false
      payloadPatchRequests = 0
      directPostgresqlWrite = $false
      modifiesWorks = $false
      publishesRatings = $false
      credentialsWrittenToOutput = $false
      outputsOnlyUnderDataLocal = $true
      existingHumanTrackPreservedInPackets = $true
      existingRankNotTreatedAsGroundTruth = $true
    }
    nextStep = 'Upload chunk input files in UPLOAD_PLAN.md order for AI assessment. Save responses exactly as named, then use the existing handoff assembler. Do not publish from this export.'
  }
  Write-Json -File $finalSummaryFile -Value $finalSummary

  [pscustomobject]@{
    Mode = $Mode
    Version = $Version
    Branch = $currentBranch
    Commit = $currentCommit
    WorksRead = $finalSummary.catalog.worksRead
    CleanRows = $finalSummary.catalog.cleanRows
    AllRowsAccountedFor = $finalSummary.catalog.allRowsAccountedFor
    AvailableAssessmentBatches = $finalSummary.handoffs.availableAssessmentBatches
    PreparedAssessmentBatches = $finalSummary.handoffs.preparedAssessmentBatches
    FirstUploadFile = $finalSummary.handoffs.firstUploadFile
    UploadPlan = $uploadPlanFile
    Summary = $finalSummaryFile
    PayloadWrite = $finalSummary.safety.payloadWrite
    DirectPostgresqlWrite = $finalSummary.safety.directPostgresqlWrite
  } | Format-List

  Write-Host 'Formal database read-only AI Radar handoff export verified.' -ForegroundColor Green
}
finally {
  if ($passwordWasInjected) {
    Remove-Item Env:RADAR_PAYLOAD_PASSWORD -ErrorAction SilentlyContinue
  }
  if ($emailWasInjected) {
    Remove-Item Env:RADAR_PAYLOAD_EMAIL -ErrorAction SilentlyContinue
  }
}
