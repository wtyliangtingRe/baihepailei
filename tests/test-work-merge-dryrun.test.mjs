import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const planner = path.join(repoRoot, 'scripts/radar/build-test-work-merge-dryrun-v01.mjs')
const wrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-test-work-merge-dryrun-v01.ps1'),
  'utf8',
)

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function work(id, title, overrides = {}) {
  return {
    id,
    title,
    slug: `work-${id}`,
    site_id: `site-${id}`,
    _status: 'published',
    catalog_status: 'active',
    is_lite_visible: true,
    is_full_visible: true,
    human_assessment_status: id % 2 ? 'reviewed' : 'pending',
    human_assessment_grade: id % 2 ? 'A' : null,
    human_assessment_note: id % 2 ? 'test' : null,
    review_status: id % 2 ? 'reviewed' : 'pending',
    human_review_note: id % 2 ? 'test' : null,
    radar_assessment_suggested_grade: id % 2 ? 'B' : 'C',
    radar_assessment_source_summary: 'test AI',
    rank: id % 2 ? 'A' : 'C',
    rating_notice: 'manual_reviewed',
    evidence_strength: 'medium',
    ...overrides,
  }
}

test('planner binds explicit canonical decisions, preserves facts, and discards authorized test assessments without writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-work-merge-dryrun-'))
  const input = path.join(root, 'input')
  const output = path.join(root, 'output')
  fs.mkdirSync(input)

  writeJson(path.join(input, 'validation.json'), {
    jsonValidated: true,
    sourceDryRunManifestValidated: true,
    databaseWrite: false,
  })
  writeJson(path.join(input, 'identity-comparison.json'), {
    groups: [
      {
        alertId: 'identity:1:2',
        workIds: [1, 2],
        members: [
          { id: 1, nonEmptyPhysicalFields: 10, ownedChildRows: 1, externalInboundReferenceRows: 0 },
          { id: 2, nonEmptyPhysicalFields: 20, ownedChildRows: 3, externalInboundReferenceRows: 1 },
        ],
      },
      {
        alertId: 'identity:3:4',
        workIds: [3, 4],
        members: [
          { id: 3, nonEmptyPhysicalFields: 11, ownedChildRows: 1, externalInboundReferenceRows: 0 },
          { id: 4, nonEmptyPhysicalFields: 22, ownedChildRows: 4, externalInboundReferenceRows: 1 },
        ],
      },
    ],
    safety: { canonicalDecisionApplied: false, mergePerformed: false },
  })
  writeJsonl(path.join(input, 'work-rows.jsonl'), [
    work(1, 'Alpha', { external_ids_mal_id: '101' }),
    work(2, 'Alpha', { external_ids_mal_id: null }),
    work(3, 'Beta', { external_ids_anilist_media_id: '303' }),
    work(4, 'Beta', { external_ids_anilist_media_id: null }),
  ])
  writeJsonl(path.join(input, 'related-rows.jsonl'), [
    {
      tableSchema: 'public', tableName: 'works_source_links', columnName: '_parent_id',
      relationKind: 'foreign_key_to_works', row: { id: 11, _parent_id: 1, label: 'MAL', url: 'https://example.invalid/101' },
    },
    {
      tableSchema: 'public', tableName: 'feedback_submissions', columnName: 'linked_work_id',
      relationKind: 'foreign_key_to_works', row: { id: 12, linked_work_id: 2, workflow_status: 'accepted' },
    },
    {
      tableSchema: 'public', tableName: 'works_radar_assessment_matched_rules', columnName: '_parent_id',
      relationKind: 'foreign_key_to_works', row: { id: 13, _parent_id: 4, code: 'TEST' },
    },
  ])
  writeJsonl(path.join(input, 'version-related-rows.jsonl'), [])

  const manifestFiles = fs.readdirSync(input).sort()
  writeJson(path.join(input, 'manifest.json'), manifestFiles.map((name) => {
    const file = path.join(input, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256(file) }
  }))

  const result = spawnSync(process.execPath, [
    planner,
    '--identity-audit-dir', input,
    '--output-dir', output,
    '--discard-test-assessments',
    '--decision', '1:2',
    '--decision', '3:4',
  ], { cwd: repoRoot, encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'merge-dryrun-summary.json'), 'utf8'))
  assert.equal(summary.identityGroups, 2)
  assert.equal(summary.canonicalDecisions, 2)
  assert.equal(summary.assessmentCleanupRows, 4)
  assert.equal(summary.safety.databaseWrite, false)
  assert.equal(summary.safety.executableUpdateSqlGenerated, false)
  assert.equal(summary.safety.mergePerformed, false)
  assert.equal(summary.safety.hardDeletePlanned, false)

  const decisions = JSON.parse(fs.readFileSync(path.join(output, 'canonical-merge-decisions.json'), 'utf8'))
  assert.deepEqual(decisions.map((row) => [row.mergeOutWorkId, row.canonicalWorkId]), [[1, 2], [3, 4]])
  assert.ok(decisions.every((row) => row.assessmentPolicy.includes('discard all current human and AI test assessments')))

  const cleanup = fs.readFileSync(path.join(output, 'test-assessment-cleanup-plan.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  assert.ok(cleanup.every((row) => row.after.human_assessment_status === 'pending'))
  assert.ok(cleanup.every((row) => row.after.rank === 'unknown'))
  assert.ok(cleanup.every((row) => row.after.rating_notice === 'insufficient_information'))
  assert.ok(cleanup.every((row) => row.publicAIConclusionToCreate === false))

  const preview = fs.readFileSync(path.join(output, 'merge-preview-commented.sql'), 'utf8')
  assert.ok(preview.split(/\r?\n/u).filter(Boolean).every((line) => /^--/u.test(line)))
  const exactBefore = fs.readFileSync(path.join(output, 'exact-before-readonly.sql'), 'utf8')
  assert.match(exactBefore, /BEGIN TRANSACTION READ ONLY;/u)
  assert.match(exactBefore, /ROLLBACK;/u)
  assert.doesNotMatch(exactBefore, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/imu)
})

test('wrapper requires explicit test-discard authorization and remains non-executing', () => {
  assert.match(wrapper, /DiscardTestAssessments/u)
  assert.match(wrapper, /mergeOut:canonical/u)
  assert.match(wrapper, /executableUpdateSqlGenerated -ne \$false/u)
  assert.match(wrapper, /hardDeletePlanned -ne \$false/u)
  assert.match(wrapper, /versionRewritePlanned -ne \$false/u)
  assert.match(wrapper, /ExecutableUpdateSQL\s+: False/u)
  assert.match(wrapper, /MergePerformed\s+: False/u)
  assert.doesNotMatch(wrapper, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/imu)
})
