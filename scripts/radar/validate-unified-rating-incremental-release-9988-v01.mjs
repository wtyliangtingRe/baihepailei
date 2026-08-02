#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { validateLockedRelease } from './lib/unified-rating-release-plan-v01.mjs'

const LOCK_PATH = 'config/radar-unified-rating-incremental-release-9988-v01.lock.json'
const DEFAULT_INPUT = 'research-data/releases/public/radar-unified-rating-incremental-release-9988-0001/v01'
const EXPECTED_SCHEMA = 'radar-unified-rating-incremental-release-v03'

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const val = (value) => String(value ?? '').trim()

function parseArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`Unknown argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    out[key.slice(2)] = value
    index += 1
  }
  return out
}

function readText(file) {
  const value = fs.readFileSync(file, 'utf8')
  if (value.includes('\r')) throw new Error(`LF line endings required: ${file}`)
  if (value && !value.endsWith('\n')) throw new Error(`Final LF required: ${file}`)
  return value
}

function parseJsonl(text, label) {
  return text.split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) }
    catch (error) { throw new Error(`${label} line ${index + 1}: ${error.message}`) }
  })
}

function stableHash(values) {
  return sha256(Buffer.from(JSON.stringify([...values].sort()), 'utf8'))
}

export function validateIncrementalRelease(inputDirectory = DEFAULT_INPUT) {
  const lock = JSON.parse(readText(LOCK_PATH))
  const input = path.resolve(inputDirectory)
  const manifestText = readText(path.join(input, 'manifest.json'))
  const recordsText = readText(path.join(input, 'records.jsonl'))
  const ratingsText = readText(path.join(input, 'ratings.jsonl'))
  const indexText = readText(path.join(input, 'release-index.jsonl'))
  const excludedText = readText(path.join(input, 'identity-review-excluded.jsonl'))

  const validated = validateLockedRelease({
    manifestText,
    recordsText,
    ratingsText,
    indexText,
    lock,
  })
  const blockers = [...validated.blockers]
  const check = (condition, blocker) => { if (!condition) blockers.push(blocker) }
  const { manifest, records, ratings, index } = validated
  const excluded = parseJsonl(excludedText, 'identity-review-excluded.jsonl')

  check(manifest.schemaVersion === EXPECTED_SCHEMA, 'manifest_schema_mismatch')
  check(lock.researchCommitSha === 'c8790df95d1235d8d1aacabfb7c119fec9e1c642', 'research_head_mismatch')
  check(sha256(excludedText) === lock.identityReviewExcludedSha256, 'identity_review_excluded_sha_mismatch')
  check(excluded.length === lock.counts.identityReviewExcluded, 'identity_review_excluded_count_mismatch')
  check(excluded.every((row) => val(row.researchStatus) === 'identity_review'), 'excluded_non_identity_review_row')

  check(manifest.counts?.sourceRows === lock.counts.sourceRows, 'source_row_count_mismatch')
  check(manifest.counts?.records === lock.counts.records, 'manifest_record_count_mismatch')
  check(manifest.counts?.ratings === lock.counts.ratings, 'manifest_rating_count_mismatch')
  check(manifest.counts?.facts === lock.counts.facts, 'fact_count_mismatch')
  check(manifest.counts?.evidence === lock.counts.evidence, 'evidence_count_mismatch')
  check(manifest.counts?.sourceRefs === lock.counts.sourceRefs, 'source_ref_count_mismatch')
  check(manifest.counts?.httpEvidenceSources === lock.counts.httpEvidenceSources, 'http_source_count_mismatch')
  check(manifest.counts?.httpsEvidenceSources === lock.counts.httpsEvidenceSources, 'https_source_count_mismatch')
  check(manifest.counts?.overlapWithPreviousRelease === 0, 'unexpected_previous_release_overlap')
  check(JSON.stringify(manifest.gradeCounts) === JSON.stringify(lock.gradeCounts), 'grade_counts_mismatch')
  check(JSON.stringify(manifest.classCounts) === JSON.stringify(lock.classCounts), 'class_counts_mismatch')

  check(manifest.gates?.closedWorldInventory === true, 'closed_world_gate_missing')
  check(manifest.gates?.allConfirmedNonIdentityReviewRecordsRated === true, 'rating_coverage_gate_missing')
  check(manifest.gates?.identityReviewExcluded === true, 'identity_review_gate_missing')
  check(manifest.gates?.unknownDimensionsPreserved === true, 'unknown_dimensions_gate_missing')
  check(manifest.gates?.sourceUrlsPreservedWithoutProtocolRewrite === true, 'source_protocol_preservation_missing')
  check(manifest.gates?.httpSourcesPubliclyClickable === false, 'http_sources_clickable')
  check(manifest.gates?.negatedMaleStatementsDoNotTriggerE === true, 'male_negation_gate_missing')
  check(manifest.gates?.possibleOrUnverifiedNtrDoesNotTriggerNtrClass === true, 'ntr_uncertainty_gate_missing')
  check(manifest.gates?.reviewedLowerGradeIdentitySetsLocked === true, 'lower_grade_identity_lock_missing')
  check(manifest.gates?.productionAuthorization === false, 'release_production_authorized')
  check(manifest.gates?.automaticX === false, 'automatic_x_enabled')

  const recordIDs = records.map((row) => val(row.identityKey))
  const excludedIDs = excluded.map((row) => `${val(row.workId)}|${val(row.siteId)}`)
  check(new Set(excludedIDs).size === excluded.length, 'duplicate_excluded_identity')
  check(recordIDs.every((identity) => !new Set(excludedIDs).has(identity)), 'excluded_identity_in_release')
  check(records.every((row) => val(row.schemaVersion) === 'radar-public-record-v01'), 'record_schema_mismatch')
  check(ratings.every((row) => val(row.schemaVersion) === 'radar-unified-public-rating-v01'), 'rating_schema_mismatch')
  check(index.every((row, indexValue) => Number(row.releaseOrdinal) === indexValue + 1), 'release_ordinal_mismatch')
  check(ratings.every((row) => ['B', 'D', 'E'].includes(val(row.coreGrade))), 'unexpected_core_grade')
  check(ratings.every((row) => val(row.humanReview?.status) === 'unreviewed'), 'nonblank_human_review')
  check(ratings.every((row) => row.humanReview?.blocksPublication === false), 'human_review_blocks_publication')

  const maleIDs = ratings.filter((row) => row.matchedClasses?.[0] === 'E-MALE-POSSIBILITY').map((row) => val(row.identityKey))
  const ntrIDs = ratings.filter((row) => row.matchedClasses?.[0] === 'E-NTR').map((row) => val(row.identityKey))
  check(maleIDs.length === 7, 'male_e_count_mismatch')
  check(ntrIDs.length === 3, 'ntr_e_count_mismatch')
  check(stableHash(maleIDs) === manifest.lowerGradeTriggerPolicy?.maleEIdentityHash, 'male_e_identity_hash_mismatch')
  check(stableHash(ntrIDs) === manifest.lowerGradeTriggerPolicy?.ntrEIdentityHash, 'ntr_e_identity_hash_mismatch')

  const summary = {
    schemaVersion: 'radar-unified-rating-incremental-release-validation-9988-v01',
    accepted: blockers.length === 0,
    releaseId: lock.releaseId,
    researchHead: lock.researchCommitSha,
    inputDirectory: input,
    counts: {
      records: records.length,
      ratings: ratings.length,
      excluded: excluded.length,
      facts: records.reduce((sum, row) => sum + (row.facts?.length || 0), 0),
      evidence: records.reduce((sum, row) => sum + (row.evidence?.length || 0), 0),
    },
    gradeCounts: manifest.gradeCounts,
    classCounts: manifest.classCounts,
    blockers,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      postgresqlRead: false,
      postgresqlWrite: false,
      websiteWrite: false,
      productionAuthorization: false,
    },
    decision: blockers.length === 0
      ? 'accept_locked_incremental_release_for_read_only_transition_planning'
      : 'reject_locked_incremental_release',
  }
  return summary
}

export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const unknown = Object.keys(args).filter((key) => key !== 'input' && key !== 'output')
  if (unknown.length) throw new Error(`Forbidden arguments: ${unknown.join(', ')}`)
  const summary = validateIncrementalRelease(args.input || DEFAULT_INPUT)
  const text = `${JSON.stringify(summary, null, 2)}\n`
  if (args.output) {
    const output = path.resolve(args.output)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, text, 'utf8')
  }
  process.stdout.write(text)
  if (!summary.accepted) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) run()
