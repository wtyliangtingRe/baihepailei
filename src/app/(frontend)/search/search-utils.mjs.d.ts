export type SearchCollection = 'works' | 'creators' | 'terms' | 'rules'

export type SearchItem = {
  id: string
  collection: SearchCollection | string
  typeLabel: string
  title: string
  slug: string
  url: string
  rank?: string
  originalTitle?: string
  aliases?: string[]
  creators?: string[]
  tags?: string[]
  warnings?: string[]
  relatedTerms?: string[]
  relatedWarnings?: string[]
  category?: string
  legacyXWikiPage?: string
  searchText: string
}

export type SearchResult = SearchItem & {
  score: number
}

export const collectionLabels: Record<string, string>

export function normalizeText(value: unknown): string

export function splitQuery(query: string): string[]

export function scoreItem(item: SearchItem, query: string): number

export function filterAndRankItems(
  items: SearchItem[],
  options?: {
    query?: string
    activeCollection?: string
    limit?: number
  },
): SearchResult[]

export function resultMeta(item: SearchItem): string

export function resultSummary(item: SearchItem): string
