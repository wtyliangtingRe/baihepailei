import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  assertIsolatedLabUrl,
  assertPlanForMode,
} from '../scripts/radar/run-unified-release-lab-import-0575-v01.mjs'

const importer = readFileSync('scripts/radar/run-unified-release-lab-import-0575-v01.mjs', 'utf8')
const marker = readFileSync('src/app/(payload)/api/radar-unified-release-lab-marker/route.ts', 'utf8')
const wrapper = readFileSync('scripts/radar/run-radar-unified-release-lab-0575-v01.ps1', 'utf8')
const preparer = readFileSync('scripts/radar/prepare-radar-unified-release-lab-database-0575-v01.ps1', 'utf8')
const reconciler = readFileSync('scripts/radar/reconcile-radar-public-dev-schema-v02.mjs', 'utf8')
const executor = readFileSync('scripts/radar/execute-radar-unified-release-lab-0575-v01.ps1', 'utf8')

function freshPlan(rows = 575) {
  return {
    accepted: true,
    counts: {
      rows,
      blockers: 0,
      recordStatusCounts: { ready_create: rows },
      ratingStatusCounts: { ready_create: rows },
    },
  }
}

test('write-capable importer accepts only loopback high ports', () => {
  assert.equal(assertIsolatedLabUrl('http://127.0.0.1:32001'), 'http://127.0.0.1:32001')
  assert.equal(assertIsolatedLabUrl('http://localhost:39999/'), 'http://localhost:39999')
  assert.throws(() => assertIsolatedLabUrl('http://127.0.0.1:3000'), /31000-39999/u)
  assert.throws(() => assertIsolatedLabUrl('https://127.0.0.1:32001'), /HTTP/u)
  assert.throws(() => assertIsolatedLabUrl('http://example.com:32001'), /loopback/u)
})

test('fresh mode requires 575 fact creates and 575 rating creates', () => {
  assert.doesNotThrow(() => assertPlanForMode(freshPlan(), 'fresh', 575))
  const wrong = freshPlan()
  wrong.counts.ratingStatusCounts = { already_current: 575 }
  assert.throws(() => assertPlanForMode(wrong, 'fresh', 575), /575 facts and ratings/u)
})

test('incremental mode accepts only create update and current with no blockers', () => {
  const plan = {
    accepted: true,
    counts: {
      rows: 575,
      blockers: 0,
      recordStatusCounts: { ready_create: 55, ready_update: 520 },
      ratingStatusCounts: { ready_create: 575 },
    },
  }
  assert.doesNotThrow(() => assertPlanForMode(plan, 'incremental', 575))
  plan.counts.blockers = 1
  plan.accepted = false
  assert.throws(() => assertPlanForMode(plan, 'incremental', 575), /blocked/u)
})

test('unified importer writes only fact and rating projections through POST or PATCH', () => {
  assert.match(importer, /RUN-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01/u)
  assert.match(importer, /validateLockedRelease/u)
  assert.match(importer, /buildUnifiedReleasePlan/u)
  assert.match(importer, /radar-public-records/u)
  assert.match(importer, /radar-public-ratings/u)
  assert.match(importer, /method: 'POST'/u)
  assert.match(importer, /method: 'PATCH'/u)
  assert.doesNotMatch(importer, /method: 'PUT'|method: 'DELETE'/u)
  assert.match(importer, /expectedStorage/u)
  assert.match(importer, /factCreate/u)
  assert.match(importer, /ratingCreate/u)
  assert.match(importer, /omissionMeansDelete: false/u)
  assert.match(importer, /productionAuthorization: false/u)
  assert.doesNotMatch(importer, /api\/works[^?]/u)
})

test('lab marker is disabled by default and binds nonce, database, commits and release ID', () => {
  assert.match(marker, /RADAR_UNIFIED_RELEASE_LAB_MODE/u)
  assert.match(marker, /invalid_lab_nonce/u)
  assert.match(marker, /RADAR_UNIFIED_RELEASE_LAB_DATABASE/u)
  assert.match(marker, /RADAR_UNIFIED_RELEASE_LAB_WEBSITE_COMMIT/u)
  assert.match(marker, /RADAR_UNIFIED_RELEASE_LAB_RESEARCH_HEAD/u)
  assert.match(marker, /RADAR_UNIFIED_RELEASE_LAB_RELEASE_ID/u)
  assert.match(marker, /radar-unified-release-lab-marker-0575-v01/u)
  assert.match(marker, /status: 404/u)
  assert.match(marker, /status: 403/u)
})

test('one-command wrapper preserves source container and credentials', () => {
  assert.match(wrapper, /RUN-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01/u)
  assert.match(wrapper, /docker ps -aq --filter "name=\^\/\$\{Name\}\$"/u)
  assert.match(wrapper, /docker start \$Name/u)
  assert.match(wrapper, /docker compose up -d postgres/u)
  assert.doesNotMatch(wrapper, /docker rm.*baihepailei-postgres/u)
  assert.match(wrapper, /Read-Host '请输入该 Payload 账号密码（输入不会显示）' -AsSecureString/u)
  assert.match(wrapper, /SecureStringToBSTR/u)
  assert.match(wrapper, /ZeroFreeBSTR/u)
  assert.match(wrapper, /凭据仅保留在当前进程内存中/u)
  assert.doesNotMatch(wrapper, /-PayloadPassword|-Password \$credentials\.Password/u)
  assert.match(wrapper, /next-env\.d\.ts/u)
  assert.match(wrapper, /payload-types\.ts/u)
})

