import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)

const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, root), 'utf8')

test('Radar public ratings store optional numeric metrics and provenance', () => {
  const collection = read(
    'src/collections/RadarPublicRatings.ts',
  )

  assert.match(
    collection,
    /name: 'confidencePercent'[\s\S]*type: 'number'[\s\S]*min: 0[\s\S]*max: 100/,
  )

  assert.match(
    collection,
    /name: 'evidenceCoveragePercent'[\s\S]*type: 'number'[\s\S]*min: 0[\s\S]*max: 100/,
  )

  for (const field of [
    'metricsPolicyVersion',
    'sourceMetricsPolicyVersion',
    'relationshipEvidenceState',
    'metricsSourceReleaseId',
    'metricsCalculationBasisSha256',
    'requiresMetricReview',
  ]) {
    assert.match(
      collection,
      new RegExp(`name: '${field}'`),
    )
  }

  assert.match(
    collection,
    /value: 'covered'[\s\S]*value: 'partial'[\s\S]*value: 'uncovered'/,
  )

  assert.match(
    collection,
    /非阻断校准提示；不会改变人工审核状态或评级等级/,
  )
})

test('the existing AI panel reads only explicit metric numbers', () => {
  const bridge = read(
    'src/app/(frontend)/_lib/radar-public-rating-bridge.ts',
  )

  assert.match(
    bridge,
    /confidencePercent\?: number \| null/,
  )

  assert.match(
    bridge,
    /evidenceCoveragePercent\?: number \| null/,
  )

  assert.match(
    bridge,
    /typeof value !== 'number'/,
  )

  assert.match(
    bridge,
    /confidencePercent: normalizedPercent\([\s\S]*rating\.confidencePercent/,
  )

  assert.match(
    bridge,
    /evidenceCoveragePercent: normalizedPercent\([\s\S]*rating\.evidenceCoveragePercent/,
  )

  assert.match(
    bridge,
    /clean\(rating\.metricsPolicyVersion\)[\s\S]*clean\(rating\.sourcePolicyVersion\)/,
  )

  assert.match(
    bridge,
    /normalizedPercent\([\s\S]*currentAssessment\?\.confidencePercent/,
  )

  assert.match(
    bridge,
    /normalizedPercent\([\s\S]*currentAssessment\?\.evidenceCoveragePercent/,
  )

  assert.doesNotMatch(
    bridge,
    /(high|medium|low)[\s\S]{0,80}(90|60|30)/,
  )

  assert.doesNotMatch(
    bridge,
    /humanAssessment\s*:/,
  )

  assert.doesNotMatch(
    bridge,
    /payload\.(create|update|delete)/,
  )
})
