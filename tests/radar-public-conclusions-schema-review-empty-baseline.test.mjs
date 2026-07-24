import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const migrationPath = path.join(
  repoRoot,
  'scripts/radar/prepare-radar-public-conclusions-migration-v04.ps1',
)
const reviewPath = path.join(
  repoRoot,
  'scripts/radar/run-and-package-radar-public-conclusions-schema-review-v03.ps1',
)
const migration = fs.readFileSync(migrationPath, 'utf8')
const review = fs.readFileSync(reviewPath, 'utf8')

test('active migration wrapper permits an empty before/after artifact collection', () => {
  assert.match(migration, /AllowEmptyCollection\(\)\]\[object\[\]\]\$Before/u)
  assert.match(migration, /AllowEmptyCollection\(\)\]\[object\[\]\]\$After/u)
  assert.match(migration, /ExpectedCount 2/u)
})

test('active migration and review wrappers pass the real PowerShell parser', () => {
  for (const file of [migrationPath, reviewPath]) {
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

test('temporary patch scripts are created outside the Git repository', () => {
  for (const source of [migration, review]) {
    assert.match(source, /\[System\.IO\.Path\]::GetTempPath\(\)/u)
    assert.doesNotMatch(source, /\$temporaryPath\s*=\s*Join-Path\s+\$PSScriptRoot/u)
  }
  assert.match(migration, /RADAR_MIGRATION_SOURCE_ROOT/u)
  assert.match(review, /RADAR_SCHEMA_REVIEW_SOURCE_ROOT/u)
})

test('both migrate:create phases use a read-only isolated Payload config', () => {
  assert.match(migration, /default_transaction_read_only=on/u)
  assert.match(migration, /PAYLOAD_DB_PUSH/u)
  assert.match(migration, /\$PayloadDbPushEnvName = 'false'/u)
  assert.match(migration, /\$PayloadConfigEnvName = \$temporaryConfigPath/u)
  assert.match(migration, /\$PayloadMigrationDirEnvName = \$temporaryMigrationDirectory/u)
  assert.match(migration, /\$PayloadMigrationDirEnvName = \$repositoryMigrationPath/u)
  assert.match(migration, /隔离 Payload 配置没有强制 PostgreSQL 只读会话/u)
})

test('active review wrapper uses only the isolated read-only migration preparer', () => {
  assert.match(review, /prepare-radar-public-conclusions-migration-v04\.ps1/u)
  assert.doesNotMatch(
    review,
    /-Replacement\s+"& '\.\\scripts\\radar\\prepare-radar-public-conclusions-migration-v0[23]\.ps1'/u,
  )
})

test('active wrappers never execute production migration, schema push, or data writes', () => {
  for (const source of [migration, review]) {
    assert.doesNotMatch(source, /payload\s+migrate(?:\s|$)/u)
    assert.doesNotMatch(source, /payload\s+schema/u)
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/u)
  }
})
