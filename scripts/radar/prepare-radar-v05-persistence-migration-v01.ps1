param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-v0.5-persistence-standardization-v01'
$MigrationName = 'radar_v05_persistence_standardization_v01'
$MigrationDirectory = '.\src\migrations'
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
    throw '预期只生成 1 个 TypeScript 迁移和 1 个 JSON schema snapshot。'
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

function Assert-V05OnlyDDL {
  param([Parameter(Mandatory = $true)][string]$MigrationSource)

  if ($MigrationSource -notmatch 'radar_public' -or $MigrationSource -notmatch 'radar_public_ratings') {
    throw '生成的迁移没有同时覆盖 Candidate radar_public 与 Published radar_public_ratings。'
  }
  if ($MigrationSource -notmatch 'compatibility_grade') {
    throw '生成的迁移没有包含 Candidate compatibility_grade nullable 变化。'
  }
  if ($MigrationSource -notmatch 'conclusion_mode') {
    throw '生成的迁移没有包含 Published conclusion_mode。'
  }
  foreach ($token in @('labels_only', 'blocked')) {
    if ($MigrationSource -notmatch [regex]::Escape($token)) {
      throw "生成的迁移缺少 v0.5 conclusion mode：$token"
    }
  }

  if ($MigrationSource -match '(?i)\b(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)') {
    throw 'v0.5 schema migration 不得包含内容数据写入。'
  }
  if ($MigrationSource -match '(?i)DROP\s+TABLE') {
    throw 'v0.5 schema migration 不得 DROP TABLE。'
  }

  foreach ($match in [regex]::Matches($MigrationSource, '(?i)(?:ALTER|CREATE) TABLE\s+(?:"public"\.)?"([^"]+)"')) {
    $table = $match.Groups[1].Value
    if ($table -notin @('radar_public', 'radar_public_ratings')) {
      throw "迁移修改了非目标表：$table"
    }
  }

  foreach ($match in [regex]::Matches($MigrationSource, '(?i)(?:ALTER|CREATE|DROP) TYPE\s+(?:"public"\.)?"([^"]+)"')) {
    $typeName = $match.Groups[1].Value
    $allowed = $typeName.StartsWith('enum_radar_public_conclusion_mode', [System.StringComparison]::Ordinal) -or
      $typeName.StartsWith('enum_radar_public_ratings_conclusion_mode', [System.StringComparison]::Ordinal)
    if (-not $allowed) {
      throw "迁移修改了非目标 enum：$typeName"
    }
  }

  foreach ($forbidden in @(
    'human_assessment_grade',
    'radar_assessment_suggested_grade',
    'legacy_x_wiki_page',
    'radar_public_records'
  )) {
    if ($MigrationSource -match [regex]::Escape($forbidden)) {
      throw "迁移混入非目标结构：$forbidden"
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

Invoke-Checked '获取远端状态' { git fetch origin }
Invoke-Checked '切换 v0.5 persistence branch' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新提交' { git pull --ff-only origin $ExpectedBranch }

$branch = (git branch --show-current).Trim()
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($branch -ne $ExpectedBranch -or $localHead -ne $remoteHead) {
  throw "分支或 HEAD 不符合预期：branch=$branch local=$localHead remote=$remoteHead"
}

Invoke-Checked '运行 v0.5 persistence focused tests' {
  node --test `
    '.\tests\radar-unified-rating-release-plan-v01.test.mjs' `
    '.\tests\radar-public-ratings-schema.test.mjs' `
    '.\tests\radar-v05-persistence-standardization.test.mjs' `
    '.\tests\radar-v05-persistence-migration-preparation.test.mjs'
}
Invoke-Checked '运行 TypeScript 静态检查' { pnpm exec tsc --noEmit }

$beforeArtifacts = @(Get-MigrationArtifacts)

try {
  Invoke-WithProcessEnvironment -Variables @{
    PAYLOAD_DB_PUSH = 'false'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
    PGOPTIONS = $ReadOnlyPgOptions
  } -Action {
    Invoke-Checked '只生成 v0.5 migration + snapshot（不执行 migrate）' {
      pnpm payload migrate:create $MigrationName --skip-empty
    }
  }

  $afterArtifacts = @(Get-MigrationArtifacts)
  $migration = Get-GeneratedPair -Before $beforeArtifacts -After $afterArtifacts
  $migrationSource = Get-Content -LiteralPath $migration.TypeScript -Raw -Encoding UTF8
  $snapshotSource = Get-Content -LiteralPath $migration.Snapshot -Raw -Encoding UTF8

  Assert-V05OnlyDDL -MigrationSource $migrationSource

  foreach ($required in @(
    '"public.radar_public"',
    '"public.radar_public_ratings"',
    '"public.radar_public_records"',
    '"public.works"',
    'conclusion_mode',
    'labels_only',
    'blocked'
  )) {
    if ($snapshotSource -notmatch [regex]::Escape($required)) {
      throw "migration snapshot 缺少预期结构：$required"
    }
  }

  $migrationTypeScriptName = [System.IO.Path]::GetFileName($migration.TypeScript)
  $migrationSnapshotName = [System.IO.Path]::GetFileName($migration.Snapshot)
  $allowedGenerated = @(
    'src/migrations/index.ts',
    ('src/migrations/' + $migrationTypeScriptName),
    ('src/migrations/' + $migrationSnapshotName)
  ) + $AllowedLocalFiles
  $unexpectedAfter = @(Get-DirtyPaths | Where-Object { $allowedGenerated -notcontains $_ })
  if ($unexpectedAfter.Count -gt 0) {
    $unexpectedAfter | ForEach-Object { Write-Host "unexpected generated change: $_" -ForegroundColor Yellow }
    throw '生成迁移后出现预期之外的文件修改。'
  }

  Invoke-Checked '复跑 v0.5 persistence focused tests' {
    node --test `
      '.\tests\radar-unified-rating-release-plan-v01.test.mjs' `
      '.\tests\radar-public-ratings-schema.test.mjs' `
      '.\tests\radar-v05-persistence-standardization.test.mjs' `
      '.\tests\radar-v05-persistence-migration-preparation.test.mjs'
  }
  Invoke-Checked '复跑 TypeScript 静态检查' { pnpm exec tsc --noEmit }
  Invoke-Checked '检查补丁空白' { git diff --check }
} catch {
  Write-Host ''
  Write-Host 'v0.5 migration 准备失败，清理本轮生成文件并恢复 migration index。' -ForegroundColor Yellow
  foreach ($path in @(Get-NewPaths -Before $beforeArtifacts -After @(Get-MigrationArtifacts))) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
  git restore --worktree -- 'src/migrations/index.ts' 2>$null
  throw
}

Write-Host ''
Write-Host 'Radar v0.5 migration 与 schema snapshot 已生成；没有执行数据库迁移。' -ForegroundColor Green
Write-Host "Migration        : $($migration.TypeScript)"
Write-Host "Snapshot         : $($migration.Snapshot)"
Write-Host 'PostgreSQLSession: ReadOnly'
Write-Host 'DatabaseMigrate  : False'
Write-Host 'PayloadWrite     : False'
Write-Host 'ProductionApply  : False'

if ($CommitAndPush) {
  Invoke-Checked '仅暂存生成的 migration pair 与 index' {
    git add -- `
      'src/migrations/index.ts' `
      ("src/migrations/$migrationTypeScriptName") `
      ("src/migrations/$migrationSnapshotName")
  }

  $expectedStaged = @(
    'src/migrations/index.ts',
    "src/migrations/$migrationSnapshotName",
    "src/migrations/$migrationTypeScriptName"
  ) | Sort-Object
  $actualStaged = @(git diff --cached --name-only | Sort-Object)
  if (($expectedStaged -join "`n") -ne ($actualStaged -join "`n")) {
    $actualStaged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
    throw '暂存文件集合与预期不一致；未提交。'
  }

  Invoke-Checked '提交 v0.5 generated migration snapshot' {
    git commit -m 'Generate Radar v0.5 persistence migration snapshot'
  }
  Invoke-Checked '推送 v0.5 persistence branch' {
    git push origin $ExpectedBranch
  }

  Write-Host ''
  Write-Host "PushedHead: $((git rev-parse HEAD).Trim())" -ForegroundColor Green
}
