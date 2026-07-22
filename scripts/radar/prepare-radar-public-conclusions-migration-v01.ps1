param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$BaselineMigrationName = 'current_schema_baseline_before_radar_public_v01'
$MigrationName = 'radar_public_conclusions_v01'
$MigrationDirectory = '.\src\migrations'
$RadarSchemaEnvName = 'RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY'
$AllowedLocalFiles = @('next-env.d.ts', 'payload-types.ts')

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host ''
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Label 失败（退出码 $LASTEXITCODE）"
  }
}

function Get-DirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path
  }
  return @($paths)
}

function Get-UnexpectedDirtyPaths {
  return @(Get-DirtyPaths | Where-Object { $AllowedLocalFiles -notcontains $_ })
}

function Get-MigrationArtifacts {
  return @(
    Get-ChildItem -LiteralPath $MigrationDirectory -File |
      Where-Object {
        $_.Name -ne 'index.ts' -and
        ($_.Extension -eq '.ts' -or $_.Extension -eq '.json')
      } |
      Select-Object -ExpandProperty FullName
  )
}

function Get-NewPaths {
  param(
    [Parameter(Mandatory = $true)][object[]]$Before,
    [Parameter(Mandatory = $true)][object[]]$After
  )

  return @($After | Where-Object { $Before -notcontains $_ })
}

function Get-GeneratedPair {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ExpectedName,
    [Parameter(Mandatory = $true)][object[]]$Before,
    [Parameter(Mandatory = $true)][object[]]$After
  )

  $newPaths = @(Get-NewPaths -Before $Before -After $After)
  $typeScriptFiles = @($newPaths | Where-Object { [System.IO.Path]::GetExtension([string]$_) -eq '.ts' })
  $snapshotFiles = @($newPaths | Where-Object { [System.IO.Path]::GetExtension([string]$_) -eq '.json' })

  if ($typeScriptFiles.Count -ne 1 -or $snapshotFiles.Count -ne 1) {
    $newPaths | ForEach-Object { Write-Host "$Label generated: $_" -ForegroundColor Yellow }
    throw "$Label 预期生成 1 个 TypeScript 和 1 个 JSON 快照。"
  }

  $typeScriptStem = [System.IO.Path]::GetFileNameWithoutExtension([string]$typeScriptFiles[0])
  $snapshotStem = [System.IO.Path]::GetFileNameWithoutExtension([string]$snapshotFiles[0])
  if ($typeScriptStem -ne $snapshotStem) {
    throw "$Label 的 TypeScript 与 JSON 快照名称不一致：$typeScriptStem / $snapshotStem"
  }
  if ($typeScriptStem -notmatch [regex]::Escape($ExpectedName)) {
    throw "$Label 文件名不包含预期名称：$typeScriptStem"
  }

  return [PSCustomObject]@{
    TypeScript = [string]$typeScriptFiles[0]
    Snapshot = [string]$snapshotFiles[0]
    Stem = $typeScriptStem
  }
}

function Invoke-WithRadarSchemaState {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('true', 'false')][string]$State,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  $hadOriginalValue = Test-Path "Env:$RadarSchemaEnvName"
  $originalValue = if ($hadOriginalValue) {
    [Environment]::GetEnvironmentVariable($RadarSchemaEnvName, 'Process')
  } else {
    $null
  }

  try {
    [Environment]::SetEnvironmentVariable($RadarSchemaEnvName, $State, 'Process')
    & $Action
  } finally {
    if ($hadOriginalValue) {
      [Environment]::SetEnvironmentVariable($RadarSchemaEnvName, $originalValue, 'Process')
    } else {
      [Environment]::SetEnvironmentVariable($RadarSchemaEnvName, $null, 'Process')
    }
  }
}

