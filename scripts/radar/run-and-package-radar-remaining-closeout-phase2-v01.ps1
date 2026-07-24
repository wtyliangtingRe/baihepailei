param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$Phase1Bundle,
  [Parameter(Mandatory = $true)][string]$CloseoutBundle,
  [Parameter(Mandatory = $true)][string]$ResearchBundle,
  [string]$ExpectedPhase1SHA256 = 'B1CF94F62D31E330844551F51859247237BE57CD7C9C81D7A6A68D43DD439FD9',
  [string]$ExpectedCloseoutSHA256 = '8947A84A9961BE88C9E69EE3A0C2100191F02361D665528C6CAC974F5602D99D',
  [string]$ExpectedResearchSHA256 = 'BFD991789B582FAF4E780C973804D7EE8AF4669F7DDB9724C3C52F9133D680A1',
  [string]$PostgresContainer = 'baihepailei-postgres',
  [int]$Port = 3102,
  [int]$ReadyTimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$AllowedDirtyFiles = @(
  'next-env.d.ts',
  'payload-types.ts',
  'docs/guides/README.md',
  'docs/guides/work-assessment-model-v01.md',
  'docs/guides/radar-publication-safety-v01.md',
  'docs/guides/radar-ai-incremental-publication-runbook-v01.md',
  'docs/guides/radar-dual-track-ai-coverage-policy-v01.md',
  'docs/guides/radar-work-level-multilingual-research-policy-v01.md',
  'docs/guides/radar-remaining-1122-phase2-live-guard-closeout-v01.md',
  'scripts/radar/apply-radar-dual-track-ai-coverage-policy-v01.mjs',
  'scripts/radar/build-radar-remaining-closeout-phase2-v01.mjs',
  'scripts/radar/run-and-package-radar-remaining-closeout-phase2-v01.ps1',
  'tests/radar-dual-track-ai-coverage-policy.test.mjs',
  'tests/radar-remaining-closeout-phase2.test.mjs'
)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
$builderPath = Join-Path $PSScriptRoot 'build-radar-remaining-closeout-phase2-v01.mjs'
$testPath = Join-Path $repoRoot 'tests\radar-remaining-closeout-phase2.test.mjs'
$policyTestPath = Join-Path $repoRoot 'tests\radar-dual-track-ai-coverage-policy.test.mjs'

function Resolve-InputFile([string]$Value, [string]$Label) {
  $candidate = if ([System.IO.Path]::IsPathRooted($Value)) {
    [System.IO.Path]::GetFullPath($Value)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "找不到 $Label：$candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-DirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path.Replace('\', '/')
  }
  return @($paths)
}

function Stop-ProcessTree([int]$ProcessId) {
  & taskkill /PID $ProcessId /T /F *> $null
  if ($LASTEXITCODE -ne 0) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -ne $process) {
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Test-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $relative = ([string]$entry.file).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $file = Join-Path $Directory $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "manifest 文件不存在：$($entry.file)"
    }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    $bytes = (Get-Item -LiteralPath $file).Length
    if (
      $bytes -ne [long]$entry.bytes -or
      $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()
    ) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
  return @($manifest).Count
}

function Write-DirectoryManifest([string]$Directory) {
  $files = @(
    Get-ChildItem -LiteralPath $Directory -File -Recurse |
      Where-Object { -not ($_.Name -eq 'manifest.json' -and $_.DirectoryName -eq $Directory) } |
      Sort-Object FullName
  )
  $manifest = @(
    $files | ForEach-Object {
      $relative = [System.IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/')
      $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
      [ordered]@{
        file = $relative
        bytes = $_.Length
        sha256 = $hash.Hash.ToLowerInvariant()
      }
    }
  )
  Write-Json -Path (Join-Path $Directory 'manifest.json') -Value $manifest
  return $manifest.Count
}

if ($Port -lt 1024 -or $Port -gt 65535) { throw "Port 超出范围：$Port" }
if ($ReadyTimeoutSeconds -lt 30 -or $ReadyTimeoutSeconds -gt 900) {
  throw "ReadyTimeoutSeconds 超出范围：$ReadyTimeoutSeconds"
}
foreach ($item in @($builderPath, $testPath, $policyTestPath)) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) {
    throw "缺少 Phase 2 活动文件：$item"
  }
}

Write-Host ''
Write-Host '==> 锁定 PR #311 分支与提交' -ForegroundColor Cyan
$currentBranch = ([string](git branch --show-current)).Trim()
$currentHead = ([string](git rev-parse HEAD)).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne $ExpectedBranch) {
  throw "当前分支不正确：$currentBranch"
}
if ($currentHead -ne $ExpectedBranchHead) {
  throw "当前 HEAD 不是已固定 Phase 2 基线：$currentHead"
}
$unexpectedDirty = @(
  Get-DirtyPaths |
    Where-Object { $AllowedDirtyFiles -notcontains $_ }
)
if ($unexpectedDirty.Count -gt 0) {
  throw "存在预期之外的本地修改：$($unexpectedDirty -join ', ')"
}

