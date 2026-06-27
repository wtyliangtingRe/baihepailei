import { parseDateWithPrecision } from './date-precision.mjs'
import { normalizeMediaGroup } from './media-groups.mjs'
import { normalizeText, slugify } from './slug.mjs'
import { inferCandidateWorkGroup, normalizeWorkGroup } from './work-groups.mjs'

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
  const normalizedValues = Array.isArray(values) ? values.flat() : [values]

  for (const value of normalizedValues.filter(Boolean)) {
    const alias = normalizeText(value)
    const key = alias.toLowerCase()

    if (!alias || seen.has(key)) continue

    seen.add(key)
    aliases.push({ value: alias })
  }

  return aliases
}

function cleanArrayRows(rows) {
  return Array.isArray(rows) ? rows.filter(Boolean) : []
}

function normalizeLocalizedTitleRows(rows) {
  const seen = new Set()
  const output = []

  for (const row of cleanArrayRows(rows)) {
    const title = normalizeText(typeof row === 'string' ? row : row?.title)
    if (!title) continue

    const language = typeof row === 'object' ? row.language || 'unknown' : 'unknown'
    const region = typeof row === 'object' ? row.region || '' : ''
    const kind = typeof row === 'object' ? row.kind || 'alias' : 'alias'
    const key = [title.toLowerCase(), language, region, kind].join('|')
    if (seen.has(key)) continue
    seen.add(key)

    output.push({
      title,
      language,
      region,
      kind,
      isPrimary: typeof row === 'object' ? Boolean(row.isPrimary) : false,
      source: typeof row === 'object' ? row.source || undefined : undefined,
      note: typeof row === 'object' ? row.note || undefined : undefined,
    })
  }

  return output
}

export function createCandidateWork(input) {
  const title = normalizeText(input.title || input.name || input.name_cn || input.originalTitle)
  const originalTitle = normalizeText(input.originalTitle || input.name || '')
  const dateInfo = parseDateWithPrecision(input.firstPublishedLabel || input.firstPublishedAt || input.date)
  const sourceRecord = input.sourceRecord || null
  const fallbackSlug = input.siteId || title || originalTitle || 'candidate-work'
  const mediaType = input.mediaType || 'unknown'
  const mediaGroup = normalizeMediaGroup(input.mediaGroup, mediaType)
  const candidateForGrouping = { ...input, title, originalTitle }

  return {
    siteId: input.siteId ?? null,
    title,
    slug: input.slug || slugify(fallbackSlug, { fallback: 'candidate-work' }),
    rank: input.rank || DEFAULT_WORK_STATUS.rank,
    reviewStatus: input.reviewStatus || DEFAULT_WORK_STATUS.reviewStatus,
    evidenceStrength: input.evidenceStrength || DEFAULT_WORK_STATUS.evidenceStrength,
    originalTitle: originalTitle || undefined,
    aliases: normalizeAliasList(input.aliases || []),
    localizedTitles: normalizeLocalizedTitleRows(input.localizedTitles || []),
    mediaGroup,
    mediaType,
    format: input.format || 'unknown',
    firstPublishedAt: dateInfo.date,
    firstPublishedPrecision: dateInfo.precision,
    firstPublishedLabel: dateInfo.label,
    externalIds: input.externalIds || {},
    candidateSources: input.candidateSources || (sourceRecord ? [sourceRecordToCandidateSource(sourceRecord)] : []),
    externalCoverImages: cleanArrayRows(input.externalCoverImages || []),
    workGroup: normalizeWorkGroup(input.workGroup) || inferCandidateWorkGroup(candidateForGrouping),
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
    localizedTitles: raw.localizedTitles || record.localizedTitles || [],
    mediaGroup: raw.mediaGroup || record.mediaGroup,
    mediaType: raw.mediaType || record.mediaType || 'unknown',
    format: raw.format || record.format || 'unknown',
    firstPublishedLabel: raw.date || raw.firstPublishedLabel || record.date || record.firstPublishedLabel,
    externalIds: raw.externalIds || record.externalIds || {},
    sourceRecord: record,
    externalCoverImages: raw.externalCoverImages || record.externalCoverImages || [],
    workGroup: raw.workGroup || record.workGroup,
    yuriCandidateScore: raw.yuriCandidateScore ?? record.yuriCandidateScore ?? null,
  })
}