function Reset-GeneratedMigrationArtifacts {
  param([Parameter(Mandatory = $true)][object[]]$OriginalArtifacts)

  $currentArtifacts = @(Get-MigrationArtifacts)
  foreach ($path in @(Get-NewPaths -Before $OriginalArtifacts -After $currentArtifacts)) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force
    }
  }
  git restore --worktree -- 'src/migrations/index.ts' 2>$null
}

function Assert-RadarOnlyDDL {
  param([Parameter(Mandatory = $true)][string]$MigrationSource)

  $forbiddenPatterns = @(
    'ALTER TABLE\s+(?:"public"\.)?"works"',
    'DROP TABLE\s+(?:"public"\.)?"works"',
    'CREATE TABLE\s+(?:"public"\.)?"_works_v"',
    'ALTER TABLE\s+(?:"public"\.)?"_works_v"',
    'DROP TABLE\s+(?:"public"\.)?"_works_v"',
    'ALTER TABLE\s+(?:"public"\.)?"payload_locked_documents_rels"',
    'human_assessment_grade',
    'legacy_x_wiki_page'
  )
  foreach ($pattern in $forbiddenPatterns) {
    if ($MigrationSource -match $pattern) {
      throw "Radar 迁移混入了既有结构变更：$pattern"
    }
  }

  if ($MigrationSource -notmatch 'CREATE TABLE\s+(?:"public"\.)?"radar_public"') {
    throw '生成的迁移没有包含缩短后的 radar_public 表结构。'
  }

  $tooLongEnumName = 'enum_radar_public_conclusions_radar_assessment_matched_rules_grade'
  if ($MigrationSource -match [regex]::Escape($tooLongEnumName)) {
    throw "生成的迁移仍包含超长 enum 标识符：$tooLongEnumName"
  }

  foreach ($match in [regex]::Matches($MigrationSource, '(?i)CREATE TABLE\s+(?:"public"\.)?"([^"]+)"')) {
    $tableName = $match.Groups[1].Value
    if (-not $tableName.StartsWith('radar_public', [System.StringComparison]::Ordinal)) {
      throw "Radar 迁移创建了非 Radar 表：$tableName"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)(?:ALTER|DROP) TABLE\s+(?:"public"\.)?"([^"]+)"')) {
    $tableName = $match.Groups[1].Value
    if (-not $tableName.StartsWith('radar_public', [System.StringComparison]::Ordinal)) {
      throw "Radar 迁移修改或删除了非 Radar 表：$tableName"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)CREATE TYPE\s+(?:"public"\.)?"([^"]+)"')) {
    $typeName = $match.Groups[1].Value
    if (-not $typeName.StartsWith('enum_radar_public', [System.StringComparison]::Ordinal)) {
      throw "Radar 迁移创建了非 Radar enum：$typeName"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)DROP TYPE\s+(?:"public"\.)?"([^"]+)"')) {
    $typeName = $match.Groups[1].Value
    if (-not $typeName.StartsWith('enum_radar_public', [System.StringComparison]::Ordinal)) {
      throw "Radar 迁移删除了非 Radar enum：$typeName"
    }
  }
}

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

$unexpectedBefore = @(Get-UnexpectedDirtyPaths)
if ($unexpectedBefore.Count -gt 0) {
  $unexpectedBefore | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '发现预期之外的本地修改；未开始生成迁移。'
}

Invoke-Checked '获取远端分支' { git fetch origin }
Invoke-Checked '切换公共结论分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新提交' { git pull --ff-only origin $ExpectedBranch }

$branch = (git branch --show-current).Trim()
if ($branch -ne $ExpectedBranch) {
  throw "当前分支不符合预期：$branch"
}

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $remoteHead) {
  throw "本地 HEAD 未与远端分支对齐：local=$localHead remote=$remoteHead"
}

