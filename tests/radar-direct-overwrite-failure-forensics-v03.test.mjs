import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  categorizeDiffs,
  diffDocuments,
  findEvidenceRun,
} from '../scripts/radar/inspect-ai-radar-direct-overwrite-failure-v03.mjs'

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

test('falls back to latest matching plan when ledger is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-v03-fallback-'))
  try {
    const older = path.join(root, 'older', 'publication-plan.jsonl')
    const newer = path.join(root, 'newer', 'publication-plan.jsonl')
    writeJsonl(older, [{ targetId: '3739', patch: { rank: 'B' } }])
    writeJsonl(newer, [{ targetId: '3739', patch: { rank: 'A' } }])
    const now = Date.now() / 1000
    fs.utimesSync(older, now - 10, now - 10)
    fs.utimesSync(newer, now, now)

    const result = findEvidenceRun(root, '3739')
    assert.equal(result.selectionKind, 'latest_matching_plan_fallback')
    assert.equal(result.selected.planRow.patch.rank, 'A')
    assert.equal(result.selected.failureEvent, null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('failed ledger event outranks a newer plan-only candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-v03-priority-'))
  try {
    const failedPlan = path.join(root, 'failed', 'publication-plan.jsonl')
    const newerPlan = path.join(root, 'newer', 'publication-plan.jsonl')
    writeJsonl(failedPlan, [{ targetId: '3739', patch: { rank: 'A' } }])
    writeJsonl(path.join(root, 'failed', 'execution-ledger.jsonl'), [
      { targetId: '3739', status: 'execution_failed' },
    ])
    writeJsonl(newerPlan, [{ targetId: '3739', patch: { rank: 'B' } }])
    const now = Date.now() / 1000
    fs.utimesSync(failedPlan, now - 10, now - 10)
    fs.utimesSync(newerPlan, now, now)

    const result = findEvidenceRun(root, '3739')
    assert.equal(result.selectionKind, 'failed_ledger_event')
    assert.equal(result.selected.planRow.patch.rank, 'A')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('recursive diff keeps field categories separate', () => {
  const before = {
    updatedAt: '2026-07-22T00:00:00.000Z',
    title: 'Before',
    radarAssessment: { suggestedGrade: 'B' },
    humanAssessment: { grade: 'S' },
  }
  const after = {
    updatedAt: '2026-07-22T01:00:00.000Z',
    title: 'After',
    radarAssessment: { suggestedGrade: 'A' },
    humanAssessment: { grade: 'S' },
  }
  const result = categorizeDiffs(
    diffDocuments(before, after),
    { radarAssessment: after.radarAssessment },
  )

  assert.deepEqual(result.patch.map((item) => item.path), ['radarAssessment.suggestedGrade'])
  assert.deepEqual(result.human, [])
  assert.deepEqual(result.volatile.map((item) => item.path), ['updatedAt'])
  assert.deepEqual(result.unrelated.map((item) => item.path), ['title'])
})

test('source and wrapper declare read-only safety and checkpoint output', () => {
  const repoRoot = process.cwd()
  const nodeSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/radar/inspect-ai-radar-direct-overwrite-failure-v03.mjs'),
    'utf8',
  )
  const psSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/radar/inspect-ai-radar-direct-overwrite-failure-v03.ps1'),
    'utf8',
  )

  assert.match(nodeSource, /payloadDataMutation: false/u)
  assert.match(nodeSource, /latest_matching_plan_fallback/u)
  assert.doesNotMatch(nodeSource, /method:\s*['"]PATCH['"]/u)
  assert.match(psSource, /FailureLedgerFound\s+:/u)
  assert.match(psSource, /RADAR-FULL-COVERAGE-DIRECT-OVERWRITE-FAILURE-FORENSICS-v03\.zip/u)
  assert.match(psSource, /SHA256SUMS\.txt/u)
})
