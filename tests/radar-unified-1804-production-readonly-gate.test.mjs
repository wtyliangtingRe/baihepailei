import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const runnerPath =
  'scripts/radar/run-and-package-radar-unified-1804-production-readonly-gate-v01.ps1'
const guidePath =
  'docs/guides/radar-unified-1804-production-readonly-gate-v01.md'

const runner = fs.readFileSync(runnerPath, 'utf8')
const guide = fs.readFileSync(guidePath, 'utf8')

test('gate is bound to exact accepted artifacts and cardinality', () => {
  assert.match(
    runner,
    /53AD4CD92D5A7186B7D52A5BDC8D6E714573E7C9CC17559D8BF96CD2D194B8B9/u,
  )
  assert.match(
    runner,
    /38AF33DCE50F0536A951D6EED26E85C3E9EA45A251F53588D5AB5E2E8772351C/u,
  )
  assert.match(runner, /\$ExpectedRows = 1804/u)
  assert.match(runner, /\$ExpectedBaselineRows = 9000/u)
  assert.match(runner, /\$ExpectedPostApplyRows = 10804/u)
})

test('all production psql calls force read-only mode', () => {
  assert.match(runner, /default_transaction_read_only=on/u)
  assert.match(runner, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u)
  assert.doesNotMatch(runner, /-ReadOnly \$false/u)
})

test('gate never copies or executes writable lab SQL', () => {
  assert.doesNotMatch(
    runner,
    /ContainerApplyPath|ContainerRollbackPath/u,
  )
  assert.doesNotMatch(
    runner,
    /Invoke-DockerPsqlFile[\s\S]{0,300}incremental-apply/u,
  )
  assert.doesNotMatch(
    runner,
    /Invoke-DockerPsqlFile[\s\S]{0,300}incremental-rollback/u,
  )
  assert.match(runner, /writableSqlCopiedToProduction = \$false/u)
})

test('gate creates and validates a fresh backup without network', () => {
  assert.match(runner, /pg_dump/u)
  assert.match(runner, /--serializable-deferrable/u)
  assert.match(runner, /pg_restore/u)
  assert.match(runner, /--network none/u)
})

test('gate compares current state to accepted production-final evidence', () => {
  assert.match(runner, /production-final-preflight-stdout\.txt/u)
  assert.match(runner, /production-final-fingerprint-stdout\.txt/u)
  assert.match(runner, /production-final-sequence-stdout\.txt/u)
  assert.match(runner, /production-final-table-counts-stdout\.txt/u)
  assert.match(runner, /currentProductionMatchesAcceptedBaseline = \$true/u)
})

test('gate cannot authorize or execute production apply', () => {
  assert.match(runner, /productionApplyAuthorized = \$false/u)
  assert.match(runner, /productionApplyExecuted = \$false/u)
  assert.doesNotMatch(runner, /productionApplyAuthorized = \$true/u)
  assert.doesNotMatch(runner, /productionApplyExecuted = \$true/u)
  assert.match(
    runner,
    /RUN-RADAR-UNIFIED-1804-PRODUCTION-READONLY-GATE-V01/u,
  )
})


test('gate cleans source-container temporary files before packaging evidence', () => {
  const cleanup = runner.indexOf('清理源容器临时文件后封装证据')
  const copyStatus = runner.indexOf('Copy-Item `\n    -LiteralPath $stageStatusPath')
  assert.ok(cleanup >= 0)
  assert.ok(copyStatus > cleanup)
  assert.match(runner, /sourceContainerTempFilesRemoved = \$true/u)
  assert.match(runner, /evidencePackageCompleted = \$true/u)
})

test('guide preserves the separate final authorization boundary', () => {
  assert.match(guide, /不包含生产 apply 能力/u)
  assert.match(guide, /用户输入独立的最终授权短语/u)
  assert.match(guide, /不包含 database dump、apply SQL 或 rollback SQL/u)
})
