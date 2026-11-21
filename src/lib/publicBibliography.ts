import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { PublicMetadata } from './publicMetadata'
import type { CreditEdge, CreatorKind, PublicCreator } from './publicCreatorGraph'
import type { PublicLocalizedTitle } from './publicRelease'

const bookUrl = /^https:\/\/mangabaka\.org\/(?:manga|manhwa|manhua|oel|novel)\/[1-9]\d*\//

type BookBibliography = {
  workId: string
  siteId: string
  url: string
  titles?: PublicLocalizedTitle[]
  firstPublished?: string
}

function readRows<T>(root: string, file: string, sha256: string, records: number): T[] {
  const data = gunzipSync(readFileSync(join(root, file)), { maxOutputLength: 48_000_000 })
  const lines = data.toString('utf8').split(/\r?\n/).filter(Boolean)
  if (createHash('sha256').update(data).digest('hex') !== sha256 || lines.length !== records) {
    throw new Error(`Invalid book bibliography file: ${file}`)
  }
  return lines.map(line => JSON.parse(line))
}

export function addBookBibliography(directory: string, metadata: Map<string, PublicMetadata>) {
  const root = join(directory, '..', 'bibliography-20261121')
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  const seen = new Set<string>()
  for (const row of readRows<BookBibliography>(root, 'books.jsonl.gz', manifest.sha256, manifest.records)) {
    const existing = metadata.get(row.workId)
    if (!existing || existing.siteId !== row.siteId || seen.has(row.workId) ||
        !bookUrl.test(row.url)) {
      throw new Error(`Book bibliography identity mismatch for ${row.workId}`)
    }
    seen.add(row.workId)
    existing.localizedTitles.push(...row.titles || [])
    if (!existing.firstPublished && row.firstPublished) {
      existing.firstPublished = row.firstPublished
      existing.firstPublishedLabel = row.firstPublished
      existing.firstPublishedPrecision = row.firstPublished.length === 4 ? 'year' : 'day'
    }
    existing.sources.push({ title: 'MangaBaka 书目 · 译名与出版资料', url: row.url, tier: 'community' })
  }
  const national = JSON.parse(readFileSync(join(root, 'national-manifest.json'), 'utf8'))
  type PrintEdition = { workId: string; siteId: string; isbn: string; volume: string; nationalLibrary: string }
  for (const row of readRows<PrintEdition>(root, 'national-books.jsonl.gz', national.sha256, national.records)) {
    const existing = metadata.get(row.workId)
    if (!existing || existing.siteId !== row.siteId || !/^97[89]\d{10}$/.test(row.isbn) ||
        !row.nationalLibrary.startsWith('https://ndlsearch.ndl.go.jp/books/')) {
      throw new Error(`Invalid national library edition for ${row.workId}`)
    }
    const volume = /^\d+$/.test(row.volume) ? `第 ${row.volume} 卷` : row.volume
    existing.sources.push({
      title: ['日本国立国会图书馆书目', volume, `ISBN ${row.isbn}`].filter(Boolean).join(' · '),
      url: row.nationalLibrary, tier: 'official',
    })
  }
}

type BookCredit = {
  sourceWorkId: string
  siteId: string
  creatorId: string
  kind: CreatorKind
  name: string
  role: string
  url: string
  authorityUrl: string
  bibliographyUrl: string
}

export function addBookCredits(directory: string, identities: Map<string, string | null | undefined>,
  works: Map<string, { workId: string }>, entities: PublicCreator[], creditsByWork: Map<string, CreditEdge[]>) {
  const root = join(directory, '..', 'bibliography-20261121')
  const manifest = JSON.parse(readFileSync(join(root, 'credits-manifest.json'), 'utf8'))
  const entityFile = 'book-entities.jsonl.gz'
  entities.push(...readRows<PublicCreator>(root, entityFile, manifest.sha256[entityFile], manifest.entities))
  const creditFile = 'book-credits.jsonl.gz'
  for (const row of readRows<BookCredit>(root, creditFile, manifest.sha256[creditFile], manifest.credits)) {
    const workId = works.get(row.sourceWorkId)?.workId
    if (!workId || identities.get(row.sourceWorkId) !== row.siteId ||
        !/^https:\/\/www\.mangaupdates\.com\/series\/[a-z0-9]+(?:\/|$)/.test(row.url) ||
        !/^https:\/\/www\.mangaupdates\.com\/(?:publisher|author)\/[a-z0-9]+(?:\/|$)/.test(row.authorityUrl) ||
        !bookUrl.test(row.bibliographyUrl)) {
      throw new Error(`Book credit identity mismatch for ${row.sourceWorkId}`)
    }
    const edges = creditsByWork.get(workId) || []
    edges.push({ workId, creatorId: row.creatorId, name: row.name, displayName: row.name, role: row.role,
      creditKind: row.kind, bindingBasis: 'book_bibliography', sourceUrls: [row.url, row.authorityUrl, row.bibliographyUrl] })
    creditsByWork.set(workId, edges)
  }
}
