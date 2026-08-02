import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync('src/collections/RadarPublicRatings.ts', 'utf8')
const contract = JSON.parse(readFileSync('config/radar-public-ratings-schema-v01.json', 'utf8'))

test('Radar public ratings implement the locked separate projection', () => {
  assert.equal(contract.collectionSlug, 'radar-public-ratings')
  assert.equal(contract.dbName, 'radar_public_ratings')
  assert.match(source, /slug: 'radar-public-ratings'/u)
  assert.match(source, /dbName: 'radar_public_ratings'/u)
  for (const field of [...contract.fields.identity, ...contract.fields.rating, ...contract.fields.publicPresentation, ...contract.fields.provenance]) {
    assert.match(source, new RegExp(`name: '${field}'`, 'u'), `missing field ${field}`)
  }
  for (const field of contract.fields.humanReview) {
    assert.match(source, new RegExp(`name: '${field}'`, 'u'), `missing human review field ${field}`)
  }
})

test('Radar public ratings preserve Works and legacy assessment tracks', () => {
  assert.match(source, /relationTo: 'works'/u)
  assert.doesNotMatch(source, /withRadarAssessmentFields|humanAssessment|radarAssessment|compatibilityGrade|legacy_x_wiki_page/u)
  assert.match(source, /recordStatus:[\s\S]*equals: 'current'/u)
  assert.match(source, /create: editorsAndUp/u)
  assert.match(source, /delete: adminsOnly/u)
  assert.match(source, /disableBulkDelete: true/u)
})

test('Radar public ratings support the full public grade and review vocabulary', () => {
  for (const grade of ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']) {
    assert.match(source, new RegExp(`'${grade}'`, 'u'))
  }
  for (const confidence of ['high', 'medium', 'low']) {
    assert.match(source, new RegExp(`value: '${confidence}'`, 'u'))
  }
  for (const status of ['unreviewed', 'reviewed', 'disputed']) {
    assert.match(source, new RegExp(`value: '${status}'`, 'u'))
  }
  assert.match(source, /name: 'blocksAnalysis'[\s\S]*defaultValue: false/u)
  assert.match(source, /name: 'blocksPublication'[\s\S]*defaultValue: false/u)
})
