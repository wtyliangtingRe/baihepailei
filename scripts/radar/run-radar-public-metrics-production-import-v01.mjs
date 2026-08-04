#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

import { buildPlan } from './plan-radar-public-metrics-overlay-v01.mjs'
import {
  METRIC_FIELDS,
  assertExecutionTarget,
  assertMarker,
  assertRequestPolicy,
  metricPatch,
} from './radar-public-metrics-production-contract-v01.mjs'

const RELEASE_ID = 'RADAR-PUBLIC-METRICS-10563-0001'
const POLICY_ID = 'radar-public-metrics-policy-v01'
const EXPECTED_ROWS = 10563
const CONFIRM = 'RUN-RADAR-PUBLIC-METRICS-PRODUCTION-IMPORT-V01'
const IMMEDIATE_PRODUCTION_CONFIRM =
  'APPLY-RADAR-PUBLIC-METRICS-10563-NOW-I-ACCEPT-FIRST-SOURCE-PATCH'
const MARKER_PATH = '/api/radar-public-metrics-production-marker'
const OUTPUT_ROOT = path.resolve(
  'data_local/outputs/radar-public-metrics-production-gate-v01',
)
const ALLOWED_MODES = new Set(['plan', 'apply', 'verify'])
const ALLOWED_EXECUTION_MODES = new Set(['rehearsal', 'production'])
const ALLOWED_ARGUMENTS = new Set([
  'release-dir',
  'url',
  'out-dir',
  'mode',
  'execution-mode',
  'expected-tool-head',
  'expected-research-head',
  'expected-database',
  'expected-candidate-sha256',
  'expected-phase',
  'expected-source-container-id',
  'confirm',
])

const DB_COLUMNS = Object.freeze([
  'publication_key',
  'identity_key',
  'record_status',
  'confidence_percent',
  'evidence_coverage_percent',
  'metrics_policy_version',
  'source_metrics_policy_version',
  'relationship_evidence_state',
  'metrics_source_release_id',
  'metrics_calculation_basis_sha256',
  'requires_metric_review',
])

const val = (value) => String(value ?? '').trim()

function parseArgs(argv) {
  const result = {}

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key?.startsWith('--')) throw new Error(`Unknown argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`)
    }
    result[key.slice(2)] = value
    index += 1
  }

  return result
}

export function assertAllowedArguments(args) {
  const unknown = Object.keys(args).filter(
    (key) => !ALLOWED_ARGUMENTS.has(key),
  )
  if (unknown.length > 0) {
    throw new Error(`Forbidden arguments: ${unknown.join(', ')}`)
  }
  return true
}

export function assertImmediateProductionApplyConfirmation({
  executionMode,
  mode,
  confirmation,
}) {
  if (executionMode !== 'production' || mode !== 'apply') {
    return true
  }
  if (val(confirmation) !== IMMEDIATE_PRODUCTION_CONFIRM) {
    throw new Error(
      'Immediate production apply confirmation did not match.',
    )
  }
  return true
}

