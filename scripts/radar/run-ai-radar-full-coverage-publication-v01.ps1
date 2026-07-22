[CmdletBinding()]
param(
  [switch]$Execute,
  [string]$ServerUrl = "http://127.0.0.1:3000",
  [int]$DelayMs = 25,
  [int]$MaxRows = 0
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$PackageName = "RADAR-WAVE5-FULL-COVERAGE-8183-PUBLICATION-v01.zip"
$PackageSha256 = "9e53ce9446d1f6ceadac057b4309e2d6e66fbd29698276bebf97d7e8147eac55"
$PackageId = "RADAR-WAVE5-FULL-COVERAGE-8183-PUBLICATION-v01"
$InstallRoot = Join-Path (Get-Location) "data_local\outputs\ai-radar\wave5-full-coverage-8183-v01"
$OutRoot = Join-Path (Get-Location) "data_local\staging\ai-radar\full-coverage-publication-v01"
$CheckpointRoot = Join-Path (Get-Location) "data_local\outputs\ai-radar\checkpoints"
$TestFile = ".\tests\ai-radar-full-coverage-publication.test.mjs"
$RunnerFile = ".\scripts\radar\run-ai-radar-full-coverage-publication-v01.mjs"
$ExactConfirmation = "PUBLISH-ALL-VALID-AI-FIXED-OR-RANGE-CONCLUSIONS"

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

function Confirm-Package([string]$ZipPath) {
  $Actual = Get-Sha256 $ZipPath
  if ($Actual -ne $PackageSha256) {
    throw "完整覆盖包 SHA-256 不匹配：$Actual"
  }

  $Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-full-coverage-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $Temp | Out-Null
  try {
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $Temp -Force

    $ManifestPath = Join-Path $Temp "package-manifest.json"
    $SummaryPath = Join-Path $Temp "summary\full-coverage-summary-v01.json"
    $ValidationPath = Join-Path $Temp "validation\package-validation-v01.json"
    $SumsPath = Join-Path $Temp "SHA256SUMS.txt"

    foreach ($Required in @($ManifestPath, $SummaryPath, $ValidationPath, $SumsPath)) {
      if (-not (Test-Path -LiteralPath $Required)) {
        throw "完整覆盖包缺少文件：$Required"
      }
    }

    $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $Summary = Get-Content -LiteralPath $SummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $Validation = Get-Content -LiteralPath $ValidationPath -Raw -Encoding UTF8 | ConvertFrom-Json

    if ($Manifest.packageId -ne $PackageId) { throw "完整覆盖包 packageId 不匹配" }
    if ([int]$Manifest.rows -ne 8183) { throw "完整覆盖包行数不是 8183" }
    if ([int]$Manifest.fixedRows -ne 265) { throw "固定等级不是 265 条" }
    if ([int]$Manifest.boundedRows -ne 7918) { throw "范围评级不是 7918 条" }
    if ($Validation.complete -ne $true) { throw "完整覆盖包 validation 未通过" }
    if ([int]$Validation.scannedWithoutValidConclusionRows -ne 0) {
      throw "完整覆盖包存在空结论"
    }

    foreach ($Line in Get-Content -LiteralPath $SumsPath -Encoding UTF8) {
      if ([string]::IsNullOrWhiteSpace($Line)) { continue }
      if ($Line -notmatch '^([0-9a-f]{64})\s+(.+)$') {
        throw "SHA256SUMS.txt 格式错误：$Line"
      }
      $Expected = $Matches[1]
      $Relative = $Matches[2].Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $File = Join-Path $Temp $Relative
      if (-not (Test-Path -LiteralPath $File)) {
        throw "SHA256SUMS 声明的文件不存在：$Relative"
      }
      $ActualInner = Get-Sha256 $File
      if ($ActualInner -ne $Expected) {
        throw "内部文件哈希不匹配：$Relative"
      }
    }

    if (Test-Path -LiteralPath $InstallRoot) {
      Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Temp "*") -Destination $InstallRoot -Recurse -Force

    return @{
      Manifest = $Manifest
      Summary = $Summary
      Validation = $Validation
      ZipPath = $ZipPath
      ZipSha256 = $Actual
    }
  }
  finally {
    if (Test-Path -LiteralPath $Temp) {
      Remove-Item -LiteralPath $Temp -Recurse -Force
    }
  }
}

function Ensure-Credentials {
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_EMAIL)) {
    $env:RADAR_PAYLOAD_EMAIL = Read-Host "Payload 管理员邮箱"
  }
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_PASSWORD)) {
    $Secure = Read-Host "Payload 管理员密码" -AsSecureString
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
      $env:RADAR_PAYLOAD_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
    }
  }
  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_EMAIL) -or
      [string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_PASSWORD)) {
    throw "Payload 凭据不能为空"
  }
}

