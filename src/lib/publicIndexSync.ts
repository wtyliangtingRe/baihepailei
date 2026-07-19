import fs from 'node:fs'
import path from 'node:path'

import { clearDetailIndexCache, type DetailIndex, type DetailItem } from '../app/(frontend)/_lib/detail-index'
import { clearSearchIndexCache, type SearchIndex, type SearchItem } from '../app/(frontend)/_lib/search-index'
import { isMergedDuplicateWork, mergedWorkReference } from './mergedWork'
import type { RadarAssessmentMetrics } from './radar/assessmentPresentation'
import { richTextToPlainText } from './richTextPlain'
import { effectiveWorkGrade, humanTrackGrade } from './ratingTracks'

type Relation = string | number | { id?: string | number; title?: string; name?: string }
type StewardshipNoticeRelation = string | number | {
  id?: string | number
  slug?: string
  title?: string
  summary?: string
  category?: string
  tone?: string
  severity?: string
  helpUrl?: string
  sortOrder?: number
  isPublic?: boolean
}
type StewardshipNoticeView = {
  id?: string | number
  slug?: string
  title?: string
  summary?: string
  category?: string
  tone?: string
  severity?: string
  helpUrl?: string
  sortOrder?: number
}
type DetailItemWithNotices = DetailItem & { stewardshipNotices?: StewardshipNoticeView[] }
type WorkDoc = {
  id: string | number
  title?: string
  originalTitle?: string
  slug?: string
  rank?: string
  reviewStatus?: string
  evidenceStrength?: string
  ratingNotice?: string
  reviewReasons?: string[] | string
  _status?: string
  catalogStatus?: string
  isLiteVisible?: boolean
  isFullVisible?: boolean
  aliases?: Array<string | { value?: string }>
  localizedTitles?: Array<string | { title?: string }>
  stewardshipNotices?: StewardshipNoticeRelation[]
  summary?: unknown
  radarAssessment?: RadarAssessmentMetrics | null
  humanAssessment?: {
    grade?: string
    status?: string
    note?: string
    sourceSummary?: string
    evidenceStatus?: string
    sourceLinks?: Array<{ label?: string; url?: string }>
    assessedAt?: string
  } | null
  mediaGroup?: string
  mediaType?: string
  format?: string
  firstPublishedAt?: string
  firstPublishedPrecision?: string
  firstPublishedLabel?: string
  creators?: Relation[]
  organizations?: Array<Relation | { organization?: Relation }>
  tags?: Relation[]
  warnings?: Relation[]
  hasEvidence?: boolean
  evidenceNote?: string
  sourceConflictNotes?: string
  sourceLinks?: Array<{ label?: string; url?: string }>
  externalIds?: Record<string, unknown>
  searchText?: string
  updatedAt?: string
  createdAt?: string
}

type SyncResult = {
  search: 'updated' | 'created' | 'skipped' | 'missing'
  detail: 'updated' | 'created' | 'skipped' | 'missing'
}

const searchPath = path.join(process.cwd(), 'public', 'search-index.json')
const detailPath = path.join(process.cwd(), 'public', 'detail-index.json')

