#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  buildUnifiedReleasePlan,
  validateLockedRelease,
} from './lib/unified-rating-release-plan-v01.mjs'

const CONFIRM = 'RUN-RADAR-UNIFIED-RATING-INCREMENTAL-PRODUCTION-IMPORT-9988-V01'
const LOCK_PATH = 'config/radar-unified-rating-incremental-release-9988-v01.lock.json'
const OUTPUT_ROOT = path.resolve('data_local/outputs/radar-unified-rating-incremental-production-9988-v01')
const MARKER_PATH = '/api/radar-unified-rating-incremental-production-marker'
const EXPECTED_MARKER_SCHEMA = 'radar-unified-rating-incremental-production-marker-9988-v01'
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

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
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
  const startedAt = new Date().toISOString()
  try {
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
    if (options.requestLog) {
      appendJsonl(options.requestLog, {
        startedAt,
        completedAt: new Date().toISOString(),
        method,
        pathname: new URL(url).pathname,
        writeKind: val(options.writeKind),
        status: response.status,
        ok: response.ok,
      })
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 1500)}`)
    return body
  } catch (error) {
    if (options.requestLog) {
      appendJsonl(options.requestLog, {
        startedAt,
        completedAt: new Date().toISOString(),
        method,
        pathname: new URL(url).pathname,
        writeKind: val(options.writeKind),
        status: null,
        ok: false,
        error: val(error?.message || error),
      })
    }
    throw error
  }
}

async function login(baseUrl, email, password, requestLog) {
  const response = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    writeKind: 'login',
    body: { email, password },
    requestLog,
  })
  if (!response?.token) throw new Error('Payload login returned no token.')
  return response.token
}

async function fetchAll(baseUrl, slug, token, requestLog) {
  const rows = []
  let page = 1
  let totalPages = 1
  do {
    const query = new URLSearchParams({ limit: '500', page: String(page), depth: '0', showHiddenFields: 'true' })
    const response = await requestJson(`${baseUrl}/api/${slug}?${query}`, { token, requestLog })
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

function compactPlan(plan) {
  return plan.rows.map((row) => ({
    releaseOrdinal: row.releaseOrdinal,
    identityKey: row.identityKey,
    target: row.recordPlan.target,
    recordPlanStatus: row.recordPlan.planStatus,
    ratingPlanStatus: row.ratingPlan.planStatus,
    currentRecordId: row.recordPlan.currentRecordId,
    currentRatingId: row.ratingPlan.currentRatingId,
    recordBlockers: row.recordPlan.blockers,
    ratingBlockers: row.ratingPlan.blockers,
  }))
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

export function assertFreshPlan(plan, expectedRows = 9988) {
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

export function assertConverged(plan, expectedRows = 9988) {
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

async function createProjection({ baseUrl, slug, token, desired, writeKind, label, requestLog }) {
  const document = payloadDocument(desired)
  const response = await requestJson(`${baseUrl}/api/${slug}`, {
    method: 'POST',
    writeKind,
    token,
    body: document,
    requestLog,
  })
  return assertCreatedDocument(response, document, label)
}

function assertMarker(marker, expected) {
  if (
    marker?.productionMode !== true
    || marker?.schemaVersion !== EXPECTED_MARKER_SCHEMA
    || val(marker.phase) !== expected.phase
    || val(marker.database) !== expected.database
    || val(marker.mainHead) !== expected.mainHead
    || val(marker.researchHead) !== expected.researchHead
    || val(marker.releaseId) !== expected.releaseId
    || val(marker.candidateSha256) !== expected.candidateSha256
  ) throw new Error(`Incremental production marker mismatch: ${JSON.stringify(marker)}`)
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
  if (!ALLOWED_MODES.has(mode)) throw new Error(`Unsupported importer mode: ${mode}`)
  const baseUrl = assertProductionUrl(args.url)
  const inputDir = path.resolve(args.input || '')
  const outputDir = assertOutputDirectory(args['out-dir'])
  const expectedMainHead = val(args['expected-main-head'])
  const expectedResearchHead = val(args['expected-research-head'])
  const expectedDatabase = val(args['expected-database'])
  const expectedCandidateSha256 = val(args['expected-candidate-sha256']).toLowerCase()
  const expectedPhase = val(args['expected-phase'])
  const nonce = val(process.env.RADAR_UNIFIED_RATING_INCREMENTAL_PRODUCTION_NONCE)
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD)
  if (!nonce || !email || !password) throw new Error('Missing production nonce or administrator credentials.')
  if (!/^[a-f0-9]{40}$/u.test(expectedMainHead) || !/^[a-f0-9]{40}$/u.test(expectedResearchHead)) {
    throw new Error('Invalid expected commit identity.')
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedCandidateSha256)) throw new Error('Invalid expected candidate SHA-256.')
  if (!expectedDatabase || !expectedPhase) throw new Error('Missing expected database or phase.')
  if (expectedPhase !== mode) throw new Error(`Expected phase must match mode: ${expectedPhase} != ${mode}`)

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const requestLog = path.join(outputDir, 'http-requests.jsonl')
  const createLedger = path.join(outputDir, 'create-ledger.jsonl')
  const release = readRelease(inputDir)
  if (release.lock.researchCommitSha !== expectedResearchHead) throw new Error('Research commit mismatch.')

  let recordCreates = 0
  let ratingCreates = 0
  let activePhase = 'marker'
  try {
    const marker = await requestJson(`${baseUrl}${MARKER_PATH}`, {
      headers: { 'x-radar-unified-rating-incremental-production-nonce': nonce },
      requestLog,
    })
    assertMarker(marker, {
      phase: expectedPhase,
      database: expectedDatabase,
      mainHead: expectedMainHead,
      researchHead: expectedResearchHead,
      releaseId: release.lock.releaseId,
      candidateSha256: expectedCandidateSha256,
    })

    activePhase = 'login'
    const token = await login(baseUrl, email, password, requestLog)
    activePhase = 'pre_plan'
    const [works, currentRecords, currentRatings] = await Promise.all([
      fetchAll(baseUrl, 'works', token, requestLog),
      fetchAll(baseUrl, 'radar-public-records', token, requestLog),
      fetchAll(baseUrl, 'radar-public-ratings', token, requestLog),
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
    writeJson(path.join(outputDir, 'pre-import-summary.json'), {
      ...summarize(prePlan),
      sourceState: {
        works: works.length,
        currentPublicRecords: currentRecords.length,
        currentPublicRatings: currentRatings.length,
      },
      expectedStorage: storage,
    })
    writeJsonl(path.join(outputDir, 'pre-import-plan.jsonl'), compactPlan(prePlan))

    if (mode === 'verify') {
      assertConverged(prePlan, release.lock.counts.records)
      const receipt = {
        schemaVersion: 'radar-unified-rating-incremental-production-import-receipt-9988-v01',
        accepted: true,
        completedAt: new Date().toISOString(),
        mode,
        releaseId: release.lock.releaseId,
        mainHead: expectedMainHead,
        researchHead: expectedResearchHead,
        candidateSha256: expectedCandidateSha256,
        database: expectedDatabase,
        postImport: summarize(prePlan),
        safety: {
          recordCreates: 0,
          ratingCreates: 0,
          updateRequests: 0,
          putRequests: 0,
          deleteRequests: 0,
          automaticRetryAllowed: false,
          automaticRollbackAllowed: false,
        },
        productionWrite: false,
        productionAuthorization: false,
        decision: 'accept_incremental_production_import_verification_9988_v01',
      }
      writeJson(path.join(outputDir, 'accepted-receipt.json'), receipt)
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
      return receipt
    }

    assertFreshPlan(prePlan, release.lock.counts.records)
    if (mode === 'plan') {
      const receipt = {
        schemaVersion: 'radar-unified-rating-incremental-production-import-receipt-9988-v01',
        accepted: true,
        completedAt: new Date().toISOString(),
        mode,
        releaseId: release.lock.releaseId,
        mainHead: expectedMainHead,
        researchHead: expectedResearchHead,
        candidateSha256: expectedCandidateSha256,
        database: expectedDatabase,
        rows: prePlan.counts.rows,
        expectedStorage: storage,
        preImport: summarize(prePlan),
        safety: {
          recordCreates: 0,
          ratingCreates: 0,
          updateRequests: 0,
          putRequests: 0,
          deleteRequests: 0,
          automaticRetryAllowed: false,
          automaticRollbackAllowed: false,
        },
        productionWrite: false,
        productionAuthorization: false,
        decision: 'accept_incremental_production_import_plan_9988_v01',
      }
      writeJson(path.join(outputDir, 'accepted-receipt.json'), receipt)
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
      return receipt
    }

    activePhase = 'record_create'
    for (const row of prePlan.rows) {
      const id = await createProjection({
        baseUrl,
        slug: 'radar-public-records',
        token,
        desired: row.recordPlan.desired,
        writeKind: 'record_create',
        label: `Record ${row.releaseOrdinal}`,
        requestLog,
      })
      recordCreates += 1
      appendJsonl(createLedger, {
        releaseOrdinal: row.releaseOrdinal,
        identityKey: row.identityKey,
        kind: 'record',
        id,
        completedAt: new Date().toISOString(),
      })
      if (recordCreates % 100 === 0 || recordCreates === prePlan.rows.length) {
        console.log(`Records created: ${recordCreates} / ${prePlan.rows.length}`)
      }
    }

    activePhase = 'rating_create'
    for (const row of prePlan.rows) {
      const id = await createProjection({
        baseUrl,
        slug: 'radar-public-ratings',
        token,
        desired: row.ratingPlan.desired,
        writeKind: 'rating_create',
        label: `Rating ${row.releaseOrdinal}`,
        requestLog,
      })
      ratingCreates += 1
      appendJsonl(createLedger, {
        releaseOrdinal: row.releaseOrdinal,
        identityKey: row.identityKey,
        kind: 'rating',
        id,
        completedAt: new Date().toISOString(),
      })
      if (ratingCreates % 100 === 0 || ratingCreates === prePlan.rows.length) {
        console.log(`Ratings created: ${ratingCreates} / ${prePlan.rows.length}`)
      }
    }

    activePhase = 'post_plan'
    const [postRecords, postRatings] = await Promise.all([
      fetchAll(baseUrl, 'radar-public-records', token, requestLog),
      fetchAll(baseUrl, 'radar-public-ratings', token, requestLog),
    ])
    const postPlan = buildUnifiedReleasePlan({
      records: release.records,
      ratings: release.ratings,
      works,
      currentRecords: postRecords,
      currentRatings: postRatings,
      release: release.release,
      importedAt,
    })
    assertConverged(postPlan, release.lock.counts.records)
    writeJson(path.join(outputDir, 'post-import-summary.json'), summarize(postPlan))
    writeJsonl(path.join(outputDir, 'post-import-plan.jsonl'), compactPlan(postPlan))

    const receipt = {
      schemaVersion: 'radar-unified-rating-incremental-production-import-receipt-9988-v01',
      accepted: true,
      completedAt: new Date().toISOString(),
      mode,
      releaseId: release.lock.releaseId,
      mainHead: expectedMainHead,
      researchHead: expectedResearchHead,
      candidateSha256: expectedCandidateSha256,
      database: expectedDatabase,
      rows: prePlan.counts.rows,
      counts: {
        recordCreate: recordCreates,
        ratingCreate: ratingCreates,
        updateRequests: 0,
        putRequests: 0,
        deleteRequests: 0,
      },
      expectedStorage: storage,
      postImport: summarize(postPlan),
      safety: {
        worksWrite: false,
        legacyRadarWrite: false,
        publicFactsWrite: true,
        publicRatingsWrite: true,
        omissionMeansDelete: false,
        automaticRetryAllowed: false,
        automaticRollbackAllowed: false,
      },
      productionWrite: true,
      productionAuthorization: true,
      decision: 'accept_incremental_production_import_apply_9988_v01',
    }
    writeJson(path.join(outputDir, 'accepted-receipt.json'), receipt)
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
    return receipt
  } catch (error) {
    const failure = {
      schemaVersion: 'radar-unified-rating-incremental-production-import-failure-9988-v01',
      accepted: false,
      failedAt: new Date().toISOString(),
      mode,
      activePhase,
      releaseId: release.lock.releaseId,
      mainHead: expectedMainHead,
      researchHead: expectedResearchHead,
      candidateSha256: expectedCandidateSha256,
      database: expectedDatabase,
      counts: { recordCreate: recordCreates, ratingCreate: ratingCreates },
      error: val(error?.stack || error),
      safety: {
        automaticRetryAllowed: false,
        automaticRollbackAllowed: false,
        operatorMustInspectBeforeAnyFurtherAction: true,
      },
    }
    writeJson(path.join(outputDir, 'failure-receipt.json'), failure)
    throw error
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  run().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