function Invoke-StaticTests {
  $TestOutput = Join-Path $env:TEMP ("radar-full-coverage-tests-" + [guid]::NewGuid().ToString("N") + ".txt")
  try {
    & node --test $TestFile 2>&1 | Tee-Object -FilePath $TestOutput
    if ($LASTEXITCODE -ne 0) {
      throw "完整覆盖发布测试失败"
    }
    return $TestOutput
  }
  catch {
    if (Test-Path -LiteralPath $TestOutput) {
      Get-Content -LiteralPath $TestOutput
    }
    throw
  }
}

function New-DatabaseBackupProof {
  if ([string]::IsNullOrWhiteSpace($env:DATABASE_URI)) {
    throw "执行发布前必须设置 DATABASE_URI"
  }
  $PgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
  if (-not $PgDump) {
    throw "未找到 pg_dump；执行发布前必须先安装 PostgreSQL 客户端"
  }

  $BackupDir = Join-Path (Get-Location) "data_local\backups\radar-full-coverage-publication"
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $DumpFile = Join-Path $BackupDir "baihepailei-before-full-radar-publication-$Stamp.dump"

  & pg_dump --format=custom --file=$DumpFile $env:DATABASE_URI
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump 备份失败"
  }
  $DumpItem = Get-Item -LiteralPath $DumpFile
  if ($DumpItem.Length -le 0) {
    throw "数据库备份为空"
  }

  $Proof = [ordered]@{
    version = "ai-radar-full-coverage-backup-proof-v0.1"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    gitCommit = (git rev-parse HEAD).Trim()
    dumpFile = $DumpItem.FullName
    dumpSha256 = Get-Sha256 $DumpItem.FullName
    dumpBytes = $DumpItem.Length
    serverUrl = $ServerUrl
  }
  $ProofFile = Join-Path $BackupDir "backup-proof-$Stamp.json"
  $Proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ProofFile -Encoding UTF8
  return $ProofFile
}

function Find-LatestFile([string]$Root, [string]$Name) {
  $Item = Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $Name |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $Item) { return $null }
  return $Item.FullName
}

