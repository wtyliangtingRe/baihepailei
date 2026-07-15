import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildPlanRow, buildWorkIndexes } from '../scripts/radar/lib/payload-plan-v01.mjs'
import {
  V06_BATCH_ARM_CONFIRMATION,
  approvalTokenFor,
  approvalTokenFingerprint,
  buildArmedBatchGate,
  buildDisarmedBatchGate,
  classifyPlanAgainstWork,
  expectedExecuteConfirmation,
  loadReviewedBatch,
  safeBatchId,
  sha256File,
  validateArmedBatchGate,
  validateReadinessForArm,
} from '../scripts/radar/lib/v06-batch-release-v01.mjs'

const ROOT = path.resolve('.')
const scripts = [
  'scripts/radar/prepare-ai-radar-v06-batch-candidate-v01.mjs',
  'scripts/radar/arm-ai-radar-v06-batch-candidate-v01.mjs',
  'scripts/radar/apply-ai-radar-v06-batch-v01.mjs',
  'scripts/radar/run-ai-radar-v06-batch-readiness-v01.mjs',
  'scripts/radar/run-ai-radar-v06-batch-execute-once-v01.mjs',
]

function sampleWork(overrides = {}) {
  return {
    id: '101',
    siteId: 'work-101',
    title: '测试作品',
    rank: 'D',
    ratingNotice: null,
    reviewStatus: 'pending',
    reviewReasons: [],
    evidenceStrength: 'weak',
    radarAssessment: null,
    ...overrides,
  }
}

function samplePlan(work = sampleWork()) {
  const assessment = {
    workId: work.id,
    siteId: work.siteId,
    title: work.title,
    assessmentBatch: 'RADAR-ASSESS-0001',
    policyVersion: 'radar-rating-policy-v0.6-generalized-dryrun',
    currentGradeSuggestion: 'A',
    confidencePercent: 88,
    evidenceCoveragePercent: 80,
    evidenceStatus: 'single_secondary_supported',
    sourceSummary: '可追溯来源确认女性恋爱主线。',
    sourceCount: 1,
    requiresHumanReview: true,
    decisiveRule: { code: 'A-ONGOING', reason: '关系走向稳定。' },
    matchedRules: [{ code: 'A-ONGOING', grade: 'A', confidence: 0.88, reason: '关系走向稳定。' }],
    contradictions: [],
    blockers: [],
    writeProtection: { protected: false, reasons: [] },
  }
  return buildPlanRow(assessment, buildWorkIndexes([work]), { assessedAt: '2026-07-15T00:00:00.000Z' })
}

function manifestFixture(planHash = 'a'.repeat(64)) {
  return {
    version: 'ai-radar-v06-batch-release-candidate-v0.1',
    batchId: 'RADAR-ASSESS-0001',
    candidateId: 'RC-V06-0123456789ABCDEF0123',
    currentBranch: 'test-branch',
    currentCommit: 'test-commit',
    checkpointPath: 'data_local/checkpoint',
    expected: { rows: 250, wouldUpdate: 200, blocked: 50, alreadyCurrent: 0 },
    files: {
      plan: { path: 'data_local/plan.jsonl', sha256: planHash },
      checkpointDump: { path: 'data_local/checkpoint/database.dump', sha256: 'b'.repeat(64) },
    },
    approval: {
      required: true,
      tokenStored: false,
      tokenFingerprintSha256: approvalTokenFingerprint(planHash, 'RADAR-ASSESS-0001'),
      finalApprovalReceived: false,
    },
    safety: { payloadWrite: false, payloadPatchRequests: 0 },
  }
}

