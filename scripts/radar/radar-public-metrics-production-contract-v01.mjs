const RELEASE_ID = 'RADAR-PUBLIC-METRICS-10563-0001'
const SOURCE_DATABASE = 'baihepailei'
const REHEARSAL_DATABASE_PREFIX =
  'radar_public_metrics_production_gate_rehearsal_'
const MARKER_SCHEMA = 'radar-public-metrics-production-marker-v01'

export const METRIC_FIELDS = Object.freeze([
  'confidencePercent',
  'evidenceCoveragePercent',
  'metricsPolicyVersion',
  'sourceMetricsPolicyVersion',
  'relationshipEvidenceState',
  'metricsSourceReleaseId',
  'metricsCalculationBasisSha256',
  'requiresMetricReview',
])

const val = (value) => String(value ?? '').trim()

export function assertLoopbackRuntimeUrl(value) {
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
    !Number.isInteger(port) ||
    port < 32000 ||
    port > 39999 ||
    port === 3000
  ) {
    throw new Error(
      'Runtime URL port must be 32000-39999 and not 3000.',
    )
  }

  return url.toString().replace(/\/$/u, '')
}

export function assertExecutionTarget({
  executionMode,
  database,
  productionAuthorization,
}) {
  const mode = val(executionMode)
  const name = val(database)

  if (!['rehearsal', 'production'].includes(mode)) {
    throw new Error(`Unsupported execution mode: ${mode}`)
  }

  if (mode === 'rehearsal') {
    if (productionAuthorization !== false) {
      throw new Error('Rehearsal cannot carry production authorization.')
    }
    if (
      name === SOURCE_DATABASE ||
      !name.startsWith(REHEARSAL_DATABASE_PREFIX)
    ) {
      throw new Error('Rehearsal database identity is unsafe.')
    }
  } else {
    if (productionAuthorization !== true) {
      throw new Error('Production mode requires explicit authorization.')
    }
    if (name !== SOURCE_DATABASE) {
      throw new Error('Production database identity mismatch.')
    }
  }

  return true
}

const isExactRatingPatch = (pathname) =>
  /^\/api\/radar-public-ratings\/[1-9][0-9]*$/u.test(pathname)

export function assertRequestPolicy({
  url,
  method = 'GET',
  writeKind = '',
}) {
  const normalized = val(method).toUpperCase()
  const pathname = new URL(url).pathname

  if (normalized === 'GET') return true

  if (
    normalized === 'POST' &&
    writeKind === 'login' &&
    pathname === '/api/users/login'
  ) {
    return true
  }

  if (
    normalized === 'PATCH' &&
    writeKind === 'metric_update' &&
    isExactRatingPatch(pathname)
  ) {
    return true
  }

  throw new Error(`Forbidden HTTP request: ${normalized} ${pathname}`)
}

export function assertMetricPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Metric patch must be an object.')
  }

  const keys = Object.keys(patch).sort()
  const expected = [...METRIC_FIELDS].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`Metric patch fields differ: ${keys.join(', ')}`)
  }

  for (const field of [
    'confidencePercent',
    'evidenceCoveragePercent',
  ]) {
    if (
      typeof patch[field] !== 'number' ||
      !Number.isInteger(patch[field]) ||
      patch[field] < 0 ||
      patch[field] > 100
    ) {
      throw new Error(`${field} must be an integer from 0 through 100.`)
    }
  }

  if (patch.metricsPolicyVersion !== 'radar-public-metrics-policy-v01') {
    throw new Error('Unexpected metrics policy version.')
  }
  if (!val(patch.sourceMetricsPolicyVersion)) {
    throw new Error('Missing source metrics policy version.')
  }
  if (
    !['covered', 'partial', 'uncovered'].includes(
      patch.relationshipEvidenceState,
    )
  ) {
    throw new Error('Invalid relationship evidence state.')
  }
  if (patch.metricsSourceReleaseId !== RELEASE_ID) {
    throw new Error('Unexpected metrics source Release.')
  }
  if (
    !/^[a-f0-9]{64}$/u.test(
      val(patch.metricsCalculationBasisSha256),
    )
  ) {
    throw new Error('Invalid metrics calculation-basis SHA-256.')
  }
  if (typeof patch.requiresMetricReview !== 'boolean') {
    throw new Error('requiresMetricReview must be boolean.')
  }

  return true
}

export function metricPatch(desired) {
  const patch = Object.fromEntries(
    METRIC_FIELDS.map((field) => [field, desired[field]]),
  )
  assertMetricPatch(patch)
  return patch
}

export function assertMarker(marker, expected) {
  if (
    marker?.schemaVersion !== MARKER_SCHEMA ||
    marker?.productionMode !== true ||
    val(marker.executionMode) !== val(expected.executionMode) ||
    marker?.productionAuthorization !==
      expected.productionAuthorization ||
    val(marker.phase) !== val(expected.phase) ||
    val(marker.database) !== val(expected.database) ||
    val(marker.toolHead).toLowerCase() !==
      val(expected.toolHead).toLowerCase() ||
    val(marker.researchHead).toLowerCase() !==
      val(expected.researchHead).toLowerCase() ||
    val(marker.releaseId) !== RELEASE_ID ||
    val(marker.candidateSha256).toLowerCase() !==
      val(expected.candidateSha256).toLowerCase() ||
    val(marker.sourceContainerId).toLowerCase() !==
      val(expected.sourceContainerId).toLowerCase()
  ) {
    throw new Error(
      `Production marker mismatch: ${JSON.stringify(marker)}`,
    )
  }

  assertExecutionTarget({
    executionMode: marker.executionMode,
    database: marker.database,
    productionAuthorization: marker.productionAuthorization,
  })

  return true
}

export const PRODUCTION_RUNTIME_CONTRACT = Object.freeze({
  schemaVersion:
    'radar-public-metrics-production-runtime-contract-v01',
  releaseId: RELEASE_ID,
  sourceDatabase: SOURCE_DATABASE,
  rehearsalDatabasePrefix: REHEARSAL_DATABASE_PREFIX,
  markerSchema: MARKER_SCHEMA,
  exactIdPatchOnly: true,
  createAllowed: false,
  putAllowed: false,
  deleteAllowed: false,
  automaticRetryAllowed: false,
  automaticRollbackAllowed: false,
  executableImporterIncluded: true,
  applyOnceRunnerIncluded: true,
  disposableGateRehearsalIncluded: true,
})
