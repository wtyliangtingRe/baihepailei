import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const planner = path.join(repoRoot, 'scripts/radar/build-work-normalization-dryrun-v01.mjs')
const wrapper = path.join(repoRoot, 'scripts/radar/run-and-package-work-normalization-dryrun-v01.ps1')

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

function human(overrides = {}) {
  return {
    id: 1,
    title: '人工候选',
    slug: 'human-candidate',
    rank: 'unknown',
    canonical_grade: null,
    canonical_status: 'pending',
    canonical_note: null,
    canonical_source_summary: null,
    canonical_evidence_status: null,
    canonical_assessed_at: null,
    canonical_assessed_by_id: null,
    legacy_status: 'disputed',
    legacy_note: '旧人工说明',
    legacy_reviewed_at: '2026-07-01T00:00:00.000+00:00',
    legacy_reviewed_by_id: 1,
    rank_grade_conflict: false,
    note_conflict: false,
    status_conflict: true,
    proposed_action: 'copy_non_conflicting_legacy_into_canonical',
    ...overrides,
  }
}

function rank(overrides = {}) {
  return {
    id: 10,
    title: '等级候选',
    slug: 'rank-candidate',
    updated_at: '2026-07-01T00:00:00.000+00:00',
    payload_status: 'published',
    catalog_status: 'active',
    import_batch: 'public-catalog-import-v02',
    chosen_base_source: 'steam',
    rating_notice: 'ai_synthesized_pending_review',
    evidence_strength: 'medium',
    stored_rank: 'E',
    human_grade: null,
    human_status: 'pending',
    private_ai_grade: null,
    private_ai_source_summary: null,
    private_ai_policy_version: null,
    private_ai_assessment_batch: null,
    private_ai_assessed_at: null,
    grade_without_public_ai: 'unknown',
    source_without_public_ai: 'none',
    preservation_class: 'legacy_rank_provenance_unknown',
    ...overrides,
  }
}

test('planner classifies verified audit records without generating executable update SQL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-normalization-plan-'))
  const audit = path.join(root, 'audit')
  const output = path.join(root, 'output')
  fs.mkdirSync(audit, { recursive: true })

  const humanRows = [
    human(),
    human({
      id: 2,
      title: '废止记录',
      legacy_status: 'deprecated',
      legacy_note: 'soft-hidden lifecycle note',
      status_conflict: true,
    }),
  ]
  const schemaRows = [{
    id: 2,
    title: '废止记录',
    slug: 'retired',
    legacy_status: 'archived',
    payload_status: 'draft',
    catalog_status: 'archived',
    legacy_x_wiki_page: null,
    status_finding: 'invalid_legacy_status',
  }]
  const rankRows = [
    rank(),
    rank({
      id: 11,
      title: '私有 AI',
      import_batch: 'payload-work-draft-plan-v02',
      stored_rank: 'D',
      private_ai_grade: 'C',
    }),
    rank({
      id: 12,
      title: '人工',
      import_batch: null,
      rating_notice: 'manual_reviewed',
      stored_rank: 'A',
      human_grade: 'A',
      human_status: 'reviewed',
    }),
    rank({
      id: 13,
      title: '归档测试',
      import_batch: null,
      rating_notice: 'manual_reviewed',
      stored_rank: 'A',
      payload_status: 'draft',
      catalog_status: 'archived',
    }),
  ]

  const files = {
    'human-normalization-candidates.jsonl': humanRows,
    'schema-retirement-exceptions.jsonl': schemaRows,
    'rank-retirement-candidates.jsonl': rankRows,
  }
  for (const [name, rows] of Object.entries(files)) {
    writeJsonl(path.join(audit, name), rows)
  }
  writeJson(path.join(audit, 'counts.json'), {
    worksTotal: 4,
    meaningfulLegacyHumanRows: 2,
    meaningfulCanonicalHumanRows: 0,
  })
  writeJson(path.join(audit, 'validation.json'), {
    transport: 'postgres_utf8_base64_to_powershell_utf8',
    jsonValidated: true,
    humanCandidateRows: humanRows.length,
    schemaExceptionRows: schemaRows.length,
    rankCandidateRows: rankRows.length,
    countsRows: 1,
  })

  const manifestFiles = [
    'human-normalization-candidates.jsonl',
    'schema-retirement-exceptions.jsonl',
    'rank-retirement-candidates.jsonl',
    'counts.json',
    'validation.json',
  ]
  writeJson(path.join(audit, 'manifest.json'), manifestFiles.map((name) => {
    const file = path.join(audit, name)
    return {
      file: name,
      bytes: fs.statSync(file).size,
      sha256: sha256(file),
    }
  }))

  const result = spawnSync(process.execPath, [
    planner,
    '--audit-dir',
    audit,
    '--output-dir',
    output,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'normalization-summary.json'), 'utf8'))
  assert.equal(summary.automaticHumanCopyRows, 1)
  assert.equal(summary.explicitHumanDecisionRows, 1)
  assert.equal(summary.publicAIReviewCandidateRows, 2)
  assert.deepEqual(summary.rankPreservationClasses, {
    archived_nonpublic_legacy_rank: 1,
    canonical_human: 1,
    legacy_ai_candidate_requires_review: 1,
    private_ai_requires_publication_review: 1,
  })
  assert.equal(summary.safety.executableUpdateSqlGenerated, false)

  const sql = fs.readFileSync(path.join(output, 'phase1-human-normalization-dryrun.sql'), 'utf8')
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/u)
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/u)

  const publicAI = fs.readFileSync(path.join(output, 'public-ai-review-candidates.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    publicAI.map((row) => row.preservationClass).sort(),
    ['legacy_ai_candidate_requires_review', 'private_ai_requires_publication_review'],
  )
})

test('packaging wrapper requires verified input and refuses executable update SQL', () => {
  const source = fs.readFileSync(wrapper, 'utf8')
  assert.match(source, /validation\.json/u)
  assert.match(source, /postgres_utf8_base64_to_powershell_utf8/u)
  assert.match(source, /executableUpdateSqlGenerated/u)
  assert.match(source, /-LiteralPath \$paths/u)
})
