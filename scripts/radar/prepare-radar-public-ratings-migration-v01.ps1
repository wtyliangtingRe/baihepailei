param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-public-ratings-migration-v01'
$MigrationName = 'radar_public_ratings_v01'
$MigrationDirectory = '.\src\migrations'
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
  if (-not (Test-Path -LiteralPath $MigrationDirectory)) { return @() }
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
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After
  )
  return @($After | Where-Object { $Before -notcontains $_ })
}

function Get-GeneratedPair {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After
  )

  $newPaths = @(Get-NewPaths -Before $Before -After $After)
  $typeScriptFiles = @($newPaths | Where-Object { [System.IO.Path]::GetExtension([string]$_) -eq '.ts' })
  $snapshotFiles = @($newPaths | Where-Object { [System.IO.Path]::GetExtension([string]$_) -eq '.json' })
  if ($typeScriptFiles.Count -ne 1 -or $snapshotFiles.Count -ne 1) {
    $newPaths | ForEach-Object { Write-Host "generated: $_" -ForegroundColor Yellow }
    throw '预期只生成 1 个 TypeScript 迁移和 1 个 JSON 快照。'
  }

  $tsStem = [System.IO.Path]::GetFileNameWithoutExtension([string]$typeScriptFiles[0])
  $jsonStem = [System.IO.Path]::GetFileNameWithoutExtension([string]$snapshotFiles[0])
  if ($tsStem -ne $jsonStem -or $tsStem -notmatch [regex]::Escape($MigrationName)) {
    throw "生成的迁移文件名不符合预期：$tsStem / $jsonStem"
  }

  return [PSCustomObject]@{
    TypeScript = [string]$typeScriptFiles[0]
    Snapshot = [string]$snapshotFiles[0]
    Stem = $tsStem
  }
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
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

function Ensure-PayloadRegistration {
  $source = (Get-Content -LiteralPath $PayloadConfigPath -Raw -Encoding UTF8).Replace("`r`n", "`n")

  if ($source -notmatch "import \{ RadarPublicRatings \} from './src/collections/RadarPublicRatings'") {
    $anchor = "import { RadarPublicRecords } from './src/collections/RadarPublicRecords'"
    if (-not $source.Contains($anchor)) { throw '无法定位 RadarPublicRecords import。' }
    $source = $source.Replace(
      $anchor,
      $anchor + "`nimport { RadarPublicRatings } from './src/collections/RadarPublicRatings'"
    )
  }

  if ($source -notmatch 'RADAR_PUBLIC_RATINGS_SCHEMA_READY') {
    $anchor = "const radarPublicRecordsSchemaReady = String(process.env['RADAR_PUBLIC_RECORDS_SCHEMA_READY'] || 'true').toLowerCase() !== 'false'"
    if (-not $source.Contains($anchor)) { throw '无法定位 Radar public records schema flag。' }
    $source = $source.Replace(
      $anchor,
      $anchor + "`n/** Radar public ratings stay optional only during isolated migration generation. */`nconst radarPublicRatingsSchemaReady = String(process.env['RADAR_PUBLIC_RATINGS_SCHEMA_READY'] || 'true').toLowerCase() !== 'false'"
    )
  }

  if ($source -notmatch 'RadarPublicRatingsWithAudit') {
    $anchor = "const RadarPublicRecordsWithAudit = withContentAudit(RadarPublicRecords, 'radar-public-records')"
    if (-not $source.Contains($anchor)) { throw '无法定位 RadarPublicRecordsWithAudit。' }
    $source = $source.Replace(
      $anchor,
      $anchor + "`nconst RadarPublicRatingsWithAudit = withContentAudit(RadarPublicRatings, 'radar-public-ratings')"
    )
  }

  $registration = "    ...(radarPublicRatingsSchemaReady ? [RadarPublicRatingsWithAudit] : []),"
  if (-not $source.Contains($registration)) {
    $anchor = "    ...(radarPublicRecordsSchemaReady ? [RadarPublicRecordsWithAudit] : []),"
    if (-not $source.Contains($anchor)) { throw '无法定位 Radar public records collection registration。' }
    $source = $source.Replace($anchor, $anchor + "`n" + $registration)
  }

  Write-Utf8NoBom -Path $PayloadConfigPath -Content $source

  $written = Get-Content -LiteralPath $PayloadConfigPath -Raw -Encoding UTF8
  foreach ($required in @(
    "import { RadarPublicRatings } from './src/collections/RadarPublicRatings'",
    'RADAR_PUBLIC_RATINGS_SCHEMA_READY',
    'RadarPublicRatingsWithAudit',
    'radarPublicRatingsSchemaReady ? [RadarPublicRatingsWithAudit]'
  )) {
    if ($written -notmatch [regex]::Escape($required)) {
      throw "Payload config 缺少注册片段：$required"
    }
  }
}