Write-Host ''
Write-Host '==> 校验 Phase 2 输入包与回归测试' -ForegroundColor Cyan
$phase1Path = Resolve-InputFile $Phase1Bundle 'Phase 1 evidence ZIP'
$closeoutPath = Resolve-InputFile $CloseoutBundle '1,122 closeout ZIP'
$researchPath = Resolve-InputFile $ResearchBundle '1,805 research ZIP'
$phase1Hash = (Get-FileHash -LiteralPath $phase1Path -Algorithm SHA256).Hash
$closeoutHash = (Get-FileHash -LiteralPath $closeoutPath -Algorithm SHA256).Hash
$researchHash = (Get-FileHash -LiteralPath $researchPath -Algorithm SHA256).Hash
if ($phase1Hash -ne $ExpectedPhase1SHA256) { throw "Phase 1 ZIP SHA-256 不匹配：$phase1Hash" }
if ($closeoutHash -ne $ExpectedCloseoutSHA256) { throw "Closeout ZIP SHA-256 不匹配：$closeoutHash" }
if ($researchHash -ne $ExpectedResearchSHA256) { throw "Research ZIP SHA-256 不匹配：$researchHash" }

& node --check $builderPath
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 builder 语法检查失败。' }
& node --test $testPath $policyTestPath
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 与双轨规则回归测试失败。' }

