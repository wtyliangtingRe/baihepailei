#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  canonical,
  conclusionSha256ForRecord,
} from './lib/public-conclusion-storage-v01.mjs'

export const VERSION = 'radar-unified-incremental-storage-lab-v0.1'
export const EXPECTED_ROWS = 1804
export const EXPECTED_BASELINE_ROWS = 9000
export const EXPECTED_FINAL_ROWS = 10804
export const EXPECTED_INCREMENTAL_GRADES = canonical({ A: 104, B: 692, C: 182, D: 779, E: 39, F: 8 })
export const EXPECTED_FINAL_GRADES = canonical({ S: 8, A: 371, B: 1367, C: 1050, D: 7811, E: 177, F: 20 })
export const INPUT_PATH_IN_CONTAINER = '/tmp/radar-unified-incremental-storage-ready.jsonl'

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function required(args, key) {
  const value = val(args[key])
  if (!value) throw new Error(`Required: --${key}`)
  return path.resolve(value)
}
function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}
function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) }
    catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  })
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function md5Sorted(values) {
  return crypto.createHash('md5').update([...values].map(String).sort().join('\n')).digest('hex')
}
function sqlString(value) { return `'${String(value).replaceAll("'", "''")}'` }
function checkLine(name, actualSql, expectedSql) {
  return `SELECT ${sqlString(name)} || E'\\t' || (${actualSql})::text || E'\\t' || (${expectedSql})::text || E'\\t' || ((${actualSql}) = (${expectedSql}))::text;`
}
function countBy(rows, getter) {
  const out = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])))
}

