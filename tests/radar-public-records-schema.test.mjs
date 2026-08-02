import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Radar public records schema is separate from Works and grade conclusions', () => {
  const source = readFileSync('src/collections/RadarPublicRecords.ts', 'utf8')
  assert.match(source, /slug: 'radar-public-records'/u)
  assert.match(source, /name: 'publicationKey'/u)
  assert.match(source, /name: 'identityKey'/u)
  assert.match(source, /name: 'publicState'/u)
  assert.match(source, /value: 'needs_more_research'/u)
  assert.match(source, /name: 'facts'/u)
  assert.match(source, /name: 'evidence'/u)
  assert.match(source, /name: 'recordSha256'/u)
  assert.doesNotMatch(source, /compatibilityGrade|suggestedGrade|humanAssessment|radarAssessment/u)
})

test('Radar public fact values preserve Release strings as text', () => {
  const source = readFileSync('src/collections/RadarPublicRecords.ts', 'utf8')
  const factsStart = source.indexOf("name: 'facts'")
  const evidenceStart = source.indexOf("name: 'evidence'")
  assert.ok(factsStart >= 0 && evidenceStart > factsStart)
  const factsBlock = source.slice(factsStart, evidenceStart)
  assert.match(factsBlock, /name: 'value',[\s\S]*type: 'textarea'/u)
  assert.match(factsBlock, /不得在导入时包装成 JSON 对象或改变内容/u)
  assert.doesNotMatch(factsBlock, /name: 'value',[\s\S]*type: 'json'/u)
})

test('Radar public evidence preserves licensed or authorized source semantics', () => {
  const source = readFileSync('src/collections/RadarPublicRecords.ts', 'utf8')
  const evidenceStart = source.indexOf("name: 'evidence'")
  const sourceReleaseStart = source.indexOf("name: 'sourceReleaseId'")
  assert.ok(evidenceStart >= 0 && sourceReleaseStart > evidenceStart)
  const evidenceBlock = source.slice(evidenceStart, sourceReleaseStart)
  assert.match(evidenceBlock, /value: 'primary'/u)
  assert.match(evidenceBlock, /value: 'licensed_or_authorized'/u)
  assert.match(evidenceBlock, /value: 'supplemental'/u)
  assert.match(evidenceBlock, /value: 'lead_only'/u)
  assert.match(evidenceBlock, /label: '正版或授权来源'/u)
})

test('evidence role migration preparation is generate-only and source-readonly', () => {
  const source = readFileSync(
    'scripts/radar/prepare-radar-public-record-evidence-role-migration-v01.ps1',
    'utf8',
  )
  assert.match(source, /payload migrate:create \$MigrationName --skip-empty/u)
  assert.doesNotMatch(source, /(^|[^:])payload migrate(?:\s|$)/mu)
  assert.match(source, /default_transaction_read_only=on/u)
  assert.match(source, /enum_radar_public_records_evidence_role/u)
  assert.match(source, /licensed_or_authorized/u)
  assert.match(source, /DatabaseMigrate : False/u)
  assert.match(source, /SourceDatabaseWrite: False/u)
})

test('Radar public records expose only current records anonymously', () => {
  const source = readFileSync('src/collections/RadarPublicRecords.ts', 'utf8')
  assert.match(source, /recordStatus:[\s\S]*equals: 'current'/u)
  assert.match(source, /create: editorsAndUp/u)
  assert.match(source, /delete: adminsOnly/u)
  assert.match(source, /disableBulkDelete: true/u)
})
