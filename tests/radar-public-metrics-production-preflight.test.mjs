import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, root), 'utf8')

const scriptPath =
  'scripts/radar/prepare-radar-public-metrics-production-preflight-v01.ps1'
const guidePath =
  'docs/guides/radar-public-metrics-production-preflight-v01.md'

const script = read(scriptPath)
const guide = read(guidePath)

test('production preflight locks exact website, research and Release identities', () => {
  for (const identity of [
    'b5ffbe006913218d32b96c131074b7740bf827a0',
    'c2fe7847ee8b60b439f8e92025437937ceff06d5',
    'RADAR-PUBLIC-METRICS-10563-0001',
    'da4b52eae91224a8bab46aebff69734c6a3d2bc3005de415b027a9e4eba6226d',
    '1bdfda49f4f72a823efc86de42c565d3bdef162136aef697d0dc1d3bb343a946',
    '20260803_102741_radar_public_metrics_v01',
  ]) {
    assert.match(script, new RegExp(identity))
  }

  assert.match(script, /ExpectedCurrentRatings = 10563/)
  assert.match(script, /ExpectedCurrentColumns = 36/)
  assert.match(script, /ExpectedMigratedColumns = 44/)
  assert.match(script, /ExpectedSourceMigrationCount = 9/)
})

test('source PostgreSQL access remains read-only and exact', () => {
  assert.match(
    script,
    /default_transaction_read_only=on/,
  )

  assert.match(
    script,
    /Source data\s+: UNCHANGED/,
  )

  assert.match(
    script,
    /Source schema\s+: UNCHANGED/,
  )

  assert.match(
    script,
    /Source migrations\s+: UNCHANGED/,
  )

  assert.match(
    script,
    /Assert-ExactSequence[\s\S]*SourceBefore\.columns[\s\S]*SourceAfter\.columns/,
  )

  assert.match(
    script,
    /Assert-ExactSequence[\s\S]*SourceBefore\.migrations[\s\S]*SourceAfter\.migrations/,
  )

  assert.match(
    script,
    /Assert-ExactSequence[\s\S]*SourceBefore\.fingerprints[\s\S]*SourceAfter\.fingerprints/,
  )
})

test('migration is restricted to a disposable loopback clone', () => {
  assert.match(
    script,
    /POSTGRES_HOST_AUTH_METHOD=trust/,
  )

  assert.match(
    script,
    /127\.0\.0\.1:\$\{TempPort\}:5432/,
  )

  assert.match(
    script,
    /parsed\.hostname !== '127\.0\.0\.1'/,
  )

  assert.equal(
    (script.match(/pnpm exec payload migrate/g) || []).length,
    1,
  )

  assert.match(
    script,
    /docker rm -f -v \$TempContainer/,
  )

  assert.match(
    script,
    /temporaryMigrationExecuted = \$true/,
  )

  assert.match(
    script,
    /sourceMigrationExecuted = \$false/,
  )
})

test('preflight creates a fresh local backup but no import implementation', () => {
  assert.match(script, /pg_dump/)
  assert.match(script, /pg_restore/)
  assert.match(script, /retainedLocallyOnly = \$true/)
  assert.match(script, /includedInEvidence = \$false/)

  assert.doesNotMatch(
    script,
    /payload\.(create|update|delete)/,
  )

  assert.doesNotMatch(
    script,
    /\b(PATCH|PUT|DELETE)\b[\s\S]{0,120}(radar-public-ratings|radar_public_ratings)/i,
  )

  assert.doesNotMatch(
    script,
    /\b(INSERT\s+INTO|UPDATE\s+radar_public_ratings|DELETE\s+FROM\s+radar_public_ratings)\b/i,
  )

  assert.doesNotMatch(
    script,
    /run-unified-rating-incremental-production-apply-once|execute-radar-unified-release-production/,
  )
})

test('planner must converge to the exact 10,563-row transition', () => {
  assert.match(
    script,
    /statusCounts\.blocked -ne \$ExpectedCurrentRatings/,
  )

  assert.match(
    script,
    /wouldUpdateAfterSchema -ne \$ExpectedCurrentRatings/,
  )

  assert.match(
    script,
    /statusCounts\.wouldUpdate -ne \$ExpectedCurrentRatings/,
  )

  for (const status of [
    'missingRating',
    'identityMismatch',
    'alreadyCurrent',
    'blocked',
  ]) {
    assert.match(script, new RegExp(`statusCounts\\.${status}`))
  }
})

test('candidate remains explicitly unauthorized and mutation-free', () => {
  for (const boundary of [
    'sourceMigration = $false',
    'metricImport = $false',
    'payloadWrite = $false',
    'postgresqlContentWrite = $false',
    'worksMutation = $false',
    'humanAssessmentMutation = $false',
    'productionAuthorization = $false',
    'historicalApplyOnceRerun = $false',
  ]) {
    assert.match(
      script,
      new RegExp(
        boundary
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace('\\$false', '\\$false'),
      ),
    )
  }

  assert.match(
    script,
    /independent_review_before_source_migration_authorization/,
  )
})

test('runbook preserves the reusable authorization boundary', () => {
  for (const phrase of [
    'RADAR-PUBLIC-METRICS-10563-0001',
    '10,563',
    '36 -> 44',
    'sourceMigrationExecuted = false',
    'metricImportExecuted = false',
    'productionAuthorization = false',
    'Never rerun',
  ]) {
    assert.match(guide, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})
