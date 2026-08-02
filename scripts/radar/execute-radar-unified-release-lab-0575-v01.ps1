param(
  [Parameter(Mandatory = $true)][string]$EnvironmentFile,
  [Parameter(Mandatory = $true)][string]$ExpectedWebsiteHead,
  [Parameter(Mandatory = $true)][ValidateSet('EXECUTE-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01')][string]$Confirm,
  [int]$ReadyTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-unified-release-lab-0575-v01'
$ReleaseId = 'RADAR-UNIFIED-RATING-RELEASE-0575-0001'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-JsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, ($json.TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

function Get-ConfiguredValue([string[]]$Names) {
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
  }
  foreach ($envFile in @('.env.development.local', '.env.local', '.env.development', '.env')) {
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { continue }
    $lines = @(Microsoft.PowerShell.Management\Get-Content -LiteralPath $envFile -Encoding UTF8)
    foreach ($name in $Names) {
      $escaped = [regex]::Escape($name)
      $line = $lines | Where-Object { $_ -match "^\s*$escaped\s*=" } | Select-Object -First 1
      if ($line) {
        $value = (($line -split '=', 2)[1].Trim()).Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
      }
    }
  }
  return $null
}

function Invoke-WithEnvironment([hashtable]$Variables, [scriptblock]$Action) {
  $saved = @{}
  foreach ($name in $Variables.Keys) {
    $saved[$name] = [pscustomobject]@{
      Exists = Test-Path "Env:$name"
      Value = [Environment]::GetEnvironmentVariable([string]$name, 'Process')
    }
    [Environment]::SetEnvironmentVariable([string]$name, [string]$Variables[$name], 'Process')
  }
  try { & $Action } finally {
    foreach ($name in $Variables.Keys) {
      if ($saved[$name].Exists) {
        [Environment]::SetEnvironmentVariable([string]$name, [string]$saved[$name].Value, 'Process')
      } else {
        [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process')
      }
    }
  }
}

function Get-FreePort([int]$Minimum, [int]$Maximum) {
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    $port = Get-Random -Minimum $Minimum -Maximum ($Maximum + 1)
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try { $listener.Start(); return $port } catch { continue } finally { try { $listener.Stop() } catch {} }
  }
  throw '找不到空闲的实验网站端口。'
}

function Read-Map([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -lt 2) { throw "无法解析：$line" }
    $map[$parts[0]] = ($parts[1..($parts.Count - 1)] -join "`t")
  }
  return $map
}

function Assert-MapsEqual([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  if (($expectedKeys -join "`n") -ne ($actualKeys -join "`n")) { throw "$Label 的表集合不一致。" }
  foreach ($key in $expectedKeys) {
    if ([string]$Expected[$key] -ne [string]$Actual[$key]) { throw "$Label 不一致：$key" }
  }
}

function Invoke-LabSql([object]$Lab, [string]$HostFile, [string]$ContainerFile, [string]$OutputFile, [string]$ErrorFile) {
  & docker cp $HostFile "$($Lab.labContainer):$ContainerFile" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "复制实验 SQL 失败：$ContainerFile" }
  & docker exec -e "PGPASSWORD=$($Lab.labPassword)" ([string]$Lab.labContainer) `
    psql -X -qAt -v ON_ERROR_STOP=1 -U ([string]$Lab.labUser) -d ([string]$Lab.labDatabase) -f $ContainerFile `
    1> $OutputFile 2> $ErrorFile
  if ($LASTEXITCODE -ne 0) { throw "实验 SQL 执行失败：$ContainerFile" }
}

