import { parseDateWithPrecision } from './date-precision.mjs'
import { normalizeText, slugify } from './slug.mjs'

const DEFAULT_WORK_STATUS = {
  rank: 'unknown',
  reviewStatus: 'pending',
  evidenceStrength: 'unassessed',
  status: 'draft',
  hasEvidence: false,
}

export function createRawSourceRecord({ source, sourceRecordId, sourceUrl, fetchedAt, raw }) {
  if (!source) throw new Error('source is required')
  if (!sourceRecordId) throw new Error('sourceRecordId is required')

  return {
    source,
    sourceRecordId: String(sourceRecordId),
    sourceUrl: sourceUrl || '',
    fetchedAt: fetchedAt || new Date().toISOString(),
    raw: raw ?? {},
  }
}

export function sourceRecordToCandidateSource(record) {
  return {
    source: record.source || 'other',
    label: record.source || 'Other',
    externalId: record.sourceRecordId || '',
    url: record.sourceUrl || '',
    fetchedAt: record.fetchedAt || null,
    note: '',
  }
}

export function normalizeAliasList(values) {
  const seen = new Set()
  const aliases = []

  for (const value of values.flat().filter(Boolean)) {
    const alias = normalizeText(value)
    const key = alias.toLowerCase()

    if (!alias || seen.has(key)) continue

    seen.add(key)
    aliases.push({ value: alias })
  }

  return aliases
}

export function createCandidateWork(input) {
  const title = normalizeText(input.title || input.name || input.name_cn || input.originalTitle)
  const originalTitle = normalizeText(input.originalTitle || input.name || '')
  const dateInfo = parseDateWithPrecision(input.firstPublishedLabel || input.firstPublishedAt || input.date)
  const sourceRecord = input.sourceRecord || null
  const fallbackSlug = input.siteId || title || originalTitle || 'candidate-work'

  return {
    siteId: input.siteId ?? null,
    title,
    slug: input.slug || slugify(fallbackSlug, { fallback: 'candidate-work' }),
    rank: input.rank || DEFAULT_WORK_STATUS.rank,
    reviewStatus: input.reviewStatus || DEFAULT_WORK_STATUS.reviewStatus,
    evidenceStrength: input.evidenceStrength || DEFAULT_WORK_STATUS.evidenceStrength,
    originalTitle: originalTitle || undefined,
    aliases: normalizeAliasList(input.aliases || []),
    mediaType: input.mediaType || 'unknown',
    format: input.format || 'unknown',
    firstPublishedAt: dateInfo.date,
    firstPublishedPrecision: dateInfo.precision,
    firstPublishedLabel: dateInfo.label,
    externalIds: input.externalIds || {},
    candidateSources: input.candidateSources || (sourceRecord ? [sourceRecordToCandidateSource(sourceRecord)] : []),
    yuriCandidateScore: input.yuriCandidateScore ?? null,
    isLiteVisible: input.isLiteVisible ?? false,
    isFullVisible: input.isFullVisible ?? false,
    hasEvidence: input.hasEvidence ?? DEFAULT_WORK_STATUS.hasEvidence,
    status: input.status || DEFAULT_WORK_STATUS.status,
  }
}

export function sourceRecordToCandidateWork(record) {
  const raw = record.raw || {}
  const title = raw.title || raw.name_cn || raw.name || record.title || record.name || ''
  const originalTitle = raw.originalTitle || raw.name || ''
  const aliases = [raw.aliases || [], raw.name_cn && raw.name_cn !== title ? raw.name_cn : null, raw.name && raw.name !== title ? raw.name : null]

  return createCandidateWork({
    title,
    originalTitle,
    aliases,
    mediaType: raw.mediaType || record.mediaType || 'unknown',
    format: raw.format || record.format || 'unknown',
    firstPublishedLabel: raw.date || raw.firstPublishedLabel || record.date || record.firstPublishedLabel,
    externalIds: raw.externalIds || record.externalIds || {},
    sourceRecord: record,
    yuriCandidateScore: raw.yuriCandidateScore ?? record.yuriCandidateScore ?? null,
  })
}
