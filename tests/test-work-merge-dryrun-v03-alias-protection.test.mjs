import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const recorder = path.join(repoRoot, 'scripts/radar/record-test-work-merge-alias-protection-v03.mjs')
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

test('existing canonical localized title is recorded as protected without planning a duplicate alias', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-alias-evidence-'))
  const identity = path.join(root, 'identity')
  const output = path.join(root, 'output')
  fs.mkdirSync(identity)
  fs.mkdirSync(output)

  writeJsonl(path.join(identity, 'work-rows.jsonl'), [
    { id: 1, title: 'Soukou no Strain', original_title: 'Soukou no Strain' },
    { id: 2, title: '奏光之Strain', original_title: '奏光之Strain' },
  ])
  writeJsonl(path.join(identity, 'related-rows.jsonl'), [
    {
      tableName: 'works_localized_titles',
      columnName: '_parent_id',
      row: {
        id: 'localized-1',
        _parent_id: 2,
        kind: 'romanized',
        language: 'en',
        title: 'Soukou no Strain',
      },
    },
  ])
  writeJson(path.join(output, 'canonical-merge-decisions.json'), [
    { alertId: 'identity:1:2', canonicalWorkId: 2, mergeOutWorkId: 1 },
  ])
  writeJsonl(path.join(output, 'work-standardization-plan.jsonl'), [
    {
      alertId: 'identity:1:2',
      workId: 2,
      action: 'merge_clean_search_text_lines',
      before: '奏光之Strain',
      after: '奏光之Strain\nSoukou no Strain',
      executable: false,
    },
  ])
  writeJson(path.join(output, 'merge-dryrun-summary.json'), {
    schemaVersion: 3,
    standardizationPlanRows: 1,
    mergeOutTitleAliasProtected: true,
    safety: { databaseWrite: false, mergePerformed: false },
  })
  fs.writeFileSync(path.join(output, 'merge-dryrun-summary.md'), '# Dry-run\n', 'utf8')
  writeJson(path.join(output, 'manifest.json'), [])

  const result = spawnSync(process.execPath, [
    recorder,
    '--identity-audit-dir', identity,
    '--output-dir', output,
  ], { cwd: repoRoot, encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr || result.stdout)

  const plan = fs.readFileSync(path.join(output, 'work-standardization-plan.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  const existing = plan.find((row) => row.action === 'merge_out_title_already_present_on_canonical')
  assert.equal(existing.value, 'Soukou no Strain')
  assert.equal(existing.evidenceSource, 'works_localized_titles.title')
  assert.equal(existing.evidenceRowId, 'localized-1')
  assert.equal(existing.executable, false)
  assert.equal(plan.some((row) => row.action === 'add_merge_out_title_as_canonical_alias'), false)

  const evidence = fs.readFileSync(path.join(output, 'alias-protection-evidence.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  assert.equal(evidence.length, 1)
  assert.equal(evidence[0].protectionMode, 'already_present')
  assert.equal(evidence[0].protected, true)

  const summary = JSON.parse(fs.readFileSync(path.join(output, 'merge-dryrun-summary.json'), 'utf8'))
  assert.equal(summary.mergeOutTitleAliasProtectionEvidence, true)
  assert.equal(summary.mergeOutTitleAliasAlreadyPresentRows, 1)
  assert.equal(summary.mergeOutTitleAliasPlannedAddRows, 0)
  assert.equal(summary.standardizationPlanRows, 2)

  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const aliasEntry = manifest.find((entry) => entry.file === 'alias-protection-evidence.jsonl')
  assert.equal(aliasEntry.sha256, sha256(path.join(output, 'alias-protection-evidence.jsonl')))
})

test('v03 wrapper accepts either an existing canonical title or a planned alias addition', () => {
  assert.match(wrapper, /record-test-work-merge-alias-protection-v03\.mjs/u)
  assert.match(wrapper, /merge_out_title_already_present_on_canonical/u)
  assert.match(wrapper, /add_merge_out_title_as_canonical_alias/u)
  assert.match(wrapper, /alias-protection-evidence\.jsonl/u)
  assert.match(wrapper, /protectionMode -in @\('already_present', 'planned_add'\)/u)
  assert.match(wrapper, /ExecutableUpdateSQL\s+: False/u)
  assert.match(wrapper, /MergePerformed\s+: False/u)
  assert.doesNotMatch(wrapper, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/imu)
})
