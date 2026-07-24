param(
  [string] $ExpectedBranchHead = "cf6e22ad0563585499f1aabf738c7f972a63a69d",
  [string] $ProxyUrl = "auto"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $RepoRoot

$ExpectedBranch = "agent/radar-public-conclusions-v01"
$CloseoutFileName = "RADAR-REMAINING-1122-UNIFIED-CLOSEOUT-INPUT-20260724.zip"
$ExpectedCloseoutSHA256 = "8947A84A9961BE88C9E69EE3A0C2100191F02361D665528C6CAC974F5602D99D"
$CloseoutBundle = Join-Path $RepoRoot "exports\$CloseoutFileName"
$Fetcher = Join-Path $RepoRoot "scripts\radar\fetch-radar-remaining-wikidata-evidence-v01.mjs"
$WorkRoot = Join-Path $RepoRoot "exports\radar-remaining-1122-source-expansion-work-v01"

function Read-JsonFile {
  param([Parameter(Mandatory = $true)][string] $Path)

  Get-Content `
    -LiteralPath $Path `
    -Raw `
    -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)][string] $Path,
    [Parameter(Mandatory = $true)][object] $Value
  )

  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Assert-Manifest {
  param([Parameter(Mandatory = $true)][string] $Directory)

  $ManifestPath = Join-Path $Directory "manifest.json"
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }

  $Manifest = Read-JsonFile -Path $ManifestPath
  foreach ($Entry in @($Manifest)) {
    $Relative = ([string]$Entry.file).Replace(
      "/",
      [System.IO.Path]::DirectorySeparatorChar
    )
    $File = Join-Path $Directory $Relative

    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
      throw "manifest 文件不存在：$($Entry.file)"
    }

    $Item = Get-Item -LiteralPath $File
    $Hash = Get-FileHash -LiteralPath $File -Algorithm SHA256
    if (
      $Item.Length -ne [long]$Entry.bytes -or
      $Hash.Hash.ToLowerInvariant() -ne
        ([string]$Entry.sha256).ToLowerInvariant()
    ) {
      throw "manifest 校验失败：$($Entry.file)"
    }
  }
}

function Write-DirectoryManifest {
  param([Parameter(Mandatory = $true)][string] $Directory)

  $ManifestPath = Join-Path $Directory "manifest.json"
  Remove-Item `
    -LiteralPath $ManifestPath `
    -Force `
    -ErrorAction SilentlyContinue

  $Files = @(
    Get-ChildItem `
      -LiteralPath $Directory `
      -Recurse `
      -File |
    Where-Object {
      $_.FullName -ne $ManifestPath
    } |
    Sort-Object FullName
  )

  $Manifest = @(
    $Files |
      ForEach-Object {
        $Relative = [System.IO.Path]::GetRelativePath(
          $Directory,
          $_.FullName
        ).Replace("\", "/")
        $Hash = Get-FileHash `
          -LiteralPath $_.FullName `
          -Algorithm SHA256

        [ordered]@{
          file = $Relative
          bytes = $_.Length
          sha256 = $Hash.Hash.ToLowerInvariant()
        }
      }
  )

  Write-JsonFile `
    -Path $ManifestPath `
    -Value $Manifest

  Assert-Manifest -Directory $Directory
}

function Get-JsonCount {
  param(
    [Parameter(Mandatory = $true)][object] $Object,
    [Parameter(Mandatory = $true)][string] $Name
  )

  $Property = $Object.PSObject.Properties[$Name]
  if ($null -eq $Property) {
    return 0
  }

  return [int]$Property.Value
}

function Resolve-Proxy {
  param([string] $Requested)

  if (
    [string]::IsNullOrWhiteSpace($Requested) -or
    $Requested -eq "none"
  ) {
    return ""
  }

  if ($Requested -ne "auto") {
    return $Requested
  }

  $Client = [System.Net.Sockets.TcpClient]::new()
  try {
    $Connect = $Client.BeginConnect(
      "127.0.0.1",
      10808,
      $null,
      $null
    )
    if (
      $Connect.AsyncWaitHandle.WaitOne(
        [TimeSpan]::FromMilliseconds(500)
      )
    ) {
      $Client.EndConnect($Connect)
      return "http://127.0.0.1:10808"
    }
  }
  catch {
    return ""
  }
  finally {
    $Client.Dispose()
  }

  return ""
}

Write-Host ""
Write-Host "==> 锁定 PR #311 分支与当前提交" `
  -ForegroundColor Cyan

git fetch origin
if ($LASTEXITCODE -ne 0) {
  throw "获取远端分支失败"
}

git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) {
  throw "切换分支失败"
}

git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) {
  throw "更新分支失败"
}

$LocalHead = (git rev-parse HEAD).Trim()
$RemoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()

if (
  $LocalHead -ne $ExpectedBranchHead -or
  $RemoteHead -ne $ExpectedBranchHead
) {
  throw (
    "分支 HEAD 不符合预期：" +
    "local=$LocalHead remote=$RemoteHead"
  )
}

Write-Host ""
Write-Host "==> 校验 1,122 条统一 closeout 输入包" `
  -ForegroundColor Cyan

if (-not (
  Test-Path `
    -LiteralPath $CloseoutBundle `
    -PathType Leaf
)) {
  throw "找不到输入包：$CloseoutBundle"
}

$CloseoutHash = Get-FileHash `
  -LiteralPath $CloseoutBundle `
  -Algorithm SHA256

if (
  $CloseoutHash.Hash.ToUpperInvariant() -ne
  $ExpectedCloseoutSHA256
) {
  throw "Closeout ZIP SHA-256 不匹配：$($CloseoutHash.Hash)"
}

if (-not (Test-Path -LiteralPath $Fetcher -PathType Leaf)) {
  throw "缺少来源扩展 fetcher：$Fetcher"
}

Write-Host ""
Write-Host "==> 运行语法与回归测试" `
  -ForegroundColor Cyan

node --check $Fetcher
if ($LASTEXITCODE -ne 0) {
  throw "来源扩展 fetcher 语法检查失败"
}

node --test `
  "tests/radar-remaining-wikidata-evidence.test.mjs"

if ($LASTEXITCODE -ne 0) {
  throw "来源扩展回归测试失败"
}

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$TempRoot = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  (
    "radar-remaining-source-expansion-" +
    [Guid]::NewGuid().ToString("N")
  )
$CloseoutDir = Join-Path $TempRoot "closeout"
$RawResultDir = Join-Path $TempRoot "result"
$OutputDir = Join-Path `
  $RepoRoot `
  "exports\radar-remaining-1122-phase1-source-expansion-$Stamp"
$Bundle = Join-Path `
  $RepoRoot `
  "exports\RADAR-REMAINING-1122-PHASE1-SOURCE-EXPANSION-$Stamp.zip"

try {
  New-Item `
    -ItemType Directory `
    -Path $CloseoutDir, $RawResultDir, $WorkRoot, $OutputDir `
    -Force |
    Out-Null

  Expand-Archive `
    -LiteralPath $CloseoutBundle `
    -DestinationPath $CloseoutDir `
    -Force

  Assert-Manifest -Directory $CloseoutDir

  $InputValidation = Read-JsonFile `
    -Path (Join-Path $CloseoutDir "validation-report.json")

  if (
    [int]$InputValidation.rows -ne 1122 -or
    [int]$InputValidation.uniqueWorkIds -ne 1122 -or
    [int]$InputValidation.uniquePublicationKeys -ne 1122 -or
    @($InputValidation.blockers).Count -ne 0 -or
    $InputValidation.productionApplyAuthorized -ne $false
  ) {
    throw "Closeout 输入包 validation 不符合预期"
  }

  $ResolvedProxy = Resolve-Proxy -Requested $ProxyUrl

  Write-Host ""
  Write-Host "==> 扩展精确 ID 来源并生成 Phase 1 分流" `
    -ForegroundColor Cyan

  if ([string]::IsNullOrWhiteSpace($ResolvedProxy)) {
    Write-Host "网络路径：direct" -ForegroundColor Yellow
    node $Fetcher `
      --closeout-dir $CloseoutDir `
      --out-dir $RawResultDir `
      --work-dir $WorkRoot
  }
  else {
    Write-Host "网络路径：$ResolvedProxy" -ForegroundColor Yellow
    node $Fetcher `
      --closeout-dir $CloseoutDir `
      --out-dir $RawResultDir `
      --work-dir $WorkRoot `
      --proxy-url $ResolvedProxy
  }

  if ($LASTEXITCODE -ne 0) {
    throw (
      "来源扩展运行失败。checkpoint 已保留在：" +
      "$WorkRoot；修复网络后重跑会自动续跑。"
    )
  }

  Assert-Manifest -Directory $RawResultDir

  Get-ChildItem `
    -LiteralPath $RawResultDir `
    -Force |
    ForEach-Object {
      Copy-Item `
        -LiteralPath $_.FullName `
        -Destination $OutputDir `
        -Recurse `
        -Force
    }

  foreach ($Name in @(
    "campaign-binding.json",
    "campaign-summary.json",
    "validation-report.json",
    "README.md"
  )) {
    Copy-Item `
      -LiteralPath (Join-Path $CloseoutDir $Name) `
      -Destination (Join-Path $OutputDir "input-$Name") `
      -Force
  }

  $Summary = Read-JsonFile `
    -Path (Join-Path $OutputDir "phase1-source-expansion-summary.json")

  if (
    [int]$Summary.rows -ne 1122 -or
    [int]$Summary.uniqueWorkIds -ne 1122 -or
    [int]$Summary.uniquePublicationKeys -ne 1122 -or
    [int]$Summary.mgv2TitleCandidateRows -ne 65 -or
    [int]$Summary.gradeMutationRows -ne 0 -or
    [int]$Summary.ruleMutationRows -ne 0 -or
    $Summary.titleOnlyMatchesAcceptedAutomatically -ne $false -or
    $Summary.safety.productionApplyAuthorized -ne $false
  ) {
    throw "Phase 1 来源扩展 summary 不符合安全契约"
  }

  $Receipt = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString("o")
    branch = $ExpectedBranch
    head = $LocalHead
    closeoutBundle = $CloseoutFileName
    closeoutBundleSha256 = $CloseoutHash.Hash.ToLowerInvariant()
    proxyUsed = -not [string]::IsNullOrWhiteSpace($ResolvedProxy)
    proxyValue = if ($ResolvedProxy) { $ResolvedProxy } else { $null }
    checkpointDirectory = $WorkRoot
    rows = 1122
    payloadRead = $false
    payloadWrite = $false
    postgresqlRead = $false
    postgresqlWrite = $false
    productionApplyAuthorized = $false
  }

  Write-JsonFile `
    -Path (Join-Path $OutputDir "phase1-run-receipt.json") `
    -Value $Receipt

  Write-DirectoryManifest -Directory $OutputDir

  Remove-Item `
    -LiteralPath $Bundle `
    -Force `
    -ErrorAction SilentlyContinue

  Compress-Archive `
    -Path (Join-Path $OutputDir "*") `
    -DestinationPath $Bundle `
    -CompressionLevel Optimal `
    -Force

  if (-not (Test-Path -LiteralPath $Bundle -PathType Leaf)) {
    throw "Phase 1 evidence ZIP 未生成"
  }

  $BundleHash = Get-FileHash `
    -LiteralPath $Bundle `
    -Algorithm SHA256

  Write-Host ""
  Write-Host "1,122 条 Phase 1 来源扩展完成～" `
    -ForegroundColor Green

  Write-Host "OutputDirectory          : $OutputDir"
  Write-Host "EvidenceBundle           : $Bundle"
  Write-Host "EvidenceBundleSHA256     : $($BundleHash.Hash)"
  Write-Host "ExactIdRows              : $($Summary.exactIdRows)"
  $ExactSingleMatches = Get-JsonCount `
    -Object $Summary.exactIdByStatus `
    -Name "exact_id_match"
  $ReadyForNextReview = Get-JsonCount `
    -Object $Summary.phase1ByStatus `
    -Name "phase1_ready_for_guard_or_assembly_review"
  $AdditionalSourceNeeded = Get-JsonCount `
    -Object $Summary.phase1ByStatus `
    -Name "phase1_requires_additional_source"
  $HumanRisk = Get-JsonCount `
    -Object $Summary.phase1ByStatus `
    -Name "phase1_requires_human_risk_adjudication"
  $ManualConflict = Get-JsonCount `
    -Object $Summary.phase1ByStatus `
    -Name "phase1_requires_manual_conflict_decision"
  $FreshResearch = Get-JsonCount `
    -Object $Summary.phase1ByStatus `
    -Name "phase1_requires_fresh_research"

  Write-Host "ExactSingleMatches       : $ExactSingleMatches"
  Write-Host "SourceResolvedRows       : $($Summary.sourceResolvedRows)"
  Write-Host "RiskResolvedNoMutation   : $($Summary.riskResolvedWithoutMutationRows)"
  Write-Host "SummariesReconstructed   : $($Summary.reconstructedSourceSummaryRows)"
  Write-Host "ReadyForNextReview       : $ReadyForNextReview"
  Write-Host "AdditionalSourceNeeded   : $AdditionalSourceNeeded"
  $HumanRiskOrConflict = $HumanRisk + $ManualConflict

  Write-Host "HumanRiskOrConflict      : $HumanRiskOrConflict"
  Write-Host "FreshResearch            : $FreshResearch"
  Write-Host "PayloadWrite             : False"
  Write-Host "PostgreSQLWrite          : False"
  Write-Host "ProductionApply          : False"
}
finally {
  Remove-Item `
    -LiteralPath $TempRoot `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue
}