test('all v0.6 release scripts parse successfully', () => {
  for (const file of scripts) {
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${file}: ${result.stderr}`)
  }
})

test('batch ids and confirmations are batch-specific', () => {
  assert.equal(safeBatchId('radar-assess-0007'), 'RADAR-ASSESS-0007')
  assert.throws(() => safeBatchId('RADAR-RESEARCH-0001'))
  const manifest = manifestFixture()
  assert.equal(expectedExecuteConfirmation(manifest), 'EXECUTE-RC-V06-0123456789ABCDEF0123-200-PATCHES')
  assert.equal(V06_BATCH_ARM_CONFIRMATION, 'ARM-AI-RADAR-V06-BATCH-LOCAL-GATE-ONLY')
})

test('current Payload state is classified as pending, already applied or drifted', () => {
  const work = sampleWork()
  const plan = samplePlan(work)
  assert.equal(plan.planStatus, 'ready_for_payload_dry_run')
  assert.equal(classifyPlanAgainstWork(plan, work).status, 'pending_original')
  const applied = { ...work, ...plan.patch }
  assert.equal(classifyPlanAgainstWork(plan, applied).status, 'already_applied')
  const drifted = { ...work, rank: 'C' }
  const result = classifyPlanAgainstWork(plan, drifted)
  assert.equal(result.status, 'drifted')
  assert.ok(result.blockers.includes('stale_payload_snapshot'))
})

test('human-reviewed state always turns a candidate row into drift', () => {
  const work = sampleWork()
  const plan = samplePlan(work)
  const result = classifyPlanAgainstWork(plan, { ...work, reviewStatus: 'reviewed' })
  assert.equal(result.status, 'drifted')
  assert.ok(result.blockers.includes('existing_review_status:reviewed'))
})

test('reviewed batch loading verifies plan and dry-run hashes and counts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-v06-release-'))
  const planRoot = path.join(root, 'plan')
  const dryRunRoot = path.join(root, 'dryrun')
  const slug = 'radar-assess-0001'
  const planDir = path.join(planRoot, 'batches', slug)
  const dryDir = path.join(dryRunRoot, 'batches', slug)
  fs.mkdirSync(planDir, { recursive: true })
  fs.mkdirSync(dryDir, { recursive: true })
  const plan = samplePlan()
  const blocked = { ...plan, workId: '102', siteId: 'work-102', planStatus: 'blocked', blockers: ['missing_source_summary'] }
  const planFile = path.join(planDir, 'payload-plan.jsonl')
  fs.writeFileSync(planFile, `${JSON.stringify(plan)}\n${JSON.stringify(blocked)}\n`, 'utf8')
  const planHash = sha256File(planFile)
  fs.writeFileSync(path.join(planDir, 'payload-plan-summary.json'), JSON.stringify({
    batchId: 'RADAR-ASSESS-0001', rows: 2, readyForDryRun: 1, blocked: 1, alreadyCurrent: 0, planFile, planSha256: planHash,
  }), 'utf8')
  fs.writeFileSync(path.join(dryDir, 'payload-dryrun-summary.json'), JSON.stringify({
    version: 'ai-radar-v06-payload-batch-dryrun-v0.1', batchId: 'RADAR-ASSESS-0001', planSha256: planHash,
    planRows: 2, wouldUpdate: 1, blocked: 1, alreadyCurrent: 0,
    safety: { payloadWrite: false, payloadPatchRequests: 0 },
  }), 'utf8')
  const loaded = loadReviewedBatch('RADAR-ASSESS-0001', { planRoot, dryRunRoot })
  assert.deepEqual(loaded.blockers, [])
  assert.equal(loaded.readyPlans.length, 1)
  assert.equal(loaded.blockedPlans.length, 1)
  fs.rmSync(root, { recursive: true, force: true })
})

test('arming requires the exact clean readiness summary', () => {
  const manifest = manifestFixture()
  const manifestHash = 'c'.repeat(64)
  const readiness = {
    version: 'ai-radar-v06-batch-apply-v0.1',
    mode: 'readiness',
    candidateId: manifest.candidateId,
    candidateManifestSha256: manifestHash,
    currentBranch: manifest.currentBranch,
    currentCommit: manifest.currentCommit,
    pendingOriginal: 200,
    alreadyApplied: 0,
    drifted: 0,
    preflightReady: true,
    payloadPatchRequests: 0,
    appliedAndVerified: 0,
    safety: { payloadWrite: false },
  }
  assert.deepEqual(validateReadinessForArm(readiness, manifest, {
    manifestHash,
    currentBranch: manifest.currentBranch,
    currentCommit: manifest.currentCommit,
  }), [])
  assert.ok(validateReadinessForArm({ ...readiness, drifted: 1 }, manifest, {
    manifestHash,
    currentBranch: manifest.currentBranch,
    currentCommit: manifest.currentCommit,
  }).includes('readiness_preflight_not_clean'))
})

test('armed gates bind candidate, checkpoint, readiness, token and expiry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-v06-gate-'))
  const readinessFile = path.join(root, 'readiness.json')
  fs.writeFileSync(readinessFile, '{}', 'utf8')
  const manifest = manifestFixture()
  const planHash = manifest.files.plan.sha256
  const token = approvalTokenFor(planHash, manifest.batchId)
  const gate = buildArmedBatchGate(manifest, {
    manifestHash: 'c'.repeat(64),
    checkpointPath: 'data_local/checkpoint',
    readinessFile,
    readinessHash: sha256File(readinessFile),
    approvalToken: token,
    currentBranch: manifest.currentBranch,
    currentCommit: manifest.currentCommit,
    ttlMinutes: 30,
    now: Date.parse('2026-07-15T00:00:00.000Z'),
  })
  const blockers = validateArmedBatchGate(gate, manifest, {
    manifestHash: 'c'.repeat(64),
    checkpointPath: 'data_local/checkpoint',
    currentBranch: manifest.currentBranch,
    currentCommit: manifest.currentCommit,
    approvalToken: token,
    now: Date.parse('2026-07-15T00:10:00.000Z'),
  })
  assert.deepEqual(blockers, [])
  assert.equal(buildDisarmedBatchGate(manifest).writeEnabled, false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('readiness wrapper rejects execute mode before invoking the engine', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/radar/run-ai-radar-v06-batch-readiness-v01.mjs'), '--execute'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /cannot execute writes/u)
})

test('failed candidate preparation removes stale candidate artifacts', () => {
  const source = fs.readFileSync(
    path.join(
      ROOT,
      'scripts/radar/prepare-ai-radar-v06-batch-candidate-v01.mjs',
    ),
    'utf8',
  )

  assert.match(
    source,
    /fs\.rmSync\(outputs\.manifest, \{ force: true \}\)/u,
  )
  assert.match(
    source,
    /fs\.rmSync\(outputs\.disarmedGate, \{ force: true \}\)/u,
  )
})

test('v0.6 execution persists rollback outcome status after PATCH', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'scripts/radar/apply-ai-radar-v06-batch-v01.mjs'),
    'utf8',
  )

  const intentWrite = source.indexOf(
    'appendJsonl(outputs.rollback, rollback)',
  )
  const patchRequest = source.indexOf(
    'await patchWork(baseUrl, token, targetId, patch)',
  )
  const patchStatus = source.indexOf(
    "status: 'patch_request_completed'",
  )
  const verificationStatus = source.indexOf(
    "status: 'verification_completed'",
  )

  assert.ok(intentWrite >= 0)
  assert.ok(patchRequest > intentWrite)
  assert.ok(patchStatus > patchRequest)
  assert.ok(verificationStatus > patchStatus)

  assert.match(
    source,
    /rollbackStatus: path\.join\(outDir, 'rollback-status\.jsonl'\)/u,
  )
  assert.match(source, /'patch_request_failed'/u)
  assert.match(source, /'patch_failed_or_unverified'/u)
  assert.match(
    source,
    /rollbackStatusPersistedAfterPatchOutcome: true/u,
  )
})