function Stop-LabApp([object]$Process) {
  if ($null -eq $Process) { return }
  try {
    if ($IsWindows) { & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null }
    else { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Wait-LabMarker([string]$Url, [string]$Nonce, [object]$Lab, [object]$Process, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ($Process.HasExited) { throw "实验网站进程提前退出：$($Process.ExitCode)" }
    try {
      $marker = Invoke-RestMethod -Uri "$Url/api/radar-unified-release-lab-marker" -Method Get `
        -Headers @{ 'x-radar-unified-release-lab-nonce' = $Nonce } -TimeoutSec 10
      if (
        $marker.isolatedLab -eq $true -and
        [string]$marker.database -eq [string]$Lab.labDatabase -and
        [string]$marker.websiteCommit -eq [string]$Lab.websiteCommit -and
        [string]$marker.researchHead -eq [string]$Lab.researchHead -and
        [string]$marker.releaseId -eq $ReleaseId
      ) { return $marker }
    } catch {}
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw '实验网站未通过统一 Release 隔离 marker。'
}

function Write-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  $shaPath = Join-Path $Directory 'SHA256SUMS'
  Remove-Item -LiteralPath $manifestPath, $shaPath -Force -ErrorAction SilentlyContinue
  $entries = @()
  foreach ($file in Get-ChildItem -LiteralPath $Directory -File -Recurse | Sort-Object FullName) {
    $relative = $file.FullName.Substring($Directory.Length).TrimStart('\', '/').Replace('\', '/')
    $entries += [ordered]@{
      file = $relative
      bytes = [long]$file.Length
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  Write-JsonFile $manifestPath $entries
  [System.IO.File]::WriteAllText(
    $shaPath,
    ((@($entries | ForEach-Object { "$($_.sha256)  $($_.file)" }) -join "`n") + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
}

if ($Confirm -ne 'EXECUTE-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01') { throw '确认字符串不匹配。' }
$environmentPath = (Resolve-Path -LiteralPath $EnvironmentFile).Path
$lab = Get-Content -LiteralPath $environmentPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ([string]$lab.schemaVersion -ne 'radar-unified-release-lab-environment-0575-v01') { throw '实验环境文件版本不匹配。' }
if ([string]$lab.websiteCommit -ne $ExpectedWebsiteHead -or [string]$lab.releaseId -ne $ReleaseId) { throw '实验环境身份不匹配。' }
if ($lab.sourceDatabaseWrite -ne $false -or $lab.sourcePostcheckPassed -ne $true -or $lab.isolatedRestorePassed -ne $true) {
  throw '实验环境没有证明源库只读与隔离恢复通过。'
}
if ([string]$lab.researchHead -notmatch '^[a-f0-9]{40}$') { throw '研究仓库头格式无效。' }
$createdAt = [DateTime]::Parse([string]$lab.createdAt).ToUniversalTime()
if ($createdAt -gt [DateTime]::UtcNow.AddMinutes(5) -or $createdAt -lt [DateTime]::UtcNow.AddHours(-4)) {
  throw '实验环境时间不在允许的 fresh window。'
}
if ([string]$lab.labContainer -notmatch '^baihepailei-radar-unified-release-lab-') { throw '实验容器名称不在允许前缀内。' }
if ([int]$lab.labPort -lt 31000 -or [int]$lab.labPort -gt 31999) { throw '实验数据库端口不在 31000-31999。' }
if ([string]$lab.databaseUrl -notmatch '^postgresql://radar_lab:[a-f0-9]+@127\.0\.0\.1:31[0-9]{3}/radar_unified_release_lab$') {
  throw '实验数据库连接串不符合本地临时容器约束。'
}

$containerRunning = ([string](& docker inspect -f '{{.State.Running}}' ([string]$lab.labContainer))).Trim()
if ($LASTEXITCODE -ne 0 -or $containerRunning -ne 'true') { throw '实验 PostgreSQL 容器未运行。' }

git fetch origin
git switch $ExpectedBranch
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新实验室分支失败。' }
$head = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($head -ne $ExpectedWebsiteHead -or $remoteHead -ne $ExpectedWebsiteHead) {
  throw "网站实验提交不符合预期：local=$head remote=$remoteHead"
}

Push-Location ([string]$lab.researchRepo)
try {
  git fetch origin
  git switch main
  git pull --ff-only origin main
  $researchHead = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $researchHead -ne [string]$lab.researchHead) {
    throw "研究仓库不再位于实验环境锁定提交：$researchHead"
  }
} finally { Pop-Location }

$email = Get-ConfiguredValue @('RADAR_PAYLOAD_EMAIL', 'PAYLOAD_EXPORT_EMAIL', 'PAYLOAD_SEED_EMAIL', 'SITE_OWNER_EMAIL')
$password = Get-ConfiguredValue @('RADAR_PAYLOAD_PASSWORD', 'PAYLOAD_EXPORT_PASSWORD', 'PAYLOAD_SEED_PASSWORD')
if (-not $email -or -not $password) { throw '无法解析 Payload 管理员凭据。' }

node --check '.\scripts\radar\run-unified-release-lab-import-0575-v01.mjs'
node --check '.\scripts\radar\reconcile-radar-public-dev-schema-v02.mjs'
node --test '.\tests\radar-unified-release-lab-0575-v01.test.mjs' '.\tests\radar-unified-rating-release-plan-v01.test.mjs'
if ($LASTEXITCODE -ne 0) { throw '实验室回归测试失败。' }
pnpm exec tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw 'TypeScript 检查失败。' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-release-lab-0575-v01\lab-execution-$stamp"
$importDir = Join-Path $outDir 'import'
$evidenceDir = Join-Path $repoRoot "exports\radar-unified-release-lab-0575-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-UNIFIED-RELEASE-LAB-0575-$stamp.zip"
New-Item -ItemType Directory -Path $outDir, $importDir, $evidenceDir -Force | Out-Null
$appProcess = $null
$containerRemoved = $false
$nonce = [Guid]::NewGuid().ToString('N')
$appPort = Get-FreePort 32000 39999
$baseUrl = "http://127.0.0.1:$appPort"
$success = $false

try {
  Write-Host ''
  Write-Host '==> 对齐临时克隆中的历史 Radar migration 登记' -ForegroundColor Green
  node '.\scripts\radar\reconcile-radar-public-dev-schema-v02.mjs' `
    --environment-file $environmentPath `
    --expected-website-head $ExpectedWebsiteHead `
    --out-dir $outDir `
    --confirm 'RECONCILE-ISOLATED-RADAR-PUBLIC-DEV-SCHEMA-V02'
  if ($LASTEXITCODE -ne 0) { throw '历史 Radar schema 对齐失败。' }

  $reconciliationPath = Join-Path $outDir 'radar-public-dev-schema-reconciliation-v02.json'
  $reconciliation = Get-Content -LiteralPath $reconciliationPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if (
    $reconciliation.accepted -ne $true -or
    $reconciliation.schemaSignatureMatched -ne $true -or
    [int]$reconciliation.developmentMigrationMarkersRemoved -ne 1 -or
    [int]$reconciliation.historicalMigrationRowsRegistered -ne 2 -or
    [int]$reconciliation.recordsMigrationRowsRegistered -ne 0 -or
    [int]$reconciliation.ratingsMigrationRowsRegistered -ne 0 -or
    [int]$reconciliation.factValueTextMigrationRowsRegistered -ne 0 -or
    $reconciliation.sourceDatabaseWrite -ne $false -or
    $reconciliation.productionAuthorization -ne $false
  ) { throw '历史 Radar schema 对齐回执不符合预期。' }

  Write-Host ''
  Write-Host '==> 只在临时 PostgreSQL 执行 Records、Ratings 与事实文本正式迁移' -ForegroundColor Green
  Invoke-WithEnvironment -Variables @{
    DATABASE_URL = [string]$lab.databaseUrl
    PAYLOAD_DB_PUSH = 'false'
    STEWARDSHIP_NOTICES_SCHEMA_READY = 'true'
    RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
  } -Action {
    pnpm payload migrate 1> (Join-Path $outDir 'payload-migrate-stdout.txt') 2> (Join-Path $outDir 'payload-migrate-stderr.txt')
    if ($LASTEXITCODE -ne 0) { throw '临时数据库迁移失败。' }
  }

  $migrationNames = Join-Path $outDir 'migration-names.txt'
  & docker exec -e "PGPASSWORD=$($lab.labPassword)" ([string]$lab.labContainer) psql -X -qAt -v ON_ERROR_STOP=1 `
    -U ([string]$lab.labUser) -d ([string]$lab.labDatabase) `
    -c "SELECT name FROM payload_migrations ORDER BY name;" `
    1> $migrationNames 2> (Join-Path $outDir 'migration-names-stderr.txt')
  if ($LASTEXITCODE -ne 0) { throw '读取迁移登记失败。' }
  $names = @(Get-Content -LiteralPath $migrationNames -Encoding UTF8 | Where-Object { $_ })
  $expectedNames = @(
    '20260718_072813_existing_schema_baseline_v01',
    '20260718_072843_stewardship_notices_v01',
    '20260723_141905_current_schema_baseline_before_radar_public_v01',
    '20260723_141908_radar_public_conclusions_v01',
    '20260801_101546_current_schema_baseline_before_radar_public_records_v01',
    '20260801_101551_radar_public_records_v01',
    '20260802_030535_radar_public_ratings_v01',
    '20260802_045057_radar_public_record_fact_value_text_v01'
  )
  if (($names -join "`n") -ne ($expectedNames -join "`n")) { throw "迁移登记不符合预期：$($names -join ', ')" }

  Write-Host ''
  Write-Host '==> 启动仅连接临时数据库的实验网站' -ForegroundColor Green
  $pnpmCommand = if ($IsWindows) { (Get-Command pnpm.cmd -ErrorAction Stop).Source } else { (Get-Command pnpm -ErrorAction Stop).Source }
  Invoke-WithEnvironment -Variables @{
    DATABASE_URL = [string]$lab.databaseUrl
    PAYLOAD_DB_PUSH = 'false'
    STEWARDSHIP_NOTICES_SCHEMA_READY = 'true'
    RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
    NEXT_PUBLIC_SERVER_URL = $baseUrl
    RADAR_UNIFIED_RELEASE_LAB_MODE = 'true'
    RADAR_UNIFIED_RELEASE_LAB_NONCE = $nonce
    RADAR_UNIFIED_RELEASE_LAB_DATABASE = [string]$lab.labDatabase
    RADAR_UNIFIED_RELEASE_LAB_WEBSITE_COMMIT = [string]$lab.websiteCommit
    RADAR_UNIFIED_RELEASE_LAB_RESEARCH_HEAD = [string]$lab.researchHead
    RADAR_UNIFIED_RELEASE_LAB_RELEASE_ID = $ReleaseId
  } -Action {
    $script:appProcess = Start-Process -FilePath $pnpmCommand `
      -ArgumentList @('exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', [string]$appPort) `
      -WorkingDirectory $repoRoot `
      -RedirectStandardOutput (Join-Path $outDir 'lab-app-stdout.txt') `
      -RedirectStandardError (Join-Path $outDir 'lab-app-stderr.txt') `
      -PassThru -NoNewWindow
  }
  $marker = Wait-LabMarker $baseUrl $nonce $lab $appProcess $ReadyTimeoutSeconds
  Write-JsonFile (Join-Path $outDir 'lab-marker.json') $marker

  Write-Host ''
  Write-Host '==> 创建 575 条事实记录与 575 条评级并验证幂等收敛' -ForegroundColor Green
  Invoke-WithEnvironment -Variables @{
    RADAR_UNIFIED_RELEASE_LAB_NONCE = $nonce
    RADAR_PAYLOAD_EMAIL = $email
    RADAR_PAYLOAD_PASSWORD = $password
  } -Action {
    node '.\scripts\radar\run-unified-release-lab-import-0575-v01.mjs' `
      --input ([string]$lab.releaseDirectory) `
      --url $baseUrl `
      --out-dir $importDir `
      --mode fresh `
      --expected-website-commit ([string]$lab.websiteCommit) `
      --expected-research-head ([string]$lab.researchHead) `
      --expected-database ([string]$lab.labDatabase) `
      --confirm 'RUN-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01'
    if ($LASTEXITCODE -ne 0) { throw '统一 Release 隔离导入失败。' }
  }

  $receiptPath = Join-Path $importDir 'accepted-receipt.json'
  $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if (
    $receipt.accepted -ne $true -or
    [int]$receipt.counts.factCreate -ne 575 -or
    [int]$receipt.counts.ratingCreate -ne 575 -or
    [int]$receipt.counts.factUpdate -ne 0 -or
    [int]$receipt.counts.ratingUpdate -ne 0 -or
    [int]$receipt.postImport.recordStatusCounts.already_current -ne 575 -or
    [int]$receipt.postImport.ratingStatusCounts.already_current -ne 575
  ) { throw '导入回执没有达到 575 + 575 create / already_current。' }

  $environmentDir = Split-Path -Parent $environmentPath
  $countSql = Join-Path $environmentDir 'table-counts.sql'
  $fingerprintSql = Join-Path $environmentDir 'protected-fingerprints.sql'
  $postCounts = Join-Path $outDir 'lab-post-table-counts.tsv'
  $postFingerprints = Join-Path $outDir 'lab-post-protected-fingerprints.tsv'
  Invoke-LabSql $lab $countSql '/tmp/post-counts.sql' $postCounts (Join-Path $outDir 'post-counts-stderr.txt')
  Invoke-LabSql $lab $fingerprintSql '/tmp/post-fingerprints.sql' $postFingerprints (Join-Path $outDir 'post-fingerprints-stderr.txt')
  Assert-MapsEqual (Read-Map ([string]$lab.sourceProtectedFingerprints)) (Read-Map $postFingerprints) 'Works、版本表与旧 Radar 轨道指纹'

  $beforeCounts = Read-Map ([string]$lab.sourceTableCounts)
  $afterCounts = Read-Map $postCounts
  foreach ($key in $beforeCounts.Keys) {
    if (-not $afterCounts.ContainsKey($key)) { throw "实验数据库缺少原表：$key" }
    $before = [long]$beforeCounts[$key]
    $after = [long]$afterCounts[$key]
    if ($key -eq 'public.audit_events') {
      if ($after -ne $before + 1150) { throw "audit_events 增量不是 1150：$before -> $after" }
    } elseif ($key -eq 'public.payload_migrations') {
      if ($after -ne $before + 5) { throw "payload_migrations 净增量不是 5：$before -> $after" }
    } elseif ($key -eq 'public.users_sessions') {
      if ($after -ne $before + 1) { throw "users_sessions 增量不是 1：$before -> $after" }
    } elseif ($after -ne $before) {
      throw "预期外表行数发生变化：$key $before -> $after"
    }
  }

  $storage = $receipt.expectedStorage
  $expectedNew = [ordered]@{
    'public.radar_public_records' = [long]$storage.publicRecords
    'public.radar_public_records_facts' = [long]$storage.facts
    'public.radar_public_records_evidence' = [long]$storage.evidence
    'public.radar_public_records_facts_source_refs' = [long]$storage.factSourceRefs
    'public.radar_public_ratings' = [long]$storage.publicRatings
    'public.radar_public_ratings_matched_classes' = [long]$storage.matchedClasses
    'public.radar_public_ratings_fact_refs' = [long]$storage.ratingFactRefs
    'public.radar_public_ratings_evidence_refs' = [long]$storage.ratingEvidenceRefs
    'public.radar_public_ratings_unresolved_dimensions' = [long]$storage.unresolvedDimensions
    'public.radar_public_ratings_confirmation_basis' = [long]$storage.confirmationBasis
    'public.radar_public_ratings_public_tag_hints' = [long]$storage.publicTagHints
    'public.radar_public_ratings_public_warning_template_ids' = [long]$storage.publicWarningTemplateIds
    'public.radar_public_ratings_human_review_proposed_profile_changes' = [long]$storage.proposedProfileChanges
    'public.radar_public_ratings_human_review_additional_evidence_refs' = [long]$storage.additionalEvidenceRefs
  }
  $newKeys = @($afterCounts.Keys | Where-Object { -not $beforeCounts.ContainsKey($_) } | Sort-Object)
  $expectedNewKeys = @($expectedNew.Keys | Sort-Object)
  if (($newKeys -join "`n") -ne ($expectedNewKeys -join "`n")) { throw "迁移新增表集合不符合预期：$($newKeys -join ', ')" }
  foreach ($key in $expectedNew.Keys) {
    if ([long]$afterCounts[$key] -ne [long]$expectedNew[$key]) { throw "新表行数不符合预期：$key" }
  }

  Write-JsonFile (Join-Path $outDir 'lab-acceptance.json') ([ordered]@{
    schemaVersion = 'radar-unified-release-lab-acceptance-0575-v01'
    websiteCommit = [string]$lab.websiteCommit
    researchHead = [string]$lab.researchHead
    releaseId = $ReleaseId
    publicRecords = 575
    publicRatings = 575
    expectedStorage = $storage
    auditEventsAdded = 1150
    authenticationSessionsAdded = 1
    formalMigrationsAdded = 6
    developmentMigrationMarkersRemoved = 1
    payloadMigrationsNetAdded = 5
    historicalSchemaReconciled = $true
    historicalSchemaSignatureSha256 = [string]$reconciliation.actualSchemaSignatureSha256
    postImportFactsAlreadyCurrent = 575
    postImportRatingsAlreadyCurrent = 575
    protectedFingerprintsUnchanged = $true
    worksMutation = $false
    humanAssessmentMutation = $false
    radarAssessmentMutation = $false
    oldPublicConclusionMutation = $false
    researchRecordMutation = $false
    sourceDatabaseWrite = $false
    productionAuthorization = $false
    accepted = $true
    decision = 'accept_isolated_unified_rating_release_lab_0575_v01'
  })

  Stop-LabApp $appProcess
  $appProcess = $null
  & docker rm -f ([string]$lab.labContainer) | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '销毁实验 PostgreSQL 容器失败。' }
  $containerRemoved = $true
  Remove-Item -LiteralPath ([string]$lab.backupPath), $environmentPath -Force -ErrorAction SilentlyContinue

  Copy-Item -Path (Join-Path $outDir '*') -Destination $evidenceDir -Recurse -Force
  Copy-Item -LiteralPath `
    ([string]$lab.sourceTableCounts), `
    ([string]$lab.sourceProtectedFingerprints), `
    ([string]$lab.sourcePostTableCounts), `
    ([string]$lab.sourcePostProtectedFingerprints), `
    ([string]$lab.labRestoredTableCounts), `
    ([string]$lab.labRestoredProtectedFingerprints) `
    -Destination $evidenceDir -Force
  Write-Manifest $evidenceDir
  Compress-Archive -Path (Join-Path $evidenceDir '*') -DestinationPath $bundlePath -CompressionLevel Optimal -Force
  $bundleHash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $success = $true

  Write-Host ''
  Write-Host '统一 Release 隔离迁移与导入演练通过。' -ForegroundColor Green
  Write-Host "WebsiteCommit            : $($lab.websiteCommit)"
  Write-Host "ResearchHead              : $($lab.researchHead)"
  Write-Host "ReleaseId                 : $ReleaseId"
  Write-Host 'SourceDatabaseWrite       : False'
  Write-Host 'MigrationTarget           : IsolatedTemporaryContainer'
  Write-Host 'HistoricalSchemaReconciled: True'
  Write-Host 'PublicRecordsCreated      : 575'
  Write-Host 'PublicRatingsCreated      : 575'
  Write-Host 'PostFactsAlreadyCurrent   : 575'
  Write-Host 'PostRatingsAlreadyCurrent : 575'
  Write-Host 'WorksMutation             : False'
  Write-Host 'HumanAssessmentMutation   : False'
  Write-Host 'RadarAssessmentMutation   : False'
  Write-Host 'ProductionAuthorization   : False'
  Write-Host "EvidenceBundle            : $bundlePath"
  Write-Host "EvidenceSHA256            : $bundleHash"
} finally {
  Stop-LabApp $appProcess
  if (-not $containerRemoved) { & docker rm -f ([string]$lab.labContainer) 2>$null | Out-Null }
  Remove-Item -LiteralPath ([string]$lab.backupPath), $environmentPath -Force -ErrorAction SilentlyContinue
  if (-not $success) {
    Write-Host ''
    Write-Host '实验未通过；临时数据库、临时凭据文件和数据库备份已尽力清理，普通日志保留。' -ForegroundColor Yellow
  }
}
