#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  buildUnifiedReleasePlan,
  validateLockedRelease,
} from './lib/unified-rating-release-plan-v01.mjs'

const CONFIRM = 'PLAN-RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-V01'
const LOCK_PATH = 'config/radar-unified-rating-incremental-release-9988-v01.lock.json'
const OUTPUT_ROOT = path.resolve('data_local/outputs/radar-unified-rating-incremental-release-9988-v01')
const ALLOWED_ARGUMENTS = new Set(['input', 'url', 'out-dir', 'expected-main-head', 'confirm'])

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function assertOutputDirectory(value) {
  const output = path.resolve(value || '')
  if (!(output === OUTPUT_ROOT || output.startsWith(`${OUTPUT_ROOT}${path.sep}`))) {
    throw new Error(`Planner output must stay under ${OUTPUT_ROOT}: ${output}`)
  }
  return output
}

export function assertLoopbackUrl(value) {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  const port = Number(url.port || (url.protocol === 'http:' ? 80 : 443))
  if (url.protocol !== 'http:') throw new Error('Planner URL must use HTTP loopback.')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Planner URL must use loopback.')
  if (!Number.isInteger(port) || port < 3000 || port > 39999) throw new Error('Planner port must be 3000-39999.')
  return url.toString().replace(/\/$/u, '')
}

export function assertRequestPolicy({ url, method = 'GET', writeKind = '' }) {
  const normalized = val(method).toUpperCase()
  const pathname = new URL(url).pathname
  if (normalized === 'GET') return true
  if (normalized === 'POST' && writeKind === 'login' && pathname === '/api/users/login') return true
  throw new Error(`Forbidden planner request: ${normalized} ${pathname}`)
}

async function requestJson(url, options = {}) {
  const method = val(options.method || 'GET').toUpperCase()
  assertRequestPolicy({ url, method, writeKind: options.writeKind })
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `JWT ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 1500)}`)
  return text ? JSON.parse(text) : null
}

async function login(baseUrl, email, password) {
  const response = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    writeKind: 'login',
    body: { email, password },
  })
  if (!response?.token) throw new Error('Payload login returned no token.')
  return response.token
}

