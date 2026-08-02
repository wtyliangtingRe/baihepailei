#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildUnifiedReleasePlan,
  validateLockedRelease,
} from './lib/unified-rating-release-plan-v01.mjs'

const CONFIRM = 'RUN-RADAR-UNIFIED-RELEASE-PRODUCTION-IMPORT-0575-V01'
const LOCK_PATH = 'config/radar-unified-rating-release-0575-v01.lock.json'
const OUTPUT_ROOT = path.resolve('data_local/outputs/radar-unified-release-production-0575-v01')
const ALLOWED_MODES = new Set(['plan', 'apply', 'verify'])
const ALLOWED_ARGUMENTS = new Set([
  'input',
  'url',
  'out-dir',
  'mode',
  'expected-main-head',
  'expected-research-head',
  'expected-database',
  'expected-candidate-sha256',
  'expected-phase',
  'confirm',
])
const OPTIONAL_HUMAN_REVIEW_FIELDS = [
  'reviewerIdentity',
  'reviewedAt',
  'decision',
  'proposedCoreGrade',
  'reasoning',
  'moderationState',
]

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
    throw new Error(`Production importer output must stay under ${OUTPUT_ROOT}: ${output}`)
  }
  return output
}

export function assertProductionUrl(value) {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  const port = Number(url.port)
  if (url.protocol !== 'http:') throw new Error('Production import URL must use HTTP loopback.')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Production import URL must use loopback.')
  if (!Number.isInteger(port) || port < 32000 || port > 39999 || port === 3000) {
    throw new Error('Production import URL port must be 32000-39999 and not 3000.')
  }
  return url.toString().replace(/\/$/u, '')
}

function allowedPost(url, writeKind) {
  const pathname = new URL(url).pathname
  if (writeKind === 'login') return pathname === '/api/users/login'
  if (writeKind === 'record_create') return pathname === '/api/radar-public-records'
  if (writeKind === 'rating_create') return pathname === '/api/radar-public-ratings'
  return false
}

export function assertRequestPolicy({ url, method = 'GET', writeKind = '' }) {
  const normalized = val(method).toUpperCase()
  if (normalized === 'GET') return true
  if (normalized !== 'POST') throw new Error(`Forbidden HTTP method: ${normalized}`)
  if (!allowedPost(url, writeKind)) throw new Error(`Forbidden POST target: ${new URL(url).pathname}`)
  return true
}

async function requestJson(url, options = {}) {
  const method = val(options.method || 'GET').toUpperCase()
  assertRequestPolicy({ url, method, writeKind: options.writeKind })
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `JWT ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 1500)}`)
  return body
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
    const query = new URLSearchParams({ limit: '200', page: String(page), depth: '0' })
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

