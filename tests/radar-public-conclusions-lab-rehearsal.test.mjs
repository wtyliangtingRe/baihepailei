import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const builderV01Path = path.join(root, 'scripts/radar/build-radar-public-conclusions-lab-sql-v01.mjs')
const builderV02Path = path.join(root, 'scripts/radar/build-radar-public-conclusions-lab-sql-v02.mjs')
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-public-conclusions-lab-rehearsal-v02.ps1')
const builderV01 = fs.readFileSync(builderV01Path, 'utf8')
const builderV02 = fs.readFileSync(builderV02Path, 'utf8')
const runner = fs.readFileSync(runnerPath, 'utf8')

test('lab builders and runner pass their real parsers', () => {
  for (const file of [builderV01Path, builderV02Path]) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
  const command = [
    '$tokens = $null;',
    '$errors = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${runnerPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null;`,
    'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
  ].join(' ')
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('lab plan is bound to the accepted 9000-row audit and schema review', () => {
  assert.match(builderV01, /EXPECTED_ROWS = 9000/u)
  assert.match(builderV01, /7877020d0314352531290be0d4e334d2b17e18e6f552591dd14e30431f7837ba/u)
  assert.match(builderV01, /297fed9ab54675748e5ae0dd812cfa4ac367966d12e7732541913223d74ac0fb/u)
  assert.match(builderV01, /95111c7a01fc5c56efd58a9ed03a2c446ec831d1b6fe3ce6822a9bdfafc1258f/u)
  assert.match(builderV01, /S: 8, A: 267, B: 675, C: 868, D: 7032, E: 138, F: 12/u)
  assert.match(builderV01, /Duplicate publicationKey/u)
  assert.match(builderV01, /Duplicate Work ID/u)
  assert.match(builderV01, /Duplicate conclusion SHA-256/u)
})

test('lab SQL performs exact isolated apply, acceptance, rollback, and baseline checks', () => {
  assert.match(builderV01, /BEGIN ISOLATION LEVEL SERIALIZABLE/u)
  assert.match(builderV01, /INSERT INTO radar_public \(/u)
  assert.match(builderV01, /radar_public_radar_assessment_matched_rules/u)
  assert.match(builderV01, /EXCEPT ALL/u)
  assert.match(builderV01, /BEGIN TRANSACTION READ ONLY/u)
  assert.match(builderV01, /radar-public-lab-rollback\.sql\.lab-only/u)
  assert.match(builderV01, /table_absent_radar_public/u)
  assert.match(builderV02, /SELECT q\.mismatch_count INTO mismatch_count FROM \(/u)
  assert.match(builderV02, /generatedSqlNormalization = true/u)
})

test('runner writes only to a no-network disposable database and removes it', () => {
  assert.match(runner, /--network none/u)
  assert.match(runner, /pg_dump/u)
  assert.match(runner, /pg_restore/u)
  assert.match(runner, /RUN-ISOLATED-RADAR-PUBLIC-CONCLUSIONS-LAB-V01/u)
  assert.match(runner, /build-radar-public-conclusions-lab-sql-v02\.mjs/u)
  assert.match(runner, /ProductionDatabaseWrite\s+: False/u)
  assert.match(runner, /ProductionMigrationRun\s+: False/u)
  assert.match(runner, /LabDatabaseWrite\s+: True/u)
  assert.match(runner, /docker rm -f \$labContainer/u)
  assert.match(runner, /database-backup\.dump/u)
  assert.match(runner, /Name -ne 'database-backup\.dump'/u)
  assert.doesNotMatch(runner, /payload migrate(?:\s|')/u)
  assert.doesNotMatch(runner, /AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01/u)
})

test('runner verifies production remains schema-free and non-Radar table counts round-trip', () => {
  assert.match(runner, /to_regclass\('public\.radar_public'\)/u)
  assert.match(runner, /SELECT count\(\*\) FROM public\.works/u)
  assert.match(runner, /Compare-CountMaps \$productionCounts \$labBaselineCounts/u)
  assert.match(runner, /apply 后非 Radar 表/u)
  assert.match(runner, /rollback 后 baseline/u)
  assert.match(runner, /baselineRestored = \$true/u)
  assert.match(runner, /productionApplyAuthorized = \$false/u)
  assert.match(runner, /productionRollbackAuthorized = \$false/u)
})
