param(
  [Parameter(Mandatory = $true)][string]$DryRunV03Directory,
  [Parameter(Mandatory = $true)][string]$BackupVerificationDirectory,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe'
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

function Quote-SqlLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Write-Utf8Lines {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Lines
  )
  [System.IO.File]::WriteAllLines($Path, $Lines, [System.Text.UTF8Encoding]::new($false))
}

$dryRunDir = Resolve-RepoPath $DryRunV03Directory 'merge dry-run v03 目录'
$backupDir = Resolve-RepoPath $BackupVerificationDirectory '备份恢复验证目录'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-write-schema-audit-$stamp"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-WRITE-SCHEMA-AUDIT-$stamp.zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$targetBuilder = Join-Path $PSScriptRoot 'build-test-work-write-schema-targets-v01.mjs'
$summaryBuilder = Join-Path $PSScriptRoot 'build-test-work-write-schema-summary-v01.mjs'
$targetsPath = Join-Path $outDir 'write-schema-targets.json'

& node $targetBuilder `
  --dryrun-v03-dir $dryRunDir `
  --backup-verification-dir $backupDir `
  --output $targetsPath
if ($LASTEXITCODE -ne 0) {
  throw '写目标表推导失败。'
}

$targets = Get-Content -LiteralPath $targetsPath -Raw -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
if ($targets.safety.databaseWrite -ne $false -or
    $targets.safety.executableTransactionSqlGenerated -ne $false -or
    $targets.localBackup.restoreVerified -ne $true) {
  throw '写目标输入未绑定已验证备份或安全边界。'
}

$targetRows = @($targets.writeTargets)
if ($targetRows.Count -lt 1) {
  throw '没有可审计的写目标表。'
}
$targetValues = @(
  $targetRows | ForEach-Object {
    '(' + (Quote-SqlLiteral ([string]$_.tableSchema)) + ', ' + (Quote-SqlLiteral ([string]$_.tableName)) + ')'
  }
) -join ",`n    "

$sqlPath = Join-Path $outDir 'write-schema-audit-readonly.sql'
$sql = @"
BEGIN TRANSACTION READ ONLY;

WITH targets(table_schema, table_name) AS (
  VALUES
    $targetValues
)
SELECT 'table-metadata' AS dataset,
       replace(encode(convert_to(json_build_object(
         'tableSchema', ns.nspname,
         'tableName', c.relname,
         'relationKind', c.relkind,
         'persistence', c.relpersistence,
         'rowLevelSecurityEnabled', c.relrowsecurity,
         'rowLevelSecurityForced', c.relforcerowsecurity,
         'owner', pg_get_userbyid(c.relowner)
       )::text, 'UTF8'), 'base64'), E'\n', '') AS payload
FROM targets t
JOIN pg_namespace ns ON ns.nspname = t.table_schema
JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = t.table_name
ORDER BY ns.nspname, c.relname;

WITH targets(table_schema, table_name) AS (
  VALUES
    $targetValues
)
SELECT 'column-metadata' AS dataset,
       replace(encode(convert_to(json_build_object(
         'tableSchema', ns.nspname,
         'tableName', c.relname,
         'ordinal', a.attnum,
         'columnName', a.attname,
         'typeSql', format_type(a.atttypid, a.atttypmod),
         'typeSchema', type_ns.nspname,
         'typeName', typ.typname,
         'typeKind', typ.typtype,
         'notNull', a.attnotnull,
         'hasDefault', a.atthasdef,
         'defaultExpression', pg_get_expr(ad.adbin, ad.adrelid),
         'identity', a.attidentity,
         'generated', a.attgenerated,
         'collation', coll.collname
       )::text, 'UTF8'), 'base64'), E'\n', '') AS payload
FROM targets t
JOIN pg_namespace ns ON ns.nspname = t.table_schema
JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = t.table_name
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_type typ ON typ.oid = a.atttypid
JOIN pg_namespace type_ns ON type_ns.oid = typ.typnamespace
LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
ORDER BY ns.nspname, c.relname, a.attnum;

