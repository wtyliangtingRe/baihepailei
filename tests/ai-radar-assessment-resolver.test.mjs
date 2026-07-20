import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  RADAR_POLICY_ID,
  RADAR_RULES,
} from '../scripts/radar/lib/radar-policy-v04.mjs'
import { resolveRadarAssessment } from '../scripts/radar/lib/resolve-radar-assessment-v01.mjs'

test('policy registry contains the complete v0.4 rule set', () => {
  assert.equal(RADAR_POLICY_ID, 'radar-rating-policy-v0.4-draft')
  assert.equal(RADAR_RULES.length, 55)
  assert.equal(RADAR_RULES.find((rule) => rule.code === 'C-FUTURE-HET-HINT')?.grade, 'D')
  assert.equal(RADAR_RULES.find((rule) => rule.code === 'D-ABO')?.grade, 'E')
})

test('script policy codes and grades stay aligned with the frontend policy', () => {
  const source = fs.readFileSync('src/lib/radar/ratingPolicy.ts', 'utf8')
  const frontendRules = new Map()
  for (const match of source.matchAll(/^\s+'([^']+)': \{ grade: '([SABCDEXF])'/gmu)) {
    frontendRules.set(match[1], match[2])
  }

  assert.equal(frontendRules.size, RADAR_RULES.length)
  for (const rule of RADAR_RULES) {
    assert.equal(frontendRules.get(rule.code), rule.grade, `Policy drift for ${rule.code}`)
  }
})

test('lower safety grade overrides positive matches while preserving every match', () => {
  const result = resolveRadarAssessment({
    workId: 'work-1',
    title: 'Example',
    evidenceCoverage: 0.9,
    evidenceStatus: 'multiple_secondary_supported',
    ruleAssessments: [
      {
        code: 'A-NEAR-CONFIRMED',
        matched: true,
        confidence: 92,
        reason: 'Female relationship is nearly confirmed.',
        sources: ['source-a'],
      },
      {
        code: 'F-MALE-NTR',
        matched: true,
        confidence: 81,
        reason: 'A male NTR event is reported.',
        sources: ['source-b'],
      },
    ],
  })

  assert.equal(result.currentGradeSuggestion, 'F')
  assert.equal(result.decisiveRule.code, 'F-MALE-NTR')
  assert.deepEqual(result.matchedRules.map((item) => item.code), ['F-MALE-NTR', 'A-NEAR-CONFIRMED'])
  assert.equal(result.pageNotice.id, 'ai-synthesized-pending-review')
})

test('AI source summary and batch provenance survive rule resolution', () => {
  const result = resolveRadarAssessment({
    workId: 'work-provenance',
    siteId: 'work:provenance',
    title: '来源保留测试',
    assessmentBatch: 'local:batch-1',
    assessedAt: '2026-07-20T00:00:00.000Z',
    evidenceCoverage: 0.7,
    evidenceStatus: 'single_secondary_supported',
    sourceSummary: '一个可追溯来源支持当前判断。',
    sourceCount: 1,
    ruleAssessments: [{
      code: 'B-LIGHT',
      matched: true,
      confidence: 0.8,
      reason: '恋爱未明确。',
      sources: [{ label: '资料页', url: 'https://example.test/work' }],
    }],
  })
  assert.equal(result.sourceSummary, '一个可追溯来源支持当前判断。')
  assert.equal(result.sourceCount, 1)
  assert.equal(result.assessmentBatch, 'local:batch-1')
  assert.equal(result.assessedAt, '2026-07-20T00:00:00.000Z')
})

test('missing effective matches falls back to D-UNCLEAR', () => {
  const result = resolveRadarAssessment({
    workId: 'work-2',
    title: 'Unknown work',
    evidenceCoverage: 0.02,
    evidenceStatus: 'unknown',
    ruleAssessments: [],
  })

  assert.equal(result.currentGradeSuggestion, 'D')
  assert.equal(result.decisiveRule.code, 'D-UNCLEAR')
  assert.equal(result.confidencePercent, 95)
  assert.ok(result.warnings.includes('no_effective_rule_match_fell_back_to_d_unclear'))
})

test('weak positive evidence cannot promote a work to S or A', () => {
  const result = resolveRadarAssessment({
    workId: 'work-3',
    title: 'Sparse positive work',
    evidenceCoverage: 0.1,
    evidenceStatus: 'inferred_from_metadata',
    ruleAssessments: [
      {
        code: 'S-MARRIAGE',
        matched: true,
        confidence: 0.8,
        reason: 'A platform tag implies marriage.',
      },
    ],
  })

  assert.equal(result.currentGradeSuggestion, 'D')
  assert.equal(result.decisiveRule.code, 'D-UNCLEAR')
  assert.ok(result.warnings.includes('positive_grade_blocked_by_insufficient_evidence_coverage'))
})

test('X suggestions are retained but blocked for human adjudication', () => {
  const result = resolveRadarAssessment({
    workId: 'work-4',
    title: 'High risk work',
    evidenceCoverage: 0.9,
    evidenceStatus: 'official_confirmed',
    ruleAssessments: [
      {
        code: 'X-REPEATED-BAIT',
        matched: true,
        confidence: 0.96,
        reason: 'Repeated official misdirection is documented.',
        sources: ['official archive'],
      },
    ],
  })

  assert.equal(result.currentGradeSuggestion, 'X')
  assert.equal(result.planStatus, 'blocked_or_human_review_required')
  assert.ok(result.blockers.includes('x_grade_requires_human_adjudication'))
  assert.equal(result.safety.autoAssignsX, false)
})

test('human-reviewed work remains write protected', () => {
  const result = resolveRadarAssessment({
    workId: 'work-5',
    title: 'Reviewed work',
    evidenceCoverage: 0.8,
    evidenceStatus: 'primary_material_confirmed',
    existingState: { ratingNotice: 'manual_reviewed' },
    ruleAssessments: [
      {
        code: 'B-LIGHT',
        matched: true,
        confidence: 0.9,
        reason: 'Relationship remains unconfirmed.',
        sources: ['primary material'],
      },
    ],
  })

  assert.equal(result.writeProtection.protected, true)
  assert.ok(result.blockers.includes('write_protected:manual_rating_notice'))
  assert.equal(result.planStatus, 'blocked_or_human_review_required')
})