async function requestImmediateProductionApplyConfirmation({
  executionMode,
  mode,
}) {
  if (executionMode !== 'production' || mode !== 'apply') {
    return null
  }

  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const confirmation = await terminal.question(
      `Type exactly before the first source PATCH:\n`
        + `${IMMEDIATE_PRODUCTION_CONFIRM}\n> `,
    )
    assertImmediateProductionApplyConfirmation({
      executionMode,
      mode,
      confirmation,
    })
    return new Date().toISOString()
  } finally {
    terminal.close()
  }
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(
          `Invalid JSONL at ${filePath}:${index + 1}: ${error.message}`,
        )
      }
    })
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}${
      rows.length > 0 ? '\n' : ''
    }`,
    'utf8',
  )
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8')
}

export function assertRuntimeUrl(value) {
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  const port = Number(url.port)

  if (url.protocol !== 'http:') {
    throw new Error('Runtime URL must use HTTP loopback.')
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Runtime URL must use loopback.')
  }
  if (
    !Number.isInteger(port)
    || port < 32000
    || port > 39999
    || port === 3000
  ) {
    throw new Error(
      'Runtime URL port must be 32000-39999 and not 3000.',
    )
  }

  return url.toString().replace(/\/$/u, '')
}

function assertOutputDirectory(value) {
  const output = path.resolve(value || '')
  if (
    !(
      output === OUTPUT_ROOT
      || output.startsWith(`${OUTPUT_ROOT}${path.sep}`)
    )
  ) {
    throw new Error(`Output must stay under ${OUTPUT_ROOT}: ${output}`)
  }
  return output
}

function payloadRowToPlannerRow(doc) {
  return {
    id: doc.id,
    publication_key: doc.publicationKey,
    identity_key: doc.identityKey,
    record_status: doc.recordStatus,
    confidence_percent: doc.confidencePercent,
    evidence_coverage_percent: doc.evidenceCoveragePercent,
    metrics_policy_version: doc.metricsPolicyVersion,
    source_metrics_policy_version: doc.sourceMetricsPolicyVersion,
    relationship_evidence_state: doc.relationshipEvidenceState,
    metrics_source_release_id: doc.metricsSourceReleaseId,
    metrics_calculation_basis_sha256:
      doc.metricsCalculationBasisSha256,
    requires_metric_review: doc.requiresMetricReview,
  }
}

function summarize(result) {
  return {
    releaseRows: result.summary.releaseRows,
    databaseRows: result.summary.databaseRows,
    schemaReady: result.summary.schemaReady,
    statusCounts: result.summary.statusCounts,
    blockedReasonCounts: result.summary.blockedReasonCounts,
  }
}

export function assertInitialPlan(result, expectedRows = EXPECTED_ROWS) {
  const counts = result?.summary?.statusCounts || {}
  if (
    result?.summary?.schemaReady !== true
    || result?.summary?.releaseRows !== expectedRows
    || result?.summary?.databaseCurrentRows !== expectedRows
    || counts.wouldUpdate !== expectedRows
    || counts.alreadyCurrent !== 0
    || counts.missingRating !== 0
    || counts.identityMismatch !== 0
    || counts.blocked !== 0
  ) {
    throw new Error(
      `Initial update plan mismatch: ${JSON.stringify(summarize(result))}`,
    )
  }
  return result
}

export function assertConvergedPlan(result, expectedRows = EXPECTED_ROWS) {
  const counts = result?.summary?.statusCounts || {}
  if (
    result?.summary?.schemaReady !== true
    || result?.summary?.releaseRows !== expectedRows
    || result?.summary?.databaseCurrentRows !== expectedRows
    || counts.alreadyCurrent !== expectedRows
    || counts.wouldUpdate !== 0
    || counts.missingRating !== 0
    || counts.identityMismatch !== 0
    || counts.blocked !== 0
  ) {
    throw new Error(
      `Converged plan mismatch: ${JSON.stringify(summarize(result))}`,
    )
  }
  return result
}

async function requestJson(url, options = {}) {
  const method = val(options.method || 'GET').toUpperCase()
  assertRequestPolicy({
    url,
    method,
    writeKind: options.writeKind,
  })
  const startedAt = new Date().toISOString()

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token
          ? { Authorization: `JWT ${options.token}` }
          : {}),
        ...(options.headers || {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { raw: text }
    }

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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 1500)}`)
    }
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

async function fetchAllRatings(baseUrl, token, requestLog) {
  const rows = []
  let page = 1
  let totalPages = 1

  do {
    const query = new URLSearchParams({
      limit: '500',
      page: String(page),
      depth: '0',
      showHiddenFields: 'true',
      sort: 'publicationKey',
    })
    const response = await requestJson(
      `${baseUrl}/api/radar-public-ratings?${query}`,
      { token, requestLog },
    )
    rows.push(...(Array.isArray(response?.docs) ? response.docs : []))
    totalPages = Number(response?.totalPages || 1)
    page += 1
  } while (page <= totalPages)

  return rows
}

function readRelease(releaseDirectory) {
  const manifestPath = path.join(releaseDirectory, 'manifest.json')
  const metricsPath = path.join(releaseDirectory, 'metrics.jsonl')
  const checksumPath = path.join(releaseDirectory, 'SHA256SUMS')
  const manifest = readJson(manifestPath)
  const metrics = readJsonl(metricsPath)

  if (manifest.releaseId !== RELEASE_ID) {
    throw new Error('Unexpected Public Metrics Release ID.')
  }
  if (
    manifest.policy?.policyId !== POLICY_ID
    || manifest.policy?.status !== 'frozen'
  ) {
    throw new Error('Public Metrics policy is not the exact frozen policy.')
  }
  if (
    manifest.counts?.metrics !== EXPECTED_ROWS
    || metrics.length !== EXPECTED_ROWS
  ) {
    throw new Error('Public Metrics inventory is not exactly 10,563 rows.')
  }
  if (
    sha256File(metricsPath)
    !== manifest.files?.['metrics.jsonl']?.sha256
  ) {
    throw new Error('Public Metrics SHA-256 differs from manifest.')
  }
  if (!fs.existsSync(checksumPath)) {
    throw new Error('Release SHA256SUMS is missing.')
  }
  for (const gate of [
    'websiteWrite',
    'payloadWrite',
    'postgresqlWrite',
    'productionAuthorization',
  ]) {
    if (manifest.gates?.[gate] !== false) {
      throw new Error(`Unsafe Release gate: ${gate}`)
    }
  }

  return { manifest, metrics }
}