function Ensure-EnvironmentDocumentation {
  $source = (Get-Content -LiteralPath $EnvExamplePath -Raw -Encoding UTF8).Replace("`r`n", "`n")
  if ($source -notmatch '(?m)^RADAR_PUBLIC_RATINGS_SCHEMA_READY=') {
    $source = $source.TrimEnd("`n") + @"


# Existing deployments keep Radar public ratings enabled after the additive migration.
# Set false only while generating an isolated pre-ratings schema snapshot.
RADAR_PUBLIC_RATINGS_SCHEMA_READY=true
"@
  }
  Write-Utf8NoBom -Path $EnvExamplePath -Content $source
}

function Assert-RatingsOnlyDDL {
  param([Parameter(Mandatory = $true)][string]$MigrationSource)

  foreach ($pattern in @(
    'ALTER TABLE\s+(?:"public"\.)?"works"',
    'DROP TABLE\s+(?:"public"\.)?"works"',
    'CREATE TABLE\s+(?:"public"\.)?"works"',
    'ALTER TABLE\s+(?:"public"\.)?"radar_public_records',
    'DROP TABLE\s+(?:"public"\.)?"radar_public_records',
    'CREATE TABLE\s+(?:"public"\.)?"radar_public_records',
    'ALTER TABLE\s+(?:"public"\.)?"radar_public"(?:\s|`)',
    'DROP TABLE\s+(?:"public"\.)?"radar_public"(?:\s|`)',
    'human_assessment_grade',
    'radar_assessment_suggested_grade',
    'legacy_x_wiki_page'
  )) {
    if ($MigrationSource -match $pattern) {
      throw "公开机器评级迁移混入既有结构变更：$pattern"
    }
  }

  if ($MigrationSource -notmatch 'CREATE TABLE\s+(?:"public"\.)?"radar_public_ratings"') {
    throw '生成的迁移没有包含 radar_public_ratings 主表。'
  }

  foreach ($match in [regex]::Matches($MigrationSource, '(?i)CREATE TABLE\s+(?:"public"\.)?"([^"]+)"')) {
    if (-not $match.Groups[1].Value.StartsWith('radar_public_ratings', [System.StringComparison]::Ordinal)) {
      throw "迁移创建了非 radar_public_ratings 表：$($match.Groups[1].Value)"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)(?:ALTER|DROP) TABLE\s+(?:"public"\.)?"([^"]+)"')) {
    if (-not $match.Groups[1].Value.StartsWith('radar_public_ratings', [System.StringComparison]::Ordinal)) {
      throw "迁移修改或删除了非 radar_public_ratings 表：$($match.Groups[1].Value)"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)CREATE TYPE\s+(?:"public"\.)?"([^"]+)"')) {
    if (-not $match.Groups[1].Value.StartsWith('enum_radar_public_ratings', [System.StringComparison]::Ordinal)) {
      throw "迁移创建了非 radar_public_ratings enum：$($match.Groups[1].Value)"
    }
  }
  foreach ($match in [regex]::Matches($MigrationSource, '(?i)DROP TYPE\s+(?:"public"\.)?"([^"]+)"')) {
    if (-not $match.Groups[1].Value.StartsWith('enum_radar_public_ratings', [System.StringComparison]::Ordinal)) {
      throw "迁移删除了非 radar_public_ratings enum：$($match.Groups[1].Value)"
    }
  }
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repositoryRoot

$unexpectedBefore = @(Get-DirtyPaths | Where-Object { $AllowedLocalFiles -notcontains $_ })
if ($unexpectedBefore.Count -gt 0) {
  $unexpectedBefore | ForEach-Object { Write-Host "unexpected dirty: $_" -ForegroundColor Yellow }
  throw '发现预期之外的本地修改；未开始生成迁移。'
}

Invoke-Checked '获取远端分支' { git fetch origin }
Invoke-Checked '切换 Radar public ratings 迁移分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新提交' { git pull --ff-only origin $ExpectedBranch }

$branch = (git branch --show-current).Trim()
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($branch -ne $ExpectedBranch -or $localHead -ne $remoteHead) {
  throw "分支或 HEAD 不符合预期：branch=$branch local=$localHead remote=$remoteHead"
}

