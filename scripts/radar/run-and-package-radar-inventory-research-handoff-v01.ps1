param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [string]$ExpectedBaseCommit = 'fd3fa8cfd57865fddc8e13bd7486065f85153092',
  [string]$ExpectedBranch = 'agent/radar-inventory-research-handoff-v01',
  [string]$ReviewBundle = 'exports\RADAR-REMAINING-CANONICAL-INVENTORY-20260725-133820-REVIEW.zip',
  [string]$ReviewDirectory = 'exports\radar-remaining-canonical-inventory-20260725-133820-review',
  [string]$ExpectedSourceBundleSha256 = 'EC1F49A54CD0B6314F97A20DB1E0D3681247CB4FA61B5F89C9A4C1F465C62E5B',
  [string]$ExpectedReviewBundleSha256 = '58265B1009AE1D82091555D658279A8F797308B6008FC9D23B8591A6D8330E2A',
  [string]$PackageId = 'RADAR-REMAINING-CANONICAL-RESEARCH-0001-input-v01'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $RepoRoot

function Resolve-RepoPath([string]$Value) {
  if ([System.IO.Path]::IsPathRooted($Value)) { return [System.IO.Path]::GetFullPath($Value) }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

$currentBranch = (git branch --show-current).Trim()
$currentHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw '无法读取当前 Git HEAD。' }
if ($currentBranch -ne $ExpectedBranch) { throw "当前分支不正确：$currentBranch" }
if ($currentHead -ne $ExpectedBranchHead) { throw "当前 HEAD 不是固定 research handoff 版本：$currentHead" }
if ($ExpectedBranchHead -notmatch '^[0-9A-Fa-f]{40}$' -or $ExpectedBaseCommit -notmatch '^[0-9A-Fa-f]{40}$') {
  throw 'ExpectedBranchHead 与 ExpectedBaseCommit 必须是 40 位 Git SHA。'
}
git merge-base --is-ancestor $ExpectedBaseCommit $currentHead
Assert-LastExitCode "research handoff 分支不包含固定 main 基线：$ExpectedBaseCommit"

$ReviewBundlePath = Resolve-RepoPath $ReviewBundle
$ReviewDirectoryPath = Resolve-RepoPath $ReviewDirectory
$OutputRoot = Resolve-RepoPath "data_local\outputs\ai-radar\research-handoffs"
$PackageDirectory = Join-Path $OutputRoot $PackageId
$PackageZip = Join-Path $OutputRoot "$PackageId.zip"

