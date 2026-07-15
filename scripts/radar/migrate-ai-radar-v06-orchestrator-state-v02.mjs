#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const OLD_VERSION = 'ai-radar-v06-remaining-batches-orchestrator-v0.1'
const NEW_VERSION = 'ai-radar-v06-remaining-batches-orchestrator-v0.2'
const EXPECTED_OLD_COMMIT = 'bb133069e2321cb808ac364e506b32916835ac57'
const EXPECTED_LAST_COMPLETED = 16
const STATE_FILE = path.resolve(
  'data_local/staging/ai-radar/v06-remaining-batches-v01/state.json',
)

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''),
  )
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(
    temporary,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
  fs.renameSync(temporary, file)
}

function trackedChanges() {
  return git(['status', '--short'])
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('??'))
}

function batchNumber(value) {
  const match = String(value || '').match(/(\d{4})$/u)
  return match ? Number(match[1]) : 0
}

if (!fs.existsSync(STATE_FILE)) {
  throw new Error(`State file not found: ${STATE_FILE}`)
}

const currentBranch = git(['branch', '--show-current'])
const currentCommit = git(['rev-parse', 'HEAD'])
const changes = trackedChanges()

if (changes.length) {
  throw new Error(
    `Tracked working-tree changes exist:\n${changes.join('\n')}`,
  )
}

if (currentCommit === EXPECTED_OLD_COMMIT) {
  throw new Error(
    'Commit the lightweight-checkpoint changes before migrating state.',
  )
}

const state = readJson(STATE_FILE)

if (state?.version !== OLD_VERSION) {
  throw new Error(
    `Expected state version ${OLD_VERSION}, received ${state?.version}`,
  )
}

if (String(state?.currentCommit || '') !== EXPECTED_OLD_COMMIT) {
  throw new Error(
    `Unexpected old state commit: ${state?.currentCommit}`,
  )
}

if (String(state?.currentBranch || '') !== currentBranch) {
  throw new Error(
    `State branch ${state?.currentBranch} does not match ${currentBranch}`,
  )
}

if (state?.complete === true) {
  throw new Error('State is already complete; migration is unnecessary.')
}

const entries = Object.entries(state?.batches || {})
const completedNumbers = entries
  .filter(([, value]) =>
    ['completed', 'skipped_no_writes'].includes(
      String(value?.status || ''),
    ),
  )
  .map(([batchId]) => batchNumber(batchId))
  .filter(Boolean)

const lastCompleted = completedNumbers.length
  ? Math.max(...completedNumbers)
  : 0

if (lastCompleted !== EXPECTED_LAST_COMPLETED) {
  throw new Error(
    `Expected last completed batch ${EXPECTED_LAST_COMPLETED}, received ${lastCompleted}`,
  )
}

const stopped = state?.batches?.['RADAR-ASSESS-0017']

if (
  !stopped ||
  String(stopped?.status || '') !== 'stopped_after_error' ||
  String(stopped?.checkpointPath || '')
) {
  throw new Error(
    'RADAR-ASSESS-0017 is not the expected checkpoint-free stopped state.',
  )
}

const timestamp = new Date()
  .toISOString()
  .replace(/[-:.TZ]/gu, '')

const backupFile = `${STATE_FILE}.before-lightweight-v02-${timestamp}.json`

fs.copyFileSync(STATE_FILE, backupFile)

state.version = NEW_VERSION
state.currentCommit = currentCommit
state.updatedAt = new Date().toISOString()
state.migration = {
  migratedAt: state.updatedAt,
  fromVersion: OLD_VERSION,
  toVersion: NEW_VERSION,
  fromCommit: EXPECTED_OLD_COMMIT,
  toCommit: currentCommit,
  lastCompletedBatch: EXPECTED_LAST_COMPLETED,
  clearedStoppedBatch: 'RADAR-ASSESS-0017',
  stateBackupFile: backupFile,
}

delete state.batches['RADAR-ASSESS-0017']

writeJsonAtomic(STATE_FILE, state)

console.log(JSON.stringify({
  ok: true,
  stateFile: STATE_FILE,
  stateBackupFile: backupFile,
  currentBranch,
  previousCommit: EXPECTED_OLD_COMMIT,
  currentCommit,
  lastCompletedBatch: EXPECTED_LAST_COMPLETED,
  nextBatch: 17,
  version: NEW_VERSION,
}, null, 2))
