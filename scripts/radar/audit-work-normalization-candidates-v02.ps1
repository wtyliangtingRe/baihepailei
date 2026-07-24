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
  Join-Path (Get-Location) "exports\work-normalization-candidates-$stamp"
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

function Write-Utf8Lines {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Lines
  )
  [System.IO.File]::WriteAllLines($Path, $Lines, [System.Text.UTF8Encoding]::new($false))
}

$humanCandidates = @(
  Invoke-ReadOnlyJsonQuery -JsonSql @'
SELECT row_to_json(candidate)::text AS json_text
FROM (
  SELECT
    id,
    title,
    slug,
    rank::text AS rank,
    human_assessment_grade::text AS canonical_grade,
    human_assessment_status::text AS canonical_status,
    human_assessment_note AS canonical_note,
    human_assessment_source_summary AS canonical_source_summary,
    human_assessment_evidence_status::text AS canonical_evidence_status,
    human_assessment_assessed_at AS canonical_assessed_at,
    human_assessment_assessed_by_id AS canonical_assessed_by_id,
    review_status::text AS legacy_status,
    human_review_note AS legacy_note,
    human_reviewed_at AS legacy_reviewed_at,
    human_reviewed_by_id AS legacy_reviewed_by_id,
    CASE
      WHEN human_assessment_grade IS NOT NULL
        AND rank::text IS DISTINCT FROM human_assessment_grade::text
        THEN true ELSE false
    END AS rank_grade_conflict,
    CASE
      WHEN human_assessment_note IS NOT NULL
        AND human_review_note IS NOT NULL
        AND human_assessment_note IS DISTINCT FROM human_review_note
        THEN true ELSE false
    END AS note_conflict,
    CASE
      WHEN human_assessment_status IS NOT NULL
        AND review_status IS NOT NULL
        AND human_assessment_status::text IS DISTINCT FROM review_status::text
        THEN true ELSE false
    END AS status_conflict,
    CASE
      WHEN human_assessment_grade IS NULL
        AND human_assessment_note IS NULL
        AND human_assessment_source_summary IS NULL
        AND human_assessment_evidence_status IS NULL
        AND human_assessment_assessed_at IS NULL
        AND human_assessment_assessed_by_id IS NULL
        AND (
          review_status::text <> 'pending'
          OR NULLIF(human_review_note, '') IS NOT NULL
          OR human_reviewed_at IS NOT NULL
          OR human_reviewed_by_id IS NOT NULL
        )
        THEN 'copy_non_conflicting_legacy_into_canonical'
      WHEN (
          human_assessment_grade IS NOT NULL
          OR NULLIF(human_assessment_note, '') IS NOT NULL
          OR NULLIF(human_assessment_source_summary, '') IS NOT NULL
          OR human_assessment_evidence_status IS NOT NULL
          OR human_assessment_assessed_at IS NOT NULL
          OR human_assessment_assessed_by_id IS NOT NULL
        )
        AND (
          review_status::text <> 'pending'
          OR NULLIF(human_review_note, '') IS NOT NULL
          OR human_reviewed_at IS NOT NULL
          OR human_reviewed_by_id IS NOT NULL
        )
        THEN 'compare_canonical_and_legacy'
      ELSE 'canonical_only'
    END AS proposed_action
  FROM public.works
  WHERE
    human_assessment_grade IS NOT NULL
    OR NULLIF(human_assessment_note, '') IS NOT NULL
    OR NULLIF(human_assessment_source_summary, '') IS NOT NULL
    OR human_assessment_evidence_status IS NOT NULL
    OR human_assessment_assessed_at IS NOT NULL
    OR human_assessment_assessed_by_id IS NOT NULL
    OR review_status::text <> 'pending'
    OR NULLIF(human_review_note, '') IS NOT NULL
    OR human_reviewed_at IS NOT NULL
    OR human_reviewed_by_id IS NOT NULL
  ORDER BY id
) AS candidate
'@
)
$humanPath = Join-Path $outDir 'human-normalization-candidates.jsonl'
Write-Utf8Lines -Path $humanPath -Lines ([string[]]$humanCandidates)

