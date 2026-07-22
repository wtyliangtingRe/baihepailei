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

test('Radar public collection is default-on but can be excluded for a snapshot-only baseline', () => {
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

test('migration preparer creates an isolated empty baseline before the additive Radar diff', () => {
  const temporaryGenerationPosition = migrationPreparer.indexOf('在空临时目录生成当前结构快照')
  const radarGenerationPosition = migrationPreparer.indexOf('只生成独立 Radar 公共结论迁移')

  assert.match(migrationWrapper, /prepare-radar-public-conclusions-migration-v02\.ps1/u)
  assert.ok(temporaryGenerationPosition >= 0)
  assert.ok(radarGenerationPosition > temporaryGenerationPosition)
  assert.match(migrationPreparer, /PAYLOAD_CONFIG_PATH/u)
  assert.match(migrationPreparer, /PAYLOAD_MIGRATION_DIR/u)
  assert.match(migrationPreparer, /GetTempPath/u)
  assert.match(migrationPreparer, /Write-IsolatedPayloadConfig/u)
  assert.match(migrationPreparer, /Copy-Item -LiteralPath \$temporaryBaseline\.Snapshot/u)
  assert.match(migrationPreparer, /--force-accept-warning/u)
  assert.match(migrationPreparer, /Snapshot-only baseline generated in an isolated empty migration directory/u)
  assert.match(migrationPreparer, /Intentionally empty\. Existing schema is recorded, never recreated\./u)
  assert.match(migrationPreparer, /"human_assessment_grade"/u)
  assert.match(migrationPreparer, /"public\\\.radar_public"/u)
  assert.match(migrationPreparer, /Assert-RadarOnlyDDL/u)
  assert.match(migrationPreparer, /Reset-GeneratedRepositoryArtifacts/u)
  assert.doesNotMatch(migrationPreparer, /payload\s+migrate(?:\s|$)/u)
})
