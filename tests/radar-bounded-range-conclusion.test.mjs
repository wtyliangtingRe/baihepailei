import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  ACCELERATED_RADAR_AI_REVIEW_TAG as TAG,
  RADAR_AI_PENDING_DATABASE_STATUS as DB_STATUS,
  RADAR_AI_PENDING_WARNING_TEMPLATE_ID as WARNING_ID,
  normalizeRadarConclusion as normalize,
  normalizeRadarDatabaseStatus,
  normalizeRadarWarningTemplateId,
} from '../src/lib/radar/conclusionNormalizer.mjs'
import { auditRadarPublicRatingConclusions as audit } from '../scripts/radar/audit-radar-public-rating-conclusions-v01.mjs'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('fixed B/B/B', () => {
  const x = normalize({ coreGrade: 'B', bestGrade: 'B', likelyGrade: 'B', worstGrade: 'B', requiresHumanReview: false })
  assert.deepEqual([x.conclusionMode, x.fixedGrade, x.display, x.needsPendingTag], ['fixed_grade', 'B', 'B', false])
})

test('bounded C/D/E never becomes fixed D', () => {
  const x = normalize({ coreGrade: 'D', bestGrade: 'C', likelyGrade: 'D', worstGrade: 'E' })
  assert.deepEqual([x.conclusionMode, x.fixedGrade, x.suggestedGrade, x.display, x.likelyLabel], ['bounded_range', '', '', 'C ～ E', '最可能 D'])
})

test('malformed range is labels_only', () => {
  const x = normalize({ bestGrade: 'C', likelyGrade: 'E', worstGrade: 'D' })
  assert.equal(x.conclusionMode, 'labels_only')
  assert.deepEqual(x.validationIssues, ['range_order_invalid'])
})

test('D-UNCLEAR is classification, not conclusion mode', () => {
  const x = normalize({ bestGrade: 'C', likelyGrade: 'D', worstGrade: 'E', classificationRule: 'D-UNCLEAR' })
  assert.equal(x.conclusionMode, 'bounded_range')
  assert.ok(x.classificationLabels.includes('D-UNCLEAR'))
})

test('pending aliases map to canonical contract', () => {
  assert.equal(normalizeRadarDatabaseStatus('ai-synthesized-pending-review'), DB_STATUS)
  assert.equal(normalizeRadarWarningTemplateId('ai_synthesized_pending_review'), WARNING_ID)
  const x = normalize({ bestGrade: 'C', likelyGrade: 'D', worstGrade: 'E' })
  assert.deepEqual(x.publicTags[0], TAG)
})

test('complete reviewed fixed grade is not blanket pending', () => {
  const x = normalize({ bestGrade: 'A', likelyGrade: 'A', worstGrade: 'A', requiresHumanReview: false, evidenceStatus: 'primary_material_confirmed' })
  assert.equal(x.needsPendingTag, false)
  assert.equal(x.publicTags.length, 0)
})

test('fixture audit covers requested buckets', () => {
  const input = JSON.parse(read('fixtures/radar-public-rating-conclusion-audit-v01.input.json'))
  const expected = JSON.parse(read('fixtures/radar-public-rating-conclusion-audit-v01.report.json'))
  const actual = audit(input.records)
  assert.deepEqual(actual, expected)
  assert.deepEqual({ fixed: actual.fixedRanges, bounded: actual.trueBoundedRanges, malformed: actual.malformedRanges, mismatch: actual.coreLikelyMismatch, unclear: actual.dUnclearBoundedRange }, { fixed: 2, bounded: 2, malformed: 2, mismatch: 2, unclear: 1 })
})

test('bridge/UI preserve human priority and split fixed from bounded', () => {
  const bridge = read('src/app/(frontend)/_lib/radar-public-rating-bridge.ts')
  const card = read('src/app/(frontend)/_components/WorkAssessmentTrustCard.tsx')
  assert.match(bridge, /suggestedGrade: conclusion\.fixedGrade \|\| undefined/u)
  assert.doesNotMatch(bridge, /coreGrade\)[\s\S]*\|\|[\s\S]*likelyGrade/u)
  assert.doesNotMatch(bridge, /payload\.(create|update|delete)/u)
  assert.match(card, /const catalogGrade = humanGrade \|\| fixedAIGrade \|\| fallbackRecordedGrade/u)
  assert.match(card, /AI 暂定评级范围/u)
  assert.match(card, /最可能等级不是固定等级/u)
  assert.match(card, /AI 暂定等级/u)
  assert.match(card, /补充资料 \/ 提交纠错/u)
})

test('auditor is file-only', () => {
  const source = read('scripts/radar/audit-radar-public-rating-conclusions-v01.mjs')
  assert.doesNotMatch(source, /@payload-config|getPayload|postgres|DATABASE_URI|payload\.(create|update|delete)/u)
  assert.match(source, /readOnly: true/u)
})
