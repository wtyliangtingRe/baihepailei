param(
  [Parameter(Mandatory = $true)][string]$DryRunDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

$sourceDir = [System.IO.Path]::GetFullPath($DryRunDirectory)
if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
  throw "找不到 v01 dry-run 目录：$sourceDir"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\work-normalization-dryrun-v02-$stamp"
$bundlePath = Join-Path $repoRoot "exports\WORK-NORMALIZATION-DRYRUN-V02-$stamp.zip"
$planner = Join-Path $PSScriptRoot 'refine-work-normalization-dryrun-v02.mjs'
$sanitizedInput = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  ("work-normalization-dryrun-v02-input-" + [Guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Path $sanitizedInput -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceDir '*') -Destination $sanitizedInput -Force

# v01 SQL contains explanatory comments such as "does not UPDATE / DROP".
# The semantic planner scans SQL keywords fail-closed, so remove only full-line
# comments from a temporary copy. SQL statements and the original audit package
# remain unchanged.
foreach ($sqlName in @(
  'phase1-human-normalization-dryrun.sql',
  'schema-retirement-dryrun.sql'
)) {
  $sqlPath = Join-Path $sanitizedInput $sqlName
  $sql = Get-Content -LiteralPath $sqlPath -Raw -Encoding UTF8
  $sql = [regex]::Replace($sql, '(?m)^\s*--.*(?:\r?\n|$)', '')
  [System.IO.File]::WriteAllText(
    $sqlPath,
    $sql,
    [System.Text.UTF8Encoding]::new($false)
  )
}

$sanitizedManifest = @(
  Get-ChildItem -LiteralPath $sanitizedInput -File |
    Where-Object Name -ne 'manifest.json' |
    Sort-Object Name |
    ForEach-Object {
      $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
      [pscustomobject]@{
        file = $_.Name
        bytes = $_.Length
        sha256 = $hash.Hash.ToLowerInvariant()
      }
    }
)
[System.IO.File]::WriteAllText(
  (Join-Path $sanitizedInput 'manifest.json'),
  (($sanitizedManifest | ConvertTo-Json -Depth 10) + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)

$plannerExitCode = 1
try {
  node $planner `
    --dryrun-dir $sanitizedInput `
    --output-dir $outDir
  $plannerExitCode = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $sanitizedInput -Recurse -Force -ErrorAction SilentlyContinue
}

if ($plannerExitCode -ne 0) {
  throw 'Work 规范化 dry-run v02 语义校正失败。'
}

$requiredFiles = @(
  'human-normalization-plan-v02.jsonl',
  'rank-preservation-plan-v02.jsonl',
  'public-ai-review-candidates-v02.jsonl',
  'nonpublic-assessment-preservation.jsonl',
  'canonical-identity-review-alerts.jsonl',
  'schema-retirement-plan.json',
  'phase1-human-normalization-dryrun-v02.sql',
  'schema-retirement-dryrun-v02.sql',
  'normalization-summary-v02.json',
  'manifest.json'
)

$missing = @(
  $requiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $outDir $_))
  }
)
if ($missing.Count -gt 0) {
  throw "v02 输出不完整：$($missing -join ', ')"
}

$summary = Get-Content `
  -LiteralPath (Join-Path $outDir 'normalization-summary-v02.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 30

if ($summary.semanticCorrections.nonPublicPrecedence -ne $true) {
  throw '非公开记录优先拦截未生效。'
}
if ($summary.semanticCorrections.canonicalIdentityGate -ne $true) {
  throw 'canonical identity gate 未生效。'
}
if ($summary.semanticCorrections.typedTimestampComparison -ne $true) {
  throw 'timestamptz 类型比较修正未生效。'
}
if ($summary.safety.executableUpdateSqlGenerated -ne $false) {
  throw 'v02 意外声明生成了可执行 UPDATE SQL。'
}

$sqlFiles = @(
  Join-Path $outDir 'phase1-human-normalization-dryrun-v02.sql'
  Join-Path $outDir 'schema-retirement-dryrun-v02.sql'
)
foreach ($sqlFile in $sqlFiles) {
  $sql = Get-Content -LiteralPath $sqlFile -Raw -Encoding UTF8
  if ($sql -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE\s+TABLE)\b') {
    throw "只读 SQL 中发现写入或 DDL：$sqlFile"
  }
  if ($sql -notmatch 'BEGIN TRANSACTION READ ONLY;' -or $sql -notmatch 'ROLLBACK;') {
    throw "SQL 缺少只读事务保护：$sqlFile"
  }
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
Write-Host 'Work 规范化 dry-run v02 校正与打包完成' -ForegroundColor Green
Write-Host "SourceDirectory          : $sourceDir"
Write-Host "OutputDirectory          : $outDir"
Write-Host "Bundle                   : $bundlePath"
Write-Host "SHA256                   : $($bundleHash.Hash)"
Write-Host "PublicAIReviewCandidates : $($summary.publicAIReviewCandidateRows)"
Write-Host "NonPublicPreservedRows   : $($summary.nonPublicPreservedRows)"
Write-Host "HumanIdentityGateRows    : $($summary.humanIdentityGateRows)"
Write-Host "IdentityAlertGroups      : $($summary.identityAlertGroups)"
Write-Host ''
Write-Host 'DatabaseWrite            : False'
Write-Host 'PayloadWrite             : False'
Write-Host 'MigrationGeneration      : False'
Write-Host 'SchemaPush               : False'
Write-Host 'ExecutableUpdateSQL      : False'
