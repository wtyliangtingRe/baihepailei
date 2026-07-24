import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ASSESSMENT_BATCH,
  CURATED,
  baseDecision,
  buildResolvedSnapshot,
  humanTrackRecorded,
  liveGuard,
} from '../scripts/radar/build-radar-remaining-closeout-phase2-v01.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-remaining-closeout-phase2-v01.ps1')

function phase1(overrides = {}) {
  return {
    workId: '1',
    phase1Status: 'phase1_ready_for_guard_or_assembly_review',
    sourceResolution: { independentProviderCountAfter: 2 },
    sourceSummaryResolution: { reconstructed: false, proposedSourceSummary: '' },
    ...overrides,
  }
}
function ledger(overrides = {}) {
  return {
    selectedCandidate: {
      candidateSha256: 'a'.repeat(64),
      grade: 'B',
      snapshot: {
        assessedAt: '2026-01-01T00:00:00Z',
        assessmentBatch: 'OLD',
        confidencePercent: 70,
        evidenceCoveragePercent: 60,
        evidenceStatus: 'multiple_secondary_supported',
        sourceSummary: 'Existing summary',
        policyVersion: 'radar-rating-policy-v0.6-generalized-dryrun',
        suggestedGrade: 'B',
        decisiveRuleCode: 'B-LIGHT',
        decisiveRuleReason: 'Reason',
        matchedRules: [{ code: 'B-LIGHT', grade: 'B', confidencePercent: 70, reason: 'Reason' }],
        sourceCount: 2,
        contradictions: [],
        requiresHumanReview: true,
      },
    },
    ...overrides,
  }
}

test('curated closeout covers 18 rows with 17 AI conclusions and one noncanonical exemption', () => {
  assert.equal(Object.keys(CURATED).length, 18)
  assert.equal(Object.values(CURATED).filter((item) => item.outcome === 'ready_for_unified_incremental_assembly').length, 17)
  assert.equal(Object.values(CURATED).filter((item) => item.coverageExemptNoncanonical === true).length, 1)
  assert.deepEqual(
    Object.entries(CURATED).filter(([, item]) => item.freshOverride).map(([id]) => id).sort(),
    ['31143', '31588', '31692', '32094', '32186', '33699'],
  )
})

test('phase1 source shortage still produces an explicit uncertain AI conclusion', () => {
  const result = baseDecision(phase1({ phase1Status: 'phase1_requires_additional_source' }))
  assert.equal(result.outcome, 'ready_for_unified_incremental_assembly')
  assert.equal(result.code, 'single_provider_ai_conclusion_required_by_coverage_policy')
})

test('live identity guard never lets human or display state suppress the AI track', () => {
  const passed = liveGuard({
    workId: '1',
    siteId: 'SITE-1',
    draftWork: {
      id: 1,
      siteId: 'SITE-1',
      humanAssessment: { grade: 'A', status: 'verified' },
    },
    publishedWork: {
      id: 1,
      siteId: 'SITE-1',
      catalogStatus: 'archived',
      _status: 'draft',
      isLiteVisible: false,
      isFullVisible: false,
    },
    currentPublic: null,
  })
  assert.equal(passed.passed, true)
  assert.equal(passed.draft.humanTrackRecorded, true)
  assert.equal(passed.draft.humanTrackAffectsAIStorage, false)
  assert.equal(passed.displayState.surfacedByWorkVisibility, false)
  assert.deepEqual(passed.blockers, [])

  const identityBlocked = liveGuard({
    workId: '1',
    siteId: 'SITE-1',
    draftWork: { id: 2, siteId: 'SITE-1' },
    publishedWork: { id: 1, siteId: 'WRONG' },
    currentPublic: null,
  })
  assert.equal(identityBlocked.passed, false)
  assert.ok(identityBlocked.blockers.includes('draft_work_id_mismatch'))
  assert.ok(identityBlocked.blockers.includes('published_site_id_mismatch'))
})
test('human track pending is not recorded but grade or verified status is recorded', () => {
  assert.equal(humanTrackRecorded({ humanAssessment: { status: 'pending' } }), false)
  assert.equal(humanTrackRecorded({ humanAssessment: { grade: 'B', status: 'pending' } }), true)
  assert.equal(humanTrackRecorded({ humanAssessment: { status: 'verified' } }), true)
})

