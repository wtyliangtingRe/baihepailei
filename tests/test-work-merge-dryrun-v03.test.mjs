import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const refiner = path.join(repoRoot, 'scripts/radar/refine-test-work-merge-dryrun-v03.mjs')
const wrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-test-work-merge-dryrun-v03.ps1'),
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

function writeManifest(directory) {
  const files = fs.readdirSync(directory).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(directory, 'manifest.json'), files.map((name) => {
    const file = path.join(directory, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256(file) }
  }))
}

test('v03 preserves a distinct merge-out title, merges clean search text, and builds boolean exact-before guards', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-work-merge-v03-'))
  const identity = path.join(root, 'identity')
  const dryrun = path.join(root, 'dryrun')
  const output = path.join(root, 'output')
  fs.mkdirSync(identity)
  fs.mkdirSync(dryrun)

  writeJsonl(path.join(identity, 'work-rows.jsonl'), [
    {
      id: 1,
      title: 'Soukou no Strain',
      original_title: 'Soukou no Strain',
      search_text: 'Soukou no Strain\nanilist:1602\nhttps://anilist.co/anime/1602\nmergedIntoWorkId: 2\n奏光のストレイン',
      updated_at: '2026-01-01T00:00:00+00:00',
    },
    {
      id: 2,
      title: '奏光之Strain',
      original_title: '奏光之Strain',
      search_text: '奏光之Strain\nbangumi:4887\nhttps://bgm.tv/subject/4887',
      updated_at: '2026-01-02T00:00:00+00:00',
    },
  ])
  writeJsonl(path.join(identity, 'related-rows.jsonl'), [
    {
      tableSchema: 'public', tableName: '_works_v', columnName: 'parent_id',
      row: { id: 101, parent_id: 1, version_status: 'draft' },
    },
    {
      tableSchema: 'public', tableName: 'works_source_links', columnName: '_parent_id',
      row: { id: 'src-1', _parent_id: 1, label: 'AniList', url: 'https://anilist.co/anime/1602' },
    },
    {
      tableSchema: 'public', tableName: 'feedback_submissions', columnName: 'linked_work_id',
      row: { id: 9, linked_work_id: 2, workflow_status: 'accepted' },
    },
  ])
  writeJson(path.join(identity, 'relation-locators.json'), [
    { tableSchema: 'public', tableName: '_works_v', columnName: 'parent_id' },
    { tableSchema: 'public', tableName: 'works_source_links', columnName: '_parent_id' },
    { tableSchema: 'public', tableName: 'feedback_submissions', columnName: 'linked_work_id' },
  ])
  writeJsonl(path.join(identity, 'version-related-rows.jsonl'), [
    {
      tableSchema: 'public', tableName: '_works_v_version_source_links', columnName: '_parent_id',
      row: { id: 'vsrc-1', _parent_id: 101, label: 'AniList' },
    },
  ])
  writeJson(path.join(identity, 'version-relation-locators.json'), [
    { tableSchema: 'public', tableName: '_works_v_version_source_links', columnName: '_parent_id' },
  ])
  writeManifest(identity)

  writeJson(path.join(dryrun, 'canonical-merge-decisions.json'), [
    { alertId: 'identity:1:2', canonicalWorkId: 2, mergeOutWorkId: 1 },
  ])
  writeJsonl(path.join(dryrun, 'field-merge-plan.jsonl'), [])
  writeJsonl(path.join(dryrun, 'relation-merge-plan.jsonl'), [
    {
      alertId: 'identity:1:2', tableSchema: 'public', tableName: '_works_v', columnName: 'parent_id',
      sourceWorkId: 1, targetWorkId: 2, rowId: 101, action: 'preserve_version_parent_in_place', executable: false,
    },
    {
      alertId: 'identity:1:2', tableSchema: 'public', tableName: 'works_source_links', columnName: '_parent_id',
      sourceWorkId: 1, targetWorkId: 2, rowId: 'src-1', action: 'copy_factual_child_to_canonical_if_exact_before_still_matches', executable: false,
    },
  ])
  writeJsonl(path.join(dryrun, 'feedback-test-cleanup-plan.jsonl'), [
    {
      alertId: 'identity:1:2', tableSchema: 'public', tableName: 'feedback_submissions', columnName: 'linked_work_id',
      sourceWorkId: 2, targetWorkId: 2, rowId: 9, action: 'archive_confirmed_test_feedback_without_treating_it_as_evidence', executable: false,
    },
  ])
  writeJsonl(path.join(dryrun, 'test-assessment-cleanup-plan.jsonl'), [])
  writeJsonl(path.join(dryrun, 'version-preservation-plan.jsonl'), [])
  writeJson(path.join(dryrun, 'merge-dryrun-summary.json'), {
    schemaVersion: 2,
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
  fs.writeFileSync(path.join(dryrun, 'merge-dryrun-summary.md'), '# Dry-run\n', 'utf8')
  fs.writeFileSync(path.join(dryrun, 'merge-preview-commented.sql'), '-- preview\n', 'utf8')
  fs.writeFileSync(path.join(dryrun, 'exact-before-readonly.sql'), 'BEGIN TRANSACTION READ ONLY;\nROLLBACK;\n', 'utf8')
  writeManifest(dryrun)

  const result = spawnSync(process.execPath, [
    refiner,
    '--identity-audit-dir', identity,
    '--dryrun-v02-dir', dryrun,
    '--output-dir', output,
  ], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)

  const standardization = fs.readFileSync(path.join(output, 'work-standardization-plan.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  assert.ok(standardization.some((row) =>
    row.action === 'add_merge_out_title_as_canonical_alias'
    && row.value === 'Soukou no Strain'))
  const searchPlan = standardization.find((row) => row.action === 'merge_clean_search_text_lines')
  assert.match(searchPlan.after, /Soukou no Strain/u)
  assert.match(searchPlan.after, /anilist:1602/u)
  assert.match(searchPlan.after, /奏光のストレイン/u)
  assert.doesNotMatch(searchPlan.after, /mergedIntoWorkId/u)

  const exactSql = fs.readFileSync(path.join(output, 'exact-before-readonly.sql'), 'utf8')
  assert.match(exactSql, /exact_rows:public\.works/u)
  assert.match(exactSql, /exact_rows:public\.works_source_links/u)
  assert.match(exactSql, /relation_count:public\.feedback_submissions\.linked_work_id/u)
  assert.match(exactSql, /version_relation_count:public\._works_v_version_source_links\._parent_id/u)
  assert.match(exactSql, /AS matches/u)
  assert.doesNotMatch(exactSql, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/imu)

  const summary = JSON.parse(fs.readFileSync(path.join(output, 'merge-dryrun-summary.json'), 'utf8'))
  assert.equal(summary.schemaVersion, 3)
  assert.equal(summary.exactBeforeAllChecksRequireTrue, true)
  assert.equal(summary.searchTextOperationalNoiseFiltered, true)
  assert.equal(summary.mergeOutTitleAliasProtected, true)
  assert.equal(summary.safety.mergePerformed, false)
})

test('v03 wrapper is fail-closed and keeps all SQL non-writing', () => {
  assert.match(wrapper, /Resolve-RepoPath/u)
  assert.match(wrapper, /work-standardization-plan\.jsonl/u)
  assert.match(wrapper, /Soukou no Strain/u)
  assert.match(wrapper, /AS matches/u)
  assert.match(wrapper, /exact_rows:public\\\.works/u)
  assert.match(wrapper, /ExecutableUpdateSQL\s+: False/u)
  assert.match(wrapper, /MergePerformed\s+: False/u)
  assert.doesNotMatch(wrapper, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/imu)
})
