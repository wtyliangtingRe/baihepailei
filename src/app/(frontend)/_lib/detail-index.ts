import type { RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'

import fs from 'node:fs'
import path from 'node:path'

import { recordIdFromContentRoute } from './content-identity'

export type DetailCollection = 'works' | 'creators' | 'organizations' | 'evidence' | 'terms' | 'rules'

export type DetailSourceLink = {
  label?: string
  url?: string
}

export type DetailCandidateSource = {
  source?: string
  label?: string
  externalId?: string
  url?: string
}

export type DetailCoverImage = {
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

export type DetailRichTextSection = {
  key: string
  label: string
  content?: unknown
  plainText?: string
}

export type DetailCallout = {
  id?: string
  style?: string
  title?: string
  text?: string
  quote?: string
  image?: {
    url?: string
    alt?: string
    filename?: string
  }
  sourceLabel?: string
  sourceUrl?: string
}

export type WorkRiskMatrix = {
  maleImpact?: string
  relationshipClarity?: string
  endingSafety?: string
  creatorSpeechRisk?: string
  note?: string
}

export type DetailItem = {
  id: string
  recordId?: string
  collection: DetailCollection | string
  typeLabel: string
  title: string
  slug: string
  url: string
  rank?: string
  humanGrade?: string
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
  originalTitle?: string
  aliases?: string[]
  localizedTitles?: string[]
  allTitles?: string[]
  mediaGroup?: string
  mediaType?: string
  format?: string
  firstPublishedAt?: string
  firstPublishedPrecision?: string
  firstPublishedLabel?: string
  creators?: string[]
  organizations?: string[]
  relatedWorks?: string[]
  relatedCreators?: string[]
  relatedOrganizations?: string[]
  tags?: string[]
  warnings?: string[]
  riskMatrix?: WorkRiskMatrix
  relatedTerms?: string[]
  relatedWarnings?: string[]
  relatedTags?: string[]
  examples?: string[]
  cover?: DetailCoverImage
  image?: DetailCoverImage
  description?: string
  capturedAt?: string
  isPublic?: boolean
  hasEvidence?: boolean
  evidenceNote?: string
  sourceLinks?: DetailSourceLink[]
  candidateSources?: DetailCandidateSource[]
  externalIds?: Record<string, string>
  callouts?: DetailCallout[]
  sections: DetailRichTextSection[]
  updatedAt?: string
  createdAt?: string
  status?: string
  catalogStatus?: string
}

export type DetailIndex = {
  schemaVersion: number
  generatedAt: string
  source: string
  mode: string
  mediaMode?: 'text' | 'enhanced'
  profile?: 'full' | 'lite'
  counts: Record<string, number>
  total: number
  items: DetailItem[]
}

const detailIndexPath = path.join(process.cwd(), 'public', 'detail-index.json')

let cachedIndex: DetailIndex | null | undefined
let cachedLookup: Map<string, DetailItem> | undefined

export function clearDetailIndexCache() {
  cachedIndex = undefined
  cachedLookup = undefined
}

export function readDetailIndex() {
  if (cachedIndex !== undefined) return cachedIndex

  if (!fs.existsSync(detailIndexPath)) {
    cachedIndex = null
    return cachedIndex
  }

  const raw = fs.readFileSync(detailIndexPath, 'utf8')
  cachedIndex = JSON.parse(raw) as DetailIndex
  cachedLookup = new Map()
  for (const item of cachedIndex.items) {
    cachedLookup.set(item.collection + ':slug:' + item.slug, item)
    if (item.recordId) cachedLookup.set(item.collection + ':id:' + String(item.recordId), item)
  }
  return cachedIndex
}

export function findDetailItem(collection: DetailCollection, slug: string) {
  const index = readDetailIndex()
  if (!index) return null

  const canonicalCollection = ['works', 'creators', 'organizations'].includes(collection)
    ? collection as 'works' | 'creators' | 'organizations'
    : null

  if (canonicalCollection) {
    const recordId = recordIdFromContentRoute(canonicalCollection, slug)
    if (recordId) {
      const byRecordId = cachedLookup?.get(collection + ':id:' + recordId)
      if (byRecordId) return byRecordId
    }
  }

  return cachedLookup?.get(collection + ':slug:' + slug) || null
}

function uniqueItems(items: DetailItem[]) {
  const seen = new Set<string>()
  const output: DetailItem[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    output.push(item)
  }
  return output.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
}

function evidenceItems() {
  const index = readDetailIndex()
  if (!index) return []
  return index.items.filter((item) => item.collection === 'evidence')
}

function evidenceByRelation(field: 'relatedWorks' | 'relatedCreators' | 'relatedOrganizations', title: string) {
  return uniqueItems(evidenceItems().filter((item) => (item[field] || []).includes(title)))
}

export function findItemsByTitles(collection: DetailCollection, titles: string[] = []) {
  const index = readDetailIndex()
  if (!index) return []

  const wanted = new Set(titles.map((title) => title.trim()).filter(Boolean))
  if (wanted.size === 0) return []

  return uniqueItems(index.items.filter((item) => item.collection === collection && wanted.has(item.title)))
}

export function findEvidenceByWorkTitle(workTitle: string) {
  return evidenceByRelation('relatedWorks', workTitle)
}

export function findEvidenceByCreatorName(creatorName: string) {
  return evidenceByRelation('relatedCreators', creatorName)
}

export function findEvidenceByOrganizationName(organizationName: string) {
  return evidenceByRelation('relatedOrganizations', organizationName)
}

export function findWorksByCreatorName(creatorName: string) {
  const index = readDetailIndex()
  if (!index) return []

  return uniqueItems(
    index.items
      .filter((item) => item.collection === 'works')
      .filter((item) => (item.creators || []).includes(creatorName)),
  )
}

export function findWorksByOrganizationName(organizationName: string) {
  const index = readDetailIndex()
  if (!index) return []

  return uniqueItems(
    index.items
      .filter((item) => item.collection === 'works')
      .filter((item) => (item.organizations || []).includes(organizationName)),
  )
}

export function findOrganizationsByCreatorName(creatorName: string) {
  const works = findWorksByCreatorName(creatorName)
  const organizationNames = works.flatMap((work) => work.organizations || [])
  return findItemsByTitles('organizations', organizationNames)
}

export function findCreatorsByOrganizationName(organizationName: string) {
  const works = findWorksByOrganizationName(organizationName)
  const creatorNames = works.flatMap((work) => work.creators || [])
  return findItemsByTitles('creators', creatorNames)
}