export function assertManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`)
  const manifest = readJson(manifestPath)
  const expected = new Set()
  for (const entry of manifest) {
    const relative = val(entry.file).replaceAll('\\', '/')
    const file = path.join(directory, ...relative.split('/'))
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${relative}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) throw new Error(`Manifest bytes mismatch: ${relative}`)
    if (sha256File(file) !== val(entry.sha256).toLowerCase()) throw new Error(`Manifest SHA-256 mismatch: ${relative}`)
    expected.add(relative)
  }
  const actual = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else {
        const relative = path.relative(directory, file).replaceAll('\\', '/')
        if (relative !== 'manifest.json') actual.push(relative)
      }
    }
  }
  walk(directory)
  if (actual.length !== expected.size || actual.some((item) => !expected.has(item))) {
    throw new Error('Unified assembly manifest coverage mismatch.')
  }
  return manifest
}

export function validateReadyRows(rows) {
  if (rows.length !== EXPECTED_ROWS) throw new Error(`Expected ${EXPECTED_ROWS} rows, received ${rows.length}.`)
  const publicationKeys = new Set()
  const workIds = new Set()
  const conclusionHashes = new Set()
  const childIds = new Set()
  const records = []
  let reviewReasonRows = 0
  let matchedRuleRows = 0
  let contradictionRows = 0

  for (const [index, row] of rows.entries()) {
    const record = row?.publicRecord
    const key = val(record?.publicationKey)
    const work = val(record?.work)
    const hash = val(record?.conclusionSha256).toLowerCase()
    if (row?.publicStatus !== 'ready_public_ai_create') throw new Error(`Row ${index + 1} publicStatus mismatch.`)
    if (row?.storageStatus !== 'ready_public_ai_storage_normalized') throw new Error(`Row ${index + 1} storageStatus mismatch.`)
    if (list(row?.blockers).length || list(row?.privateBlockers).length || list(row?.publicBlockers).length) {
      throw new Error(`Row ${index + 1} contains blockers.`)
    }
    if (!record || key !== `work:${work}` || work !== val(record.workIdSnapshot) || work !== val(row.sourceWorkId)) {
      throw new Error(`Row ${index + 1} publication identity mismatch.`)
    }
    if (!/^\d+$/u.test(work)) throw new Error(`Row ${index + 1} Work ID is not numeric.`)
    if (!/^[0-9a-f]{64}$/u.test(hash) || conclusionSha256ForRecord(record) !== hash) {
      throw new Error(`Row ${index + 1} conclusion SHA-256 mismatch.`)
    }
    if (publicationKeys.has(key)) throw new Error(`Duplicate publicationKey: ${key}`)
    if (workIds.has(work)) throw new Error(`Duplicate Work ID: ${work}`)
    if (conclusionHashes.has(hash)) throw new Error(`Duplicate conclusion SHA-256: ${hash}`)
    publicationKeys.add(key)
    workIds.add(work)
    conclusionHashes.add(hash)

    for (const [reasonIndex] of list(record.reviewReasons).entries()) {
      reviewReasonRows += 1
      const id = `rr:${key}:${reasonIndex}`
      if (childIds.has(id)) throw new Error(`Duplicate review-reason identity: ${id}`)
      childIds.add(id)
    }
    for (const [ruleIndex, rule] of list(record?.radarAssessment?.matchedRules).entries()) {
      matchedRuleRows += 1
      const id = val(rule?.id) || `rp-${hash.slice(0, 24)}-m-${ruleIndex}`
      if (childIds.has(id)) throw new Error(`Duplicate matched-rule child ID: ${id}`)
      childIds.add(id)
    }
    for (const [contradictionIndex, contradiction] of list(record?.radarAssessment?.contradictions).entries()) {
      contradictionRows += 1
      const id = val(contradiction?.id) || `rp-${hash.slice(0, 24)}-c-${contradictionIndex}`
      if (childIds.has(id)) throw new Error(`Duplicate contradiction child ID: ${id}`)
      childIds.add(id)
    }
    records.push(record)
  }

  const gradeCounts = countBy(records, (record) => record.compatibilityGrade)
  if (JSON.stringify(gradeCounts) !== JSON.stringify(EXPECTED_INCREMENTAL_GRADES)) {
    throw new Error(`Incremental grade distribution mismatch: ${JSON.stringify(gradeCounts)}`)
  }
  return {
    records,
    publicationKeys: [...publicationKeys],
    workIds: [...workIds],
    conclusionHashes: [...conclusionHashes],
    reviewReasonRows,
    matchedRuleRows,
    contradictionRows,
    gradeCounts,
  }
}

function valuesCte(name, column, values, cast = 'text') {
  return `${name}(${column}) AS (VALUES\n${values.map((value) => `    (${sqlString(value)}::${cast})`).join(',\n')}\n  )`
}

function inputTableSql() {
  return `CREATE TEMP TABLE radar_unified_incremental_input_raw (line text NOT NULL) ON COMMIT DROP;\nCOPY radar_unified_incremental_input_raw(line) FROM '${INPUT_PATH_IN_CONTAINER}' WITH (FORMAT csv, DELIMITER E'\\x1f', QUOTE E'\\x1e', ESCAPE E'\\x1e');`
}

function inputCte() {
  return `WITH input AS (\n  SELECT (line::jsonb)->'publicRecord' AS r\n  FROM radar_unified_incremental_input_raw\n)`
}

function recordJson() { return `(line::jsonb)->'publicRecord'` }

function mainMismatchSql() {
  return `${inputCte()}\nSELECT count(*) AS mismatch_count\nFROM input i\nJOIN radar_public p ON p.publication_key = i.r->>'publicationKey'\nWHERE p.work_id::text IS DISTINCT FROM i.r->>'work'\n   OR p.work_id_snapshot IS DISTINCT FROM i.r->>'workIdSnapshot'\n   OR p.work_site_id IS DISTINCT FROM NULLIF(i.r->>'workSiteId', '')\n   OR p.title IS DISTINCT FROM i.r->>'title'\n   OR p.record_status::text IS DISTINCT FROM i.r->>'recordStatus'\n   OR p.conclusion_mode::text IS DISTINCT FROM i.r->>'conclusionMode'\n   OR p.compatibility_grade::text IS DISTINCT FROM i.r->>'compatibilityGrade'\n   OR p.best_grade::text IS DISTINCT FROM NULLIF(i.r->>'bestGrade', '')\n   OR p.likely_grade::text IS DISTINCT FROM NULLIF(i.r->>'likelyGrade', '')\n   OR p.worst_grade::text IS DISTINCT FROM NULLIF(i.r->>'worstGrade', '')\n   OR p.rating_notice::text IS DISTINCT FROM i.r->>'ratingNotice'\n   OR p.evidence_strength::text IS DISTINCT FROM i.r->>'evidenceStrength'\n   OR p.radar_assessment_confidence_percent IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,confidencePercent}', '')::numeric\n   OR p.radar_assessment_evidence_coverage_percent IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,evidenceCoveragePercent}', '')::numeric\n   OR p.radar_assessment_evidence_status::text IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,evidenceStatus}', '')\n   OR p.radar_assessment_source_summary IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,sourceSummary}', '')\n   OR p.radar_assessment_source_count IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,sourceCount}', '')::numeric\n   OR p.radar_assessment_policy_version IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,policyVersion}', '')\n   OR p.radar_assessment_assessment_batch IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,assessmentBatch}', '')\n   OR p.radar_assessment_suggested_grade::text IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,suggestedGrade}', '')\n   OR p.radar_assessment_decisive_rule_code IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,decisiveRuleCode}', '')\n   OR p.radar_assessment_decisive_rule_reason IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,decisiveRuleReason}', '')\n   OR p.radar_assessment_requires_human_review IS DISTINCT FROM COALESCE(NULLIF(i.r#>>'{radarAssessment,requiresHumanReview}', '')::boolean, true)\n   OR p.radar_assessment_assessed_at IS DISTINCT FROM NULLIF(i.r#>>'{radarAssessment,assessedAt}', '')::timestamptz\n   OR p.source_kind::text IS DISTINCT FROM i.r->>'sourceKind'\n   OR p.source_package_id IS DISTINCT FROM NULLIF(i.r->>'sourcePackageId', '')\n   OR p.source_package_sha256 IS DISTINCT FROM NULLIF(i.r->>'sourcePackageSha256', '')\n   OR p.conclusion_sha256 IS DISTINCT FROM i.r->>'conclusionSha256'\n   OR p.publication_version IS DISTINCT FROM i.r->>'publicationVersion'`
}

function childDeltaSql(kind) {
  const r = recordJson()
  if (kind === 'reviewReasons') {
    return `WITH expected AS (\n  SELECT x.r->>'publicationKey' publication_key, (v.ordinality - 1)::integer ord, v.value::text value\n  FROM radar_unified_incremental_input_raw raw\n  CROSS JOIN LATERAL (SELECT ${r} AS r) x\n  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(x.r->'reviewReasons', '[]'::jsonb)) WITH ORDINALITY v(value, ordinality)\n), actual AS (\n  SELECT p.publication_key, rr."order" ord, rr.value::text value\n  FROM radar_public_review_reasons rr\n  JOIN radar_public p ON p.id = rr.parent_id\n  JOIN expected e ON e.publication_key = p.publication_key\n  GROUP BY p.publication_key, rr."order", rr.value\n), delta AS ((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected))\nSELECT count(*) FROM delta`
  }
  if (kind === 'matchedRules') {
    return `WITH expected AS (\n  SELECT x.r->>'publicationKey' publication_key, (v.ordinality - 1)::integer ord,\n    COALESCE(NULLIF(v.value->>'id', ''), 'rp-' || substr(x.r->>'conclusionSha256', 1, 24) || '-m-' || (v.ordinality - 1)::text) id,\n    v.value->>'code' code, v.value->>'grade' grade,\n    NULLIF(v.value->>'confidencePercent', '')::numeric confidence_percent, NULLIF(v.value->>'reason', '') reason\n  FROM radar_unified_incremental_input_raw raw\n  CROSS JOIN LATERAL (SELECT ${r} AS r) x\n  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.r#>'{radarAssessment,matchedRules}', '[]'::jsonb)) WITH ORDINALITY v(value, ordinality)\n), actual AS (\n  SELECT p.publication_key, m._order ord, m.id, m.code, m.grade::text grade, m.confidence_percent, m.reason\n  FROM radar_public_radar_assessment_matched_rules m\n  JOIN radar_public p ON p.id = m._parent_id\n  WHERE p.publication_key IN (SELECT publication_key FROM expected)\n), delta AS ((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected))\nSELECT count(*) FROM delta`
  }
  return `WITH expected AS (\n  SELECT x.r->>'publicationKey' publication_key, (v.ordinality - 1)::integer ord,\n    COALESCE(NULLIF(v.value->>'id', ''), 'rp-' || substr(x.r->>'conclusionSha256', 1, 24) || '-c-' || (v.ordinality - 1)::text) id,\n    v.value->>'value' value\n  FROM radar_unified_incremental_input_raw raw\n  CROSS JOIN LATERAL (SELECT ${r} AS r) x\n  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.r#>'{radarAssessment,contradictions}', '[]'::jsonb)) WITH ORDINALITY v(value, ordinality)\n), actual AS (\n  SELECT p.publication_key, c._order ord, c.id, c.value\n  FROM radar_public_radar_assessment_contradictions c\n  JOIN radar_public p ON p.id = c._parent_id\n  WHERE p.publication_key IN (SELECT publication_key FROM expected)\n), delta AS ((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected))\nSELECT count(*) FROM delta`
}

function fingerprintSql(publicationKeys, excludeInput) {
  const input = valuesCte('input_keys', 'publication_key', publicationKeys)
  const predicate = excludeInput
    ? `WHERE NOT EXISTS (SELECT 1 FROM input_keys i WHERE i.publication_key = p.publication_key)`
    : ''
  return `\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nWITH ${input}, base AS (\n  SELECT p.* FROM radar_public p ${predicate}\n), base_ids AS (\n  SELECT id, publication_key FROM base\n)\nSELECT 'main_rows' || E'\\t' || (SELECT count(*)::text FROM base)\nUNION ALL SELECT 'main_md5' || E'\\t' || COALESCE((SELECT md5(string_agg(to_jsonb(b)::text, E'\\n' ORDER BY b.publication_key)) FROM base b), md5(''))\nUNION ALL SELECT 'review_reason_rows' || E'\\t' || (SELECT count(*)::text FROM radar_public_review_reasons r JOIN base_ids b ON b.id=r.parent_id)\nUNION ALL SELECT 'review_reason_md5' || E'\\t' || COALESCE((SELECT md5(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY b.publication_key, r."order", r.id)) FROM radar_public_review_reasons r JOIN base_ids b ON b.id=r.parent_id), md5(''))\nUNION ALL SELECT 'matched_rule_rows' || E'\\t' || (SELECT count(*)::text FROM radar_public_radar_assessment_matched_rules r JOIN base_ids b ON b.id=r._parent_id)\nUNION ALL SELECT 'matched_rule_md5' || E'\\t' || COALESCE((SELECT md5(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY b.publication_key, r._order, r.id)) FROM radar_public_radar_assessment_matched_rules r JOIN base_ids b ON b.id=r._parent_id), md5(''))\nUNION ALL SELECT 'contradiction_rows' || E'\\t' || (SELECT count(*)::text FROM radar_public_radar_assessment_contradictions r JOIN base_ids b ON b.id=r._parent_id)\nUNION ALL SELECT 'contradiction_md5' || E'\\t' || COALESCE((SELECT md5(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY b.publication_key, r._order, r.id)) FROM radar_public_radar_assessment_contradictions r JOIN base_ids b ON b.id=r._parent_id), md5(''))\nORDER BY 1;\nCOMMIT;\n`
}

export function buildSqlBundle(validated) {
  const { records, publicationKeys, workIds, conclusionHashes, reviewReasonRows, matchedRuleRows, contradictionRows } = validated
  const keyValues = valuesCte('input_keys', 'publication_key', publicationKeys)
  const workValues = valuesCte('input_work_ids', 'work_id', workIds, 'integer')
  const preflightChecks = [
    checkLine('radar_public_schema_exists', `(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='radar_public' AND c.relkind='r')`, '1'),
    checkLine('baseline_main_rows', `(SELECT count(*) FROM radar_public)`, String(EXPECTED_BASELINE_ROWS)),
    checkLine('baseline_current_rows', `(SELECT count(*) FROM radar_public WHERE record_status='current')`, String(EXPECTED_BASELINE_ROWS)),
    checkLine('baseline_unique_publication_keys', `(SELECT count(DISTINCT publication_key) FROM radar_public)`, String(EXPECTED_BASELINE_ROWS)),
    checkLine('baseline_unique_conclusion_hashes', `(SELECT count(DISTINCT conclusion_sha256) FROM radar_public)`, String(EXPECTED_BASELINE_ROWS)),
    checkLine('input_publication_overlap', `(SELECT count(*) FROM radar_public p JOIN input_keys i ON i.publication_key=p.publication_key)`, '0'),
    checkLine('input_work_ids_exist', `(SELECT count(*) FROM works w JOIN input_work_ids i ON i.work_id=w.id)`, String(EXPECTED_ROWS)),
    checkLine('input_work_ids_unique', `(SELECT count(DISTINCT work_id) FROM input_work_ids)`, String(EXPECTED_ROWS)),
  ]
  const readonlyPreflight = `\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nWITH ${keyValues}, ${workValues}\n${preflightChecks.map((line, index) => { const item = line.replace(/;$/u, ''); return index === 0 ? item : item.replace(/^SELECT /u, 'UNION ALL SELECT ') }).join('\n') + ';'}\nCOMMIT;\n`

  const r = recordJson()
  const applySql = `\\set ON_ERROR_STOP on\nBEGIN ISOLATION LEVEL SERIALIZABLE;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '30min';\n${inputTableSql()}\n\nDO $$\nDECLARE row_count bigint; invalid_count bigint; overlap_count bigint; baseline_count bigint;\nBEGIN\n  SELECT count(*) INTO row_count FROM radar_unified_incremental_input_raw;\n  IF row_count <> ${EXPECTED_ROWS} THEN RAISE EXCEPTION 'expected ${EXPECTED_ROWS} input rows, received %', row_count; END IF;\n  SELECT count(*) INTO invalid_count FROM radar_unified_incremental_input_raw\n  WHERE line::jsonb->>'publicStatus' <> 'ready_public_ai_create'\n     OR line::jsonb->>'storageStatus' <> 'ready_public_ai_storage_normalized'\n     OR jsonb_array_length(COALESCE(line::jsonb->'blockers', '[]'::jsonb)) <> 0\n     OR jsonb_array_length(COALESCE(line::jsonb->'privateBlockers', '[]'::jsonb)) <> 0\n     OR jsonb_array_length(COALESCE(line::jsonb->'publicBlockers', '[]'::jsonb)) <> 0;\n  IF invalid_count <> 0 THEN RAISE EXCEPTION 'invalid incremental input rows: %', invalid_count; END IF;\n  SELECT count(*) INTO baseline_count FROM radar_public;\n  IF baseline_count <> ${EXPECTED_BASELINE_ROWS} THEN RAISE EXCEPTION 'expected ${EXPECTED_BASELINE_ROWS} baseline rows, received %', baseline_count; END IF;\n  SELECT count(*) INTO overlap_count FROM radar_public p JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}');\n  IF overlap_count <> 0 THEN RAISE EXCEPTION 'incremental publication-key overlap: %', overlap_count; END IF;\nEND $$;\n\nINSERT INTO radar_public (\n  publication_key, work_id, work_id_snapshot, work_site_id, title,\n  record_status, conclusion_mode, compatibility_grade, best_grade, likely_grade, worst_grade,\n  rating_notice, evidence_strength,\n  radar_assessment_confidence_percent, radar_assessment_evidence_coverage_percent,\n  radar_assessment_evidence_status, radar_assessment_source_summary, radar_assessment_source_count,\n  radar_assessment_policy_version, radar_assessment_assessment_batch,\n  radar_assessment_suggested_grade, radar_assessment_decisive_rule_code,\n  radar_assessment_decisive_rule_reason, radar_assessment_requires_human_review,\n  radar_assessment_assessed_at, source_kind, source_package_id, source_package_sha256,\n  conclusion_sha256, publication_version, published_at\n)\nSELECT\n  r->>'publicationKey', (r->>'work')::integer, r->>'workIdSnapshot', NULLIF(r->>'workSiteId', ''), r->>'title',\n  (r->>'recordStatus')::enum_radar_public_record_status,\n  (r->>'conclusionMode')::enum_radar_public_conclusion_mode,\n  (r->>'compatibilityGrade')::enum_radar_public_compatibility_grade,\n  NULLIF(r->>'bestGrade', '')::enum_radar_public_best_grade,\n  NULLIF(r->>'likelyGrade', '')::enum_radar_public_likely_grade,\n  NULLIF(r->>'worstGrade', '')::enum_radar_public_worst_grade,\n  (r->>'ratingNotice')::enum_radar_public_rating_notice,\n  (r->>'evidenceStrength')::enum_radar_public_evidence_strength,\n  NULLIF(r#>>'{radarAssessment,confidencePercent}', '')::numeric,\n  NULLIF(r#>>'{radarAssessment,evidenceCoveragePercent}', '')::numeric,\n  NULLIF(r#>>'{radarAssessment,evidenceStatus}', '')::enum_radar_public_radar_assessment_evidence_status,\n  NULLIF(r#>>'{radarAssessment,sourceSummary}', ''),\n  NULLIF(r#>>'{radarAssessment,sourceCount}', '')::numeric,\n  NULLIF(r#>>'{radarAssessment,policyVersion}', ''),\n  NULLIF(r#>>'{radarAssessment,assessmentBatch}', ''),\n  NULLIF(r#>>'{radarAssessment,suggestedGrade}', '')::enum_radar_public_radar_assessment_suggested_grade,\n  NULLIF(r#>>'{radarAssessment,decisiveRuleCode}', ''),\n  NULLIF(r#>>'{radarAssessment,decisiveRuleReason}', ''),\n  COALESCE(NULLIF(r#>>'{radarAssessment,requiresHumanReview}', '')::boolean, true),\n  NULLIF(r#>>'{radarAssessment,assessedAt}', '')::timestamptz,\n  (r->>'sourceKind')::enum_radar_public_source_kind,\n  NULLIF(r->>'sourcePackageId', ''), NULLIF(r->>'sourcePackageSha256', ''),\n  r->>'conclusionSha256', r->>'publicationVersion', transaction_timestamp()\nFROM radar_unified_incremental_input_raw raw\nCROSS JOIN LATERAL (SELECT ${r} AS r) x;\n\nINSERT INTO radar_public_review_reasons ("order", parent_id, value)\nSELECT (reason.ordinality - 1)::integer, p.id, reason.value::enum_radar_public_review_reasons\nFROM radar_unified_incremental_input_raw raw\nCROSS JOIN LATERAL (SELECT ${r} AS r) x\nJOIN radar_public p ON p.publication_key=x.r->>'publicationKey'\nCROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(x.r->'reviewReasons', '[]'::jsonb)) WITH ORDINALITY AS reason(value, ordinality);\n\nINSERT INTO radar_public_radar_assessment_matched_rules (_order, _parent_id, id, code, grade, confidence_percent, reason)\nSELECT (item.ordinality - 1)::integer, p.id,\n  COALESCE(NULLIF(item.value->>'id', ''), 'rp-' || substr(x.r->>'conclusionSha256', 1, 24) || '-m-' || (item.ordinality - 1)::text),\n  item.value->>'code', (item.value->>'grade')::enum_radar_public_radar_assessment_matched_rules_grade,\n  NULLIF(item.value->>'confidencePercent', '')::numeric, NULLIF(item.value->>'reason', '')\nFROM radar_unified_incremental_input_raw raw\nCROSS JOIN LATERAL (SELECT ${r} AS r) x\nJOIN radar_public p ON p.publication_key=x.r->>'publicationKey'\nCROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.r#>'{radarAssessment,matchedRules}', '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality);\n\nINSERT INTO radar_public_radar_assessment_contradictions (_order, _parent_id, id, value)\nSELECT (item.ordinality - 1)::integer, p.id,\n  COALESCE(NULLIF(item.value->>'id', ''), 'rp-' || substr(x.r->>'conclusionSha256', 1, 24) || '-c-' || (item.ordinality - 1)::text),\n  item.value->>'value'\nFROM radar_unified_incremental_input_raw raw\nCROSS JOIN LATERAL (SELECT ${r} AS r) x\nJOIN radar_public p ON p.publication_key=x.r->>'publicationKey'\nCROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.r#>'{radarAssessment,contradictions}', '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality);\n\nDO $$\nDECLARE mismatch_count bigint; final_count bigint;\nBEGIN\n  SELECT count(*) INTO final_count FROM radar_public;\n  IF final_count <> ${EXPECTED_FINAL_ROWS} THEN RAISE EXCEPTION 'expected ${EXPECTED_FINAL_ROWS} rows after apply, received %', final_count; END IF;\n  SELECT q.mismatch_count INTO mismatch_count FROM (${mainMismatchSql()}) q;\n  IF mismatch_count <> 0 THEN RAISE EXCEPTION 'main row field mismatches: %', mismatch_count; END IF;\n  SELECT q.count INTO mismatch_count FROM (${childDeltaSql('reviewReasons')}) q;\n  IF mismatch_count <> 0 THEN RAISE EXCEPTION 'review reason mismatches: %', mismatch_count; END IF;\n  SELECT q.count INTO mismatch_count FROM (${childDeltaSql('matchedRules')}) q;\n  IF mismatch_count <> 0 THEN RAISE EXCEPTION 'matched rule mismatches: %', mismatch_count; END IF;\n  SELECT q.count INTO mismatch_count FROM (${childDeltaSql('contradictions')}) q;\n  IF mismatch_count <> 0 THEN RAISE EXCEPTION 'contradiction mismatches: %', mismatch_count; END IF;\nEND $$;\nCOMMIT;\n`

  const acceptanceChecks = [
    checkLine('main_rows', `(SELECT count(*) FROM radar_public)`, String(EXPECTED_FINAL_ROWS)),
    checkLine('current_rows', `(SELECT count(*) FROM radar_public WHERE record_status='current')`, String(EXPECTED_FINAL_ROWS)),
    checkLine('input_rows', `(SELECT count(*) FROM radar_public p JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}'))`, String(EXPECTED_ROWS)),
    checkLine('baseline_rows_retained', `(SELECT count(*) FROM radar_public p WHERE NOT EXISTS (SELECT 1 FROM radar_unified_incremental_input_raw raw WHERE p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}')))`, String(EXPECTED_BASELINE_ROWS)),
    checkLine('input_main_mismatches', `(SELECT mismatch_count FROM (${mainMismatchSql()}) q)`, '0'),
    checkLine('input_review_reason_delta', `(SELECT count FROM (${childDeltaSql('reviewReasons')}) q)`, '0'),
    checkLine('input_matched_rule_delta', `(SELECT count FROM (${childDeltaSql('matchedRules')}) q)`, '0'),
    checkLine('input_contradiction_delta', `(SELECT count FROM (${childDeltaSql('contradictions')}) q)`, '0'),
    checkLine('input_review_reason_rows', `(SELECT count(*) FROM radar_public_review_reasons r JOIN radar_public p ON p.id=r.parent_id JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}'))`, String(reviewReasonRows)),
    checkLine('input_matched_rule_rows', `(SELECT count(*) FROM radar_public_radar_assessment_matched_rules r JOIN radar_public p ON p.id=r._parent_id JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}'))`, String(matchedRuleRows)),
    checkLine('input_contradiction_rows', `(SELECT count(*) FROM radar_public_radar_assessment_contradictions r JOIN radar_public p ON p.id=r._parent_id JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}'))`, String(contradictionRows)),
    checkLine('input_publication_key_set_md5', `(SELECT md5(string_agg(p.publication_key, E'\\n' ORDER BY p.publication_key)) FROM radar_public p JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}'))`, sqlString(md5Sorted(publicationKeys))),
    checkLine('input_work_id_set_md5', `(SELECT md5(string_agg(p.work_id::text, E'\\n' ORDER BY p.work_id::text)) FROM radar_public p JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}'))`, sqlString(md5Sorted(workIds))),
    checkLine('input_conclusion_hash_set_md5', `(SELECT md5(string_agg(p.conclusion_sha256, E'\\n' ORDER BY p.conclusion_sha256)) FROM radar_public p JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}'))`, sqlString(md5Sorted(conclusionHashes))),
    checkLine('input_single_published_at', `(SELECT count(DISTINCT p.published_at) FROM radar_public p JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}'))`, '1'),
    checkLine('orphan_review_reasons', `(SELECT count(*) FROM radar_public_review_reasons r LEFT JOIN radar_public p ON p.id=r.parent_id WHERE p.id IS NULL)`, '0'),
    checkLine('orphan_matched_rules', `(SELECT count(*) FROM radar_public_radar_assessment_matched_rules r LEFT JOIN radar_public p ON p.id=r._parent_id WHERE p.id IS NULL)`, '0'),
    checkLine('orphan_contradictions', `(SELECT count(*) FROM radar_public_radar_assessment_contradictions r LEFT JOIN radar_public p ON p.id=r._parent_id WHERE p.id IS NULL)`, '0'),
    ...Object.entries(EXPECTED_FINAL_GRADES).map(([grade, count]) => checkLine(`grade_${grade}`, `(SELECT count(*) FROM radar_public WHERE compatibility_grade=${sqlString(grade)})`, String(count))),
  ]
  const acceptanceSql = `\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\nBEGIN ISOLATION LEVEL REPEATABLE READ;\n${inputTableSql()}\n${acceptanceChecks.join('\n')}\nCOMMIT;\n`

  const rollbackSql = `\\set ON_ERROR_STOP on\nBEGIN ISOLATION LEVEL SERIALIZABLE;\nSET LOCAL lock_timeout='10s';\nSET LOCAL statement_timeout='30min';\n${inputTableSql()}\nDO $$ DECLARE existing_count bigint; BEGIN\n  SELECT count(*) INTO existing_count FROM radar_public p JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}');\n  IF existing_count <> ${EXPECTED_ROWS} THEN RAISE EXCEPTION 'rollback expected ${EXPECTED_ROWS} rows, received %', existing_count; END IF;\nEND $$;\nDELETE FROM radar_public p USING radar_unified_incremental_input_raw raw\nWHERE p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}');\nDO $$ DECLARE remaining_count bigint; overlap_count bigint; BEGIN\n  SELECT count(*) INTO remaining_count FROM radar_public;\n  IF remaining_count <> ${EXPECTED_BASELINE_ROWS} THEN RAISE EXCEPTION 'rollback expected ${EXPECTED_BASELINE_ROWS} baseline rows, received %', remaining_count; END IF;\n  SELECT count(*) INTO overlap_count FROM radar_public p JOIN radar_unified_incremental_input_raw raw ON p.publication_key=(raw.line::jsonb#>>'{publicRecord,publicationKey}');\n  IF overlap_count <> 0 THEN RAISE EXCEPTION 'rollback input rows remain: %', overlap_count; END IF;\nEND $$;\nCOMMIT;\n`

  const postRollbackChecks = [
    checkLine('main_rows', `(SELECT count(*) FROM radar_public)`, String(EXPECTED_BASELINE_ROWS)),
    checkLine('current_rows', `(SELECT count(*) FROM radar_public WHERE record_status='current')`, String(EXPECTED_BASELINE_ROWS)),
    checkLine('input_overlap', `(SELECT count(*) FROM radar_public p JOIN input_keys i ON i.publication_key=p.publication_key)`, '0'),
    checkLine('orphan_review_reasons', `(SELECT count(*) FROM radar_public_review_reasons r LEFT JOIN radar_public p ON p.id=r.parent_id WHERE p.id IS NULL)`, '0'),
    checkLine('orphan_matched_rules', `(SELECT count(*) FROM radar_public_radar_assessment_matched_rules r LEFT JOIN radar_public p ON p.id=r._parent_id WHERE p.id IS NULL)`, '0'),
    checkLine('orphan_contradictions', `(SELECT count(*) FROM radar_public_radar_assessment_contradictions r LEFT JOIN radar_public p ON p.id=r._parent_id WHERE p.id IS NULL)`, '0'),
  ]
  const postRollbackSql = `\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nWITH ${keyValues}\n${postRollbackChecks.map((line, index) => { const item = line.replace(/;$/u, ''); return index === 0 ? item : item.replace(/^SELECT /u, 'UNION ALL SELECT ') }).join('\n') + ';'}\nCOMMIT;\n`

  const sequenceStateSql = `\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT 'radar_public_id_seq' || E'\\t' || last_value::text || E'\\t' || is_called::text FROM public.radar_public_id_seq\nUNION ALL\nSELECT 'radar_public_review_reasons_id_seq' || E'\\t' || last_value::text || E'\\t' || is_called::text FROM public.radar_public_review_reasons_id_seq\nORDER BY 1;\nCOMMIT;\n`

  return {
    readonlyPreflight,
    applySql,
    acceptanceSql,
    rollbackSql,
    postRollbackSql,
    baselineFingerprintSql: fingerprintSql(publicationKeys, true),
    fullFingerprintSql: fingerprintSql(publicationKeys, false),
    sequenceStateSql,
    summary: canonical({
      schemaVersion: 1,
      version: VERSION,
      inputRows: records.length,
      baselineRows: EXPECTED_BASELINE_ROWS,
      finalRows: EXPECTED_FINAL_ROWS,
      uniquePublicationKeys: publicationKeys.length,
      uniqueWorkIds: workIds.length,
      uniqueConclusionHashes: conclusionHashes.length,
      incrementalGradeCounts: EXPECTED_INCREMENTAL_GRADES,
      finalGradeCounts: EXPECTED_FINAL_GRADES,
      reviewReasonRows,
      matchedRuleRows,
      contradictionRows,
      publicationKeySetMd5: md5Sorted(publicationKeys),
      workIdSetMd5: md5Sorted(workIds),
      conclusionHashSetMd5: md5Sorted(conclusionHashes),
      productionOperation: 'read_only_preflight_and_pg_dump_only',
      labOperation: 'incremental_create_acceptance_exact_rollback',
      productionApplyAuthorized: false,
    }),
  }
}

export function buildOutputs({ assemblyDir, assemblyZipSha256, outDir }) {
  if (!/^[0-9a-f]{64}$/u.test(val(assemblyZipSha256).toLowerCase())) {
    throw new Error('Unified assembly ZIP SHA-256 is invalid.')
  }
  assertManifest(assemblyDir)
  const summary = readJson(path.join(assemblyDir, 'radar-unified-incremental-assembly-summary.json'))
  const validation = readJson(path.join(assemblyDir, 'unified-incremental-assembly-validation.json'))
  if (summary?.rows !== EXPECTED_ROWS || summary?.storageNormalized !== EXPECTED_ROWS || summary?.blocked !== 0 || list(summary?.globalBlockers).length) {
    throw new Error('Unified assembly summary is not ready for storage lab planning.')
  }
  if (summary?.productionPublicBaseline !== EXPECTED_BASELINE_ROWS || summary?.readyForStorageLabPlanning !== true) {
    throw new Error('Assembly summary baseline or next-step gate mismatch.')
  }
  if (validation?.passed !== true || list(validation?.globalBlockers).length) {
    throw new Error('Unified assembly validation did not pass.')
  }
  const readyPath = path.join(assemblyDir, 'public-ai-storage-ready.jsonl')
  if (val(summary?.readyFileSha256).toLowerCase() !== sha256File(readyPath)) {
    throw new Error('Unified assembly ready-file SHA-256 binding mismatch.')
  }
  const validated = validateReadyRows(readJsonl(readyPath))
  const sql = buildSqlBundle(validated)

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    productionPreflight: path.join(outDir, 'production-readonly-preflight.sql'),
    apply: path.join(outDir, 'incremental-apply.sql.lab-only'),
    acceptance: path.join(outDir, 'incremental-acceptance.sql'),
    rollback: path.join(outDir, 'incremental-rollback.sql.lab-only'),
    postRollback: path.join(outDir, 'incremental-post-rollback-acceptance.sql'),
    baselineFingerprint: path.join(outDir, 'baseline-only-fingerprint.sql'),
    fullFingerprint: path.join(outDir, 'full-radar-fingerprint.sql'),
    sequenceState: path.join(outDir, 'radar-sequence-state.sql'),
    summary: path.join(outDir, 'radar-unified-incremental-storage-lab-plan-summary.json'),
  }
  write(outputs.productionPreflight, sql.readonlyPreflight)
  write(outputs.apply, sql.applySql)
  write(outputs.acceptance, sql.acceptanceSql)
  write(outputs.rollback, sql.rollbackSql)
  write(outputs.postRollback, sql.postRollbackSql)
  write(outputs.baselineFingerprint, sql.baselineFingerprintSql)
  write(outputs.fullFingerprint, sql.fullFingerprintSql)
  write(outputs.sequenceState, sql.sequenceStateSql)
  const summaryOut = canonical({
    ...sql.summary,
    generatedAt: new Date().toISOString(),
    assemblyBundleSha256: val(assemblyZipSha256).toLowerCase(),
    assemblyReadyFile: 'public-ai-storage-ready.jsonl',
    assemblyReadyFileSha256: sha256File(readyPath),
    sqlSha256: Object.fromEntries(Object.entries(outputs).filter(([key]) => key !== 'summary').map(([key, file]) => [key, sha256File(file)])),
    safety: canonical({
      productionDatabaseRead: true,
      productionDatabaseWrite: false,
      productionPayloadRead: false,
      productionPayloadWrite: false,
      isolatedLabDatabaseWrite: true,
      networkDisabledForLab: true,
      productionApplyAuthorized: false,
    }),
  })
  writeJson(outputs.summary, summaryOut)
  return { outputs, summary: summaryOut }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of ['execute', 'apply', 'write', 'patch', 'publish', 'restore', 'confirm', 'approval-token']) {
    if (args[key]) throw new Error('SQL builder is planning-only and rejects execution/apply/write flags.')
  }
  const result = buildOutputs({
    assemblyDir: required(args, 'assembly-dir'),
    assemblyZipSha256: val(args['assembly-zip-sha256']),
    outDir: required(args, 'out-dir'),
  })
  console.log(JSON.stringify({ ok: true, summary: result.summary, outputs: result.outputs }, null, 2))
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1 })
}
