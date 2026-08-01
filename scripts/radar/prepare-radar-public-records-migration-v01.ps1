param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-records-migration-v01'
$BaselineMigrationName = 'current_schema_baseline_before_radar_public_records_v01'
$MigrationName = 'radar_public_records_v01'
$RepositoryMigrationDirectory = '.\src\migrations'
$PayloadConfigPath = '.\payload.config.ts'
$EnvExamplePath = '.\.env.example'
$AllowedLocalFiles = @('next-env.d.ts', 'payload-types.ts')
$ReadOnlyPgOptions = '-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning'

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
    $paths += $path.Replace('\', '/')
  }
  return @($paths)
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
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After
  )

  return @($After | Where-Object { $Before -notcontains $_ })
}

function Get-GeneratedPair {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ExpectedName,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After
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

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Ensure-PayloadRegistration {
  param([Parameter(Mandatory = $true)][string]$Path)

  $source = (Get-Content -LiteralPath $Path -Raw -Encoding UTF8).Replace("`r`n", "`n")

  if ($source -notmatch "RadarPublicRecords") {
    $importAnchor = "import { RadarPublicConclusions } from './src/collections/RadarPublicConclusions'"
    if (-not $source.Contains($importAnchor)) { throw '无法定位 RadarPublicConclusions import。' }
    $source = $source.Replace(
      $importAnchor,
      $importAnchor + "`nimport { RadarPublicRecords } from './src/collections/RadarPublicRecords'"
    )
  }

  if ($source -notmatch 'RADAR_PUBLIC_RECORDS_SCHEMA_READY') {
    $flagAnchor = "const radarPublicConclusionsSchemaReady = String(process.env['RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY'] || 'true').toLowerCase() !== 'false'"
    if (-not $source.Contains($flagAnchor)) { throw '无法定位 Radar public conclusions schema flag。' }
    $source = $source.Replace(
      $flagAnchor,
      $flagAnchor + "`n/** Radar public records stay optional only during isolated migration snapshot generation. */`nconst radarPublicRecordsSchemaReady = String(process.env['RADAR_PUBLIC_RECORDS_SCHEMA_READY'] || 'true').toLowerCase() !== 'false'"
    )
  }

  if ($source -notmatch 'RadarPublicRecordsWithAudit') {
    $auditAnchor = "const RadarPublicConclusionsWithAudit = withContentAudit(RadarPublicConclusions, 'radar-public-conclusions')"
    if (-not $source.Contains($auditAnchor)) { throw '无法定位 RadarPublicConclusionsWithAudit。' }
    $source = $source.Replace(
      $auditAnchor,
      $auditAnchor + "`nconst RadarPublicRecordsWithAudit = withContentAudit(RadarPublicRecords, 'radar-public-records')"
    )
  }

  $collectionRegistration = "    ...(radarPublicRecordsSchemaReady ? [RadarPublicRecordsWithAudit] : []),"
  if (-not $source.Contains($collectionRegistration)) {
    $collectionAnchor = "    ...(radarPublicConclusionsSchemaReady ? [RadarPublicConclusionsWithAudit] : []),"
    if (-not $source.Contains($collectionAnchor)) { throw '无法定位 Radar public conclusions collection registration。' }
    $source = $source.Replace(
      $collectionAnchor,
      $collectionAnchor + "`n" + $collectionRegistration
    )
  }

  Write-Utf8NoBom -Path $Path -Content $source

  $written = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  foreach ($required in @(
    "import { RadarPublicRecords } from './src/collections/RadarPublicRecords'",
    'RADAR_PUBLIC_RECORDS_SCHEMA_READY',
    'RadarPublicRecordsWithAudit',
    'radarPublicRecordsSchemaReady ? [RadarPublicRecordsWithAudit]'
  )) {
    if ($written -notmatch [regex]::Escape($required)) {
      throw "Payload config 缺少注册片段：$required"
    }
  }
}

function Ensure-EnvironmentDocumentation {
  param([Parameter(Mandatory = $true)][string]$Path)

  $source = (Get-Content -LiteralPath $Path -Raw -Encoding UTF8).Replace("`r`n", "`n")
  if ($source -notmatch '(?m)^RADAR_PUBLIC_RECORDS_SCHEMA_READY=') {
    $source = $source.TrimEnd("`n") + @"


# Existing deployments keep Radar public records enabled after the additive migration.
# Set false only in the isolated migration snapshot preparer.
RADAR_PUBLIC_RECORDS_SCHEMA_READY=true
"@
  }
  Write-Utf8NoBom -Path $Path -Content $source
}

function Write-IsolatedPayloadConfig {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  $source = (Get-Content -LiteralPath $SourcePath -Raw -Encoding UTF8).Replace("`r`n", "`n")
  $dbPattern = '(?m)^  db: postgresAdapter\(\{\s*$'
  if ([regex]::Matches($source, $dbPattern).Count -ne 1) {
    throw '无法唯一定位 postgresAdapter 配置。'
  }
  $isolated = [regex]::Replace(
    $source,
    $dbPattern,
    "  db: postgresAdapter({`n    migrationDir: String(process.env['PAYLOAD_MIGRATION_DIR'] || ''),",
    1
  )

  $poolPattern = '(?m)^    pool: \{\s*$'
  if ([regex]::Matches($isolated, $poolPattern).Count -ne 1) {
    throw '无法唯一定位 PostgreSQL pool 配置。'
  }
  $isolated = [regex]::Replace(
    $isolated,
    $poolPattern,
    "    pool: {`n      options: '$ReadOnlyPgOptions',",
    1
  )

  Write-Utf8NoBom -Path $DestinationPath -Content $isolated

  $written = Get-Content -LiteralPath $DestinationPath -Raw -Encoding UTF8
  if ($written -notmatch 'PAYLOAD_MIGRATION_DIR' -or $written -notmatch 'default_transaction_read_only=on') {
    throw '隔离 Payload 配置缺少 migrationDir 或只读 PostgreSQL 选项。'
  }
}

function Assert-RecordsOnlyDDL {
  param([Parameter(Mandatory = $true)][string]$MigrationSource)

  $forbiddenPatterns = @(
    'ALTER TABLE\s+(?:"public"\.)?"works"',
    'DROP TABLE\s+(?:"public"\.)?"works"',
    'CREATE TABLE\s+(?:"public"\.)?"_works_v"',
    'ALTER TABLE\s+(?:"public"\.)?"_works_v"',
    'DROP TABLE\s+(?:"public"\.)?"_works_v"',
    'ALTER TABLE\s+(?:"public"\.)?"radar_public"(?:\s|`)',
    'DROP TABLE\s+(?:"public"\.)?"radar_public"(?:\s|`)',
    'ALTER TABLE\s+(?:"public"\.)?"payload_locked_documents_rels"',
    'human_assessment_grade',
    'legacy_x_wiki_page'
  )
  foreach ($pattern in $forbiddenPatterns) {
    if ($MigrationSource -match $pattern) {
      throw "公开研究记录迁移混入既有结构变更：$pattern"
    }
  }

  if ($MigrationSource -notmatch 'CREATE TABLE\s+(?:"public"\.)?"radar_public_records"') {
    throw '生成的迁移没有包含 radar_public_records 主表。'
  }

  foreach ($match in [regex]::Matches($MigrationSource, '(?i)CREATE TABLE\s+(?:"public"\.)?"([^"]+)"')) {
    if (-not $match.Groups[1].Value.StartsWith('radar_public_records', [System.StringComparison]::Ordinal)) {
      throw "迁移创建了非 radar_public_records 表：$($match.Groups[1].Value)"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)(?:ALTER|DROP) TABLE\s+(?:"public"\.)?"([^"]+)"')) {
    if (-not $match.Groups[1].Value.StartsWith('radar_public_records', [System.StringComparison]::Ordinal)) {
      throw "迁移修改或删除了非 radar_public_records 表：$($match.Groups[1].Value)"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)CREATE TYPE\s+(?:"public"\.)?"([^"]+)"')) {
    if (-not $match.Groups[1].Value.StartsWith('enum_radar_public_records', [System.StringComparison]::Ordinal)) {
      throw "迁移创建了非 radar_public_records enum：$($match.Groups[1].Value)"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)DROP TYPE\s+(?:"public"\.)?"([^"]+)"')) {
    if (-not $match.Groups[1].Value.StartsWith('enum_radar_public_records', [System.StringComparison]::Ordinal)) {
      throw "迁移删除了非 radar_public_records enum：$($match.Groups[1].Value)"
    }
  }
}

