param(
  [Parameter(Mandatory = $true)][string]$EvidenceZip,
  [Parameter(Mandatory = $true)][string]$ExpectedEvidenceSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedCandidateSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedToolHead,
  [Parameter(Mandatory = $true)][ValidateSet('AUDIT-RADAR-UNIFIED-RATING-INCREMENTAL-REHEARSAL-9988-V01')][string]$Confirm
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedResearchHead = 'c8790df95d1235d8d1aacabfb7c119fec9e1c642'
$ExpectedReleaseId = 'RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-0001'
$ExpectedDatabase = 'radar_incremental_rehearsal'
$ExpectedRows = 9988
$ExpectedRecordCreates = 9988
$ExpectedRatingCreates = 9988
$ExpectedLedgerRows = 19976
$ExpectedWorks = 35615
$ExpectedExistingRecords = 575
$ExpectedExistingRatings = 575
$ExpectedStorage = [ordered]@{
  publicRecords = 9988
  facts = 39952
  evidence = 12673
  factSourceRefs = 50692
  publicRatings = 9988
  matchedClasses = 9988
  ratingFactRefs = 39952
  ratingEvidenceRefs = 12673
  unresolvedDimensions = 107832
  confirmationBasis = 42637
  publicTagHints = 10484
  publicWarningTemplateIds = 10484
  proposedProfileChanges = 0
  additionalEvidenceRefs = 0
}

if ($Confirm -ne 'AUDIT-RADAR-UNIFIED-RATING-INCREMENTAL-REHEARSAL-9988-V01') {
  throw '确认字符串不匹配。'
}
foreach ($pair in @(
  @{ Name = 'ExpectedEvidenceSha256'; Value = $ExpectedEvidenceSha256; Pattern = '^[a-fA-F0-9]{64}$' },
  @{ Name = 'ExpectedCandidateSha256'; Value = $ExpectedCandidateSha256; Pattern = '^[a-fA-F0-9]{64}$' },
  @{ Name = 'ExpectedToolHead'; Value = $ExpectedToolHead; Pattern = '^[a-fA-F0-9]{40}$' }
)) {
  if ([string]$pair.Value -notmatch [string]$pair.Pattern) {
    throw "$($pair.Name) 格式无效。"
  }
}

$ExpectedEvidenceSha256 = $ExpectedEvidenceSha256.ToLowerInvariant()
$ExpectedCandidateSha256 = $ExpectedCandidateSha256.ToLowerInvariant()
$ExpectedToolHead = $ExpectedToolHead.ToLowerInvariant()
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-FileSha([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-Json([string]$Path) {
  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
}

function Read-Jsonl([string]$Path) {
  $rows = @()
  $lineNumber = 0
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $lineNumber += 1
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    try {
      $rows += $line | ConvertFrom-Json -Depth 100
    } catch {
      throw "JSONL 无法解析：$Path line=$lineNumber"
    }
  }
  return @($rows)
}

function Read-TsvMap([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    Assert-True ($parts.Count -ge 2) "TSV 无法解析：$Path"
    Assert-True (-not $map.ContainsKey($parts[0])) "TSV 键重复：$($parts[0])"
    $map[$parts[0]] = ($parts[1..($parts.Count - 1)] -join "`t")
  }
  return $map
}

function Assert-MapsEqual([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  Assert-True (($expectedKeys -join "`n") -eq ($actualKeys -join "`n")) "$Label 键集合不一致。"
  foreach ($key in $expectedKeys) {
    Assert-True ([string]$Expected[$key] -eq [string]$Actual[$key]) "$Label 不一致：$key"
  }
}

function Assert-JsonStorage([object]$Actual, [string]$Label) {
  foreach ($entry in $ExpectedStorage.GetEnumerator()) {
    Assert-True ([long]$Actual.($entry.Key) -eq [long]$entry.Value) "$Label expectedStorage 不匹配：$($entry.Key)"
  }
}

function Normalize-ZipPath([string]$Value) {
  return $Value.Replace('\', '/')
}

$zipPath = (Resolve-Path -LiteralPath $EvidenceZip).Path
Assert-True ((Get-Item -LiteralPath $zipPath).Length -gt 0) 'Evidence ZIP 为空。'
$evidenceSha256 = Get-FileSha $zipPath
Assert-True ($evidenceSha256 -eq $ExpectedEvidenceSha256) "Evidence ZIP SHA-256 不匹配：$evidenceSha256"

& git merge-base --is-ancestor $ExpectedToolHead HEAD
Assert-True ($LASTEXITCODE -eq 0) '当前仓库不包含被审计的 ToolHead。'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$extractRoot = Join-Path $repoRoot ('data_local\outputs\radar-unified-rating-incremental-evidence-audit-9988-v01\extract-' + [Guid]::NewGuid().ToString('N'))
$reportRoot = Join-Path $repoRoot ('data_local\outputs\radar-unified-rating-incremental-evidence-audit-9988-v01\audit-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $extractRoot, $reportRoot -Force | Out-Null

try {
  $fileEntries = @()
  $seen = @{}
  foreach ($entry in $archive.Entries) {
    $name = Normalize-ZipPath ([string]$entry.FullName)
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    if ($name.EndsWith('/')) { continue }
    Assert-True (-not $name.StartsWith('/')) "ZIP 包含绝对路径：$name"
    Assert-True ($name -notmatch '^[A-Za-z]:') "ZIP 包含盘符路径：$name"
    Assert-True ($name.IndexOf([char]0) -lt 0) 'ZIP 路径包含 NUL。'
    $segments = @($name.Split('/'))
    Assert-True ($segments.Count -gt 0 -and -not ($segments -contains '..') -and -not ($segments -contains '.')) "ZIP 路径不安全：$name"
    $key = $name.ToLowerInvariant()
    Assert-True (-not $seen.ContainsKey($key)) "ZIP 文件名重复：$name"
    $seen[$key] = $true
    $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
    Assert-True ($unixType -ne 0xA000) "ZIP 包含符号链接：$name"
    Assert-True ($name -notmatch '(?i)\.(?:zip|7z|rar|tar|tgz|gz|bz2|xz|dump)$') "ZIP 包含嵌套归档或数据库备份：$name"
    Assert-True ($name -notmatch '(?i)(?:^|/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials\.json)$') "ZIP 包含敏感文件名：$name"
    Assert-True ($name -notmatch '(?i)\.(?:pem|key|p12|pfx)$') "ZIP 包含密钥文件：$name"
    $fileEntries += $entry
  }
  Assert-True ($fileEntries.Count -gt 10) 'Evidence ZIP 文件数量异常。'
  [System.IO.Compression.ZipFileExtensions]::ExtractToDirectory($archive, $extractRoot, $true)
} finally {
  $archive.Dispose()
}

try {
  $allFiles = @(Get-ChildItem -LiteralPath $extractRoot -File -Recurse)
  $relativeFiles = @($allFiles | ForEach-Object { $_.FullName.Substring($extractRoot.Length).TrimStart('\', '/').Replace('\', '/') })
  Assert-True ($relativeFiles -contains 'manifest.json') 'Evidence ZIP 缺少 manifest.json。'
  Assert-True ($relativeFiles -contains 'SHA256SUMS') 'Evidence ZIP 缺少 SHA256SUMS。'

  $manifestPath = Join-Path $extractRoot 'manifest.json'
  $sumsPath = Join-Path $extractRoot 'SHA256SUMS'
  $manifest = @(Read-Json $manifestPath)
  $manifestMap = @{}
  foreach ($entry in $manifest) {
    $name = Normalize-ZipPath ([string]$entry.file)
    Assert-True (-not [string]::IsNullOrWhiteSpace($name)) 'manifest 文件名为空。'
    Assert-True (-not $manifestMap.ContainsKey($name)) "manifest 文件重复：$name"
    Assert-True ([string]$entry.sha256 -match '^[a-f0-9]{64}$') "manifest SHA 格式无效：$name"
    $manifestMap[$name] = $entry
  }

  $sumMap = @{}
  foreach ($line in Get-Content -LiteralPath $sumsPath -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $match = [regex]::Match([string]$line, '^([a-f0-9]{64})  (.+)$')
    Assert-True ($match.Success) "SHA256SUMS 无法解析：$line"
    $name = Normalize-ZipPath $match.Groups[2].Value
    Assert-True (-not $sumMap.ContainsKey($name)) "SHA256SUMS 文件重复：$name"
    $sumMap[$name] = $match.Groups[1].Value
  }

  $payloadFiles = @($relativeFiles | Where-Object { $_ -notin @('manifest.json', 'SHA256SUMS') } | Sort-Object)
  $manifestFiles = @($manifestMap.Keys | Sort-Object)
  $sumFiles = @($sumMap.Keys | Sort-Object)
  Assert-True (($payloadFiles -join "`n") -eq ($manifestFiles -join "`n")) 'manifest 闭世界文件集合不匹配。'
  Assert-True (($payloadFiles -join "`n") -eq ($sumFiles -join "`n")) 'SHA256SUMS 闭世界文件集合不匹配。'

  foreach ($name in $payloadFiles) {
    $path = Join-Path $extractRoot $name
    $actualBytes = [long](Get-Item -LiteralPath $path).Length
    $actualSha = Get-FileSha $path
    Assert-True ($actualBytes -eq [long]$manifestMap[$name].bytes) "文件字节数不匹配：$name"
    Assert-True ($actualSha -eq [string]$manifestMap[$name].sha256) "manifest SHA 不匹配：$name"
    Assert-True ($actualSha -eq [string]$sumMap[$name]) "SHA256SUMS 不匹配：$name"
  }

  $required = @(
    'rehearsal-acceptance.json',
    'rehearsal-stage-status.json',
    'radar-unified-rating-incremental-rehearsal-candidate-9988-v02.json',
    'critical-code-SHA256SUMS',
    'temporary-plan-import/accepted-receipt.json',
    'temporary-apply-import/accepted-receipt.json',
    'temporary-verify-import/accepted-receipt.json',
    'temporary-apply-import/create-ledger.jsonl',
    'temporary-plan-import/http-requests.jsonl',
    'temporary-apply-import/http-requests.jsonl',
    'temporary-verify-import/http-requests.jsonl',
    'temporary-apply-import/pre-import-plan.jsonl',
    'temporary-apply-import/post-import-plan.jsonl',
    'source-before-backup-table-counts.tsv',
    'source-after-backup-table-counts.tsv',
    'source-final-table-counts.tsv',
    'temporary-restored-table-counts.tsv',
    'temporary-post-apply-table-counts.tsv',
    'source-before-backup-protected-fingerprints.tsv',
    'source-after-backup-protected-fingerprints.tsv',
    'source-final-protected-fingerprints.tsv',
    'temporary-restored-protected-fingerprints.tsv',
    'temporary-post-apply-protected-fingerprints.tsv'
  )
  foreach ($name in $required) {
    Assert-True ($relativeFiles -contains $name) "Evidence ZIP 缺少必需文件：$name"
  }
  Assert-True (-not ($relativeFiles -contains 'rehearsal-failure.json')) '成功证据包不应包含 rehearsal-failure.json。'
  Assert-True (@($relativeFiles | Where-Object { $_ -match '(?i)(?:^|/)failure-receipt\.json$' }).Count -eq 0) '成功证据包不应包含 importer failure receipt。'

  $candidatePath = Join-Path $extractRoot 'radar-unified-rating-incremental-rehearsal-candidate-9988-v02.json'
  Assert-True ((Get-FileSha $candidatePath) -eq $ExpectedCandidateSha256) 'Candidate SHA-256 不匹配。'
  $candidate = Read-Json $candidatePath
  $acceptance = Read-Json (Join-Path $extractRoot 'rehearsal-acceptance.json')
  $stage = Read-Json (Join-Path $extractRoot 'rehearsal-stage-status.json')
  $planReceipt = Read-Json (Join-Path $extractRoot 'temporary-plan-import\accepted-receipt.json')
  $applyReceipt = Read-Json (Join-Path $extractRoot 'temporary-apply-import\accepted-receipt.json')
  $verifyReceipt = Read-Json (Join-Path $extractRoot 'temporary-verify-import\accepted-receipt.json')

  Assert-True ($candidate.accepted -eq $true) 'Candidate 未被接受。'
  Assert-True ([string]$candidate.toolHead -eq $ExpectedToolHead) 'Candidate ToolHead 不匹配。'
  Assert-True ([string]$candidate.researchHead -eq $ExpectedResearchHead) 'Candidate ResearchHead 不匹配。'
  Assert-True ([string]$candidate.releaseId -eq $ExpectedReleaseId) 'Candidate Release ID 不匹配。'
  Assert-True ([long]$candidate.source.works -eq $ExpectedWorks) 'Candidate Works 数量不匹配。'
  Assert-True ([long]$candidate.source.publicRecords -eq $ExpectedExistingRecords) 'Candidate 既有 Records 数量不匹配。'
  Assert-True ([long]$candidate.source.publicRatings -eq $ExpectedExistingRatings) 'Candidate 既有 Ratings 数量不匹配。'
  Assert-True ($candidate.source.authenticationPerformed -eq $false) 'Candidate 显示源库认证。'
  Assert-True ($candidate.source.payloadAccess -eq $false) 'Candidate 显示源 Payload 访问。'
  Assert-True ([long]$candidate.expectedTransition.recordsReadyCreate -eq $ExpectedRows) 'Candidate Record transition 不匹配。'
  Assert-True ([long]$candidate.expectedTransition.ratingsReadyCreate -eq $ExpectedRows) 'Candidate Rating transition 不匹配。'
  Assert-True ([long]$candidate.expectedTransition.updates -eq 0 -and [long]$candidate.expectedTransition.deletes -eq 0 -and [long]$candidate.expectedTransition.blockers -eq 0) 'Candidate transition 不是 create-only。'
  Assert-JsonStorage $candidate.expectedStorage 'Candidate'
  Assert-True ($candidate.sourceDatabaseWrite -eq $false -and $candidate.productionAuthorization -eq $false) 'Candidate 越过生产边界。'

  Assert-True ($acceptance.accepted -eq $true) 'Rehearsal acceptance 未接受。'
  Assert-True ([string]$acceptance.toolHead -eq $ExpectedToolHead) 'Acceptance ToolHead 不匹配。'
  Assert-True ([string]$acceptance.researchHead -eq $ExpectedResearchHead) 'Acceptance ResearchHead 不匹配。'
  Assert-True ([string]$acceptance.releaseId -eq $ExpectedReleaseId) 'Acceptance Release ID 不匹配。'
  Assert-True ([string]$acceptance.candidateSha256 -eq $ExpectedCandidateSha256) 'Acceptance Candidate SHA 不匹配。'
  Assert-True ([long]$acceptance.sourceState.works -eq $ExpectedWorks) 'Acceptance Works 不匹配。'
  Assert-True ([long]$acceptance.sourceState.publicRecords -eq $ExpectedExistingRecords) 'Acceptance 源 Records 不匹配。'
  Assert-True ([long]$acceptance.sourceState.publicRatings -eq $ExpectedExistingRatings) 'Acceptance 源 Ratings 不匹配。'
  Assert-True ($acceptance.sourceState.authenticationPerformed -eq $false -and $acceptance.sourceState.payloadAccess -eq $false) 'Acceptance 显示源 Payload 访问。'
  Assert-True ([long]$acceptance.rehearsal.publicRecordsCreated -eq $ExpectedRecordCreates) 'Acceptance Record creates 不匹配。'
  Assert-True ([long]$acceptance.rehearsal.publicRatingsCreated -eq $ExpectedRatingCreates) 'Acceptance Rating creates 不匹配。'
  Assert-True ([long]$acceptance.rehearsal.postRecordsAlreadyCurrent -eq $ExpectedRows) 'Acceptance Record convergence 不匹配。'
  Assert-True ([long]$acceptance.rehearsal.postRatingsAlreadyCurrent -eq $ExpectedRows) 'Acceptance Rating convergence 不匹配。'
  Assert-True ([long]$acceptance.rehearsal.blockers -eq 0 -and [long]$acceptance.rehearsal.updates -eq 0 -and [long]$acceptance.rehearsal.deletes -eq 0) 'Acceptance 非 create-only。'
  Assert-JsonStorage $acceptance.expectedStorage 'Acceptance'
  Assert-True ($acceptance.protectedFingerprintsUnchanged -eq $true -and $acceptance.sourceCountsUnchanged -eq $true) 'Acceptance 未确认源状态不变。'
  Assert-True ($acceptance.sourceDatabaseWrite -eq $false -and $acceptance.temporaryDatabaseDestroyed -eq $true -and $acceptance.productionAuthorization -eq $false) 'Acceptance 生产边界不正确。'

  foreach ($property in @(
    'transitionPlanBound','freshBackupCreated','writersRestartedAfterBackup','freshBackupRestored','restoredStateMatched',
    'rehearsalPlanPassed','rehearsalApplyPassed','rehearsalVerifyPassed','postStorageVerified',
    'protectedFingerprintsUnchanged','sourceFinalStateUnchanged','temporaryDatabaseDestroyed'
  )) {
    Assert-True ($stage.$property -eq $true) "Stage 未通过：$property"
  }
  Assert-True ($stage.sourceAuthenticationPerformed -eq $false -and $stage.sourcePayloadAccess -eq $false -and $stage.sourceDatabaseWrite -eq $false -and $stage.productionAuthorization -eq $false) 'Stage 源库或生产边界不正确。'

  Assert-True ([string]$planReceipt.mode -eq 'plan' -and $planReceipt.accepted -eq $true) 'Plan receipt 无效。'
  Assert-True ([string]$planReceipt.database -eq $ExpectedDatabase) 'Plan receipt 数据库不匹配。'
  Assert-True ([long]$planReceipt.preImport.rows -eq $ExpectedRows -and [long]$planReceipt.preImport.recordStatusCounts.ready_create -eq $ExpectedRows -and [long]$planReceipt.preImport.ratingStatusCounts.ready_create -eq $ExpectedRows -and [long]$planReceipt.preImport.blockers -eq 0) 'Plan receipt transition 不匹配。'
  Assert-JsonStorage $planReceipt.expectedStorage 'Plan receipt'
  Assert-True ($planReceipt.productionWrite -eq $false -and $planReceipt.productionAuthorization -eq $false) 'Plan receipt 不应授权写入。'

  Assert-True ([string]$applyReceipt.mode -eq 'apply' -and $applyReceipt.accepted -eq $true) 'Apply receipt 无效。'
  Assert-True ([string]$applyReceipt.database -eq $ExpectedDatabase) 'Apply receipt 未绑定临时数据库。'
  Assert-True ([string]$applyReceipt.mainHead -eq $ExpectedToolHead -and [string]$applyReceipt.researchHead -eq $ExpectedResearchHead -and [string]$applyReceipt.candidateSha256 -eq $ExpectedCandidateSha256) 'Apply receipt 身份不匹配。'
  Assert-True ([long]$applyReceipt.counts.recordCreate -eq $ExpectedRecordCreates -and [long]$applyReceipt.counts.ratingCreate -eq $ExpectedRatingCreates) 'Apply receipt create 数量不匹配。'
  Assert-True ([long]$applyReceipt.counts.updateRequests -eq 0 -and [long]$applyReceipt.counts.putRequests -eq 0 -and [long]$applyReceipt.counts.deleteRequests -eq 0) 'Apply receipt 存在非 create 请求。'
  Assert-True ([long]$applyReceipt.postImport.recordStatusCounts.already_current -eq $ExpectedRows -and [long]$applyReceipt.postImport.ratingStatusCounts.already_current -eq $ExpectedRows -and [long]$applyReceipt.postImport.blockers -eq 0) 'Apply receipt 未收敛。'
  Assert-JsonStorage $applyReceipt.expectedStorage 'Apply receipt'
  Assert-True ($applyReceipt.productionWrite -eq $true -and $applyReceipt.productionAuthorization -eq $true) 'Apply importer 未进入受控写模式。'

  Assert-True ([string]$verifyReceipt.mode -eq 'verify' -and $verifyReceipt.accepted -eq $true) 'Verify receipt 无效。'
  Assert-True ([string]$verifyReceipt.database -eq $ExpectedDatabase) 'Verify receipt 数据库不匹配。'
  Assert-True ([long]$verifyReceipt.postImport.recordStatusCounts.already_current -eq $ExpectedRows -and [long]$verifyReceipt.postImport.ratingStatusCounts.already_current -eq $ExpectedRows -and [long]$verifyReceipt.postImport.blockers -eq 0) 'Verify receipt 未收敛。'
  Assert-True ($verifyReceipt.productionWrite -eq $false -and $verifyReceipt.productionAuthorization -eq $false) 'Verify receipt 不应授权写入。'

  foreach ($receipt in @($planReceipt, $applyReceipt, $verifyReceipt)) {
    Assert-True ([string]$receipt.releaseId -eq $ExpectedReleaseId) 'Importer receipt Release ID 不匹配。'
    Assert-True ([string]$receipt.mainHead -eq $ExpectedToolHead) 'Importer receipt ToolHead 不匹配。'
    Assert-True ([string]$receipt.researchHead -eq $ExpectedResearchHead) 'Importer receipt ResearchHead 不匹配。'
    Assert-True ([string]$receipt.candidateSha256 -eq $ExpectedCandidateSha256) 'Importer receipt Candidate SHA 不匹配。'
  }

  $ledger = Read-Jsonl (Join-Path $extractRoot 'temporary-apply-import\create-ledger.jsonl')
  Assert-True ($ledger.Count -eq $ExpectedLedgerRows) "Create ledger 行数不匹配：$($ledger.Count)"
  $records = @($ledger | Where-Object { [string]$_.kind -eq 'record' })
  $ratings = @($ledger | Where-Object { [string]$_.kind -eq 'rating' })
  Assert-True ($records.Count -eq $ExpectedRecordCreates -and $ratings.Count -eq $ExpectedRatingCreates) 'Create ledger 类型数量不匹配。'
  Assert-True ((@($ledger | Select-Object -First $ExpectedRows | Where-Object { [string]$_.kind -ne 'record' })).Count -eq 0) 'Create ledger 前半段不是 Records。'
  Assert-True ((@($ledger | Select-Object -Skip $ExpectedRows | Where-Object { [string]$_.kind -ne 'rating' })).Count -eq 0) 'Create ledger 后半段不是 Ratings。'
  for ($index = 0; $index -lt $ExpectedRows; $index += 1) {
    $ordinal = $index + 1
    Assert-True ([long]$records[$index].releaseOrdinal -eq $ordinal) "Record ledger ordinal 不匹配：$ordinal"
    Assert-True ([long]$ratings[$index].releaseOrdinal -eq $ordinal) "Rating ledger ordinal 不匹配：$ordinal"
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$records[$index].identityKey)) "Record ledger identity 为空：$ordinal"
    Assert-True ([string]$records[$index].identityKey -eq [string]$ratings[$index].identityKey) "Record/Rating ledger identity 不一致：$ordinal"
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$records[$index].id)) "Record ledger id 为空：$ordinal"
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$ratings[$index].id)) "Rating ledger id 为空：$ordinal"
  }
  Assert-True ((@($records.id | Sort-Object -Unique)).Count -eq $ExpectedRows) 'Record ledger ID 不唯一。'
  Assert-True ((@($ratings.id | Sort-Object -Unique)).Count -eq $ExpectedRows) 'Rating ledger ID 不唯一。'

  $prePlan = Read-Jsonl (Join-Path $extractRoot 'temporary-apply-import\pre-import-plan.jsonl')
  $postPlan = Read-Jsonl (Join-Path $extractRoot 'temporary-apply-import\post-import-plan.jsonl')
  Assert-True ($prePlan.Count -eq $ExpectedRows -and $postPlan.Count -eq $ExpectedRows) 'Apply plan 行数不匹配。'
  for ($index = 0; $index -lt $ExpectedRows; $index += 1) {
    $ordinal = $index + 1
    Assert-True ([long]$prePlan[$index].releaseOrdinal -eq $ordinal -and [long]$postPlan[$index].releaseOrdinal -eq $ordinal) "Plan ordinal 不匹配：$ordinal"
    Assert-True ([string]$prePlan[$index].identityKey -eq [string]$records[$index].identityKey) "Pre-plan / ledger identity 不一致：$ordinal"
    Assert-True ([string]$postPlan[$index].identityKey -eq [string]$records[$index].identityKey) "Post-plan / ledger identity 不一致：$ordinal"
    Assert-True ([string]$prePlan[$index].recordPlanStatus -eq 'ready_create' -and [string]$prePlan[$index].ratingPlanStatus -eq 'ready_create') "Pre-plan 状态不匹配：$ordinal"
    Assert-True ([string]$postPlan[$index].recordPlanStatus -eq 'already_current' -and [string]$postPlan[$index].ratingPlanStatus -eq 'already_current') "Post-plan 状态不匹配：$ordinal"
  }

  $httpSummary = [ordered]@{}
  foreach ($mode in @('plan', 'apply', 'verify')) {
    $rows = Read-Jsonl (Join-Path $extractRoot "temporary-$mode-import\http-requests.jsonl")
    $badMethods = @($rows | Where-Object { [string]$_.method -in @('PATCH', 'PUT', 'DELETE') })
    Assert-True ($badMethods.Count -eq 0) "$mode HTTP 日志包含 PATCH/PUT/DELETE。"
    $recordPosts = @($rows | Where-Object { [string]$_.method -eq 'POST' -and [string]$_.writeKind -eq 'record_create' -and $_.ok -eq $true })
    $ratingPosts = @($rows | Where-Object { [string]$_.method -eq 'POST' -and [string]$_.writeKind -eq 'rating_create' -and $_.ok -eq $true })
    if ($mode -eq 'apply') {
      Assert-True ($recordPosts.Count -eq $ExpectedRecordCreates) 'Apply HTTP Record POST 数量不匹配。'
      Assert-True ($ratingPosts.Count -eq $ExpectedRatingCreates) 'Apply HTTP Rating POST 数量不匹配。'
    } else {
      Assert-True ($recordPosts.Count -eq 0 -and $ratingPosts.Count -eq 0) "$mode 不应包含内容 POST。"
    }
    $httpSummary[$mode] = [ordered]@{
      rows = $rows.Count
      recordPosts = $recordPosts.Count
      ratingPosts = $ratingPosts.Count
      patchPutDelete = $badMethods.Count
    }
  }

  $sourceBefore = Read-TsvMap (Join-Path $extractRoot 'source-before-backup-table-counts.tsv')
  $sourceAfter = Read-TsvMap (Join-Path $extractRoot 'source-after-backup-table-counts.tsv')
  $sourceFinal = Read-TsvMap (Join-Path $extractRoot 'source-final-table-counts.tsv')
  $temporaryRestored = Read-TsvMap (Join-Path $extractRoot 'temporary-restored-table-counts.tsv')
  $temporaryPost = Read-TsvMap (Join-Path $extractRoot 'temporary-post-apply-table-counts.tsv')
  Assert-MapsEqual $sourceBefore $sourceAfter 'Source backup 前后 counts'
  Assert-MapsEqual $sourceBefore $sourceFinal 'Source rehearsal 前后 counts'
  Assert-MapsEqual $sourceBefore $temporaryRestored 'Source → temporary restored counts'
  Assert-True ([long]$sourceBefore['public.works'] -eq $ExpectedWorks) 'Source Works 数量不匹配。'
  Assert-True ([long]$sourceBefore['public.radar_public_records'] -eq $ExpectedExistingRecords) 'Source Records 数量不匹配。'
  Assert-True ([long]$sourceBefore['public.radar_public_ratings'] -eq $ExpectedExistingRatings) 'Source Ratings 数量不匹配。'

  $expectedDeltas = [ordered]@{
    'public.radar_public_records' = 9988
    'public.radar_public_records_facts' = 39952
    'public.radar_public_records_evidence' = 12673
    'public.radar_public_records_facts_source_refs' = 50692
    'public.radar_public_ratings' = 9988
    'public.radar_public_ratings_matched_classes' = 9988
    'public.radar_public_ratings_fact_refs' = 39952
    'public.radar_public_ratings_evidence_refs' = 12673
    'public.radar_public_ratings_unresolved_dimensions' = 107832
    'public.radar_public_ratings_confirmation_basis' = 42637
    'public.radar_public_ratings_public_tag_hints' = 10484
    'public.radar_public_ratings_public_warning_template_ids' = 10484
    'public.radar_public_ratings_human_review_proposed_profile_changes' = 0
    'public.radar_public_ratings_human_review_additional_evidence_refs' = 0
    'public.audit_events' = 19976
    'public.users_sessions' = 3
  }
  $allCountKeys = @($sourceBefore.Keys | Sort-Object)
  Assert-True (($allCountKeys -join "`n") -eq (@($temporaryPost.Keys | Sort-Object) -join "`n")) 'Temporary post counts 键集合变化。'
  foreach ($key in $allCountKeys) {
    $expectedDelta = if ($expectedDeltas.Contains($key)) { [long]$expectedDeltas[$key] } else { 0 }
    $actualDelta = [long]$temporaryPost[$key] - [long]$sourceBefore[$key]
    Assert-True ($actualDelta -eq $expectedDelta) "Temporary post count delta 不匹配：$key actual=$actualDelta expected=$expectedDelta"
  }

  $fingerprintFiles = @(
    'source-before-backup-protected-fingerprints.tsv',
    'source-after-backup-protected-fingerprints.tsv',
    'source-final-protected-fingerprints.tsv',
    'temporary-restored-protected-fingerprints.tsv',
    'temporary-post-apply-protected-fingerprints.tsv'
  )
  $fingerprintBaseline = Read-TsvMap (Join-Path $extractRoot $fingerprintFiles[0])
  foreach ($name in $fingerprintFiles[1..($fingerprintFiles.Count - 1)]) {
    Assert-MapsEqual $fingerprintBaseline (Read-TsvMap (Join-Path $extractRoot $name)) "Protected fingerprints: $name"
  }

  $criticalLines = @(Get-Content -LiteralPath (Join-Path $extractRoot 'critical-code-SHA256SUMS') -Encoding UTF8 | Where-Object { $_ })
  $criticalMap = @{}
  foreach ($line in $criticalLines) {
    $match = [regex]::Match([string]$line, '^([a-f0-9]{64})  (.+)$')
    Assert-True ($match.Success) "critical-code-SHA256SUMS 无法解析：$line"
    $criticalMap[$match.Groups[2].Value] = $match.Groups[1].Value
  }
  Assert-True ($criticalMap.Count -eq @($candidate.criticalCodeFiles).Count) 'Critical code 文件数量不匹配。'
  foreach ($entry in @($candidate.criticalCodeFiles)) {
    $relative = [string]$entry.file
    Assert-True ($criticalMap.ContainsKey($relative)) "Critical code manifest 缺少：$relative"
    Assert-True ([string]$criticalMap[$relative] -eq [string]$entry.sha256) "Critical code candidate hash 不匹配：$relative"
    $currentPath = Join-Path $repoRoot $relative
    Assert-True (Test-Path -LiteralPath $currentPath -PathType Leaf) "当前仓库缺少 critical code：$relative"
    Assert-True ((Get-FileSha $currentPath) -eq [string]$entry.sha256) "当前仓库 critical code 已变化：$relative"
  }

  $secretFindings = @()
  $textExtensions = @('.json', '.jsonl', '.txt', '.tsv', '.sql', '.md', '')
  foreach ($file in $allFiles) {
    if (-not ($textExtensions -contains $file.Extension.ToLowerInvariant()) -and $file.Name -ne 'SHA256SUMS') { continue }
    if ($file.Length -gt 150MB) { throw "Evidence 单个文本文件异常大：$($file.FullName)" }
    $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    $relative = $file.FullName.Substring($extractRoot.Length).TrimStart('\', '/').Replace('\', '/')
    foreach ($pattern in @(
      '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
      '(?i)postgres(?:ql)?://[^\s"''<>]+',
      '(?im)^\s*(?:DATABASE_URL|POSTGRES_URL|PAYLOAD_SECRET|JWT_SECRET|PASSWORD|RADAR_PAYLOAD_PASSWORD)\s*=',
      '(?i)authorization\s*:\s*bearer\s+[A-Za-z0-9._~-]+',
      '(?i)"token"\s*:\s*"[A-Za-z0-9._~-]{20,}"'
    )) {
      if ($text -match $pattern) { $secretFindings += "$relative :: $pattern" }
    }
  }
  Assert-True ($secretFindings.Count -eq 0) "Evidence 包含潜在凭据或数据库 URL：$($secretFindings -join '; ')"

  $report = [ordered]@{
    schemaVersion = 'radar-unified-rating-incremental-rehearsal-evidence-audit-9988-v01'
    accepted = $true
    auditedAt = [DateTime]::UtcNow.ToString('o')
    evidenceZip = $zipPath
    evidenceBytes = [long](Get-Item -LiteralPath $zipPath).Length
    evidenceSha256 = $evidenceSha256
    candidateSha256 = $ExpectedCandidateSha256
    toolHead = $ExpectedToolHead
    researchHead = $ExpectedResearchHead
    releaseId = $ExpectedReleaseId
    zipFiles = $relativeFiles.Count
    manifestPayloadFiles = $payloadFiles.Count
    createLedgerRows = $ledger.Count
    recordCreates = $records.Count
    ratingCreates = $ratings.Count
    postRecordsAlreadyCurrent = [long]$verifyReceipt.postImport.recordStatusCounts.already_current
    postRatingsAlreadyCurrent = [long]$verifyReceipt.postImport.ratingStatusCounts.already_current
    http = $httpSummary
    sourceCountsUnchanged = $true
    protectedFingerprintsUnchanged = $true
    temporaryDatabase = $ExpectedDatabase
    temporaryDatabaseDestroyed = $true
    sourceAuthentication = $false
    sourcePayloadAccess = $false
    sourceDatabaseWrite = $false
    productionAuthorization = $false
    databaseBackupIncluded = $false
    credentialsIncluded = $false
    blockers = @()
    decision = 'accept_independent_incremental_rehearsal_evidence_9988_v01'
  }
  $jsonPath = Join-Path $reportRoot 'audit-report.json'
  $mdPath = Join-Path $reportRoot 'audit-report.md'
  [System.IO.File]::WriteAllText($jsonPath, (($report | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
  $md = @"
# 9,988-row incremental rehearsal evidence audit

- Decision: `accept_independent_incremental_rehearsal_evidence_9988_v01`
- Evidence SHA-256: `$evidenceSha256`
- Candidate SHA-256: `$ExpectedCandidateSha256`
- Tool head: `$ExpectedToolHead`
- Research head: `$ExpectedResearchHead`
- ZIP files: $($relativeFiles.Count)
- Manifest payload files: $($payloadFiles.Count)
- Create ledger: $($ledger.Count) rows
- Records created: $($records.Count)
- Ratings created: $($ratings.Count)
- Post-import convergence: $ExpectedRows Records / $ExpectedRows Ratings
- Source counts unchanged: true
- Protected fingerprints unchanged: true
- Temporary database destroyed: true
- Source database write: false
- Production authorization: false
- Database backup included: false
- Credentials included: false
"@
  [System.IO.File]::WriteAllText($mdPath, ($md.TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))

  Write-Host ''
  Write-Host '9,988 条增量演练证据独立审计已通过。' -ForegroundColor Green
  Write-Host "EvidenceSHA256       : $evidenceSha256"
  Write-Host "CandidateSHA256      : $ExpectedCandidateSha256"
  Write-Host "ToolHead             : $ExpectedToolHead"
  Write-Host "CreateLedgerRows     : $($ledger.Count)"
  Write-Host "RecordCreates        : $($records.Count)"
  Write-Host "RatingCreates        : $($ratings.Count)"
  Write-Host 'SourceDatabaseWrite  : False'
  Write-Host 'ProductionAuthorization: False'
  Write-Host "AuditJSON            : $jsonPath"
  Write-Host "AuditMarkdown        : $mdPath"
} finally {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
}
