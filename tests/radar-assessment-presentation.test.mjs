import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path) {
  return readFileSync(path, 'utf8')
}

test('Payload registers optional radar assessment metrics on works', () => {
  const fields = source('src/collections/fields/radarAssessment.ts')
  const config = source('payload.config.ts')

  assert.match(fields, /name: 'radarAssessment'/u)
  assert.match(fields, /name: 'confidencePercent'/u)
  assert.match(fields, /name: 'evidenceCoveragePercent'/u)
  assert.match(fields, /name: 'evidenceStatus'/u)
  assert.match(fields, /name: 'sourceSummary'/u)
  assert.match(fields, /name: 'policyVersion'/u)
  assert.match(fields, /name: 'assessedAt'/u)
  assert.match(fields, /min: 0/u)
  assert.match(fields, /max: 100/u)
  assert.match(fields, /value: 'conflicting_evidence'/u)
  assert.match(fields, /value: 'insufficient_evidence'/u)
  assert.match(config, /withRadarAssessmentFields\(Works\)/u)
  assert.match(config, /WorksWithRadarAssessment/u)
})

test('lite export keeps rating notice and radar assessment metrics', () => {
  const exporter = source('scripts/export/enrich-lite-review-fields.mjs')

  assert.match(exporter, /ratingNotice: doc\.ratingNotice/u)
  assert.match(exporter, /radarAssessment: normalizeRadarAssessment\(doc\.radarAssessment\)/u)
  assert.match(exporter, /confidencePercent/u)
  assert.match(exporter, /evidenceCoveragePercent/u)
  assert.match(exporter, /sourceSummary/u)
})

test('work pages show confidence before the risk matrix with careful wording', () => {
  const wrapper = source('src/app/(frontend)/_components/WorkRiskMatrixCard.tsx')
  const card = source('src/app/(frontend)/_components/WorkAssessmentTrustCard.tsx')
  const layout = source('src/app/(frontend)/layout.tsx')

  assert.ok(wrapper.indexOf('<WorkAssessmentTrustCard') < wrapper.indexOf('work-risk-matrix-card'))
  assert.match(card, /排雷可信度/u)
  assert.match(card, /判断置信度/u)
  assert.match(card, /资料覆盖度/u)
  assert.match(card, /不等同于作品安全概率/u)
  assert.match(card, /<progress/u)
  assert.match(card, /查看来源摘要/u)
  assert.match(layout, /work-assessment-trust\.css/u)
})

test('presentation helper handles evidence and review states explicitly', () => {
  const presentation = source('src/lib/radar/assessmentPresentation.ts')

  assert.match(presentation, /official_confirmed: '官方材料确认'/u)
  assert.match(presentation, /multiple_secondary_supported: '多个来源支持'/u)
  assert.match(presentation, /conflicting_evidence: '来源存在冲突'/u)
  assert.match(presentation, /ai_synthesized_pending_review: 'AI 综合，待复核'/u)
  assert.match(presentation, /manual_reviewed: '人工已确认'/u)
  assert.match(presentation, /Math\.min\(100, Math\.max\(0/u)
})
