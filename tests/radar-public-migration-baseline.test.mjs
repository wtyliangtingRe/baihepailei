import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const payloadConfig = fs.readFileSync(path.join(repoRoot, 'payload.config.ts'), 'utf8')
const migrationPreparer = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/prepare-radar-public-conclusions-migration-v01.ps1'),
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

test('migration preparer creates an empty current-schema baseline before the additive Radar diff', () => {
  const baselinePosition = migrationPreparer.indexOf('$BaselineMigrationName')
  const baselineGenerationPosition = migrationPreparer.indexOf("-State 'false'")
  const radarGenerationPosition = migrationPreparer.indexOf("-State 'true'")

  assert.ok(baselinePosition >= 0)
  assert.ok(baselineGenerationPosition > baselinePosition)
  assert.ok(radarGenerationPosition > baselineGenerationPosition)
  assert.match(migrationPreparer, /--force-accept-warning/u)
  assert.match(migrationPreparer, /Snapshot-only baseline/u)
  assert.match(migrationPreparer, /Intentionally empty\. Existing schema is recorded, never recreated\./u)
  assert.match(migrationPreparer, /"human_assessment_grade"/u)
  assert.match(migrationPreparer, /"public\\\.radar_public"/u)
  assert.match(migrationPreparer, /baselineSnapshotName/u)
  assert.match(migrationPreparer, /newMigrationSnapshotName/u)
  assert.match(migrationPreparer, /Reset-GeneratedMigrationArtifacts/u)
  assert.doesNotMatch(migrationPreparer, /payload\s+migrate(?:\s|$)/u)
})