function Reset-GeneratedChanges {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$OriginalArtifacts,
    [Parameter(Mandatory = $true)][string]$OriginalPayloadConfig,
    [Parameter(Mandatory = $true)][string]$OriginalEnvExample
  )

  foreach ($path in @(Get-NewPaths -Before $OriginalArtifacts -After @(Get-MigrationArtifacts -Directory $RepositoryMigrationDirectory))) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
  Write-Utf8NoBom -Path $PayloadConfigPath -Content $OriginalPayloadConfig
  Write-Utf8NoBom -Path $EnvExamplePath -Content $OriginalEnvExample
  git restore --worktree -- 'src/migrations/index.ts' 2>$null
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repositoryRoot
$repositoryMigrationPath = (Resolve-Path $RepositoryMigrationDirectory).Path
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('baihepailei-radar-public-records-migration-' + [guid]::NewGuid().ToString('N'))
$temporaryMigrationDirectory = Join-Path $temporaryRoot 'migrations'
$temporaryConfigPath = Join-Path $repositoryRoot ('.payload-radar-public-records-temp-' + [guid]::NewGuid().ToString('N') + '.config.ts')

$unexpectedBefore = @(Get-DirtyPaths | Where-Object { $AllowedLocalFiles -notcontains $_ })
if ($unexpectedBefore.Count -gt 0) {
  $unexpectedBefore | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '发现预期之外的本地修改；未开始生成迁移。'
}