Invoke-Checked '运行评级 Release、schema 与迁移准备测试' {
  node --test `
    '.\tests\radar-unified-rating-release-plan-v01.test.mjs' `
    '.\tests\radar-public-ratings-schema.test.mjs' `
    '.\tests\radar-public-ratings-migration-preparation.test.mjs'
}
Invoke-Checked '运行 TypeScript 静态检查' { pnpm exec tsc --noEmit }

$originalPayloadConfig = (Get-Content -LiteralPath $PayloadConfigPath -Raw -Encoding UTF8).Replace("`r`n", "`n")
$originalEnvExample = (Get-Content -LiteralPath $EnvExamplePath -Raw -Encoding UTF8).Replace("`r`n", "`n")
$beforeArtifacts = @(Get-MigrationArtifacts)

try {
  Ensure-PayloadRegistration
  Ensure-EnvironmentDocumentation

  Invoke-WithProcessEnvironment -Variables @{
    PAYLOAD_DB_PUSH = 'false'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
    PGOPTIONS = $ReadOnlyPgOptions
  } -Action {
    Invoke-Checked '只生成 Radar public ratings 加法迁移（不执行 migrate）' {
      pnpm payload migrate:create $MigrationName --skip-empty
    }
  }

  $afterArtifacts = @(Get-MigrationArtifacts)
  $migration = Get-GeneratedPair -Before $beforeArtifacts -After $afterArtifacts
  $migrationSource = Get-Content -LiteralPath $migration.TypeScript -Raw -Encoding UTF8
  $snapshotSource = Get-Content -LiteralPath $migration.Snapshot -Raw -Encoding UTF8
  Assert-RatingsOnlyDDL -MigrationSource $migrationSource

  if ($snapshotSource -notmatch '"public\.radar_public_ratings"') {
    throw '迁移快照缺少 radar_public_ratings。'
  }
  if ($snapshotSource -notmatch '"public\.radar_public_records"' -or $snapshotSource -notmatch '"public\.works"') {
    throw '迁移快照没有保留现有 public records 或 Works 结构。'
  }

  $migrationTypeScriptName = [System.IO.Path]::GetFileName($migration.TypeScript)
  $migrationSnapshotName = [System.IO.Path]::GetFileName($migration.Snapshot)
  $allowedGenerated = @(
    'payload.config.ts',
    '.env.example',
    'src/migrations/index.ts',
    ('src/migrations/' + $migrationTypeScriptName),
    ('src/migrations/' + $migrationSnapshotName)
  ) + $AllowedLocalFiles
  $unexpectedAfter = @(Get-DirtyPaths | Where-Object { $allowedGenerated -notcontains $_ })
  if ($unexpectedAfter.Count -gt 0) {
    $unexpectedAfter | ForEach-Object { Write-Host "unexpected generated change: $_" -ForegroundColor Yellow }
    throw '生成迁移后出现了预期之外的文件修改。'
  }

  Invoke-Checked '复跑评级 Release、schema 与迁移准备测试' {
    node --test `
      '.\tests\radar-unified-rating-release-plan-v01.test.mjs' `
      '.\tests\radar-public-ratings-schema.test.mjs' `
      '.\tests\radar-public-ratings-migration-preparation.test.mjs'
  }
  Invoke-Checked '复跑 TypeScript 静态检查' { pnpm exec tsc --noEmit }
  Invoke-Checked '检查补丁空白与冲突标记' { git diff --check }
} catch {
  Write-Host ''
  Write-Host '迁移准备失败，正在恢复配置并清理本轮生成文件。' -ForegroundColor Yellow
  foreach ($path in @(Get-NewPaths -Before $beforeArtifacts -After @(Get-MigrationArtifacts))) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
  Write-Utf8NoBom -Path $PayloadConfigPath -Content $originalPayloadConfig
  Write-Utf8NoBom -Path $EnvExamplePath -Content $originalEnvExample
  git restore --worktree -- 'src/migrations/index.ts' 2>$null
  throw
}

Write-Host ''
Write-Host 'Radar public ratings 配置与加法迁移已生成；尚未执行数据库迁移。' -ForegroundColor Green
Write-Host "Migration       : $($migration.TypeScript)"
Write-Host "Snapshot        : $($migration.Snapshot)"
Write-Host 'PostgreSQLSession: ReadOnly'
Write-Host 'DatabaseMigrate : False'
Write-Host 'PayloadWrite    : False'
Write-Host 'WorksMutation   : False'
Write-Host 'PublicFactWrite : False'
Write-Host 'PublicRatingWrite: False'

if ($CommitAndPush) {
  Invoke-Checked '仅暂存配置、环境说明与 Radar public ratings 迁移' {
    git add -- `
      'payload.config.ts' `
      '.env.example' `
      'src/migrations/index.ts' `
      ("src/migrations/$migrationTypeScriptName") `
      ("src/migrations/$migrationSnapshotName")
  }

  $expectedStaged = @(
    '.env.example',
    'payload.config.ts',
    'src/migrations/index.ts',
    "src/migrations/$migrationTypeScriptName",
    "src/migrations/$migrationSnapshotName"
  ) | Sort-Object
  $actualStaged = @(git diff --cached --name-only | Sort-Object)
  if (($expectedStaged -join "`n") -ne ($actualStaged -join "`n")) {
    $actualStaged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
    throw '暂存文件集合与预期不一致；未提交。'
  }

  Invoke-Checked '提交 Radar public ratings 加法迁移' {
    git commit -m 'Add additive Radar public ratings migration'
  }
  Invoke-Checked '推送 Radar public ratings 迁移分支' {
    git push origin $ExpectedBranch
  }

  Write-Host ''
  Write-Host "PushedHead: $((git rev-parse HEAD).Trim())" -ForegroundColor Green
}
