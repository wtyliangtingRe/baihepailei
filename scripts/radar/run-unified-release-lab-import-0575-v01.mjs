#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  buildUnifiedReleasePlan,
  validateLockedRelease,
} from './lib/unified-rating-release-plan-v01.mjs'

const CONFIRM = 'RUN-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01'
const LOCK_PATH = 'config/radar-unified-rating-release-0575-v01.lock.json'
const DEFAULT_OUT_DIR = 'data_local/outputs/radar-unified-release-lab-0575-v01/import'
const ALLOWED_MODES = new Set(['fresh', 'incremental'])

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

function assertDataLocalOutput(value) {
  const output = path.resolve(value || DEFAULT_OUT_DIR)
  const root = path.resolve('data_local')
  if (!(output === root || output.startsWith(`${root}${path.sep}`))) {
    throw new Error(`Lab output must stay under data_local: ${output}`)
  }
  return output
}

export function assertIsolatedLabUrl(value) {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  const port = Number(url.port)
  if (url.protocol !== 'http:') throw new Error('Lab URL must use HTTP.')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Lab URL must use loopback.')
  if (!Number.isInteger(port) || port < 31000 || port > 39999 || port === 3000) {
    throw new Error('Lab URL port must be 31000-39999 and not 3000.')
  }
  return url.toString().replace(/\/$/u, '')
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
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
    body: JSON.stringify({ email, password }),
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
    const response = await requestJson(`${baseUrl}/api/${slug}?${query}`, {
      headers: { Authorization: `JWT ${token}` },
    })
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

function payloadDocument(desired) {
  return { ...desired, work: safeWorkId(desired.work) }
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

export function assertPlanForMode(plan, mode, expectedRows = 575) {
  if (!ALLOWED_MODES.has(mode)) throw new Error(`Unsupported lab mode: ${mode}`)
  if (!plan.accepted || plan.counts.blockers !== 0 || plan.counts.rows !== expectedRows) {
    throw new Error(`Lab plan is blocked or has wrong row count: ${JSON.stringify(summarize(plan))}`)
  }
  const allowed = new Set(['ready_create', 'ready_update', 'already_current'])
  for (const status of [
    ...Object.keys(plan.counts.recordStatusCounts),
    ...Object.keys(plan.counts.ratingStatusCounts),
  ]) {
    if (!allowed.has(status)) throw new Error(`Unexpected plan status: ${status}`)
  }
  if (mode === 'fresh') {
    const expected = { ready_create: expectedRows }
    if (
      JSON.stringify(plan.counts.recordStatusCounts) !== JSON.stringify(expected)
      || JSON.stringify(plan.counts.ratingStatusCounts) !== JSON.stringify(expected)
    ) {
      throw new Error(`Fresh lab must create ${expectedRows} facts and ratings: ${JSON.stringify(summarize(plan))}`)
    }
  }
  return plan
}

function assertConverged(plan, expectedRows = 575) {
  const expected = { already_current: expectedRows }
  if (
    !plan.accepted
    || plan.counts.blockers !== 0
    || JSON.stringify(plan.counts.recordStatusCounts) !== JSON.stringify(expected)
    || JSON.stringify(plan.counts.ratingStatusCounts) !== JSON.stringify(expected)
  ) {
    throw new Error(`Lab did not converge: ${JSON.stringify(summarize(plan))}`)
  }
}

function assertRecordWrite(response, desired, label) {
  const doc = response?.doc || response
  if (!doc?.id) throw new Error(`${label} response has no id.`)
  for (const field of ['publicationKey', 'identityKey', 'workIdSnapshot', 'workSiteId', 'recordStatus']) {
    if (val(doc[field]) !== val(desired[field])) throw new Error(`${label} mismatch: ${field}`)
  }
  if (val(doc.work?.id ?? doc.work) !== val(desired.work)) throw new Error(`${label} Work mismatch.`)
  return val(doc.id)
}

async function applyProjection({ baseUrl, slug, token, plan, currentIdField, label }) {
  if (plan.planStatus === 'already_current') return { action: 'skip', id: val(plan[currentIdField]) }
  const desired = payloadDocument(plan.desired)
  if (plan.planStatus === 'ready_create') {
    const response = await requestJson(`${baseUrl}/api/${slug}`, {
      method: 'POST',
      headers: { Authorization: `JWT ${token}` },
      body: JSON.stringify(desired),
    })
    return { action: 'create', id: assertRecordWrite(response, desired, label) }
  }
  if (plan.planStatus === 'ready_update') {
    const currentId = val(plan[currentIdField])
    if (!currentId) throw new Error(`${label} update has no current id.`)
    const response = await requestJson(`${baseUrl}/api/${slug}/${encodeURIComponent(currentId)}`, {
      method: 'PATCH',
      headers: { Authorization: `JWT ${token}` },
      body: JSON.stringify(desired),
    })
    return { action: 'update', id: assertRecordWrite(response, desired, label) }
  }
  throw new Error(`${label} is not executable: ${plan.planStatus}`)
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const forbidden = Object.keys(args).filter((key) => /prod|production|remote|force|delete|rollback|withdraw/u.test(key))
  if (forbidden.length) throw new Error(`Forbidden arguments: ${forbidden.join(', ')}`)
  if (args.confirm !== CONFIRM) throw new Error(`--confirm must equal ${CONFIRM}`)

  const mode = val(args.mode || 'fresh').toLowerCase()
  const baseUrl = assertIsolatedLabUrl(args.url)
  const inputDir = path.resolve(args.input || '')
  const outputDir = assertDataLocalOutput(args['out-dir'])
  const expectedWebsiteCommit = val(args['expected-website-commit'])
  const expectedResearchHead = val(args['expected-research-head'])
  const expectedDatabase = val(args['expected-database'])
  const nonce = val(process.env.RADAR_UNIFIED_RELEASE_LAB_NONCE)
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD)
  if (!nonce || !email || !password) throw new Error('Missing lab nonce or administrator credentials.')
  if (!expectedWebsiteCommit || !expectedResearchHead || !expectedDatabase) throw new Error('Missing expected identities.')

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const release = readRelease(inputDir)
  if (release.lock.researchCommitSha !== expectedResearchHead) throw new Error('Research commit mismatch.')

  const marker = await requestJson(`${baseUrl}/api/radar-unified-release-lab-marker`, {
    headers: { 'x-radar-unified-release-lab-nonce': nonce },
  })
  if (
    marker?.isolatedLab !== true
    || marker?.schemaVersion !== 'radar-unified-release-lab-marker-0575-v01'
    || val(marker.database) !== expectedDatabase
    || val(marker.websiteCommit) !== expectedWebsiteCommit
    || val(marker.researchHead) !== expectedResearchHead
    || val(marker.releaseId) !== release.lock.releaseId
  ) throw new Error(`Lab marker mismatch: ${JSON.stringify(marker)}`)

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
  assertPlanForMode(prePlan, mode, release.lock.counts.records)
  writeJson(path.join(outputDir, 'pre-import-summary.json'), summarize(prePlan))
  writeJsonl(path.join(outputDir, 'pre-import-plan.jsonl'), prePlan.rows)

  const ledger = []
  const counts = { factCreate: 0, factUpdate: 0, factSkip: 0, ratingCreate: 0, ratingUpdate: 0, ratingSkip: 0 }
  try {
    for (const row of prePlan.rows) {
      const fact = await applyProjection({
        baseUrl,
        slug: 'radar-public-records',
        token,
        plan: row.recordPlan,
        currentIdField: 'currentRecordId',
        label: `fact:${row.identityKey}`,
      })
      counts[`fact${fact.action[0].toUpperCase()}${fact.action.slice(1)}`] += 1

      const rating = await applyProjection({
        baseUrl,
        slug: 'radar-public-ratings',
        token,
        plan: row.ratingPlan,
        currentIdField: 'currentRatingId',
        label: `rating:${row.identityKey}`,
      })
      counts[`rating${rating.action[0].toUpperCase()}${rating.action.slice(1)}`] += 1
      ledger.push({
        ordinal: row.releaseOrdinal,
        identityKey: row.identityKey,
        fact,
        rating,
        completedAt: new Date().toISOString(),
      })
      writeJsonl(path.join(outputDir, 'apply-ledger.jsonl'), ledger)
    }
  } catch (error) {
    writeJson(path.join(outputDir, 'failed-receipt.json'), {
      schemaVersion: 'radar-unified-release-lab-import-receipt-0575-v01',
      accepted: false,
      failedAt: new Date().toISOString(),
      counts,
      completedRows: ledger.length,
      error: error?.stack || error?.message || String(error),
      isolatedLabOnly: true,
      productionWrite: false,
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
    schemaVersion: 'radar-unified-release-lab-import-receipt-0575-v01',
    accepted: true,
    completedAt: new Date().toISOString(),
    mode,
    releaseId: release.lock.releaseId,
    websiteCommit: expectedWebsiteCommit,
    researchHead: expectedResearchHead,
    database: expectedDatabase,
    rows: release.lock.counts.records,
    counts,
    postImport: summarize(postPlan),
    safety: {
      isolatedLabOnly: true,
      worksWrite: false,
      legacyRadarWrite: false,
      publicFactsWrite: true,
      publicRatingsWrite: true,
      putRequests: 0,
      deleteRequests: 0,
      omissionMeansDelete: false,
      explicitWithdrawalRequired: true,
      sourceDatabaseWrite: false,
      productionWrite: false,
      productionAuthorization: false,
    },
  }
  writeJson(path.join(outputDir, 'accepted-receipt.json'), receipt)
  return receipt
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/gu, '/')}`) {
  run().then((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  }).catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
