import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  approvalTokenFor,
  changedFieldsAgainstCurrent,
  payloadComparable,
  rollbackPatchFor,
  sha256Buffer,
  validateApplyPlanRow,
  validateCheckpoint,
  validateDryRunSummary,
  validateExecutionGate,
} from '../scripts/radar/lib/payload-apply-v01.mjs'
import { currentStateOf, snapshotHash } from '../scripts/radar/lib/payload-plan-v01.mjs'

function work(overrides = {}) {
  return {
    id: '42',
    siteId: 'work:test-42',
    title: '测试作品',
    rank: 'unknown',
    reviewStatus: 'pending',
    reviewReasons: [],
    ratingNotice: 'insufficient_information',
    evidenceStrength: 'weak',
    ...overrides,
  }
}

function plan(overrides = {}) {
  const beforeWork = work()
  const expectedBefore = currentStateOf(beforeWork)
  return {
    version: 'ai-radar-payload-patch-plan-v0.1',
    action: 'update_existing_work_radar_assessment',
    workId: '42',
    siteId: 'work:test-42',
    title: '测试作品',
    target: { id: '42', siteId: 'work:test-42', title: '测试作品' },
    planStatus: 'ready_for_payload_dry_run',
    blockers: [],
    expectedBefore,
    expectedBeforeHash: snapshotHash(expectedBefore),
    changedFields: ['rank', 'ratingNotice', 'reviewReasons', 'evidenceStrength', 'radarAssessment'],
    patch: {
      rank: 'B',
      ratingNotice: 'ai_synthesized_pending_review',
      reviewStatus: 'pending',
      reviewReasons: ['radar_seed_attached'],
      evidenceStrength: 'medium',
      radarAssessment: {
        confidencePercent: 82,
        evidenceCoveragePercent: 65,
        evidenceStatus: 'single_secondary_supported',
        sourceCount: 1,
        sourceSummary: '当前有一个可追溯来源。',
        policyVersion: 'radar-rating-policy-v0.4-draft',
        suggestedGrade: 'B',
        matchedRules: [{ code: 'B-LIGHT', grade: 'B', confidencePercent: 82, reason: '测试' }],
        contradictions: [],
        requiresHumanReview: true,
      },
    },
    ...overrides,
  }
}

function createCheckpoint({
  includesDatabase = true,
  state = 'complete',
  createdAt = new Date().toISOString(),
  commit = 'abc123',
  branch = 'wm-ai-radar-payload-apply-v01',
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-checkpoint-'))
  const dumpName = 'payload-postgresql.dump'
  fs.writeFileSync(path.join(dir, dumpName), 'database-backup', 'utf8')
  fs.writeFileSync(path.join(dir, 'checkpoint-manifest.json'), JSON.stringify({
    createdAt,
    checkpointName: 'test-checkpoint',
    branch,
    commit,
    includesWorkspace: true,
    includesGitBundle: true,
    includesDatabase,
    databaseDump: includesDatabase ? dumpName : null,
  }), 'utf8')
  fs.writeFileSync(path.join(dir, 'checkpoint-status.json'), JSON.stringify({ state }), 'utf8')
  fs.writeFileSync(path.join(dir, 'sha256-checksums.csv'), `RelativePath,Length,SHA256\n${dumpName},15,TEST\n`, 'utf8')
  return dir
}

test('approval token is deterministic and tied to the exact plan hash', () => {
  const hash = sha256Buffer('reviewed-plan')
  assert.equal(approvalTokenFor(hash), `APPLY-AI-RADAR-FIRST-100-V01-${hash.slice(0, 16).toUpperCase()}`)
  assert.notEqual(approvalTokenFor(hash), approvalTokenFor(sha256Buffer('different-plan')))
})

test('database checkpoint must be complete, current and commit-bound', () => {
  const dir = createCheckpoint()
  const result = validateCheckpoint(dir, {
    currentCommit: 'abc123',
    currentBranch: 'wm-ai-radar-payload-apply-v01',
    now: Date.now(),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.blockers, [])
})

test('checkpoint without a database dump is rejected', () => {
  const dir = createCheckpoint({ includesDatabase: false })
  const result = validateCheckpoint(dir, { currentCommit: 'abc123', currentBranch: 'wm-ai-radar-payload-apply-v01' })
  assert.equal(result.ok, false)
  assert.ok(result.blockers.includes('checkpoint_database_not_included'))
})

test('stale checkpoint is rejected', () => {
  const dir = createCheckpoint({ createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() })
  const result = validateCheckpoint(dir, {
    currentCommit: 'abc123',
    currentBranch: 'wm-ai-radar-payload-apply-v01',
    now: Date.now(),
    maxAgeHours: 24,
  })
  assert.ok(result.blockers.includes('checkpoint_too_old'))
})

test('honest source status is required by apply plan validation', () => {
  assert.deepEqual(validateApplyPlanRow(plan()), [])
  const invalid = plan({
    patch: {
      ...plan().patch,
      radarAssessment: {
        ...plan().patch.radarAssessment,
        evidenceStatus: 'multiple_secondary_supported',
        sourceCount: 1,
      },
    },
  })
  assert.ok(validateApplyPlanRow(invalid).includes('multiple_secondary_requires_two_traceable_sources'))
})

test('dry-run summary must contain the exact plan SHA-256', () => {
  const hash = sha256Buffer('plan')
  const summary = {
    version: 'ai-radar-payload-patch-dryrun-v0.1',
    inputSha256: hash,
    planRowsRead: 100,
    wouldUpdate: 94,
    blocked: 6,
    alreadyCurrent: 0,
    safety: { payloadWrite: false, payloadPatchRequests: 0 },
  }
  assert.deepEqual(validateDryRunSummary(summary, { planHash: hash }), [])
  assert.ok(validateDryRunSummary(summary, { planHash: sha256Buffer('changed') }).includes('dryrun_plan_hash_mismatch'))
})

test('execution gate requires enablement, provenance review and exact approval token', () => {
  const gate = {
    writeEnabled: true,
    approvalToken: 'TOKEN',
    requirements: { sourceProvenanceAuditReviewed: true },
  }
  assert.deepEqual(validateExecutionGate(gate, 'TOKEN'), [])
  assert.ok(validateExecutionGate({ ...gate, writeEnabled: false }, 'TOKEN').includes('release_gate_write_disabled'))
  assert.ok(validateExecutionGate(gate, 'WRONG').includes('release_gate_approval_token_mismatch'))
})

test('rollback plan explicitly clears a newly-added radarAssessment group', () => {
  const rollback = rollbackPatchFor(plan(), ['radarAssessment', 'rank'])
  assert.equal(rollback.radarAssessment, null)
  assert.equal(rollback.rank, 'unknown')
})

test('Payload-generated array row ids do not create a false post-patch mismatch', () => {
  const p = plan()
  const current = work({
    rank: 'B',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['radar_seed_attached'],
    evidenceStrength: 'medium',
    radarAssessment: {
      ...p.patch.radarAssessment,
      matchedRules: [{ id: 'generated-row-id', ...p.patch.radarAssessment.matchedRules[0] }],
    },
  })
  assert.deepEqual(changedFieldsAgainstCurrent(current, p), [])
  assert.equal('id' in payloadComparable(current.radarAssessment.matchedRules[0]), false)
})