Write-Host ''
Write-Host '==> 确认 Docker、PostgreSQL 与本仓库无并发写进程' -ForegroundColor Cyan
& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$postgresRunning = ([string](& docker inspect -f '{{.State.Running}}' $PostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or $postgresRunning -ne 'true') {
  throw "PostgreSQL 容器未运行：$PostgresContainer"
}
$existingRepoProcesses = @(
  Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object {
      $command = [string]$_.CommandLine
      -not [string]::IsNullOrWhiteSpace($command) -and
      $command.IndexOf($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $command -match '(?i)\b(node|npm|pnpm|yarn|tsx|bun|deno|python|payload|next)\b'
    }
)
if ($existingRepoProcesses.Count -gt 0) {
  $descriptions = @($existingRepoProcesses | ForEach-Object { "PID=$($_.ProcessId) $($_.CommandLine)" })
  throw "检测到本仓库已有 Node/Payload/Next 等进程，请先停止：`n$($descriptions -join "`n")"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-remaining-1122-phase2-live-guard-closeout-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-REMAINING-1122-PHASE2-LIVE-GUARD-CLOSEOUT-$stamp.zip"
$failureDir = Join-Path $repoRoot "exports\radar-remaining-1122-phase2-failure-$stamp"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-remaining-phase2-' + [Guid]::NewGuid().ToString('N'))
$phase1Dir = Join-Path $tempRoot 'phase1'
$closeoutDir = Join-Path $tempRoot 'closeout'
$researchDir = Join-Path $tempRoot 'research'
$packRoot = Join-Path $tempRoot 'pack'
$serverStdout = Join-Path $tempRoot 'phase2-server-stdout.log'
$serverStderr = Join-Path $tempRoot 'phase2-server-stderr.log'
$serverScript = Join-Path $tempRoot 'start-phase2-readonly-server.ps1'
$baseUrl = "http://127.0.0.1:$Port"
$server = $null
$serverStopped = $false
$runError = $null
New-Item -ItemType Directory -Path $phase1Dir, $closeoutDir, $researchDir, $packRoot -Force | Out-Null
Expand-Archive -LiteralPath $phase1Path -DestinationPath $phase1Dir -Force
Expand-Archive -LiteralPath $closeoutPath -DestinationPath $closeoutDir -Force
Expand-Archive -LiteralPath $researchPath -DestinationPath $researchDir -Force
Test-Manifest $phase1Dir | Out-Null
Test-Manifest $closeoutDir | Out-Null
Test-Manifest $researchDir | Out-Null

$tokenBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
$auditToken = [Convert]::ToHexString($tokenBytes).ToLowerInvariant()
$auditEmail = 'radar-readonly-audit@localhost.invalid'
$previousToken = [Environment]::GetEnvironmentVariable('RADAR_READONLY_AUDIT_TOKEN', 'Process')
$previousEmail = [Environment]::GetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', 'Process')
$previousPassword = [Environment]::GetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', 'Process')
$escapedRepo = $repoRoot.Replace("'", "''")
$serverText = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$escapedRepo'
`$env:PAYLOAD_DB_PUSH = 'false'
`$env:RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
`$env:PGOPTIONS = '-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning'
pnpm exec next dev -p $Port
"@
[System.IO.File]::WriteAllText($serverScript, $serverText, [System.Text.UTF8Encoding]::new($false))

try {
  [Environment]::SetEnvironmentVariable('RADAR_READONLY_AUDIT_TOKEN', $auditToken, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $auditEmail, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $auditToken, 'Process')

  Write-Host ''
  Write-Host '==> 启动一次性令牌 + 数据库强制只读的本机 Payload' -ForegroundColor Cyan
  $server = Start-Process `
    -FilePath (Get-Command pwsh).Source `
    -ArgumentList @('-NoProfile', '-File', $serverScript) `
    -RedirectStandardOutput $serverStdout `
    -RedirectStandardError $serverStderr `
    -PassThru `
    -WindowStyle Hidden

  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  $ready = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($server.HasExited) {
      throw "Phase 2 只读 Next 服务器提前退出：$($server.ExitCode)"
    }
    try {
      $loginBody = @{ email = $auditEmail; password = $auditToken } | ConvertTo-Json -Compress
      $login = Invoke-RestMethod `
        -Uri "$baseUrl/api/users/login" `
        -Method Post `
        -ContentType 'application/json' `
        -Body $loginBody `
        -TimeoutSec 8
      if (-not [string]::IsNullOrWhiteSpace([string]$login.token)) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ready) {
    throw 'Phase 2 只读 Next 服务器未在限时内就绪。'
  }

  Write-Host ''
  Write-Host '==> 读取 live Works / public conclusions 并完成 1,122 条最终收口' -ForegroundColor Cyan
  & node $builderPath `
    --phase1-dir $phase1Dir `
    --closeout-dir $closeoutDir `
    --research-dir $researchDir `
    --out-dir $outDir `
    --url $baseUrl `
    --branch-head $ExpectedBranchHead `
    --phase1-zip-sha256 $phase1Hash `
    --closeout-zip-sha256 $closeoutHash `
    --research-zip-sha256 $researchHash
  if ($LASTEXITCODE -ne 0) {
    throw 'Phase 2 builder 执行失败。'
  }
} catch {
  $runError = $_
} finally {
  if ($null -ne $server) {
    Stop-ProcessTree -ProcessId $server.Id
    $serverStopped = $true
    Start-Sleep -Seconds 1
  }
  [Environment]::SetEnvironmentVariable('RADAR_READONLY_AUDIT_TOKEN', $previousToken, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_EMAIL', $previousEmail, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PAYLOAD_PASSWORD', $previousPassword, 'Process')
  $auditToken = $null
  [Array]::Clear($tokenBytes, 0, $tokenBytes.Length)
}

if ($null -ne $runError) {
  New-Item -ItemType Directory -Path $failureDir -Force | Out-Null
  foreach ($log in @($serverStdout, $serverStderr)) {
    if (Test-Path -LiteralPath $log -PathType Leaf) {
      Copy-Item -LiteralPath $log -Destination $failureDir -Force
    }
  }
  Write-Json -Path (Join-Path $failureDir 'phase2-failure-receipt.json') -Value ([ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    branch = $ExpectedBranch
    head = $ExpectedBranchHead
    error = [string]$runError.Exception.Message
    innerError = [string]$runError.Exception.InnerException
    serverStopped = $serverStopped
    payloadWrite = $false
    postgresqlWrite = $false
    productionApplyAuthorized = $false
  })
  Write-Host ''
  Write-Host "Phase 2 失败诊断已保留：$failureDir" -ForegroundColor Yellow
  throw $runError
}

if (-not (Test-Path -LiteralPath $outDir -PathType Container)) {
  throw 'Phase 2 输出目录未生成。'
}
Copy-Item -LiteralPath $serverStdout -Destination (Join-Path $outDir 'phase2-server-stdout.log') -Force
Copy-Item -LiteralPath $serverStderr -Destination (Join-Path $outDir 'phase2-server-stderr.log') -Force
$summaryPath = Join-Path $outDir 'phase2-closeout-summary.json'
$validationPath = Join-Path $outDir 'phase2-validation.json'
$summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$validation = Get-Content -LiteralPath $validationPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if (
  $summary.rows -ne 1122 -or
  $summary.humanDecisionRequired -ne 0 -or
  @($summary.globalBlockers).Count -ne 0 -or
  $summary.readyForUnifiedAssemblyPlanning -ne $true -or
  $validation.passed -ne $true -or
  $validation.zeroUnresolvedHumanDecisions -ne $true -or
  $validation.humanTrackNeverBlocksAI -ne $true -or
  $validation.lifecycleVisibilityNeverBlocksAIStorage -ne $true -or
  $validation.unresolvedCanonicalAICoverageRows -ne 0 -or
  $validation.gradeMutationRows -gt 5 -or
  @(
    $validation.allowedFreshGradeMutationWorkIds |
      Where-Object {
        @('31143', '31588', '31692', '32094', '33699') -notcontains [string]$_
      }
  ).Count -gt 0 -or
  $summary.coveragePolicy.canonicalWorkRequiresCurrentAIConclusion -ne $true -or
  $summary.coveragePolicy.humanTrackBlocksAIConclusion -ne $false -or
  $summary.coveragePolicy.evidenceShortageBlocksAIConclusion -ne $false -or
  $summary.coveragePolicy.lifecycleVisibilityBlocksAIStorage -ne $false -or
  $summary.safety.payloadWrite -ne $false -or
  $summary.safety.postgresqlWrite -ne $false -or
  $summary.safety.productionDatabaseWrite -ne $false -or
  $summary.safety.productionApplyAuthorized -ne $false
) {
  throw 'Phase 2 summary 未满足最终收口门槛。'
}

Write-Json -Path (Join-Path $outDir 'phase2-run-receipt.json') -Value ([ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  branch = $ExpectedBranch
  head = $ExpectedBranchHead
  phase1Bundle = $phase1Path
  phase1BundleSha256 = $phase1Hash.ToLowerInvariant()
  closeoutBundle = $closeoutPath
  closeoutBundleSha256 = $closeoutHash.ToLowerInvariant()
  researchBundle = $researchPath
  researchBundleSha256 = $researchHash.ToLowerInvariant()
  rows = 1122
  readyForUnifiedIncrementalAssembly = $summary.readyForUnifiedIncrementalAssembly
  alreadyCurrentAIConclusion = $summary.alreadyCurrentAIConclusion
  retainedBlockedFinal = $summary.retainedBlockedFinal
  canonicalWorkRequiresCurrentAIConclusion = $true
  humanTrackBlocksAIConclusion = $false
  evidenceShortageBlocksAIConclusion = $false
  lifecycleVisibilityBlocksAIStorage = $false
  humanDecisionRequired = 0
  serverStopped = $serverStopped
  readOnlyAuditTokenCleared = $true
  payloadRead = $true
  payloadWrite = $false
  postgresqlRead = $true
  postgresqlWrite = $false
  productionApplyAuthorized = $false
})
$manifestFiles = Write-DirectoryManifest $outDir
Test-Manifest $outDir | Out-Null

Get-ChildItem -LiteralPath $outDir -Force | Copy-Item -Destination $packRoot -Recurse -Force
Compress-Archive `
  -Path (Join-Path $packRoot '*') `
  -DestinationPath $bundlePath `
  -CompressionLevel Optimal `
  -Force
if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
  throw 'Phase 2 evidence ZIP 未生成。'
}
$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Write-Host ''
Write-Host '1,122 条 Phase 2 live guard 与最终收口完成～' -ForegroundColor Green
Write-Host "OutputDirectory                     : $outDir"
Write-Host "EvidenceBundle                      : $bundlePath"
Write-Host "EvidenceBundleSHA256                : $($bundleHash.Hash)"
Write-Host "Rows                                : $($summary.rows)"
Write-Host "ReadyForUnifiedIncrementalAssembly  : $($summary.readyForUnifiedIncrementalAssembly)"
Write-Host "AlreadyCurrentAIConclusion          : $($summary.alreadyCurrentAIConclusion)"
Write-Host "RetainedBlockedFinal                : $($summary.retainedBlockedFinal)"
Write-Host 'HumanDecisionRequired               : 0'
Write-Host "LiveIdentityGuardPassed             : $($summary.liveIdentityGuardPassed)"
Write-Host "LiveIdentityGuardFailed             : $($summary.liveIdentityGuardFailed)"
Write-Host "SingleProviderReadyRows             : $($validation.singleProviderReadyRows)"
Write-Host 'HumanTrackBlocksAIConclusion         : False'
Write-Host 'EvidenceShortageBlocksAIConclusion   : False'
Write-Host 'LifecycleVisibilityBlocksAIStorage   : False'
Write-Host "ManifestFiles                       : $manifestFiles"
Write-Host 'PayloadRead                         : True'
Write-Host 'PayloadWrite                        : False'
Write-Host 'PostgreSQLRead                      : True'
Write-Host 'PostgreSQLWrite                     : False'
Write-Host 'ProductionApplyAuthorized           : False'

Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
