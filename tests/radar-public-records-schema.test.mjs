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

test('Radar public record facts preserve JSON primitive and structured values', () => {
  const source = readFileSync('src/collections/RadarPublicRecords.ts', 'utf8')
  assert.match(source, /function validateFactValue\(value: unknown\): true \| string/u)
  assert.match(source, /JSON\.stringify\(value\)/u)
  assert.match(source, /typeof value === 'number' && !Number\.isFinite\(value\)/u)
  assert.match(source, /validate: validateFactValue/u)
  assert.doesNotMatch(source, /valueEnvelope|wrappedValue|JSON\.stringify\(fact\.value\)/u)
})

test('Radar public records expose only current records anonymously', () => {
  const source = readFileSync('src/collections/RadarPublicRecords.ts', 'utf8')
  assert.match(source, /recordStatus:[\s\S]*equals: 'current'/u)
  assert.match(source, /create: editorsAndUp/u)
  assert.match(source, /delete: adminsOnly/u)
  assert.match(source, /disableBulkDelete: true/u)
})