function humanAssessmentView(value: WorkDoc['humanAssessment']) {
  if (!value) return undefined
  return {
    grade: text(value.grade),
    status: text(value.status),
    note: text(value.note),
    sourceSummary: text(value.sourceSummary),
    evidenceStatus: text(value.evidenceStatus),
    sourceLinks: Array.isArray(value.sourceLinks) ? value.sourceLinks.filter((link) => link?.url).map((link) => ({ label: text(link.label), url: text(link.url) })) : [],
    assessedAt: text(value.assessedAt),
  }
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function unique(values: unknown[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values.flat(Infinity)) {
    const normalized = text(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

function aliases(value: WorkDoc['aliases']) {
  return unique((value || []).map((item) => typeof item === 'string' ? item : item?.value))
}

function localizedTitles(value: WorkDoc['localizedTitles']) {
  return unique((value || []).map((item) => typeof item === 'string' ? item : item?.title))
}

function reviewReasonValues(value: WorkDoc['reviewReasons']) {
  if (Array.isArray(value)) return unique(value)
  if (typeof value === 'string') return unique(value.split(/[;|,]/u))
  return []
}

function stewardshipNoticeViews(values: WorkDoc['stewardshipNotices']): StewardshipNoticeView[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  return values
    .map<StewardshipNoticeView | null>((value) => {
      if (!value || typeof value !== 'object' || value.isPublic === false) return null
      const title = text(value.title)
      const summary = text(value.summary)
      if (!title && !summary) return null
      return {
        id: value.id,
        slug: text(value.slug),
        title,
        summary,
        category: text(value.category),
        tone: text(value.tone) || 'note',
        severity: text(value.severity) || 'low',
        helpUrl: text(value.helpUrl),
        sortOrder: Number.isFinite(Number(value.sortOrder)) ? Number(value.sortOrder) : 100,
      }
    })
    .filter((value): value is StewardshipNoticeView => value !== null)
    .filter((value) => {
      const key = text(value.id || value.slug || value.title).toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => Number(left.sortOrder || 100) - Number(right.sortOrder || 100))
}

function shouldRemoveFromPublicIndexes(work: WorkDoc) {
  return isMergedDuplicateWork(work)
    || work.catalogStatus === 'archived'
    || (work.isLiteVisible === false && work.isFullVisible === false)
}

function relationName(value: Relation | undefined) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return text(value.title || value.name || value.id)
}

function relationNames(values: Relation[] | undefined) {
  return unique((values || []).map(relationName))
}

function organizationNames(values: WorkDoc['organizations']) {
  return unique((values || []).map((item) => {
    if (item && typeof item === 'object' && 'organization' in item) return relationName(item.organization)
    return relationName(item as Relation)
  }))
}

function searchBlob(work: WorkDoc, existing?: SearchItem) {
  const notices = stewardshipNoticeViews(work.stewardshipNotices)
  return unique([
    work.title,
    work.originalTitle,
    aliases(work.aliases),
    localizedTitles(work.localizedTitles),
    relationNames(work.creators),
    organizationNames(work.organizations),
    relationNames(work.tags),
    relationNames(work.warnings),
    notices.flatMap((notice) => [notice.title, notice.summary]),
    richTextToPlainText(work.summary),
    work.radarAssessment?.sourceSummary,
    work.radarAssessment?.suggestedGrade,
    work.rank,
    work.mediaGroup,
    work.mediaType,
    work.format,
    work.firstPublishedLabel,
    work.searchText,
    work.evidenceNote,
    work.sourceConflictNotes,
    Object.entries(work.externalIds || {}).flatMap(([key, value]) => [key, value]),
    (work.sourceLinks || []).flatMap((item) => [item.label, item.url]),
    existing?.searchText,
  ]).join('\n')
}

function countByCollection(items: Array<{ collection: string }>) {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item.collection] = (counts[item.collection] || 0) + 1
  return counts
}

function atomicJsonWrite(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.rmSync(file, { force: true })
  fs.renameSync(temporary, file)
}

function searchPatch(work: WorkDoc, existing?: SearchItem): SearchItem {
  const recordID = String(work.id)
  const slug = text(work.slug) || existing?.slug || `work-${recordID}`
  const reasons = reviewReasonValues(work.reviewReasons)
  const effectiveRank = effectiveWorkGrade(work)
  const humanGrade = humanTrackGrade(work)
  const mergeTarget = mergedWorkReference(work)
  return {
    ...(existing || {}),
    id: existing?.id || `works:${slug}`,
    recordId: recordID,
    collection: 'works',
    typeLabel: '作品',
    title: text(work.title) || existing?.title || `作品 ${recordID}`,
    slug,
    url: `/works/w-${encodeURIComponent(recordID)}`,
    status: text(work._status) || (existing?.status === 'published' ? 'published' : 'draft'),
    catalogStatus: text(work.catalogStatus) || existing?.catalogStatus || (existing?.status === 'archived' ? 'archived' : 'active'),
    rank: effectiveRank || existing?.rank || 'unknown',
    reviewStatus: text(work.reviewStatus) || existing?.reviewStatus || 'pending',
    evidenceStrength: text(work.evidenceStrength) || existing?.evidenceStrength || 'unassessed',
    ratingNotice: text(work.ratingNotice) || existing?.ratingNotice,
    reviewReasons: reasons.length ? reasons : existing?.reviewReasons,
    radarAssessment: work.radarAssessment || existing?.radarAssessment,
    humanAssessment: humanAssessmentView(work.humanAssessment) || existing?.humanAssessment,
    humanGrade: humanGrade || undefined,
    mergedIntoWorkId: mergeTarget?.id,
    originalTitle: text(work.originalTitle) || existing?.originalTitle,
    aliases: aliases(work.aliases).length ? aliases(work.aliases) : existing?.aliases,
    localizedTitles: localizedTitles(work.localizedTitles).length ? localizedTitles(work.localizedTitles) : existing?.localizedTitles,
    mediaGroup: text(work.mediaGroup) || existing?.mediaGroup || 'unknown',
    mediaType: text(work.mediaType) || existing?.mediaType || 'unknown',
    format: text(work.format) || existing?.format || 'unknown',
    firstPublishedLabel: text(work.firstPublishedLabel) || existing?.firstPublishedLabel,
    creators: relationNames(work.creators).length ? relationNames(work.creators) : existing?.creators,
    organizations: organizationNames(work.organizations).length ? organizationNames(work.organizations) : existing?.organizations,
    tags: relationNames(work.tags).length ? relationNames(work.tags) : existing?.tags,
    warnings: relationNames(work.warnings).length ? relationNames(work.warnings) : existing?.warnings,
    hasEvidence: typeof work.hasEvidence === 'boolean' ? work.hasEvidence : existing?.hasEvidence,
    searchText: searchBlob(work, existing),
  }
}

function detailSections(work: WorkDoc, existing?: DetailItem) {
  const sections = existing?.sections || []
  if (work.summary === undefined) return sections
  const otherSections = sections.filter((section) => section.key !== 'summary')
  const plainText = richTextToPlainText(work.summary)
  if (!plainText) return otherSections
  return [{ key: 'summary', label: '摘要', content: work.summary, plainText }, ...otherSections]
}

function detailPatch(work: WorkDoc, existing?: DetailItem): DetailItem {
  const recordID = String(work.id)
  const slug = text(work.slug) || existing?.slug || `work-${recordID}`
  const reasons = reviewReasonValues(work.reviewReasons)
  const effectiveRank = effectiveWorkGrade(work)
  const humanGrade = humanTrackGrade(work)
  const existingWithNotices = existing as DetailItemWithNotices | undefined
  const noticeValues = stewardshipNoticeViews(work.stewardshipNotices)
  return {
    ...(existing || {}),
    id: existing?.id || `works:${slug}`,
    recordId: recordID,
    collection: 'works',
    typeLabel: '作品',
    title: text(work.title) || existing?.title || `作品 ${recordID}`,
    slug,
    url: `/works/w-${encodeURIComponent(recordID)}`,
    status: text(work._status) || (existing?.status === 'published' ? 'published' : 'draft'),
    catalogStatus: text(work.catalogStatus) || existing?.catalogStatus || (existing?.status === 'archived' ? 'archived' : 'active'),
    rank: effectiveRank || existing?.rank || 'unknown',
    reviewStatus: text(work.reviewStatus) || existing?.reviewStatus || 'pending',
    evidenceStrength: text(work.evidenceStrength) || existing?.evidenceStrength || 'unassessed',
    ratingNotice: text(work.ratingNotice) || existing?.ratingNotice,
    reviewReasons: reasons.length ? reasons : existing?.reviewReasons,
    radarAssessment: work.radarAssessment || existing?.radarAssessment,
    humanAssessment: humanAssessmentView(work.humanAssessment) || existing?.humanAssessment,
    humanGrade: humanGrade || undefined,
    originalTitle: text(work.originalTitle) || existing?.originalTitle,
    aliases: aliases(work.aliases).length ? aliases(work.aliases) : existing?.aliases,
    localizedTitles: localizedTitles(work.localizedTitles).length ? localizedTitles(work.localizedTitles) : existing?.localizedTitles,
    mediaGroup: text(work.mediaGroup) || existing?.mediaGroup || 'unknown',
    mediaType: text(work.mediaType) || existing?.mediaType || 'unknown',
    format: text(work.format) || existing?.format || 'unknown',
    firstPublishedAt: text(work.firstPublishedAt) || existing?.firstPublishedAt,
    firstPublishedPrecision: text(work.firstPublishedPrecision) || existing?.firstPublishedPrecision,
    firstPublishedLabel: text(work.firstPublishedLabel) || existing?.firstPublishedLabel,
    creators: relationNames(work.creators).length ? relationNames(work.creators) : existing?.creators,
    organizations: organizationNames(work.organizations).length ? organizationNames(work.organizations) : existing?.organizations,
    tags: relationNames(work.tags).length ? relationNames(work.tags) : existing?.tags,
    warnings: relationNames(work.warnings).length ? relationNames(work.warnings) : existing?.warnings,
    hasEvidence: typeof work.hasEvidence === 'boolean' ? work.hasEvidence : existing?.hasEvidence,
    evidenceNote: text(work.evidenceNote) || existing?.evidenceNote,
    sourceLinks: Array.isArray(work.sourceLinks) ? work.sourceLinks : existing?.sourceLinks,
    externalIds: work.externalIds
      ? Object.fromEntries(Object.entries(work.externalIds).map(([key, value]) => [key, text(value)]).filter(([, value]) => value))
      : existing?.externalIds,
    updatedAt: text(work.updatedAt) || new Date().toISOString(),
    createdAt: text(work.createdAt) || existing?.createdAt,
    sections: detailSections(work, existing),
    stewardshipNotices: Array.isArray(work.stewardshipNotices) ? noticeValues : existingWithNotices?.stewardshipNotices,
  } as DetailItemWithNotices
}

function updateSearch(work: WorkDoc): SyncResult['search'] {
  if (!fs.existsSync(searchPath)) return 'missing'
  const index = JSON.parse(fs.readFileSync(searchPath, 'utf8')) as SearchIndex
  const position = index.items.findIndex((item) => item.collection === 'works' && String(item.recordId || '') === String(work.id))
  if (shouldRemoveFromPublicIndexes(work)) {
    if (position < 0) return 'skipped'
    index.items.splice(position, 1)
  } else if (position >= 0) index.items[position] = searchPatch(work, index.items[position])
  else if (work._status === 'published') index.items.push(searchPatch(work))
  else return 'skipped'
  index.generatedAt = new Date().toISOString()
  index.counts = countByCollection(index.items)
  index.total = index.items.length
  atomicJsonWrite(searchPath, index)
  clearSearchIndexCache()
  return position >= 0 ? 'updated' : 'created'
}

function updateDetail(work: WorkDoc): SyncResult['detail'] {
  if (!fs.existsSync(detailPath)) return 'missing'
  const index = JSON.parse(fs.readFileSync(detailPath, 'utf8')) as DetailIndex
  const position = index.items.findIndex((item) => item.collection === 'works' && String(item.recordId || '') === String(work.id))
  if (shouldRemoveFromPublicIndexes(work)) {
    if (position < 0) return 'skipped'
    index.items.splice(position, 1)
  } else if (position >= 0) index.items[position] = detailPatch(work, index.items[position])
  else if (work._status === 'published') index.items.push(detailPatch(work))
  else return 'skipped'
  index.generatedAt = new Date().toISOString()
  index.counts = countByCollection(index.items)
  index.total = index.items.length
  atomicJsonWrite(detailPath, index)
  clearDetailIndexCache()
  return position >= 0 ? 'updated' : 'created'
}

export function syncWorkToPublicIndexes(work: WorkDoc): SyncResult {
  return {
    search: updateSearch(work),
    detail: updateDetail(work),
  }
}
