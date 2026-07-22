[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedBranch = "agent/radar-full-coverage-publication-v01"
$PackageName = "RADAR-WAVE5-FULL-COVERAGE-8183-PUBLICATION-v01.zip"
$PackageSha256 = "9e53ce9446d1f6ceadac057b4309e2d6e66fbd29698276bebf97d7e8147eac55"
$PackageId = "RADAR-WAVE5-FULL-COVERAGE-8183-PUBLICATION-v01"
$InstallRoot = Join-Path (Get-Location) "data_local\outputs\ai-radar\wave5-full-coverage-8183-v01"
$OutRoot = Join-Path (Get-Location) "data_local\staging\ai-radar\full-coverage-publication-v01"
$CheckpointRoot = Join-Path (Get-Location) "data_local\outputs\ai-radar\checkpoints"
$TestFile = ".\tests\ai-radar-full-coverage-publication.test.mjs"
$CheckpointName = "RADAR-FULL-COVERAGE-PUBLICATION-PREFLIGHT-checkpoint-v01.zip"

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Find-Package {
  $Candidates = @(
    (Join-Path $HOME "Downloads\$PackageName"),
    (Join-Path (Get-Location) "data_local\$PackageName"),
    (Join-Path (Get-Location) $PackageName)
  )
  foreach ($Candidate in $Candidates) {
    if (Test-Path -LiteralPath $Candidate) {
      return (Resolve-Path -LiteralPath $Candidate).Path
    }
  }
  throw "未找到固定结果包：$PackageName"
}

function Find-LatestPlanSummary {
  if (-not (Test-Path -LiteralPath $OutRoot)) {
    throw "全覆盖发布计划目录不存在：$OutRoot"
  }
  $Item = Get-ChildItem -LiteralPath $OutRoot -Recurse -File -Filter "publication-plan-summary.json" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $Item) {
    throw "没有找到已成功生成的 publication-plan-summary.json"
  }
  return $Item.FullName
}

$CurrentBranch = (git branch --show-current).Trim()
if ($CurrentBranch -ne $ExpectedBranch) {
  throw "预检收尾必须在 $ExpectedBranch 分支执行；当前为 $CurrentBranch"
}

$PackagePath = Find-Package
$ActualPackageSha = Get-Sha256 $PackagePath
if ($ActualPackageSha -ne $PackageSha256) {
  throw "完整覆盖包 SHA-256 不匹配：$ActualPackageSha"
}

$RequiredInstalledFiles = @(
  (Join-Path $InstallRoot "package-manifest.json"),
  (Join-Path $InstallRoot "summary\full-coverage-summary-v01.json"),
  (Join-Path $InstallRoot "validation\package-validation-v01.json")
)
foreach ($Required in $RequiredInstalledFiles) {
  if (-not (Test-Path -LiteralPath $Required)) {
    throw "已安装完整覆盖包缺少文件：$Required"
  }
}

$PackageManifest = Get-Content -LiteralPath $RequiredInstalledFiles[0] -Raw -Encoding UTF8 | ConvertFrom-Json
$PackageValidation = Get-Content -LiteralPath $RequiredInstalledFiles[2] -Raw -Encoding UTF8 | ConvertFrom-Json
if ($PackageManifest.packageId -ne $PackageId) { throw "已安装包 packageId 不匹配" }
if ([int]$PackageManifest.rows -ne 8183) { throw "已安装包行数不是 8183" }
if ([int]$PackageManifest.fixedRows -ne 265) { throw "已安装包固定等级不是 265 条" }
if ([int]$PackageManifest.boundedRows -ne 7918) { throw "已安装包范围评级不是 7918 条" }
if ($PackageValidation.complete -ne $true) { throw "已安装包 validation 未通过" }
if ([int]$PackageValidation.scannedWithoutValidConclusionRows -ne 0) { throw "已安装包存在空结论" }

$PlanSummaryFile = Find-LatestPlanSummary
$RunDir = Split-Path -Parent $PlanSummaryFile
$PlanFile = Join-Path $RunDir "publication-plan.jsonl"
if (-not (Test-Path -LiteralPath $PlanFile)) {
  throw "最新成功计划缺少 publication-plan.jsonl：$PlanFile"
}

$PlanSummary = Get-Content -LiteralPath $PlanSummaryFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($PlanSummary.packageId -ne $PackageId) { throw "发布计划 packageId 不匹配" }
if ([int]$PlanSummary.packageRows -ne 8183) { throw "发布计划包行数不是 8183" }
if ([int]$PlanSummary.planRows -le 0) { throw "发布计划为空" }
if ($PlanSummary.safety.payloadRead -ne $true) { throw "发布计划未声明 Payload 只读" }
if ($PlanSummary.safety.payloadWrite -ne $false) { throw "发布计划发生了 Payload 写入" }
if ($PlanSummary.safety.directPostgresqlWrite -ne $false) { throw "发布计划发生了 PostgreSQL 直写" }
if ($PlanSummary.safety.humanAssessmentMutation -ne $false) { throw "发布计划修改了人工轨道" }
if ($PlanSummary.safety.wholeDraftPublication -ne $false) { throw "发布计划包含整份草稿发布" }

