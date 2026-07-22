#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VALID_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function text(value) {
  return String(value ?? '').trim()
}

function grade(value) {
  const normalized = text(value).toUpperCase()
  return VALID_GRADES.has(normalized) ? normalized : ''
}

function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}

function readJson(file) {
  return JSON.parse(readText(file))
}

function readJsonl(file) {
  return readText(file)
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`)
      }
    })
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeText(file, value) {
  fs.writeFileSync(file, `${String(value).replace(/\s+$/u, '')}\n`, 'utf8')
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2))
}

function writeJsonl(file, rows) {
  const body = rows.map((row) => JSON.stringify(row)).join('\n')
  fs.writeFileSync(file, body ? `${body}\n` : '', 'utf8')
}

function countBy(rows, key) {
  const counts = {}
  for (const row of rows) {
    const value = text(row[key]) || '<empty>'
    counts[value] = (counts[value] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])))
}

function canonicalHumanMeaningful(row) {
  return Boolean(
    row.canonical_grade !== null
    || text(row.canonical_note)
    || text(row.canonical_source_summary)
    || (text(row.canonical_evidence_status) && text(row.canonical_evidence_status) !== 'unassessed')
    || row.canonical_assessed_at
    || row.canonical_assessed_by_id
    || !['', 'pending'].includes(text(row.canonical_status)),
  )
}

function humanDecision(row) {
  const canonicalNote = text(row.canonical_note)
  const legacyNote = text(row.legacy_note)
  const canonicalMeaningful = canonicalHumanMeaningful(row)
  const hasConflict = Boolean(row.note_conflict || row.status_conflict)
  let action = 'manual_review'
  let automaticWriteEligible = false
  let requiresExplicitDecision = true
  let reason = 'Unable to classify safely.'

  if (text(row.legacy_status) === 'deprecated') {
    action = 'deprecated_legacy_requires_discard_approval'
    requiresExplicitDecision = Boolean(legacyNote)
    reason = legacyNote
      ? 'Deprecated legacy review contains lifecycle or moderation notes. Do not copy into humanAssessment; preserve in backup and approve discard or separate archival.'
      : 'Deprecated legacy review has no semantic note and should not be copied.'
  } else if (
    !canonicalMeaningful
    && ['reviewed', 'disputed'].includes(text(row.legacy_status))
    && legacyNote
  ) {
    action = 'copy_semantic_legacy_to_canonical'
    automaticWriteEligible = true
    requiresExplicitDecision = false
    reason = 'Canonical human assessment is empty while legacy review has a semantic reviewed/disputed state and note.'
  } else if (
    !canonicalMeaningful
    && text(row.legacy_status) === 'pending'
    && !legacyNote
  ) {
    action = 'metadata_only_no_copy'
    requiresExplicitDecision = false
    reason = 'Legacy row contains only pending/default metadata. Copying reviewedAt/reviewer would falsely imply a completed assessment.'
  } else if (
    canonicalMeaningful
    && !hasConflict
    && text(row.canonical_status) === text(row.legacy_status)
    && canonicalNote === legacyNote
  ) {
    if (row.canonical_assessed_at && row.canonical_assessed_by_id) {
      action = 'canonical_equivalent_no_write'
      requiresExplicitDecision = false
      reason = 'Canonical and legacy human values are equivalent; canonical data is already complete.'
    } else {
      action = 'canonical_keep_legacy_metadata_only'
      requiresExplicitDecision = false
      reason = 'Canonical semantic content already exists. Legacy timestamp/reviewer is not copied into a pending assessment.'
    }
  } else if (canonicalMeaningful && hasConflict) {
    action = 'canonical_wins_legacy_manual_archive'
    requiresExplicitDecision = true
    reason = 'Canonical and legacy values disagree. Canonical remains authoritative; legacy text must be archived or explicitly discarded before column retirement.'
  } else if (canonicalMeaningful) {
    action = 'canonical_keep_no_write'
    requiresExplicitDecision = false
    reason = 'Canonical human assessment already carries the meaningful data.'
  }

  const proposedCanonical = {
    grade: row.canonical_grade,
    status: row.canonical_status,
    note: row.canonical_note,
    sourceSummary: row.canonical_source_summary,
    evidenceStatus: row.canonical_evidence_status,
    assessedAt: row.canonical_assessed_at,
    assessedById: row.canonical_assessed_by_id,
  }

  if (action === 'copy_semantic_legacy_to_canonical') {
    proposedCanonical.status = row.legacy_status
    proposedCanonical.note = row.legacy_note
    proposedCanonical.assessedAt = row.legacy_reviewed_at
    proposedCanonical.assessedById = row.legacy_reviewed_by_id
  }

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    action,
    automaticWriteEligible,
    requiresExplicitDecision,
    reason,
    conflicts: {
      rankGrade: Boolean(row.rank_grade_conflict),
      note: Boolean(row.note_conflict),
      status: Boolean(row.status_conflict),
    },
    before: {
      rank: row.rank,
      canonical: {
        grade: row.canonical_grade,
        status: row.canonical_status,
        note: row.canonical_note,
        sourceSummary: row.canonical_source_summary,
        evidenceStatus: row.canonical_evidence_status,
        assessedAt: row.canonical_assessed_at,
        assessedById: row.canonical_assessed_by_id,
      },
      legacy: {
        status: row.legacy_status,
        note: row.legacy_note,
        reviewedAt: row.legacy_reviewed_at,
        reviewedById: row.legacy_reviewed_by_id,
      },
    },
    proposedCanonical,
  }
}

function rankDecision(row) {
  const validHuman = Boolean(
    grade(row.human_grade)
    && ['reviewed', 'disputed'].includes(text(row.human_status)),
  )
  const privateAIGrade = grade(row.private_ai_grade)
  const storedGrade = grade(row.stored_rank)
  const looksLikeLegacyAI = Boolean(
    storedGrade
    && text(row.import_batch).startsWith('public-catalog-import-')
    && text(row.rating_notice) === 'ai_synthesized_pending_review',
  )
  const archivedNonPublic = Boolean(
    text(row.catalog_status) === 'archived'
    || text(row.payload_status) === 'draft',
  )

  let preservationClass = 'unresolved_legacy_rank'
  let effectiveGradeWithoutPublicAI = 'unknown'
  let candidatePublicAIGrade = null
  let requiresPublicationReview = false
  const retireStoredRankNow = false
  let reason = 'No canonical source established.'

  if (validHuman) {
    preservationClass = 'canonical_human'
    effectiveGradeWithoutPublicAI = grade(row.human_grade)
    reason = 'A valid canonical human grade exists and remains the effective public grade.'
  } else if (privateAIGrade) {
    preservationClass = 'private_ai_requires_publication_review'
    candidatePublicAIGrade = privateAIGrade
    requiresPublicationReview = true
    reason = 'A private Works Radar suggestion exists, but it is not public until reviewed and copied into radar-public-conclusions.'
  } else if (looksLikeLegacyAI) {
    preservationClass = 'legacy_ai_candidate_requires_review'
    candidatePublicAIGrade = storedGrade
    requiresPublicationReview = true
    reason = 'Import batch and rating notice strongly indicate an old AI-synthesized candidate. Preserve it for public-AI review; never convert it into human assessment.'
  } else if (archivedNonPublic) {
    preservationClass = 'archived_nonpublic_legacy_rank'
    reason = 'The Work is draft or archived and has no canonical human/public-AI source. Do not inherit the stored rank into public output.'
  }

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    preservationClass,
    storedRank: row.stored_rank,
    effectiveGradeWithoutPublicAI,
    candidatePublicAIGrade,
    requiresPublicationReview,
    automaticPublicationEligible: false,
    retireStoredRankNow,
    reason,
    provenance: {
      updatedAt: row.updated_at,
      payloadStatus: row.payload_status,
      catalogStatus: row.catalog_status,
      importBatch: row.import_batch,
      chosenBaseSource: row.chosen_base_source,
      ratingNotice: row.rating_notice,
      evidenceStrength: row.evidence_strength,
      privateAI: {
        grade: row.private_ai_grade,
        sourceSummary: row.private_ai_source_summary,
        policyVersion: row.private_ai_policy_version,
        assessmentBatch: row.private_ai_assessment_batch,
        assessedAt: row.private_ai_assessed_at,
      },
    },
  }
}

function schemaDecision(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    finding: row.status_finding,
    decision: 'retire_legacy_status_without_mapping',
    reason: 'catalogStatus already carries archived lifecycle semantics; Payload _status remains the only draft/published state.',
    before: {
      legacyStatus: row.legacy_status,
      payloadStatus: row.payload_status,
      catalogStatus: row.catalog_status,
      legacyXWikiPage: row.legacy_x_wiki_page,
    },
    proposed: {
      legacyStatus: 'drop_after_backup_and_acceptance',
      payloadStatus: row.payload_status,
      catalogStatus: row.catalog_status,
      legacyXWikiPage: 'drop_without_replacement',
    },
  }
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

function buildHumanDryRunSql(plans) {
  const rows = plans.map((plan) => {
    const b = plan.before
    const p = plan.proposedCanonical
    return `    (${[
      sqlLiteral(plan.id),
      sqlLiteral(plan.action),
      sqlLiteral(b.canonical.status),
      sqlLiteral(b.canonical.note),
      sqlLiteral(b.canonical.assessedAt),
      sqlLiteral(b.canonical.assessedById),
      sqlLiteral(b.legacy.status),
      sqlLiteral(b.legacy.note),
      sqlLiteral(b.legacy.reviewedAt),
      sqlLiteral(b.legacy.reviewedById),
      sqlLiteral(p.status),
      sqlLiteral(p.note),
      sqlLiteral(p.assessedAt),
      sqlLiteral(p.assessedById),
    ].join(', ')})`
  })

  return `-- READ-ONLY. This file verifies exact before-values and proposed canonical values.
-- It does not update, delete, alter, or publish any Work.

BEGIN TRANSACTION READ ONLY;

WITH plan(
  id,
  action,
  expected_canonical_status,
  expected_canonical_note,
  expected_canonical_assessed_at,
  expected_canonical_assessed_by_id,
  expected_legacy_status,
  expected_legacy_note,
  expected_legacy_reviewed_at,
  expected_legacy_reviewed_by_id,
  proposed_canonical_status,
  proposed_canonical_note,
  proposed_canonical_assessed_at,
  proposed_canonical_assessed_by_id
) AS (
  VALUES
${rows.join(',\n')}
)
SELECT
  p.*,
  w.title,
  w.human_assessment_status::text AS current_canonical_status,
  w.human_assessment_note AS current_canonical_note,
  w.human_assessment_assessed_at AS current_canonical_assessed_at,
  w.human_assessment_assessed_by_id AS current_canonical_assessed_by_id,
  w.review_status::text AS current_legacy_status,
  w.human_review_note AS current_legacy_note,
  w.human_reviewed_at AS current_legacy_reviewed_at,
  w.human_reviewed_by_id AS current_legacy_reviewed_by_id,
  (
    w.human_assessment_status::text IS NOT DISTINCT FROM p.expected_canonical_status
    AND w.human_assessment_note IS NOT DISTINCT FROM p.expected_canonical_note
    AND w.human_assessment_assessed_at::text IS NOT DISTINCT FROM p.expected_canonical_assessed_at
    AND w.human_assessment_assessed_by_id IS NOT DISTINCT FROM p.expected_canonical_assessed_by_id
    AND w.review_status::text IS NOT DISTINCT FROM p.expected_legacy_status
    AND w.human_review_note IS NOT DISTINCT FROM p.expected_legacy_note
    AND w.human_reviewed_at::text IS NOT DISTINCT FROM p.expected_legacy_reviewed_at
    AND w.human_reviewed_by_id IS NOT DISTINCT FROM p.expected_legacy_reviewed_by_id
  ) AS before_values_match
FROM plan p
JOIN public.works w ON w.id = p.id
ORDER BY p.id;

ROLLBACK;
`
}

function buildSchemaDryRunSql(schemaPlans) {
  const ids = schemaPlans.map((row) => sqlLiteral(row.id)).join(', ')
  return `-- READ-ONLY retirement verification. No DROP or ALTER statement is present.

BEGIN TRANSACTION READ ONLY;

SELECT
  id,
  title,
  status AS legacy_status,
  _status AS payload_status,
  catalog_status::text AS catalog_status,
  legacy_x_wiki_page
FROM public.works
WHERE id IN (${ids || 'NULL'})
ORDER BY id;

SELECT
  COUNT(*) FILTER (WHERE status IS DISTINCT FROM _status) AS legacy_status_vs_payload_mismatch,
  COUNT(*) FILTER (WHERE status NOT IN ('draft', 'published')) AS invalid_legacy_status_rows,
  COUNT(*) FILTER (WHERE legacy_x_wiki_page IS NOT NULL) AS legacy_xwiki_non_null_rows
FROM public.works;

SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'works' AND column_name IN (
      'status',
      'legacy_x_wiki_page',
      'review_status',
      'human_review_note',
      'human_reviewed_at',
      'human_reviewed_by_id'
    ))
    OR
    (table_name = '_works_v' AND column_name IN (
      'version_status',
      'version_legacy_x_wiki_page',
      'version_review_status',
      'version_human_review_note',
      'version_human_reviewed_at',
      'version_human_reviewed_by_id'
    ))
  )
