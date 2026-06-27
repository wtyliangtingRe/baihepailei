import fs from 'node:fs'
import path from 'node:path'

export type SearchCollection = 'works' | 'creators' | 'organizations' | 'evidence' | 'terms' | 'rules'

export type SearchCoverImage = {
  url?: string
  alt?: string
  filename?: string
  width?: number
  height?: number
}

export type SearchItem = {
  id: string
  collection: SearchCollection | string
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
  cover?: SearchCoverImage
  image?: SearchCoverImage
  legacyXWikiPage?: string
  searchText: string
}

export type SearchIndex = {
  schemaVersion: number
  generatedAt: string
  mode: string
  counts: Record<string, number>
  total: number
  items: SearchItem[]
}

const searchIndexPath = path.join(process.cwd(), 'public', 'search-index.json')

let cachedIndex: SearchIndex | null | undefined

export function readSearchIndex() {
  if (cachedIndex !== undefined) return cachedIndex

  if (!fs.existsSync(searchIndexPath)) {
    cachedIndex = null
    return cachedIndex
  }

  const raw = fs.readFileSync(searchIndexPath, 'utf8')
  cachedIndex = JSON.parse(raw) as SearchIndex
  return cachedIndex
}

export function findSearchItem(collection: SearchCollection, slug: string) {
  const index = readSearchIndex()
  if (!index) return null

  return index.items.find((item) => item.collection === collection && item.slug === slug) || null
}
