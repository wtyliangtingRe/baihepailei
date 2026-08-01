#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, validatePublicReleaseDirectory, val } from './lib/public-release-v01.mjs'
import {
  buildCurrentRecordIndexes,
  buildPlanRow,
  buildWorkIndexes,
} from './lib/public-release-plan-v01.mjs'

const CONFIRM = 'RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01'
const DEFAULT_OUT_DIR = 'data_local/outputs/radar-public-release-v01/isolated-lab-import'
const LAB_PORT_MIN = 31000
const LAB_PORT_MAX = 39999

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function ensureDataLocalOutput(value) {
  const outDir = path.resolve(value || DEFAULT_OUT_DIR)
  const dataLocal = path.resolve('data_local')
  if (!(outDir === dataLocal || outDir.startsWith(`${dataLocal}${path.sep}`))) {
    throw new Error(`Lab output must remain under data_local: ${outDir}`)
  }
  return outDir
}

export function assertIsolatedLabUrl(value) {
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  const allowedHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  const port = Number(url.port)
  if (url.protocol !== 'http:') throw new Error('Lab URL must use http on loopback.')
  if (!allowedHost) throw new Error(`Lab URL must use loopback, received: ${url.hostname}`)
  if (!Number.isInteger(port) || port < LAB_PORT_MIN || port > LAB_PORT_MAX) {
    throw new Error(`Lab URL port must be ${LAB_PORT_MIN}-${LAB_PORT_MAX}, received: ${url.port || 'default'}`)
  }
  if (port === 3000) throw new Error('Port 3000 is never accepted for a write-capable lab import.')
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url.toString().replace(/\/$/u, '')
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
  }
  return payload
}

async function login(baseUrl, email, password) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login did not return a token.')
  return result.token
}