WITH targets(table_schema, table_name) AS (
  VALUES
    $targetValues
)
SELECT 'constraints' AS dataset,
       replace(encode(convert_to(json_build_object(
         'tableSchema', ns.nspname,
         'tableName', c.relname,
         'constraintName', con.conname,
         'constraintType', con.contype,
         'definition', pg_get_constraintdef(con.oid, true),
         'deferrable', con.condeferrable,
         'initiallyDeferred', con.condeferred,
         'validated', con.convalidated,
         'referencedTableSchema', ref_ns.nspname,
         'referencedTableName', ref.relname
       )::text, 'UTF8'), 'base64'), E'\n', '') AS payload
FROM targets t
JOIN pg_namespace ns ON ns.nspname = t.table_schema
JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = t.table_name
JOIN pg_constraint con ON con.conrelid = c.oid
LEFT JOIN pg_class ref ON ref.oid = con.confrelid
LEFT JOIN pg_namespace ref_ns ON ref_ns.oid = ref.relnamespace
ORDER BY ns.nspname, c.relname, con.contype, con.conname;

WITH targets(table_schema, table_name) AS (
  VALUES
    $targetValues
)
SELECT 'indexes' AS dataset,
       replace(encode(convert_to(json_build_object(
         'tableSchema', ns.nspname,
         'tableName', c.relname,
         'indexName', idx.relname,
         'isUnique', i.indisunique,
         'isPrimary', i.indisprimary,
         'isValid', i.indisvalid,
         'isReady', i.indisready,
         'definition', pg_get_indexdef(i.indexrelid),
         'predicate', pg_get_expr(i.indpred, i.indrelid)
       )::text, 'UTF8'), 'base64'), E'\n', '') AS payload
FROM targets t
JOIN pg_namespace ns ON ns.nspname = t.table_schema
JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = t.table_name
JOIN pg_index i ON i.indrelid = c.oid
JOIN pg_class idx ON idx.oid = i.indexrelid
ORDER BY ns.nspname, c.relname, idx.relname;

WITH targets(table_schema, table_name) AS (
  VALUES
    $targetValues
)
SELECT 'triggers' AS dataset,
       replace(encode(convert_to(json_build_object(
         'tableSchema', ns.nspname,
         'tableName', c.relname,
         'triggerName', trg.tgname,
         'enabled', trg.tgenabled,
         'isInternal', trg.tgisinternal,
         'definition', pg_get_triggerdef(trg.oid, true)
       )::text, 'UTF8'), 'base64'), E'\n', '') AS payload
FROM targets t
JOIN pg_namespace ns ON ns.nspname = t.table_schema
JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = t.table_name
JOIN pg_trigger trg ON trg.tgrelid = c.oid
ORDER BY ns.nspname, c.relname, trg.tgname;

WITH targets(table_schema, table_name) AS (
  VALUES
    $targetValues
)
SELECT 'policies' AS dataset,
       replace(encode(convert_to(json_build_object(
         'tableSchema', ns.nspname,
         'tableName', c.relname,
         'policyName', pol.polname,
         'command', pol.polcmd,
         'permissive', pol.polpermissive,
         'roles', ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles) ORDER BY rolname),
         'usingExpression', pg_get_expr(pol.polqual, pol.polrelid),
         'checkExpression', pg_get_expr(pol.polwithcheck, pol.polrelid)
       )::text, 'UTF8'), 'base64'), E'\n', '') AS payload
FROM targets t
JOIN pg_namespace ns ON ns.nspname = t.table_schema
JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = t.table_name
JOIN pg_policy pol ON pol.polrelid = c.oid
ORDER BY ns.nspname, c.relname, pol.polname;

WITH targets(table_schema, table_name) AS (
  VALUES
    $targetValues
)
SELECT 'enum-labels' AS dataset,
       replace(encode(convert_to(json_build_object(
         'tableSchema', ns.nspname,
         'tableName', c.relname,
         'columnName', a.attname,
         'enumTypeSchema', type_ns.nspname,
         'enumTypeName', typ.typname,
         'sortOrder', en.enumsortorder,
         'label', en.enumlabel
       )::text, 'UTF8'), 'base64'), E'\n', '') AS payload