function buildPayloadPlan({ manifest, metrics, documents }) {
  return buildPlan({
    manifest,
    metrics,
    dbRows: documents.map(payloadRowToPlannerRow),
    dbColumns: DB_COLUMNS,
  })
}

function assertPatchedDocument(response, source, desired) {
  const doc = response?.doc || response
  if (!doc?.id || val(doc.id) !== val(source.databaseId)) {
    throw new Error(
      `PATCH returned unexpected rating id: ${source.identityKey}`,
    )
  }
  if (
    val(doc.publicationKey) !== val(source.publicationKey)
    || val(doc.identityKey) !== val(source.identityKey)
  ) {
    throw new Error(`PATCH changed identity: ${source.identityKey}`)
  }
  const actual = metricPatch(doc)
  const expected = metricPatch(desired)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`PATCH response metrics mismatch: ${source.identityKey}`)
  }
  return val(doc.id)
}

async function patchMetricRow({
  baseUrl,
  token,
  row,
  requestLog,
}) {
  const body = metricPatch(row.desired)
  const response = await requestJson(
    `${baseUrl}/api/radar-public-ratings/${row.databaseId}`,
    {
      method: 'PATCH',
      writeKind: 'metric_update',
      token,
      body,
      requestLog,
    },
  )
  return assertPatchedDocument(response, row, row.desired)
}