async function fetchAll(baseUrl, slug, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0' })
    const result = await requestJson(`${baseUrl}/api/${slug}?${params}`, {
      headers: { Authorization: `JWT ${token}` },
    })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function loadRelease(input) {
  const validation = validatePublicReleaseDirectory(input)
  const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'), 'utf8'))
  const recordsPath = path.join(input, 'records.jsonl')
  const records = fs.readFileSync(recordsPath, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  return {
    validation,
    manifest,
    records,
    recordsPath,
    release: {
      releaseId: manifest.releaseId,
      sourceCommitSha: manifest.source.commitSha,
      policyVersion: manifest.source.policyVersion,
      researchSnapshotId: manifest.source.researchSnapshotId,
      recordsSha256: manifest.files.records.sha256,
    },
  }
}

function buildPlans(records, works, currentRecords, release, importedAt) {
  const workIndexes = buildWorkIndexes(works)
  const currentIndexes = buildCurrentRecordIndexes(currentRecords)
  return records.map((record) => buildPlanRow(record, workIndexes, currentIndexes, release, importedAt))
}

export function summarizePlans(plans) {
  const counts = {}
  for (const row of plans) counts[row.planStatus] = (counts[row.planStatus] || 0) + 1
  return {
    byPlanStatus: Object.fromEntries(Object.entries(counts).sort()),
    readyCreate: plans.filter((row) => row.planStatus === 'ready_create').length,
    readyUpdate: plans.filter((row) => row.planStatus === 'ready_update').length,
    alreadyCurrent: plans.filter((row) => row.planStatus === 'already_current').length,
    blocked: plans.filter((row) => row.planStatus.startsWith('blocked_')).length,
  }
}

function assertInitialPlan(summary, rows) {
  if (
    summary.readyCreate !== rows ||
    summary.readyUpdate !== 0 ||
    summary.alreadyCurrent !== 0 ||
    summary.blocked !== 0
  ) {
    throw new Error(`Initial lab plan is not an exact empty-collection create: ${JSON.stringify(summary)}`)
  }
}

function assertFinalPlan(summary, rows) {
  if (
    summary.alreadyCurrent !== rows ||
    summary.readyCreate !== 0 ||
    summary.readyUpdate !== 0 ||
    summary.blocked !== 0
  ) {
    throw new Error(`Post-import lab plan did not converge to already_current: ${JSON.stringify(summary)}`)
  }
}

function assertCreatedDocument(created, desired) {
  const doc = created?.doc || created
  if (!doc?.id) throw new Error('Created public record response is missing id.')
  for (const field of ['publicationKey', 'identityKey', 'workIdSnapshot', 'workSiteId', 'recordSha256', 'recordStatus']) {
    if (val(doc[field]) !== val(desired[field])) {
      throw new Error(`Created public record field mismatch for ${field}: ${val(doc[field])} != ${val(desired[field])}`)
    }
  }
  const workId = val(doc.work?.id ?? doc.work)
  if (workId !== val(desired.work)) throw new Error(`Created public record work mismatch: ${workId} != ${desired.work}`)
  return val(doc.id)
}

function rejectUnsafeArguments(args) {
  const forbidden = Object.keys(args).filter((key) => /production|prod|remote|force|update-existing|delete|rollback/u.test(key))
  if (forbidden.length) throw new Error(`Forbidden lab importer flags: ${forbidden.join(', ')}`)
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  rejectUnsafeArguments(args)
  if (val(args.confirm) !== CONFIRM) throw new Error(`--confirm must equal ${CONFIRM}`)

  const baseUrl = assertIsolatedLabUrl(val(args.url))
  if (!val(args.input)) throw new Error('--input is required.')
  const input = path.resolve(val(args.input))
  const outDir = ensureDataLocalOutput(val(args['out-dir']))
  const nonce = val(process.env.RADAR_PUBLIC_RELEASE_LAB_NONCE)
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD)
  const expectedWebsiteCommit = val(args['expected-website-commit'])
  const expectedResearchHead = val(args['expected-research-head'])
  const expectedReleaseSourceCommit = val(args['expected-release-source-commit'])
  const expectedDatabase = val(args['expected-database'])
  if (!nonce || !email || !password) throw new Error('Missing lab nonce or Payload administrator credentials.')
  if (!expectedWebsiteCommit || !expectedResearchHead || !expectedReleaseSourceCommit || !expectedDatabase) {
    throw new Error('--expected-website-commit, --expected-research-head, --expected-release-source-commit and --expected-database are required.')
  }

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  const startedAt = new Date().toISOString()
  const receiptPath = path.join(outDir, 'radar-public-release-lab-import-receipt-v01.json')
  const ledgerPath = path.join(outDir, 'radar-public-release-lab-import-ledger-v01.jsonl')
  const prePlanPath = path.join(outDir, 'pre-import-plan.jsonl')
  const postPlanPath = path.join(outDir, 'post-import-plan.jsonl')
  const releaseData = loadRelease(input)
  if (val(releaseData.manifest.source.commitSha) !== expectedReleaseSourceCommit) {
    throw new Error(`Release source commit mismatch: ${releaseData.manifest.source.commitSha} != ${expectedReleaseSourceCommit}`)
  }

  const marker = await requestJson(`${baseUrl}/api/radar-public-release-lab-marker`, {
    headers: { 'x-radar-public-release-lab-nonce': nonce },
  })
  if (
    marker?.isolatedLab !== true ||
    val(marker.schemaVersion) !== 'radar-public-release-lab-marker-v01' ||
    val(marker.database) !== expectedDatabase ||
    val(marker.websiteCommit) !== expectedWebsiteCommit ||
    val(marker.researchHead) !== expectedResearchHead ||
    val(marker.releaseSourceCommit) !== expectedReleaseSourceCommit
  ) {
    throw new Error(`Isolated lab marker mismatch: ${JSON.stringify(marker)}`)
  }

  const token = await login(baseUrl, email, password)
  const works = await fetchAll(baseUrl, 'works', token)
  const existingRecords = await fetchAll(baseUrl, 'radar-public-records', token)
  const importedAt = new Date().toISOString()
  const prePlans = buildPlans(releaseData.records, works, existingRecords, releaseData.release, importedAt)
  const preSummary = summarizePlans(prePlans)
  writeJsonl(prePlanPath, prePlans)
  assertInitialPlan(preSummary, releaseData.records.length)

  const ledger = []
  const createdIds = []
  const expectedFacts = prePlans.reduce((sum, row) => sum + (row.desired?.facts?.length || 0), 0)
  const expectedEvidence = prePlans.reduce((sum, row) => sum + (row.desired?.evidence?.length || 0), 0)
  const expectedSourceRefs = prePlans.reduce(
    (sum, row) => sum + (row.desired?.facts || []).reduce((inner, fact) => inner + (fact.sourceRefs?.length || 0), 0),
    0,
  )

  try {
    for (let index = 0; index < prePlans.length; index += 1) {
      const plan = prePlans[index]
      const created = await requestJson(`${baseUrl}/api/radar-public-records`, {
        method: 'POST',
        headers: { Authorization: `JWT ${token}` },
        body: JSON.stringify(plan.desired),
      })
      const createdId = assertCreatedDocument(created, plan.desired)
      createdIds.push(createdId)
      ledger.push({
        ordinal: index + 1,
        publicationKey: plan.desired.publicationKey,
        identityKey: plan.desired.identityKey,
        workId: plan.desired.work,
        createdId,
        status: 'created_and_verified',
        completedAt: new Date().toISOString(),
      })
      writeJsonl(ledgerPath, ledger)
    }
  } catch (error) {
    writeJson(receiptPath, {
      schemaVersion: 'radar-public-release-lab-import-receipt-v01',
      startedAt,
      failedAt: new Date().toISOString(),
      releaseId: releaseData.manifest.releaseId,
      requestedRows: releaseData.records.length,
      completedRows: createdIds.length,
      error: error?.stack || error?.message || String(error),
      isolatedLabOnly: true,
      productionWrite: false,
      accepted: false,
    })
    throw error
  }

  const finalRecords = await fetchAll(baseUrl, 'radar-public-records', token)
  const postPlans = buildPlans(releaseData.records, works, finalRecords, releaseData.release, new Date().toISOString())
  const postSummary = summarizePlans(postPlans)
  writeJsonl(postPlanPath, postPlans)
  assertFinalPlan(postSummary, releaseData.records.length)

  const receipt = {
    schemaVersion: 'radar-public-release-lab-import-receipt-v01',
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl,
    database: expectedDatabase,
    websiteCommit: expectedWebsiteCommit,
    researchHead: expectedResearchHead,
    releaseSourceCommit: expectedReleaseSourceCommit,
    releaseId: releaseData.manifest.releaseId,
    releaseRecordsSha256: releaseData.manifest.files.records.sha256,
    releaseValidationDecision: releaseData.validation.decision,
    publicReleaseRows: releaseData.records.length,
    worksRead: works.length,
    existingRecordsBefore: existingRecords.length,
    recordsAfter: finalRecords.length,
    expectedFacts,
    expectedEvidence,
    expectedSourceRefs,
    createdRows: createdIds.length,
    initialPlan: preSummary,
    finalPlan: postSummary,
    artifacts: {
      ledger: path.relative(process.cwd(), ledgerPath).replaceAll('\\', '/'),
      ledgerSha256: sha256File(ledgerPath),
      prePlan: path.relative(process.cwd(), prePlanPath).replaceAll('\\', '/'),
      prePlanSha256: sha256File(prePlanPath),
      postPlan: path.relative(process.cwd(), postPlanPath).replaceAll('\\', '/'),
      postPlanSha256: sha256File(postPlanPath),
    },
    safety: {
      isolatedLabMarkerVerified: true,
      loopbackOnly: true,
      highPortOnly: true,
      port3000Rejected: true,
      exactIdentityOnly: true,
      titleOnlyMatching: false,
      workCreation: false,
      worksMutation: false,
      humanAssessmentMutation: false,
      radarAssessmentMutation: false,
      publicRecordCreates: createdIds.length,
      publicRecordUpdates: 0,
      publicRecordDeletes: 0,
      productionWrite: false,
    },
    accepted: true,
    decision: 'accept_isolated_public_release_lab_import',
  }
  writeJson(receiptPath, receipt)
  return receipt
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  run().then((receipt) => console.log(JSON.stringify({ ok: true, receipt }, null, 2))).catch((error) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
}
