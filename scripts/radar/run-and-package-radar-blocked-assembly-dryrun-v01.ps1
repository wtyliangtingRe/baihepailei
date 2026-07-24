param(
  [Parameter(Mandatory = $true)]
  [string] $ExpectedBranchHead,

  [string] $AssemblyBundle = (
    "D:\0GitHubtest\Baihepailei\exports\" +
    "RADAR-BLOCKED-ASSEMBLY-DRYRUN-INPUT-20260724.zip"
  ),

  [string] $ResearchBundle = (
    "D:\0GitHubtest\Baihepailei\exports\" +
    "RADAR-BLOCKED-RESEARCH-ALL-1805-20260724.zip"
  ),

  [string] $RemediationBundle = (
    "D:\0GitHubtest\Baihepailei\exports\" +
    "RADAR-PUBLIC-BLOCKED-REMEDIATION-20260724-025848.zip"
  ),

  [string] $ExpectedAssemblyBundleSHA256 = (
    "ECD2B30F925C2C20EF40F69A000D3BBD3950C6E42917AECAD0449F7E79DD4D68"
  ),

  [string] $ExpectedResearchBundleSHA256 = (
    "BFD991789B582FAF4E780C973804D7EE8AF4669F7DDB9724C3C52F9133D680A1"
  ),

  [string] $ExpectedRemediationBundleSHA256 = (
    "954C595E92C91F140B568389022C529196F5B4DBAC00A83964377166B9EEE729"
  )
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedRows = 683
$ExpectedWarnings = 663
$ExpectedPublicBaseline = 9000

function Assert-FileHash {
  param(
    [Parameter(Mandatory = $true)][string] $Path,
    [Parameter(Mandatory = $true)][string] $ExpectedSHA256,
    [Parameter(Mandatory = $true)][string] $Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "缺少 $Label：$Path"
  }

  $Observed = Get-FileHash -LiteralPath $Path -Algorithm SHA256
  if (
    $Observed.Hash.ToUpperInvariant() -ne
    $ExpectedSHA256.ToUpperInvariant()
  ) {
    throw (
      "$Label SHA-256 不匹配：" +
      "$($Observed.Hash)；预期 $ExpectedSHA256"
    )
  }

  return $Observed.Hash.ToUpperInvariant()
}

function Read-JsonFile {
  param([Parameter(Mandatory = $true)][string] $Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "缺少 JSON：$Path"
  }

  return Get-Content `
    -LiteralPath $Path `
    -Raw `
    -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
}

function Test-JsonlFile {
  param(
    [Parameter(Mandatory = $true)][string] $Path,
    [Parameter(Mandatory = $true)][int] $ExpectedCount,
    [Parameter(Mandatory = $true)][string] $Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "缺少 $Label：$Path"
  }

  $Count = 0
  foreach ($Line in [System.IO.File]::ReadLines($Path)) {
    if ([string]::IsNullOrWhiteSpace($Line)) {
      continue
    }

    try {
      $null = $Line | ConvertFrom-Json -Depth 100
    }
    catch {
      throw (
        "$Label JSONL 解析失败，第 $($Count + 1) 条：" +
        $_.Exception.Message
      )
    }

    $Count += 1
  }

  if ($Count -ne $ExpectedCount) {
    throw "$Label 行数异常：预期 $ExpectedCount，实际 $Count"
  }

  return $Count
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)][string] $Path,
    [Parameter(Mandatory = $true)][object] $Value
  )

  [System.IO.File]::WriteAllText(
    $Path,
    (
      ($Value | ConvertTo-Json -Depth 100).TrimEnd() +
      [Environment]::NewLine
    ),
    [System.Text.UTF8Encoding]::new($false)
  )
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $RepoRoot

$CurrentHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "无法读取当前 Git HEAD"
}
if ($CurrentHead -ne $ExpectedBranchHead) {
  throw "当前 HEAD 不符合预期：$CurrentHead"
}

$AssemblyBundleHash = Assert-FileHash `
  -Path $AssemblyBundle `
  -ExpectedSHA256 $ExpectedAssemblyBundleSHA256 `
  -Label "683 条 assembly 输入包"

$ResearchBundleHash = Assert-FileHash `
  -Path $ResearchBundle `
  -ExpectedSHA256 $ExpectedResearchBundleSHA256 `
  -Label "1,805 条研究总包"

$RemediationBundleHash = Assert-FileHash `
  -Path $RemediationBundle `
  -ExpectedSHA256 $ExpectedRemediationBundleSHA256 `
  -Label "1,805 条 remediation 基线包"

$Builder = Join-Path `
  $RepoRoot `
  "scripts\radar\build-radar-blocked-assembly-dryrun-v01.mjs"
$StorageLibrary = Join-Path `
  $RepoRoot `
  "scripts\radar\lib\public-conclusion-storage-v01.mjs"
$TestFile = Join-Path `
  $RepoRoot `
  "tests\radar-blocked-assembly-dryrun.test.mjs"

foreach ($RequiredFile in @($Builder, $StorageLibrary, $TestFile)) {
  if (-not (Test-Path -LiteralPath $RequiredFile -PathType Leaf)) {
    throw "缺少 assembly dry-run 文件：$RequiredFile"
  }
}

Write-Host ""
Write-Host "==> 运行 assembly dry-run 语法与回归测试" `
  -ForegroundColor Cyan

node --check $Builder
if ($LASTEXITCODE -ne 0) {
  throw "Assembly builder Node 语法检查失败"
}

node --check $StorageLibrary
if ($LASTEXITCODE -ne 0) {
  throw "Storage normalization library 语法检查失败"
}

node --test `
  $TestFile `
  (Join-Path $RepoRoot "tests\radar-public-storage-normalization.test.mjs") `
  (Join-Path $RepoRoot "tests\radar-public-blocked-remediation-resume.test.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Assembly dry-run 回归测试失败"
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ExportsRoot = Join-Path $RepoRoot "exports"
$OutputDirectory = Join-Path `
  $ExportsRoot `
  "radar-blocked-assembly-dryrun-$Stamp"
$OutputBundle = Join-Path `
  $ExportsRoot `
  "RADAR-BLOCKED-ASSEMBLY-DRYRUN-$Stamp.zip"

if (Test-Path -LiteralPath $OutputDirectory) {
  throw "输出目录已存在：$OutputDirectory"
}
if (Test-Path -LiteralPath $OutputBundle) {
  throw "输出 ZIP 已存在：$OutputBundle"
}

$TempRoot = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  ("radar-blocked-assembly-dryrun-" + [Guid]::NewGuid().ToString("N"))
$AssemblyDirectory = Join-Path $TempRoot "assembly-input"
$ResearchDirectory = Join-Path $TempRoot "research-input"
$RemediationDirectory = Join-Path $TempRoot "remediation-input"

try {
  New-Item -ItemType Directory -Path $AssemblyDirectory -Force |
    Out-Null
  New-Item -ItemType Directory -Path $ResearchDirectory -Force |
    Out-Null
  New-Item -ItemType Directory -Path $RemediationDirectory -Force |
    Out-Null

  Write-Host ""
  Write-Host "==> 解压三个不可变输入包" -ForegroundColor Cyan

  Expand-Archive `
    -LiteralPath $AssemblyBundle `
    -DestinationPath $AssemblyDirectory `
    -Force
  Expand-Archive `
    -LiteralPath $ResearchBundle `
    -DestinationPath $ResearchDirectory `
    -Force
  Expand-Archive `
    -LiteralPath $RemediationBundle `
    -DestinationPath $RemediationDirectory `
    -Force

  Write-Host ""
  Write-Host "==> 运行 683 条离线 assembly dry-run" `
    -ForegroundColor Cyan

  node $Builder `
    --assembly-dir $AssemblyDirectory `
    --research-dir $ResearchDirectory `
    --remediation-dir $RemediationDirectory `
    --out-dir $OutputDirectory `
    --assembly-zip-sha256 $AssemblyBundleHash `
    --research-zip-sha256 $ResearchBundleHash `
    --remediation-zip-sha256 $RemediationBundleHash

  if ($LASTEXITCODE -ne 0) {
    throw "683 条离线 assembly dry-run 失败"
  }

  $SummaryPath = Join-Path `
    $OutputDirectory `
    "radar-blocked-assembly-dryrun-summary.json"
  $ValidationPath = Join-Path `
    $OutputDirectory `
    "assembly-dryrun-validation.json"

  $Summary = Read-JsonFile -Path $SummaryPath
  $Validation = Read-JsonFile -Path $ValidationPath

  if (
    [int]$Summary.rows -ne $ExpectedRows -or
    [int]$Summary.readyForOfflineAssembly -ne $ExpectedRows -or
    [int]$Summary.privateAIWholeSnapshotPlans -ne $ExpectedRows -or
    [int]$Summary.readyPublicAICreate -ne $ExpectedRows -or
    [int]$Summary.alreadyCurrentPublicAI -ne 0 -or
    [int]$Summary.readyPublicAIUpdate -ne 0 -or
    [int]$Summary.storageNormalized -ne $ExpectedRows -or
    [int]$Summary.blocked -ne 0 -or
    [int]$Summary.warnings -ne $ExpectedWarnings -or
    [int]$Summary.sources.productionPublicBaseline -ne $ExpectedPublicBaseline -or
    @($Summary.globalBlockers).Count -ne 0 -or
    $Summary.readyForNextStorageLabPlanning -ne $true -or
    $Summary.safety.networkFetch -ne $false -or
    $Summary.safety.payloadRead -ne $false -or
    $Summary.safety.payloadWrite -ne $false -or
    $Summary.safety.postgresqlRead -ne $false -or
    $Summary.safety.postgresqlWrite -ne $false -or
    $Summary.safety.productionApplyAuthorized -ne $false -or
    $Summary.safety.applyModeExists -ne $false
  ) {
    throw "Assembly dry-run summary 未满足固定门槛"
  }

  if (
    $Validation.passed -ne $true -or
    [int]$Validation.observedRows -ne $ExpectedRows -or
    [int]$Validation.candidateShaBindingsVerified -ne $ExpectedRows -or
    [int]$Validation.currentPublicOverlap -ne 0 -or
    [int]$Validation.lifecycleAndVisibilityPassed -ne $ExpectedRows -or
    [int]$Validation.humanTrackProtected -ne $ExpectedRows -or
    [int]$Validation.wholeSnapshotRows -ne $ExpectedRows -or
    [int]$Validation.explicitNullRows -ne $ExpectedRows -or
    [int]$Validation.residualMergeForbiddenRows -ne $ExpectedRows -or
    $Validation.storageChangedFieldsOnly -ne $true -or
    @($Validation.globalBlockers).Count -ne 0
  ) {
    throw "Assembly dry-run validation 未满足固定门槛"
  }

  $ExpectedJsonl = [ordered]@{
    "radar-blocked-assembly-dryrun.jsonl" = 683
    "ready-for-offline-assembly.jsonl" = 683
    "private-ai-whole-snapshot-plan.jsonl" = 683
    "public-ai-pre-storage-ready.jsonl" = 683
    "public-ai-storage-ready.jsonl" = 683
    "public-conclusion-storage-rewrite-map.jsonl" = 683
    "bound-selected-ledger.jsonl" = 683
    "warnings.jsonl" = 663
    "blocked.jsonl" = 0
  }

  foreach ($Entry in $ExpectedJsonl.GetEnumerator()) {
    $null = Test-JsonlFile `
      -Path (Join-Path $OutputDirectory $Entry.Key) `
      -ExpectedCount ([int]$Entry.Value) `
      -Label $Entry.Key
  }

  $ReadyPath = Join-Path `
    $OutputDirectory `
    "ready-for-offline-assembly.jsonl"
  $WorkIds = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
  )
  $PublicationKeys = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
  )

  foreach ($Line in [System.IO.File]::ReadLines($ReadyPath)) {
    if ([string]::IsNullOrWhiteSpace($Line)) {
      continue
    }
    $Row = $Line | ConvertFrom-Json -Depth 100
    $WorkId = ([string]$Row.workId).Trim()
    $PublicationKey = ([string]$Row.publicationKey).Trim()

    if ($PublicationKey -ne "work:$WorkId") {
      throw "Ready 行 publicationKey 不匹配：$WorkId"
    }
    if (-not $WorkIds.Add($WorkId)) {
      throw "Ready 行重复 Work ID：$WorkId"
    }
    if (-not $PublicationKeys.Add($PublicationKey)) {
      throw "Ready 行重复 publicationKey：$PublicationKey"
    }
    if (
      $Row.dryRunStatus -ne "ready_for_offline_assembly" -or
      $Row.publicStatus -ne "ready_public_ai_create" -or
      @($Row.blockers).Count -ne 0 -or
      $Row.wholeSnapshotReplacement -ne $true -or
      $Row.explicitNullClearsOldValue -ne $true -or
      $Row.fieldResidualMergeForbidden -ne $true -or
      $Row.safety.productionApplyAuthorized -ne $false
    ) {
      throw "Ready 行安全门槛异常：$WorkId"
    }
  }

  if (
    $WorkIds.Count -ne $ExpectedRows -or
    $PublicationKeys.Count -ne $ExpectedRows
  ) {
    throw "Ready 行唯一身份基数异常"
  }

  $BoundInputsDirectory = Join-Path `
    $OutputDirectory `
    "bound-inputs"
  New-Item `
    -ItemType Directory `
    -Path $BoundInputsDirectory `
    -Force |
    Out-Null

  Copy-Item `
    -LiteralPath (Join-Path $AssemblyDirectory "assembly-input-summary.json") `
    -Destination (Join-Path $BoundInputsDirectory "assembly-input-summary.json")
  Copy-Item `
    -LiteralPath (Join-Path $ResearchDirectory "research-summary.json") `
    -Destination (Join-Path $BoundInputsDirectory "research-summary.json")
  Copy-Item `
    -LiteralPath (
      Join-Path `
        $RemediationDirectory `
        "remediation\radar-public-blocked-remediation-summary.json"
    ) `
    -Destination (
      Join-Path `
        $BoundInputsDirectory `
        "radar-public-blocked-remediation-summary.json"
    )

  $RunReceipt = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString("o")
    version = "radar-blocked-assembly-dryrun-runner-v0.1"
    branchHead = $CurrentHead
    code = [ordered]@{
      builderSha256 = (
        (Get-FileHash -LiteralPath $Builder -Algorithm SHA256).Hash.ToLowerInvariant()
      )
      runnerSha256 = (
        (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
      )
      testSha256 = (
        (Get-FileHash -LiteralPath $TestFile -Algorithm SHA256).Hash.ToLowerInvariant()
      )
      storageLibrarySha256 = (
        (Get-FileHash -LiteralPath $StorageLibrary -Algorithm SHA256).Hash.ToLowerInvariant()
      )
    }
    inputs = [ordered]@{
      assemblyBundle = $AssemblyBundle
      assemblyBundleSha256 = $AssemblyBundleHash.ToLowerInvariant()
      researchBundle = $ResearchBundle
      researchBundleSha256 = $ResearchBundleHash.ToLowerInvariant()
      remediationBundle = $RemediationBundle
      remediationBundleSha256 = $RemediationBundleHash.ToLowerInvariant()
    }
    result = [ordered]@{
      rows = 683
      readyForOfflineAssembly = 683
      privateAIWholeSnapshotPlans = 683
      readyPublicAICreate = 683
      storageNormalized = 683
      warnings = 663
      blocked = 0
      uniqueWorkIds = $WorkIds.Count
      uniquePublicationKeys = $PublicationKeys.Count
    }
    safety = [ordered]@{
      networkFetch = $false
      payloadRead = $false
      payloadWrite = $false
      postgresqlRead = $false
      postgresqlWrite = $false
      productionDatabaseWrite = $false
      productionApplyAuthorized = $false
      applyModeExists = $false
    }
  }
  Write-JsonFile `
    -Path (Join-Path $OutputDirectory "assembly-dryrun-run-receipt.json") `
    -Value $RunReceipt

  $Readme = @"
# Radar blocked assembly dry-run v0.1

This package is a fully offline assembly rehearsal for 683 accepted research rows.

## Result

- rows: 683
- private whole-snapshot plans: 683
- public create candidates: 683
- storage-normalized public records: 683
- structured-source warnings retained: 663
- blocked: 0
- current production public baseline: 9000

## Contracts

- latest structurally valid identity-resolved snapshot wins
- the new AI snapshot replaces the old snapshot as a whole
- explicit null clears an old value
- residual fields from older candidates are forbidden
- history and conflicts remain in the bound ledger
- storage normalization may change only assessedAt and conclusionSha256

## Important boundary

The 663 structured-source rows retain an explicit warning that automated
metadata is evidence triage and is not equivalent to manual page-by-page review.

This package does not authorize a database rehearsal or production execution.
The next stage is a separately reviewed data-level isolated PostgreSQL lab plan.

## Safety

- no network fetch
- no Payload read or write
- no PostgreSQL read or write
- no production apply mode
"@

  [System.IO.File]::WriteAllText(
    (Join-Path $OutputDirectory "README.md"),
    $Readme.TrimEnd() + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )

  $ManifestEntries = @(
    Get-ChildItem `
      -LiteralPath $OutputDirectory `
      -File `
      -Recurse |
    Where-Object {
      -not (
        $_.Name -eq "manifest.json" -and
        $_.DirectoryName -eq $OutputDirectory
      )
    } |
    Sort-Object FullName |
    ForEach-Object {
      $RelativePath = [System.IO.Path]::GetRelativePath(
        $OutputDirectory,
        $_.FullName
      ).Replace("\", "/")
      $Hash = Get-FileHash `
        -LiteralPath $_.FullName `
        -Algorithm SHA256

      [ordered]@{
        file = $RelativePath
        bytes = $_.Length
        sha256 = $Hash.Hash.ToLowerInvariant()
      }
    }
  )

  Write-JsonFile `
    -Path (Join-Path $OutputDirectory "manifest.json") `
    -Value $ManifestEntries

  Compress-Archive `
    -Path (Join-Path $OutputDirectory "*") `
    -DestinationPath $OutputBundle `
    -CompressionLevel Optimal

  if (-not (Test-Path -LiteralPath $OutputBundle -PathType Leaf)) {
    throw "Assembly dry-run ZIP 未生成"
  }

  $OutputHash = Get-FileHash `
    -LiteralPath $OutputBundle `
    -Algorithm SHA256

  Write-Host ""
  Write-Host "Radar blocked assembly dry-run 已完成～" `
    -ForegroundColor Green
  Write-Host "OutputDirectory         : $OutputDirectory"
  Write-Host "Bundle                  : $OutputBundle"
  Write-Host "BundleSHA256            : $($OutputHash.Hash)"
  Write-Host "Rows                    : 683"
  Write-Host "PrivateWholeSnapshots   : 683"
  Write-Host "ReadyPublicCreate       : 683"
  Write-Host "StorageNormalized       : 683"
  Write-Host "Warnings                : 663"
  Write-Host "Blocked                 : 0"
  Write-Host "PublicBaseline          : 9000"
  Write-Host "PayloadRead             : False"
  Write-Host "PayloadWrite            : False"
  Write-Host "PostgreSQLRead          : False"
  Write-Host "PostgreSQLWrite         : False"
  Write-Host "ProductionApply         : False"
}
finally {
  Remove-Item `
    -LiteralPath $TempRoot `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue
}
