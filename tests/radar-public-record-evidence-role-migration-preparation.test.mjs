import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const scriptPath = 'scripts/radar/prepare-radar-public-record-evidence-role-migration-v01.ps1'
const collectionPath = 'src/collections/RadarPublicRecords.ts'
const migrationDirectory = 'src/migrations'
const migrationSuffix = 'radar_public_record_evidence_role_v01.ts'
const role = 'licensed_or_authorized'
const enumName = 'enum_radar_public_records_evidence_role'

test('evidence role migration preparer only generates and never applies migrations', () => {
  const source = readFileSync(scriptPath, 'utf8')
  assert.match(source, /payload migrate:create \$MigrationName --skip-empty/u)
  assert.doesNotMatch(source, /(^|[^:])payload migrate(?:\s|$)/mu)
  assert.match(source, /default_transaction_read_only=on/u)
  assert.match(source, /DatabaseMigrate : False/u)
  assert.match(source, /SourceDatabaseWrite: False/u)
  assert.match(source, /PublicFactWrite : False/u)
  assert.match(source, /PublicRatingWrite: False/u)
})

test('evidence role migration preparer limits the contract to the evidence role enum', () => {
  const source = readFileSync(scriptPath, 'utf8')
  assert.match(source, new RegExp(enumName, 'u'))
  assert.match(source, new RegExp(role, 'u'))
  assert.match(source, /radar_public_records_evidence/u)
  assert.match(source, /证据角色迁移混入预期外 DDL/u)
  assert.match(source, /迁移修改了非 evidence\.role enum/u)
})

test('Radar public records collection accepts the licensed or authorized evidence role', () => {
  const source = readFileSync(collectionPath, 'utf8')
  const evidenceStart = source.indexOf("name: 'evidence'")
  const sourceReleaseStart = source.indexOf("name: 'sourceReleaseId'")
  assert.ok(evidenceStart >= 0 && sourceReleaseStart > evidenceStart)
  const evidenceBlock = source.slice(evidenceStart, sourceReleaseStart)
  assert.match(evidenceBlock, /value: 'primary'/u)
  assert.match(evidenceBlock, /value: 'licensed_or_authorized'/u)
  assert.match(evidenceBlock, /value: 'supplemental'/u)
  assert.match(evidenceBlock, /value: 'lead_only'/u)
})

test('generated evidence role migration agrees with the collection when present', () => {
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(migrationSuffix))
  if (migrations.length === 0) return
  assert.equal(migrations.length, 1)
  const source = readFileSync(`${migrationDirectory}/${migrations[0]}`, 'utf8')
  assert.match(source, new RegExp(enumName, 'u'))
  assert.match(source, new RegExp(role, 'u'))
  assert.doesNotMatch(source, /CREATE TABLE|DROP TABLE/u)

  const snapshotPath = `${migrationDirectory}/${migrations[0].replace(/\.ts$/u, '.json')}`
  assert.equal(existsSync(snapshotPath), true)
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  assert.ok(snapshot.enums?.[`public.${enumName}`])
  assert.ok(snapshot.enums[`public.${enumName}`].values.includes(role))
})
