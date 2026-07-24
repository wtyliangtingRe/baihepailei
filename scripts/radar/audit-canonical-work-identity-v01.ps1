param(
  [Parameter(Mandatory = $true)][string]$DryRunV02Directory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

$docker = Get-Command docker -ErrorAction Stop
$inputDir = [System.IO.Path]::GetFullPath($DryRunV02Directory)
$outDir = [System.IO.Path]::GetFullPath($OutputDirectory)

if (-not (Test-Path -LiteralPath $inputDir -PathType Container)) {
  throw "找不到 v02 dry-run 目录：$inputDir"
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

function Write-Utf8Lines {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Lines
  )
  [System.IO.File]::WriteAllLines($Path, $Lines, [System.Text.UTF8Encoding]::new($false))
}

function Quote-Identifier {
  param([Parameter(Mandatory = $true)][string]$Name)
  return '"' + $Name.Replace('"', '""') + '"'
}

function Quote-SqlLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Invoke-ReadOnlyQuery {
  param([Parameter(Mandatory = $true)][string]$Sql)

  $pgOptions = 'PGOPTIONS=-c default_transaction_read_only=on -c client_min_messages=warning'
  $output = & $docker.Source exec `
    -e $pgOptions `
    -e 'PGCLIENTENCODING=UTF8' `
    $PostgresContainer `
    psql `
    -X `
    -v ON_ERROR_STOP=1 `
    -U $DatabaseUser `
    -d $Database `
    -At `
    -c $Sql

  if ($LASTEXITCODE -ne 0) {
    throw '只读 PostgreSQL 查询失败。'
  }

  return @($output | ForEach-Object { [string]$_ })
}

function Invoke-ReadOnlyJsonQuery {
  param([Parameter(Mandatory = $true)][string]$JsonSql)

  $wrappedSql = @"
WITH payload AS (
$JsonSql
)
SELECT replace(
  encode(convert_to(payload.json_text, 'UTF8'), 'base64'),
  E'\n',
  ''
)
FROM payload;
"@

  $encodedLines = @(Invoke-ReadOnlyQuery -Sql $wrappedSql)
  $jsonLines = @()

  foreach ($encodedLine in $encodedLines) {
    $clean = ([string]$encodedLine).Trim()
    if ([string]::IsNullOrWhiteSpace($clean)) {
      continue
    }

    try {
      $bytes = [System.Convert]::FromBase64String($clean)
      $json = [System.Text.Encoding]::UTF8.GetString($bytes)
      $null = $json | ConvertFrom-Json -Depth 100 -ErrorAction Stop
      $jsonLines += $json
    } catch {
      throw "UTF-8/Base64 JSON 解码或校验失败：$($_.Exception.Message)"
    }
  }

  return @($jsonLines)
}

function Read-JsonLines {
  param([Parameter(Mandatory = $true)][string]$Path)
  $rows = @()
  $lineNumber = 0
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $lineNumber += 1
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
      $rows += ($line | ConvertFrom-Json -Depth 100 -ErrorAction Stop)
    } catch {
      throw "无效 JSONL：$Path:$lineNumber"
    }
  }
  return @($rows)
}

$sourceManifestPath = Join-Path $inputDir 'manifest.json'
$alertsPath = Join-Path $inputDir 'canonical-identity-review-alerts.jsonl'
$sourceSummaryPath = Join-Path $inputDir 'normalization-summary-v02.json'

foreach ($required in @($sourceManifestPath, $alertsPath, $sourceSummaryPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "v02 dry-run 缺少必要文件：$required"
  }
}

$sourceManifest = Get-Content -LiteralPath $sourceManifestPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 30
foreach ($entry in @($sourceManifest)) {
  $file = Join-Path $inputDir ([string]$entry.file)
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "v02 manifest 文件不存在：$($entry.file)"
  }
  $actual = Get-FileHash -LiteralPath $file -Algorithm SHA256
  $bytes = (Get-Item -LiteralPath $file).Length
  if ($bytes -ne [long]$entry.bytes) {
    throw "v02 manifest 字节数不匹配：$($entry.file)"
  }
  if ($actual.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
    throw "v02 manifest SHA-256 不匹配：$($entry.file)"
  }
}

$sourceSummary = Get-Content -LiteralPath $sourceSummaryPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 30
if ($sourceSummary.safety.databaseWrite -ne $false -or
    $sourceSummary.safety.executableUpdateSqlGenerated -ne $false) {
  throw '输入 v02 dry-run 未证明只读安全。'
}

$alerts = @(Read-JsonLines -Path $alertsPath)
if ($alerts.Count -eq 0) {
  throw 'v02 dry-run 没有 canonical identity alert。'
}

$workIds = @(
  $alerts |
    ForEach-Object { @($_.workIds) } |
    ForEach-Object { [int64]$_ } |
    Sort-Object -Unique
)
if ($workIds.Count -lt 2) {
  throw 'canonical identity 审计至少需要两个 Work ID。'
}
$idsSql = $workIds -join ', '