function safeWorkId(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Unsafe Work relationship ID: ${value}`)
  return number
}

export function payloadDocument(desired) {
  const document = { ...desired, work: safeWorkId(desired.work) }
  if (document.humanReview && typeof document.humanReview === 'object') {
    document.humanReview = { ...document.humanReview }
    for (const field of OPTIONAL_HUMAN_REVIEW_FIELDS) {
      if (!val(document.humanReview[field])) document.humanReview[field] = null
    }
  }
  return document
}

function summarize(plan) {
  return {
    rows: plan.counts.rows,
    recordStatusCounts: plan.counts.recordStatusCounts,
    ratingStatusCounts: plan.counts.ratingStatusCounts,
    blockers: plan.counts.blockers,
    accepted: plan.accepted,
  }
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

export function assertFreshPlan(plan, expectedRows = 575) {
  const expected = { ready_create: expectedRows }
  if (
    !plan.accepted
    || plan.counts.blockers !== 0
    || plan.counts.rows !== expectedRows
    || JSON.stringify(plan.counts.recordStatusCounts) !== JSON.stringify(expected)
    || JSON.stringify(plan.counts.ratingStatusCounts) !== JSON.stringify(expected)
  ) {
    throw new Error(`Production fresh plan mismatch: ${JSON.stringify(summarize(plan))}`)
  }
  return plan
}

export function assertConverged(plan, expectedRows = 575) {
  const expected = { already_current: expectedRows }
  if (
    !plan.accepted
    || plan.counts.blockers !== 0
    || plan.counts.rows !== expectedRows
    || JSON.stringify(plan.counts.recordStatusCounts) !== JSON.stringify(expected)
    || JSON.stringify(plan.counts.ratingStatusCounts) !== JSON.stringify(expected)
  ) {
    throw new Error(`Production import did not converge: ${JSON.stringify(summarize(plan))}`)
  }
  return plan
}

function assertCreatedDocument(response, desired, label) {
  const doc = response?.doc || response
  if (!doc?.id) throw new Error(`${label} response has no id.`)
  for (const field of ['publicationKey', 'identityKey', 'workIdSnapshot', 'workSiteId']) {
    if (val(doc[field]) !== val(desired[field])) throw new Error(`${label} mismatch: ${field}`)
  }
  if (val(doc.work?.id ?? doc.work) !== val(desired.work)) throw new Error(`${label} Work mismatch.`)
  return val(doc.id)
}

async function createProjection({ baseUrl, slug, token, desired, writeKind, label }) {
  const document = payloadDocument(desired)
  const response = await requestJson(`${baseUrl}/api/${slug}`, {
    method: 'POST',
    writeKind,
    token,
    body: document,
  })
  return assertCreatedDocument(response, document, label)
}

function assertMarker(marker, expected) {
  if (
    marker?.productionMode !== true
    || marker?.schemaVersion !== 'radar-unified-release-production-marker-0575-v01'
    || val(marker.phase) !== expected.phase
    || val(marker.database) !== expected.database
    || val(marker.mainHead) !== expected.mainHead
    || val(marker.researchHead) !== expected.researchHead
    || val(marker.releaseId) !== expected.releaseId
    || val(marker.candidateSha256) !== expected.candidateSha256
  ) throw new Error(`Production marker mismatch: ${JSON.stringify(marker)}`)
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

  const mode = val(args.mode).toLowerCase()
  if (!ALLOWED_MODES.has(mode)) throw new Error(`Unsupported production importer mode: ${mode}`)
  const baseUrl = assertProductionUrl(args.url)
  const inputDir = path.resolve(args.input || '')
  const outputDir = assertOutputDirectory(args['out-dir'])
  const expectedMainHead = val(args['expected-main-head'])
  const expectedResearchHead = val(args['expected-research-head'])
  const expectedDatabase = val(args['expected-database'])
  const expectedCandidateSha256 = val(args['expected-candidate-sha256']).toLowerCase()
  const expectedPhase = val(args['expected-phase'])
  const nonce = val(process.env.RADAR_UNIFIED_RELEASE_PRODUCTION_NONCE)
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD)
  if (!nonce || !email || !password) throw new Error('Missing production nonce or administrator credentials.')
  if (!/^[a-f0-9]{40}$/u.test(expectedMainHead) || !/^[a-f0-9]{40}$/u.test(expectedResearchHead)) throw new Error('Invalid expected commit identity.')
  if (!/^[a-f0-9]{64}$/u.test(expectedCandidateSha256)) throw new Error('Invalid expected candidate SHA-256.')
  if (!expectedDatabase || !expectedPhase) throw new Error('Missing expected database or phase.')

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const release = readRelease(inputDir)
  if (release.lock.researchCommitSha !== expectedResearchHead) throw new Error('Research commit mismatch.')

  const marker = await requestJson(`${baseUrl}/api/radar-unified-release-production-marker`, {
    headers: { 'x-radar-unified-release-production-nonce': nonce },
  })
  assertMarker(marker, {
    phase: expectedPhase,
    database: expectedDatabase,
    mainHead: expectedMainHead,
    researchHead: expectedResearchHead,
    releaseId: release.lock.releaseId,
    candidateSha256: expectedCandidateSha256,
  })

  const token = await login(baseUrl, email, password)
  const [works, currentRecords, currentRatings] = await Promise.all([
    fetchAll(baseUrl, 'works', token),
    fetchAll(baseUrl, 'radar-public-records', token),
    fetchAll(baseUrl, 'radar-public-ratings', token),
  ])
  const importedAt = new Date().toISOString()
  const prePlan = buildUnifiedReleasePlan({
    records: release.records,
    ratings: release.ratings,
    works,
    currentRecords,
    currentRatings,
    release: release.release,
    importedAt,
  })
  const storage = expectedStorage(prePlan)
  writeJson(path.join(outputDir, 'pre-import-summary.json'), { ...summarize(prePlan), expectedStorage: storage })
  writeJsonl(path.join(outputDir, 'pre-import-plan.jsonl'), prePlan.rows)

  if (mode === 'verify') {
    assertConverged(prePlan, release.lock.counts.records)
    const receipt = {
      schemaVersion: 'radar-unified-release-production-import-receipt-0575-v01',
      accepted: true,
      completedAt: new Date().toISOString(),
      mode,
      releaseId: release.lock.releaseId,
      mainHead: expectedMainHead,
      researchHead: expectedResearchHead,
      candidateSha256: expectedCandidateSha256,
      database: expectedDatabase,
      postImport: summarize(prePlan),
      productionWrite: false,
      productionAuthorization: false,
      decision: 'accept_production_import_verification_0575_v01',
    }
    writeJson(path.join(outputDir, 'verified-receipt.json'), receipt)
    return receipt
  }

  assertFreshPlan(prePlan, release.lock.counts.records)
  if (mode === 'plan') {
    const receipt = {
      schemaVersion: 'radar-unified-release-production-import-receipt-0575-v01',
      accepted: true,
      completedAt: new Date().toISOString(),
      mode,
      releaseId: release.lock.releaseId,
      mainHead: expectedMainHead,
      researchHead: expectedResearchHead,
      candidateSha256: expectedCandidateSha256,
      database: expectedDatabase,
      rows: release.lock.counts.records,
      preImport: summarize(prePlan),
      expectedStorage: storage,
      productionWrite: false,
      productionAuthorization: false,
      decision: 'accept_exact_fresh_production_plan_0575_v01',
    }
    writeJson(path.join(outputDir, 'plan-receipt.json'), receipt)
    return receipt
  }

  const ledger = []
  const counts = { factCreate: 0, ratingCreate: 0, loginPost: 1, updateRequests: 0, putRequests: 0, deleteRequests: 0 }
  try {
    for (const row of prePlan.rows) {
      const factId = await createProjection({
        baseUrl,
        slug: 'radar-public-records',
        token,
        desired: row.recordPlan.desired,
        writeKind: 'record_create',
        label: `fact:${row.identityKey}`,
      })
      counts.factCreate += 1
      const ratingId = await createProjection({
        baseUrl,
        slug: 'radar-public-ratings',
        token,
        desired: row.ratingPlan.desired,
        writeKind: 'rating_create',
        label: `rating:${row.identityKey}`,
      })
      counts.ratingCreate += 1
      ledger.push({
        ordinal: row.releaseOrdinal,
        identityKey: row.identityKey,
        factId,
        ratingId,
        completedAt: new Date().toISOString(),
      })
      writeJsonl(path.join(outputDir, 'apply-ledger.jsonl'), ledger)
    }
  } catch (error) {
    writeJson(path.join(outputDir, 'failed-receipt.json'), {
      schemaVersion: 'radar-unified-release-production-import-receipt-0575-v01',
      accepted: false,
      failedAt: new Date().toISOString(),
      mode,
      releaseId: release.lock.releaseId,
      mainHead: expectedMainHead,
      researchHead: expectedResearchHead,
      candidateSha256: expectedCandidateSha256,
      database: expectedDatabase,
      counts,
      expectedStorage: storage,
      completedRows: ledger.length,
      error: error?.stack || error?.message || String(error),
      productionWrite: true,
      automaticRetryAllowed: false,
      automaticRollbackAllowed: false,
    })
    throw error
  }

  const [finalRecords, finalRatings] = await Promise.all([
    fetchAll(baseUrl, 'radar-public-records', token),
    fetchAll(baseUrl, 'radar-public-ratings', token),
  ])
  const postPlan = buildUnifiedReleasePlan({
    records: release.records,
    ratings: release.ratings,
    works,
    currentRecords: finalRecords,
    currentRatings: finalRatings,
    release: release.release,
    importedAt: new Date().toISOString(),
  })
  assertConverged(postPlan, release.lock.counts.records)
  writeJson(path.join(outputDir, 'post-import-summary.json'), summarize(postPlan))
  writeJsonl(path.join(outputDir, 'post-import-plan.jsonl'), postPlan.rows)

  const receipt = {
    schemaVersion: 'radar-unified-release-production-import-receipt-0575-v01',
    accepted: true,
    completedAt: new Date().toISOString(),
    mode,
    releaseId: release.lock.releaseId,
    mainHead: expectedMainHead,
    researchHead: expectedResearchHead,
    candidateSha256: expectedCandidateSha256,
    database: expectedDatabase,
    rows: release.lock.counts.records,
    counts,
    expectedStorage: storage,
    postImport: summarize(postPlan),
    safety: {
      worksWrite: false,
      legacyRadarWrite: false,
      publicFactsWrite: true,
      publicRatingsWrite: true,
      updateRequests: 0,
      putRequests: 0,
      deleteRequests: 0,
      omissionMeansDelete: false,
      automaticRetryAllowed: false,
      automaticRollbackAllowed: false,
    },
    productionWrite: true,
    productionAuthorization: true,
    decision: 'accept_production_import_apply_0575_v01',
  }
  writeJson(path.join(outputDir, 'accepted-receipt.json'), receipt)
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  }).catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