ORDER BY table_name, column_name;

ROLLBACK;
`
}

function markdownSummary(summary, humanPlans, rankPlans, schemaPlans) {
  const humanCounts = Object.entries(summary.humanActions)
    .map(([key, value]) => `- \`${key}\`: ${value}`)
    .join('\n')
  const rankCounts = Object.entries(summary.rankPreservationClasses)
    .map(([key, value]) => `- \`${key}\`: ${value}`)
    .join('\n')

  return `# Work normalization dry-run summary

Status: read-only plan only. No database, Payload, migration, schema, or tracked-data write was performed.

## Input integrity

- Audit transport: \`${summary.input.transport}\`
- JSON validation: \`${summary.input.jsonValidated}\`
- Human candidates: ${summary.input.humanCandidateRows}
- Schema exceptions: ${summary.input.schemaExceptionRows}
- Rank candidates: ${summary.input.rankCandidateRows}

## Human normalization decisions

${humanCounts}

Automatic write eligibility is a planning flag only. No executable UPDATE statement is generated.

Exact rows requiring an explicit decision: ${humanPlans.filter((row) => row.requiresExplicitDecision).length}.

## Rank preservation decisions

${rankCounts}

Public-AI candidates requiring review: ${rankPlans.filter((row) => row.requiresPublicationReview).length}.

Stored \`rank\` is not retired by this plan. It remains until public AI candidates are reviewed, all readers consume \`effectiveGrade\`, and a separate approved migration exists.

## Schema retirement

Schema exceptions: ${schemaPlans.length}.

The legacy \`status\` value is never mapped to Payload \`_status\`. \`legacy_x_wiki_page\` has no replacement.

## Generated artifacts

- \`human-normalization-plan.jsonl\`
- \`human-explicit-decisions.jsonl\`
- \`rank-preservation-plan.jsonl\`
- \`public-ai-review-candidates.jsonl\`
- \`schema-retirement-plan.json\`
- \`phase1-human-normalization-dryrun.sql\`
- \`schema-retirement-dryrun.sql\`
- \`normalization-summary.json\`
- \`manifest.json\`

The SQL files contain read-only verification queries only.
`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!text(args['audit-dir'])) throw new Error('Required: --audit-dir <verified audit directory>')
  const auditDir = path.resolve(text(args['audit-dir']))

  const outputDir = path.resolve(
    text(args['output-dir'])
    || path.join('exports', `work-normalization-dryrun-${new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}`),
  )
  ensureDirectory(outputDir)

  const validation = readJson(path.join(auditDir, 'validation.json'))
  if (validation.jsonValidated !== true) throw new Error('Audit JSON validation is not true.')
  if (validation.transport !== 'postgres_utf8_base64_to_powershell_utf8') {
    throw new Error(`Unsupported audit transport: ${validation.transport}`)
  }

  const manifest = readJson(path.join(auditDir, 'manifest.json'))
  for (const entry of manifest) {
    const file = path.join(auditDir, entry.file)
    const stats = fs.statSync(file)
    if (stats.size !== Number(entry.bytes)) {
      throw new Error(`Manifest byte mismatch: ${entry.file}`)
    }
    if (sha256File(file) !== text(entry.sha256).toLowerCase()) {
      throw new Error(`Manifest SHA-256 mismatch: ${entry.file}`)
    }
  }

  const counts = readJson(path.join(auditDir, 'counts.json'))
  const humanRows = readJsonl(path.join(auditDir, 'human-normalization-candidates.jsonl'))
  const schemaRows = readJsonl(path.join(auditDir, 'schema-retirement-exceptions.jsonl'))
  const rankRows = readJsonl(path.join(auditDir, 'rank-retirement-candidates.jsonl'))

  if (humanRows.length !== Number(validation.humanCandidateRows)) {
    throw new Error('Human candidate count differs from validation.json')
  }
  if (schemaRows.length !== Number(validation.schemaExceptionRows)) {
    throw new Error('Schema exception count differs from validation.json')
  }
  if (rankRows.length !== Number(validation.rankCandidateRows)) {
    throw new Error('Rank candidate count differs from validation.json')
  }

  const humanPlans = humanRows.map(humanDecision)
  const rankPlans = rankRows.map(rankDecision)
  const schemaPlans = schemaRows.map(schemaDecision)
  const explicitHumanDecisions = humanPlans.filter((row) => row.requiresExplicitDecision)
  const publicAIReviewCandidates = rankPlans.filter((row) => row.requiresPublicationReview)

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    input: {
      auditDirectory: auditDir,
      transport: validation.transport,
      jsonValidated: validation.jsonValidated,
      humanCandidateRows: humanRows.length,
      schemaExceptionRows: schemaRows.length,
      rankCandidateRows: rankRows.length,
      counts,
    },
    humanActions: countBy(humanPlans, 'action'),
    rankPreservationClasses: countBy(rankPlans, 'preservationClass'),
    explicitHumanDecisionRows: explicitHumanDecisions.length,
    automaticHumanCopyRows: humanPlans.filter((row) => row.automaticWriteEligible).length,
    publicAIReviewCandidateRows: publicAIReviewCandidates.length,
    schemaRetirementExceptionRows: schemaPlans.length,
    safety: {
      databaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      executableUpdateSqlGenerated: false,
    },
  }

  writeJsonl(path.join(outputDir, 'human-normalization-plan.jsonl'), humanPlans)
  writeJsonl(path.join(outputDir, 'human-explicit-decisions.jsonl'), explicitHumanDecisions)
  writeJsonl(path.join(outputDir, 'rank-preservation-plan.jsonl'), rankPlans)
  writeJsonl(path.join(outputDir, 'public-ai-review-candidates.jsonl'), publicAIReviewCandidates)
  writeJson(path.join(outputDir, 'schema-retirement-plan.json'), schemaPlans)
  writeText(path.join(outputDir, 'phase1-human-normalization-dryrun.sql'), buildHumanDryRunSql(humanPlans))
  writeText(path.join(outputDir, 'schema-retirement-dryrun.sql'), buildSchemaDryRunSql(schemaPlans))
  writeJson(path.join(outputDir, 'normalization-summary.json'), summary)
  writeText(path.join(outputDir, 'normalization-summary.md'), markdownSummary(summary, humanPlans, rankPlans, schemaPlans))

  const files = fs.readdirSync(outputDir)
    .filter((name) => name !== 'manifest.json')
    .sort()
  const outputManifest = files.map((name) => {
    const file = path.join(outputDir, name)
    return {
      file: name,
      bytes: fs.statSync(file).size,
      sha256: sha256File(file),
    }
  })
  writeJson(path.join(outputDir, 'manifest.json'), outputManifest)

  console.log('Work normalization dry-run plan complete')
  console.log(`OutputDirectory: ${outputDir}`)
  console.log(`HumanPlanRows: ${humanPlans.length}`)
  console.log(`HumanExplicitDecisionRows: ${explicitHumanDecisions.length}`)
  console.log(`HumanAutomaticCopyRows: ${summary.automaticHumanCopyRows}`)
  console.log(`RankPlanRows: ${rankPlans.length}`)
  console.log(`PublicAIReviewCandidateRows: ${publicAIReviewCandidates.length}`)
  console.log(`SchemaExceptionRows: ${schemaPlans.length}`)
  console.log('')
  console.log('DatabaseWrite: False')
  console.log('PayloadWrite: False')
  console.log('MigrationGeneration: False')
  console.log('SchemaPush: False')
  console.log('ExecutableUpdateSqlGenerated: False')
}

main()