Write-Host ''
Write-Host '==> 验证已接受的 inventory review evidence' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $ReviewBundlePath -PathType Leaf)) { throw "找不到 review ZIP：$ReviewBundlePath" }
if (-not (Test-Path -LiteralPath $ReviewDirectoryPath -PathType Container)) { throw "找不到 review 目录：$ReviewDirectoryPath" }
$ReviewHash = (Get-FileHash -LiteralPath $ReviewBundlePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($ReviewHash -ne $ExpectedReviewBundleSha256.ToUpperInvariant()) {
  throw "review ZIP SHA-256 不匹配：$ReviewHash"
}
Write-Host "ReviewSHA256: $ReviewHash" -ForegroundColor Green

Write-Host ''
Write-Host '==> 运行 inventory → research handoff 专项测试' -ForegroundColor Cyan
node --check '.\scripts\radar\prepare-radar-inventory-research-handoff-v01.mjs'
Assert-LastExitCode 'inventory research handoff builder 语法检查失败'
node --test `
  '.\tests\radar-inventory-research-handoff.test.mjs' `
  '.\tests\radar-research-handoff.test.mjs'
Assert-LastExitCode 'inventory research handoff 专项测试失败'

Write-Host ''
Write-Host '==> 生成 2,500 条 research handoff 包' -ForegroundColor Cyan
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Remove-Item -LiteralPath $PackageDirectory -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PackageZip -Force -ErrorAction SilentlyContinue
node '.\scripts\radar\prepare-radar-inventory-research-handoff-v01.mjs' `
  --review-dir $ReviewDirectoryPath `
  --out-dir $PackageDirectory `
  --expected-source-bundle-sha256 $ExpectedSourceBundleSha256 `
  --expected-review-bundle-sha256 $ExpectedReviewBundleSha256 `
  --actual-review-bundle-sha256 $ReviewHash `
  --package-id $PackageId `
  --batch-size 2500 `
  --wave-size 250 `
  --chunk-size 5
Assert-LastExitCode '2,500 条 research handoff 生成失败'

$ManifestPath = Join-Path $PackageDirectory 'package-manifest.json'
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ([int]$Manifest.counts.researchRows -ne 2500 -or
    [int]$Manifest.counts.subwaves -ne 10 -or
    [int]$Manifest.counts.rowsPerSubwave -ne 250 -or
    [int]$Manifest.counts.chunkSize -ne 5 -or
    [int]$Manifest.counts.chunksPerSubwave -ne 50 -or
    [int]$Manifest.counts.totalChunks -ne 500) {
  throw 'research handoff 包统计不符合 2,500 / 10×250 / 500×5 门槛。'
}
if (@($Manifest.batches).Count -ne 10) { throw 'research handoff 子波次数量不是 10。' }
foreach ($Batch in @($Manifest.batches)) {
  if ([int]$Batch.rowCount -ne 250 -or [int]$Batch.chunkCount -ne 50 -or $Batch.independentlyRecoverable -ne $true) {
    throw "research handoff 子波次不可独立恢复：$($Batch.batchId)"
  }
}
if ($Manifest.safety.payloadWrite -ne $false -or
    $Manifest.safety.directPostgresqlWrite -ne $false -or
    $Manifest.safety.modifiesWorks -ne $false -or
    $Manifest.safety.publishesRatings -ne $false -or
    $Manifest.safety.productionApplyPackageGenerated -ne $false) {
  throw 'research handoff 安全声明不符合要求。'
}

Write-Host ''
Write-Host '==> 复算 package SHA256SUMS' -ForegroundColor Cyan
$HashFile = Join-Path $PackageDirectory 'SHA256SUMS'
$HashLines = @(Get-Content -LiteralPath $HashFile -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($HashLines.Count -lt 500) { throw "SHA256SUMS 条目异常：$($HashLines.Count)" }
foreach ($Line in $HashLines) {
  if ($Line -notmatch '^([0-9a-fA-F]{64})\s\s(.+)$') { throw "SHA256SUMS 行格式错误：$Line" }
  $ExpectedHash = $Matches[1].ToLowerInvariant()
  $Relative = $Matches[2].Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $File = [System.IO.Path]::GetFullPath((Join-Path $PackageDirectory $Relative))
  $Prefix = $PackageDirectory + [System.IO.Path]::DirectorySeparatorChar
  if (-not $File.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "SHA256SUMS 路径逃逸：$Relative" }
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "SHA256SUMS 文件不存在：$Relative" }
  $ActualHash = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualHash -ne $ExpectedHash) { throw "SHA256SUMS 不匹配：$Relative" }
}

Compress-Archive -Path (Join-Path $PackageDirectory '*') -DestinationPath $PackageZip -CompressionLevel Optimal -Force
$PackageHash = (Get-FileHash -LiteralPath $PackageZip -Algorithm SHA256).Hash.ToUpperInvariant()
$FirstBatch = @($Manifest.batches)[0]
$FirstHandoff = Get-Content -LiteralPath ([string]$FirstBatch.handoffManifest) -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$FirstUpload = [string]@($FirstHandoff.chunks)[0].inputFile

Write-Host ''
Write-Host 'Radar inventory research handoff V01 已完成～' -ForegroundColor Green
Write-Host "PackageDirectory : $PackageDirectory"
Write-Host "PackageZip       : $PackageZip"
Write-Host "PackageSHA256    : $PackageHash"
Write-Host "BranchHead       : $currentHead"
Write-Host 'ResearchRows     : 2500'
Write-Host 'Subwaves         : 10'
Write-Host 'RowsPerSubwave   : 250'
Write-Host 'Chunks           : 500'
Write-Host 'ChunkSize        : 5'
Write-Host "FirstUploadFile  : $FirstUpload"
Write-Host ''
Write-Host 'PayloadWrite     : False'
Write-Host 'PostgreSQLWrite  : False'
Write-Host 'WorksModified    : False'
Write-Host 'RatingsPublished : False'
Write-Host 'ProductionApply  : False'
