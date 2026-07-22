param(
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe',
  [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  Join-Path (Get-Location) "exports\schema-root-audit-$stamp"
} else {
  [System.IO.Path]::GetFullPath($OutputDirectory)
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$docker = Get-Command docker -ErrorAction Stop
$running = (& $docker.Source inspect --format '{{.State.Running}}' $PostgresContainer 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
  throw "PostgreSQL 容器未运行：$PostgresContainer"
}

function Invoke-ReadOnlyQuery {
  param([Parameter(Mandatory = $true)][string]$Sql)

  $pgOptions = 'PGOPTIONS=-c default_transaction_read_only=on -c client_min_messages=warning'
  $output = & $docker.Source exec `
    -e $pgOptions `
    $PostgresContainer `
    psql `
    -X `
    -v ON_ERROR_STOP=1 `
    -U $DatabaseUser `
    -d $Database `
    -At `
    -F "`t" `
    -c $Sql

  if ($LASTEXITCODE -ne 0) {
    throw '只读 PostgreSQL 查询失败。'
  }
  return @($output | ForEach-Object { [string]$_ })
}

function Get-OptionalPropertyValue {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [object]$Fallback = $null
  )

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $Fallback }
  return $property.Value
}

function Write-Utf8Lines {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Lines
  )
  [System.IO.File]::WriteAllLines($Path, $Lines, [System.Text.UTF8Encoding]::new($false))
}

$tableLines = Invoke-ReadOnlyQuery -Sql @'
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name ~ '^(works($|_)|_works_v($|_))'
ORDER BY table_name;
'@

$tables = @(
  foreach ($line in $tableLines) {
    $parts = $line -split "`t", 2
    [pscustomobject]@{ table = $parts[0]; type = $parts[1] }
  }
)
$tables | Export-Csv -LiteralPath (Join-Path $outDir 'database-work-tables.tsv') -Delimiter "`t" -NoTypeInformation -Encoding utf8

$columnLines = Invoke-ReadOnlyQuery -Sql @'
SELECT
  table_name,
  ordinal_position::text,
  column_name,
  data_type,
  COALESCE(NULLIF(udt_schema, 'pg_catalog') || '.', '') || udt_name,
  is_nullable,
  COALESCE(column_default, '')
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name ~ '^(works($|_)|_works_v($|_))'
ORDER BY table_name, ordinal_position;
'@

$actualColumns = @(
  foreach ($line in $columnLines) {
    $parts = $line -split "`t", 7
    [pscustomobject]@{
      table = $parts[0]
      position = [int]$parts[1]
      column = $parts[2]
      dataType = $parts[3]
      underlyingType = $parts[4]
      nullable = $parts[5]
      defaultValue = $parts[6]
    }
  }
)
$actualColumns | Export-Csv -LiteralPath (Join-Path $outDir 'database-work-columns.tsv') -Delimiter "`t" -NoTypeInformation -Encoding utf8

$indexLines = Invoke-ReadOnlyQuery -Sql @'
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename ~ '^(works($|_)|_works_v($|_))'
ORDER BY tablename, indexname;
'@
Write-Utf8Lines -Path (Join-Path $outDir 'database-work-indexes.tsv') -Lines ([string[]]$indexLines)

$enumLines = Invoke-ReadOnlyQuery -Sql @'
SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
FROM pg_type AS t
JOIN pg_enum AS e ON e.enumtypid = t.oid
JOIN pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname ~ '^enum_(works|_works_v)'
GROUP BY t.typname
ORDER BY t.typname;
'@
Write-Utf8Lines -Path (Join-Path $outDir 'database-work-enums.tsv') -Lines ([string[]]$enumLines)

$coverageLines = Invoke-ReadOnlyQuery -Sql @'
WITH source AS (
  SELECT to_jsonb(w) AS doc
  FROM public.works AS w
),
keys AS (
  SELECT DISTINCT jsonb_object_keys(doc) AS key
  FROM source
)
SELECT
  keys.key,
  COUNT(*)::text,
  COUNT(*) FILTER (
    WHERE source.doc ? keys.key
      AND source.doc -> keys.key <> 'null'::jsonb
  )::text
FROM source
CROSS JOIN keys
GROUP BY keys.key
ORDER BY keys.key;
'@
Write-Utf8Lines -Path (Join-Path $outDir 'database-work-field-coverage.tsv') -Lines ([string[]]$coverageLines)

