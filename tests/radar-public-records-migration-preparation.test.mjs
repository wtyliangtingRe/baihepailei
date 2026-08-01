import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const scriptPath = 'scripts/radar/prepare-radar-public-records-migration-v01.ps1'
const script = readFileSync(scriptPath, 'utf8')

test('migration preparer uses an isolated read-only schema comparison', () => {
  assert.match(script, /default_transaction_read_only=on/u)
  assert.match(script, /PAYLOAD_MIGRATION_DIR/u)
  assert.match(script, /RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'false'/u)
  assert.match(script, /RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'/u)
  assert.match(script, /pnpm payload migrate:create/u)
  assert.doesNotMatch(script, /pnpm payload migrate(?:\s|$)/u)
  assert.match(script, /DatabaseMigrate\s+: False/u)
  assert.match(script, /PayloadWrite\s+: False/u)
  assert.match(script, /WorksMutation\s+: False/u)
})

test('migration preparer registers the collection without touching rating tracks', () => {
  assert.match(script, /RadarPublicRecords/u)
  assert.match(script, /RadarPublicRecordsWithAudit/u)
  assert.match(script, /radarPublicRecordsSchemaReady/u)
  assert.match(script, /humanAssessmentMutation|human_assessment_grade/u)
  assert.doesNotMatch(script, /withRadarAssessmentFields\(RadarPublicRecords/u)
})

test('generated migration, when present, is additive and isolated', () => {
  const migrationDir = 'src/migrations'
  const names = readdirSync(migrationDir)
  const migrationTs = names.find((name) => name.endsWith('_radar_public_records_v01.ts'))
  const migrationJson = names.find((name) => name.endsWith('_radar_public_records_v01.json'))
  const baselineTs = names.find((name) => name.endsWith('_current_schema_baseline_before_radar_public_records_v01.ts'))
  const baselineJson = names.find((name) => name.endsWith('_current_schema_baseline_before_radar_public_records_v01.json'))

  if (![migrationTs, migrationJson, baselineTs, baselineJson].some(Boolean)) return

  assert.ok(migrationTs && migrationJson && baselineTs && baselineJson)
  const migration = readFileSync(`${migrationDir}/${migrationTs}`, 'utf8')
  const baseline = readFileSync(`${migrationDir}/${baselineTs}`, 'utf8')
  const snapshot = readFileSync(`${migrationDir}/${migrationJson}`, 'utf8')
  const config = readFileSync('payload.config.ts', 'utf8')

  assert.match(migration, /CREATE TABLE\s+"radar_public_records"/u)
  assert.doesNotMatch(migration, /ALTER TABLE\s+"works"/u)
  assert.doesNotMatch(migration, /ALTER TABLE\s+"radar_public"(?:\s|`)/u)
  assert.doesNotMatch(migration, /CREATE TABLE\s+"radar_public"(?:\s|`)/u)
  assert.doesNotMatch(baseline, /db\.execute|CREATE TABLE|ALTER TABLE|DROP TABLE/u)
  assert.match(snapshot, /public\.radar_public_records/u)
  assert.match(snapshot, /public\.radar_public/u)
  assert.match(config, /RADAR_PUBLIC_RECORDS_SCHEMA_READY/u)
  assert.match(config, /RadarPublicRecordsWithAudit/u)
  assert.ok(existsSync('.env.example'))
})
test('temporary Payload config is removed before workspace validation', () => {
  const cleanupMarker = 'does not classify its own temporary file as an external workspace change'
  const cleanupIndex = script.indexOf(cleanupMarker)
  const workspaceCheckIndex = script.indexOf('$unexpectedAfter =')
  const finallyIndex = script.indexOf('} finally {', workspaceCheckIndex)

  assert.ok(cleanupIndex >= 0, 'missing pre-validation temporary config cleanup')
  assert.ok(workspaceCheckIndex > cleanupIndex, 'workspace validation runs before temporary config cleanup')
  assert.ok(finallyIndex > workspaceCheckIndex, 'fallback finally cleanup must remain after validation')
})
