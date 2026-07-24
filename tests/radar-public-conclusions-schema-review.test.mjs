import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const builderV01Path = path.join(root, 'scripts/radar/build-radar-public-conclusions-schema-review-v01.mjs')
const builderV02Path = path.join(root, 'scripts/radar/build-radar-public-conclusions-schema-review-v02.mjs')
const wrapperPath = path.join(root, 'scripts/radar/run-and-package-radar-public-conclusions-schema-review-v01.ps1')
const builderV01 = fs.readFileSync(builderV01Path, 'utf8')
const builderV02 = fs.readFileSync(builderV02Path, 'utf8')
const wrapper = fs.readFileSync(wrapperPath, 'utf8')

test('schema review builders parse and active v02 reaches normal argument validation', () => {
  for (const file of [builderV01Path, builderV02Path]) {
    const check = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' })
    assert.equal(check.status, 0, check.stderr || check.stdout)
  }
  const run = spawnSync(process.execPath, [builderV02Path], { cwd: root, encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(`${run.stdout}\n${run.stderr}`, /Required: --audit-dir/u)
  assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /Expected \d+ occurrence\(s\), found/u)
})

test('schema review binds the exact accepted audit and 9000 unique public rows', () => {
  assert.match(builderV01, /7877020d0314352531290be0d4e334d2b17e18e6f552591dd14e30431f7837ba/u)
  assert.match(builderV01, /95111c7a01fc5c56efd58a9ed03a2c446ec831d1b6fe3ce6822a9bdfafc1258f/u)
  assert.match(builderV01, /EXPECTED_READY_ROWS = 9000/u)
  assert.match(builderV01, /EXPECTED_SOURCE_ROWS = 10805/u)
  assert.match(builderV01, /EXPECTED_WORKS = 35615/u)
  assert.match(builderV01, /Duplicate publicationKey/u)
  assert.match(builderV01, /Duplicate Work ID/u)
  assert.match(builderV01, /ready_public_ai_after_schema/u)
  assert.match(builderV01, /privateTrack\?\.readyToWrite !== 0/u)
})

test('generated schema review is Radar-only and SQL remains disabled', () => {
  assert.match(builderV01, /radar-public-schema-up\.sql\.disabled/u)
  assert.match(builderV01, /radar-public-schema-down\.sql\.disabled/u)
  assert.match(builderV01, /startsWith\('radar_public'\)/u)
  assert.match(builderV01, /startsWith\('enum_radar_public'\)/u)
  assert.match(builderV01, /touches forbidden existing structures/u)
  assert.match(builderV01, /Baseline migration is not empty/u)
  assert.match(builderV01, /public-conclusions-write-plan\.jsonl/u)
})

test('apply and rollback require distinct exact phrases and are not authorized by review generation', () => {
  assert.match(builderV01, /AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01/u)
  assert.match(builderV01, /AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-ROLLBACK-V01/u)
  assert.match(builderV01, /applyReceived: false/u)
  assert.match(builderV01, /rollbackReceived: false/u)
  assert.match(builderV01, /productionWriteAuthorized: false/u)
  assert.match(builderV01, /productionRowsWritten: 0/u)
  assert.match(builderV01, /rollbackExecuted: false/u)
})

test('PowerShell wrapper generates and commits migration but never executes production migration or data write', () => {
  assert.match(wrapper, /prepare-radar-public-conclusions-migration-v02\.ps1' -CommitAndPush/u)
  assert.match(wrapper, /migration 提交文件集合不符合唯一的 5 文件门槛/u)
  assert.match(wrapper, /build-radar-public-conclusions-schema-review-v02\.mjs/u)
  assert.match(wrapper, /ProductionMigrationRun\s+: False/u)
  assert.match(wrapper, /ProductionRowsWritten\s+: 0/u)
  assert.match(wrapper, /ProductionWriteAuthorized: False/u)
  assert.doesNotMatch(wrapper, /payload\s+migrate(?:\s|$)/u)
  assert.doesNotMatch(wrapper, /psql\b/u)
  assert.doesNotMatch(wrapper, /docker\s+exec/u)
  assert.doesNotMatch(wrapper, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu)
})

test('active v02 records that migrate:create may read production while never writing it', () => {
  assert.match(builderV02, /productionDatabaseConnect: true/u)
  assert.match(builderV02, /productionDatabaseReadOnly: true/u)
  assert.match(builderV02, /productionDatabaseWrite: false/u)
  assert.match(builderV02, /migration:create read-only introspection/u)
})