test('one-command wrapper cleans only current-run disposable resources', () => {
  assert.match(wrapper, /Remove-RunLabResources/u)
  assert.match(wrapper, /baihepailei-radar-unified-release-lab-\[0-9\]/u)
  assert.match(wrapper, /data_local\\backups\\radar-unified-release-lab-0575-v01/u)
  assert.match(wrapper, /StartsWith\(\$backupPrefix/u)
  assert.match(wrapper, /Remove-Item -LiteralPath \$EnvironmentPath/u)
  assert.doesNotMatch(wrapper, /Remove-Item.*\.env/u)
})

test('database preparer validates the locked release and only clones the source', () => {
  assert.match(preparer, /PREPARE-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01/u)
  assert.match(preparer, /728ad2da5f7d3aba03f652b9fd701157b06793ee/u)
  assert.match(preparer, /RADAR-UNIFIED-RATING-RELEASE-0575-0001/u)
  assert.match(preparer, /manifestSha256/u)
  assert.match(preparer, /recordsSha256/u)
  assert.match(preparer, /ratingsSha256/u)
  assert.match(preparer, /releaseIndexSha256/u)
  assert.match(preparer, /radar_public_records/u)
  assert.match(preparer, /radar_public_ratings/u)
  assert.match(preparer, /ExpectedWorks = 35615/u)
  assert.match(preparer, /pg_dump -Fc --no-owner --no-privileges/u)
  assert.match(preparer, /pg_restore --no-owner --no-privileges/u)
  assert.match(preparer, /sourcePostcheckPassed = \$true/u)
  assert.match(preparer, /sourceDatabaseWrite = \$false/u)
  assert.match(preparer, /migrationApplied = \$false/u)
  assert.match(preparer, /publicRecordsWritten = 0/u)
  assert.match(preparer, /publicRatingsWritten = 0/u)
  assert.doesNotMatch(preparer, /pnpm payload migrate/u)
  assert.doesNotMatch(preparer, /run-unified-release-lab-import/u)
})

test('historical reconciler proves equivalence in a disposable reference database', () => {
  assert.match(reconciler, /RECONCILE-ISOLATED-RADAR-PUBLIC-DEV-SCHEMA-V02/u)
  assert.match(reconciler, /createdb/u)
  assert.match(reconciler, /dropdb/u)
  assert.match(reconciler, /normalized_pg_dump_schema_only/u)
  assert.match(reconciler, /20260802_030535_radar_public_ratings_v01/u)
  assert.match(reconciler, /RADAR_PUBLIC_RATINGS_SCHEMA_READY/u)
  assert.match(reconciler, /WHERE name = 'dev' AND batch = -1/u)
  assert.match(reconciler, /historicalMigrationRowsRegistered: 2/u)
  assert.match(reconciler, /recordsMigrationRowsRegistered: 0/u)
  assert.match(reconciler, /ratingsMigrationRowsRegistered: 0/u)
  assert.match(reconciler, /sourceDatabaseWrite: false/u)
  assert.match(reconciler, /productionAuthorization: false/u)
  assert.doesNotMatch(reconciler, /baihepailei-postgres|SourcePostgresContainer|pg_dump -Fc/u)
})

test('executor can mutate only the disposable clone and verifies exact deltas', () => {
  assert.match(executor, /EXECUTE-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01/u)
  assert.match(executor, /reconcile-radar-public-dev-schema-v02\.mjs/u)
  assert.match(executor, /pnpm payload migrate/u)
  assert.match(executor, /RADAR_PUBLIC_RATINGS_SCHEMA_READY/u)
  assert.match(executor, /radar-unified-release-lab-marker/u)
  assert.match(executor, /run-unified-release-lab-import-0575-v01/u)
  assert.match(executor, /factCreate -ne 575/u)
  assert.match(executor, /ratingCreate -ne 575/u)
  assert.match(executor, /already_current -ne 575/u)
  assert.match(executor, /audit_events 增量不是 1150/u)
  assert.match(executor, /payload_migrations 净增量不是 4/u)
  assert.match(executor, /formalMigrationsAdded = 5/u)
  assert.match(executor, /publicRecords = 575/u)
  assert.match(executor, /publicRatings = 575/u)
  assert.match(executor, /protectedFingerprintsUnchanged = \$true/u)
  assert.match(executor, /sourceDatabaseWrite = \$false/u)
  assert.match(executor, /productionAuthorization = \$false/u)
  assert.doesNotMatch(executor, /SourcePostgresContainer|SourceDatabaseUser|pg_dump -Fc/u)
})
