import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const parser = path.join(repoRoot, 'scripts/radar/parse-test-work-exact-before-results-v01.mjs')
const wrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-test-work-exact-before-v01.ps1'),
  'utf8',
)

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

test('parser requires the complete named check set and accepts only all-true exact-before results', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-work-exact-before-'))
  const output = path.join(root, 'output')
  const sql = path.join(root, 'exact-before-readonly.sql')
  const expectations = path.join(root, 'exact-before-expectations.json')
  const stdout = path.join(root, 'stdout.tsv')
  const stderr = path.join(root, 'stderr.txt')

  fs.writeFileSync(sql, [
    'BEGIN TRANSACTION READ ONLY;',
    "SELECT 'exact_rows:public.works' AS check_name, 4 AS expected_count, 4 AS actual_count, true AS matches;",
    "SELECT 'relation_count:public.feedback_submissions.linked_work_id' AS check_name, 3 AS expected_count, 3 AS actual_count, true AS matches;",
    "SELECT 'version_relation_count:public._works_v_version_source_links._parent_id' AS check_name, 5 AS expected_count, 5 AS actual_count, true AS matches;",
    'ROLLBACK;',
    '',
  ].join('\n'), 'utf8')
  writeJson(expectations, {
    exactRowChecks: 1,
    relationCountChecks: 1,
    versionRelationCountChecks: 1,
    allChecksMustReturnMatchesTrue: true,
    databaseWrite: false,
  })
  fs.writeFileSync(stdout, [
    'exact_rows:public.works\t4\t4\tt',
    'relation_count:public.feedback_submissions.linked_work_id\t3\t3\tt',
    'version_relation_count:public._works_v_version_source_links._parent_id\t5\t5\tt',
    '',
  ].join('\n'), 'utf8')
  fs.writeFileSync(stderr, '', 'utf8')

  const result = spawnSync(process.execPath, [
    parser,
    '--sql', sql,
    '--expectations', expectations,
    '--stdout', stdout,
    '--stderr', stderr,
    '--output-dir', output,
  ], { cwd: repoRoot, encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'exact-before-run-summary.json'), 'utf8'))
  assert.equal(summary.expectedChecks, 3)
  assert.equal(summary.observedChecks, 3)
  assert.equal(summary.matchedChecks, 3)
  assert.equal(summary.failedChecks, 0)
  assert.equal(summary.allChecksMatched, true)
  assert.equal(summary.safety.databaseWrite, false)
  assert.equal(summary.safety.allChecksMustMatchBeforeBackup, true)

  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  for (const entry of manifest) {
    const file = path.join(output, entry.file)
    assert.equal(fs.statSync(file).size, entry.bytes)
    assert.equal(sha256(file), entry.sha256)
  }
})

test('parser fails closed when one check is false or the count differs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-work-exact-before-fail-'))
  const output = path.join(root, 'output')
  const sql = path.join(root, 'exact-before-readonly.sql')
  const expectations = path.join(root, 'exact-before-expectations.json')
  const stdout = path.join(root, 'stdout.tsv')
  const stderr = path.join(root, 'stderr.txt')

  fs.writeFileSync(sql, [
    'BEGIN TRANSACTION READ ONLY;',
    "SELECT 'exact_rows:public.works' AS check_name, 4 AS expected_count, 3 AS actual_count, false AS matches;",
    'ROLLBACK;',
    '',
  ].join('\n'), 'utf8')
  writeJson(expectations, {
    exactRowChecks: 1,
    relationCountChecks: 0,
    versionRelationCountChecks: 0,
    allChecksMustReturnMatchesTrue: true,
    databaseWrite: false,
  })
  fs.writeFileSync(stdout, 'exact_rows:public.works\t4\t3\tf\n', 'utf8')
  fs.writeFileSync(stderr, '', 'utf8')

  const result = spawnSync(process.execPath, [
    parser,
    '--sql', sql,
    '--expectations', expectations,
    '--stdout', stdout,
    '--stderr', stderr,
    '--output-dir', output,
  ], { cwd: repoRoot, encoding: 'utf8' })

  assert.equal(result.status, 2, result.stderr || result.stdout)
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'exact-before-run-summary.json'), 'utf8'))
  assert.equal(summary.allChecksMatched, false)
  assert.equal(summary.failedChecks, 1)
})

test('PowerShell runner uses PostgreSQL read-only SQL, validates all checks, and never mutates the database', () => {
  assert.match(wrapper, /Resolve-RepoPath/u)
  assert.match(wrapper, /BEGIN TRANSACTION READ ONLY;/u)
  assert.match(wrapper, /ON_ERROR_STOP=1/u)
  assert.match(wrapper, /'-qAt'/u)
  assert.match(wrapper, /parse-test-work-exact-before-results-v01\.mjs/u)
  assert.match(wrapper, /allChecksMatched -ne \$true/u)
  assert.match(wrapper, /docker' @\('cp'/u)
  assert.match(wrapper, /'rm', '-f', \$containerSqlPath/u)
  assert.match(wrapper, /DatabaseWrite\s+: False/u)
  assert.match(wrapper, /BackupCreated\s+: False/u)
  assert.match(wrapper, /ContainerTempFileWrite\s+: True/u)
  assert.doesNotMatch(wrapper, /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE TABLE)\b/imu)
})
