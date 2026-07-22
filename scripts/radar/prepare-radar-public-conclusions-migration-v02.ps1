param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-conclusions-v01'
$BaselineMigrationName = 'current_schema_baseline_before_radar_public_v01'
$MigrationName = 'radar_public_conclusions_v01'
$RepositoryMigrationDirectory = '.\src\migrations'
$RadarSchemaEnvName = 'RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY'
$PayloadConfigEnvName = 'PAYLOAD_CONFIG_PATH'
$PayloadMigrationDirEnvName = 'PAYLOAD_MIGRATION_DIR'
$AllowedLocalFiles = @('next-env.d.ts', 'payload-types.ts')
$TemporaryConfigName = '.payload-radar-migration-temp.config.ts'

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
  param([Parameter(Mandatory = $true)][string]$Directory)

  if (-not (Test-Path -LiteralPath $Directory)) { return @() }
  return @(
    Get-ChildItem -LiteralPath $Directory -File |
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

function Invoke-WithProcessEnvironment {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Variables,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  $saved = @{}
  foreach ($name in $Variables.Keys) {
    $saved[$name] = [PSCustomObject]@{
      Exists = Test-Path "Env:$name"
      Value = [Environment]::GetEnvironmentVariable([string]$name, 'Process')
    }
  }

  try {
    foreach ($name in $Variables.Keys) {
      [Environment]::SetEnvironmentVariable([string]$name, [string]$Variables[$name], 'Process')
    }
    & $Action
  } finally {
    foreach ($name in $Variables.Keys) {
      if ($saved[$name].Exists) {
        [Environment]::SetEnvironmentVariable([string]$name, [string]$saved[$name].Value, 'Process')
      } else {
        [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process')
      }
    }
  }
}

function Write-IsolatedPayloadConfig {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  $source = Get-Content -LiteralPath $SourcePath -Raw -Encoding UTF8
  $anchor = '  db: postgresAdapter({' 
  $matches = [regex]::Matches($source, [regex]::Escape($anchor))
  if ($matches.Count -ne 1) {
    throw "无法唯一定位 postgresAdapter 配置：$($matches.Count)"
  }

  $replacement = @(
    '  db: postgresAdapter({',
    "    migrationDir: String(process.env['$PayloadMigrationDirEnvName'] || ''),"
  ) -join "`n"
  $isolated = $source.Replace($anchor, $replacement)
  [System.IO.File]::WriteAllText(
    $DestinationPath,
    $isolated,
    [System.Text.UTF8Encoding]::new($false)
  )

  $written = Get-Content -LiteralPath $DestinationPath -Raw -Encoding UTF8
  if ($written -notmatch [regex]::Escape($PayloadMigrationDirEnvName)) {
    throw '隔离 Payload 配置没有写入临时 migrationDir。'
  }
}

function Reset-GeneratedRepositoryArtifacts {
  param([Parameter(Mandatory = $true)][object[]]$OriginalArtifacts)

  $currentArtifacts = @(Get-MigrationArtifacts -Directory $RepositoryMigrationDirectory)
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

$repositoryRoot = (Get-Location).Path
$payloadConfigPath = Join-Path $repositoryRoot 'payload.config.ts'
$temporaryConfigPath = Join-Path $repositoryRoot $TemporaryConfigName
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("baihepailei-radar-migration-" + [guid]::NewGuid().ToString('N'))
$temporaryMigrationDirectory = Join-Path $temporaryRoot 'migrations'
$repositoryMigrationPath = (Resolve-Path $RepositoryMigrationDirectory).Path

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

$beforeRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
New-Item -ItemType Directory -Path $temporaryMigrationDirectory -Force | Out-Null

try {
  Write-IsolatedPayloadConfig `
    -SourcePath $payloadConfigPath `
    -DestinationPath $temporaryConfigPath

  $beforeTemporaryArtifacts = @(Get-MigrationArtifacts -Directory $temporaryMigrationDirectory)
  Invoke-WithProcessEnvironment -Variables @{
    $PayloadConfigEnvName = $temporaryConfigPath
    $PayloadMigrationDirEnvName = $temporaryMigrationDirectory
    $RadarSchemaEnvName = 'false'
  } -Action {
    Invoke-Checked '在空临时目录生成当前结构快照（不会触发旧列重命名判断）' {
      pnpm payload migrate:create $BaselineMigrationName --force-accept-warning
    }
  }

  $afterTemporaryArtifacts = @(Get-MigrationArtifacts -Directory $temporaryMigrationDirectory)
  $temporaryBaseline = Get-GeneratedPair `
    -Label '隔离的当前结构基线' `
    -ExpectedName $BaselineMigrationName `
    -Before $beforeTemporaryArtifacts `
    -After $afterTemporaryArtifacts

  $baselineSnapshotSource = Get-Content -LiteralPath $temporaryBaseline.Snapshot -Raw -Encoding UTF8
  if ($baselineSnapshotSource -notmatch '"human_assessment_grade"') {
    throw '当前结构基线快照缺少 Works human_assessment_grade。'
  }
  if ($baselineSnapshotSource -notmatch '"public\.works"') {
    throw '当前结构基线快照缺少 public.works。'
  }
  if (
    $baselineSnapshotSource -match '"public\.radar_public"' -or
    $baselineSnapshotSource -match '"name"\s*:\s*"radar_public"'
  ) {
    throw '隔离基线快照意外包含 radar_public。'
  }

  $baselineTypeScriptName = [System.IO.Path]::GetFileName($temporaryBaseline.TypeScript)
  $baselineSnapshotName = [System.IO.Path]::GetFileName($temporaryBaseline.Snapshot)
  $baselineTypeScriptPath = Join-Path $repositoryMigrationPath $baselineTypeScriptName
  $baselineSnapshotPath = Join-Path $repositoryMigrationPath $baselineSnapshotName

  Copy-Item -LiteralPath $temporaryBaseline.Snapshot -Destination $baselineSnapshotPath

  $baselineSource = @(
    "import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'",
    '',
    '/**',
    ' * Snapshot-only baseline generated in an isolated empty migration directory.',
    ' * The adjacent JSON records the already-deployed schema for the next diff.',
    ' * Running this migration must not alter any table, enum, index, constraint, or row.',
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
    $baselineTypeScriptPath,
    $baselineSource,
    [System.Text.UTF8Encoding]::new($false)
  )

  $writtenBaselineSource = Get-Content -LiteralPath $baselineTypeScriptPath -Raw -Encoding UTF8
  if ($writtenBaselineSource -match 'db\.execute|\bsql`|ALTER TABLE|CREATE TABLE|DROP TABLE') {
    throw '快照基线 TypeScript 仍包含可执行数据库结构语句。'
  }

  $afterBaselineRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
  $baseline = Get-GeneratedPair `
    -Label '仓库当前结构基线' `
    -ExpectedName $BaselineMigrationName `
    -Before $beforeRepositoryArtifacts `
    -After $afterBaselineRepositoryArtifacts

  if (Test-Path -LiteralPath $temporaryConfigPath) {
    Remove-Item -LiteralPath $temporaryConfigPath -Force
  }

  Invoke-WithProcessEnvironment -Variables @{
    $PayloadConfigEnvName = $payloadConfigPath
    $RadarSchemaEnvName = 'true'
  } -Action {
    Invoke-Checked '只生成独立 Radar 公共结论迁移（不执行 migrate）' {
      pnpm payload migrate:create $MigrationName --skip-empty
    }
  }

  $afterMigrationRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
  $radarMigration = Get-GeneratedPair `
    -Label 'Radar 公共结论迁移' `
    -ExpectedName $MigrationName `
    -Before $afterBaselineRepositoryArtifacts `
    -After $afterMigrationRepositoryArtifacts

  $migrationSource = Get-Content -LiteralPath $radarMigration.TypeScript -Raw -Encoding UTF8
  $migrationSnapshotSource = Get-Content -LiteralPath $radarMigration.Snapshot -Raw -Encoding UTF8
  Assert-RadarOnlyDDL -MigrationSource $migrationSource

  if ($migrationSnapshotSource -notmatch '"public\.radar_public"') {
    throw 'Radar 迁移快照缺少 public.radar_public。'
  }
  if ($migrationSnapshotSource -notmatch '"human_assessment_grade"') {
    throw 'Radar 迁移快照丢失了既有 Works human_assessment_grade。'
  }

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
  Reset-GeneratedRepositoryArtifacts -OriginalArtifacts $beforeRepositoryArtifacts
  throw
} finally {
  if (Test-Path -LiteralPath $temporaryConfigPath) {
    Remove-Item -LiteralPath $temporaryConfigPath -Force
  }
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}

Write-Host ''
Write-Host '隔离基线与 Radar 迁移已生成，尚未执行数据库迁移' -ForegroundColor Green
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
