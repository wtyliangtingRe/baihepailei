import type { RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'
import { isMergedDuplicateWork } from '@/lib/mergedWork'

import fs from 'node:fs'
import path from 'node:path'

import { recordIdFromContentRoute } from './content-identity'

export type SearchCollection = 'works' | 'creators' | 'organizations' | 'evidence' | 'terms' | 'rules'
export type ContentVisibility = 'ordinary' | 'adult' | 'restricted'

export type SearchCoverImage = {
  url?: string
  alt?: string
  filename?: string
  width?: number
  height?: number
}

export type RadarResearchPreview = {
  researchStatus?: string
  yuriRelevance?: string
  riskSignals?: string[]
  likelyGrade?: string
  bestGrade?: string
  worstGrade?: string
  sourceSummary?: string
  sourceCount?: number
  unresolvedQuestionCount?: number
  confidencePercent?: number
  recommendedNextAction?: string
  recommendedNextQueue?: string
  importedAt?: string
}

export type SearchItem = {
  id: string
  recordId?: string
  collection: SearchCollection | string
  typeLabel: string
  title: string
  slug: string
  url: string
  status?: string
  rank?: string
  category?: string
  organizationType?: string
  evidenceType?: string
  reviewStatus?: string
  evidenceStrength?: string
  ratingNotice?: string
  reviewOrigin?: string
  reviewReasons?: string[]
  radarAssessment?: RadarAssessmentMetrics
  humanAssessment?: {
    grade?: string
    status?: string
    note?: string
    sourceSummary?: string
    evidenceStatus?: string
    sourceLinks?: DetailSourceLink[]
    assessedAt?: string
  }
  researchPreview?: RadarResearchPreview
  mergedIntoWorkId?: string
  originalTitle?: string
  aliases?: string[]
  localizedTitles?: string[]
  localizedNames?: string[]
  mediaGroup?: string
  mediaType?: string
  format?: string
  firstPublishedLabel?: string
  creators?: string[]
  organizations?: string[]
  relatedWorks?: string[]
  relatedCreators?: string[]
  relatedOrganizations?: string[]
  tags?: string[]
  warnings?: string[]
  relatedTerms?: string[]
  relatedWarnings?: string[]
  hasEvidence?: boolean
  contentVisibility?: ContentVisibility
  contentAdvisories?: string[]
  cover?: SearchCoverImage
  image?: SearchCoverImage
  searchText: string
}

export type SearchIndex = {
  schemaVersion: number
  generatedAt: string
  mode: string
  counts: Record<string, number>
  visibilityCounts?: Record<string, number>
  mediaMode?: 'text' | 'enhanced'
  profile?: 'full' | 'lite'
  total: number
  items: SearchItem[]
}

const searchIndexPath = path.join(process.cwd(), 'public', 'search-index.json')

let cachedIndex: SearchIndex | null | undefined

export function clearSearchIndexCache() {
  cachedIndex = undefined
}

function isRetiredWork(item: SearchItem) {
  if (item.collection !== 'works') return false
  if (item.status === 'archived' || item.reviewStatus === 'deprecated') return true
  const currentID = String(item.recordId || item.id)
  if (item.mergedIntoWorkId && item.mergedIntoWorkId !== currentID) return true
  return isMergedDuplicateWork({
    id: currentID,
    reviewStatus: item.reviewStatus,
    status: item.status,
    searchText: item.searchText,
  })
}

function cleanImportedOrganizationTitle(item: SearchItem): SearchItem {
  if (item.collection !== 'organizations') return item
  const title = String(item.title || '').replace(/^[\s.:：·•・．∙⋅◦]+(?=[\p{L}\p{N}])/u, '')
  return title && title !== item.title ? { ...item, title } : item
}

export function readSearchIndex() {
  if (cachedIndex !== undefined) return cachedIndex

  if (!fs.existsSync(searchIndexPath)) {
    cachedIndex = null
    return cachedIndex
  }

  const raw = fs.readFileSync(searchIndexPath, 'utf8')
  const parsed = JSON.parse(raw) as SearchIndex
  const visibleItems = parsed.items
    .filter((item) => !isRetiredWork(item))
    .map(cleanImportedOrganizationTitle)
  cachedIndex = {
    ...parsed,
    items: visibleItems,
    counts: visibleItems.reduce<Record<string, number>>((counts, item) => {
      counts[item.collection] = (counts[item.collection] || 0) + 1
      return counts
    }, {}),
    total: visibleItems.length,
  }
  return cachedIndex
}

export function findSearchItem(collection: SearchCollection, slug: string) {
  const index = readSearchIndex()
  if (!index) return null

  const canonicalCollection = ['works', 'creators', 'organizations'].includes(collection)
    ? collection as 'works' | 'creators' | 'organizations'
    : null

  if (canonicalCollection) {
    const recordId = recordIdFromContentRoute(canonicalCollection, slug)
    if (recordId) {
      const byRecordId = index.items.find(
        (item) => item.collection === collection && String(item.recordId || '') === recordId,
      )
      if (byRecordId) return byRecordId
    }
  }

  return index.items.find((item) => item.collection === collection && item.slug === slug) || null
}
