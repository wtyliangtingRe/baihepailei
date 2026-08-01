import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  assertIsolatedLabUrl,
  assertPlanForMode,
  summarizePlans,
} from '../scripts/radar/run-public-release-lab-import-v01.mjs'

const importer = readFileSync('scripts/radar/run-public-release-lab-import-v01.mjs', 'utf8')
const marker = readFileSync('src/app/(payload)/api/radar-public-release-lab-marker/route.ts', 'utf8')
const wrapper = readFileSync('scripts/radar/run-radar-public-release-lab-v01.ps1', 'utf8')
const preparer = readFileSync('scripts/radar/prepare-radar-public-release-lab-database-v01.ps1', 'utf8')
const executor = readFileSync('scripts/radar/execute-radar-public-release-lab-v01.ps1', 'utf8')

test('write-capable importer accepts only loopback high ports', () => {
  assert.equal(assertIsolatedLabUrl('http://127.0.0.1:32001'), 'http://127.0.0.1:32001')
  assert.equal(assertIsolatedLabUrl('http://localhost:39999/'), 'http://localhost:39999')
  assert.throws(() => assertIsolatedLabUrl('http://127.0.0.1:3000'), /31000-39999|3000/u)
  assert.throws(() => assertIsolatedLabUrl('https://127.0.0.1:32001'), /must use http/u)
  assert.throws(() => assertIsolatedLabUrl('http://example.com:32001'), /loopback/u)
  assert.throws(() => assertIsolatedLabUrl('http://127.0.0.1:8080'), /31000-39999/u)
})

test('plan summary closes create and already-current partitions', () => {
  assert.deepEqual(
    summarizePlans([
      { planStatus: 'ready_create' },
      { planStatus: 'ready_create' },
      { planStatus: 'blocked_identity_conflict' },
    ]),
    {
      byPlanStatus: { blocked_identity_conflict: 1, ready_create: 2 },
      readyCreate: 2,
      readyUpdate: 0,
      alreadyCurrent: 0,
      blocked: 1,
    },
  )
})

test('initial mode requires an exact empty-collection create', () => {
  assert.doesNotThrow(() => assertPlanForMode({
    byPlanStatus: { ready_create: 3 },
    readyCreate: 3,
    readyUpdate: 0,
    alreadyCurrent: 0,
    blocked: 0,
  }, 3, 'initial'))
  assert.throws(() => assertPlanForMode({
    byPlanStatus: { already_current: 1, ready_create: 2 },
    readyCreate: 2,
    readyUpdate: 0,
    alreadyCurrent: 1,
    blocked: 0,
  }, 3, 'initial'), /empty-collection create/u)
})

test('incremental mode accepts create update and current but rejects blockers', () => {
  assert.doesNotThrow(() => assertPlanForMode({
    byPlanStatus: { already_current: 5, ready_create: 2, ready_update: 1 },
    readyCreate: 2,
    readyUpdate: 1,
    alreadyCurrent: 5,
    blocked: 0,
  }, 8, 'incremental'))
  assert.throws(() => assertPlanForMode({
    byPlanStatus: { blocked_identity_conflict: 1, ready_create: 1 },
    readyCreate: 1,
    readyUpdate: 0,
    alreadyCurrent: 0,
    blocked: 1,
  }, 2, 'incremental'), /blockers/u)
})

test('importer requires the isolated marker and supports guarded idempotent upserts only', () => {
  assert.match(importer, /RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01/u)
  assert.match(importer, /radar-public-release-lab-marker/u)
  assert.match(importer, /RADAR_PUBLIC_RELEASE_LAB_NONCE/u)
  assert.match(importer, /expected-website-commit/u)
  assert.match(importer, /expected-research-head/u)
  assert.match(importer, /expected-release-source-commit/u)
  assert.match(importer, /expected-database/u)
  assert.match(importer, /--mode must be initial or incremental/u)
  assert.match(importer, /method: 'POST'/u)
  assert.match(importer, /method: 'PATCH'/u)
  assert.doesNotMatch(importer, /method: 'DELETE'|method: 'PUT'/u)
  assert.match(importer, /already_current_skipped/u)
  assert.match(importer, /omissionMeansDelete: false/u)
  assert.match(importer, /explicitWithdrawalRequired: true/u)
  assert.match(importer, /productionWrite: false/u)
})