function New-Checkpoint(
  [hashtable]$PackageInfo,
  [string]$TestOutput,
  [bool]$WasExecute,
  [string]$BackupProof
) {
  New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null
  $CheckpointName = if ($WasExecute) {
    "RADAR-FULL-COVERAGE-PUBLICATION-EXECUTION-checkpoint-v01.zip"
  } else {
    "RADAR-FULL-COVERAGE-PUBLICATION-PREFLIGHT-checkpoint-v01.zip"
  }

  $Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-full-checkpoint-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $Temp | Out-Null
  try {
    Copy-Item -LiteralPath (Join-Path $InstallRoot "package-manifest.json") -Destination $Temp
    Copy-Item -LiteralPath (Join-Path $InstallRoot "summary\full-coverage-summary-v01.json") -Destination $Temp
    Copy-Item -LiteralPath (Join-Path $InstallRoot "validation\package-validation-v01.json") -Destination $Temp
    Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $Temp "test-output.txt")

    $PlanSummary = Find-LatestFile $OutRoot "publication-plan-summary.json"
    if (-not $PlanSummary) { throw "没有找到 publication-plan-summary.json" }
    Copy-Item -LiteralPath $PlanSummary -Destination (Join-Path $Temp "publication-plan-summary.json")

    $PlanFile = Find-LatestFile $OutRoot "publication-plan.jsonl"
    if (-not $PlanFile) { throw "没有找到 publication-plan.jsonl" }

    $ExecutionSummary = Find-LatestFile $OutRoot "execution-summary.json"
    if ($WasExecute -and -not $ExecutionSummary) {
      throw "执行模式没有找到 execution-summary.json"
    }
    if ($ExecutionSummary) {
      Copy-Item -LiteralPath $ExecutionSummary -Destination (Join-Path $Temp "execution-summary.json")
    }

    $ExecutionLedger = Find-LatestFile $OutRoot "execution-ledger.jsonl"
    $Manifest = [ordered]@{
      version = "ai-radar-full-coverage-publication-checkpoint-v0.1"
      generatedAt = (Get-Date).ToUniversalTime().ToString("o")
      mode = if ($WasExecute) { "execute" } else { "preflight" }
      packageId = $PackageId
      packageZip = $PackageInfo.ZipPath
      packageZipSha256 = $PackageInfo.ZipSha256
      packageRows = 8183
      fixedRows = 265
      boundedRows = 7918
      scannedWithoutValidConclusionRows = 0
      publicationPlanFile = $PlanFile
      publicationPlanSha256 = Get-Sha256 $PlanFile
      executionLedgerFile = $ExecutionLedger
      executionLedgerSha256 = if ($ExecutionLedger) { Get-Sha256 $ExecutionLedger } else { $null }
      backupProofFile = $BackupProof
      safety = [ordered]@{
        directPostgresqlWrite = $false
        humanAssessmentMutation = $false
        wholeDraftPublication = $false
        partialPayloadFieldPublication = $WasExecute
      }
    }
    $Manifest | ConvertTo-Json -Depth 10 |
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
    return @{
      Path = $CheckpointPath
      Sha256 = Get-Sha256 $CheckpointPath
    }
  }
  finally {
    if (Test-Path -LiteralPath $Temp) {
      Remove-Item -LiteralPath $Temp -Recurse -Force
    }
  }
}

$CurrentBranch = (git branch --show-current).Trim()
if ($Execute) {
  if ($CurrentBranch -ne "main") {
    throw "实际发布只能在 main 分支执行；当前为 $CurrentBranch"
  }
} else {
  if ($CurrentBranch -ne "agent/radar-full-coverage-publication-v01") {
    throw "预检必须在 agent/radar-full-coverage-publication-v01 分支执行；当前为 $CurrentBranch"
  }
}

$PackagePath = Find-Package
$PackageInfo = Confirm-Package $PackagePath
$TestOutput = Invoke-StaticTests
Ensure-Credentials

$NodeArgs = @(
  $RunnerFile,
  "--package-dir", $InstallRoot,
  "--url", $ServerUrl,
  "--out-root", $OutRoot
)

$BackupProof = $null
if ($Execute) {
  $BackupProof = New-DatabaseBackupProof
  $NodeArgs += @(
    "--execute",
    "--confirmation", $ExactConfirmation,
    "--backup-proof", $BackupProof,
    "--delay-ms", [string]$DelayMs
  )
  if ($MaxRows -gt 0) {
    $NodeArgs += @("--max-rows", [string]$MaxRows)
  }
}

& node @NodeArgs
if ($LASTEXITCODE -ne 0) {
  throw "完整覆盖发布流程失败"
}

$Checkpoint = New-Checkpoint `
  -PackageInfo $PackageInfo `
  -TestOutput $TestOutput `
  -WasExecute $Execute.IsPresent `
  -BackupProof $BackupProof

Write-Host ""
Write-Host "PackageId               : $PackageId" -ForegroundColor Green
Write-Host "Rows                    : 8183"
Write-Host "FixedRows               : 265"
Write-Host "BoundedRows             : 7918"
Write-Host "EmptyConclusions        : 0"
Write-Host "Mode                    : $(if ($Execute) { 'execute' } else { 'preflight' })"
Write-Host "HumanAssessmentMutation : False"
Write-Host "WholeDraftPublication   : False"
Write-Host "DirectPostgresqlWrite   : False"
Write-Host "CheckpointZip           : $($Checkpoint.Path)"
Write-Host "CheckpointZipSha256     : $($Checkpoint.Sha256)"