$latestWorks = Invoke-ReadOnlyQuery -Sql @'
SELECT row_to_json(sample)::text
FROM (
  SELECT *
  FROM public.works
  ORDER BY updated_at DESC NULLS LAST, id DESC
  LIMIT 5
) AS sample;
'@
Write-Utf8Lines -Path (Join-Path $outDir 'latest-5-works-main-table.jsonl') -Lines ([string[]]$latestWorks)

$latestVersions = Invoke-ReadOnlyQuery -Sql @'
SELECT row_to_json(sample)::text
FROM (
  SELECT *
  FROM public."_works_v"
  ORDER BY updated_at DESC NULLS LAST, id DESC
  LIMIT 5
) AS sample;
'@
Write-Utf8Lines -Path (Join-Path $outDir 'latest-5-work-versions-main-table.jsonl') -Lines ([string[]]$latestVersions)

$snapshotFile = Get-ChildItem -LiteralPath '.\src\migrations' -File -Filter '*.json' |
  Sort-Object Name |
  Select-Object -Last 1
if (-not $snapshotFile) { throw '没有找到迁移 JSON 快照。' }

$snapshot = Get-Content -LiteralPath $snapshotFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$snapshotTables = Get-OptionalPropertyValue -Object $snapshot -Name 'tables'
if ($null -eq $snapshotTables) { throw '最新迁移 JSON 不包含 tables。' }

$snapshotColumns = @(
  foreach ($tableProperty in $snapshotTables.PSObject.Properties) {
    $table = $tableProperty.Value
    $tableName = [string](Get-OptionalPropertyValue -Object $table -Name 'name' -Fallback $tableProperty.Name)
    if ($tableName -notmatch '^(works($|_)|_works_v($|_))') { continue }

    $columns = Get-OptionalPropertyValue -Object $table -Name 'columns'
    if ($null -eq $columns) { continue }

    foreach ($columnProperty in $columns.PSObject.Properties) {
      $column = $columnProperty.Value
      [pscustomobject]@{
        table = $tableName
        column = [string](Get-OptionalPropertyValue -Object $column -Name 'name' -Fallback $columnProperty.Name)
        snapshotType = [string](Get-OptionalPropertyValue -Object $column -Name 'type' -Fallback '')
        typeSchema = [string](Get-OptionalPropertyValue -Object $column -Name 'typeSchema' -Fallback '')
        notNull = [bool](Get-OptionalPropertyValue -Object $column -Name 'notNull' -Fallback $false)
        defaultValue = [string](Get-OptionalPropertyValue -Object $column -Name 'default' -Fallback '')
      }
    }
  }
)
$snapshotColumns | Sort-Object table, column | Export-Csv -LiteralPath (Join-Path $outDir 'migration-snapshot-work-columns.tsv') -Delimiter "`t" -NoTypeInformation -Encoding utf8

$actualMap = @{}
foreach ($column in $actualColumns) { $actualMap["$($column.table).$($column.column)"] = $column }
$snapshotMap = @{}
foreach ($column in $snapshotColumns) { $snapshotMap["$($column.table).$($column.column)"] = $column }
$allKeys = @($actualMap.Keys; $snapshotMap.Keys) | Sort-Object -Unique

$presenceDiff = @(
  foreach ($key in $allKeys) {
    $inDatabase = $actualMap.ContainsKey($key)
    $inSnapshot = $snapshotMap.ContainsKey($key)
    $status = if ($inDatabase -and $inSnapshot) { 'both' } elseif ($inDatabase) { 'database_only' } else { 'snapshot_only' }
    [pscustomobject]@{
      field = $key
      status = $status
      databaseType = if ($inDatabase) { $actualMap[$key].underlyingType } else { '' }
      snapshotType = if ($inSnapshot) { $snapshotMap[$key].snapshotType } else { '' }
    }
  }
)
$presenceDiff | Export-Csv -LiteralPath (Join-Path $outDir 'database-vs-migration-field-presence.tsv') -Delimiter "`t" -NoTypeInformation -Encoding utf8

$typeDiff = @(
  foreach ($row in $presenceDiff | Where-Object status -eq 'both') {
    $databaseType = [string]$row.databaseType
    $snapshotType = [string]$row.snapshotType
    if (-not [string]::IsNullOrWhiteSpace($databaseType) -and -not [string]::IsNullOrWhiteSpace($snapshotType) -and $databaseType -notlike "*$snapshotType*") {
      [pscustomobject]@{ field = $row.field; databaseType = $databaseType; snapshotType = $snapshotType }
    }
  }
)
$typeDiff | Export-Csv -LiteralPath (Join-Path $outDir 'database-vs-migration-type-candidates.tsv') -Delimiter "`t" -NoTypeInformation -Encoding utf8

