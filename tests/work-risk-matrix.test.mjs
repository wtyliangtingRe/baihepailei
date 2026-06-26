import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const works = fs.readFileSync(new URL('../src/collections/Works.ts', import.meta.url), 'utf8')
const detailTypes = fs.readFileSync(new URL('../src/app/(frontend)/_lib/detail-index.ts', import.meta.url), 'utf8')
const detailComponent = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const riskCard = fs.readFileSync(new URL('../src/app/(frontend)/_components/WorkRiskMatrixCard.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/work-risk-matrix.css', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const enrichDetail = fs.readFileSync(new URL('../scripts/export/enrich-lite-detail-index.mjs', import.meta.url), 'utf8')
const enrichRisk = fs.readFileSync(new URL('../scripts/export/enrich-lite-risk-matrix.mjs', import.meta.url), 'utf8')
const wrapper = fs.readFileSync(new URL('../scripts/export/build-and-enrich-lite-detail-index.mjs', import.meta.url), 'utf8')

test('works collection defines a risk matrix group', () => {
  assert.ok(works.includes("name: 'riskMatrix'"))
  assert.ok(works.includes("label: '雷点 / 注意点矩阵'"))
  assert.ok(works.includes("name: 'maleImpact'"))
  assert.ok(works.includes("name: 'relationshipClarity'"))
  assert.ok(works.includes("name: 'endingSafety'"))
  assert.ok(works.includes("name: 'creatorSpeechRisk'"))
})

test('detail index type exposes work risk matrix', () => {
  assert.ok(detailTypes.includes('export type WorkRiskMatrix'))
  assert.ok(detailTypes.includes('maleImpact?: string'))
  assert.ok(detailTypes.includes('relationshipClarity?: string'))
  assert.ok(detailTypes.includes('endingSafety?: string'))
  assert.ok(detailTypes.includes('creatorSpeechRisk?: string'))
  assert.ok(detailTypes.includes('riskMatrix?: WorkRiskMatrix'))
})

test('work risk matrix card renders frontend dimensions', () => {
  assert.ok(riskCard.includes('WorkRiskMatrixCard'))
  assert.ok(riskCard.includes("item.collection !== 'works'"))
  assert.ok(riskCard.includes('雷点 / 注意点矩阵'))
  assert.ok(riskCard.includes('男性角色影响'))
  assert.ok(riskCard.includes('恋爱关系明确度'))
  assert.ok(riskCard.includes('结局安全性'))
  assert.ok(riskCard.includes('创作者言论风险'))
  assert.ok(riskCard.includes('暂未填写矩阵'))
})

test('detail page shows risk matrix after conclusion and before basic info', () => {
  assert.ok(detailComponent.includes("import WorkRiskMatrixCard from './WorkRiskMatrixCard'"))
  assert.ok(detailComponent.indexOf('<WorkConclusionCard item={item} relatedEvidence={relatedEvidence} />') < detailComponent.indexOf('<WorkRiskMatrixCard item={item} />'))
  assert.ok(detailComponent.indexOf('<WorkRiskMatrixCard item={item} />') < detailComponent.indexOf('<BasicInfo item={item} />'))
})

test('risk matrix styles are loaded', () => {
  assert.ok(layout.includes("import './work-risk-matrix.css'"))
  assert.ok(css.includes('.work-risk-matrix-card'))
  assert.ok(css.includes('.work-risk-matrix-grid'))
  assert.ok(css.includes('.work-risk-matrix-item'))
  assert.ok(css.includes("[data-theme='light'] .work-risk-matrix-item"))
})

test('detail index enrichment preserves and fetches risk matrix', () => {
  assert.ok(enrichDetail.includes('riskMatrix: item.riskMatrix'))
  assert.ok(enrichDetail.includes('riskMatrix: searchItem.riskMatrix || detailItem.riskMatrix'))
  assert.ok(enrichRisk.includes('function riskMatrix'))
  assert.ok(enrichRisk.includes('/api/works'))
  assert.ok(enrichRisk.includes('matrixById.set'))
  assert.ok(wrapper.includes('enrich-lite-risk-matrix.mjs'))
})