test('one-command wrapper reuses an existing source container safely', () => {
  assert.match(wrapper, /RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01/u)
  assert.match(wrapper, /docker ps -aq --filter "name=\^\/\$\{Name\}\$"/u)
  assert.match(wrapper, /docker inspect -f '\{\{\.State\.Running\}\}'/u)
  assert.match(wrapper, /docker start \$Name/u)
  assert.match(wrapper, /docker compose up -d postgres/u)
  assert.match(wrapper, /复用正在运行的源容器/u)
  assert.match(wrapper, /prepare-radar-public-release-lab-database-v01\.ps1/u)
  assert.match(wrapper, /execute-radar-public-release-lab-v01\.ps1/u)
  assert.doesNotMatch(wrapper, /docker rm.*baihepailei-postgres/u)
})

test('one-command wrapper neutralizes PowerShell JSON date coercion', () => {
  assert.match(wrapper, /Convert-LabCreatedAtForExecutor/u)
  assert.match(wrapper, /DateTimeOffset\]::ParseExact/u)
  assert.match(wrapper, /DateTimeStyles\]::RoundtripKind/u)
  assert.match(wrapper, /ToString\('r'/u)
  assert.match(wrapper, /RFC 1123 remains a JSON string while preserving UTC/u)
  assert.match(wrapper, /createdAt 位于未来/u)
  assert.match(wrapper, /已超过 4 小时/u)
})

test('one-command wrapper cleans only current-run disposable resources on early failure', () => {
  assert.match(wrapper, /Remove-RunLabResources/u)
  assert.match(wrapper, /baihepailei-radar-public-release-lab-\[0-9\]/u)
  assert.match(wrapper, /data_local\\backups\\radar-public-release-lab-v01/u)
  assert.match(wrapper, /StartsWith\(\$backupPrefix/u)
  assert.match(wrapper, /catch \{\s*Remove-RunLabResources/u)
  assert.match(wrapper, /Remove-Item -LiteralPath \$EnvironmentPath/u)
  assert.doesNotMatch(wrapper, /Remove-Item.*\.env/u)
})

test('lab marker is disabled by default and binds nonce plus all commit identities', () => {
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_MODE/u)
  assert.match(marker, /invalid_lab_nonce/u)
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_DATABASE/u)
  assert.match(marker, /lab_database_mismatch/u)
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_WEBSITE_COMMIT/u)
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_RESEARCH_HEAD/u)
  assert.match(marker, /RADAR_PUBLIC_RELEASE_LAB_RELEASE_SOURCE_COMMIT/u)
  assert.match(marker, /status: 404/u)
  assert.match(marker, /status: 403/u)
})

test('database preparer only clones the source and performs no migration or import', () => {
  assert.match(preparer, /PREPARE-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01/u)
  assert.match(preparer, /ExpectedResearchHead = '6ee4051/u)
  assert.match(preparer, /ExpectedReleaseSourceCommit = '1555eb3/u)
  assert.match(preparer, /SELECT COALESCE\(to_regclass\('public\.radar_public_records'\)/u)
  assert.match(preparer, /ExpectedWorks = 35615/u)
  assert.match(preparer, /pg_dump -Fc --no-owner --no-privileges/u)
  assert.match(preparer, /pg_restore --no-owner --no-privileges/u)
  assert.match(preparer, /127\.0\.0\.1:\$\{dbPort\}:5432/u)
  assert.match(preparer, /researchHead = \$ExpectedResearchHead/u)
  assert.match(preparer, /releaseSourceCommit = \$releaseSourceCommit/u)
  assert.match(preparer, /sourcePostcheckPassed = \$true/u)
  assert.match(preparer, /sourceDatabaseWrite = \$false/u)
  assert.match(preparer, /migrationApplied = \$false/u)
  assert.match(preparer, /publicRecordsWritten = 0/u)
  assert.doesNotMatch(preparer, /pnpm payload migrate/u)
  assert.doesNotMatch(preparer, /run-public-release-lab-import-v01/u)
})

test('executor cannot read the source database and verifies the exact allowed deltas', () => {
  assert.match(executor, /EXECUTE-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01/u)
  assert.match(executor, /baihepailei-radar-public-release-lab-/u)
  assert.match(executor, /31000-31999/u)
  assert.match(executor, /pnpm payload migrate/u)
  assert.match(executor, /radar-public-release-lab-marker/u)
  assert.match(executor, /expected-research-head/u)
  assert.match(executor, /expected-release-source-commit/u)
  assert.match(executor, /run-public-release-lab-import-v01/u)
  assert.match(executor, /createdRows -ne 520/u)
  assert.match(executor, /alreadyCurrent -ne 520/u)
  assert.match(executor, /audit_events/u)
  assert.match(executor, /payload_migrations/u)
  assert.match(executor, /protectedFingerprintsUnchanged = \$true/u)
  assert.match(executor, /sourceDatabaseWrite = \$false/u)
  assert.match(executor, /productionAuthorization = \$false/u)
  assert.doesNotMatch(executor, /SourcePostgresContainer|SourceDatabaseUser|pg_dump/u)
})
