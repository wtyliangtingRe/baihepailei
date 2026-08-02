#!/usr/bin/env node
import fs from 'node:fs'

function replaceOnce(text, before, after, label) {
  if (text.includes(after)) return text
  const count = text.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected one target, found ${count}`)
  return text.replace(before, after)
}

function patch(path, transform) {
  const before = fs.readFileSync(path, 'utf8')
  const after = transform(before)
  if (after !== before) fs.writeFileSync(path, after, 'utf8')
}

patch('scripts/radar/lib/radar-unified-rating-incremental-production-9988-v01.ps1', (input) => {
  let text = input
  text = replaceOnce(
    text,
    "  $fingerprintSql = Join-Path $Directory 'protected-fingerprints.sql'\n",
    "  $fingerprintSql = Join-Path $Directory 'protected-fingerprints.sql'\n  $baselineFingerprintSql = Join-Path $Directory 'candidate-baseline-fingerprints.sql'\n",
    'baseline SQL path',
  )
  text = replaceOnce(
    text,
    "  [System.IO.File]::WriteAllText($countSql, $countSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))\n  [System.IO.File]::WriteAllText($fingerprintSql, $fingerprintSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))\n  return [pscustomobject]@{ Counts = $countSql; Fingerprints = $fingerprintSql }\n",
    "  $baselineFingerprintSqlContent = @'\n\\pset tuples_only on\n\\pset format unaligned\nSELECT format('SELECT %L || E''\\t'' || count(*)::text || E''\\t'' || COALESCE(md5(string_agg(row_hash, '''' ORDER BY row_hash)), md5('''')) FROM (SELECT md5(row_to_json(t)::text) AS row_hash FROM %I.%I AS t) AS rows;', schemaname || '.' || tablename, schemaname, tablename)\nFROM pg_tables\nWHERE schemaname = 'public'\n  AND (tablename IN ('works', '_works_v') OR tablename LIKE 'radar_public%' OR tablename LIKE 'radar_research_records%')\nORDER BY tablename\n\\gexec\n'@\n  [System.IO.File]::WriteAllText($countSql, $countSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))\n  [System.IO.File]::WriteAllText($fingerprintSql, $fingerprintSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))\n  [System.IO.File]::WriteAllText($baselineFingerprintSql, $baselineFingerprintSqlContent.TrimStart(), [System.Text.UTF8Encoding]::new($false))\n  return [pscustomobject]@{ Counts = $countSql; Fingerprints = $fingerprintSql; BaselineFingerprints = $baselineFingerprintSql }\n",
    'baseline SQL content',
  )
  text = replaceOnce(
    text,
    "  $fingerprintsPath = Join-Path $Directory \"$Prefix-protected-fingerprints.tsv\"\n",
    "  $fingerprintsPath = Join-Path $Directory \"$Prefix-protected-fingerprints.tsv\"\n  $baselineFingerprintsPath = Join-Path $Directory \"$Prefix-candidate-baseline-fingerprints.tsv\"\n",
    'baseline output path',
  )
  text = replaceOnce(
    text,
    "  Invoke-RadarSqlFile $Container $Database $User $Password $SqlFiles.Fingerprints \"/tmp/$Prefix-fingerprints.sql\" `\n    $fingerprintsPath (Join-Path $Directory \"$Prefix-fingerprints-stderr.txt\") -ReadOnly\n  return [pscustomobject]@{\n    CountsPath = $countsPath\n    FingerprintsPath = $fingerprintsPath\n    Counts = Read-RadarMapFile $countsPath\n    Fingerprints = Read-RadarMapFile $fingerprintsPath\n  }\n",
    "  Invoke-RadarSqlFile $Container $Database $User $Password $SqlFiles.Fingerprints \"/tmp/$Prefix-fingerprints.sql\" `\n    $fingerprintsPath (Join-Path $Directory \"$Prefix-fingerprints-stderr.txt\") -ReadOnly\n  Invoke-RadarSqlFile $Container $Database $User $Password $SqlFiles.BaselineFingerprints \"/tmp/$Prefix-baseline-fingerprints.sql\" `\n    $baselineFingerprintsPath (Join-Path $Directory \"$Prefix-baseline-fingerprints-stderr.txt\") -ReadOnly\n  return [pscustomobject]@{\n    CountsPath = $countsPath\n    FingerprintsPath = $fingerprintsPath\n    BaselineFingerprintsPath = $baselineFingerprintsPath\n    Counts = Read-RadarMapFile $countsPath\n    Fingerprints = Read-RadarMapFile $fingerprintsPath\n    BaselineFingerprints = Read-RadarMapFile $baselineFingerprintsPath\n  }\n",
    'baseline snapshot',
  )
  const databaseGate = `function Assert-RadarIncrementalDatabaseUrl(\n  [string]$DatabaseUrl,\n  [string]$SourcePostgresContainer,\n  [string]$ExpectedDatabase\n) {\n  try { $uri = [Uri]$DatabaseUrl } catch { throw 'DATABASE_URL 无法解析。' }\n  if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw 'DATABASE_URL 必须使用 PostgreSQL。' }\n  if ($uri.Host -notin @('127.0.0.1', 'localhost')) { throw '生产 DATABASE_URL 必须使用 loopback。' }\n  if ($uri.AbsolutePath.Trim('/') -ne $ExpectedDatabase) { throw '生产 DATABASE_URL 数据库名不匹配。' }\n  $publishedPort = ([string](& docker inspect -f '{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}' $SourcePostgresContainer)).Trim()\n  if ($LASTEXITCODE -ne 0 -or $publishedPort -notmatch '^\\d+$') { throw '无法确认源 PostgreSQL host port。' }\n  if ([int]$uri.Port -ne [int]$publishedPort) { throw '生产 DATABASE_URL 端口未指向源 PostgreSQL 容器。' }\n  return $true\n}\n\n`
  text = replaceOnce(
    text,
    'function Assert-RadarIncrementalAuditReport(\n',
    `${databaseGate}function Assert-RadarIncrementalAuditReport(\n`,
    'database identity gate',
  )
  return text
})