test('reconstructed summary changes no grade or decisive rule', () => {
  const result = buildResolvedSnapshot({
    phase1Row: phase1({ sourceSummaryResolution: { reconstructed: true, proposedSourceSummary: 'New summary' } }),
    ledgerRow: ledger(),
    generatedAt: '2026-07-24T00:00:00Z',
    curated: null,
  })
  assert.equal(result.suggestedGrade, 'B')
  assert.equal(result.decisiveRuleCode, 'B-LIGHT')
  assert.equal(result.sourceSummary, 'New summary')
  assert.equal(result.assessmentBatch, ASSESSMENT_BATCH)
})

test('single-provider evidence creates a reviewable AI conclusion without grade mutation', () => {
  const result = buildResolvedSnapshot({
    phase1Row: phase1({
      phase1Status: 'phase1_requires_additional_source',
      sourceResolution: { independentProviderCountAfter: 1 },
    }),
    ledgerRow: ledger(),
    generatedAt: '2026-07-24T00:00:00Z',
    curated: null,
  })
  assert.equal(result.suggestedGrade, 'B')
  assert.equal(result.decisiveRuleCode, 'B-LIGHT')
  assert.equal(result.sourceCount, 1)
  assert.equal(result.evidenceStatus, 'single_traceable_source_ai_conclusion')
  assert.equal(result.requiresHumanReview, true)
  assert.ok(result.confidencePercent <= 65)
})

test('fresh canonical Strain override creates one complete D snapshot', () => {
  const result = buildResolvedSnapshot({
    phase1Row: phase1({ workId: '32094' }),
    ledgerRow: ledger(),
    generatedAt: '2026-07-24T00:00:00Z',
    curated: CURATED['32094'],
  })
  assert.equal(result.suggestedGrade, 'D')
  assert.equal(result.decisiveRuleCode, 'D-GENERAL')
  assert.equal(result.matchedRules.length, 1)
  assert.equal(result.matchedRules[0].grade, 'D')
})

test('runner uses one-time read-only token and has no production mutation mode', () => {
  const runner = fs.readFileSync(runnerPath, 'utf8')
  assert.match(runner, /RADAR_READONLY_AUDIT_TOKEN/u)
  assert.match(runner, /default_transaction_read_only=on/u)
  assert.match(runner, /PAYLOAD_DB_PUSH = 'false'/u)
  assert.doesNotMatch(runner, /-Method\s+(Patch|Put|Delete)|production-apply\.sql|execute-production/iu)
  assert.match(runner, /ProductionApplyAuthorized\s+: False/u)
  assert.match(runner, /phase2-failure-receipt\.json/u)
  assert.match(runner, /HumanTrackBlocksAIConclusion\s+: False/u)
})

test('fetcher is sequential, retrying, and emits page progress', () => {
  const builder = fs.readFileSync(path.join(root, 'scripts/radar/build-radar-remaining-closeout-phase2-v01.mjs'), 'utf8')
  assert.match(builder, /retries = 6/u)
  assert.match(builder, /Reading draft Works sequentially/u)
  assert.doesNotMatch(builder, /Promise\.all\(\[\s*fetchCollection/u)
  assert.match(builder, /after \$\{attempt \+ 1\} attempt\(s\)/u)
})

test('phase2 documentation separates AI coverage from completed multilingual deep-dive research', () => {
  const guide = fs.readFileSync(
    path.join(root, 'docs/guides/radar-remaining-1122-phase2-live-guard-closeout-v01.md'),
    'utf8',
  )
  assert.match(guide, /Research-completeness boundary/u)
  assert.match(guide, /bootstrap AI conclusions/u)
  assert.match(guide, /radar-work-level-multilingual-research-policy-v01\.md/u)
  assert.match(guide, /must not be described as proof that deep-dive research is\s+complete/u)
})

test('runner permits the installed multilingual research policy document during the same hotfix run', () => {
  const runner = fs.readFileSync(runnerPath, 'utf8')
  assert.match(
    runner,
    /docs\/guides\/radar-work-level-multilingual-research-policy-v01\.md/u,
  )
})