FROM targets t
JOIN pg_namespace ns ON ns.nspname = t.table_schema
JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = t.table_name
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_type typ ON typ.oid = a.atttypid AND typ.typtype = 'e'
JOIN pg_namespace type_ns ON type_ns.oid = typ.typnamespace
JOIN pg_enum en ON en.enumtypid = typ.oid
ORDER BY ns.nspname, c.relname, a.attnum, en.enumsortorder;

WITH targets(table_schema, table_name) AS (
  VALUES
    $targetValues
), target_columns AS (
  SELECT ns.nspname AS table_schema, c.relname AS table_name, a.attname AS column_name
  FROM targets t
  JOIN pg_namespace ns ON ns.nspname = t.table_schema
  JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = t.table_name
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT 'sequence-metadata' AS dataset,
       replace(encode(convert_to(json_build_object(
         'tableSchema', tc.table_schema,
         'tableName', tc.table_name,
         'columnName', tc.column_name,
         'sequenceName', pg_get_serial_sequence(format('%I.%I', tc.table_schema, tc.table_name), tc.column_name)
       )::text, 'UTF8'), 'base64'), E'\n', '') AS payload
FROM target_columns tc
WHERE pg_get_serial_sequence(format('%I.%I', tc.table_schema, tc.table_name), tc.column_name) IS NOT NULL
ORDER BY tc.table_schema, tc.table_name, tc.column_name;

ROLLBACK;
"@
[System.IO.File]::WriteAllText(
  $sqlPath,
  ($sql.Trim() + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)

if ($sql -notmatch '^BEGIN TRANSACTION READ ONLY;' -or
    $sql -notmatch 'ROLLBACK;\s*$' -or
    $sql -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b') {
  throw '写目标 schema 审计 SQL 不是纯只读 SQL。'
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker 不可用。'
}
$running = (& docker inspect -f '{{.State.Running}}' $PostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
  throw "PostgreSQL 容器未运行：$PostgresContainer"
}

$containerSql = "/tmp/test-work-write-schema-audit-$stamp.sql"
$rawStdout = Join-Path $outDir 'postgres-stdout.tsv'
$rawStderr = Join-Path $outDir 'postgres-stderr.txt'
$tempRemoved = $false
try {
  & docker cp $sqlPath "${PostgresContainer}:$containerSql"
  if ($LASTEXITCODE -ne 0) {
    throw '复制写目标 schema 审计 SQL 到 PostgreSQL 容器失败。'
  }

  & docker exec `
    -e 'PGOPTIONS=-c default_transaction_read_only=on -c client_min_messages=warning' `
    -e 'PGCLIENTENCODING=UTF8' `
    $PostgresContainer `
    psql `
    -X `
    -qAt `
    -v ON_ERROR_STOP=1 `
    -F "`t" `
    -U $DatabaseUser `
    -d $Database `
    -f $containerSql `
    1> $rawStdout `
    2> $rawStderr
  if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL 写目标 schema 只读审计失败。'
  }
} finally {
  & docker exec $PostgresContainer rm -f $containerSql *> $null
  $tempRemoved = ($LASTEXITCODE -eq 0)
}
if (-not $tempRemoved) {
  throw 'PostgreSQL 容器临时 schema 审计 SQL 未确认删除。'
}

$datasets = [ordered]@{
  'table-metadata' = 'table-metadata.jsonl'
  'column-metadata' = 'column-metadata.jsonl'
  'constraints' = 'constraints.jsonl'
  'indexes' = 'indexes.jsonl'
  'triggers' = 'triggers.jsonl'
  'policies' = 'policies.jsonl'
  'enum-labels' = 'enum-labels.jsonl'
  'sequence-metadata' = 'sequence-metadata.jsonl'
}
$linesByDataset = @{}
foreach ($key in $datasets.Keys) {
  $linesByDataset[$key] = [System.Collections.Generic.List[string]]::new()
}

$lineNumber = 0
foreach ($line in Get-Content -LiteralPath $rawStdout -Encoding UTF8) {
  $lineNumber += 1
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $parts = $line -split "`t", 2
  if ($parts.Count -ne 2 -or -not $datasets.Contains($parts[0])) {
    throw "无效 schema 审计输出：line $lineNumber"
  }
  try {
    $bytes = [System.Convert]::FromBase64String($parts[1].Trim())
    $json = [System.Text.Encoding]::UTF8.GetString($bytes)
    $null = $json | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    $linesByDataset[$parts[0]].Add($json)
  } catch {
    throw "schema 审计 UTF-8/Base64 JSON 解码失败：line $lineNumber"
  }
}
foreach ($key in $datasets.Keys) {
  Write-Utf8Lines `
    -Path (Join-Path $outDir $datasets[$key]) `
    -Lines ([string[]]$linesByDataset[$key].ToArray())
}

$stderrMeaningful = @(
  Get-Content -LiteralPath $rawStderr -Encoding UTF8 |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
if ($stderrMeaningful.Count -gt 0) {
  throw "PostgreSQL schema 审计 stderr 非空：$($stderrMeaningful.Count) 行"
}

$validation = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  transport = 'postgres_utf8_base64_to_powershell_utf8'
  jsonValidated = $true
  postgresReadOnly = $true
  defaultTransactionReadOnly = $true
  databaseWrite = $false
  payloadWrite = $false
  migrationGeneration = $false
  schemaPush = $false
  executableTransactionSqlGenerated = $false
  mergePerformed = $false
  backupFileModified = $false
  containerTempFileWrite = $true
  containerTempFileRemoved = $tempRemoved
  targetTables = $targetRows.Count
}
$validation | ConvertTo-Json -Depth 30 |
  Set-Content -LiteralPath (Join-Path $outDir 'validation.json') -Encoding UTF8

& node $summaryBuilder --directory $outDir
if ($LASTEXITCODE -ne 0) {
  throw '写目标 schema 审计汇总失败。'
}

$summary = Get-Content `
  -LiteralPath (Join-Path $outDir 'write-schema-audit-summary.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100
if ($summary.safety.databaseWrite -ne $false -or
    $summary.safety.executableTransactionSqlGenerated -ne $false -or
    $summary.safety.mergePerformed -ne $false) {
  throw '写目标 schema 审计未证明安全边界。'
}

$manifest = Get-Content `
  -LiteralPath (Join-Path $outDir 'manifest.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 50
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
Write-Host 'Test Work 写目标 schema / 约束只读审计完成' -ForegroundColor Green
Write-Host "DryRunV03Directory       : $dryRunDir"
Write-Host "BackupVerificationDir    : $backupDir"
Write-Host "OutputDirectory          : $outDir"
Write-Host "Bundle                   : $bundlePath"
Write-Host "SHA256                   : $($bundleHash.Hash)"
Write-Host "WriteTargetTables        : $($summary.writeTargetTables)"
Write-Host "AuditedColumns           : $($summary.auditedColumns)"
Write-Host "Constraints              : $($summary.auditedConstraints)"
Write-Host "Indexes                  : $($summary.auditedIndexes)"
Write-Host "EnabledUserTriggers      : $($summary.enabledUserTriggers)"
Write-Host "RowPolicies              : $($summary.auditedPolicies)"
Write-Host "EnumLabels               : $($summary.auditedEnumLabels)"
Write-Host "Blockers                 : $($summary.blockers.Count)"
Write-Host "Warnings                 : $($summary.warnings.Count)"
Write-Host "ReadyForTransactionPlan  : $($summary.readyForTransactionSqlPlanning)"
Write-Host ''
Write-Host 'PostgreSQLReadOnly       : True'
Write-Host 'DatabaseWrite            : False'
Write-Host 'PayloadWrite             : False'
Write-Host 'ExecutableTransactionSQL : False'
Write-Host 'MergePerformed           : False'
Write-Host 'BackupFileModified       : False'
