import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  'scripts/radar/run-ai-radar-v06-remaining-batches-v01.mjs',
  'utf8',
)

test('remaining-batch orchestrator is plan-only by default and requires exact bulk confirmation', () => {
  assert.match(source, /const execute = args\.execute === true/u)
  assert.match(source, /EXECUTE-AI-RADAR-V06-BATCHES-/u)
  assert.match(source, /if \(execute && confirmation !== requiredConfirmation\)/u)
  assert.match(source, /Plan-only complete/u)
})

test('every writable batch is checkpointed and restore-list verified before candidate preparation', () => {
  const checkpoint = source.indexOf('create-database-checkpoint.ps1')
  const verify = source.indexOf('verify-local-database-checkpoint.ps1')
  const candidate = source.indexOf('prepare-ai-radar-v06-batch-candidate-v01.mjs')
  assert.ok(checkpoint >= 0)
  assert.ok(verify > checkpoint)
  assert.ok(candidate > verify)
})

test('execution requires both readiness stages and persists resumable state before PATCH', () => {
  const disarmed = source.indexOf("'readiness_passed'")
  const armed = source.indexOf("status: 'armed_readiness_passed'")
  const executing = source.indexOf("status: 'executing'")
  const execute = source.indexOf('run-ai-radar-v06-batch-execute-once-v01.mjs')
  assert.ok(disarmed >= 0)
  assert.ok(armed > disarmed)
  assert.ok(executing > armed)
  assert.ok(execute > executing)
  assert.match(source, /candidateManifestFile/u)
  assert.match(source, /checkpointPath/u)
  assert.match(source, /if \(resume\) armArgs\.push\('--resume'\)/u)
})

test('clean execution evidence and independent post-readiness are mandatory', () => {
  assert.match(source, /applied\.jsonl/u)
  assert.match(source, /journal\.jsonl/u)
  assert.match(source, /rollback\.jsonl/u)
  assert.match(source, /rollback-status\.jsonl/u)
  assert.match(source, /patch_request_completed/u)
  assert.match(source, /verification_completed/u)
  assert.match(source, /patch_request_failed/u)
  assert.match(source, /patch_failed_or_unverified/u)
  assert.match(source, /independent post-readiness/u)
  assert.match(source, /Final global blocked count changed/u)
})

test('approval tokens are generated in memory and are not written to orchestrator state', () => {
  assert.match(source, /approvalTokenFor/u)
  assert.doesNotMatch(source, /updateBatch\([^\n]+approvalToken/u)
  assert.doesNotMatch(source, /state\.[A-Za-z0-9_]*approvalToken/u)
  assert.match(source, /token redacted/u)
})
