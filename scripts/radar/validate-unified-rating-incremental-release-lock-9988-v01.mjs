#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const LOCK_PATH = 'config/radar-unified-rating-incremental-release-9988-v01.lock.json'
const FIXTURE_ROOT = 'tests/fixtures/radar-unified-rating-incremental-release-9988-v01'
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function parseArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key !== '--output') throw new Error(`Unknown argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error('Missing value for --output')
    out.output = value
    index += 1
  }
  return out
}

function read(name) {
  return fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8')
}

function checksumMap(text) {
  const out = {}
  for (const line of text.split('\n').filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/u)
    if (!match) throw new Error(`Invalid checksum line: ${line}`)
    out[match[2]] = match[1]
  }
  return out
}

export function validateReleaseLockSnapshot() {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'))
  const acceptance = JSON.parse(read('research-acceptance.json'))
  const manifestText = read('manifest.json')
  const manifest = JSON.parse(manifestText)
  const sums = checksumMap(read('SHA256SUMS'))
  const blockers = []
  const check = (condition, blocker) => { if (!condition) blockers.push(blocker) }

  check(acceptance.accepted === true, 'research_acceptance_missing')
  check(acceptance.productionAuthorization === false, 'research_acceptance_production_authorized')
  check(acceptance.researchMainHead === lock.researchCommitSha, 'research_head_mismatch')
  check(acceptance.releaseId === lock.releaseId, 'release_id_mismatch')
  check(acceptance.releasePath === lock.releasePath, 'release_path_mismatch')
  check(acceptance.manifestSha256 === lock.manifestSha256, 'acceptance_manifest_sha_mismatch')
  check(sha256(manifestText) === lock.manifestSha256, 'fixture_manifest_sha_mismatch')
  check(sums['manifest.json'] === lock.manifestSha256, 'sums_manifest_sha_mismatch')
  check(sums['records.jsonl'] === lock.recordsSha256, 'records_sha_mismatch')
  check(sums['ratings.jsonl'] === lock.ratingsSha256, 'ratings_sha_mismatch')
  check(sums['release-index.jsonl'] === lock.releaseIndexSha256, 'release_index_sha_mismatch')
  check(sums['identity-review-excluded.jsonl'] === lock.identityReviewExcludedSha256, 'excluded_sha_mismatch')

  check(manifest.releaseId === lock.releaseId, 'manifest_release_id_mismatch')
  check(manifest.previousRelease?.releaseId === lock.previousRelease.releaseId, 'previous_release_id_mismatch')
  check(manifest.previousRelease?.recordsSha256 === lock.previousRelease.recordsSha256, 'previous_release_sha_mismatch')
  check(manifest.previousRelease?.recordCount === lock.previousRelease.recordCount, 'previous_release_count_mismatch')
  check(JSON.stringify(manifest.gradeCounts) === JSON.stringify(lock.gradeCounts), 'grade_counts_mismatch')
  check(JSON.stringify(manifest.classCounts) === JSON.stringify(lock.classCounts), 'class_counts_mismatch')
  for (const key of ['records', 'ratings', 'identityReviewExcluded', 'facts', 'evidence', 'sourceRefs', 'httpEvidenceSources', 'httpsEvidenceSources']) {
    check(manifest.counts?.[key] === lock.counts[key], `count_mismatch:${key}`)
  }
  check(manifest.gates?.closedWorldInventory === true, 'closed_world_gate_missing')
  check(manifest.gates?.identityReviewExcluded === true, 'identity_review_gate_missing')
  check(manifest.gates?.reviewedLowerGradeIdentitySetsLocked === true, 'lower_grade_identity_gate_missing')
  check(manifest.gates?.productionAuthorization === false, 'manifest_production_authorized')
  check(manifest.gates?.automaticX === false, 'automatic_x_enabled')
  check(manifest.lowerGradeTriggerPolicy?.maleEIdentityCount === 7, 'male_e_count_mismatch')
  check(manifest.lowerGradeTriggerPolicy?.ntrEIdentityCount === 3, 'ntr_e_count_mismatch')

  return {
    schemaVersion: 'radar-unified-rating-incremental-release-lock-validation-9988-v01',
    accepted: blockers.length === 0,
    releaseId: lock.releaseId,
    researchHead: lock.researchCommitSha,
    manifestSha256: lock.manifestSha256,
    recordsSha256: lock.recordsSha256,
    ratingsSha256: lock.ratingsSha256,
    releaseIndexSha256: lock.releaseIndexSha256,
    identityReviewExcludedSha256: lock.identityReviewExcludedSha256,
    verifiedWorkflowArtifactZipSha256: acceptance.verifiedWorkflowArtifactZipSha256,
    counts: lock.counts,
    gradeCounts: lock.gradeCounts,
    classCounts: lock.classCounts,
    blockers,
    safety: {
      privateResearchRepositoryCheckoutRequired: false,
      fullReleaseRevalidatedLocallyBeforePlanning: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlRead: false,
      postgresqlWrite: false,
      productionAuthorization: false,
    },
    decision: blockers.length === 0
      ? 'accept_private_research_release_lock_for_local_full_file_validation'
      : 'reject_private_research_release_lock',
  }
}

export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const result = validateReleaseLockSnapshot()
  const text = `${JSON.stringify(result, null, 2)}\n`
  if (args.output) {
    const output = path.resolve(args.output)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, text, 'utf8')
  }
  process.stdout.write(text)
  if (!result.accepted) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) run()
