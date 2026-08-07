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

const { buildRadarAssessmentPresentation } = await import('../src/lib/radar/assessmentPresentation.ts')
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('fixed B/B/B', () => {
  const x = normalize({ coreGrade: 'B', bestGrade: 'B', likelyGrade: 'B', worstGrade: 'B', requiresHumanReview: false })
  assert.deepEqual([x.conclusionMode, x.fixedGrade, x.display, x.needsPendingTag], ['fixed_grade', 'B', 'B', false])
})

test('explicit fixed requires all four grades to agree', () => {
  const valid = normalize({ conclusionMode: 'fixed_grade', coreGrade: 'B', bestGrade: 'B', likelyGrade: 'B', worstGrade: 'B' })
  const incomplete = normalize({ conclusionMode: 'fixed_grade', coreGrade: 'B' })
  const conflict = normalize({ conclusionMode: 'fixed_grade', coreGrade: 'B', bestGrade: 'B', likelyGrade: 'B', worstGrade: 'C' })
  assert.deepEqual([valid.conclusionMode, valid.fixedGrade], ['fixed_grade', 'B'])
  assert.equal(incomplete.conclusionMode, 'labels_only')
  assert.ok(incomplete.validationIssues.includes('incomplete_fixed_grade_range'))
  assert.equal(conflict.conclusionMode, 'labels_only')
  assert.ok(conflict.validationIssues.includes('fixed_grade_conflict'))
})

test('bounded C/D/E never becomes fixed D', () => {
  const x = normalize({ coreGrade: 'D', bestGrade: 'C', likelyGrade: 'D', worstGrade: 'E' })
  assert.deepEqual([x.conclusionMode, x.fixedGrade, x.suggestedGrade, x.display, x.likelyLabel], ['bounded_range', '', '', 'C ～ E', '最可能 D'])
})

test('bounded uncertainty does not automatically require human review', () => {
  const x = buildRadarAssessmentPresentation({
    radarAssessment: {
      conclusionMode: 'bounded_range',
      bestGrade: 'C',
      likelyGrade: 'D',
      worstGrade: 'E',
      requiresHumanReview: false,
    },
    ratingNotice: 'ai_synthesized_pending_review',
    reviewStatus: 'pending',
  })
  assert.equal(x.conclusionMode, 'bounded_range')
  assert.equal(x.requiresHumanReview, false)
  assert.ok(x.publicTags.some((tag) => tag.key === TAG.key))
})

test('explicit labels_only never promotes a valid grade', () => {
  const x = normalize({ conclusionMode: 'labels_only', coreGrade: 'A' })
  assert.deepEqual([x.conclusionMode, x.fixedGrade, x.suggestedGrade], ['labels_only', '', ''])
})

test('explicit blocked never promotes a valid grade', () => {
  const x = normalize({ conclusionMode: 'blocked', coreGrade: 'A' })
  assert.deepEqual([x.conclusionMode, x.fixedGrade, x.display], ['blocked', '', '已阻塞'])
})

test('explicit machine X is never rendered as a grade or range', () => {
  const fixed = normalize({ conclusionMode: 'fixed_grade', coreGrade: 'X', bestGrade: 'X', likelyGrade: 'X', worstGrade: 'X' })
  const bounded = normalize({ conclusionMode: 'bounded_range', coreGrade: 'F', bestGrade: 'E', likelyGrade: 'F', worstGrade: 'X' })
  assert.equal(fixed.conclusionMode, 'labels_only')
  assert.equal(fixed.fixedGrade, '')
  assert.ok(fixed.validationIssues.includes('machine_x_not_allowed'))
  assert.equal(bounded.conclusionMode, 'labels_only')
  assert.ok(bounded.validationIssues.includes('machine_x_not_allowed'))
})

test('explicit malformed bounded range degrades to labels_only', () => {
  const x = normalize({ conclusionMode: 'bounded_range', bestGrade: 'B', likelyGrade: 'B', worstGrade: 'B' })
  assert.equal(x.conclusionMode, 'labels_only')
  assert.ok(x.validationIssues.includes('bounded_range_not_distinct'))
})

test('malformed inferred range is labels_only', () => {
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
  assert.match(bridge, /withAuthorityGradeState/u)
  assert.match(bridge, /bestGrade: fixed \|\|/u)
  assert.doesNotMatch(bridge, /\|\| pending/u)
  assert.doesNotMatch(bridge, /payload\.(create|update|delete)/u)
  assert.match(card, /const catalogGrade = humanGrade \|\| publishedCatalogGrade \|\| fallbackRecordedGrade/u)
  assert.match(card, /AI 暂定评级范围/u)
  assert.match(card, /最可能等级不是固定等级/u)
  assert.match(card, /固定 AI 等级/u)
  assert.match(card, /待发布，不进入目录/u)
  assert.match(card, /Research 提议等级只作为研究线索/u)
  assert.match(card, /补充资料 \/ 提交纠错/u)
})

test('auditor is file-only', () => {
  const source = read('scripts/radar/audit-radar-public-rating-conclusions-v01.mjs')
  assert.doesNotMatch(source, /@payload-config|getPayload|postgres|DATABASE_URI|payload\.(create|update|delete)/u)
  assert.match(source, /readOnly: true/u)
})