export function assertModeAuthorization({
  executionMode,
  productionAuthorization,
  mode,
}) {
  if (!ALLOWED_EXECUTION_MODES.has(executionMode)) {
    throw new Error(`Unsupported execution mode: ${executionMode}`)
  }
  assertExecutionTarget({
    executionMode,
    database:
      executionMode === 'production'
        ? 'baihepailei'
        : 'radar_public_metrics_production_gate_rehearsal_contract',
    productionAuthorization,
  })
  if (
    executionMode === 'production'
    && mode === 'apply'
    && productionAuthorization !== true
  ) {
    throw new Error('Production apply requires explicit authorization.')
  }
  if (
    executionMode === 'rehearsal'
    && productionAuthorization !== false
  ) {
    throw new Error('Rehearsal must not carry production authorization.')
  }
  return true
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  assertAllowedArguments(args)

  if (args.confirm !== CONFIRM) {
    throw new Error(`--confirm must equal ${CONFIRM}`)
  }

  const mode = val(args.mode).toLowerCase()
  if (!ALLOWED_MODES.has(mode)) {
    throw new Error(`Unsupported mode: ${mode}`)
  }

  const executionMode = val(args['execution-mode']).toLowerCase()
  const productionAuthorization =
    val(process.env.RADAR_PUBLIC_METRICS_PRODUCTION_AUTHORIZATION)
    === 'true'

  assertModeAuthorization({
    executionMode,
    productionAuthorization,
    mode,
  })

  const baseUrl = assertRuntimeUrl(args.url)
  const outputDirectory = assertOutputDirectory(args['out-dir'])
  const releaseDirectory = path.resolve(args['release-dir'] || '')
  const expectedToolHead =
    val(args['expected-tool-head']).toLowerCase()
  const expectedResearchHead =
    val(args['expected-research-head']).toLowerCase()
  const expectedDatabase = val(args['expected-database'])
  const expectedCandidateSha256 =
    val(args['expected-candidate-sha256']).toLowerCase()
  const expectedPhase = val(args['expected-phase'])
  const expectedSourceContainerId =
    val(args['expected-source-container-id']).toLowerCase()
  const nonce =
    val(process.env.RADAR_PUBLIC_METRICS_PRODUCTION_NONCE)
  const email = val(
    process.env.RADAR_PAYLOAD_EMAIL
      || process.env.PAYLOAD_EXPORT_EMAIL
      || process.env.PAYLOAD_SEED_EMAIL,
  )
  const password = val(
    process.env.RADAR_PAYLOAD_PASSWORD
      || process.env.PAYLOAD_EXPORT_PASSWORD
      || process.env.PAYLOAD_SEED_PASSWORD,
  )

  if (!nonce || !email || !password) {
    throw new Error(
      'Missing production-gate nonce or Payload administrator credentials.',
    )
  }
  if (!/^[a-f0-9]{40}$/u.test(expectedToolHead)) {
    throw new Error('Invalid expected tool HEAD.')
  }
  if (!/^[a-f0-9]{40}$/u.test(expectedResearchHead)) {
    throw new Error('Invalid expected Research HEAD.')
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedCandidateSha256)) {
    throw new Error('Invalid expected candidate SHA-256.')
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedSourceContainerId)) {
    throw new Error('Invalid expected source-container ID.')
  }
  if (!expectedDatabase || expectedPhase !== mode) {
    throw new Error('Expected database or phase mismatch.')
  }

  assertExecutionTarget({
    executionMode,
    database: expectedDatabase,
    productionAuthorization,
  })

  fs.rmSync(outputDirectory, { recursive: true, force: true })
  fs.mkdirSync(outputDirectory, { recursive: true })

  const requestLog = path.join(outputDirectory, 'http-requests.jsonl')
  const updateLedger = path.join(outputDirectory, 'update-ledger.jsonl')
  const { manifest, metrics } = readRelease(releaseDirectory)
  let updates = 0
  let activePhase = 'marker'
  let operatorConfirmedAt = null

  try {
    const marker = await requestJson(`${baseUrl}${MARKER_PATH}`, {
      headers: {
        'x-radar-public-metrics-production-nonce': nonce,
      },
      requestLog,
    })
    assertMarker(marker, {
      executionMode,
      productionAuthorization,
      phase: expectedPhase,
      database: expectedDatabase,
      toolHead: expectedToolHead,
      researchHead: expectedResearchHead,
      candidateSha256: expectedCandidateSha256,
      sourceContainerId: expectedSourceContainerId,
    })

    activePhase = 'login'
    const token = await login(baseUrl, email, password, requestLog)

    activePhase = 'pre_plan'
    const currentRatings =
      await fetchAllRatings(baseUrl, token, requestLog)
    const prePlan = buildPayloadPlan({
      manifest,
      metrics,
      documents: currentRatings,
    })
    writeJson(
      path.join(outputDirectory, 'pre-plan-summary.json'),
      prePlan.summary,
    )
    writeJsonl(
      path.join(outputDirectory, 'pre-plan.jsonl'),
      prePlan.plan,
    )

    if (mode === 'verify') {
      assertConvergedPlan(prePlan)
      const receipt = {
        schemaVersion:
          'radar-public-metrics-production-import-receipt-v01',
        accepted: true,
        executionMode,
        mode,
        completedAt: new Date().toISOString(),
        releaseId: RELEASE_ID,
        toolHead: expectedToolHead,
        researchHead: expectedResearchHead,
        candidateSha256: expectedCandidateSha256,
        sourceContainerId: expectedSourceContainerId,
        database: expectedDatabase,
        statusCounts: prePlan.summary.statusCounts,
        requests: {
          metricPatch: 0,
          postCreate: 0,
          put: 0,
          delete: 0,
        },
        databaseWrite: false,
        productionAuthorization,
        automaticRetryAllowed: false,
        automaticRollbackAllowed: false,
        decision:
          executionMode === 'production'
            ? 'accept_production_metrics_verification_v01'
            : 'accept_disposable_production_gate_verification_v01',
      }
      writeJson(
        path.join(outputDirectory, 'accepted-receipt.json'),
        receipt,
      )
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
      return receipt
    }

    assertInitialPlan(prePlan)

    if (mode === 'plan') {
      const receipt = {
        schemaVersion:
          'radar-public-metrics-production-import-receipt-v01',
        accepted: true,
        executionMode,
        mode,
        completedAt: new Date().toISOString(),
        releaseId: RELEASE_ID,
        toolHead: expectedToolHead,
        researchHead: expectedResearchHead,
        candidateSha256: expectedCandidateSha256,
        sourceContainerId: expectedSourceContainerId,
        database: expectedDatabase,
        rows: EXPECTED_ROWS,
        statusCounts: prePlan.summary.statusCounts,
        requests: {
          metricPatch: 0,
          postCreate: 0,
          put: 0,
          delete: 0,
        },
        databaseWrite: false,
        productionAuthorization,
        automaticRetryAllowed: false,
        automaticRollbackAllowed: false,
        decision:
          executionMode === 'production'
            ? 'accept_production_metrics_plan_v01'
            : 'accept_disposable_production_gate_plan_v01',
      }
      writeJson(
        path.join(outputDirectory, 'accepted-receipt.json'),
        receipt,
      )
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
      return receipt
    }

    activePhase = 'immediate_operator_confirmation'
    operatorConfirmedAt =
      await requestImmediateProductionApplyConfirmation({
        executionMode,
        mode,
      })

    activePhase = 'metric_update'
    for (const row of prePlan.plan) {
      const id = await patchMetricRow({
        baseUrl,
        token,
        row,
        requestLog,
      })
      updates += 1
      appendJsonl(updateLedger, {
        ordinal: updates,
        databaseId: id,
        publicationKey: row.publicationKey,
        identityKey: row.identityKey,
        changedFields: row.changedFields,
        completedAt: new Date().toISOString(),
      })
      if (updates % 100 === 0 || updates === EXPECTED_ROWS) {
        console.log(`Metrics updated: ${updates} / ${EXPECTED_ROWS}`)
      }
    }

    activePhase = 'post_plan'
    const postRatings =
      await fetchAllRatings(baseUrl, token, requestLog)
    const postPlan = buildPayloadPlan({
      manifest,
      metrics,
      documents: postRatings,
    })
    assertConvergedPlan(postPlan)
    writeJson(
      path.join(outputDirectory, 'post-plan-summary.json'),
      postPlan.summary,
    )
    writeJsonl(
      path.join(outputDirectory, 'post-plan.jsonl'),
      postPlan.plan,
    )

    const receipt = {
      schemaVersion:
        'radar-public-metrics-production-import-receipt-v01',
      accepted: true,
      executionMode,
      mode,
      completedAt: new Date().toISOString(),
      releaseId: RELEASE_ID,
      toolHead: expectedToolHead,
      researchHead: expectedResearchHead,
      candidateSha256: expectedCandidateSha256,
      sourceContainerId: expectedSourceContainerId,
      database: expectedDatabase,
      rows: EXPECTED_ROWS,
      counts: {
        metricPatch: updates,
        postCreate: 0,
        put: 0,
        delete: 0,
      },
      postStatusCounts: postPlan.summary.statusCounts,
      fieldsLimitedTo: METRIC_FIELDS,
      operatorConfirmationRequired:
        executionMode === 'production',
      operatorConfirmedAt,
      safety: {
        worksWrite: false,
        publicRecordsWrite: false,
        humanReviewWrite: false,
        createAllowed: false,
        putAllowed: false,
        deleteAllowed: false,
        automaticRetryAllowed: false,
        automaticRollbackAllowed: false,
      },
      databaseWrite: true,
      disposableDatabaseOnly: executionMode === 'rehearsal',
      productionAuthorization,
      decision:
        executionMode === 'production'
          ? 'accept_production_metrics_apply_once_v01'
          : 'accept_disposable_production_gate_apply_v01',
    }
    writeJson(
      path.join(outputDirectory, 'accepted-receipt.json'),
      receipt,
    )
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
    return receipt
  } catch (error) {
    const failure = {
      schemaVersion:
        'radar-public-metrics-production-import-failure-v01',
      accepted: false,
      failedAt: new Date().toISOString(),
      executionMode,
      mode,
      activePhase,
      releaseId: RELEASE_ID,
      toolHead: expectedToolHead,
      researchHead: expectedResearchHead,
      candidateSha256: expectedCandidateSha256,
      sourceContainerId: expectedSourceContainerId,
      database: expectedDatabase,
      metricPatchCount: updates,
      operatorConfirmationCompleted:
        Boolean(operatorConfirmedAt),
      error: val(error?.stack || error),
      safety: {
        productionAuthorization,
        automaticRetryAllowed: false,
        automaticRollbackAllowed: false,
        operatorMustInspectBeforeAnyFurtherAction: true,
      },
    }
    writeJson(
      path.join(outputDirectory, 'failure-receipt.json'),
      failure,
    )
    throw error
  }
}

const invokedDirectly =
  process.argv[1]
  && import.meta.url
    === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  run().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
