import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const payloadConfig = fs.readFileSync(path.join(repoRoot, 'payload.config.ts'), 'utf8')
const migrationWrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/prepare-radar-public-conclusions-migration-v01.ps1'),
  'utf8',
)
const migrationPreparer = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/prepare-radar-public-conclusions-migration-v02.ps1'),
  'utf8',
)
const normalizationAudit = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/audit-work-normalization-candidates-v01.ps1'),
  'utf8',
)


test('Radar public collection remains config-gated while database migration is paused', () => {
  assert.match(payloadConfig, /RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY/u)
  assert.match(
    payloadConfig,
    /String\(process\.env\['RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY'\] \|\| 'true'\)\.toLowerCase\(\) !== 'false'/u,
  )
  assert.match(
    payloadConfig,
    /\.\.\.\(radarPublicConclusionsSchemaReady \? \[RadarPublicConclusionsWithAudit\] : \[\]\)/u,
  )
})


test('legacy migration entry point fails closed and points to the read-only normalization audit', () => {
  assert.match(migrationWrapper, /migration generation is paused/u)
  assert.match(migrationWrapper, /audit-work-normalization-candidates-v01\.ps1/u)
  assert.match(migrationWrapper, /No database write or migration was performed/u)
  assert.doesNotMatch(migrationWrapper, /prepare-radar-public-conclusions-migration-v02\.ps1/u)
  assert.doesNotMatch(migrationWrapper, /payload\s+migrate(?::create)?/u)
})


test('normalization candidate audit is database-read-only and produces review artifacts', () => {
  assert.match(normalizationAudit, /default_transaction_read_only=on/u)
  assert.match(normalizationAudit, /human-normalization-candidates\.jsonl/u)
  assert.match(normalizationAudit, /schema-retirement-exceptions\.jsonl/u)
  assert.match(normalizationAudit, /rank-retirement-candidates\.jsonl/u)
  assert.match(normalizationAudit, /manifest\.json/u)
  assert.match(normalizationAudit, /DatabaseWrite: False/u)
  assert.doesNotMatch(normalizationAudit, /\b(?:UPDATE|INSERT|DELETE|ALTER|DROP|CREATE TABLE|TRUNCATE)\b/u)
})


test('dormant v02 preparer never executes a migration command', () => {
  assert.doesNotMatch(migrationPreparer, /payload\s+migrate(?:\s|$)/u)
})
