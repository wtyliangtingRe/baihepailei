import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import {
  loadAndValidateAiQaPackage,
  stableRowSha256,
} from '../scripts/radar/lib/ai-qa-package-v01.mjs'

const ROOT = process.cwd()
const scripts = [
  'scripts/radar/lib/ai-qa-package-v01.mjs',
  'scripts/radar/apply-ai-radar-ai-qa-package-v01.mjs',
  'scripts/radar/finalize-ai-radar-ai-qa-v01.mjs',
  'scripts/radar/resolve-ai-radar-calibrated-assessments-v01.mjs',
  'scripts/radar/assemble-ai-radar-calibrated-assessment-handoff-v01.mjs',
  'scripts/radar/assemble-ai-radar-research-handoff-v01.mjs',
]

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}
function fixturePackage(root, mutate = () => {}) {
  const packageDir = path.join(root, 'package')
  fs.mkdirSync(path.join(packageDir, 'decisions'), { recursive: true })
  fs.mkdirSync(path.join(packageDir, 'corrections'), { recursive: true })
  fs.mkdirSync(path.join(packageDir, 'research'), { recursive: true })
  const original = { workId: '1', siteId: 'work:1', title: 'A', evidenceCoverage: 0.5, evidenceStatus: 'official_confirmed', sourceSummary: 'source', ruleAssessments: [{ code: 'B-LIGHT', matched: true, reason: 'reason' }], calibrationProfileId: 'site-owner-primary-v0.1', calibrationSignals: [], calibrationNotes: [] }
  const corrected = { ...original, sourceSummary: 'corrected source' }
  const decisions = [
    { version: 'ai-radar-ai-qa-decision-v0.1', batchId: 'BATCH-1', workId: '1', siteId: 'work:1', decision: 'ai_qa_revise', reasons: ['repair'], humanTrackAction: 'none_separate_track', humanTrackMutation: false },
  ]
  const corrections = [
    { version: 'ai-radar-ai-qa-correction-v0.1', batchId: 'BATCH-1', workId: '1', siteId: 'work:1', responseFileName: 'chunk.output.jsonl', expectedOriginalResponseRowSha256: stableRowSha256(original), correctedResponseRowSha256: stableRowSha256(corrected), correctedResponse: corrected, humanTrackAction: 'none_separate_track' },
  ]
  const targets = []
  const files = {
    'decisions/ai-radar-ai-qa-decisions-v0.1.jsonl': decisions,
    'corrections/ai-radar-ai-qa-corrections-v0.1.jsonl': corrections,
    'research/ai-radar-ai-qa-targeted-research-v0.1.jsonl': targets,
  }
  const manifest = {
    version: 'ai-radar-ai-qa-package-v0.1', packageId: 'fixture-package', batchId: 'BATCH-1', expectedRows: 1,
    decisionCounts: { ai_qa_passed: 0, ai_qa_revise: 1, ai_qa_deferred: 0 }, correctionsIncluded: 1, targetedResearchRows: 0,
    safety: { payloadWrite: false, directPostgresqlWrite: false, publishesRatings: false, humanTrackMutations: 0 },
    files: [],
  }
  mutate({ manifest, decisions, corrections, original, corrected, packageDir })
  for (const [relative, rows] of Object.entries(files)) writeJsonl(path.join(packageDir, relative), rows)
  manifest.files = Object.keys(files).map((relative) => {
    const file = path.join(packageDir, relative)
    return { file: relative, sha256: sha256File(file), bytes: fs.statSync(file).size }
  })
  fs.writeFileSync(path.join(packageDir, 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { packageDir, original, corrected }
}

for (const file of scripts) {
  test(`${file} parses successfully`, () => {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  })
}

test('stable row SHA is key-order independent', () => {
  assert.equal(stableRowSha256({ b: 2, a: { d: 4, c: 3 } }), stableRowSha256({ a: { c: 3, d: 4 }, b: 2 }))
})

test('AI QA package validates a correction and keeps human track isolated', () => {
  const root = path.join(ROOT, 'data_local', 'tmp', `ai-qa-test-${process.pid}-${Date.now()}`)
  try {
    const fixture = fixturePackage(root)
    const loaded = loadAndValidateAiQaPackage(fixture.packageDir)
    assert.equal(loaded.decisions.length, 1)
    assert.equal(loaded.corrections.length, 1)
    assert.equal(loaded.decisions[0].humanTrackMutation, false)
  }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('AI QA package rejects human-track mutation', () => {
  const root = path.join(ROOT, 'data_local', 'tmp', `ai-qa-test-${process.pid}-${Date.now()}`)
  try {
    const fixture = fixturePackage(root, ({ decisions }) => { decisions[0].humanTrackMutation = true })
    assert.throws(() => loadAndValidateAiQaPackage(fixture.packageDir), /human_track_mutation/u)
  }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('assemblers validate manifest-derived input and response paths', () => {
  for (const file of [
    'scripts/radar/assemble-ai-radar-calibrated-assessment-handoff-v01.mjs',
    'scripts/radar/assemble-ai-radar-research-handoff-v01.mjs',
  ]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    assert.match(source, /input_outside_data_local/u)
    assert.match(source, /response_outside_data_local/u)
    assert.match(source, /source.*outside_data_local/u)
  }
})

test('calibrated resolver emits separate AI and human track fields', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/radar/resolve-ai-radar-calibrated-assessments-v01.mjs'), 'utf8')
  assert.match(source, /track: 'ai_review'/u)
  assert.match(source, /aiQaRequired/u)
  assert.match(source, /humanReviewStatus: 'not_started_separate_track'/u)
  assert.match(source, /humanTrackMutations: 0/u)
})

test('PowerShell entry point derives repo root and contains no fixed drive path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/radar/run-ai-radar-prebatch2-v01.ps1'), 'utf8')
  assert.match(source, /\$PSScriptRoot/u)
  assert.doesNotMatch(source, /[A-Z]:\\0GitHubtest/iu)
  assert.match(source, /data_local/u)
})

test('AI QA scripts contain no Payload or PostgreSQL write path', () => {
  for (const file of [
    'scripts/radar/apply-ai-radar-ai-qa-package-v01.mjs',
    'scripts/radar/finalize-ai-radar-ai-qa-v01.mjs',
    'scripts/radar/run-ai-radar-prebatch2-v01.ps1',
  ]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    assert.doesNotMatch(source, /fetch\s*\([^)]*\/api\//iu)
    assert.doesNotMatch(source, /\b(psql|postgresql:\/\/|payload\s+update|PATCH\s+\/api)\b/iu)
  }
})