$schemaExceptions = @(
  Invoke-ReadOnlyJsonQuery -JsonSql @'
SELECT row_to_json(candidate)::text AS json_text
FROM (
  SELECT
    id,
    title,
    slug,
    status AS legacy_status,
    _status AS payload_status,
    catalog_status::text AS catalog_status,
    legacy_x_wiki_page,
    CASE
      WHEN status NOT IN ('draft', 'published') THEN 'invalid_legacy_status'
      WHEN status IS DISTINCT FROM _status THEN 'legacy_status_disagrees_with_payload_status'
      ELSE 'legacy_status_redundant'
    END AS status_finding
  FROM public.works
  WHERE
    status NOT IN ('draft', 'published')
    OR legacy_x_wiki_page IS NOT NULL
  ORDER BY id
) AS candidate
'@
)
$schemaPath = Join-Path $outDir 'schema-retirement-exceptions.jsonl'
Write-Utf8Lines -Path $schemaPath -Lines ([string[]]$schemaExceptions)

$rankCandidates = @(
  Invoke-ReadOnlyJsonQuery -JsonSql @'
SELECT row_to_json(candidate)::text AS json_text
FROM (
  SELECT
    id,
    title,
    slug,
    updated_at,
    _status AS payload_status,
    catalog_status::text AS catalog_status,
    import_batch,
    chosen_base_source,
    rating_notice::text AS rating_notice,
    evidence_strength::text AS evidence_strength,
    rank::text AS stored_rank,
    human_assessment_grade::text AS human_grade,
    human_assessment_status::text AS human_status,
    radar_assessment_suggested_grade::text AS private_ai_grade,
    radar_assessment_source_summary AS private_ai_source_summary,
    radar_assessment_policy_version AS private_ai_policy_version,
    radar_assessment_assessment_batch AS private_ai_assessment_batch,
    radar_assessment_assessed_at AS private_ai_assessed_at,
    CASE
      WHEN human_assessment_grade IS NOT NULL
        AND human_assessment_status::text IN ('reviewed', 'disputed')
        THEN human_assessment_grade::text
      ELSE 'unknown'
    END AS grade_without_public_ai,
    CASE
      WHEN human_assessment_grade IS NOT NULL
        AND human_assessment_status::text IN ('reviewed', 'disputed')
        THEN 'human'
      ELSE 'none'
    END AS source_without_public_ai,
    CASE
      WHEN human_assessment_grade IS NOT NULL
        AND human_assessment_status::text IN ('reviewed', 'disputed')
        THEN 'canonical_human'
      WHEN radar_assessment_suggested_grade IS NOT NULL
        THEN 'private_ai_requires_publication_review'
      WHEN rank::text <> 'unknown'
        THEN 'legacy_rank_provenance_unknown'
      ELSE 'no_effective_grade_source'
    END AS preservation_class
  FROM public.works
  WHERE rank::text <> 'unknown'
     OR human_assessment_grade IS NOT NULL
     OR radar_assessment_suggested_grade IS NOT NULL
  ORDER BY id
) AS candidate
'@
)
$rankPath = Join-Path $outDir 'rank-retirement-candidates.jsonl'
Write-Utf8Lines -Path $rankPath -Lines ([string[]]$rankCandidates)

