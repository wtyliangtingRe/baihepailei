param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-unified-release-lab-0575-v01'
$MigrationName = 'radar_public_record_fact_value_text_v01'
$MigrationDirectory = '.\src\migrations'
$CollectionPath = '.\src\collections\RadarPublicRecords.ts'
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
  if ($LASTEXITCODE -ne 0) { throw "$Label 失败（退出码 $LASTEXITCODE）" }
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
  return [pscustomobject]@{
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
    $saved[$name] = [pscustomobject]@{
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

function Assert-CollectionContract {
  $source = Get-Content -LiteralPath $CollectionPath -Raw -Encoding UTF8
  $factsStart = $source.IndexOf("name: 'facts'")
  $evidenceStart = $source.IndexOf("name: 'evidence'")
  if ($factsStart -lt 0 -or $evidenceStart -le $factsStart) { throw '无法定位 facts 字段。' }
  $factsBlock = $source.Substring($factsStart, $evidenceStart - $factsStart)
  if ($factsBlock -notmatch "name: 'value',[\s\S]*type: 'textarea'") {
    throw 'facts.value 尚未切换为 textarea。'
  }
  if ($factsBlock -match "name: 'value',[\s\S]*type: 'json'") {
    throw 'facts.value 仍含 JSON 字段定义。'
  }
}

function Assert-FactValueOnlyDDL {
  param([Parameter(Mandatory = $true)][string]$MigrationSource)

  foreach ($pattern in @(
    '(?i)CREATE\s+(?:TABLE|TYPE)',
    '(?i)DROP\s+(?:TABLE|TYPE)',
    '(?i)ALTER TABLE\s+(?:"public"\.)?"works"',
    '(?i)ALTER TABLE\s+(?:"public"\.)?"radar_public_ratings',
    '(?i)ALTER TABLE\s+(?:"public"\.)?"radar_public"(?:\s|`)',
    'human_assessment_grade',
    'radar_assessment_suggested_grade'
  )) {
    if ($MigrationSource -match $pattern) { throw "事实文本迁移混入预期外 DDL：$pattern" }
  }

  $alterMatches = [regex]::Matches(
    $MigrationSource,
    '(?i)ALTER TABLE\s+(?:"public"\.)?"([^"]+)"'
  )
  if ($alterMatches.Count -lt 2) { throw '迁移必须同时包含 up/down 的事实表 ALTER。' }
  foreach ($match in $alterMatches) {
    if ($match.Groups[1].Value -ne 'radar_public_records_facts') {
      throw "迁移修改了非事实子表：$($match.Groups[1].Value)"
    }
  }

  if ($MigrationSource -notmatch '(?i)ALTER COLUMN\s+"value"\s+SET DATA TYPE\s+varchar') {
    throw '迁移没有把 facts.value 改为 varchar。'
  }
  if ($MigrationSource -notmatch '(?i)ALTER COLUMN\s+"value"\s+SET DATA TYPE\s+jsonb') {
    throw '迁移 down 没有恢复 facts.value 为 jsonb。'
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
Invoke-Checked '切换统一 Release 隔离实验室分支' { git switch $ExpectedBranch }
Invoke-Checked '快进到远端最新提交' { git pull --ff-only origin $ExpectedBranch }

$branch = (git branch --show-current).Trim()
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($branch -ne $ExpectedBranch -or $localHead -ne $remoteHead) {
  throw "分支或 HEAD 不符合预期：branch=$branch local=$localHead remote=$remoteHead"
}

Assert-CollectionContract
Invoke-Checked '运行事实 schema、统一 Release 与实验室测试' {
  node --test `
    '.\tests\radar-public-records-schema.test.mjs' `
    '.\tests\radar-unified-rating-release-plan-v01.test.mjs' `
    '.\tests\radar-unified-release-lab-0575-v01.test.mjs' `
    '.\tests\radar-public-record-fact-value-text-migration-preparation.test.mjs'
}
Invoke-Checked '运行 TypeScript 静态检查' { pnpm exec tsc --noEmit }

$beforeArtifacts = @(Get-MigrationArtifacts)
try {
  Invoke-WithProcessEnvironment -Variables @{
    PAYLOAD_DB_PUSH = 'false'
    STEWARDSHIP_NOTICES_SCHEMA_READY = 'true'
    RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'
    RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'
    PGOPTIONS = $ReadOnlyPgOptions
  } -Action {
    Invoke-Checked '只生成 facts.value 文本迁移（不执行 migrate）' {
      pnpm payload migrate:create $MigrationName --skip-empty
    }
  }

  $migration = Get-GeneratedPair -Before $beforeArtifacts -After @(Get-MigrationArtifacts)
  $migrationSource = Get-Content -LiteralPath $migration.TypeScript -Raw -Encoding UTF8
  Assert-FactValueOnlyDDL -MigrationSource $migrationSource

  $snapshot = Get-Content -LiteralPath $migration.Snapshot -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  $factsTable = $snapshot.tables.'public.radar_public_records_facts'
  if (-not $factsTable -or [string]$factsTable.columns.value.type -ne 'varchar') {
    throw '迁移快照没有把 public.radar_public_records_facts.value 固定为 varchar。'
  }
  if (-not $snapshot.tables.'public.radar_public_ratings' -or -not $snapshot.tables.'public.works') {
    throw '迁移快照没有保留 Ratings 或 Works 结构。'
  }

  $tsName = [System.IO.Path]::GetFileName($migration.TypeScript)
  $jsonName = [System.IO.Path]::GetFileName($migration.Snapshot)
  $allowedGenerated = @(
    'src/migrations/index.ts',
    ('src/migrations/' + $tsName),
    ('src/migrations/' + $jsonName)
  ) + $AllowedLocalFiles
  $unexpectedAfter = @(Get-DirtyPaths | Where-Object { $allowedGenerated -notcontains $_ })
  if ($unexpectedAfter.Count -gt 0) {
    $unexpectedAfter | ForEach-Object { Write-Host "unexpected generated change: $_" -ForegroundColor Yellow }
    throw '生成迁移后出现预期之外的文件修改。'
  }

  Invoke-Checked '复跑事实 schema、统一 Release 与实验室测试' {
    node --test `
      '.\tests\radar-public-records-schema.test.mjs' `
      '.\tests\radar-unified-rating-release-plan-v01.test.mjs' `
      '.\tests\radar-unified-release-lab-0575-v01.test.mjs' `
      '.\tests\radar-public-record-fact-value-text-migration-preparation.test.mjs'
  }
  Invoke-Checked '复跑 TypeScript 静态检查' { pnpm exec tsc --noEmit }
  Invoke-Checked '检查补丁空白与冲突标记' { git diff --check }
} catch {
  Write-Host ''
  Write-Host '迁移准备失败，正在清理本轮生成文件。' -ForegroundColor Yellow
  foreach ($path in @(Get-NewPaths -Before $beforeArtifacts -After @(Get-MigrationArtifacts))) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
  git restore --worktree -- 'src/migrations/index.ts' 2>$null
  throw
}

Write-Host ''
Write-Host 'facts.value 文本补充迁移已生成；尚未执行数据库迁移。' -ForegroundColor Green
Write-Host "Migration       : $($migration.TypeScript)"
Write-Host "Snapshot        : $($migration.Snapshot)"
Write-Host 'PostgreSQLSession: ReadOnly'
Write-Host 'DatabaseMigrate : False'
Write-Host 'PayloadWrite    : False'
Write-Host 'SourceDatabaseWrite: False'
Write-Host 'PublicFactWrite : False'
Write-Host 'PublicRatingWrite: False'

if ($CommitAndPush) {
  $tsName = [System.IO.Path]::GetFileName($migration.TypeScript)
  $jsonName = [System.IO.Path]::GetFileName($migration.Snapshot)
  Invoke-Checked '仅暂存迁移索引与 facts.value 文本迁移' {
    git add -- `
      'src/migrations/index.ts' `
      ("src/migrations/$tsName") `
      ("src/migrations/$jsonName")
  }

  $expectedStaged = @(
    'src/migrations/index.ts',
    "src/migrations/$tsName",
    "src/migrations/$jsonName"
  ) | Sort-Object
  $actualStaged = @(git diff --cached --name-only | Sort-Object)
  if (($expectedStaged -join "`n") -ne ($actualStaged -join "`n")) {
    $actualStaged | ForEach-Object { Write-Host "staged: $_" -ForegroundColor Yellow }
    throw '暂存文件集合与预期不一致；未提交。'
  }

  Invoke-Checked '提交 facts.value 文本补充迁移' {
    git commit -m 'Add public fact value text migration'
  }
  Invoke-Checked '推送统一 Release 隔离实验室分支' {
    git push origin $ExpectedBranch
  }

  Write-Host ''
  Write-Host "PushedHead: $((git rev-parse HEAD).Trim())" -ForegroundColor Green
}
