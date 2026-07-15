import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  V06_PLAN_VERSION,
  buildIndexes,
  dryRunBatchPlans,
  summarizeDryRunResults,
  validateBatchManifest,
} from '../scripts/radar/lib/v06-payload-dryrun-v01.mjs'
import { buildPlanRow } from '../scripts/radar/lib/payload-plan-v01.mjs'
import { jsonlText, sha256File } from '../scripts/radar/lib/v06-package-import-v01.mjs'

const fixtureRoot = 'data_local/staging/ai-radar/test-v06-payload-dryrun-v01'

function assessment(overrides = {}) {
  return {
    workId: '1',
    siteId: 'WORK-1',
    title: '测试作品',
    assessmentBatch: 'RADAR-ASSESS-0001',
    policyVersion: 'radar-rating-policy-v0.6-generalized-dryrun',
    currentGradeSuggestion: 'A',
    confidencePercent: 90,
    evidenceCoveragePercent: 80,
    evidenceStatus: 'single_secondary_supported',
    sourceSummary: '一个可追溯来源支持当前判断。',
    sourceCount: 1,
    decisiveRule: {
      code: 'A-ONGOING',
      grade: 'A',
      reason: '关系走向稳定。',
    },
    matchedRules: [{ code: 'A-ONGOING', grade: 'A', confidencePercent: 90, reason: '关系走向稳定。' }],
    contradictions: [],
    blockers: [],
    warnings: [],
    writeProtection: { protected: false, reasons: [] },
    requiresHumanReview: true,
    assessedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  }
}

function work(overrides = {}) {
  return {
    id: '1',
    siteId: 'WORK-1',
    title: '测试作品',
    rank: 'D',
    ratingNotice: null,
    reviewStatus: 'pending',
    reviewReasons: [],
    evidenceStrength: 'weak',
    radarAssessment: null,
    humanVerified: false,
    locked: false,
    ...overrides,
  }
}

test.beforeEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
  fs.mkdirSync(fixtureRoot, { recursive: true })
})

test.after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
})

test('validates exact batch plan hashes and row accounting', () => {
  const planFile = path.join(fixtureRoot, 'payload-plan.jsonl')
  fs.writeFileSync(planFile, jsonlText([{ workId: '1' }, { workId: '2' }]), 'utf8')
  const manifest = {
    version: V06_PLAN_VERSION,
    batches: [{
      batchId: 'RADAR-ASSESS-0001',
      rows: 2,
      planFile,
      planSha256: sha256File(planFile),
    }],
  }

  const result = validateBatchManifest(manifest, { expectedBatches: 1, expectedRows: 2 })
  assert.deepEqual(result.blockers, [])
  assert.equal(result.rows, 2)
  assert.equal(result.batches.length, 1)
})

test('detects a changed plan after manifest generation', () => {
  const planFile = path.join(fixtureRoot, 'payload-plan.jsonl')
  fs.writeFileSync(planFile, jsonlText([{ workId: '1' }]), 'utf8')
  const originalHash = sha256File(planFile)
  fs.appendFileSync(planFile, JSON.stringify({ workId: '2' }) + '\n', 'utf8')

  const result = validateBatchManifest({
    version: V06_PLAN_VERSION,
    batches: [{ batchId: 'RADAR-ASSESS-0001', rows: 1, planFile, planSha256: originalHash }],
  }, { expectedBatches: 1, expectedRows: 1 })

  assert.ok(result.blockers.includes('plan_sha256_mismatch:RADAR-ASSESS-0001'))
  assert.ok(result.blockers.includes('batch_row_count_mismatch:RADAR-ASSESS-0001'))
})

test('dry-runs ready rows while retaining planning blockers', () => {
  const currentWork = work()
  const readyPlan = buildPlanRow(assessment(), buildIndexes([currentWork]), {
    assessedAt: '2026-07-14T00:00:00.000Z',
  })
  assert.equal(readyPlan.planStatus, 'ready_for_payload_dry_run')

  const blockedPlan = {
    workId: '2',
    siteId: 'WORK-2',
    title: '资料不足作品',
    assessmentBatch: 'RADAR-ASSESS-0001',
    planStatus: 'blocked',
    blockers: ['multiple_secondary_requires_two_traceable_sources'],
    warnings: [],
  }

  const results = dryRunBatchPlans([readyPlan, blockedPlan], buildIndexes([currentWork]))
  const summary = summarizeDryRunResults(results)
  assert.equal(summary.wouldUpdate, 1)
  assert.equal(summary.blocked, 1)
  assert.equal(summary.alreadyCurrent, 0)
  assert.equal(summary.byBlocker.multiple_secondary_requires_two_traceable_sources, 1)
})

test('blocks a ready plan when the Payload snapshot changed after planning', () => {
  const original = work()
  const readyPlan = buildPlanRow(assessment(), buildIndexes([original]), {
    assessedAt: '2026-07-14T00:00:00.000Z',
  })
  const changed = work({ rank: 'B' })
  const [result] = dryRunBatchPlans([readyPlan], buildIndexes([changed]))

  assert.equal(result.status, 'blocked')
  assert.ok(result.blockers.includes('stale_payload_snapshot_since_plan'))
})

test('generalized dry-run command has no Payload PATCH path', () => {
  const source = fs.readFileSync('scripts/radar/run-ai-radar-v06-payload-dryruns-v01.mjs', 'utf8')
  assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/u)
  assert.match(source, /Execute\/apply\/write flags are rejected/u)
  assert.match(source, /payloadPatchRequests:\s*0/u)
})

test('recognizes Payload-generated array row ids as already current', () => {
  const original = work()
  const readyPlan = buildPlanRow(
    assessment(),
    buildIndexes([original]),
    {
      assessedAt: '2026-07-14T00:00:00.000Z',
    },
  )

  const applied = work({
    ...readyPlan.patch,
    radarAssessment: {
      ...readyPlan.patch.radarAssessment,
      matchedRules:
        readyPlan.patch.radarAssessment.matchedRules.map(
          (rule, index) => ({
            id: `payload-generated-${index}`,
            ...rule,
          }),
        ),
    },
  })

  const [result] = dryRunBatchPlans(
    [readyPlan],
    buildIndexes([applied]),
  )

  assert.equal(result.status, 'already_current')
  assert.deepEqual(result.remainingChangedFields, [])
  assert.equal(
    result.blockers.includes('stale_payload_snapshot_since_plan'),
    false,
  )
})
