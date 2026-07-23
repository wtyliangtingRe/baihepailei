import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const migrationPath = path.join(root, 'scripts/radar/prepare-radar-public-conclusions-migration-v05.ps1')
const reviewPath = path.join(root, 'scripts/radar/run-and-package-radar-public-conclusions-schema-review-v05.ps1')
const migration = fs.readFileSync(migrationPath, 'utf8')
const review = fs.readFileSync(reviewPath, 'utf8')

test('direct active runners pass the real PowerShell parser', () => {
  for (const file of [migrationPath, reviewPath]) {
    const command = [
      '$tokens = $null;',
      '$errors = $null;',
      `[System.Management.Automation.Language.Parser]::ParseFile('${file.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null;`,
      'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
    ].join(' ')
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
})

test('active path is direct and contains no runtime source patching', () => {
  for (const source of [migration, review]) {
    assert.doesNotMatch(source, /Replace-Exact/u)
    assert.doesNotMatch(source, /\.Replace\(\$needle/u)
    assert.doesNotMatch(source, /RADAR_(?:MIGRATION|SCHEMA_REVIEW)_SOURCE_ROOT/u)
    assert.doesNotMatch(source, /\.run-and-package-radar-public-conclusions-schema-review-v\d+-/u)
    assert.doesNotMatch(source, /\.prepare-radar-public-conclusions-migration-v\d+-/u)
  }
  assert.match(review, /prepare-radar-public-conclusions-migration-v05\.ps1/u)
  assert.doesNotMatch(review, /prepare-radar-public-conclusions-migration-v0[234]\.ps1/u)
})

test('both migrate create phases are database-enforced read-only', () => {
  assert.match(migration, /default_transaction_read_only=on/u)
  assert.match(migration, /PGOPTIONS = \$ReadOnlyPgOptions/u)
  assert.equal((migration.match(/PAYLOAD_DB_PUSH = 'false'/gu) || []).length, 2)
  assert.equal((migration.match(/PAYLOAD_CONFIG_PATH = \$temporaryConfigPath/gu) || []).length, 2)
  assert.equal((migration.match(/pnpm payload migrate:create/gu) || []).length, 2)
  assert.doesNotMatch(migration, /pnpm payload migrate(?:\s|$)/u)
})

test('review package completes before the migration commit is pushed', () => {
  const packageIndex = review.indexOf('Compress-Archive')
  const pushIndex = review.indexOf('git push origin $ExpectedBranch')
  assert.ok(packageIndex >= 0)
  assert.ok(pushIndex > packageIndex)
  assert.match(review, /remotePushDeferredUntilPackageComplete = \$true/u)
  assert.match(review, /git reset --mixed \$beforeHead/u)
  assert.match(review, /Remove-GeneratedMigrationPaths/u)
  assert.doesNotMatch(review, /prepare-radar-public-conclusions-migration-v05\.ps1' -CommitAndPush/u)
})

test('direct runners do not write Works or authorize production apply', () => {
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu)
  assert.match(migration, /Assert-RadarOnlyDDL/u)
  assert.match(review, /productionDatabaseSessionReadOnly = \$true/u)
  assert.match(review, /productionDatabaseWrite = \$false/u)
  assert.match(review, /productionMigrationExecuted = \$false/u)
  assert.match(review, /productionWriteAuthorized = \$false/u)
  assert.match(review, /rollbackAuthorized = \$false/u)
})
