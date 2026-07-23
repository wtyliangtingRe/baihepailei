import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const refiner = path.join(repoRoot, 'scripts/radar/refine-test-work-merge-dryrun-v02.mjs')
const wrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-test-work-merge-dryrun-v02.ps1'),
  'utf8',
)
const legacyWrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-test-work-merge-dryrun-v01.ps1'),
  'utf8',
)

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

test('v02 refinement clears human_reviewed fields and maps version children through _works_v IDs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-work-merge-v02-'))
  const identity = path.join(root, 'identity')
  const output = path.join(root, 'output')
  fs.mkdirSync(identity)
  fs.mkdirSync(output)

  writeJsonl(path.join(identity, 'work-rows.jsonl'), [
    {
      id: 1,
      human_assessment_status: 'reviewed',
      human_assessment_grade: 'A',
      human_review_note: 'test',
      human_reviewed_at: '2026-01-01T00:00:00Z',
      human_reviewed_by_id: 9,
      radar_assessment_suggested_grade: 'B',
      rank: 'A',
      rating_notice: 'manual_reviewed',
      evidence_strength: 'medium',
    },
    {
      id: 2,
      human_assessment_status: 'pending',
      human_reviewed_at: '2026-01-02T00:00:00Z',
      human_reviewed_by_id: 10,
      radar_assessment_suggested_grade: 'C',
      rank: 'C',
      rating_notice: 'ai_synthesized_pending_review',
      evidence_strength: 'weak',
    },
  ])
  writeJsonl(path.join(identity, 'related-rows.jsonl'), [
    { tableName: '_works_v', columnName: 'parent_id', row: { id: 101, parent_id: 1 } },
    { tableName: '_works_v', columnName: 'parent_id', row: { id: 102, parent_id: 1 } },
    { tableName: '_works_v', columnName: 'parent_id', row: { id: 201, parent_id: 2 } },
  ])
  writeJsonl(path.join(identity, 'version-related-rows.jsonl'), [
    { tableName: '_works_v_version_source_links', columnName: '_parent_id', row: { id: 1, _parent_id: 101 } },
    { tableName: '_works_v_version_source_links', columnName: '_parent_id', row: { id: 2, _parent_id: 102 } },
    { tableName: '_works_v_version_source_links', columnName: '_parent_id', row: { id: 3, _parent_id: 201 } },
  ])

  writeJsonl(path.join(output, 'test-assessment-cleanup-plan.jsonl'), [
    { workId: 1, after: { human_assessment_status: 'pending', review_status: 'pending', rank: 'unknown' } },
    { workId: 2, after: { human_assessment_status: 'pending', review_status: 'pending', rank: 'unknown' } },
  ])
  writeJsonl(path.join(output, 'version-preservation-plan.jsonl'), [
    {
      alertId: 'identity:1:2',
      canonicalWorkId: 2,
      mergeOutWorkId: 1,
      reparentVersions: false,
      deleteVersions: false,
    },
  ])
  writeJson(path.join(output, 'merge-dryrun-summary.json'), {
    schemaVersion: 1,
    safety: {
      databaseWrite: false,
      payloadWrite: false,
      executableUpdateSqlGenerated: false,
      canonicalDecisionApplied: false,
      mergePerformed: false,
      hardDeletePlanned: false,
      versionRewritePlanned: false,
    },
  })
  fs.writeFileSync(path.join(output, 'merge-dryrun-summary.md'), '# Dry-run\n', 'utf8')

  const result = spawnSync(process.execPath, [
    refiner,
    '--identity-audit-dir', identity,
    '--output-dir', output,
  ], { cwd: repoRoot, encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr || result.stdout)

  const cleanup = fs.readFileSync(path.join(output, 'test-assessment-cleanup-plan.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  assert.ok(cleanup.every((row) => row.after.human_reviewed_at === null))
  assert.ok(cleanup.every((row) => row.after.human_reviewed_by_id === null))
  assert.ok(cleanup.every((row) => row.after.human_assessment_status === 'pending'))
  assert.ok(cleanup.every((row) => row.after.rank === 'unknown'))
  assert.ok(cleanup.every((row) => row.after.rating_notice === 'insufficient_information'))

  const versions = fs.readFileSync(path.join(output, 'version-preservation-plan.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  assert.equal(versions[0].observedCanonicalVersionRows, 1)
  assert.equal(versions[0].observedMergeOutVersionRows, 2)
  assert.equal(versions[0].observedCanonicalVersionChildRows, 1)
  assert.equal(versions[0].observedMergeOutVersionChildRows, 2)
  assert.equal(versions[0].versionOwnershipMappedThroughWorksV, true)

  const summary = JSON.parse(fs.readFileSync(path.join(output, 'merge-dryrun-summary.json'), 'utf8'))
  assert.equal(summary.schemaVersion, 2)
  assert.equal(summary.completeLegacyHumanReset, true)
  assert.equal(summary.versionOwnershipMappedThroughWorksV, true)
  assert.equal(summary.safety.mergePerformed, false)
})

test('both wrappers resolve relative identity-audit paths from the repository root', () => {
  for (const source of [legacyWrapper, wrapper]) {
    assert.match(source, /\[System\.IO\.Path\]::IsPathRooted\(\$IdentityAuditDirectory\)/u)
    assert.match(source, /Join-Path \$repoRoot \$IdentityAuditDirectory/u)
    assert.match(source, /Resolve-Path -LiteralPath \$candidateSourceDir/u)
    assert.doesNotMatch(
      source,
      /\$sourceDir\s*=\s*\[System\.IO\.Path\]::GetFullPath\(\$IdentityAuditDirectory\)/u,
    )
  }
})

test('v02 wrapper remains fail-closed and non-executing', () => {
  assert.match(wrapper, /refine-test-work-merge-dryrun-v02\.mjs/u)
  assert.match(wrapper, /completeLegacyHumanReset -ne \$true/u)
  assert.match(wrapper, /versionOwnershipMappedThroughWorksV -ne \$true/u)
  assert.match(wrapper, /human_assessment_status -ne 'pending'/u)
  assert.match(wrapper, /rating_notice -ne 'insufficient_information'/u)
  assert.match(wrapper, /ExecutableUpdateSQL\s+: False/u)
  assert.match(wrapper, /MergePerformed\s+: False/u)
  assert.doesNotMatch(wrapper, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/imu)
})
