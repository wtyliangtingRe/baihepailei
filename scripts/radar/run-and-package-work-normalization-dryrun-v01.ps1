param(
  [string]$AuditDirectory = '',
  [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($AuditDirectory)) {
  $latestAudit = Get-ChildItem `
      -LiteralPath (Join-Path $repoRoot 'exports') `
      -Directory `
      -Filter 'work-normalization-candidates-*' |
    Where-Object {
      Test-Path -LiteralPath (Join-Path $_.FullName 'validation.json')
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latestAudit) {
    throw '没有找到通过 validation.json 标识的 Work 规范化候选审计目录。'
  }
  $AuditDirectory = $latestAudit.FullName
} else {
  $AuditDirectory = [System.IO.Path]::GetFullPath($AuditDirectory)
}

$validation = Get-Content `
  -LiteralPath (Join-Path $AuditDirectory 'validation.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 20

if ($validation.jsonValidated -ne $true) {
  throw '输入审计目录未通过 JSON 校验。'
}
if ($validation.transport -ne 'postgres_utf8_base64_to_powershell_utf8') {
  throw "输入审计目录使用了不受支持的传输方式：$($validation.transport)"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  Join-Path $repoRoot "exports\work-normalization-dryrun-$stamp"
} else {
  [System.IO.Path]::GetFullPath($OutputDirectory)
}
$bundlePath = Join-Path $repoRoot "exports\WORK-NORMALIZATION-DRYRUN-$stamp.zip"
$planner = Join-Path $PSScriptRoot 'build-work-normalization-dryrun-v01.mjs'

node $planner `
  --audit-dir $AuditDirectory `
  --output-dir $outDir

if ($LASTEXITCODE -ne 0) {
  throw 'Work 规范化 dry-run 计划生成失败。'
}

$requiredFiles = @(
  'human-normalization-plan.jsonl',
  'human-explicit-decisions.jsonl',
  'rank-preservation-plan.jsonl',
  'public-ai-review-candidates.jsonl',
  'schema-retirement-plan.json',
  'phase1-human-normalization-dryrun.sql',
  'schema-retirement-dryrun.sql',
  'normalization-summary.json',
  'normalization-summary.md',
  'manifest.json'
)

$missingFiles = @(
  $requiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $outDir $_))
  }
)
if ($missingFiles.Count -gt 0) {
  throw "dry-run 输出不完整：$($missingFiles -join ', ')"
}

$summary = Get-Content `
  -LiteralPath (Join-Path $outDir 'normalization-summary.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 50

if ($summary.safety.databaseWrite -ne $false `
  -or $summary.safety.payloadWrite -ne $false `
  -or $summary.safety.migrationGeneration -ne $false `
  -or $summary.safety.schemaPush -ne $false `
  -or $summary.safety.executableUpdateSqlGenerated -ne $false) {
  throw 'dry-run 安全标志不符合预期。'
}

$paths = @(
  $requiredFiles | ForEach-Object { Join-Path $outDir $_ }
)
Compress-Archive `
  -LiteralPath $paths `
  -DestinationPath $bundlePath `
  -CompressionLevel Optimal `
  -Force

$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Write-Host ''
Write-Host 'Work 规范化 dry-run 计划与打包完成' -ForegroundColor Green
Write-Host "AuditDirectory          : $AuditDirectory"
Write-Host "OutputDirectory         : $outDir"
Write-Host "Bundle                  : $bundlePath"
Write-Host "SHA256                  : $($bundleHash.Hash)"
Write-Host "HumanPlanRows           : $($summary.input.humanCandidateRows)"
Write-Host "HumanExplicitDecisions  : $($summary.explicitHumanDecisionRows)"
Write-Host "HumanAutomaticCopyRows  : $($summary.automaticHumanCopyRows)"
Write-Host "RankPlanRows            : $($summary.input.rankCandidateRows)"
Write-Host "PublicAIReviewCandidates: $($summary.publicAIReviewCandidateRows)"
Write-Host ''
Write-Host 'DatabaseWrite           : False'
Write-Host 'PayloadWrite            : False'
Write-Host 'MigrationGeneration     : False'
Write-Host 'SchemaPush              : False'
Write-Host 'ExecutableUpdateSQL     : False'
