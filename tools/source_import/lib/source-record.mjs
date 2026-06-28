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

const CREDIT_NAME_PREFIX_PATTERNS = [
  /^协力[:：]\s*/u,
  /^協力[:：]\s*/u,
  /^製作协力[:：]\s*/u,
  /^製作協力[:：]\s*/u,
  /^制作协力[:：]\s*/u,
  /^制作協力[:：]\s*/u,
  /^原案协力[:：]\s*/u,
  /^原案協力[:：]\s*/u,
  /^故事原案[:：]\s*/u,
  /^漫画[:：]\s*/u,
  /^漫畫[:：]\s*/u,
  /^漫画版[:：]\s*/u,
  /^漫畫版[:：]\s*/u,
  /^原著[:：]\s*/u,
  /^动画人物设定[:：]\s*/u,
  /^動畫人物設定[:：]\s*/u,
  /^動画人物設定[:：]\s*/u,
  /^人物设定[:：]\s*/u,
  /^人物設定[:：]\s*/u,
  /^角色设计[:：]\s*/u,
  /^角色設計[:：]\s*/u,
  /^キャラクターデザイン[:：]\s*/u,
  /^キャラクター原案[:：]\s*/u,
]
const CREDIT_PUBLICATION_CONTEXT_PATTERN = /[（(][^（）()]*(?:刊|連載|连载|掲載|コミック|COMIC|まんが|漫画|月刊|芳文社|KADOKAWA|一迅社|SBクリエイティブ|マッグガーデン)[^（）()]*[）)]?/giu
const CREDIT_PUBLICATION_FRAGMENT_PATTERN = /^[\p{Letter}\p{Script=Han}ー・\s]+刊[）)]?$/u
const CREDIT_FOOTNOTE_PATTERN = /^\d+(?:\s*-\s*\d+)?[）)]?$/u
const CREDIT_TRAILING_FOOTNOTE_CONTEXT_PATTERN = /[（(]\s*\d+(?:\s*-\s*\d+)?\s*[）)]?$/u
const CREDIT_TRAILING_UNCLOSED_CONTEXT_PATTERN = /\s*[（(][^（）()]+$/u
const CREDIT_TRAILING_TITLE_CONTEXT_PATTERN = /^(.+?)[「『《][^」』》]+[」』》]$/u

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

function cleanText(value) {
  const text = String(value || '').trim()
  return text || undefined
}

function cleanCreditHintName(value) {
  let name = normalizeText(value)
  if (!name) return ''

  for (const pattern of CREDIT_NAME_PREFIX_PATTERNS) {
    name = name.replace(pattern, '')
  }

  name = name
    .replace(CREDIT_PUBLICATION_CONTEXT_PATTERN, '')
    .replace(CREDIT_TRAILING_FOOTNOTE_CONTEXT_PATTERN, '')
    .replace(CREDIT_TRAILING_UNCLOSED_CONTEXT_PATTERN, '')
    .replace(CREDIT_TRAILING_TITLE_CONTEXT_PATTERN, '$1')
    .replace(/^[（(]+|[）)]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()

  if (!name) return ''
  if (CREDIT_FOOTNOTE_PATTERN.test(name)) return ''
  if (CREDIT_PUBLICATION_FRAGMENT_PATTERN.test(name)) return ''

  return name
}

export function normalizeCreditHintRows(rows) {
  const seen = new Set()
  const output = []

  for (const row of cleanArrayRows(rows)) {
    const originalName = normalizeText(typeof row === 'string' ? row : row?.name)
    const name = cleanCreditHintName(originalName)
    if (!name) continue

    const role = typeof row === 'object' ? row.role || 'other' : 'other'
    const originalRole = typeof row === 'object' ? row.originalRole || undefined : undefined
    const key = [name.toLowerCase(), role, originalRole || ''].join('|')
    if (seen.has(key)) continue

    seen.add(key)
    const note = typeof row === 'object' ? row.note || undefined : undefined
    output.push({
      ...(typeof row === 'object' ? row : {}),
      name,
      role,
      originalRole,
      source: typeof row === 'object' ? row.source || undefined : undefined,
      note: originalName && originalName !== name
        ? [note, `cleaned Bangumi hint name from: ${originalName}`].filter(Boolean).join('; ')
        : note,
    })
  }

  return output
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
    summaryText: cleanText(input.summaryText || input.summaryPlainText),
    creatorCreditHints: normalizeCreditHintRows(input.creatorCreditHints || []),
    organizationCreditHints: normalizeCreditHintRows(input.organizationCreditHints || []),
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
    summaryText: raw.summaryText || record.summaryText,
    creatorCreditHints: raw.creatorCreditHints || record.creatorCreditHints,
    organizationCreditHints: raw.organizationCreditHints || record.organizationCreditHints,
    yuriCandidateScore: raw.yuriCandidateScore ?? record.yuriCandidateScore ?? null,
  })
}
