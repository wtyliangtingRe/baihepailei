param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$OldAssemblyBundle,
  [Parameter(Mandatory = $true)][string]$Phase2Bundle,
  [Parameter(Mandatory = $true)][string]$PriorLabEvidenceBundle,
  [string]$ExpectedOldAssemblySHA256 = 'D41FB41951E35E8DC0C2CDDE1FB904968AF3DF5D3564BDDB8A13A3FB002C14C2',
  [string]$ExpectedPhase2SHA256 = 'AE6908AB6E375FBCFA7602FFA39115FBA20300D816105E76421DBD9E8D012330',
  [string]$ExpectedPriorLabEvidenceSHA256 = '621C6D2BDA4E064FC9781B56EF178188D39AFF9EBE648B3CA5B24F0496705561'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$AllowedDirtyFiles = @(
  'next-env.d.ts',
  'payload-types.ts',
  'docs/guides/README.md',
  'docs/guides/radar-ai-incremental-publication-runbook-v01.md',
  'docs/guides/radar-publication-safety-v01.md',
  'docs/guides/work-assessment-model-v01.md',
  'docs/guides/radar-dual-track-ai-coverage-policy-v01.md',
  'docs/guides/radar-remaining-1122-phase2-live-guard-closeout-v01.md',
  'docs/guides/radar-work-level-multilingual-research-policy-v01.md',
  'scripts/radar/apply-radar-dual-track-ai-coverage-policy-v01.mjs',
  'scripts/radar/build-radar-remaining-closeout-phase2-v01.mjs',
  'scripts/radar/run-and-package-radar-remaining-closeout-phase2-v01.ps1',
  'tests/radar-dual-track-ai-coverage-policy.test.mjs',
  'tests/radar-remaining-closeout-phase2.test.mjs',
  'docs/guides/radar-unified-1804-incremental-assembly-and-lab-v01.md',
  'scripts/radar/build-radar-unified-incremental-assembly-v01.mjs',
  'scripts/radar/run-and-package-radar-unified-incremental-assembly-v01.ps1',
  'scripts/radar/build-radar-unified-incremental-storage-lab-v01.mjs',
  'scripts/radar/run-and-package-radar-unified-incremental-storage-lab-v01.ps1',
  'scripts/radar/run-and-package-radar-unified-incremental-assembly-and-lab-v01.ps1',
  'tests/radar-unified-incremental-assembly-and-lab.test.mjs'
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-InputFile {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Label
  )
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

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Value
  )
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

function Assert-Manifest {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
  $expected = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
  )
  foreach ($entry in @($manifest)) {
    $relative = ([string]$entry.file).Replace('\', '/')
    $file = Join-Path $Directory ($relative.Replace(
      '/',
      [System.IO.Path]::DirectorySeparatorChar
    ))
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "manifest 文件不存在：$relative"
    }
    $item = Get-Item -LiteralPath $file
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if (
      $item.Length -ne [long]$entry.bytes -or
      $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()
    ) {
      throw "manifest 校验失败：$relative"
    }
    $null = $expected.Add($relative)
  }
  $actual = @(
    Get-ChildItem -LiteralPath $Directory -Recurse -File |
      Where-Object {
        -not (
          $_.Name -eq 'manifest.json' -and
          $_.DirectoryName -eq $Directory
        )
      } |
      ForEach-Object {
        [System.IO.Path]::GetRelativePath(
          $Directory,
          $_.FullName
        ).Replace('\', '/')
      }
  )
  if ($actual.Count -ne $expected.Count) {
    throw "manifest 覆盖数量不一致：actual=$($actual.Count) expected=$($expected.Count)"
  }
  foreach ($relative in $actual) {
    if (-not $expected.Contains($relative)) {
      throw "发现 manifest 未登记文件：$relative"
    }
  }
  return @($manifest).Count
}

function Write-DirectoryManifest {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $manifestPath = Join-Path $Directory 'manifest.json'
  Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
  $manifest = @(
    Get-ChildItem -LiteralPath $Directory -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        $relative = [System.IO.Path]::GetRelativePath(
          $Directory,
          $_.FullName
        ).Replace('\', '/')
        $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
        [ordered]@{
          file = $relative
          bytes = $_.Length
          sha256 = $hash.Hash.ToLowerInvariant()
        }
      }
  )
  Write-JsonFile -Path $manifestPath -Value $manifest
  return Assert-Manifest -Directory $Directory
}

$oldAssemblyPath = Resolve-InputFile $OldAssemblyBundle '既有 683 条 assembly ZIP'
$phase2Path = Resolve-InputFile $Phase2Bundle 'Phase 2 结果 ZIP'
$priorLabPath = Resolve-InputFile $PriorLabEvidenceBundle '既有 683 条 lab evidence ZIP'

$oldHash = (Get-FileHash -LiteralPath $oldAssemblyPath -Algorithm SHA256).Hash
$phase2Hash = (Get-FileHash -LiteralPath $phase2Path -Algorithm SHA256).Hash
$priorLabHash = (Get-FileHash -LiteralPath $priorLabPath -Algorithm SHA256).Hash
if ($oldHash -ne $ExpectedOldAssemblySHA256) { throw "旧 assembly SHA-256 不匹配：$oldHash" }
if ($phase2Hash -ne $ExpectedPhase2SHA256) { throw "Phase 2 SHA-256 不匹配：$phase2Hash" }
if ($priorLabHash -ne $ExpectedPriorLabEvidenceSHA256) { throw "旧 lab evidence SHA-256 不匹配：$priorLabHash" }

