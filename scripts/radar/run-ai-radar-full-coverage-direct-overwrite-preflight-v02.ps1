[CmdletBinding()]
param(
  [string]$ServerUrl = "http://127.0.0.1:3000",
  [string]$TargetId = "3739"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedBranch = "agent/radar-direct-overwrite-publication-v02"
$PackageDir = Join-Path (Get-Location) "data_local\outputs\ai-radar\wave5-full-coverage-8183-v01"
$OutRoot = Join-Path (Get-Location) "data_local\staging\ai-radar\full-coverage-direct-overwrite-v02"
$CheckpointRoot = Join-Path (Get-Location) "data_local\outputs\ai-radar\checkpoints"
$Runner = ".\scripts\radar\run-ai-radar-full-coverage-direct-overwrite-v02.mjs"
$Tests = @(
  ".\tests\ai-radar-full-coverage-publication.test.mjs",
  ".\tests\radar-full-coverage-direct-overwrite-v02.test.mjs"
)

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
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

$CurrentBranch = (git branch --show-current).Trim()
if ($CurrentBranch -ne $ExpectedBranch) {
  throw "direct-overwrite 预检必须在 $ExpectedBranch 分支执行；当前为 $CurrentBranch"
}

if (-not (Test-Path -LiteralPath $PackageDir)) {
  throw "找不到已验证的全覆盖包目录：$PackageDir"
}
if (-not (Test-Path -LiteralPath $Runner)) {
  throw "找不到 direct-overwrite 运行器：$Runner"
}

$StartedAt = Get-Date
$TestOutput = Join-Path $env:TEMP ("radar-direct-overwrite-tests-" + [guid]::NewGuid().ToString("N") + ".txt")
$Temp = $null
try {
  $TestLines = @(& node --test @Tests 2>&1)
  $TestExit = $LASTEXITCODE
  $TestLines | ForEach-Object { Write-Host $_ }
  $TestLines | Set-Content -LiteralPath $TestOutput -Encoding UTF8
  if ($TestExit -ne 0) {
    throw "direct-overwrite 回归测试失败"
  }

  Ensure-Credentials
  New-Item -ItemType Directory -Path $OutRoot -Force | Out-Null

  & node $Runner `
    --package-dir $PackageDir `
    --url $ServerUrl `
    --out-root $OutRoot
  if ($LASTEXITCODE -ne 0) {
    throw "direct-overwrite 只读预检失败"
  }

  $PlanSummaryFile = Get-ChildItem -LiteralPath $OutRoot -Recurse -File -Filter "publication-plan-summary.json" |
    Where-Object { $_.LastWriteTime -ge $StartedAt.AddSeconds(-2) } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $PlanSummaryFile) {
    throw "没有找到本次 direct-overwrite publication-plan-summary.json"
  }

  $RunDir = Split-Path -Parent $PlanSummaryFile.FullName
  $PlanFile = Join-Path $RunDir "publication-plan.jsonl"
  if (-not (Test-Path -LiteralPath $PlanFile)) {
    throw "没有找到本次 direct-overwrite publication-plan.jsonl"
  }

  $Summary = Get-Content -LiteralPath $PlanSummaryFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([int]$Summary.packageRows -ne 8183) { throw "packageRows 不是 8183" }
  if ([int]$Summary.humanTrackPatchFields -ne 0) { throw "计划包含人工字段 PATCH" }
  if ([int]$Summary.wholeDraftPublicationRows -ne 0) { throw "计划包含整份草稿发布" }
  if ($Summary.byStrategy.PSObject.Properties.Name -contains "version_roundtrip") {
    if ([int]$Summary.byStrategy.version_roundtrip -gt 0) {
      throw "direct-overwrite 计划仍包含 version_roundtrip"
    }
  }

  $PlanRows = New-Object System.Collections.Generic.List[object]
  foreach ($Line in Get-Content -LiteralPath $PlanFile -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($Line)) { continue }
    $PlanRows.Add(($Line | ConvertFrom-Json))
  }
  if ($PlanRows.Count -ne [int]$Summary.planRows) {
    throw "计划正文行数与摘要不一致"
  }

  $RoundtripRows = @($PlanRows | Where-Object { $_.strategy -eq "version_roundtrip" })
  if ($RoundtripRows.Count -gt 0) {
    throw "计划正文仍包含 version_roundtrip"
  }
  $HumanPatchRows = @($PlanRows | Where-Object {
    $_.patch -and ($_.patch.PSObject.Properties.Name -contains "humanAssessment")
  })
  if ($HumanPatchRows.Count -gt 0) {
    throw "计划正文包含 humanAssessment PATCH"
  }

  $TargetRow = $PlanRows | Where-Object { [string]$_.targetId -eq $TargetId } | Select-Object -First 1
  if (-not $TargetRow) {
    throw "计划中没有找到目标作品：$TargetId"
  }
  if ($TargetRow.strategy -notin @("direct_field_publish_latest_ai_overwrite", "already_published")) {
    throw "目标作品策略异常：$($TargetRow.strategy)"
  }

  $DirectRows = @($PlanRows | Where-Object { $_.strategy -eq "direct_field_publish_latest_ai_overwrite" })
  $AlreadyRows = @($PlanRows | Where-Object { $_.strategy -eq "already_published" })
  $BlockedRows = @($PlanRows | Where-Object { $_.strategy -eq "blocked" })

  New-Item -ItemType Directory -Path $CheckpointRoot -Force | Out-Null
  $Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-direct-overwrite-preflight-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $Temp | Out-Null

  Copy-Item -LiteralPath $PlanSummaryFile.FullName -Destination (Join-Path $Temp "publication-plan-summary.json")
  Copy-Item -LiteralPath $TestOutput -Destination (Join-Path $Temp "test-output.txt")
  $TargetRow | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $Temp "target-$TargetId-plan-row.json") -Encoding UTF8
  $PlanRows | Select-Object -First 50 | ConvertTo-Json -Depth 30 |
    Set-Content -LiteralPath (Join-Path $Temp "publication-plan-sample-50.json") -Encoding UTF8

  $CheckpointManifest = [ordered]@{
    version = "ai-radar-full-coverage-direct-overwrite-preflight-v0.2"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    gitCommit = (git rev-parse HEAD).Trim()
    mode = "preflight"
    packageRows = 8183
    planRows = $PlanRows.Count
    directOverwriteRows = $DirectRows.Count
    alreadyPublishedRows = $AlreadyRows.Count
    blockedRows = $BlockedRows.Count
    targetId = $TargetId
    targetStrategy = $TargetRow.strategy
    planFile = $PlanFile
    planSha256 = Get-Sha256 $PlanFile
    safety = [ordered]@{
      payloadRead = $true
      payloadWrite = $false
      directPostgresqlWrite = $false
      versionRestore = $false
      wholeDraftPublication = $false
      humanAssessmentMutation = $false
      latestAiOverwritesOlderDraftAi = $true
    }
  }
  $CheckpointManifest | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath (Join-Path $Temp "checkpoint-manifest.json") -Encoding UTF8

  $SumLines = @()
  Get-ChildItem -LiteralPath $Temp -File | Sort-Object Name | ForEach-Object {
    $SumLines += "$(Get-Sha256 $_.FullName)  $($_.Name)"
  }
  $SumLines | Set-Content -LiteralPath (Join-Path $Temp "SHA256SUMS.txt") -Encoding UTF8

  $CheckpointPath = Join-Path $CheckpointRoot "RADAR-FULL-COVERAGE-DIRECT-OVERWRITE-PREFLIGHT-checkpoint-v02.zip"
  if (Test-Path -LiteralPath $CheckpointPath) {
    Remove-Item -LiteralPath $CheckpointPath -Force
  }
  Compress-Archive -Path (Join-Path $Temp "*") -DestinationPath $CheckpointPath -CompressionLevel Optimal

  Write-Host ""
  Write-Host "Mode                    : direct-overwrite-preflight" -ForegroundColor Green
  Write-Host "PlanRows                : $($PlanRows.Count)"
  Write-Host "DirectOverwriteRows     : $($DirectRows.Count)"
  Write-Host "AlreadyPublishedRows    : $($AlreadyRows.Count)"
  Write-Host "BlockedRows             : $($BlockedRows.Count)"
  Write-Host "VersionRoundtripRows    : 0"
  Write-Host "TargetId                : $TargetId"
  Write-Host "TargetStrategy          : $($TargetRow.strategy)"
  Write-Host "PayloadWrite            : False"
  Write-Host "VersionRestore          : False"
  Write-Host "WholeDraftPublication   : False"
  Write-Host "HumanAssessmentMutation : False"
  Write-Host "CheckpointZip           : $CheckpointPath"
  Write-Host "CheckpointZipSha256     : $(Get-Sha256 $CheckpointPath)"
}
finally {
  if ($Temp -and (Test-Path -LiteralPath $Temp)) {
    Remove-Item -LiteralPath $Temp -Recurse -Force
  }
  if (Test-Path -LiteralPath $TestOutput) {
    Remove-Item -LiteralPath $TestOutput -Force
  }
}