$counts = @(
  Invoke-ReadOnlyJsonQuery -JsonSql @'
SELECT json_build_object(
  'worksTotal', COUNT(*),
  'meaningfulLegacyHumanRows', COUNT(*) FILTER (
    WHERE review_status::text <> 'pending'
       OR NULLIF(human_review_note, '') IS NOT NULL
       OR human_reviewed_at IS NOT NULL
       OR human_reviewed_by_id IS NOT NULL
  ),
  'meaningfulCanonicalHumanRows', COUNT(*) FILTER (
    WHERE human_assessment_grade IS NOT NULL
       OR NULLIF(human_assessment_note, '') IS NOT NULL
       OR NULLIF(human_assessment_source_summary, '') IS NOT NULL
       OR human_assessment_evidence_status IS NOT NULL
       OR human_assessment_assessed_at IS NOT NULL
       OR human_assessment_assessed_by_id IS NOT NULL
  ),
  'rankHumanConflicts', COUNT(*) FILTER (
    WHERE human_assessment_grade IS NOT NULL
      AND rank::text IS DISTINCT FROM human_assessment_grade::text
  ),
  'humanNoteConflicts', COUNT(*) FILTER (
    WHERE NULLIF(human_assessment_note, '') IS NOT NULL
      AND NULLIF(human_review_note, '') IS NOT NULL
      AND human_assessment_note IS DISTINCT FROM human_review_note
  ),
  'humanStatusConflicts', COUNT(*) FILTER (
    WHERE human_assessment_status IS NOT NULL
      AND review_status IS NOT NULL
      AND human_assessment_status::text IS DISTINCT FROM review_status::text
  ),
  'invalidLegacyStatusRows', COUNT(*) FILTER (
    WHERE status NOT IN ('draft', 'published')
  ),
  'legacyXWikiNonNullRows', COUNT(*) FILTER (
    WHERE legacy_x_wiki_page IS NOT NULL
  ),
  'humanSourceLinkRows', (
    SELECT COUNT(*) FROM public.works_human_assessment_source_links
  ),
  'legacyRankProvenanceUnknownRows', COUNT(*) FILTER (
    WHERE rank::text <> 'unknown'
      AND NOT (
        human_assessment_grade IS NOT NULL
        AND human_assessment_status::text IN ('reviewed', 'disputed')
      )
      AND radar_assessment_suggested_grade IS NULL
  ),
  'privateAiGradeRows', COUNT(*) FILTER (
    WHERE radar_assessment_suggested_grade IS NOT NULL
  )
)::text AS json_text
FROM public.works
'@
)
if ($counts.Count -ne 1) {
  throw "计数报告应只有一条 JSON，实际为 $($counts.Count) 条。"
}
$countsPath = Join-Path $outDir 'counts.json'
Write-Utf8Lines -Path $countsPath -Lines ([string[]]$counts)

$validation = [ordered]@{
  transport = 'postgres_utf8_base64_to_powershell_utf8'
  jsonValidated = $true
  humanCandidateRows = $humanCandidates.Count
  schemaExceptionRows = $schemaExceptions.Count
  rankCandidateRows = $rankCandidates.Count
  countsRows = $counts.Count
}
$validationPath = Join-Path $outDir 'validation.json'
$validation | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $validationPath -Encoding utf8

$files = @($humanPath, $schemaPath, $rankPath, $countsPath, $validationPath)
$manifest = @()
foreach ($file in $files) {
  $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
  $manifest += [pscustomobject]@{
    file = Split-Path $file -Leaf
    bytes = (Get-Item -LiteralPath $file).Length
    sha256 = $hash.Hash.ToLowerInvariant()
  }
}
$manifestPath = Join-Path $outDir 'manifest.json'
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

$summary = @(
  'Work normalization candidate audit complete',
  '',
  "OutputDirectory: $outDir",
  "HumanCandidateRows: $($humanCandidates.Count)",
  "SchemaExceptionRows: $($schemaExceptions.Count)",
  "RankCandidateRows: $($rankCandidates.Count)",
  'Transport: PostgreSQL UTF-8 -> Base64 -> PowerShell UTF-8',
  'JsonValidation: Passed',
  '',
  'DatabaseWrite: False',
  'PayloadWrite: False',
  'MigrationGeneration: False',
  'TrackedFileWrite: False'
)
Write-Utf8Lines -Path (Join-Path $outDir 'summary.txt') -Lines ([string[]]$summary)

Write-Host ''
$summary | ForEach-Object { Write-Host $_ }
