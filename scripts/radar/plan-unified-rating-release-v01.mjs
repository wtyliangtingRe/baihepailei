#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildUnifiedReleasePlan,
  parseJsonl,
  validateLockedRelease,
} from './lib/unified-rating-release-plan-v01.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    result[key.slice(2)] = value
    index += 1
  }
  return result
}

function readRows(file, label) {
  if (!file) return []
  const text = fs.readFileSync(file, 'utf8')
  const trimmed = text.trimStart()
  if (trimmed.startsWith('[')) return JSON.parse(text)
  return parseJsonl(text, label)
}

function required(args, key) {
  const value = args[key]
  if (!value) throw new Error(`Missing --${key}`)
  return path.resolve(value)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const releaseDir = required(args, 'release-dir')
  const worksFile = required(args, 'works-file')
  const outputDir = path.resolve(args['output-dir'] || path.join(repoRoot, 'data_local/staging/radar-unified-rating-release-plan-v01'))
  const importedAt = String(args['imported-at'] || '2026-08-02T00:00:00.000Z')

  const lockPath = path.resolve(args['lock-file'] || path.join(repoRoot, 'config/radar-unified-rating-release-0575-v01.lock.json'))
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  const manifestText = fs.readFileSync(path.join(releaseDir, 'manifest.json'), 'utf8')
  const recordsText = fs.readFileSync(path.join(releaseDir, 'records.jsonl'), 'utf8')
  const ratingsText = fs.readFileSync(path.join(releaseDir, 'ratings.jsonl'), 'utf8')
  const indexText = fs.readFileSync(path.join(releaseDir, 'release-index.jsonl'), 'utf8')
  const validation = validateLockedRelease({ manifestText, recordsText, ratingsText, indexText, lock })
  if (!validation.accepted) throw new Error(`Release lock validation failed:\n${validation.blockers.join('\n')}`)

  const works = readRows(worksFile, 'works')
  const currentRecords = readRows(args['current-records-file'] ? path.resolve(args['current-records-file']) : null, 'current records')
  const currentRatings = readRows(args['current-ratings-file'] ? path.resolve(args['current-ratings-file']) : null, 'current ratings')
  const release = {
    releaseId: lock.releaseId,
    sourceCommitSha: lock.researchCommitSha,
    policyVersion: lock.policyVersion,
    researchSnapshotId: lock.researchSnapshotId,
    recordsSha256: lock.recordsSha256,
    ratingsSha256: lock.ratingsSha256,
  }
  const plan = buildUnifiedReleasePlan({
    records: validation.records,
    ratings: validation.ratings,
    works,
    currentRecords,
    currentRatings,
    release,
    importedAt,
  })

  fs.mkdirSync(outputDir, { recursive: true })
  const planPath = path.join(outputDir, 'plan.json')
  const rowsPath = path.join(outputDir, 'plan-rows.jsonl')
  const summaryPath = path.join(outputDir, 'summary.json')
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n')
  fs.writeFileSync(rowsPath, plan.rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
  fs.writeFileSync(summaryPath, JSON.stringify({
    schemaVersion: plan.schemaVersion,
    releaseId: plan.releaseId,
    counts: plan.counts,
    accepted: plan.accepted,
    safety: plan.safety,
  }, null, 2) + '\n')
  console.log(JSON.stringify({ planPath, rowsPath, summaryPath, counts: plan.counts, accepted: plan.accepted }, null, 2))
  if (!plan.accepted) process.exitCode = 2
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
}
