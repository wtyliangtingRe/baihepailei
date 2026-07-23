#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const EXPECTED_AUDIT_SHA256 = '7877020d0314352531290be0d4e334d2b17e18e6f552591dd14e30431f7837ba'
const EXPECTED_SCHEMA_REVIEW_SHA256 = '297fed9ab54675748e5ae0dd812cfa4ac367966d12e7732541913223d74ac0fb'
const EXPECTED_READY_SHA256 = '95111c7a01fc5c56efd58a9ed03a2c446ec831d1b6fe3ce6822a9bdfafc1258f'
const EXPECTED_ROWS = 9000
const EXPECTED_GRADES = { S: 8, A: 267, B: 675, C: 868, D: 7032, E: 138, F: 12 }
const INPUT_PATH_IN_CONTAINER = '/tmp/public-ai-ready.jsonl'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) out[key] = true
    else { out[key] = next; i += 1 }
  }
  return out
}

function required(args, key) {
  const value = String(args[key] || '').trim()
  if (!value) throw new Error(`Required: --${key}`)
  return value
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) }
    catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  })
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function write(file, value) {
  fs.writeFileSync(file, value.endsWith('\n') ? value : `${value}\n`, 'utf8')
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function assertManifest(directory) {
  const manifest = readJson(path.join(directory, 'manifest.json'))
  for (const entry of manifest) {
    const file = path.join(directory, String(entry.file))
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${entry.file}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) throw new Error(`Manifest bytes mismatch: ${entry.file}`)
    if (sha256File(file) !== String(entry.sha256).toLowerCase()) throw new Error(`Manifest hash mismatch: ${entry.file}`)
  }
}

