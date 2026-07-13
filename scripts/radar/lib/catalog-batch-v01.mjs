import { createHash } from 'node:crypto'

export const CATALOG_VERSION = 'ai-radar-full-catalog-queue-v0.1'
export const DEFAULT_ASSESSMENT_BATCH_SIZE = 250
export const DEFAULT_RESEARCH_BATCH_SIZE = 100
export const DEFAULT_IDENTITY_BATCH_SIZE = 100

const MANUAL_REVIEW_STATUSES = new Set(['reviewed', 'disputed', 'deprecated'])
const MANUAL_PROTECTION_REASONS = new Set([
  'manual_rating_notice',
  'human_verified',
  'locked',
])

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return [...new Set(list(values).map(val).filter(Boolean))]
}

function stableWorkNumber(value) {
  const parsed = Number(val(value))
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

export function compareCatalogRows(left, right) {
  return stableWorkNumber(left?.workId) - stableWorkNumber(right?.workId)
    || val(left?.workId).localeCompare(val(right?.workId))
    || val(left?.siteId).localeCompare(val(right?.siteId))
    || val(left?.title).localeCompare(val(right?.title))
}

function hasIdentityReason(row) {
  const values = [
    ...list(row?.existingState?.reviewReasons),
    ...list(row?.writeProtection?.reasons),
    ...list(row?.inputAudit?.flags),
    ...list(row?.inputAudit?.blockers),
  ].map(val)
  return values.some((item) => /(identity|duplicate|wrong_summary|series_summary_outlier|merge_review|summary_outlier)/iu.test(item))
}

function hasManualProtection(row) {
  const reasons = new Set(list(row?.writeProtection?.reasons).map(val))
  return MANUAL_REVIEW_STATUSES.has(val(row?.existingState?.reviewStatus))
    || [...MANUAL_PROTECTION_REASONS].some((reason) => reasons.has(reason))
    || row?.existingState?.humanVerified === true
    || row?.existingState?.locked === true
    || val(row?.existingState?.ratingNotice) === 'manual_reviewed'
}

function alreadyAiAssessed(row) {
  return val(row?.existingState?.ratingNotice) === 'ai_synthesized_pending_review'
    || list(row?.existingState?.reviewReasons).map(val).includes('radar_seed_attached')
}

export function classifyCatalogRow(row) {
  const reasons = []
  const workId = val(row?.workId)
  const siteId = val(row?.siteId)
  const readiness = val(row?.inputAudit?.assessmentReadiness)

  if (!workId || !siteId) {
    reasons.push(!workId ? 'missing_work_id' : '', !siteId ? 'missing_site_id' : '')
    return { queue: 'invalid_record', reasons: unique(reasons), actionable: false }
  }

  if (alreadyAiAssessed(row)) {
    return { queue: 'already_ai_assessed', reasons: ['existing_ai_radar_marker'], actionable: false }
  }

  if (hasManualProtection(row)) {
    return { queue: 'protected_or_manual_review', reasons: ['manual_or_human_protection'], actionable: false }
  }

  if (readiness === 'needs_identity_or_series_review' || hasIdentityReason(row)) {
    return { queue: 'identity_review', reasons: ['identity_or_series_review_required'], actionable: true }
  }

  if (row?.writeProtection?.protected === true) {
    return {
      queue: 'protected_or_manual_review',
      reasons: unique(['write_protected', ...list(row?.writeProtection?.reasons)]),
      actionable: false,
    }
  }

  if (readiness === 'needs_external_research') {
    return { queue: 'external_research', reasons: ['content_evidence_missing'], actionable: true }
  }

  if (readiness === 'ready_for_ai_assessment_with_warnings') {
    return { queue: 'ready_for_ai_assessment', reasons: [], actionable: true }
  }

  return { queue: 'unclassified', reasons: ['unexpected_assessment_readiness'], actionable: false }
}

function seriesKey(row) {
  return val(row?.series?.seriesKey) || `work:${val(row?.workId)}`
}

export function splitSeriesAware(rows, batchSize) {
  const size = Number(batchSize)
  if (!Number.isInteger(size) || size < 10 || size > 2000) {
    throw new Error('Batch size must be an integer from 10 to 2000')
  }

  const groups = new Map()
  for (const row of [...rows].sort(compareCatalogRows)) {
    const key = seriesKey(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const orderedGroups = [...groups.entries()].sort((left, right) => {
    const a = left[1][0]
    const b = right[1][0]
    return compareCatalogRows(a, b) || left[0].localeCompare(right[0])
  })

  const batches = []
  let current = []
  for (const [, group] of orderedGroups) {
    if (current.length && current.length + group.length > size) {
      batches.push(current)
      current = []
    }
    current.push(...group)
    if (current.length >= size) {
      batches.push(current)
      current = []
    }
  }
  if (current.length) batches.push(current)
  return batches
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function buildCatalogQueues(rows, {
  assessmentBatchSize = DEFAULT_ASSESSMENT_BATCH_SIZE,
  researchBatchSize = DEFAULT_RESEARCH_BATCH_SIZE,
  identityBatchSize = DEFAULT_IDENTITY_BATCH_SIZE,
} = {}) {
  const inventory = [...rows].sort(compareCatalogRows).map((row) => {
    const classification = classifyCatalogRow(row)
    return {
      ...row,
      catalogQueue: {
        version: CATALOG_VERSION,
        ...classification,
      },
    }
  })

  const queues = {}
  for (const row of inventory) {
    const queue = row.catalogQueue.queue
    if (!queues[queue]) queues[queue] = []
    queues[queue].push(row)
  }

  const batchDefinitions = [
    ['ready_for_ai_assessment', assessmentBatchSize],
    ['external_research', researchBatchSize],
    ['identity_review', identityBatchSize],
  ]
  const batches = {}
  for (const [queue, size] of batchDefinitions) {
    batches[queue] = splitSeriesAware(queues[queue] || [], size)
  }

  return { inventory, queues, batches }
}
