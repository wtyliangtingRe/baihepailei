#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

import {
  V06_BATCH_ARM_CONFIRMATION,
  approvalTokenFor,
  batchSlug,
  expectedExecuteConfirmation,
  safeBatchId,
} from './lib/v06-batch-release-v01.mjs'

const VERSION = 'ai-radar-v06-remaining-batches-orchestrator-v0.2'
const DEFAULT_ROOT = 'data_local/staging/ai-radar/v06-remaining-batches-v01'
const DEFAULT_BACKUP_ROOT = 'D:\\Baihepailei-backups'
const DEFAULT_URL = 'http://localhost:3000'
const PLAN_ROOT = 'data_local/staging/ai-radar/v06-payload-plan-v01'
const EXECUTE_ROOT = 'data_local/staging/ai-radar/v06-batch-execute-runs-v01'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}

function integerArg(value, fallback, label) {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`)
  return parsed
}

function padBatch(value) {
  return String(value).padStart(4, '0')
}

function batchIdOf(value) {
  return safeBatchId(`RADAR-ASSESS-${padBatch(value)}`)
}

function bulkConfirmation(fromBatch, toBatch) {
  return `EXECUTE-AI-RADAR-V06-BATCHES-${padBatch(fromBatch)}-${padBatch(toBatch)}`
}

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.copyFileSync(temporary, file)
  fs.rmSync(temporary, { force: true })
}

function run(command, args, label) {
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`${label} failed with exit code ${result.status}`)
    error.exitCode = result.status
    throw error
  }
}

function runNode(script, args, label) {
  run(process.execPath, [script, ...args], label)
}

function powershellExecutable() {
  if (process.platform !== 'win32') {
    throw new Error('This orchestrator currently requires Windows PowerShell.')
  }
  return 'powershell.exe'
}

function runPowerShell(script, args, label) {
  run(powershellExecutable(), [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    ...args,
  ], label)
}

function listDirectories(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
}

function nonEmptyLineCount(file) {
  if (!fs.existsSync(file)) return -1
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.trim()).length
}

function jsonlStatusCounts(file) {
  const counts = {}
  if (!fs.existsSync(file)) return counts
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    if (!line.trim()) continue
    const status = String(JSON.parse(line).status || '')
    counts[status] = (counts[status] || 0) + 1
  }
  return counts
}

function blockersOf(value) {
  return Array.isArray(value) ? value : []
}

function uniqueRunId() {
  return new Date().toISOString().replace(/[-:.TZ]/gu, '')
}

function assertTrackedWorktreeClean() {
  const changed = gitValue(['status', '--short'])
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('??'))
  if (changed.length) {
    throw new Error(`Tracked working-tree changes exist:\n${changed.join('\n')}`)
  }
}

function validateGlobalSummary(summary) {
  const blockers = []
  if (summary?.complete !== true) blockers.push('global_dryrun_incomplete')
  if (Number(summary?.batchCount) !== 44) blockers.push('global_batch_count_mismatch')
  if (Number(summary?.planRowsRead) !== 10805) blockers.push('global_plan_row_count_mismatch')
  if (blockersOf(summary?.integrityBlockers).length) blockers.push('global_integrity_blockers')
  if (summary?.safety?.payloadWrite !== false) blockers.push('global_payload_write_safety_mismatch')
  if (Number(summary?.safety?.payloadPatchRequests) !== 0) blockers.push('global_patch_request_safety_mismatch')
  if (blockers.length) throw new Error(`Global dry-run failed validation: ${blockers.join(', ')}`)
}

function runGlobalDryRun(outDir, url) {
  runNode(
    'scripts/radar/run-ai-radar-v06-payload-dryruns-v01.mjs',
    ['--url', url, '--out-dir', outDir],
    `Global v0.6 dry-run -> ${outDir}`,
  )
  const summaryFile = path.join(outDir, 'ai-radar-v06-payload-dryrun-v01-summary.json')
  const summary = readJson(summaryFile)
  validateGlobalSummary(summary)
  return { outDir, summaryFile, summary }
}

function readBatchPlanning(batchId, dryRunRoot) {
  const slug = batchSlug(batchId)
  const planSummaryFile = path.join(PLAN_ROOT, 'batches', slug, 'payload-plan-summary.json')
  const dryRunSummaryFile = path.join(dryRunRoot, 'batches', slug, 'payload-dryrun-summary.json')
  const plan = readJson(planSummaryFile)
  const dryRun = readJson(dryRunSummaryFile)
  const rows = Number(plan?.rows)
  const ready = Number(plan?.readyForDryRun)
  const blocked = Number(plan?.blocked)
  const alreadyPlan = Number(plan?.alreadyCurrent || 0)
  if (Number(dryRun?.planRows) !== rows) throw new Error(`${batchId}: dry-run row count mismatch`)
  if (Number(dryRun?.wouldUpdate) + Number(dryRun?.blocked) + Number(dryRun?.alreadyCurrent) !== rows) {
    throw new Error(`${batchId}: dry-run accounting does not sum to plan rows`)
  }
  if (ready + blocked + alreadyPlan !== rows) throw new Error(`${batchId}: plan accounting does not sum to rows`)
  if (dryRun?.safety?.payloadWrite !== false || Number(dryRun?.safety?.payloadPatchRequests) !== 0) {
    throw new Error(`${batchId}: dry-run write safety mismatch`)
  }
  return { batchId, slug, planSummaryFile, dryRunSummaryFile, plan, dryRun, rows, ready, blocked }
}

function createCheckpoint(backupRoot, branch, commit) {
  fs.mkdirSync(backupRoot, { recursive: true })
  const before = new Set(listDirectories(backupRoot))
  runPowerShell(
    'scripts/backup/create-database-only-checkpoint.ps1',
    ['-BackupRoot', backupRoot],
    'Create lightweight database checkpoint',
  )
  const created = listDirectories(backupRoot).filter((item) => !before.has(item))
  if (created.length !== 1) {
    throw new Error(`Expected exactly one new checkpoint, found ${created.length}`)
  }
  const checkpointPath = created[0]
  const manifest = readJson(path.join(checkpointPath, 'checkpoint-manifest.json'))
  const status = readJson(path.join(checkpointPath, 'checkpoint-status.json'))
  if (status?.state !== 'complete') throw new Error('New checkpoint is not complete')
  if (manifest?.includesDatabase !== true) throw new Error('New checkpoint has no database dump')
  if (String(manifest?.checkpointProfile || '') !== 'database_only') {
    throw new Error('New checkpoint is not database-only')
  }
  if (manifest?.includesWorkspace !== false || manifest?.includesGitBundle !== false) {
    throw new Error('New database-only checkpoint unexpectedly contains workspace backup flags')
  }
  if (String(manifest?.branch || '') !== branch) throw new Error('New checkpoint branch mismatch')
  if (String(manifest?.commit || '') !== commit) throw new Error('New checkpoint commit mismatch')
  return checkpointPath
}

function verifyCheckpoint(checkpointPath, outputDir, commit) {
  fs.rmSync(outputDir, { recursive: true, force: true })
  runPowerShell(
    'scripts/backup/verify-local-database-checkpoint.ps1',
    ['-CheckpointPath', checkpointPath, '-OutputDir', outputDir],
    'Verify database checkpoint',
  )
  const reportFile = path.join(outputDir, 'database-restore-verification-v01.json')
  const report = readJson(reportFile)
  if (report?.verified !== true || report?.checksumMatched !== true) {
    throw new Error('Checkpoint verification report is not clean')
  }
  if (String(report?.checkpointCommit || '') !== commit) {
    throw new Error('Checkpoint verification commit mismatch')
  }
  if (Number(report?.listEntryCount) <= 0) {
    throw new Error('Checkpoint verification contains no archive entries')
  }
  return reportFile
}

function latestNewExecuteDirectory(batchRoot, before, startedAt) {
  const created = listDirectories(batchRoot).filter((item) => !before.has(item))
  if (created.length === 1) return created[0]
  const candidates = listDirectories(batchRoot)
    .filter((dir) => fs.existsSync(path.join(dir, 'summary.json')))
    .filter((dir) => fs.statSync(path.join(dir, 'summary.json')).mtimeMs >= startedAt - 5000)
    .sort((left, right) => fs.statSync(path.join(right, 'summary.json')).mtimeMs - fs.statSync(path.join(left, 'summary.json')).mtimeMs)
  if (!candidates.length) throw new Error('Execute evidence directory was not found')
  return candidates[0]
}

function validateCleanExecuteEvidence(runDir, expectedApplied) {
  const applied = nonEmptyLineCount(path.join(runDir, 'applied.jsonl'))
  const journal = nonEmptyLineCount(path.join(runDir, 'journal.jsonl'))
  const rollback = nonEmptyLineCount(path.join(runDir, 'rollback.jsonl'))
  const rollbackStatusFile = path.join(runDir, 'rollback-status.jsonl')
  const rollbackStatus = nonEmptyLineCount(rollbackStatusFile)
  const statuses = jsonlStatusCounts(rollbackStatusFile)
  if (applied !== expectedApplied || journal !== expectedApplied || rollback !== expectedApplied) {
    throw new Error(`Execute evidence row count mismatch: applied=${applied}, journal=${journal}, rollback=${rollback}`)
  }
  if (rollbackStatus !== expectedApplied * 2) {
    throw new Error(`Rollback status count mismatch: ${rollbackStatus}`)
  }
  if (Number(statuses.patch_request_completed || 0) !== expectedApplied) {
    throw new Error('patch_request_completed evidence count mismatch')
  }
  if (Number(statuses.verification_completed || 0) !== expectedApplied) {
    throw new Error('verification_completed evidence count mismatch')
  }
  if (Number(statuses.patch_request_failed || 0) !== 0 || Number(statuses.patch_failed_or_unverified || 0) !== 0) {
    throw new Error('Failure status exists in a supposedly clean execute run')
  }
}

function validateReadiness(summary, expectedWrites) {
  if (summary?.mode !== 'readiness') throw new Error('Unexpected readiness mode')
  if (Number(summary?.pendingOriginal) + Number(summary?.alreadyApplied) !== expectedWrites) {
    throw new Error('Readiness pending/applied count mismatch')
  }
  if (Number(summary?.drifted) !== 0 || summary?.preflightReady !== true) {
    throw new Error('Readiness is not clean')
  }
  if (Number(summary?.payloadPatchRequests) !== 0 || summary?.safety?.payloadWrite !== false) {
    throw new Error('Readiness write safety mismatch')
  }
  if (blockersOf(summary?.staticBlockers).length || blockersOf(summary?.gateBlockers).length) {
    throw new Error('Readiness contains blockers')
  }
}

function validateArmedReadiness(summary, expectedWrites, pending, alreadyApplied) {
  if (summary?.mode !== 'armed_readiness') throw new Error('Unexpected armed readiness mode')
  if (Number(summary?.pendingOriginal) !== pending || Number(summary?.alreadyApplied) !== alreadyApplied) {
    throw new Error('Armed readiness state classification changed')
  }
  if (pending + alreadyApplied !== expectedWrites) throw new Error('Armed readiness count mismatch')
  if (Number(summary?.drifted) !== 0 || summary?.preflightReady !== true || summary?.executionReady !== true) {
    throw new Error('Armed readiness is not execution-ready')
  }
  if (Number(summary?.payloadPatchRequests) !== 0 || summary?.safety?.payloadWrite !== false) {
    throw new Error('Armed readiness write safety mismatch')
  }
  if (blockersOf(summary?.staticBlockers).length || blockersOf(summary?.gateBlockers).length) {
    throw new Error('Armed readiness contains blockers')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const fromBatch = integerArg(args['from-batch'], 3, '--from-batch')
  const toBatch = integerArg(args['to-batch'], 44, '--to-batch')
  const execute = args.execute === true
  const confirmation = String(args.confirmation || '')
  const requiredConfirmation = bulkConfirmation(fromBatch, toBatch)
  const root = String(args['out-dir'] || DEFAULT_ROOT)
  const backupRoot = path.resolve(String(args['backup-root'] || DEFAULT_BACKUP_ROOT))
  const url = String(args.url || DEFAULT_URL).replace(/\/+$/u, '')

  if (fromBatch < 1 || toBatch > 44 || fromBatch > toBatch) {
    throw new Error('Batch range must be within 1..44 and from <= to')
  }
  if (execute && confirmation !== requiredConfirmation) {
    throw new Error(`Exact confirmation required: ${requiredConfirmation}`)
  }
  if (args.apply || args.write || args.patch || args.token || args['approval-token']) {
    throw new Error('Legacy write/token arguments are rejected')
  }

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const sessionId = uniqueRunId()
  const sessionRoot = path.join(root, 'sessions', sessionId)
  const global = runGlobalDryRun(path.join(sessionRoot, 'global-before'), url)
  const selected = []
  for (let index = fromBatch; index <= toBatch; index += 1) {
    selected.push(readBatchPlanning(batchIdOf(index), global.outDir))
  }

  console.table(selected.map((item) => ({
    batchId: item.batchId,
    rows: item.rows,
    wouldUpdate: Number(item.dryRun.wouldUpdate),
    blocked: Number(item.dryRun.blocked),
    alreadyCurrent: Number(item.dryRun.alreadyCurrent),
  })))
  const selectedWouldUpdateAtStart = selected.reduce((sum, item) => sum + Number(item.dryRun.wouldUpdate), 0)
  const selectedBlocked = selected.reduce((sum, item) => sum + Number(item.dryRun.blocked), 0)
  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'plan_only',
    currentBranch,
    currentCommit,
    fromBatch,
    toBatch,
    selectedWouldUpdateAtStart,
    selectedBlocked,
    requiredConfirmation,
    safety: {
      planOnlyByDefault: true,
      executeRequested: execute,
      payloadPatchRequestsBeforeBatchExecution: 0,
    },
  }, null, 2))

  if (!execute) {
    console.log(`\nPlan-only complete. To execute, rerun with --execute --confirmation "${requiredConfirmation}"`)
    return
  }

  assertTrackedWorktreeClean()
  if (!(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL)) {
    throw new Error('Payload email environment variable is missing')
  }
  if (!(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD)) {
    throw new Error('Payload password environment variable is missing')
  }

  const stateFile = path.join(root, 'state.json')
  let state
  if (fs.existsSync(stateFile)) {
    state = readJson(stateFile)
    if (state?.version !== VERSION) throw new Error('Existing orchestrator state version mismatch')
    if (state?.currentBranch !== currentBranch || state?.currentCommit !== currentCommit) {
      throw new Error('Existing orchestrator state is bound to a different Git state')
    }
    if (Number(state?.fromBatch) !== fromBatch || Number(state?.toBatch) !== toBatch) {
      throw new Error('Existing orchestrator state is bound to a different batch range')
    }
  } else {
    state = {
      version: VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentBranch,
      currentCommit,
      fromBatch,
      toBatch,
      requiredConfirmation,
      complete: false,
      batches: {},
    }
    writeJsonAtomic(stateFile, state)
  }

  let activeBatchId = ''
  const saveState = () => {
    state.updatedAt = new Date().toISOString()
    writeJsonAtomic(stateFile, state)
  }
  const updateBatch = (batchId, patch) => {
    state.batches[batchId] = {
      ...(state.batches[batchId] || {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    saveState()
  }

  try {
    for (const planning of selected) {
      const batchId = planning.batchId
      const slug = planning.slug
      activeBatchId = batchId
      const existing = state.batches[batchId] || {}
      if (existing.status === 'completed' || existing.status === 'skipped_no_writes') {
        console.log(`\n${batchId}: state already complete; skipping.`)
        activeBatchId = ''
        continue
      }

      let candidateManifestFile = existing.candidateManifestFile
      let checkpointPath = existing.checkpointPath
      let expectedWrites = Number(existing.expectedWrites || 0)

      if (!candidateManifestFile) {
        const currentWouldUpdate = Number(planning.dryRun.wouldUpdate)
        const currentAlready = Number(planning.dryRun.alreadyCurrent)
        const currentBlocked = Number(planning.dryRun.blocked)
        if (currentWouldUpdate === 0) {
          if (currentAlready === planning.ready && currentBlocked === planning.blocked) {
            updateBatch(batchId, {
              status: 'skipped_no_writes',
              reason: currentAlready ? 'already_current' : 'blocked_only',
              expectedWrites: planning.ready,
              blockedRows: planning.blocked,
            })
            activeBatchId = ''
            continue
          }
          throw new Error(`${batchId}: zero writes but accounting does not match the plan`)
        }
        if (currentAlready !== 0) {
          throw new Error(`${batchId}: mixed already-current and pending rows exist without saved candidate state`)
        }
        if (currentWouldUpdate !== planning.ready || currentBlocked !== planning.blocked) {
          throw new Error(`${batchId}: fresh dry-run does not match the reviewed plan`)
        }

        expectedWrites = currentWouldUpdate
        checkpointPath = createCheckpoint(backupRoot, currentBranch, currentCommit)
        updateBatch(batchId, {
          status: 'checkpoint_created',
          checkpointPath,
          expectedWrites,
          blockedRows: planning.blocked,
          dryRunRoot: global.outDir,
        })

        const verificationDir = path.join(root, 'checkpoint-verification', slug, path.basename(checkpointPath))
        const restoreVerificationFile = verifyCheckpoint(checkpointPath, verificationDir, currentCommit)
        updateBatch(batchId, {
          status: 'checkpoint_verified',
          restoreVerificationFile,
        })

        const candidateRoot = path.join(root, 'candidates')
        fs.rmSync(path.join(candidateRoot, slug), { recursive: true, force: true })
        runNode(
          'scripts/radar/prepare-ai-radar-v06-batch-candidate-v01.mjs',
          [
            '--batch-id', batchId,
            '--checkpoint', checkpointPath,
            '--restore-verification', restoreVerificationFile,
            '--dryrun-root', global.outDir,
            '--out-dir', candidateRoot,
          ],
          `${batchId}: prepare candidate`,
        )
        candidateManifestFile = path.join(candidateRoot, slug, 'candidate-manifest.json')
        const candidateSummaryFile = path.join(candidateRoot, slug, 'candidate-summary.json')
        const candidate = readJson(candidateManifestFile)
        const candidateSummary = readJson(candidateSummaryFile)
        if (candidateSummary?.candidateReady !== true || blockersOf(candidateSummary?.blockers).length) {
          throw new Error(`${batchId}: candidate preparation reported blockers`)
        }
        if (Number(candidate?.expected?.wouldUpdate) !== expectedWrites || Number(candidate?.expected?.blocked) !== planning.blocked) {
          throw new Error(`${batchId}: candidate expected counts mismatch`)
        }
        updateBatch(batchId, {
          status: 'candidate_prepared',
          candidateManifestFile,
          candidateId: candidate.candidateId,
        })
      }

      const candidate = readJson(candidateManifestFile)
      expectedWrites = Number(candidate?.expected?.wouldUpdate)
      if (!checkpointPath || !fs.existsSync(checkpointPath)) throw new Error(`${batchId}: saved checkpoint is missing`)
      if (String(candidate?.currentCommit || '') !== currentCommit) throw new Error(`${batchId}: candidate commit mismatch`)

      const readinessDir = path.join(root, 'readiness', slug, `disarmed-${uniqueRunId()}`)
      runNode(
        'scripts/radar/run-ai-radar-v06-batch-readiness-v01.mjs',
        ['--candidate-manifest', candidateManifestFile, '--checkpoint', checkpointPath, '--url', url, '--out-dir', readinessDir],
        `${batchId}: disarmed readiness`,
      )
      const readinessFile = path.join(readinessDir, 'summary.json')
      const readiness = readJson(readinessFile)
      validateReadiness(readiness, expectedWrites)
      const pending = Number(readiness.pendingOriginal)
      const alreadyApplied = Number(readiness.alreadyApplied)
      updateBatch(batchId, {
        status: pending === 0 ? 'post_readiness_complete' : 'readiness_passed',
        readinessFile,
        pendingOriginal: pending,
        alreadyApplied,
      })

      if (pending === 0) {
        if (alreadyApplied !== expectedWrites) throw new Error(`${batchId}: no pending rows but completion count mismatch`)
        updateBatch(batchId, { status: 'completed', completedAt: new Date().toISOString() })
        activeBatchId = ''
        continue
      }

      const resume = alreadyApplied > 0
      const approvalToken = approvalTokenFor(candidate?.files?.plan?.sha256, batchId)
      const armRoot = path.join(root, 'arms')
      const armArgs = [
        '--candidate-manifest', candidateManifestFile,
        '--readiness', readinessFile,
        '--checkpoint', checkpointPath,
        '--approval-token', approvalToken,
        '--confirmation', V06_BATCH_ARM_CONFIRMATION,
        '--ttl-minutes', '120',
        '--out-dir', armRoot,
      ]
      if (resume) armArgs.push('--resume')
      runNode(
        'scripts/radar/arm-ai-radar-v06-batch-candidate-v01.mjs',
        armArgs,
        `${batchId}: ${resume ? 'resume arm' : 'arm'} (token redacted)`,
      )
      const gateFile = path.join(armRoot, slug, 'local-gate-armed.json')
      const armSummaryFile = path.join(armRoot, slug, 'arm-summary.json')
      const armSummary = readJson(armSummaryFile)
      if (armSummary?.armed !== true || blockersOf(armSummary?.blockers).length) {
        throw new Error(`${batchId}: arm failed validation`)
      }
      if (armSummary?.executeConfirmationRequired !== expectedExecuteConfirmation(candidate)) {
        throw new Error(`${batchId}: execute confirmation mismatch`)
      }
      updateBatch(batchId, {
        status: 'armed',
        gateFile,
        armSummaryFile,
        resume,
      })

      const armedReadinessDir = path.join(root, 'readiness', slug, `armed-${uniqueRunId()}`)
      runNode(
        'scripts/radar/run-ai-radar-v06-batch-readiness-v01.mjs',
        [
          '--candidate-manifest', candidateManifestFile,
          '--checkpoint', checkpointPath,
          '--gate', gateFile,
          '--approval-token', approvalToken,
          '--url', url,
          '--out-dir', armedReadinessDir,
        ],
        `${batchId}: armed readiness (token redacted)`,
      )
      const armedReadinessFile = path.join(armedReadinessDir, 'summary.json')
      const armedReadiness = readJson(armedReadinessFile)
      validateArmedReadiness(armedReadiness, expectedWrites, pending, alreadyApplied)
      updateBatch(batchId, {
        status: 'armed_readiness_passed',
        armedReadinessFile,
      })

      const executeBatchRoot = path.join(EXECUTE_ROOT, slug)
      const executeBefore = new Set(listDirectories(executeBatchRoot))
      const executeStartedAt = Date.now()
      updateBatch(batchId, {
        status: 'executing',
        executeStartedAt: new Date(executeStartedAt).toISOString(),
      })
      runNode(
        'scripts/radar/run-ai-radar-v06-batch-execute-once-v01.mjs',
        [
          '--candidate-manifest', candidateManifestFile,
          '--checkpoint', checkpointPath,
          '--gate', gateFile,
          '--approval-token', approvalToken,
          '--execute-confirmation', expectedExecuteConfirmation(candidate),
          '--url', url,
        ],
        `${batchId}: execute ${pending} PATCH requests (token redacted)`,
      )
      const executeRunDir = latestNewExecuteDirectory(executeBatchRoot, executeBefore, executeStartedAt)
      const executeSummaryFile = path.join(executeRunDir, 'summary.json')
      const executeSummary = readJson(executeSummaryFile)
      if (executeSummary?.mode !== 'execute') throw new Error(`${batchId}: execute summary mode mismatch`)
      if (Number(executeSummary?.pendingOriginal) !== pending || Number(executeSummary?.alreadyApplied) !== alreadyApplied) {
        throw new Error(`${batchId}: execute preflight classification mismatch`)
      }
      if (Number(executeSummary?.drifted) !== 0 || executeSummary?.preflightReady !== true || executeSummary?.executionReady !== true) {
        throw new Error(`${batchId}: execute preflight was not clean`)
      }
      if (Number(executeSummary?.appliedAndVerified) !== pending || Number(executeSummary?.payloadPatchRequests) !== pending) {
        throw new Error(`${batchId}: execute applied/request count mismatch`)
      }
      if (Number(executeSummary?.completedAfterRun) !== expectedWrites || Number(executeSummary?.remainingAfterRun) !== 0) {
        throw new Error(`${batchId}: execute did not complete the candidate`)
      }
      if (executeSummary?.stoppedAfterFailure !== false || blockersOf(executeSummary?.staticBlockers).length || blockersOf(executeSummary?.gateBlockers).length) {
        throw new Error(`${batchId}: execute reported a failure or blocker`)
      }
      validateCleanExecuteEvidence(executeRunDir, pending)
      updateBatch(batchId, {
        status: 'execute_verified',
        executeRunDir,
        executeSummaryFile,
        appliedThisRun: pending,
      })

      const postReadinessDir = path.join(root, 'readiness', slug, `post-${uniqueRunId()}`)
      runNode(
        'scripts/radar/run-ai-radar-v06-batch-readiness-v01.mjs',
        ['--candidate-manifest', candidateManifestFile, '--checkpoint', checkpointPath, '--url', url, '--out-dir', postReadinessDir],
        `${batchId}: independent post-readiness`,
      )
      const postReadinessFile = path.join(postReadinessDir, 'summary.json')
      const postReadiness = readJson(postReadinessFile)
      validateReadiness(postReadiness, expectedWrites)
      if (Number(postReadiness?.pendingOriginal) !== 0 || Number(postReadiness?.alreadyApplied) !== expectedWrites) {
        throw new Error(`${batchId}: post-readiness did not confirm full application`)
      }
      updateBatch(batchId, {
        status: 'completed',
        postReadinessFile,
        completedAt: new Date().toISOString(),
      })
      console.log(`\n${batchId}: completed ${expectedWrites} reviewed writes; ${planning.blocked} blocked rows were untouched.`)
      activeBatchId = ''
    }

    const finalGlobal = runGlobalDryRun(path.join(sessionRoot, 'global-after'), url)
    const expectedFinalWouldUpdate = Number(global.summary.wouldUpdate) - selectedWouldUpdateAtStart
    const expectedFinalAlreadyCurrent = Number(global.summary.alreadyCurrent) + selectedWouldUpdateAtStart
    if (Number(finalGlobal.summary.wouldUpdate) !== expectedFinalWouldUpdate) {
      throw new Error(`Final global wouldUpdate mismatch: expected ${expectedFinalWouldUpdate}, received ${finalGlobal.summary.wouldUpdate}`)
    }
    if (Number(finalGlobal.summary.alreadyCurrent) !== expectedFinalAlreadyCurrent) {
      throw new Error(`Final global alreadyCurrent mismatch: expected ${expectedFinalAlreadyCurrent}, received ${finalGlobal.summary.alreadyCurrent}`)
    }
    if (Number(finalGlobal.summary.blocked) !== Number(global.summary.blocked)) {
      throw new Error('Final global blocked count changed')
    }
    state.complete = true
    state.completedAt = new Date().toISOString()
    state.finalGlobalSummaryFile = finalGlobal.summaryFile
    state.final = {
      wouldUpdate: Number(finalGlobal.summary.wouldUpdate),
      blocked: Number(finalGlobal.summary.blocked),
      alreadyCurrent: Number(finalGlobal.summary.alreadyCurrent),
    }
    saveState()
    activeBatchId = ''
    console.log(JSON.stringify({ ok: true, stateFile, final: state.final }, null, 2))
  } catch (error) {
    const message = String(error?.stack || error)
    if (activeBatchId) {
      updateBatch(activeBatchId, {
        status: 'stopped_after_error',
        error: message.slice(0, 4000),
      })
    }
    state.complete = false
    state.lastError = message.slice(0, 8000)
    saveState()
    throw error
  }
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
