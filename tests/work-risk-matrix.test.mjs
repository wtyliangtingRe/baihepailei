import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const works = fs.readFileSync(new URL('../src/collections/Works.ts', import.meta.url), 'utf8')
const detailTypes = fs.readFileSync(new URL('../src/app/(frontend)/_lib/detail-index.ts', import.meta.url), 'utf8')
const detailComponent = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const riskCard = fs.readFileSync(new URL('../src/app/(frontend)/_components/WorkRiskMatrixCard.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const retirements = fs.readFileSync(new URL('../src/app/(frontend)/review-editor-retirements.css', import.meta.url), 'utf8')
const enrichDetail = fs.readFileSync(new URL('../scripts/export/enrich-lite-detail-index.mjs', import.meta.url), 'utf8')
const enrichRisk = fs.readFileSync(new URL('../scripts/export/enrich-lite-risk-matrix.mjs', import.meta.url), 'utf8')
const wrapper = fs.readFileSync(new URL('../scripts/export/build-and-enrich-lite-detail-index.mjs', import.meta.url), 'utf8')

test('legacy work risk matrix fields remain available for compatibility', () => {
  assert.ok(works.includes("name: 'riskMatrix'"))
  assert.ok(works.includes("name: 'maleImpact'"))
  assert.ok(works.includes("name: 'relationshipClarity'"))
  assert.ok(works.includes("name: 'endingSafety'"))
  assert.ok(works.includes("name: 'creatorSpeechRisk'"))
})

test('detail index type still preserves legacy work risk matrix data', () => {
  assert.ok(detailTypes.includes('export type WorkRiskMatrix'))
  assert.ok(detailTypes.includes('riskMatrix?: WorkRiskMatrix'))
})

test('standalone risk matrix card is retired without deleting data', () => {
  assert.ok(riskCard.includes('standalone matrix has been retired'))
  assert.ok(riskCard.includes('return null'))
  assert.doesNotMatch(riskCard, /雷点 \/ 注意点矩阵/u)
})

test('detail page may keep the compatibility component because it renders nothing', () => {
  assert.ok(detailComponent.includes("import WorkRiskMatrixCard from './WorkRiskMatrixCard'"))
  assert.ok(detailComponent.includes('<WorkRiskMatrixCard item={item} />'))
})

test('legacy matrix stylesheet is retired without hiding current editor sections by position', () => {
  assert.doesNotMatch(layout, /work-risk-matrix\.css/u)
  assert.match(layout, /review-editor-retirements\.css/u)
  assert.doesNotMatch(retirements, /nth-of-type\(3\)/u)
  assert.match(retirements, /review-editor-page:has/u)
})

test('export keeps existing matrix values without running the retired enrichment step', () => {
  assert.ok(enrichDetail.includes('riskMatrix: item.riskMatrix'))
  assert.ok(enrichDetail.includes('riskMatrix: searchItem.riskMatrix || detailItem.riskMatrix'))
  assert.ok(enrichRisk.includes('function riskMatrix'))
  assert.ok(enrichRisk.includes('/api/works'))
  assert.ok(enrichRisk.includes('matrixById.set'))
  assert.ok(wrapper.includes('enrich-lite-detail-index.mjs'))
  assert.doesNotMatch(wrapper, /enrich-lite-risk-matrix\.mjs/u)
})