Invoke-Checked '获取远端分支' { git fetch origin }
Invoke-Checked '切换 Radar public records 迁移分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新提交' { git pull --ff-only origin $ExpectedBranch }

$branch = (git branch --show-current).Trim()
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($branch -ne $ExpectedBranch -or $localHead -ne $remoteHead) {
  throw "分支或 HEAD 不符合预期：branch=$branch local=$localHead remote=$remoteHead"
}

Invoke-Checked '运行 Public Release、schema 与 planner 测试' {
  node --test `
    '.\tests\radar-public-release-v01.test.mjs' `
    '.\tests\radar-public-records-schema.test.mjs' `
    '.\tests\radar-public-release-plan-v01.test.mjs' `
    '.\tests\radar-public-records-migration-preparation.test.mjs'
}
Invoke-Checked '运行 TypeScript 静态检查' { pnpm exec tsc --noEmit }

$originalPayloadConfig = (Get-Content -LiteralPath $PayloadConfigPath -Raw -Encoding UTF8).Replace("`r`n", "`n")
$originalEnvExample = (Get-Content -LiteralPath $EnvExamplePath -Raw -Encoding UTF8).Replace("`r`n", "`n")
$beforeRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
New-Item -ItemType Directory -Path $temporaryMigrationDirectory -Force | Out-Null