$TestOutput = Join-Path $env:TEMP ("radar-full-coverage-tests-" + [guid]::NewGuid().ToString("N") + ".txt")
$TestLines = @(& node --test $TestFile 2>&1)
$TestExitCode = $LASTEXITCODE
$TestLines | ForEach-Object { Write-Host $_ }
$TestLines | Set-Content -LiteralPath $TestOutput -Encoding UTF8
if ($TestExitCode -ne 0) {
  throw "完整覆盖发布测试失败"
}

New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-full-checkpoint-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
  Copy-Item -LiteralPath $RequiredInstalledFiles[0] -Destination (Join-Path $Temp "package-manifest.json")
  Copy-Item -LiteralPath $RequiredInstalledFiles[1] -Destination (Join-Path $Temp "full-coverage-summary-v01.json")
  Copy-Item -LiteralPath $RequiredInstalledFiles[2] -Destination (Join-Path $Temp "package-validation-v01.json")
  Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $Temp "test-output.txt")
  Copy-Item -LiteralPath $PlanSummaryFile -Destination (Join-Path $Temp "publication-plan-summary.json")

  $CheckpointManifest = [ordered]@{
    version = "ai-radar-full-coverage-publication-checkpoint-v0.2"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    mode = "preflight"
    gitCommit = (git rev-parse HEAD).Trim()
    packageId = $PackageId
    packageZip = $PackagePath
    packageZipSha256 = $ActualPackageSha
    packageRows = 8183
    fixedRows = 265
    boundedRows = 7918
    scannedWithoutValidConclusionRows = 0
    publicationPlanRunDirectory = $RunDir
    publicationPlanFile = $PlanFile
    publicationPlanSha256 = Get-Sha256 $PlanFile
    publicationPlanSummaryFile = $PlanSummaryFile
    publicationPlanSummarySha256 = Get-Sha256 $PlanSummaryFile
    planRows = [int]$PlanSummary.planRows
    readyRows = [int]$PlanSummary.byStatus.ready
    alreadyPublishedRows = [int]$PlanSummary.byStatus.already_published
    blockedRows = [int]$PlanSummary.byStatus.blocked
    humanTrackRows = [int]$PlanSummary.humanTrackRows
    humanTrackPatchFields = [int]$PlanSummary.humanTrackPatchFields
    safety = [ordered]@{
      payloadRead = $true
      payloadWrite = $false
      directPostgresqlWrite = $false
      humanAssessmentMutation = $false
      wholeDraftPublication = $false
    }
  }
  $CheckpointManifest | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath (Join-Path $Temp "checkpoint-manifest.json") -Encoding UTF8

  $SumLines = @()
  Get-ChildItem -LiteralPath $Temp -File | Sort-Object Name | ForEach-Object {
    $SumLines += "$(Get-Sha256 $_.FullName)  $($_.Name)"
  }
  $SumLines | Set-Content -LiteralPath (Join-Path $Temp "SHA256SUMS.txt") -Encoding UTF8

  $CheckpointPath = Join-Path $CheckpointRoot $CheckpointName
  if (Test-Path -LiteralPath $CheckpointPath) {
    Remove-Item -LiteralPath $CheckpointPath -Force
  }
  Compress-Archive -Path (Join-Path $Temp "*") -DestinationPath $CheckpointPath -CompressionLevel Optimal

  Write-Host ""
  Write-Host "PackageId               : $PackageId" -ForegroundColor Green
  Write-Host "Rows                    : 8183"
  Write-Host "FixedRows               : 265"
  Write-Host "BoundedRows             : 7918"
  Write-Host "PlanRows                : $($PlanSummary.planRows)"
  Write-Host "ReadyRows               : $($PlanSummary.byStatus.ready)"
  Write-Host "AlreadyPublishedRows    : $($PlanSummary.byStatus.already_published)"
  Write-Host "BlockedRows             : $($PlanSummary.byStatus.blocked)"
  Write-Host "Mode                    : preflight-finalized"
  Write-Host "HumanAssessmentMutation : False"
  Write-Host "WholeDraftPublication   : False"
  Write-Host "DirectPostgresqlWrite   : False"
  Write-Host "CheckpointZip           : $CheckpointPath"
  Write-Host "CheckpointZipSha256     : $(Get-Sha256 $CheckpointPath)"
}
finally {
  if (Test-Path -LiteralPath $Temp) {
    Remove-Item -LiteralPath $Temp -Recurse -Force
  }
  if (Test-Path -LiteralPath $TestOutput) {
    Remove-Item -LiteralPath $TestOutput -Force
  }
}