function md5Sorted(values) {
  return crypto.createHash('md5').update([...values].sort().join('\n')).digest('hex')
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function checkLine(name, actualSql, expectedSql) {
  return `SELECT ${sqlString(name)} || E'\\t' || (${actualSql})::text || E'\\t' || (${expectedSql})::text || E'\\t' || ((${actualSql}) = (${expectedSql}))::text;`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const auditDir = path.resolve(required(args, 'audit-dir'))
  const reviewDir = path.resolve(required(args, 'schema-review-dir'))
  const outDir = path.resolve(required(args, 'out-dir'))
  const auditZipSha256 = required(args, 'audit-zip-sha256').toLowerCase()
  const reviewZipSha256 = required(args, 'schema-review-zip-sha256').toLowerCase()

  if (auditZipSha256 !== EXPECTED_AUDIT_SHA256) throw new Error('Audit ZIP SHA-256 mismatch.')
  if (reviewZipSha256 !== EXPECTED_SCHEMA_REVIEW_SHA256) throw new Error('Schema review ZIP SHA-256 mismatch.')
  assertManifest(auditDir)
  assertManifest(reviewDir)

  const readyPath = path.join(auditDir, 'public-ai-ready.jsonl')
  const reviewSummary = readJson(path.join(reviewDir, 'radar-public-conclusions-schema-review-summary.json'))
  const runValidation = readJson(path.join(reviewDir, 'schema-review-run-validation.json'))
  const upPath = path.join(reviewDir, 'radar-public-schema-up.sql.disabled')
  const downPath = path.join(reviewDir, 'radar-public-schema-down.sql.disabled')
  if (sha256File(readyPath) !== EXPECTED_READY_SHA256) throw new Error('Public ready file SHA-256 mismatch.')
  if (reviewSummary?.audit?.publicReadyRows !== EXPECTED_ROWS || reviewSummary?.dataPlan?.rows !== EXPECTED_ROWS) {
    throw new Error('Schema review row count mismatch.')
  }
  if (reviewSummary?.schema?.radarOnly !== true || reviewSummary?.schema?.additive !== true) {
    throw new Error('Schema review is not Radar-only additive.')
  }
  if (runValidation?.productionDatabaseWrite !== false || runValidation?.productionMigrationExecuted !== false) {
    throw new Error('Schema review claims a production write or migration execution.')
  }

  const rows = readJsonl(readyPath)
  if (rows.length !== EXPECTED_ROWS) throw new Error(`Expected ${EXPECTED_ROWS} ready rows, received ${rows.length}.`)
  const records = rows.map((row, index) => {
    if (row.publicStatus !== 'ready_public_ai_after_schema') throw new Error(`Row ${index + 1} status mismatch.`)
    if ((row.publicBlockers || []).length || (row.blockers || []).length) throw new Error(`Row ${index + 1} has blockers.`)
    const record = row.publicRecord
    if (!record || record.publicationKey !== `work:${record.work}` || String(record.work) !== String(record.workIdSnapshot)) {
      throw new Error(`Row ${index + 1} publication identity mismatch.`)
    }
    return record
  })

  const publicationKeys = records.map((row) => String(row.publicationKey))
  const workIds = records.map((row) => String(row.work))
  const conclusionHashes = records.map((row) => String(row.conclusionSha256))
  if (new Set(publicationKeys).size !== EXPECTED_ROWS) throw new Error('Duplicate publicationKey.')
  if (new Set(workIds).size !== EXPECTED_ROWS) throw new Error('Duplicate Work ID.')
  if (new Set(conclusionHashes).size !== EXPECTED_ROWS) throw new Error('Duplicate conclusion SHA-256.')

  const gradeCounts = Object.fromEntries(Object.keys(EXPECTED_GRADES).map((grade) => [grade, 0]))
  let reviewReasonRows = 0
  let matchedRuleRows = 0
  let contradictionRows = 0
  const childIds = new Set()
  for (const record of records) {
    if (!(record.compatibilityGrade in gradeCounts)) throw new Error(`Unexpected public grade: ${record.compatibilityGrade}`)
    gradeCounts[record.compatibilityGrade] += 1
    reviewReasonRows += Array.isArray(record.reviewReasons) ? record.reviewReasons.length : 0
    const rules = Array.isArray(record?.radarAssessment?.matchedRules) ? record.radarAssessment.matchedRules : []
    const contradictions = Array.isArray(record?.radarAssessment?.contradictions) ? record.radarAssessment.contradictions : []
    matchedRuleRows += rules.length
    contradictionRows += contradictions.length
    rules.forEach((item, index) => {
      const id = String(item?.id || `rp-${record.conclusionSha256.slice(0, 24)}-m-${index}`)
      if (childIds.has(id)) throw new Error(`Duplicate generated/preserved child id: ${id}`)
      childIds.add(id)
    })
    contradictions.forEach((item, index) => {
      const id = String(item?.id || `rp-${record.conclusionSha256.slice(0, 24)}-c-${index}`)
      if (childIds.has(id)) throw new Error(`Duplicate generated/preserved child id: ${id}`)
      childIds.add(id)
    })
  }
  if (JSON.stringify(gradeCounts) !== JSON.stringify(EXPECTED_GRADES)) {
    throw new Error(`Grade distribution mismatch: ${JSON.stringify(gradeCounts)}`)
  }

  const upSql = fs.readFileSync(upPath, 'utf8').trim()
  const downSql = fs.readFileSync(downPath, 'utf8').trim()
  if (!/CREATE TABLE\s+"radar_public"/u.test(upSql)) throw new Error('Up SQL does not create radar_public.')
  if (/(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+"?(?:works|_works_v|payload_locked_documents_rels)"?/iu.test(upSql)) {
    throw new Error('Up SQL touches a forbidden existing table.')
  }
  if (!/DROP TABLE\s+"radar_public"/u.test(downSql)) throw new Error('Down SQL does not remove radar_public.')

  fs.mkdirSync(outDir, { recursive: true })

  const inputCte = `WITH input AS (\n  SELECT (line::jsonb)->'publicRecord' AS r\n  FROM radar_public_input_raw\n)`
  const recordJson = `(line::jsonb)->'publicRecord'`
  const copyOptions = `WITH (FORMAT csv, DELIMITER E'\\x1f', QUOTE E'\\x1e', ESCAPE E'\\x1e')`

  const mainMismatch = `
${inputCte}
SELECT count(*)
FROM input i
JOIN radar_public p ON p.publication_key = i.r->>'publicationKey'
WHERE p.work_id::text IS DISTINCT FROM i.r->>'work'
   OR p.work_id_snapshot IS DISTINCT FROM i.r->>'workIdSnapshot'
   OR p.work_site_id IS DISTINCT FROM NULLIF(i.r->>'workSiteId', '')
   OR p.title IS DISTINCT FROM i.r->>'title'
   OR p.record_status::text IS DISTINCT FROM i.r->>'recordStatus'
   OR p.conclusion_mode::text IS DISTINCT FROM i.r->>'conclusionMode'
   OR p.compatibility_grade::text IS DISTINCT FROM i.r->>'compatibilityGrade'
   OR p.best_grade::text IS DISTINCT FROM NULLIF(i.r->>'bestGrade', '')
   OR p.likely_grade::text IS DISTINCT FROM NULLIF(i.r->>'likelyGrade', '')
   OR p.worst_grade::text IS DISTINCT FROM NULLIF(i.r->>'worstGrade', '')
   OR p.rating_notice::text IS DISTINCT FROM i.r->>'ratingNotice'
   OR p.evidence_strength::text IS DISTINCT FROM i.r->>'evidenceStrength'
   OR p.radar_assessment_confidence_percent IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,confidencePercent}', '')::numeric
   OR p.radar_assessment_evidence_coverage_percent IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,evidenceCoveragePercent}', '')::numeric
   OR p.radar_assessment_evidence_status::text IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,evidenceStatus}', '')
   OR p.radar_assessment_source_summary IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,sourceSummary}', '')
   OR p.radar_assessment_source_count IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,sourceCount}', '')::numeric
   OR p.radar_assessment_policy_version IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,policyVersion}', '')
   OR p.radar_assessment_assessment_batch IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,assessmentBatch}', '')
   OR p.radar_assessment_suggested_grade::text IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,suggestedGrade}', '')
   OR p.radar_assessment_decisive_rule_code IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,decisiveRuleCode}', '')
   OR p.radar_assessment_decisive_rule_reason IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,decisiveRuleReason}', '')
   OR p.radar_assessment_requires_human_review IS DISTINCT FROM COALESCE(NULLIF(i.r#>>'{radarAssessment,requiresHumanReview}', '')::boolean, true)
   OR p.radar_assessment_assessed_at IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,assessedAt}', '')::timestamptz
   OR p.source_kind::text IS DISTINCT FROM i.r->>'sourceKind'
   OR p.source_package_id IS DISTINCT FROM NULLIF(i.r->>'sourcePackageId', '')
   OR p.source_package_sha256 IS DISTINCT FROM NULLIF(i.r->>'sourcePackageSha256', '')
   OR p.conclusion_sha256 IS DISTINCT FROM i.r->>'conclusionSha256'
   OR p.publication_version IS DISTINCT FROM i.r->>'publicationVersion'`

  const applySql = `\\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30min';
${upSql}

CREATE TEMP TABLE radar_public_input_raw (line text NOT NULL) ON COMMIT DROP;
COPY radar_public_input_raw(line) FROM '${INPUT_PATH_IN_CONTAINER}' ${copyOptions};

DO $$
DECLARE
  row_count bigint;
  invalid_count bigint;
BEGIN
  SELECT count(*) INTO row_count FROM radar_public_input_raw;
  IF row_count <> ${EXPECTED_ROWS} THEN RAISE EXCEPTION 'expected ${EXPECTED_ROWS} input rows, received %', row_count; END IF;
  SELECT count(*) INTO invalid_count
  FROM radar_public_input_raw
  WHERE line::jsonb->>'publicStatus' <> 'ready_public_ai_after_schema'
     OR jsonb_array_length(COALESCE(line::jsonb->'publicBlockers', '[]'::jsonb)) <> 0
     OR jsonb_array_length(COALESCE(line::jsonb->'blockers', '[]'::jsonb)) <> 0;
  IF invalid_count <> 0 THEN RAISE EXCEPTION 'invalid ready input rows: %', invalid_count; END IF;
END $$;

INSERT INTO radar_public (
  publication_key, work_id, work_id_snapshot, work_site_id, title,
  record_status, conclusion_mode, compatibility_grade, best_grade, likely_grade, worst_grade,
  rating_notice, evidence_strength,
  radar_assessment_confidence_percent, radar_assessment_evidence_coverage_percent,
  radar_assessment_evidence_status, radar_assessment_source_summary, radar_assessment_source_count,
  radar_assessment_policy_version, radar_assessment_assessment_batch,
  radar_assessment_suggested_grade, radar_assessment_decisive_rule_code,
  radar_assessment_decisive_rule_reason, radar_assessment_requires_human_review,
  radar_assessment_assessed_at, source_kind, source_package_id, source_package_sha256,
  conclusion_sha256, publication_version, published_at
)
SELECT
  r->>'publicationKey', (r->>'work')::integer, r->>'workIdSnapshot', NULLIF(r->>'workSiteId', ''), r->>'title',
  (r->>'recordStatus')::enum_radar_public_record_status,
  (r->>'conclusionMode')::enum_radar_public_conclusion_mode,
  (r->>'compatibilityGrade')::enum_radar_public_compatibility_grade,
  NULLIF(r->>'bestGrade', '')::enum_radar_public_best_grade,
  NULLIF(r->>'likelyGrade', '')::enum_radar_public_likely_grade,
  NULLIF(r->>'worstGrade', '')::enum_radar_public_worst_grade,
  (r->>'ratingNotice')::enum_radar_public_rating_notice,
  (r->>'evidenceStrength')::enum_radar_public_evidence_strength,
  NULLIF(r#>>'{radarAssessment,confidencePercent}', '')::numeric,
  NULLIF(r#>>'{radarAssessment,evidenceCoveragePercent}', '')::numeric,
  NULLIF(r#>>'{radarAssessment,evidenceStatus}', '')::enum_radar_public_radar_assessment_evidence_status,
  NULLIF(r#>>'{radarAssessment,sourceSummary}', ''),
  NULLIF(r#>>'{radarAssessment,sourceCount}', '')::numeric,
  NULLIF(r#>>'{radarAssessment,policyVersion}', ''),
  NULLIF(r#>>'{radarAssessment,assessmentBatch}', ''),
  NULLIF(r#>>'{radarAssessment,suggestedGrade}', '')::enum_radar_public_radar_assessment_suggested_grade,
  NULLIF(r#>>'{radarAssessment,decisiveRuleCode}', ''),
  NULLIF(r#>>'{radarAssessment,decisiveRuleReason}', ''),
  COALESCE(NULLIF(r#>>'{radarAssessment,requiresHumanReview}', '')::boolean, true),
  NULLIF(r#>>'{radarAssessment,assessedAt}', '')::timestamptz,
  (r->>'sourceKind')::enum_radar_public_source_kind,
  NULLIF(r->>'sourcePackageId', ''), NULLIF(r->>'sourcePackageSha256', ''),
  r->>'conclusionSha256', r->>'publicationVersion', transaction_timestamp()
FROM radar_public_input_raw raw
CROSS JOIN LATERAL (SELECT ${recordJson} AS r) x;

INSERT INTO radar_public_review_reasons ("order", parent_id, value)
SELECT (reason.ordinality - 1)::integer, p.id, reason.value::enum_radar_public_review_reasons
FROM radar_public_input_raw raw
CROSS JOIN LATERAL (SELECT ${recordJson} AS r) x
JOIN radar_public p ON p.publication_key = x.r->>'publicationKey'
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(x.r->'reviewReasons', '[]'::jsonb)) WITH ORDINALITY AS reason(value, ordinality);

INSERT INTO radar_public_radar_assessment_matched_rules (_order, _parent_id, id, code, grade, confidence_percent, reason)
SELECT (item.ordinality - 1)::integer, p.id,
  COALESCE(NULLIF(item.value->>'id', ''), 'rp-' || substr(x.r->>'conclusionSha256', 1, 24) || '-m-' || (item.ordinality - 1)::text),
  item.value->>'code', (item.value->>'grade')::enum_radar_public_radar_assessment_matched_rules_grade,
  NULLIF(item.value->>'confidencePercent', '')::numeric, NULLIF(item.value->>'reason', '')
FROM radar_public_input_raw raw
CROSS JOIN LATERAL (SELECT ${recordJson} AS r) x
JOIN radar_public p ON p.publication_key = x.r->>'publicationKey'
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.r#>'{radarAssessment,matchedRules}', '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality);

INSERT INTO radar_public_radar_assessment_contradictions (_order, _parent_id, id, value)
SELECT (item.ordinality - 1)::integer, p.id,
  COALESCE(NULLIF(item.value->>'id', ''), 'rp-' || substr(x.r->>'conclusionSha256', 1, 24) || '-c-' || (item.ordinality - 1)::text),
  item.value->>'value'
FROM radar_public_input_raw raw
CROSS JOIN LATERAL (SELECT ${recordJson} AS r) x
JOIN radar_public p ON p.publication_key = x.r->>'publicationKey'
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.r#>'{radarAssessment,contradictions}', '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality);

DO $$
DECLARE mismatch_count bigint;
BEGIN
  SELECT count(*) INTO mismatch_count FROM (${mainMismatch}) q;
  IF mismatch_count <> 0 THEN RAISE EXCEPTION 'main row field mismatches: %', mismatch_count; END IF;

  WITH expected AS (
    SELECT x.r->>'publicationKey' publication_key, (v.ordinality - 1)::integer ord, v.value::text value
    FROM radar_public_input_raw raw
    CROSS JOIN LATERAL (SELECT ${recordJson} AS r) x
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(x.r->'reviewReasons', '[]'::jsonb)) WITH ORDINALITY v(value, ordinality)
  ), actual AS (
    SELECT p.publication_key, rr."order" ord, rr.value::text value
    FROM radar_public_review_reasons rr JOIN radar_public p ON p.id = rr.parent_id
  ), delta AS ((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected))
  SELECT count(*) INTO mismatch_count FROM delta;
  IF mismatch_count <> 0 THEN RAISE EXCEPTION 'review reason mismatches: %', mismatch_count; END IF;

  WITH expected AS (
    SELECT x.r->>'publicationKey' publication_key, (v.ordinality - 1)::integer ord,
      COALESCE(NULLIF(v.value->>'id', ''), 'rp-' || substr(x.r->>'conclusionSha256', 1, 24) || '-m-' || (v.ordinality - 1)::text) id,
      v.value->>'code' code, v.value->>'grade' grade,
      NULLIF(v.value->>'confidencePercent', '')::numeric confidence_percent, NULLIF(v.value->>'reason', '') reason
    FROM radar_public_input_raw raw
    CROSS JOIN LATERAL (SELECT ${recordJson} AS r) x
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.r#>'{radarAssessment,matchedRules}', '[]'::jsonb)) WITH ORDINALITY v(value, ordinality)
  ), actual AS (
    SELECT p.publication_key, m._order ord, m.id, m.code, m.grade::text grade, m.confidence_percent, m.reason
    FROM radar_public_radar_assessment_matched_rules m JOIN radar_public p ON p.id = m._parent_id
  ), delta AS ((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected))
  SELECT count(*) INTO mismatch_count FROM delta;
  IF mismatch_count <> 0 THEN RAISE EXCEPTION 'matched rule mismatches: %', mismatch_count; END IF;

  WITH expected AS (
    SELECT x.r->>'publicationKey' publication_key, (v.ordinality - 1)::integer ord,
      COALESCE(NULLIF(v.value->>'id', ''), 'rp-' || substr(x.r->>'conclusionSha256', 1, 24) || '-c-' || (v.ordinality - 1)::text) id,
      v.value->>'value' value
    FROM radar_public_input_raw raw
    CROSS JOIN LATERAL (SELECT ${recordJson} AS r) x
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.r#>'{radarAssessment,contradictions}', '[]'::jsonb)) WITH ORDINALITY v(value, ordinality)
  ), actual AS (
    SELECT p.publication_key, c._order ord, c.id, c.value
    FROM radar_public_radar_assessment_contradictions c JOIN radar_public p ON p.id = c._parent_id
  ), delta AS ((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected))
  SELECT count(*) INTO mismatch_count FROM delta;
  IF mismatch_count <> 0 THEN RAISE EXCEPTION 'contradiction mismatches: %', mismatch_count; END IF;
END $$;

COMMIT;
`

  const acceptanceChecks = [
    checkLine('main_rows', '(SELECT count(*) FROM radar_public)', String(EXPECTED_ROWS)),
    checkLine('publication_keys_unique', '(SELECT count(DISTINCT publication_key) FROM radar_public)', String(EXPECTED_ROWS)),
    checkLine('work_ids_unique', '(SELECT count(DISTINCT work_id) FROM radar_public)', String(EXPECTED_ROWS)),
    checkLine('conclusion_hashes_unique', '(SELECT count(DISTINCT conclusion_sha256) FROM radar_public)', String(EXPECTED_ROWS)),
    checkLine('current_rows', "(SELECT count(*) FROM radar_public WHERE record_status = 'current')", String(EXPECTED_ROWS)),
    checkLine('package_rows', "(SELECT count(*) FROM radar_public WHERE source_kind = 'package')", String(EXPECTED_ROWS)),
    checkLine('review_reason_rows', '(SELECT count(*) FROM radar_public_review_reasons)', String(reviewReasonRows)),
    checkLine('matched_rule_rows', '(SELECT count(*) FROM radar_public_radar_assessment_matched_rules)', String(matchedRuleRows)),
    checkLine('contradiction_rows', '(SELECT count(*) FROM radar_public_radar_assessment_contradictions)', String(contradictionRows)),
    checkLine('publication_key_set_md5', "(SELECT md5(string_agg(publication_key, E'\\n' ORDER BY publication_key)) FROM radar_public)", sqlString(md5Sorted(publicationKeys))),
    checkLine('work_id_set_md5', "(SELECT md5(string_agg(work_id::text, E'\\n' ORDER BY work_id::text)) FROM radar_public)", sqlString(md5Sorted(workIds))),
    checkLine('conclusion_hash_set_md5', "(SELECT md5(string_agg(conclusion_sha256, E'\\n' ORDER BY conclusion_sha256)) FROM radar_public)", sqlString(md5Sorted(conclusionHashes))),
    checkLine('orphan_review_reasons', '(SELECT count(*) FROM radar_public_review_reasons r LEFT JOIN radar_public p ON p.id=r.parent_id WHERE p.id IS NULL)', '0'),
    checkLine('orphan_matched_rules', '(SELECT count(*) FROM radar_public_radar_assessment_matched_rules r LEFT JOIN radar_public p ON p.id=r._parent_id WHERE p.id IS NULL)', '0'),
    checkLine('orphan_contradictions', '(SELECT count(*) FROM radar_public_radar_assessment_contradictions r LEFT JOIN radar_public p ON p.id=r._parent_id WHERE p.id IS NULL)', '0'),
    ...Object.entries(EXPECTED_GRADES).map(([grade, count]) => checkLine(`grade_${grade}`, `(SELECT count(*) FROM radar_public WHERE compatibility_grade = ${sqlString(grade)})`, String(count))),
  ]

  const acceptanceSql = `\\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
${acceptanceChecks.join('\n')}
ROLLBACK;
`

  const rollbackSql = `\\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30min';
${downSql}
COMMIT;
`

  const radarTables = [
    'radar_public',
    'radar_public_review_reasons',
    'radar_public_radar_assessment_matched_rules',
    'radar_public_radar_assessment_contradictions',
  ]
  const radarTypes = [
    'enum_radar_public_review_reasons',
    'enum_radar_public_radar_assessment_matched_rules_grade',
    'enum_radar_public_record_status',
    'enum_radar_public_conclusion_mode',
    'enum_radar_public_compatibility_grade',
    'enum_radar_public_best_grade',
    'enum_radar_public_likely_grade',
    'enum_radar_public_worst_grade',
    'enum_radar_public_rating_notice',
    'enum_radar_public_evidence_strength',
    'enum_radar_public_radar_assessment_evidence_status',
    'enum_radar_public_radar_assessment_suggested_grade',
    'enum_radar_public_source_kind',
  ]
  const rollbackChecks = [
    ...radarTables.map((name) => checkLine(`table_absent_${name}`, `(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=${sqlString(name)})`, '0')),
    ...radarTypes.map((name) => checkLine(`type_absent_${name}`, `(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=${sqlString(name)})`, '0')),
  ]
  const postRollbackSql = `\\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
${rollbackChecks.join('\n')}
ROLLBACK;
`

  write(path.join(outDir, 'radar-public-lab-apply.sql.lab-only'), applySql)
  write(path.join(outDir, 'radar-public-lab-acceptance.sql'), acceptanceSql)
  write(path.join(outDir, 'radar-public-lab-rollback.sql.lab-only'), rollbackSql)
  write(path.join(outDir, 'radar-public-lab-post-rollback-acceptance.sql'), postRollbackSql)
  writeJson(path.join(outDir, 'radar-public-lab-plan-summary.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    auditZipSha256,
    schemaReviewZipSha256: reviewZipSha256,
    readyFileSha256: EXPECTED_READY_SHA256,
    rows: EXPECTED_ROWS,
    uniquePublicationKeys: new Set(publicationKeys).size,
    uniqueWorkIds: new Set(workIds).size,
    uniqueConclusionHashes: new Set(conclusionHashes).size,
    gradeCounts,
    reviewReasonRows,
    matchedRuleRows,
    contradictionRows,
    childIdsUnique: childIds.size === matchedRuleRows + contradictionRows,
    publicationKeySetMd5: md5Sorted(publicationKeys),
    workIdSetMd5: md5Sorted(workIds),
    conclusionHashSetMd5: md5Sorted(conclusionHashes),
    schemaReviewAfterHead: reviewSummary.afterHead,
    schemaOnlyTables: ['radar_public', 'radar_public_review_reasons', 'radar_public_radar_assessment_matched_rules', 'radar_public_radar_assessment_contradictions'],
    productionDatabaseWrite: false,
    labDatabaseWrite: true,
  })

  console.log('Radar public conclusions lab SQL built')
  console.log(`Rows: ${EXPECTED_ROWS}`)
  console.log(`MatchedRuleRows: ${matchedRuleRows}`)
  console.log(`ContradictionRows: ${contradictionRows}`)
  console.log('ProductionDatabaseWrite: False')
  console.log('LabDatabaseWrite: True')
}

main()