try {
  Ensure-PayloadRegistration -Path $PayloadConfigPath
  Ensure-EnvironmentDocumentation -Path $EnvExamplePath
  Write-IsolatedPayloadConfig -SourcePath $PayloadConfigPath -DestinationPath $temporaryConfigPath

  $beforeTemporaryArtifacts = @(Get-MigrationArtifacts -Directory $temporaryMigrationDirectory)
  Invoke-WithProcessEnvironment -Variables @{
    PAYLOAD_CONFIG_PATH = $temporaryConfigPath
    PAYLOAD_MIGRATION_DIR = $temporaryMigrationDirectory
    PAYLOAD_DB_PUSH = 'false'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'false'
    PGOPTIONS = $ReadOnlyPgOptions
  } -Action {
    Invoke-Checked '在空临时目录生成当前结构快照' {
      pnpm payload migrate:create $BaselineMigrationName --force-accept-warning
    }
  }

  $temporaryBaseline = Get-GeneratedPair `
    -Label '隔离的当前结构基线' `
    -ExpectedName $BaselineMigrationName `
    -Before $beforeTemporaryArtifacts `
    -After @(Get-MigrationArtifacts -Directory $temporaryMigrationDirectory)

  $baselineSnapshotSource = Get-Content -LiteralPath $temporaryBaseline.Snapshot -Raw -Encoding UTF8
  if ($baselineSnapshotSource -notmatch '"public\.works"' -or $baselineSnapshotSource -notmatch '"public\.radar_public"') {
    throw '当前结构基线快照缺少 Works 或既有 radar_public。'
  }
  if ($baselineSnapshotSource -match '"public\.radar_public_records"' -or $baselineSnapshotSource -match '"name"\s*:\s*"radar_public_records"') {
    throw '隔离基线快照意外包含 radar_public_records。'
  }

  $baselineTypeScriptName = [System.IO.Path]::GetFileName($temporaryBaseline.TypeScript)
  $baselineSnapshotName = [System.IO.Path]::GetFileName($temporaryBaseline.Snapshot)
  $baselineTypeScriptPath = Join-Path $repositoryMigrationPath $baselineTypeScriptName
  $baselineSnapshotPath = Join-Path $repositoryMigrationPath $baselineSnapshotName
  Copy-Item -LiteralPath $temporaryBaseline.Snapshot -Destination $baselineSnapshotPath

  $baselineSource = @(
    "import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'",
    '',
    '/** Snapshot-only baseline. Running this migration intentionally changes nothing. */',
    'export async function up(_args: MigrateUpArgs): Promise<void> {}',
    'export async function down(_args: MigrateDownArgs): Promise<void> {}',
    ''
  ) -join "`n"
  Write-Utf8NoBom -Path $baselineTypeScriptPath -Content $baselineSource

  $afterBaselineRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
  $baseline = Get-GeneratedPair `
    -Label '仓库当前结构基线' `
    -ExpectedName $BaselineMigrationName `
    -Before $beforeRepositoryArtifacts `
    -After $afterBaselineRepositoryArtifacts

  Invoke-WithProcessEnvironment -Variables @{
    PAYLOAD_CONFIG_PATH = $temporaryConfigPath
    PAYLOAD_MIGRATION_DIR = $repositoryMigrationPath
    PAYLOAD_DB_PUSH = 'false'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    PGOPTIONS = $ReadOnlyPgOptions
  } -Action {
    Invoke-Checked '只生成 Radar public records 加法迁移（不执行 migrate）' {
      pnpm payload migrate:create $MigrationName --skip-empty
    }
  }

  $afterMigrationRepositoryArtifacts = @(Get-MigrationArtifacts -Directory $repositoryMigrationPath)
  $recordsMigration = Get-GeneratedPair `
    -Label 'Radar public records 迁移' `
    -ExpectedName $MigrationName `
    -Before $afterBaselineRepositoryArtifacts `
    -After $afterMigrationRepositoryArtifacts

  $migrationSource = Get-Content -LiteralPath $recordsMigration.TypeScript -Raw -Encoding UTF8
  $migrationSnapshotSource = Get-Content -LiteralPath $recordsMigration.Snapshot -Raw -Encoding UTF8
  Assert-RecordsOnlyDDL -MigrationSource $migrationSource
  if ($migrationSnapshotSource -notmatch '"public\.radar_public_records"' -or $migrationSnapshotSource -notmatch '"public\.radar_public"') {
    throw 'Radar public records 迁移快照不完整。'
  }

  $recordsTypeScriptName = [System.IO.Path]::GetFileName($recordsMigration.TypeScript)
  $recordsSnapshotName = [System.IO.Path]::GetFileName($recordsMigration.Snapshot)
  $allowedGenerated = @(
    'payload.config.ts',
    '.env.example',
    'src/migrations/index.ts',
    ('src/migrations/' + $baselineTypeScriptName),
    ('src/migrations/' + $baselineSnapshotName),
    ('src/migrations/' + $recordsTypeScriptName),
    ('src/migrations/' + $recordsSnapshotName)
  ) + $AllowedLocalFiles
  $unexpectedAfter = @(Get-DirtyPaths | Where-Object { $allowedGenerated -notcontains $_ })
  if ($unexpectedAfter.Count -gt 0) {
    $unexpectedAfter | ForEach-Object { Write-Host "unexpected generated change: $_" -ForegroundColor Yellow }
    throw '生成迁移后出现了预期之外的文件修改。'
  }

  Invoke-Checked '复跑 Public Release、schema、planner 与迁移测试' {
    node --test `
      '.\tests\radar-public-release-v01.test.mjs' `
      '.\tests\radar-public-records-schema.test.mjs' `
      '.\tests\radar-public-release-plan-v01.test.mjs' `
      '.\tests\radar-public-records-migration-preparation.test.mjs'
  }
  Invoke-Checked '复跑 TypeScript 静态检查' { pnpm exec tsc --noEmit }
  Invoke-Checked '检查补丁空白与冲突标记' { git diff --check }
} catch {
  Write-Host ''
  Write-Host '迁移准备失败，正在恢复 Payload 配置并清理本轮生成文件。' -ForegroundColor Yellow
  Reset-GeneratedChanges `
    -OriginalArtifacts $beforeRepositoryArtifacts `
    -OriginalPayloadConfig $originalPayloadConfig `
    -OriginalEnvExample $originalEnvExample
  throw
} finally {
  Remove-Item -LiteralPath $temporaryConfigPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Radar public records 配置、只读基线与加法迁移已生成；尚未执行数据库迁移。' -ForegroundColor Green
Write-Host "BaselineMigration : $($baseline.TypeScript)"
Write-Host "BaselineSnapshot  : $($baseline.Snapshot)"
Write-Host "RecordsMigration  : $($recordsMigration.TypeScript)"
Write-Host "RecordsSnapshot   : $($recordsMigration.Snapshot)"
Write-Host 'PostgreSQLSession : ReadOnly'
Write-Host 'DatabaseMigrate   : False'
Write-Host 'PayloadWrite      : False'
Write-Host 'WorksMutation     : False'
Write-Host 'PublicRecordWrite : False'

if ($CommitAndPush) {
  Invoke-Checked '仅暂存配置、环境说明、基线与 Radar public records 迁移' {
    git add -- `
      'payload.config.ts' `
      '.env.example' `
      'src/migrations/index.ts' `
      ("src/migrations/$baselineTypeScriptName") `
      ("src/migrations/$baselineSnapshotName") `
      ("src/migrations/$recordsTypeScriptName") `
      ("src/migrations/$recordsSnapshotName")
  }

  $expectedStaged = @(
    '.env.example',
    'payload.config.ts',
    'src/migrations/index.ts',
    "src/migrations/$baselineTypeScriptName",
    "src/migrations/$baselineSnapshotName",
    "src/migrations/$recordsTypeScriptName",
    "src/migrations/$recordsSnapshotName"
  ) | Sort-Object
  $actualStaged = @(git diff --cached --name-only | Sort-Object)
  if (($expectedStaged -join "`n") -ne ($actualStaged -join "`n")) {
    $actualStaged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
    throw '暂存区包含预期之外的文件；未提交。'
  }

  Invoke-Checked '提交 Radar public records 配置与迁移' {
    git commit -m 'Add Radar public records migration'
  }
  Invoke-Checked '推送迁移提交' { git push origin $ExpectedBranch }
  Write-Host ''
  Write-Host '迁移提交已推送。' -ForegroundColor Green
  Write-Host "Head: $((git rev-parse HEAD).Trim())"
}
