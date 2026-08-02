import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const script = readFileSync('scripts/radar/prepare-radar-public-record-fact-value-text-migration-v01.ps1', 'utf8')
const collection = readFileSync('src/collections/RadarPublicRecords.ts', 'utf8')
const migrationFiles = readdirSync('src/migrations')
  .filter((name) => name.endsWith('_radar_public_record_fact_value_text_v01.ts'))

function factsBlock(source) {
  const start = source.indexOf("name: 'facts'")
  const end = source.indexOf("name: 'evidence'")
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}

test('fact value migration preparer only generates and never applies migrations', () => {
  assert.match(script, /payload migrate:create \$MigrationName --skip-empty/u)
  assert.doesNotMatch(script, /payload migrate(?:\s|['"])/u)
  assert.doesNotMatch(script, /pnpm install|npm install|yarn install/u)
  assert.match(script, /default_transaction_read_only=on/u)
  assert.match(script, /DatabaseMigrate : False/u)
  assert.match(script, /SourceDatabaseWrite: False/u)
  assert.match(script, /PublicFactWrite : False/u)
  assert.match(script, /PublicRatingWrite: False/u)
})

test('fact value migration preparer preserves generated local files and limits DDL', () => {
  assert.match(script, /next-env\.d\.ts/u)
  assert.match(script, /payload-types\.ts/u)
  assert.match(script, /radar_public_records_facts/u)
  assert.match(script, /ALTER COLUMN\\s\+"value"\\s\+SET DATA TYPE\\s\+varchar/u)
  assert.match(script, /ALTER COLUMN\\s\+"value"\\s\+SET DATA TYPE\\s\+jsonb/u)
  assert.match(script, /CREATE\\s\+\(\?:TABLE\|TYPE\)/u)
  assert.match(script, /DROP\\s\+\(\?:TABLE\|TYPE\)/u)
  assert.doesNotMatch(script, /git add --[\s\S]*src\/collections\/RadarPublicRecords\.ts/u)
})

test('public fact collection and generated migration agree on text storage', () => {
  const block = factsBlock(collection)
  assert.match(block, /name: 'value',[\s\S]*type: 'textarea'/u)
  assert.doesNotMatch(block, /name: 'value',[\s\S]*type: 'json'/u)

  if (migrationFiles.length === 0) return
  assert.equal(migrationFiles.length, 1)
  const migration = readFileSync(`src/migrations/${migrationFiles[0]}`, 'utf8')
  assert.match(migration, /ALTER TABLE\s+"radar_public_records_facts"[\s\S]*ALTER COLUMN\s+"value"\s+SET DATA TYPE\s+varchar/iu)
  assert.match(migration, /ALTER TABLE\s+"radar_public_records_facts"[\s\S]*ALTER COLUMN\s+"value"\s+SET DATA TYPE\s+jsonb/iu)
  assert.doesNotMatch(migration, /ALTER TABLE\s+"works"|ALTER TABLE\s+"radar_public_ratings"/iu)
})