$unexpectedDirty = @(
  Get-DirtyPaths |
    Where-Object { $AllowedDirtyFiles -notcontains $_ }
)
if ($unexpectedDirty.Count -gt 0) {
  $unexpectedDirty | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '存在预期之外的本地修改；未开始统一 assembly。'
}

Write-Host ''
Write-Host '==> 锁定 PR #311 分支与提交' -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取远端更新失败。' }
git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '切换公共 Radar 分支失败。' }
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新公共 Radar 分支失败。' }
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $ExpectedBranchHead -or $remoteHead -ne $ExpectedBranchHead) {
  throw "统一 assembly 提交不符合预期：local=$localHead remote=$remoteHead"
}

Write-Host ''
Write-Host '==> 运行统一 assembly 语法与回归测试' -ForegroundColor Cyan
node --check '.\scripts\radar\build-radar-unified-incremental-assembly-v01.mjs'
if ($LASTEXITCODE -ne 0) { throw '统一 assembly builder 语法检查失败。' }
node --test `
  '.\tests\radar-unified-incremental-assembly-and-lab.test.mjs' `
  '.\tests\radar-public-storage-normalization.test.mjs'
if ($LASTEXITCODE -ne 0) { throw '统一 assembly 回归测试失败。' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-unified-1804-incremental-assembly-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-UNIFIED-1804-INCREMENTAL-ASSEMBLY-$stamp.zip"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  "radar-unified-1804-assembly-$stamp-" + [Guid]::NewGuid().ToString('N')
)
$oldDir = Join-Path $tempRoot 'old-assembly'
$phase2Dir = Join-Path $tempRoot 'phase2'
New-Item -ItemType Directory -Path $oldDir, $phase2Dir -Force | Out-Null

try {
  Expand-Archive -LiteralPath $oldAssemblyPath -DestinationPath $oldDir -Force
  Expand-Archive -LiteralPath $phase2Path -DestinationPath $phase2Dir -Force
  $oldManifestFiles = Assert-Manifest -Directory $oldDir
  $phase2ManifestFiles = Assert-Manifest -Directory $phase2Dir

  node '.\scripts\radar\build-radar-unified-incremental-assembly-v01.mjs' `
    --old-assembly-dir $oldDir `
    --old-assembly-zip-sha256 $oldHash `
    --phase2-dir $phase2Dir `
    --phase2-zip-sha256 $phase2Hash `
    --prior-lab-evidence-sha256 $priorLabHash `
    --out-dir $outDir
  if ($LASTEXITCODE -ne 0) { throw '统一 assembly 构建失败。' }

  $summaryPath = Join-Path $outDir 'radar-unified-incremental-assembly-summary.json'
  $validationPath = Join-Path $outDir 'unified-incremental-assembly-validation.json'
  $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
  $validation = Get-Content -LiteralPath $validationPath -Raw -Encoding UTF8 |
    ConvertFrom-Json -Depth 100
  if (
    $summary.rows -ne 1804 -or
    $summary.storageNormalized -ne 1804 -or
    $summary.blocked -ne 0 -or
    $summary.oldAcceptedRows -ne 683 -or
    $summary.newPhase2Rows -ne 1121 -or
    $summary.noncanonicalCoverageExemptRows -ne 1 -or
    $summary.readyForStorageLabPlanning -ne $true -or
    $validation.passed -ne $true
  ) {
    throw '统一 assembly summary/validation 未满足固定门槛。'
  }

  $receipt = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    version = 'radar-unified-1804-incremental-assembly-runner-v0.1'
    branch = $ExpectedBranch
    head = $localHead
    oldAssemblyBundleSha256 = $oldHash.ToLowerInvariant()
    phase2BundleSha256 = $phase2Hash.ToLowerInvariant()
    prior683LabEvidenceSha256 = $priorLabHash.ToLowerInvariant()
    oldAssemblyManifestFiles = $oldManifestFiles
    phase2ManifestFiles = $phase2ManifestFiles
    rows = 1804
    readyForStorageLabPlanning = $true
    networkFetch = $false
    payloadRead = $false
    payloadWrite = $false
    postgresqlRead = $false
    postgresqlWrite = $false
    productionApplyAuthorized = $false
  }
  Write-JsonFile `
    -Path (Join-Path $outDir 'unified-incremental-assembly-run-receipt.json') `
    -Value $receipt
  $manifestFiles = Write-DirectoryManifest -Directory $outDir

  $packRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "radar-unified-1804-pack-" + [Guid]::NewGuid().ToString('N')
  )
  try {
    New-Item -ItemType Directory -Path $packRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $outDir -Force |
      Copy-Item -Destination $packRoot -Recurse -Force
    Compress-Archive `
      -Path (Join-Path $packRoot '*') `
      -DestinationPath $bundlePath `
      -CompressionLevel Optimal `
      -Force
  } finally {
    Remove-Item -LiteralPath $packRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
    throw '统一 assembly ZIP 未生成。'
  }
  $bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

  Write-Host ''
  Write-Host '1,804 条统一增量 assembly 已完成～' -ForegroundColor Green
  Write-Host "OutputDirectory       : $outDir"
  Write-Host "AssemblyBundle        : $bundlePath"
  Write-Host "AssemblyBundleSHA256  : $($bundleHash.Hash)"
  Write-Host 'Rows                  : 1804'
  Write-Host 'OldAcceptedRows       : 683'
  Write-Host 'NewPhase2Rows         : 1121'
  Write-Host 'NoncanonicalExempt    : 1'
  Write-Host "ManifestFiles         : $manifestFiles"
  Write-Host 'ProductionApplyAuthorized: False'
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
