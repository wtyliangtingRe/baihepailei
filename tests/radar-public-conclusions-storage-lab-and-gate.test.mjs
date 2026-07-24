import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const builderPath = path.join(root, 'scripts/radar/build-radar-public-conclusions-storage-lab-sql-v01.mjs')
const runnerV01Path = path.join(root, 'scripts/radar/run-and-package-radar-public-conclusions-storage-lab-and-gate-v01.ps1')
const runnerV02Path = path.join(root, 'scripts/radar/run-and-package-radar-public-conclusions-storage-lab-and-gate-v02.ps1')
const builder = fs.readFileSync(builderPath, 'utf8')
const runnerV01 = fs.readFileSync(runnerV01Path, 'utf8')
const runnerV02 = fs.readFileSync(runnerV02Path, 'utf8')

test('storage lab builder and both runners pass their real parsers', () => {
  const nodeResult = spawnSync(process.execPath, ['--check', builderPath], { cwd: root, encoding: 'utf8' })
  assert.equal(nodeResult.status, 0, nodeResult.stderr || nodeResult.stdout)
  for (const file of [runnerV01Path, runnerV02Path]) {
    const command = [
      '$tokens = $null;',
      '$errors = $null;',
      `[System.Management.Automation.Language.Parser]::ParseFile('${file.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null;`,
      'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
    ].join(' ')
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
})

test('builder is bound to the accepted normalized package and retained schema', () => {
  assert.match(builder, /642e43b9cbac02c75d2d473293c7b57b8b0197594262dfa96b065015e89c135e/u)
  assert.match(builder, /297fed9ab54675748e5ae0dd812cfa4ac367966d12e7732541913223d74ac0fb/u)
  assert.match(builder, /bda8429dfcf6dbcaaeb90199ac1697196b308013f65df546f20b46167b49a220/u)
  assert.match(builder, /72191d11ac163aa09f927353e64b3bdc22d74963d7436a4bf790ce30ee39bc39/u)
  assert.match(builder, /1cff56eb78482c0a5a6bf714e617e8c00a5f90cc1866b76d9081e8bd10deccfd/u)
  assert.match(builder, /EXPECTED_ROWS = 9000/u)
  assert.match(builder, /oldPublicWritePlanSuperseded !== true/u)
  assert.match(builder, /businessAuditSuperseded !== false/u)
  assert.match(builder, /migrationDdlSuperseded !== false/u)
})

test('builder verifies stored content, plan, rewrite map, identity, and UTC milliseconds', () => {
  assert.match(builder, /conclusionSha256ForRecord\(record\)/u)
  assert.match(builder, /ready_public_ai_storage_normalized/u)
  assert.match(builder, /radar-public-storage-normalization-v0\.1/u)
  assert.match(builder, /\\d\{2\}:\\d\{2\}:\\d\{2\}\\\.\\d\{3\}Z/u)
  assert.match(builder, /Duplicate publication key/u)
  assert.match(builder, /Duplicate Work ID/u)
  assert.match(builder, /Duplicate conclusion hash/u)
  assert.match(builder, /Duplicate old conclusion hash/u)
  assert.match(builder, /not bound to the storage write plan/u)
  assert.match(builder, /not bound to the rewrite map/u)
})

test('generated SQL applies only Radar structures inside a serializable transaction', () => {
  assert.match(builder, /BEGIN ISOLATION LEVEL SERIALIZABLE/u)
  assert.match(builder, /INSERT INTO radar_public \(/u)
  assert.match(builder, /INSERT INTO radar_public_review_reasons/u)
  assert.match(builder, /INSERT INTO radar_public_radar_assessment_matched_rules/u)
  assert.match(builder, /INSERT INTO radar_public_radar_assessment_contradictions/u)
  assert.match(builder, /main row field mismatches/u)
  assert.match(builder, /review reason mismatches/u)
  assert.match(builder, /matched rule mismatches/u)
  assert.match(builder, /contradiction mismatches/u)
  assert.match(builder, /EXCEPT ALL/u)
  assert.match(builder, /COMMIT;/u)
  assert.match(builder, /Schema SQL touches a forbidden existing table/u)
})

test('acceptance, rollback, and production preflight remain separate', () => {
  assert.match(builder, /BEGIN TRANSACTION READ ONLY/u)
  assert.match(builder, /publication_key_set_md5/u)
  assert.match(builder, /conclusion_hash_set_md5/u)
  assert.match(builder, /orphan_matched_rules/u)
  assert.match(builder, /radar-public-storage-rollback\.sql\.lab-only/u)
  assert.match(builder, /table_absent_\$\{name\}/u)
  assert.match(builder, /radar-public-production-preflight\.sql/u)
  assert.match(builder, /radar_public_absent/u)
  assert.match(builder, /works_rows/u)
})

test('v01 runner writes only to the no-network disposable database', () => {
  assert.match(runnerV01, /--network none/u)
  assert.match(runnerV01, /pg_dump/u)
  assert.match(runnerV01, /pg_restore/u)
  assert.match(runnerV01, /Invoke-DockerPsqlFile \$labContainer \$labDatabase/u)
  assert.match(runnerV01, /ProductionDatabaseWrite\s+: False/u)
  assert.match(runnerV01, /ProductionRowsWritten\s+: 0/u)
  assert.match(runnerV01, /ProductionApplyAuthorized\s+: False/u)
  assert.doesNotMatch(runnerV01, /Invoke-DockerPsqlFile \$SourcePostgresContainer[^\n]+containerApplyPath/u)
  assert.doesNotMatch(runnerV01, /payload\s+migrate/iu)
})

test('gate is generated only after apply acceptance, rollback, and baseline restore', () => {
  const acceptanceIndex = runnerV01.indexOf("$stageStatus.postApplyAcceptancePassed = $true")
  const rollbackIndex = runnerV01.indexOf("$stageStatus.rollbackPassed = $true")
  const baselineIndex = runnerV01.indexOf("$stageStatus.baselineRestored = $true")
  const gateIndex = runnerV01.indexOf('自动生成 production execution gate')
  assert.ok(acceptanceIndex >= 0)
  assert.ok(rollbackIndex > acceptanceIndex)
  assert.ok(baselineIndex > rollbackIndex)
  assert.ok(gateIndex > baselineIndex)
  assert.match(runnerV01, /productionDatabaseWrite = \$false/u)
  assert.match(runnerV01, /productionRowsWritten = 0/u)
  assert.match(runnerV01, /productionApplyAuthorized = \$false/u)
  assert.match(runnerV01, /rollbackAuthorized = \$false/u)
})

test('v02 finalizes evidence without exposing the full backup', () => {
  assert.match(runnerV02, /RADAR_PG_RESTORE_IMAGE/u)
  assert.match(runnerV02, /docker run --rm --network none/u)
  assert.match(runnerV02, /\*>&1/u)
  assert.match(runnerV02, /ExcludedNames @\('database-backup\.dump'\)/u)
  assert.match(runnerV02, /labEvidenceBundleSha256 = \$labHash\.Hash/u)
  assert.match(runnerV02, /Add-Member -NotePropertyName evidenceFinalizedBy/u)
  assert.match(runnerV02, /Write-EvidenceManifest -Directory \$gateDirectory/u)
  assert.match(runnerV02, /ProductionDatabaseWrite\s+: False/u)
  assert.match(runnerV02, /ProductionRowsWritten\s+: 0/u)
})

test('apply and rollback remain distinct explicit authorizations with no execution wrapper in the gate', () => {
  assert.match(runnerV01, /AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01/u)
  assert.match(runnerV01, /AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-ROLLBACK-V01/u)
  assert.match(runnerV01, /production-apply\.sql\.disabled/u)
  assert.match(runnerV01, /production-rollback\.sql\.disabled/u)
  assert.doesNotMatch(runnerV01, /ValidateSet\('AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01'\)/u)
  assert.doesNotMatch(runnerV02, /ValidateSet\('AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01'\)/u)
})