$typesSource = Get-Content -LiteralPath '.\payload-types.ts' -Raw -Encoding UTF8
$marker = 'export interface Work {'
$start = $typesSource.IndexOf($marker, [System.StringComparison]::Ordinal)
if ($start -lt 0) { throw 'payload-types.ts 中找不到 Work 接口。' }
$openBrace = $typesSource.IndexOf('{', $start)
$depth = 0
$end = -1
for ($index = $openBrace; $index -lt $typesSource.Length; $index++) {
  $character = $typesSource[$index]
  if ($character -eq '{') { $depth++ }
  elseif ($character -eq '}') {
    $depth--
    if ($depth -eq 0) { $end = $index; break }
  }
}
if ($end -lt 0) { throw '无法完整提取 Work 接口。' }
$workInterface = $typesSource.Substring($start, $end - $start + 1)
[System.IO.File]::WriteAllText((Join-Path $outDir 'payload-work-interface.txt'), $workInterface, [System.Text.UTF8Encoding]::new($false))

$topLevelFields = @(
  [regex]::Matches($workInterface, '(?m)^  ([A-Za-z_][A-Za-z0-9_]*)\??:') |
    ForEach-Object { $_.Groups[1].Value }
)
Write-Utf8Lines -Path (Join-Path $outDir 'payload-work-top-level-fields.txt') -Lines ([string[]]$topLevelFields)

$trackedChanges = @(git status --short | ForEach-Object { [string]$_ })
Write-Utf8Lines -Path (Join-Path $outDir 'git-status-at-audit.txt') -Lines ([string[]]$trackedChanges)

$databaseOnly = @($presenceDiff | Where-Object status -eq 'database_only')
$snapshotOnly = @($presenceDiff | Where-Object status -eq 'snapshot_only')
$both = @($presenceDiff | Where-Object status -eq 'both')

$summary = @(
  'Schema root audit complete',
  '',
  "OutputDirectory: $outDir",
  "MigrationSnapshot: $($snapshotFile.Name)",
  "PayloadTopLevelWorkFields: $($topLevelFields.Count)",
  "DatabaseWorkTables: $($tables.Count)",
  "DatabasePhysicalColumns: $($actualColumns.Count)",
  "SnapshotPhysicalColumns: $($snapshotColumns.Count)",
  "ColumnsPresentInBoth: $($both.Count)",
  "DatabaseOnlyColumns: $($databaseOnly.Count)",
  "SnapshotOnlyColumns: $($snapshotOnly.Count)",
  "TypeDifferenceCandidates: $($typeDiff.Count)",
  '',
  'DatabaseWrite: False',
  'PayloadWrite: False',
  'MigrationGeneration: False',
  'TrackedFileWrite: False'
)
Write-Utf8Lines -Path (Join-Path $outDir 'summary.txt') -Lines ([string[]]$summary)

$driftPreview = @(
  '# Work schema drift preview',
  '',
  "- Migration snapshot: `$($snapshotFile.Name)`",
  "- Database-only columns: $($databaseOnly.Count)",
  "- Snapshot-only columns: $($snapshotOnly.Count)",
  "- Type difference candidates: $($typeDiff.Count)",
  '',
  '## Database-only',
  ''
)
$driftPreview += if ($databaseOnly.Count) { $databaseOnly | ForEach-Object { "- `$($_.field)` — $($_.databaseType)" } } else { '- none' }
$driftPreview += @('', '## Snapshot-only', '')
$driftPreview += if ($snapshotOnly.Count) { $snapshotOnly | ForEach-Object { "- `$($_.field)` — $($_.snapshotType)" } } else { '- none' }
$driftPreview += @('', '## Type candidates', '')
$driftPreview += if ($typeDiff.Count) { $typeDiff | ForEach-Object { "- `$($_.field)` — database: $($_.databaseType); snapshot: $($_.snapshotType)" } } else { '- none' }
Write-Utf8Lines -Path (Join-Path $outDir 'drift-preview.md') -Lines ([string[]]$driftPreview)

Write-Host ''
$summary | ForEach-Object { Write-Host $_ }