async function fetchAll(baseUrl, slug, token) {
  const rows = []
  let page = 1
  let totalPages = 1
  do {
    const query = new URLSearchParams({ limit: '500', page: String(page), depth: '0', showHiddenFields: 'true' })
    const response = await requestJson(`${baseUrl}/api/${slug}?${query}`, { token })
    rows.push(...(Array.isArray(response?.docs) ? response.docs : []))
    totalPages = Number(response?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return rows
}

function readRelease(inputDir) {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'))
  const manifestText = fs.readFileSync(path.join(inputDir, 'manifest.json'), 'utf8')
  const recordsText = fs.readFileSync(path.join(inputDir, 'records.jsonl'), 'utf8')
  const ratingsText = fs.readFileSync(path.join(inputDir, 'ratings.jsonl'), 'utf8')
  const indexText = fs.readFileSync(path.join(inputDir, 'release-index.jsonl'), 'utf8')
  const validated = validateLockedRelease({ manifestText, recordsText, ratingsText, indexText, lock })
  if (!validated.accepted) throw new Error(`Release validation failed: ${validated.blockers.join(', ')}`)
  return {
    ...validated,
    lock,
    release: {
      releaseId: lock.releaseId,
      sourceCommitSha: lock.researchCommitSha,
      policyVersion: lock.policyVersion,
      researchSnapshotId: lock.researchSnapshotId,
      recordsSha256: lock.recordsSha256,
      ratingsSha256: lock.ratingsSha256,
    },
  }
}

function statusCounts(rows, selector) {
  const counts = {}
  for (const row of rows) {
    const status = selector(row)
    counts[status] = (counts[status] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function expectedStorage(plan) {
  const totals = {
    publicRecords: 0,
    facts: 0,
    evidence: 0,
    factSourceRefs: 0,
    publicRatings: 0,
    matchedClasses: 0,
    ratingFactRefs: 0,
    ratingEvidenceRefs: 0,
    unresolvedDimensions: 0,
    confirmationBasis: 0,
    publicTagHints: 0,
    publicWarningTemplateIds: 0,
    proposedProfileChanges: 0,
    additionalEvidenceRefs: 0,
  }
  for (const row of plan.rows) {
    const record = row.recordPlan.desired
    const rating = row.ratingPlan.desired
    if (record) {
      totals.publicRecords += 1
      totals.facts += record.facts?.length || 0
      totals.evidence += record.evidence?.length || 0
      totals.factSourceRefs += (record.facts || []).reduce((sum, fact) => sum + (fact.sourceRefs?.length || 0), 0)
    }
    if (rating) {
      totals.publicRatings += 1
      totals.matchedClasses += rating.matchedClasses?.length || 0
      totals.ratingFactRefs += rating.factRefs?.length || 0
      totals.ratingEvidenceRefs += rating.evidenceRefs?.length || 0
      totals.unresolvedDimensions += rating.unresolvedDimensions?.length || 0
      totals.confirmationBasis += rating.confirmationBasis?.length || 0
      totals.publicTagHints += rating.publicTagHints?.length || 0
      totals.publicWarningTemplateIds += rating.publicWarningTemplateIds?.length || 0
      totals.proposedProfileChanges += rating.humanReview?.proposedProfileChanges?.length || 0
      totals.additionalEvidenceRefs += rating.humanReview?.additionalEvidenceRefs?.length || 0
    }
  }
  return totals
}

function compactLedger(plan) {
  return plan.rows.map((row) => ({
    releaseOrdinal: row.releaseOrdinal,
    identityKey: row.identityKey,
    workId: row.recordPlan.workId,
    siteId: row.recordPlan.siteId,
    title: row.recordPlan.title,
    target: row.recordPlan.target,
    recordPlanStatus: row.recordPlan.planStatus,
    ratingPlanStatus: row.ratingPlan.planStatus,
    recordBlockers: row.recordPlan.blockers,
    ratingBlockers: row.ratingPlan.blockers,
  }))
}

export function assertExactTransition(plan, lock) {
  const expectedRecords = lock.expectedTransition.recordStatusCounts
  const expectedRatings = lock.expectedTransition.ratingStatusCounts
  const actualRecords = statusCounts(plan.rows, (row) => row.recordPlan.planStatus)
  const actualRatings = statusCounts(plan.rows, (row) => row.ratingPlan.planStatus)
  if (
    !plan.accepted
    || plan.counts.rows !== lock.counts.records
    || plan.counts.blockers !== lock.expectedTransition.blockers
    || JSON.stringify(actualRecords) !== JSON.stringify(expectedRecords)
    || JSON.stringify(actualRatings) !== JSON.stringify(expectedRatings)
  ) {
    throw new Error(`Incremental transition mismatch: ${JSON.stringify({
      accepted: plan.accepted,
      rows: plan.counts.rows,
      blockers: plan.counts.blockers,
      recordStatusCounts: actualRecords,
      ratingStatusCounts: actualRatings,
    })}`)
  }
  return { recordStatusCounts: actualRecords, ratingStatusCounts: actualRatings }
}

export function assertAllowedArguments(args) {
  const unknown = Object.keys(args).filter((key) => !ALLOWED_ARGUMENTS.has(key))
  if (unknown.length) throw new Error(`Forbidden arguments: ${unknown.join(', ')}`)
  return true
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  assertAllowedArguments(args)
  if (args.confirm !== CONFIRM) throw new Error(`--confirm must equal ${CONFIRM}`)

  const expectedMainHead = val(args['expected-main-head'])
  if (!/^[a-f0-9]{40}$/u.test(expectedMainHead)) throw new Error('Invalid expected main head.')
  const baseUrl = assertLoopbackUrl(args.url)
  const inputDir = path.resolve(args.input || '')
  const outputDir = assertOutputDirectory(args['out-dir'])
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD)
  if (!email || !password) throw new Error('Missing existing Payload administrator credentials.')

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const release = readRelease(inputDir)
  const token = await login(baseUrl, email, password)
  const [works, currentRecords, currentRatings] = await Promise.all([
    fetchAll(baseUrl, 'works', token),
    fetchAll(baseUrl, 'radar-public-records', token),
    fetchAll(baseUrl, 'radar-public-ratings', token),
  ])

  const generatedAt = new Date().toISOString()
  const plan = buildUnifiedReleasePlan({
    records: release.records,
    ratings: release.ratings,
    works,
    currentRecords,
    currentRatings,
    release: release.release,
    importedAt: generatedAt,
  })
  const transition = assertExactTransition(plan, release.lock)
  const storage = expectedStorage(plan)
  const ledger = compactLedger(plan)
  const summary = {
    schemaVersion: 'radar-unified-rating-incremental-transition-plan-9988-v01',
    accepted: true,
    generatedAt,
    mainHead: expectedMainHead,
    researchHead: release.lock.researchCommitSha,
    releaseId: release.lock.releaseId,
    sourceState: {
      works: works.length,
      currentPublicRecords: currentRecords.length,
      currentPublicRatings: currentRatings.length,
    },
    transition: {
      rows: plan.counts.rows,
      blockers: plan.counts.blockers,
      ...transition,
      updates: 0,
      deletes: 0,
    },
    expectedStorage: storage,
    safety: {
      payloadContentRead: true,
      payloadContentWrite: false,
      authenticationSessionMayBeCreated: true,
      postgresqlDirectAccess: false,
      updateRequests: 0,
      putRequests: 0,
      deleteRequests: 0,
      recordCreateRequests: 0,
      ratingCreateRequests: 0,
      productionAuthorization: false,
    },
    decision: 'accept_incremental_release_for_backup_and_isolated_rehearsal_planning_only',
  }

  writeJson(path.join(outputDir, 'transition-summary.json'), summary)
  writeJsonl(path.join(outputDir, 'transition-ledger.jsonl'), ledger)
  writeJson(path.join(outputDir, 'blockers.json'), { blockers: plan.blockers })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  run().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
