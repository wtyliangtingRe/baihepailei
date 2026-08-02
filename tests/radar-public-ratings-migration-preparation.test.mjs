import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const script = readFileSync('scripts/radar/prepare-radar-public-ratings-migration-v01.ps1', 'utf8')

function generatedRatingsMigrations() {
  return readdirSync('src/migrations')
    .filter((name) => name.endsWith('_radar_public_ratings_v01.ts'))
}

test('ratings migration preparer is read-only and never executes migrate or installs packages', () => {
  assert.match(script, /default_transaction_read_only=on/u)
  assert.match(script, /pnpm payload migrate:create/u)
  assert.doesNotMatch(script, /pnpm\s+(?:install|i)\b/u)
  assert.doesNotMatch(script, /payload\s+migrate(?:\s|$)(?!:create)/u)
  assert.doesNotMatch(script, /docker\s+compose|pg_dump|psql/u)
  assert.match(script, /DatabaseMigrate : False/u)
  assert.match(script, /PayloadWrite    : False/u)
  assert.match(script, /WorksMutation   : False/u)
})

test('ratings migration preparer preserves known generated local files and constrains DDL', () => {
  assert.match(script, /next-env\.d\.ts/u)
  assert.match(script, /payload-types\.ts/u)
  assert.match(script, /Assert-RatingsOnlyDDL/u)
  assert.match(script, /radar_public_ratings/u)
  assert.match(script, /radar_public_records/u)
  assert.match(script, /human_assessment_grade/u)
  assert.match(script, /radar_assessment_suggested_grade/u)
})

test('generated ratings migration, when present, is additive and registered once', () => {
  const files = generatedRatingsMigrations()
  assert.ok(files.length <= 1, `expected at most one ratings migration, got ${files.join(', ')}`)
  if (files.length === 0) return

  const migration = readFileSync(`src/migrations/${files[0]}`, 'utf8')
  const index = readFileSync('src/migrations/index.ts', 'utf8')
  const stem = files[0].replace(/\.ts$/u, '')
  const snapshot = `src/migrations/${stem}.json`

  assert.ok(existsSync(snapshot), 'generated migration snapshot is missing')
  assert.match(migration, /CREATE TABLE[\s\S]*radar_public_ratings/u)
  assert.doesNotMatch(migration, /(?:ALTER|DROP|CREATE) TABLE[\s\S]*"radar_public_records/u)
  assert.doesNotMatch(migration, /(?:ALTER|DROP|CREATE) TABLE[\s\S]*"works"/u)
  assert.equal((index.match(new RegExp(`name: '${stem}'`, 'gu')) || []).length, 1)
  assert.match(index, new RegExp(`from './${stem}'`, 'u'))
})