$alertLines = @($alerts | ForEach-Object { $_ | ConvertTo-Json -Depth 100 -Compress })
Write-Utf8Lines -Path (Join-Path $outDir 'input-identity-alerts.jsonl') -Lines ([string[]]$alertLines)

$workRows = @(
  Invoke-ReadOnlyJsonQuery -JsonSql @"
SELECT row_to_json(w)::text AS json_text
FROM public.works w
WHERE w.id IN ($idsSql)
ORDER BY w.id
"@
)
if ($workRows.Count -ne $workIds.Count) {
  throw "Work 主表行数与目标 ID 数不一致：$($workRows.Count) / $($workIds.Count)"
}
Write-Utf8Lines -Path (Join-Path $outDir 'work-rows.jsonl') -Lines ([string[]]$workRows)

$workLocatorLines = @(
  Invoke-ReadOnlyJsonQuery -JsonSql @'
WITH foreign_keys AS (
  SELECT
    ns.nspname AS table_schema,
    rel.relname AS table_name,
    src.attname AS column_name,
    'foreign_key_to_works'::text AS relation_kind
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  JOIN pg_class target ON target.oid = con.confrelid
  JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
  JOIN pg_attribute src
    ON src.attrelid = con.conrelid
   AND src.attnum = ANY(con.conkey)
  JOIN pg_attribute dst
    ON dst.attrelid = con.confrelid
   AND dst.attnum = ANY(con.confkey)
  WHERE con.contype = 'f'
    AND target_ns.nspname = 'public'
    AND target.relname = 'works'
    AND dst.attname = 'id'
    AND array_length(con.conkey, 1) = 1
    AND array_length(con.confkey, 1) = 1
), heuristic AS (
  SELECT
    c.table_schema,
    c.table_name,
    c.column_name,
    'heuristic_work_id_column'::text AS relation_kind
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name <> 'works'
    AND (
      c.table_name LIKE 'works\_%' ESCAPE '\'
      OR c.table_name = '_works_v'
    )
    AND c.column_name IN ('_parent_id', 'parent_id', 'work_id', 'works_id')
    AND c.data_type IN ('integer', 'bigint', 'smallint')
    AND NOT EXISTS (
      SELECT 1
      FROM foreign_keys fk
      WHERE fk.table_schema = c.table_schema
        AND fk.table_name = c.table_name
        AND fk.column_name = c.column_name
    )
)
SELECT json_build_object(
  'tableSchema', locator.table_schema,
  'tableName', locator.table_name,
  'columnName', locator.column_name,
  'relationKind', locator.relation_kind
)::text AS json_text
FROM (
  SELECT * FROM foreign_keys
  UNION ALL
  SELECT * FROM heuristic
) AS locator
ORDER BY locator.table_schema, locator.table_name, locator.column_name
'@
)
$workLocators = @($workLocatorLines | ForEach-Object { $_ | ConvertFrom-Json -Depth 20 })
$workLocators | ConvertTo-Json -Depth 20 |
  Set-Content -LiteralPath (Join-Path $outDir 'relation-locators.json') -Encoding UTF8

$relatedRows = @()
foreach ($locator in $workLocators) {
  $schemaName = [string]$locator.tableSchema
  $tableName = [string]$locator.tableName
  $columnName = [string]$locator.columnName
  $relationKind = [string]$locator.relationKind
  $qualifiedTable = (Quote-Identifier $schemaName) + '.' + (Quote-Identifier $tableName)
  $quotedColumn = Quote-Identifier $columnName
  $schemaLiteral = Quote-SqlLiteral $schemaName
  $tableLiteral = Quote-SqlLiteral $tableName
  $columnLiteral = Quote-SqlLiteral $columnName
  $kindLiteral = Quote-SqlLiteral $relationKind

  $relatedRows += @(
    Invoke-ReadOnlyJsonQuery -JsonSql @"
SELECT json_build_object(
  'relationKind', $kindLiteral,
  'tableSchema', $schemaLiteral,
  'tableName', $tableLiteral,
  'columnName', $columnLiteral,
  'row', to_jsonb(t)
)::text AS json_text
FROM $qualifiedTable t
WHERE t.$quotedColumn IN ($idsSql)
ORDER BY t.$quotedColumn, to_jsonb(t)::text
"@
  )
}
Write-Utf8Lines -Path (Join-Path $outDir 'related-rows.jsonl') -Lines ([string[]]$relatedRows)

$versionParentLocator = @(
  $workLocators | Where-Object { [string]$_.tableName -eq '_works_v' }
) | Select-Object -First 1

