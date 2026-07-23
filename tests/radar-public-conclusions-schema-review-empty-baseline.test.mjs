import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const migrationV03 = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/prepare-radar-public-conclusions-migration-v03.ps1'),
  'utf8',
)
const reviewV02 = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-radar-public-conclusions-schema-review-v02.ps1'),
  'utf8',
)

test('migration v03 explicitly permits an empty before/after artifact collection', () => {
  assert.match(migrationV03, /AllowEmptyCollection\(\)\]\[object\[\]\]\$Before/u)
  assert.match(migrationV03, /AllowEmptyCollection\(\)\]\[object\[\]\]\$After/u)
  assert.match(migrationV03, /ExpectedCount 2/u)
})

test('schema review v02 uses only the empty-safe migration preparer', () => {
  assert.match(reviewV02, /prepare-radar-public-conclusions-migration-v03\.ps1/u)
  assert.doesNotMatch(
    reviewV02.replace(/\$needle[\s\S]*?\$replacement/u, ''),
    /& '\.\\scripts\\radar\\prepare-radar-public-conclusions-migration-v02\.ps1'/u,
  )
})

test('empty-baseline wrappers do not execute migration, schema push, or production data writes', () => {
  for (const source of [migrationV03, reviewV02]) {
    assert.doesNotMatch(source, /payload\s+migrate(?:\s|$)/u)
    assert.doesNotMatch(source, /payload\s+schema/u)
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/u)
  }
})
