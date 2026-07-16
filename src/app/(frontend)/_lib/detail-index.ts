import type { RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'

import fs from 'node:fs'
import path from 'node:path'

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
  collection: DetailCollection | string
  typeLabel: string
  title: string
  slug: string
  url: string
  rank?: string
  category?: string
  organizationType?: string
  evidenceType?: string
  reviewStatus?: string
  evidenceStrength?: string
  ratingNotice?: string
  radarAssessment?: RadarAssessmentMetrics
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
}

export type DetailIndex = {
  schemaVersion: number
  generatedAt: string
  source: string
  mode: string
  mediaMode?: 'text' | 'enhanced'
  counts: Record<string, number>
  total: number
  items: DetailItem[]
}

const detailIndexPath = path.join(process.cwd(), 'public', 'detail-index.json')

let cachedIndex: DetailIndex | null | undefined

export function readDetailIndex() {
  if (cachedIndex !== undefined) return cachedIndex

  if (!fs.existsSync(detailIndexPath)) {
    cachedIndex = null
    return cachedIndex
  }

  const raw = fs.readFileSync(detailIndexPath, 'utf8')
  cachedIndex = JSON.parse(raw) as DetailIndex
  return cachedIndex
}

export function findDetailItem(collection: DetailCollection, slug: string) {
  const index = readDetailIndex()
  if (!index) return null

  return index.items.find((item) => item.collection === collection && item.slug === slug) || null
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
