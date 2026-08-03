import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const metricFieldMap = [
  ['confidencePercent', 'confidence_percent'],
  ['evidenceCoveragePercent', 'evidence_coverage_percent'],
  ['metricsPolicyVersion', 'metrics_policy_version'],
  ['sourceMetricsPolicyVersion', 'source_metrics_policy_version'],
  ['relationshipEvidenceState', 'relationship_evidence_state'],
  ['metricsSourceReleaseId', 'metrics_source_release_id'],
  ['metricsCalculationBasisSha256', 'metrics_calculation_basis_sha256'],
  ['requiresMetricReview', 'requires_metric_review'],
]

const requiredBaseColumns = [
  'publication_key',
  'identity_key',
  'record_status',
]

const requiredMetricColumns = metricFieldMap.map(([, column]) => column)

function clean(value) {
  return String(value ?? '').trim()
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

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 0) return false

  const normalized = clean(value).toLowerCase()

  if (['true', 't', '1', 'yes'].includes(normalized)) return true
  if (['false', 'f', '0', 'no'].includes(normalized)) return false

  return null
}

function comparableValue(field, value) {
  if (field === 'requiresMetricReview') {
    return normalizeBoolean(value)
  }

  if (
    field === 'confidencePercent'
    || field === 'evidenceCoveragePercent'
  ) {
    if (
      typeof value === 'number'
      && Number.isInteger(value)
    ) {
      return value
    }

    const parsed = Number(value)

    return Number.isInteger(parsed) ? parsed : null
  }

  return clean(value)
}

function desiredValues(metric) {
  return {
    confidencePercent: metric.confidencePercent,
    evidenceCoveragePercent: metric.evidenceCoveragePercent,
    metricsPolicyVersion: metric.metricsPolicyVersion,
    sourceMetricsPolicyVersion: metric.sourceMetricsPolicyVersion,
    relationshipEvidenceState: metric.relationshipEvidenceState,
    metricsSourceReleaseId: metric.releaseId,
    metricsCalculationBasisSha256:
      metric.sourceCalculationBasisSha256,
    requiresMetricReview: metric.requiresMetricReview === true,
  }
}

function currentValues(row) {
  return Object.fromEntries(
    metricFieldMap.map(([field, column]) => [
      field,
      comparableValue(field, row[column]),
    ]),
  )
}

function changedFields(current, desired) {
  return metricFieldMap
    .map(([field]) => field)
    .filter(
      (field) =>
        comparableValue(field, current[field])
        !== comparableValue(field, desired[field]),
    )
}

function countBy(rows, key) {
  const result = {}

  for (const row of rows) {
    const value = clean(row[key]) || 'unknown'
    result[value] = (result[value] || 0) + 1
  }

  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
}