Invoke-Checked '运行公共结论、展示与迁移基线回归测试' {
  node --test `
    '.\tests\radar-public-conclusions.test.mjs' `
    '.\tests\radar-public-migration-baseline.test.mjs' `
    '.\tests\radar-assessment-presentation.test.mjs'
}

Invoke-Checked '运行 TypeScript 静态检查' {
  pnpm exec tsc --noEmit
}

$beforeArtifacts = @(Get-MigrationArtifacts)

try {
  Invoke-WithRadarSchemaState -State 'false' -Action {
    Invoke-Checked '生成当前既有结构快照（自动回答重命名提示，不保留生成 SQL）' {
      pnpm payload migrate:create $BaselineMigrationName --force-accept-warning
    }
  }

  $afterBaselineArtifacts = @(Get-MigrationArtifacts)
  $baseline = Get-GeneratedPair `
    -Label '当前结构基线' `
    -ExpectedName $BaselineMigrationName `
    -Before $beforeArtifacts `
    -After $afterBaselineArtifacts

  $baselineSnapshotSource = Get-Content -LiteralPath $baseline.Snapshot -Raw -Encoding UTF8
  if ($baselineSnapshotSource -notmatch '"human_assessment_grade"') {
    throw '当前结构基线快照缺少 Works human_assessment_grade；不能把旧快照漂移伪装为已部署结构。'
  }
  if ($baselineSnapshotSource -notmatch '"public\.works"') {
    throw '当前结构基线快照缺少 public.works。'
  }
  if (
    $baselineSnapshotSource -match '"public\.radar_public"' -or
    $baselineSnapshotSource -match '"name"\s*:\s*"radar_public"'
  ) {
    throw '当前结构基线快照意外包含 radar_public；无法生成独立增量迁移。'
  }

  $baselineSource = @(
    "import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'",
    '',
    '/**',
    ' * Snapshot-only baseline for the schema already deployed before the independent',
    ' * Radar public conclusion collection. The adjacent JSON file is used only as',
    ' * the next Drizzle diff base. Running this migration must not alter any table,',
    ' * enum, index, constraint, or row.',
    ' */',
    'export async function up(_args: MigrateUpArgs): Promise<void> {',
    '  // Intentionally empty. Existing schema is recorded, never recreated.',
    '}',
    '',
    'export async function down(_args: MigrateDownArgs): Promise<void> {',
    '  // Intentionally empty. Existing schema must never be removed.',
    '}',
    ''
  ) -join "`n"
  [System.IO.File]::WriteAllText(
    $baseline.TypeScript,
    $baselineSource,
    [System.Text.UTF8Encoding]::new($false)
  )

  $writtenBaselineSource = Get-Content -LiteralPath $baseline.TypeScript -Raw -Encoding UTF8
  if ($writtenBaselineSource -match 'db\.execute|\bsql`|ALTER TABLE|CREATE TABLE|DROP TABLE') {
    throw '快照基线 TypeScript 仍包含可执行数据库结构语句。'
  }

  Invoke-WithRadarSchemaState -State 'true' -Action {
    Invoke-Checked '只生成独立 Radar 公共结论迁移（不执行 migrate）' {
      pnpm payload migrate:create $MigrationName --skip-empty
    }
  }

  $afterMigrationArtifacts = @(Get-MigrationArtifacts)
  $radarMigration = Get-GeneratedPair `
    -Label 'Radar 公共结论迁移' `
    -ExpectedName $MigrationName `
    -Before $afterBaselineArtifacts `
    -After $afterMigrationArtifacts

  $migrationSource = Get-Content -LiteralPath $radarMigration.TypeScript -Raw -Encoding UTF8
  $migrationSnapshotSource = Get-Content -LiteralPath $radarMigration.Snapshot -Raw -Encoding UTF8

  Assert-RadarOnlyDDL -MigrationSource $migrationSource

  if ($migrationSnapshotSource -notmatch '"public\.radar_public"') {
    throw 'Radar 迁移快照缺少 public.radar_public。'
  }
  if ($migrationSnapshotSource -notmatch '"human_assessment_grade"') {
    throw 'Radar 迁移快照丢失了既有 Works human_assessment_grade。'
  }

  $baselineTypeScriptName = [System.IO.Path]::GetFileName($baseline.TypeScript)
  $baselineSnapshotName = [System.IO.Path]::GetFileName($baseline.Snapshot)
  $radarTypeScriptName = [System.IO.Path]::GetFileName($radarMigration.TypeScript)
  $radarSnapshotName = [System.IO.Path]::GetFileName($radarMigration.Snapshot)

  $allowedGenerated = @(
    'src/migrations/index.ts',
    ('src/migrations/' + $baselineTypeScriptName),
    ('src/migrations/' + $baselineSnapshotName),
    ('src/migrations/' + $radarTypeScriptName),
    ('src/migrations/' + $radarSnapshotName)
  ) + $AllowedLocalFiles

  $unexpectedAfter = @(Get-DirtyPaths | Where-Object { $allowedGenerated -notcontains $_ })
  if ($unexpectedAfter.Count -gt 0) {
    $unexpectedAfter | ForEach-Object { Write-Host "unexpected generated change: $_" -ForegroundColor Yellow }
    throw '生成迁移后出现了预期之外的文件修改。'
  }

  Invoke-Checked '复跑公共结论、展示与迁移基线回归测试' {
    node --test `
      '.\tests\radar-public-conclusions.test.mjs' `
      '.\tests\radar-public-migration-baseline.test.mjs' `
      '.\tests\radar-assessment-presentation.test.mjs'
  }

  Invoke-Checked '复跑 TypeScript 静态检查' {
    pnpm exec tsc --noEmit
  }

  Invoke-Checked '检查补丁空白与冲突标记' { git diff --check }
} catch {
  Write-Host ''
  Write-Host '迁移准备失败，正在清理本轮生成的迁移文件。' -ForegroundColor Yellow
  Reset-GeneratedMigrationArtifacts -OriginalArtifacts $beforeArtifacts
  throw
}

Write-Host ''
Write-Host '快照基线与 Radar 迁移已生成，尚未执行数据库迁移' -ForegroundColor Green
Write-Host "BaselineMigration : $($baseline.TypeScript)"
Write-Host "BaselineSnapshot  : $($baseline.Snapshot)"
Write-Host "RadarMigration    : $($radarMigration.TypeScript)"
Write-Host "RadarSnapshot     : $($radarMigration.Snapshot)"
Write-Host 'DatabaseMigrate   : False'
Write-Host 'WorksSchemaWrite  : False'
Write-Host 'WorkDataWrite     : False'

if ($CommitAndPush) {
  Invoke-Checked '仅暂存快照基线与 Radar 迁移文件' {
    git add -- `
      'src/migrations/index.ts' `
      ("src/migrations/$baselineTypeScriptName") `
      ("src/migrations/$baselineSnapshotName") `
      ("src/migrations/$radarTypeScriptName") `
      ("src/migrations/$radarSnapshotName")
  }

  $staged = @(git diff --cached --name-only)
  $expectedStaged = @(
    'src/migrations/index.ts',
    "src/migrations/$baselineTypeScriptName",
    "src/migrations/$baselineSnapshotName",
    "src/migrations/$radarTypeScriptName",
    "src/migrations/$radarSnapshotName"
  ) | Sort-Object
  $actualStaged = @($staged | Sort-Object)
  if (($expectedStaged -join "`n") -ne ($actualStaged -join "`n")) {
    $actualStaged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
    throw '暂存区包含预期之外的文件；未提交。'
  }

  Invoke-Checked '提交快照基线与生成的 Radar 迁移' {
    git commit -m 'Add Radar public conclusions migration'
  }
  Invoke-Checked '推送生成的迁移' {
    git push origin $ExpectedBranch
  }

  Write-Host ''
  Write-Host '迁移提交已推送' -ForegroundColor Green
  Write-Host "Head: $((git rev-parse HEAD).Trim())"
}
