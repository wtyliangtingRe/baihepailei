import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync('scripts/radar/prepare-radar-unified-release-production-0575-v01.ps1', 'utf8')

test('production preflight is bound to the accepted lab, evidence and release', () => {
  assert.match(source, /6cdc29e28236f487a6e762a5c8871c681a870810/u)
  assert.match(source, /069e2d54055c8c8099ac8f37092e2bdb2b3e060c/u)
  assert.match(source, /728ad2da5f7d3aba03f652b9fd701157b06793ee/u)
  assert.match(source, /RADAR-UNIFIED-RATING-RELEASE-0575-0001/u)
  assert.match(source, /59dc908a447500adb39ef9f72bde306268fdf24ec85fdaaeb418dee0fb9be09f/u)
  assert.match(source, /e45673fa881d6b3faea0aab0dbfc00cdee29d7ad536b9ccd5b40dfd01f24317d/u)
  assert.match(source, /4dcf9e6790fa7175f18b7c91ed3b2f6522ec6d87c623183f0369491b06123605/u)
  assert.match(source, /2847b48eb08c2409c94e0380e6351d778421db13466f17138d2a64b20774eef4/u)
  assert.match(source, /b2363f319233c23c0c9c96a77cb5fec47990b1c9fbf125d847a291baef9835bb/u)
})

test('production preflight verifies exact fresh source state', () => {
  assert.match(source, /ExpectedWorks = 35615/u)
  assert.match(source, /radar_public_records/u)
  assert.match(source, /radar_public_ratings/u)
  assert.match(source, /20260718_072813_existing_schema_baseline_v01/u)
  assert.match(source, /20260718_072843_stewardship_notices_v01/u)
  assert.match(source, /dev`t-1/u)
  assert.match(source, /source-table-counts\.tsv/u)
  assert.match(source, /source-protected-fingerprints\.tsv/u)
  assert.match(source, /当前源库与已验收实验源库/u)
})

test('production preflight creates a fresh backup without database writes', () => {
  assert.match(source, /pg_dump -Fc --no-owner --no-privileges/u)
  assert.match(source, /source-before-radar-unified-release/u)
  assert.match(source, /source-post-backup-table-counts/u)
  assert.match(source, /source-post-backup-protected-fingerprints/u)
  assert.match(source, /sourceDatabaseWrite = \$false/u)
  assert.match(source, /migrationApplied = \$false/u)
  assert.match(source, /publicRecordsWritten = 0/u)
  assert.match(source, /publicRatingsWritten = 0/u)
  assert.match(source, /productionAuthorization = \$false/u)
  assert.doesNotMatch(source, /pnpm\s+(?:exec\s+)?payload\s+migrate/u)
  assert.doesNotMatch(source, /run-unified-release.*import/u)
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b[\s\S]*payload_migrations/iu)
  assert.doesNotMatch(source, /docker\s+rm.*baihepailei-postgres/u)
})

test('production preflight output is an unprivileged candidate only', () => {
  assert.match(source, /radar-unified-release-production-candidate-0575-v01/u)
  assert.match(source, /accept_read_only_production_candidate_preflight_0575_v01/u)
  assert.match(source, /PREPARE-RADAR-UNIFIED-RELEASE-PRODUCTION-0575-V01/u)
  assert.match(source, /data_local\\outputs\\radar-unified-release-production-0575-v01/u)
  assert.match(source, /data_local\\backups\\radar-unified-release-production-0575-v01/u)
  assert.doesNotMatch(source, /productionAuthorization\s*=\s*\$true/u)
})
