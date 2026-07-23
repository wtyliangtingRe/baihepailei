import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const migrationV03Path = path.join(
  repoRoot,
  'scripts/radar/prepare-radar-public-conclusions-migration-v03.ps1',
)
const reviewV02Path = path.join(
  repoRoot,
  'scripts/radar/run-and-package-radar-public-conclusions-schema-review-v02.ps1',
)
const migrationV03 = fs.readFileSync(migrationV03Path, 'utf8')
const reviewV02 = fs.readFileSync(reviewV02Path, 'utf8')

test('migration v03 explicitly permits an empty before/after artifact collection', () => {
  assert.match(migrationV03, /AllowEmptyCollection\(\)\]\[object\[\]\]\$Before/u)
  assert.match(migrationV03, /AllowEmptyCollection\(\)\]\[object\[\]\]\$After/u)
  assert.match(migrationV03, /ExpectedCount 2/u)
})

test('migration and review wrappers pass the real PowerShell parser', () => {
  for (const file of [migrationV03Path, reviewV02Path]) {
    const command = [
      '$tokens = $null;',
      '$errors = $null;',
      `[System.Management.Automation.Language.Parser]::ParseFile('${file.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null;`,
      'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
    ].join(' ')
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
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
