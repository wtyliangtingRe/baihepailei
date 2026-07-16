import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const panel = fs.readFileSync(new URL('../src/app/(frontend)/_components/PersonalRecommendationPanel.tsx', import.meta.url), 'utf8')

test('personal recommendations understand all six list states', () => {
  for (const status of ['want', 'watching', 'seen', 'favorite', 'avoid', 'needs_review']) assert.match(panel, new RegExp(status, 'u'))
  assert.match(panel, /statusPriority/u)
  assert.match(panel, /sets\.avoid/u)
  assert.match(panel, /sets\.seen/u)
  assert.match(panel, /work\.bucket !== 'not-recommended'/u)
})
