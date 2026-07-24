#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { conclusionSha256ForRecord } from './lib/public-conclusion-storage-v01.mjs'

const EXPECTED_STORAGE_ZIP_SHA256 = '642e43b9cbac02c75d2d473293c7b57b8b0197594262dfa96b065015e89c135e'
const EXPECTED_SCHEMA_REVIEW_ZIP_SHA256 = '297fed9ab54675748e5ae0dd812cfa4ac367966d12e7732541913223d74ac0fb'
const EXPECTED_READY_SHA256 = 'bda8429dfcf6dbcaaeb90199ac1697196b308013f65df546f20b46167b49a220'
const EXPECTED_PLAN_SHA256 = '72191d11ac163aa09f927353e64b3bdc22d74963d7436a4bf790ce30ee39bc39'
const EXPECTED_REWRITE_SHA256 = '1cff56eb78482c0a5a6bf714e617e8c00a5f90cc1866b76d9081e8bd10deccfd'
const EXPECTED_ROWS = 9000
const EXPECTED_GRADES = { S: 8, A: 267, B: 675, C: 868, D: 7032, E: 138, F: 12 }
const INPUT_PATH_IN_CONTAINER = '/tmp/public-ai-storage-ready.jsonl'

function parseArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) out[key] = true
    else { out[key] = next; index += 1 }
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
  if (!text.trim()) return []
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
  const manifestPath = path.join(directory, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`)
  const manifest = readJson(manifestPath)
  for (const entry of manifest) {
    const file = path.join(directory, String(entry.file))
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${entry.file}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) throw new Error(`Manifest bytes mismatch: ${entry.file}`)
    if (sha256File(file) !== String(entry.sha256).toLowerCase()) throw new Error(`Manifest hash mismatch: ${entry.file}`)
  }
  return manifest
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function md5Sorted(values) {
  return crypto.createHash('md5').update([...values].sort().join('\n')).digest('hex')
}

function checkLine(name, actualSql, expectedSql) {
  return `SELECT ${sqlString(name)} || E'\\t' || (${actualSql})::text || E'\\t' || (${expectedSql})::text || E'\\t' || ((${actualSql}) = (${expectedSql}))::text;`
}

function assertRadarOnlySql(upSql, downSql) {
  if (!/CREATE TABLE\s+"radar_public"/u.test(upSql)) throw new Error('Up SQL does not create radar_public.')
  if (!/DROP TABLE\s+"radar_public"/u.test(downSql)) throw new Error('Down SQL does not drop radar_public.')
  const forbidden = /(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+"?(?:works|_works_v|payload_locked_documents_rels)"?/iu
  if (forbidden.test(upSql) || forbidden.test(downSql)) throw new Error('Schema SQL touches a forbidden existing table.')
  for (const match of upSql.matchAll(/CREATE TABLE\s+"([^"]+)"/giu)) {
    if (!match[1].startsWith('radar_public')) throw new Error(`Up SQL creates a non-Radar table: ${match[1]}`)
  }
  for (const match of downSql.matchAll(/DROP TABLE\s+"([^"]+)"/giu)) {
    if (!match[1].startsWith('radar_public')) throw new Error(`Down SQL drops a non-Radar table: ${match[1]}`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const storageDir = path.resolve(required(args, 'storage-dir'))
  const schemaReviewDir = path.resolve(required(args, 'schema-review-dir'))
  const outDir = path.resolve(required(args, 'out-dir'))
  const storageZipSha256 = required(args, 'storage-zip-sha256').toLowerCase()
  const schemaReviewZipSha256 = required(args, 'schema-review-zip-sha256').toLowerCase()

  if (storageZipSha256 !== EXPECTED_STORAGE_ZIP_SHA256) throw new Error('Storage normalization ZIP SHA-256 mismatch.')
  if (schemaReviewZipSha256 !== EXPECTED_SCHEMA_REVIEW_ZIP_SHA256) throw new Error('Schema review ZIP SHA-256 mismatch.')
  assertManifest(storageDir)
  assertManifest(schemaReviewDir)

  const readyPath = path.join(storageDir, 'public-ai-storage-ready.jsonl')
  const planPath = path.join(storageDir, 'public-conclusions-storage-write-plan.jsonl')
  const rewritePath = path.join(storageDir, 'public-conclusion-storage-rewrite-map.jsonl')
  const storageSummary = readJson(path.join(storageDir, 'radar-public-storage-normalization-summary.json'))
  const storageValidation = readJson(path.join(storageDir, 'storage-normalization-run-validation.json'))
  const supersession = readJson(path.join(storageDir, 'storage-normalization-supersession.json'))
  const schemaSummary = readJson(path.join(schemaReviewDir, 'radar-public-conclusions-schema-review-summary.json'))
  const upPath = path.join(schemaReviewDir, 'radar-public-schema-up.sql.disabled')
  const downPath = path.join(schemaReviewDir, 'radar-public-schema-down.sql.disabled')

  if (sha256File(readyPath) !== EXPECTED_READY_SHA256) throw new Error('Storage-ready file SHA-256 mismatch.')
  if (sha256File(planPath) !== EXPECTED_PLAN_SHA256) throw new Error('Storage write plan SHA-256 mismatch.')
  if (sha256File(rewritePath) !== EXPECTED_REWRITE_SHA256) throw new Error('Rewrite map SHA-256 mismatch.')
  if (storageSummary?.normalization?.rows !== EXPECTED_ROWS || storageValidation?.normalizedRows !== EXPECTED_ROWS) {
    throw new Error('Storage normalization row count mismatch.')
  }
  if (storageSummary?.invariants?.oldPublicWritePlanSuperseded !== true ||
      storageSummary?.invariants?.businessAuditSuperseded !== false ||
      storageSummary?.invariants?.migrationDdlSuperseded !== false ||
      storageValidation?.productionDatabaseWrite !== false ||
      storageValidation?.productionApplyAuthorized !== false) {
    throw new Error('Storage normalization safety or supersession state mismatch.')
  }
  if (supersession?.schemaMigration?.commit !== schemaSummary?.afterHead || supersession?.schemaMigration?.status !== 'retained') {
    throw new Error('Storage package is not bound to the retained migration commit.')
  }
  if (schemaSummary?.schema?.radarOnly !== true || schemaSummary?.schema?.additive !== true) {
    throw new Error('Schema review is not Radar-only additive.')
  }

  const rows = readJsonl(readyPath)
  const plans = readJsonl(planPath)
  const rewrites = readJsonl(rewritePath)
  if (rows.length !== EXPECTED_ROWS || plans.length !== EXPECTED_ROWS || rewrites.length !== EXPECTED_ROWS) {
    throw new Error('Storage package JSONL row counts are not 9000.')
  }
  const planByKey = new Map(plans.map((row) => [String(row.publicationKey), row]))
  const rewriteByKey = new Map(rewrites.map((row) => [String(row.publicationKey), row]))
  if (planByKey.size !== EXPECTED_ROWS || rewriteByKey.size !== EXPECTED_ROWS) throw new Error('Duplicate plan or rewrite publication key.')

  const records = []
  const publicationKeys = new Set()
  const workIds = new Set()
  const conclusionHashes = new Set()
  const oldConclusionHashes = new Set()
  const childIds = new Set()
  const gradeCounts = Object.fromEntries(Object.keys(EXPECTED_GRADES).map((grade) => [grade, 0]))
  let reviewReasonRows = 0
  let matchedRuleRows = 0
  let contradictionRows = 0

  for (const [index, row] of rows.entries()) {
    const record = row?.publicRecord
    const key = String(record?.publicationKey || '')
    const work = String(record?.work || '')
    const assessedAt = String(record?.radarAssessment?.assessedAt || '')
    if (row?.storageStatus !== 'ready_public_ai_storage_normalized') throw new Error(`Row ${index + 1} storageStatus mismatch.`)
    if (row?.storageNormalizationVersion !== 'radar-public-storage-normalization-v0.1') throw new Error(`Row ${index + 1} normalization version mismatch.`)
    if ((row?.publicBlockers || []).length || (row?.blockers || []).length) throw new Error(`Row ${index + 1} contains blockers.`)
    if (!record || key !== `work:${work}` || work !== String(record.workIdSnapshot)) throw new Error(`Row ${index + 1} identity mismatch.`)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(assessedAt)) throw new Error(`Row ${index + 1} assessedAt is not UTC milliseconds.`)
    if (conclusionSha256ForRecord(record) !== String(record.conclusionSha256).toLowerCase()) throw new Error(`Row ${index + 1} normalized hash mismatch.`)

    const plan = planByKey.get(key)
    const rewrite = rewriteByKey.get(key)
    if (!plan || String(plan.conclusionSha256) !== String(record.conclusionSha256) || String(plan.assessedAt) !== assessedAt) {
      throw new Error(`Row ${index + 1} is not bound to the storage write plan.`)
    }
    if (!rewrite || String(rewrite.newConclusionSha256) !== String(record.conclusionSha256) || String(rewrite.normalizedAssessedAt) !== assessedAt) {
      throw new Error(`Row ${index + 1} is not bound to the rewrite map.`)
    }

    if (publicationKeys.has(key)) throw new Error(`Duplicate publication key: ${key}`)
    if (workIds.has(work)) throw new Error(`Duplicate Work ID: ${work}`)
    if (conclusionHashes.has(record.conclusionSha256)) throw new Error(`Duplicate conclusion hash: ${record.conclusionSha256}`)
    if (oldConclusionHashes.has(rewrite.oldConclusionSha256)) throw new Error(`Duplicate old conclusion hash: ${rewrite.oldConclusionSha256}`)
    publicationKeys.add(key)
    workIds.add(work)
    conclusionHashes.add(record.conclusionSha256)
    oldConclusionHashes.add(rewrite.oldConclusionSha256)

    if (!(record.compatibilityGrade in gradeCounts)) throw new Error(`Unexpected grade at row ${index + 1}.`)
    gradeCounts[record.compatibilityGrade] += 1
    reviewReasonRows += Array.isArray(record.reviewReasons) ? record.reviewReasons.length : 0
    const rules = Array.isArray(record?.radarAssessment?.matchedRules) ? record.radarAssessment.matchedRules : []
    const contradictions = Array.isArray(record?.radarAssessment?.contradictions) ? record.radarAssessment.contradictions : []
    matchedRuleRows += rules.length
    contradictionRows += contradictions.length
    rules.forEach((item, ruleIndex) => {
      const id = String(item?.id || `rp-${record.conclusionSha256.slice(0, 24)}-m-${ruleIndex}`)
      if (childIds.has(id)) throw new Error(`Duplicate child id: ${id}`)
      childIds.add(id)
    })
    contradictions.forEach((item, contradictionIndex) => {
      const id = String(item?.id || `rp-${record.conclusionSha256.slice(0, 24)}-c-${contradictionIndex}`)
      if (childIds.has(id)) throw new Error(`Duplicate child id: ${id}`)
      childIds.add(id)
    })
    records.push(record)
  }

  if (JSON.stringify(gradeCounts) !== JSON.stringify(EXPECTED_GRADES)) {
    throw new Error(`Grade distribution mismatch: ${JSON.stringify(gradeCounts)}`)
  }

  const upSql = fs.readFileSync(upPath, 'utf8').trim()
  const downSql = fs.readFileSync(downPath, 'utf8').trim()
  assertRadarOnlySql(upSql, downSql)
  fs.mkdirSync(outDir, { recursive: true })

  const recordJson = `(line::jsonb)->'publicRecord'`
  const copyOptions = `WITH (FORMAT csv, DELIMITER E'\\x1f', QUOTE E'\\x1e', ESCAPE E'\\x1e')`
  const mainMismatchWhere = `
       p.work_id::text IS DISTINCT FROM x.r->>'work'
    OR p.work_id_snapshot IS DISTINCT FROM x.r->>'workIdSnapshot'
    OR p.work_site_id IS DISTINCT FROM NULLIF(x.r->>'workSiteId', '')
    OR p.title IS DISTINCT FROM x.r->>'title'
    OR p.record_status::text IS DISTINCT FROM x.r->>'recordStatus'
    OR p.conclusion_mode::text IS DISTINCT FROM x.r->>'conclusionMode'
    OR p.compatibility_grade::text IS DISTINCT FROM x.r->>'compatibilityGrade'
    OR p.best_grade::text IS DISTINCT FROM NULLIF(x.r->>'bestGrade', '')
    OR p.likely_grade::text IS DISTINCT FROM NULLIF(x.r->>'likelyGrade', '')
    OR p.worst_grade::text IS DISTINCT FROM NULLIF(x.r->>'worstGrade', '')
    OR p.rating_notice::text IS DISTINCT FROM x.r->>'ratingNotice'
    OR p.evidence_strength::text IS DISTINCT FROM x.r->>'evidenceStrength'
    OR p.radar_assessment_confidence_percent IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,confidencePercent}', '')::numeric
    OR p.radar_assessment_evidence_coverage_percent IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,evidenceCoveragePercent}', '')::numeric
    OR p.radar_assessment_evidence_status::text IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,evidenceStatus}', '')
    OR p.radar_assessment_source_summary IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,sourceSummary}', '')
    OR p.radar_assessment_source_count IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,sourceCount}', '')::numeric
    OR p.radar_assessment_policy_version IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,policyVersion}', '')
    OR p.radar_assessment_assessment_batch IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,assessmentBatch}', '')
    OR p.radar_assessment_suggested_grade::text IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,suggestedGrade}', '')
    OR p.radar_assessment_decisive_rule_code IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,decisiveRuleCode}', '')
    OR p.radar_assessment_decisive_rule_reason IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,decisiveRuleReason}', '')
    OR p.radar_assessment_requires_human_review IS DISTINCT FROM COALESCE(NULLIF(x.r#>>'{radarAssessment,requiresHumanReview}', '')::boolean, true)
    OR p.radar_assessment_assessed_at IS DISTINCT FROM NULLIF(x.r#>>'{radarAssessment,assessedAt}', '')::timestamptz
    OR p.source_kind::text IS DISTINCT FROM x.r->>'sourceKind'
    OR p.source_package_id IS DISTINCT FROM NULLIF(x.r->>'sourcePackageId', '')
    OR p.source_package_sha256 IS DISTINCT FROM NULLIF(x.r->>'sourcePackageSha256', '')
    OR p.conclusion_sha256 IS DISTINCT FROM x.r->>'conclusionSha256'
    OR p.publication_version IS DISTINCT FROM x.r->>'publicationVersion'`

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
  WHERE line::jsonb->>'storageStatus' <> 'ready_public_ai_storage_normalized'
     OR line::jsonb->>'storageNormalizationVersion' <> 'radar-public-storage-normalization-v0.1'
     OR jsonb_array_length(COALESCE(line::jsonb->'publicBlockers', '[]'::jsonb)) <> 0
     OR jsonb_array_length(COALESCE(line::jsonb->'blockers', '[]'::jsonb)) <> 0;
  IF invalid_count <> 0 THEN RAISE EXCEPTION 'invalid storage-ready rows: %', invalid_count; END IF;
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
  SELECT count(*) INTO mismatch_count
  FROM radar_public_input_raw raw
  CROSS JOIN LATERAL (SELECT ${recordJson} AS r) x
  JOIN radar_public p ON p.publication_key = x.r->>'publicationKey'
  WHERE ${mainMismatchWhere};
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

  const preflightChecks = [
    checkLine('radar_public_absent', `(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='radar_public')`, '0'),
    checkLine('works_rows', '(SELECT count(*) FROM public.works)', '35615'),
  ]
  const preflightSql = `\\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
${preflightChecks.join('\n')}
ROLLBACK;
`

  write(path.join(outDir, 'radar-public-storage-apply.sql.lab-only'), applySql)
  write(path.join(outDir, 'radar-public-storage-acceptance.sql'), acceptanceSql)
  write(path.join(outDir, 'radar-public-storage-rollback.sql.lab-only'), rollbackSql)
  write(path.join(outDir, 'radar-public-storage-post-rollback-acceptance.sql'), postRollbackSql)
  write(path.join(outDir, 'radar-public-production-preflight.sql'), preflightSql)
  writeJson(path.join(outDir, 'radar-public-storage-lab-plan-summary.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    storageZipSha256,
    schemaReviewZipSha256,
    normalizedReadySha256: EXPECTED_READY_SHA256,
    storageWritePlanSha256: EXPECTED_PLAN_SHA256,
    rewriteMapSha256: EXPECTED_REWRITE_SHA256,
    rows: EXPECTED_ROWS,
    uniquePublicationKeys: publicationKeys.size,
    uniqueWorkIds: workIds.size,
    uniqueConclusionHashes: conclusionHashes.size,
    uniqueOldConclusionHashes: oldConclusionHashes.size,
    gradeCounts,
    reviewReasonRows,
    matchedRuleRows,
    contradictionRows,
    childIdsUnique: childIds.size === matchedRuleRows + contradictionRows,
    publicationKeySetMd5: md5Sorted(publicationKeys),
    workIdSetMd5: md5Sorted(workIds),
    conclusionHashSetMd5: md5Sorted(conclusionHashes),
    migrationCommit: schemaSummary.afterHead,
    oldDataPlanSuperseded: true,
    businessAuditSuperseded: false,
    migrationDdlSuperseded: false,
    productionDatabaseWrite: false,
    labDatabaseWrite: true,
    productionApplyAuthorized: false,
    rollbackAuthorized: false,
  })

  console.log('Storage-normalized Radar lab SQL built')
  console.log(`Rows: ${EXPECTED_ROWS}`)
  console.log(`ReviewReasonRows: ${reviewReasonRows}`)
  console.log(`MatchedRuleRows: ${matchedRuleRows}`)
  console.log(`ContradictionRows: ${contradictionRows}`)
  console.log('ProductionDatabaseWrite: False')
  console.log('LabDatabaseWrite: True')
}

main()
