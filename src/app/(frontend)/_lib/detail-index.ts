import fs from 'node:fs'
import path from 'node:path'

export type DetailCollection = 'works' | 'creators' | 'terms' | 'rules'

export type DetailSourceLink = {
  label?: string
  url?: string
}

export type DetailRichTextSection = {
  key: string
  label: string
  content?: unknown
  plainText?: string
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
  originalTitle?: string
  aliases?: string[]
  creators?: string[]
  tags?: string[]
  warnings?: string[]
  relatedTerms?: string[]
  relatedWarnings?: string[]
  relatedTags?: string[]
  examples?: string[]
  legacyXWikiPage?: string
  hasEvidence?: boolean
  evidenceNote?: string
  sourceLinks?: DetailSourceLink[]
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