export function buildPlan({
  manifest,
  metrics,
  dbRows,
  dbColumns,
}) {
  if (manifest.releaseId !== 'RADAR-PUBLIC-METRICS-10563-0001') {
    throw new Error('Unexpected public metrics Release ID')
  }

  if (manifest.policy?.status !== 'frozen') {
    throw new Error('Public metrics policy is not frozen')
  }

  if (manifest.gates?.productionAuthorization !== false) {
    throw new Error('Production authorization must remain false')
  }

  const releasePublicationKeys = new Set()
  const releaseIdentityKeys = new Set()

  for (const metric of metrics) {
    const publicationKey = clean(metric.publicationKey)
    const identityKey = clean(metric.identityKey)

    if (!publicationKey.startsWith('work:')) {
      throw new Error(`Invalid publication key: ${publicationKey}`)
    }

    if (releasePublicationKeys.has(publicationKey)) {
      throw new Error(`Duplicate Release publication key: ${publicationKey}`)
    }

    if (releaseIdentityKeys.has(identityKey)) {
      throw new Error(`Duplicate Release identity key: ${identityKey}`)
    }

    releasePublicationKeys.add(publicationKey)
    releaseIdentityKeys.add(identityKey)
  }

  const columnSet = new Set(dbColumns.map(clean))
  const missingBaseColumns = requiredBaseColumns.filter(
    (column) => !columnSet.has(column),
  )

  if (missingBaseColumns.length > 0) {
    throw new Error(
      `Database snapshot lacks base columns: ${missingBaseColumns.join(', ')}`,
    )
  }

  const missingSchemaColumns = requiredMetricColumns.filter(
    (column) => !columnSet.has(column),
  )

  const schemaReady = missingSchemaColumns.length === 0
  const currentDbRows = dbRows.filter(
    (row) => clean(row.record_status) === 'current',
  )

  const dbByPublicationKey = new Map()

  for (const row of currentDbRows) {
    const publicationKey = clean(row.publication_key)

    if (!dbByPublicationKey.has(publicationKey)) {
      dbByPublicationKey.set(publicationKey, [])
    }

    dbByPublicationKey.get(publicationKey).push(row)
  }

  const plan = []
  let wouldUpdateAfterSchema = 0

  for (const metric of metrics) {
    const publicationKey = clean(metric.publicationKey)
    const identityKey = clean(metric.identityKey)
    const matches = dbByPublicationKey.get(publicationKey) || []

    if (matches.length === 0) {
      plan.push({
        status: 'missingRating',
        publicationKey,
        identityKey,
        title: clean(metric.titleSnapshot),
        reason: 'no_current_public_rating',
      })
      continue
    }

    if (matches.length > 1) {
      plan.push({
        status: 'blocked',
        publicationKey,
        identityKey,
        title: clean(metric.titleSnapshot),
        reason: 'duplicate_current_publication_key',
        databaseRowCount: matches.length,
      })
      continue
    }

    const databaseRow = matches[0]
    const databaseIdentityKey = clean(databaseRow.identity_key)

    if (databaseIdentityKey !== identityKey) {
      plan.push({
        status: 'identityMismatch',
        publicationKey,
        identityKey,
        databaseIdentityKey,
        title: clean(metric.titleSnapshot),
        reason: 'publication_key_identity_mismatch',
      })
      continue
    }

    const desired = desiredValues(metric)
    const current = currentValues(databaseRow)
    const changes = changedFields(current, desired)

    if (!schemaReady) {
      wouldUpdateAfterSchema += 1

      plan.push({
        status: 'blocked',
        publicationKey,
        identityKey,
        databaseId: databaseRow.id,
        title: clean(metric.titleSnapshot),
        reason: 'metrics_schema_columns_missing',
        missingSchemaColumns,
        wouldUpdateAfterSchema: true,
        changedFields: changes,
        current,
        desired,
      })
      continue
    }

    if (changes.length === 0) {
      plan.push({
        status: 'alreadyCurrent',
        publicationKey,
        identityKey,
        databaseId: databaseRow.id,
        title: clean(metric.titleSnapshot),
      })
      continue
    }

    plan.push({
      status: 'wouldUpdate',
      publicationKey,
      identityKey,
      databaseId: databaseRow.id,
      title: clean(metric.titleSnapshot),
      changedFields: changes,
      current,
      desired,
    })
  }

  for (const row of currentDbRows) {
    const publicationKey = clean(row.publication_key)

    if (!releasePublicationKeys.has(publicationKey)) {
      plan.push({
        status: 'blocked',
        publicationKey,
        identityKey: clean(row.identity_key),
        databaseId: row.id,
        reason: 'current_database_rating_outside_release',
      })
    }
  }

  const statusCounts = {
    alreadyCurrent: 0,
    wouldUpdate: 0,
    missingRating: 0,
    identityMismatch: 0,
    blocked: 0,
  }

  for (const row of plan) {
    if (Object.hasOwn(statusCounts, row.status)) {
      statusCounts[row.status] += 1
    }
  }

  return {
    summary: {
      schemaVersion:
        'radar-public-metrics-overlay-plan-summary-v01',
      releaseId: manifest.releaseId,
      metricsPolicyVersion: manifest.policy.policyId,
      releaseRows: metrics.length,
      databaseRows: dbRows.length,
      databaseCurrentRows: currentDbRows.length,
      schemaReady,
      missingSchemaColumns,
      statusCounts,
      wouldUpdateAfterSchema,
      blockedReasonCounts: countBy(
        plan.filter((row) => row.status === 'blocked'),
        'reason',
      ),
      exactPublicationKeyOnly: true,
      exactIdentityKeyOnly: true,
      categoricalConfidenceConvertedToNumber: false,
      sourceCountUsedAsCoverage: false,
      humanAssessmentModified: false,
      payloadWriteExecuted: false,
      postgresqlWriteExecuted: false,
      databaseWriteExecuted: false,
      productionAuthorization: false,
    },
    plan,
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows
      .map((row) => JSON.stringify(row))
      .join('\n')
      .concat(rows.length ? '\n' : ''),
    'utf8',
  )
}