patch('scripts/radar/prepare-unified-rating-incremental-production-candidate-9988-v01.ps1', (input) => {
  let text = input
  text = replaceOnce(
    text,
    "  Assert-RadarMapsEqual $sourceBefore.Fingerprints $sourceAfter.Fingerprints '生产候选备份前后 source fingerprints'\n",
    "  Assert-RadarMapsEqual $sourceBefore.Fingerprints $sourceAfter.Fingerprints '生产候选备份前后 source fingerprints'\n  Assert-RadarMapsEqual $sourceBefore.BaselineFingerprints $sourceAfter.BaselineFingerprints '生产候选备份前后 baseline fingerprints'\n",
    'candidate baseline comparison',
  )
  text = replaceOnce(
    text,
    "      protectedFingerprints = Convert-RadarIncrementalMap $sourceBefore.Fingerprints\n      countsPath = $sourceBefore.CountsPath\n",
    "      protectedFingerprints = Convert-RadarIncrementalMap $sourceBefore.Fingerprints\n      baselineFingerprints = Convert-RadarIncrementalMap $sourceBefore.BaselineFingerprints\n      countsPath = $sourceBefore.CountsPath\n",
    'candidate inline baseline',
  )
  text = replaceOnce(
    text,
    "      fingerprintsPath = $sourceBefore.FingerprintsPath\n      fingerprintsSha256 = Get-RadarIncrementalFileSha $sourceBefore.FingerprintsPath\n",
    "      fingerprintsPath = $sourceBefore.FingerprintsPath\n      fingerprintsSha256 = Get-RadarIncrementalFileSha $sourceBefore.FingerprintsPath\n      baselineFingerprintsPath = $sourceBefore.BaselineFingerprintsPath\n      baselineFingerprintsSha256 = Get-RadarIncrementalFileSha $sourceBefore.BaselineFingerprintsPath\n",
    'candidate baseline paths',
  )
  text = replaceOnce(
    text,
    "    protectedFingerprintsUnchangedDuringBackup = $true\n",
    "    protectedFingerprintsUnchangedDuringBackup = $true\n    baselineFingerprintsUnchangedDuringBackup = $true\n",
    'candidate receipt baseline',
  )
  return text
})

patch('scripts/radar/run-unified-rating-incremental-production-apply-once-9988-v01.ps1', (input) => {
  let text = input
  text = replaceOnce(
    text,
    "if ([string]::IsNullOrWhiteSpace($databaseUrl) -or $databaseUrl -notmatch '^postgres(?:ql)?://') {\n  throw '无法读取本地生产 DATABASE_URL。'\n}\n",
    "if ([string]::IsNullOrWhiteSpace($databaseUrl) -or $databaseUrl -notmatch '^postgres(?:ql)?://') {\n  throw '无法读取本地生产 DATABASE_URL。'\n}\nAssert-RadarIncrementalDatabaseUrl $databaseUrl $SourcePostgresContainer ([string]$candidate.source.database) | Out-Null\n",
    'database URL gate call',
  )
  text = replaceOnce(
    text,
    "  Assert-RadarMapsEqual `\n    (Convert-RadarIncrementalObjectToMap $candidate.source.protectedFingerprints) $sourceBefore.Fingerprints `\n    'Production Candidate source protected fingerprints'\n",
    "  Assert-RadarMapsEqual `\n    (Convert-RadarIncrementalObjectToMap $candidate.source.protectedFingerprints) $sourceBefore.Fingerprints `\n    'Production Candidate source protected fingerprints'\n  Assert-RadarMapsEqual `\n    (Convert-RadarIncrementalObjectToMap $candidate.source.baselineFingerprints) $sourceBefore.BaselineFingerprints `\n    'Production Candidate source baseline fingerprints'\n",
    'pre-apply baseline comparison',
  )
  return text
})

patch('tests/radar-unified-rating-incremental-production-gates-9988-v01.test.mjs', (input) => {
  let text = input
  text = replaceOnce(
    text,
    "  assert.match(library, /生产 apply 前后表集合发生变化/)\n",
    "  assert.match(library, /生产 apply 前后表集合发生变化/)\n  assert.match(library, /candidate-baseline-fingerprints\\.sql/)\n  assert.match(library, /BaselineFingerprints = Read-RadarMapFile/)\n  assert.match(library, /生产 DATABASE_URL 必须使用 loopback/)\n  assert.match(library, /DATABASE_URL 端口未指向源 PostgreSQL 容器/)\n",
    'library test hardening',
  )
  text = replaceOnce(
    text,
    "  assert.match(prepare, /protectedFingerprintsUnchangedDuringBackup = \\$true/)\n",
    "  assert.match(prepare, /protectedFingerprintsUnchangedDuringBackup = \\$true/)\n  assert.match(prepare, /baselineFingerprintsUnchangedDuringBackup = \\$true/)\n  assert.match(prepare, /baselineFingerprints = Convert-RadarIncrementalMap/)\n",
    'prepare test hardening',
  )
  text = replaceOnce(
    text,
    "  assert.match(applyOnce, /Production Candidate source protected fingerprints/)\n",
    "  assert.match(applyOnce, /Production Candidate source protected fingerprints/)\n  assert.match(applyOnce, /Production Candidate source baseline fingerprints/)\n  assert.match(applyOnce, /Assert-RadarIncrementalDatabaseUrl/)\n",
    'apply test hardening',
  )
  return text
})