$versionLocatorLines = @()
$versionRelatedRows = @()
if ($null -ne $versionParentLocator) {
  $versionParentColumn = [string]$versionParentLocator.columnName
  $versionParentQuoted = Quote-Identifier $versionParentColumn

  $versionLocatorLines = @(
    Invoke-ReadOnlyJsonQuery -JsonSql @'
WITH foreign_keys AS (
  SELECT
    ns.nspname AS table_schema,
    rel.relname AS table_name,
    src.attname AS column_name,
    'foreign_key_to_work_version'::text AS relation_kind
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  JOIN pg_class target ON target.oid = con.confrelid
  JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
  JOIN pg_attribute src
    ON src.attrelid = con.conrelid
   AND src.attnum = ANY(con.conkey)
  JOIN pg_attribute dst
    ON dst.attrelid = con.confrelid
   AND dst.attnum = ANY(con.confkey)
  WHERE con.contype = 'f'
    AND target_ns.nspname = 'public'
    AND target.relname = '_works_v'
    AND dst.attname = 'id'
    AND array_length(con.conkey, 1) = 1
    AND array_length(con.confkey, 1) = 1
), heuristic AS (
  SELECT
    c.table_schema,
    c.table_name,
    c.column_name,
    'heuristic_work_version_id_column'::text AS relation_kind
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name LIKE '\_works\_v\_%' ESCAPE '\'
    AND c.column_name IN ('_parent_id', 'parent_id', 'version_id')
    AND c.data_type IN ('integer', 'bigint', 'smallint')
    AND NOT EXISTS (
      SELECT 1
      FROM foreign_keys fk
      WHERE fk.table_schema = c.table_schema
        AND fk.table_name = c.table_name
        AND fk.column_name = c.column_name
    )
)
SELECT json_build_object(
  'tableSchema', locator.table_schema,
  'tableName', locator.table_name,
  'columnName', locator.column_name,
  'relationKind', locator.relation_kind
)::text AS json_text
FROM (
  SELECT * FROM foreign_keys
  UNION ALL
  SELECT * FROM heuristic
) AS locator
ORDER BY locator.table_schema, locator.table_name, locator.column_name
'@
  )
  $versionLocators = @($versionLocatorLines | ForEach-Object { $_ | ConvertFrom-Json -Depth 20 })

  foreach ($locator in $versionLocators) {
    $schemaName = [string]$locator.tableSchema
    $tableName = [string]$locator.tableName
    $columnName = [string]$locator.columnName
    $relationKind = [string]$locator.relationKind
    $qualifiedTable = (Quote-Identifier $schemaName) + '.' + (Quote-Identifier $tableName)
    $quotedColumn = Quote-Identifier $columnName
    $schemaLiteral = Quote-SqlLiteral $schemaName
    $tableLiteral = Quote-SqlLiteral $tableName
    $columnLiteral = Quote-SqlLiteral $columnName
    $kindLiteral = Quote-SqlLiteral $relationKind

    $versionRelatedRows += @(
      Invoke-ReadOnlyJsonQuery -JsonSql @"
SELECT json_build_object(
  'relationKind', $kindLiteral,
  'tableSchema', $schemaLiteral,
  'tableName', $tableLiteral,
  'columnName', $columnLiteral,
  'row', to_jsonb(t)
)::text AS json_text
FROM $qualifiedTable t
WHERE t.$quotedColumn IN (
  SELECT v.id
  FROM public."_works_v" v
  WHERE v.$versionParentQuoted IN ($idsSql)
)
ORDER BY t.$quotedColumn, to_jsonb(t)::text
"@
    )
  }
}

$versionLocators = @($versionLocatorLines | ForEach-Object { $_ | ConvertFrom-Json -Depth 20 })
$versionLocators | ConvertTo-Json -Depth 20 |
  Set-Content -LiteralPath (Join-Path $outDir 'version-relation-locators.json') -Encoding UTF8
Write-Utf8Lines -Path (Join-Path $outDir 'version-related-rows.jsonl') -Lines ([string[]]$versionRelatedRows)

$validation = [ordered]@{
  transport = 'postgres_utf8_base64_to_powershell_utf8'
  jsonValidated = $true
  sourceDryRunManifestValidated = $true
  identityAlertGroups = $alerts.Count
  workIds = $workIds
  workRows = $workRows.Count
  relationLocators = $workLocators.Count
  relatedRows = $relatedRows.Count
  versionRelationLocators = $versionLocators.Count
  versionRelatedRows = $versionRelatedRows.Count
  databaseWrite = $false
  payloadWrite = $false
  migrationGeneration = $false
  schemaPush = $false
}
$validation | ConvertTo-Json -Depth 30 |
  Set-Content -LiteralPath (Join-Path $outDir 'validation.json') -Encoding UTF8

$summary = @(
  'Canonical Work identity audit complete',
  '',
  "OutputDirectory: $outDir",
  "IdentityAlertGroups: $($alerts.Count)",
  "WorkIds: $($workIds -join ', ')",
  "WorkRows: $($workRows.Count)",
  "RelationLocators: $($workLocators.Count)",
  "RelatedRows: $($relatedRows.Count)",
  "VersionRelationLocators: $($versionLocators.Count)",
  "VersionRelatedRows: $($versionRelatedRows.Count)",
  'Transport: PostgreSQL UTF-8 -> Base64 -> PowerShell UTF-8',
  'JsonValidation: Passed',
  '',
  'DatabaseWrite: False',
  'PayloadWrite: False',
  'MigrationGeneration: False',
  'SchemaPush: False',
  'TrackedFileWrite: False'
)
Write-Utf8Lines -Path (Join-Path $outDir 'summary.txt') -Lines ([string[]]$summary)

$summary | ForEach-Object { Write-Host $_ }
