param(
  [Parameter(Mandatory = $true)][string]$IdentityAuditDirectory,
  [Parameter(Mandatory = $true)][string]$DryRunV02Directory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-RepoPath([string]$Value, [string]$Label) {
  if ([System.IO.Path]::IsPathRooted($Value)) {
    $candidate = [System.IO.Path]::GetFullPath($Value)
  } else {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    throw "找不到 $Label：$candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

$identityDir = Resolve-RepoPath $IdentityAuditDirectory 'canonical identity 审计目录'
$dryRunDir = Resolve-RepoPath $DryRunV02Directory 'merge dry-run v02 目录'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-merge-dryrun-v03-$stamp"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-MERGE-DRYRUN-V03-$stamp.zip"
$refiner = Join-Path $PSScriptRoot 'refine-test-work-merge-dryrun-v03.mjs'
$aliasRecorder = Join-Path $PSScriptRoot 'record-test-work-merge-alias-protection-v03.mjs'

& node $refiner `
  --identity-audit-dir $identityDir `
  --dryrun-v02-dir $dryRunDir `
  --output-dir $outDir
if ($LASTEXITCODE -ne 0) {
  throw 'Test Work merge dry-run v03 执行前校正失败。'
}

& node $aliasRecorder `
  --identity-audit-dir $identityDir `
  --output-dir $outDir
if ($LASTEXITCODE -ne 0) {
  throw 'Test Work merge-out 标题保护证据生成失败。'
}

$requiredFiles = @(
  'canonical-merge-decisions.json',
  'field-merge-plan.jsonl',
  'relation-merge-plan.jsonl',
  'test-assessment-cleanup-plan.jsonl',
  'feedback-test-cleanup-plan.jsonl',
  'version-preservation-plan.jsonl',
  'work-standardization-plan.jsonl',
  'alias-protection-evidence.jsonl',
  'exact-before-readonly.sql',
  'exact-before-expectations.json',
  'merge-preview-commented.sql',
  'merge-dryrun-summary.json',
  'merge-dryrun-summary.md',
  'manifest.json'
)
$missing = @(
  $requiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $outDir $_) -PathType Leaf)
  }
)
if ($missing.Count -gt 0) {
  throw "Test Work merge dry-run v03 输出不完整：$($missing -join ', ')"
}

$summary = Get-Content `
  -LiteralPath (Join-Path $outDir 'merge-dryrun-summary.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
if ($summary.schemaVersion -ne 3 -or
    $summary.semanticRefinementVersion -ne 3 -or
    $summary.exactBeforeAllChecksRequireTrue -ne $true -or
    $summary.searchTextOperationalNoiseFiltered -ne $true -or
    $summary.mergeOutTitleAliasProtected -ne $true -or
    $summary.mergeOutTitleAliasProtectionEvidence -ne $true) {
  throw 'v03 标准化、别名证据或 exact-before 门槛未生效。'
}
if ($summary.standardizationPlanRows -lt 1 -or
    $summary.mergeOutTitleAliasProtectionRows -lt 1 -or
    $summary.exactBeforeExactRowChecks -lt 1 -or
    $summary.exactBeforeRelationCountChecks -lt 1 -or
    $summary.exactBeforeVersionRelationCountChecks -lt 1) {
  throw 'v03 输出缺少标准化、别名证据或 exact-before 检查。'
}
if ($summary.safety.databaseWrite -ne $false -or
    $summary.safety.payloadWrite -ne $false -or
    $summary.safety.executableUpdateSqlGenerated -ne $false -or
    $summary.safety.canonicalDecisionApplied -ne $false -or
    $summary.safety.mergePerformed -ne $false -or
    $summary.safety.hardDeletePlanned -ne $false -or
    $summary.safety.versionRewritePlanned -ne $false) {
  throw 'Test Work merge dry-run v03 未证明安全边界。'
}

$standardizationRows = @(
  Get-Content `
    -LiteralPath (Join-Path $outDir 'work-standardization-plan.jsonl') `
    -Encoding UTF8 |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_ | ConvertFrom-Json -Depth 100 }
)
$validAliasActions = @(
  'add_merge_out_title_as_canonical_alias',
  'merge_out_title_already_present_on_canonical'
)
if (-not ($standardizationRows | Where-Object {
  $_.action -in $validAliasActions -and $_.value -eq 'Soukou no Strain'
})) {
  throw 'v03 未证明 Soukou no Strain 已存在或已列入新增别名计划。'
}
if (-not ($standardizationRows | Where-Object {
  $_.action -eq 'merge_clean_search_text_lines' -and
  $_.after -match 'Soukou no Strain' -and
  $_.after -match 'anilist:1602'
})) {
  throw 'v03 未生成 Strain 搜索词合并计划。'
}

$aliasEvidenceRows = @(
  Get-Content `
    -LiteralPath (Join-Path $outDir 'alias-protection-evidence.jsonl') `
    -Encoding UTF8 |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_ | ConvertFrom-Json -Depth 100 }
)
if (-not ($aliasEvidenceRows | Where-Object {
  $_.value -eq 'Soukou no Strain' -and
  $_.protected -eq $true -and
  $_.protectionMode -in @('already_present', 'planned_add')
})) {
  throw 'v03 缺少 Soukou no Strain 的可核验标题保护证据。'
}

$exactBefore = Get-Content `
  -LiteralPath (Join-Path $outDir 'exact-before-readonly.sql') `
  -Raw `
  -Encoding UTF8
if ($exactBefore -notmatch 'BEGIN TRANSACTION READ ONLY;' -or
    $exactBefore -notmatch 'AS matches' -or
    $exactBefore -notmatch 'exact_rows:public\.works' -or
    $exactBefore -notmatch 'relation_count:' -or
    $exactBefore -notmatch 'version_relation_count:' -or
    $exactBefore -notmatch 'ROLLBACK;') {
  throw 'v03 exact-before SQL 缺少完整只读匹配门槛。'
}
if ($exactBefore -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b') {
  throw 'v03 exact-before SQL 出现写入或 DDL。'
}

$preview = Get-Content `
  -LiteralPath (Join-Path $outDir 'merge-preview-commented.sql') `
  -Raw `
  -Encoding UTF8
$previewStatements = @(
  $preview -split '\r?\n' | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and $_ -notmatch '^\s*--'
  }
)
if ($previewStatements.Count -gt 0) {
  throw 'v03 merge 预览中存在未注释的可执行文本。'
}

$manifest = Get-Content `
  -LiteralPath (Join-Path $outDir 'manifest.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 30
foreach ($entry in @($manifest)) {
  $file = Join-Path $outDir ([string]$entry.file)
  $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
  $bytes = (Get-Item -LiteralPath $file).Length
  if ($bytes -ne [long]$entry.bytes) {
    throw "manifest 字节数不匹配：$($entry.file)"
  }
  if ($hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
    throw "manifest SHA-256 不匹配：$($entry.file)"
  }
}

$paths = @(
  Get-ChildItem -LiteralPath $outDir -File |
    Sort-Object Name |
    ForEach-Object FullName
)
Compress-Archive `
  -LiteralPath $paths `
  -DestinationPath $bundlePath `
  -CompressionLevel Optimal `
  -Force

$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Write-Host ''
Write-Host 'Test Work merge dry-run v03 与打包完成' -ForegroundColor Green
Write-Host "IdentityAuditDirectory   : $identityDir"
Write-Host "DryRunV02Directory       : $dryRunDir"
Write-Host "OutputDirectory          : $outDir"
Write-Host "Bundle                   : $bundlePath"
Write-Host "SHA256                   : $($bundleHash.Hash)"
Write-Host "StandardizationPlanRows  : $($summary.standardizationPlanRows)"
Write-Host "AliasProtectionRows      : $($summary.mergeOutTitleAliasProtectionRows)"
Write-Host "AliasAlreadyPresentRows  : $($summary.mergeOutTitleAliasAlreadyPresentRows)"
Write-Host "AliasPlannedAddRows       : $($summary.mergeOutTitleAliasPlannedAddRows)"
Write-Host "ExactRowChecks           : $($summary.exactBeforeExactRowChecks)"
Write-Host "RelationCountChecks      : $($summary.exactBeforeRelationCountChecks)"
Write-Host "VersionRelationChecks    : $($summary.exactBeforeVersionRelationCountChecks)"
Write-Host 'AllChecksRequireTrue     : True'
Write-Host 'MergeOutTitleAlias       : Protected'
Write-Host 'SearchTextNoiseFiltered  : True'
Write-Host ''
Write-Host 'DatabaseWrite            : False'
Write-Host 'PayloadWrite             : False'
Write-Host 'ExecutableUpdateSQL      : False'
Write-Host 'CanonicalDecisionApplied : False'
Write-Host 'MergePerformed           : False'
Write-Host 'HardDeletePlanned        : False'
Write-Host 'VersionRewritePlanned    : False'