function renderMarkdown(summary) {
  const counts = summary.statusCounts

  return [
    '# Radar Public Metrics Overlay Dry-run',
    '',
    `- Release: \`${summary.releaseId}\``,
    `- Policy: \`${summary.metricsPolicyVersion}\``,
    `- Release rows: ${summary.releaseRows}`,
    `- Database rows: ${summary.databaseRows}`,
    `- Current database rows: ${summary.databaseCurrentRows}`,
    `- Schema ready: ${summary.schemaReady}`,
    '',
    '| Status | Count |',
    '| --- | ---: |',
    `| alreadyCurrent | ${counts.alreadyCurrent} |`,
    `| wouldUpdate | ${counts.wouldUpdate} |`,
    `| missingRating | ${counts.missingRating} |`,
    `| identityMismatch | ${counts.identityMismatch} |`,
    `| blocked | ${counts.blocked} |`,
    '',
    `- Would update after schema: ${summary.wouldUpdateAfterSchema}`,
    `- Missing schema columns: ${
      summary.missingSchemaColumns.length
        ? summary.missingSchemaColumns.join(', ')
        : 'none'
    }`,
    '',
    '## Safety',
    '',
    '- Exact publicationKey and identityKey matching only.',
    '- No title matching.',
    '- No categorical confidence conversion.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No production authorization.',
    '',
  ].join('\n')
}

function parseArguments(argv) {
  const result = {}

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]

    if (!key?.startsWith('--') || !value) {
      throw new Error(`Invalid argument near ${key || '<end>'}`)
    }

    result[key.slice(2)] = value
  }

  return result
}

function main() {
  const args = parseArguments(process.argv.slice(2))

  for (const required of [
    'release-dir',
    'database-snapshot',
    'database-columns',
    'output-dir',
  ]) {
    if (!args[required]) {
      throw new Error(`Missing --${required}`)
    }
  }

  const releaseDirectory = path.resolve(args['release-dir'])
  const databaseSnapshotPath =
    path.resolve(args['database-snapshot'])
  const databaseColumnsPath =
    path.resolve(args['database-columns'])
  const outputDirectory = path.resolve(args['output-dir'])

  const manifestPath =
    path.join(releaseDirectory, 'manifest.json')
  const metricsPath =
    path.join(releaseDirectory, 'metrics.jsonl')

  const manifest = readJson(manifestPath)
  const metrics = readJsonl(metricsPath)
  const databaseRows = readJsonl(databaseSnapshotPath)
  const databaseColumnsDocument = readJson(databaseColumnsPath)
  const databaseColumns =
    databaseColumnsDocument.columns || []

  if (metrics.length !== manifest.counts.metrics) {
    throw new Error('Metrics row count differs from manifest')
  }

  if (
    sha256File(metricsPath)
    !== manifest.files['metrics.jsonl'].sha256
  ) {
    throw new Error('Metrics SHA-256 differs from manifest')
  }

  const result = buildPlan({
    manifest,
    metrics,
    dbRows: databaseRows,
    dbColumns: databaseColumns,
  })

  fs.mkdirSync(outputDirectory, { recursive: true })

  const summaryPath =
    path.join(outputDirectory, 'summary.json')
  const planPath =
    path.join(outputDirectory, 'plan.jsonl')
  const markdownPath =
    path.join(outputDirectory, 'summary.md')

  writeJson(summaryPath, result.summary)
  writeJsonl(planPath, result.plan)
  fs.writeFileSync(
    markdownPath,
    `${renderMarkdown(result.summary)}\n`,
    'utf8',
  )

  const checksumFiles = [
    'summary.json',
    'plan.jsonl',
    'summary.md',
  ]

  fs.writeFileSync(
    path.join(outputDirectory, 'SHA256SUMS'),
    checksumFiles
      .map(
        (name) =>
          `${sha256File(path.join(outputDirectory, name))}  ${name}`,
      )
      .join('\n')
      .concat('\n'),
    'utf8',
  )

  process.stdout.write(
    `${JSON.stringify(result.summary, null, 2)}\n`,
  )
}

const invokedDirectly =
  process.argv[1]
  && import.meta.url
    === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
