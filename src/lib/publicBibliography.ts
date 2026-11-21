import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { PublicMetadata } from './publicMetadata'
import type { CreditEdge, CreatorKind, PublicCreator } from './publicCreatorGraph'
import type { PublicLocalizedTitle } from './publicRelease'
import type { IdentityReview } from './publicIdentityReview'

const bookUrl = /^https:\/\/mangabaka\.org\/(?:manga|manhwa|manhua|oel|novel)\/[1-9]\d*\//

const creditedBookPublishers = new Set([
  'comic-days.com', 'comic-walker.com', 'data.ichijinsha.co.jp', 'flowercomics.jp', 'j-novel.club',
  'pocket.shonenmagazine.com', 'shonenjumpplus.com', 'tonarinoyj.jp', 'www.hakusensha.co.jp',
  'www.ichijinsha.co.jp', 'www.kadokawa.co.jp', 'www.kodansha.co.jp', 'www.viz.com', 'yenpress.com',
])

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
  const japanese = JSON.parse(readFileSync(join(root, 'japanese-sources-manifest.json'), 'utf8'))
  type EditionSource = { title: string; url: string; sourceType: 'catalog' | 'publisher' | 'reader' | 'author' | 'creditedPublisher' }
  type JapaneseBook = { workId: string; siteId: string; sources: EditionSource[] }
  const checkedBooks = new Set<string>()
  let totalLinks = 0
  for (const row of readRows<JapaneseBook>(root, 'japanese-book-sources.jsonl.gz', japanese.sha256, japanese.records)) {
    const existing = metadata.get(row.workId)
    if (!existing || existing.siteId !== row.siteId || checkedBooks.has(row.workId) || !row.sources.length) {
      throw new Error(`Japanese book identity mismatch for ${row.workId}`)
    }
    checkedBooks.add(row.workId)
    for (const source of row.sources) {
      const url = new URL(source.url)
      const isCatalog = source.sourceType === 'catalog' && (
        (url.host === 'anilist.co' && source.url === `https://anilist.co/manga/${row.siteId.replace('catalog-anilist-', '')}`) ||
        (url.host === 'bgm.tv' && /^\/subject\/[1-9]\d*$/.test(url.pathname)) ||
        (url.host === 'www.yurimiru.com' && /^\/works\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(url.pathname) && !url.search && !url.hash) ||
        (url.host === 'mangadex.org' && /^\/title\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(url.pathname)))
      const isPublisher = source.sourceType === 'publisher' && (
        (url.host === 'www.books.or.jp' && /^\/book-details\/97[89]\d{10}$/.test(url.pathname)) ||
        (url.host === 'www.cmoa.jp' && /^\/title\/[1-9]\d*\/$/.test(url.pathname)) ||
        (url.host === 'booklive.jp' && /^\/product\/index\/title_id\/\d+\/vol_no\/\d+$/.test(url.pathname)))
      const isReader = source.sourceType === 'reader' && (
        (url.host === 'booklive.jp' && /^\/review\/list\/title_id\/\d+\/vol_no\/\d+$/.test(url.pathname)) ||
        (url.host === 'dynasty-scans.com' && /^\/forum\/topics\/[1-9]\d*-[a-z0-9_-]+$/.test(url.pathname)))
      const isOriginal = source.sourceType === 'author' && url.host === 'www.pixiv.net' &&
        /^\/artworks\/[1-9]\d*$/.test(url.pathname)
      const isCreditedPublisher = source.sourceType === 'creditedPublisher' &&
        creditedBookPublishers.has(url.host) && url.pathname.length > 1
      const official = isPublisher || isOriginal || isCreditedPublisher
      if (url.protocol !== 'https:' || url.username || url.password || !source.title || !(isCatalog || official || isReader)) {
        throw new Error(`Invalid Japanese edition source for ${row.workId}`)
      }
      const tier = official ? 'official' : 'community'
      if (!existing.sources.some(ref => ref.url === source.url && ref.tier === tier)) {
        existing.sources.push({ title: source.title, url: source.url, tier })
      }
      totalLinks++
    }
  }
  if (totalLinks !== japanese.links) throw new Error('Japanese book source count mismatch')
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
    edges.push({ workId, sourceWorkId: row.sourceWorkId, creatorId: row.creatorId, name: row.name, displayName: row.name, role: row.role,
      creditKind: row.kind, bindingBasis: 'book_bibliography', sourceUrls: [row.url, row.authorityUrl, row.bibliographyUrl] })
    creditsByWork.set(workId, edges)
  }
}

type CatalogStaff = Pick<BookCredit, 'sourceWorkId' | 'siteId' | 'creatorId' | 'kind' | 'name' | 'role'> & {
  subject: number
  person: number
  registryUrl?: string
}

type VerifiedBookAuthor = {
  workId: string
  siteId: string
  staff: number
  creatorId: string
  name: string
  publicRole: string
  publisherIsbn?: string
} & (
  | { publisherIsbn: string; mediaArtsId?: string; libraryId?: string }
  | { subject: number; person: number }
  | { seriesId: string; authorId: string; libraryId?: string; mediaArtsId?: string }
  | { libraryId: string; mediaArtsId?: string }
  | { mediaArtsId: string; libraryId?: string }
)

function bookAuthorReferences(row: VerifiedBookAuthor): string[] {
  const sources: string[] = []
  if ('subject' in row) {
    if ([row.subject, row.person].every(id => Number.isSafeInteger(id) && id > 0)) {
      sources.push(`https://bgm.tv/subject/${row.subject}/persons`, `https://bgm.tv/person/${row.person}`)
    }
  } else {
    if ('seriesId' in row) {
      if (!/^[0-9a-z]+$/.test(row.seriesId) || !/^[0-9a-z]+$/.test(row.authorId)) {
        throw new Error(`Invalid book author or series identifier for ${row.workId}`)
      }
      sources.push(`https://www.mangaupdates.com/series/${row.seriesId}`, `https://www.mangaupdates.com/author/${row.authorId}`)
    }
    if (row.mediaArtsId) {
      if (!/^M[1-9]\d*$/.test(row.mediaArtsId)) throw new Error(`Invalid Media Arts record for ${row.workId}`)
      sources.push(`https://mediaarts-db.artmuseums.go.jp/id/${row.mediaArtsId}`)
    }
    if (row.libraryId) {
      if (!/^R[0-9A-Z-]+$/.test(row.libraryId)) throw new Error(`Invalid library record for ${row.workId}`)
      sources.push(`https://ndlsearch.ndl.go.jp/books/${row.libraryId}`)
    }
  }
  if (row.publisherIsbn) {
    if (!/^978408\d{7}$/.test(row.publisherIsbn)) throw new Error(`Invalid Shueisha edition for ${row.workId}`)
    sources.push(`https://www.s-manga.net/items/contents.html?isbn=${row.publisherIsbn}`)
  }
  if (!sources.length) throw new Error(`Missing edition or author record for ${row.workId}`)
  return sources
}

export function addVerifiedBookAuthors(directory: string, identities: Map<string, string | null | undefined>,
  works: Map<string, { workId: string }>, review: NonNullable<IdentityReview>) {
  const root = join(directory, '..', 'bibliography-20261121')
  const manifest = JSON.parse(readFileSync(join(root, 'verified-authors-manifest.json'), 'utf8'))
  const entities = 'verified-author-entities.jsonl.gz'
  review.entities.push(...readRows<PublicCreator>(root, entities, manifest.sha256[entities], manifest.entities))
  const credits = 'verified-authors.jsonl.gz'
  for (const row of readRows<VerifiedBookAuthor>(root, credits, manifest.sha256[credits], manifest.credits)) {
    const catalogId = row.siteId.match(/^catalog-anilist-([1-9]\d*)$/)?.[1]
    const workId = works.get(row.workId)?.workId
    if (!workId || !catalogId || identities.get(row.workId) !== row.siteId ||
        !Number.isSafeInteger(row.staff) || row.staff < 1) {
      throw new Error(`Book author identity mismatch for ${row.workId}`)
    }
    const links = review.creditsByWork.get(workId) || []
    links.push({ workId, sourceWorkId: row.workId, creatorId: row.creatorId, name: row.name,
      displayName: row.name, role: row.publicRole, creditKind: 'person', bindingBasis: 'book_edition_author',
      sourceUrls: [`https://anilist.co/manga/${catalogId}`, `https://anilist.co/staff/${row.staff}`,
        ...bookAuthorReferences(row)] })
    review.creditsByWork.set(workId, links)
  }
}

type AnimationCredit = Pick<BookCredit, 'sourceWorkId' | 'siteId' | 'creatorId' | 'kind' | 'name' | 'role'> & {
  programUrl: string
  productionUrl: string
  subject?: number
  person?: number
  editionRegistry?: string
}

export function addCatalogStaff(directory: string, identities: Map<string, string | null | undefined>,
  works: Map<string, { workId: string }>, review: NonNullable<IdentityReview>) {
  const root = join(directory, '..', 'identity-20261121')
  const manifest = JSON.parse(readFileSync(join(root, 'staff-manifest.json'), 'utf8'))
  const entities = 'staff-entities.jsonl.gz'
  review.entities.push(...readRows<PublicCreator>(root, entities, manifest.sha256[entities], manifest.entities))
  const credits = 'staff-credits.jsonl.gz'
  for (const row of readRows<CatalogStaff>(root, credits, manifest.sha256[credits], manifest.credits)) {
    const workId = works.get(row.sourceWorkId)?.workId
    const siteId = identities.get(row.sourceWorkId) || review.recovered.get(row.sourceWorkId)?.siteId
    const subjectId = `catalog-bangumi-${row.subject}`
    const registry = row.registryUrl
    const isCatalogRegistry = registry && (
      /^https:\/\/www\.wikidata\.org\/wiki\/Q[1-9]\d*$/.test(registry) ||
      /^https:\/\/github\.com\/bangumi-data\/bangumi-data\/blob\/[0-9a-f]{40}\/data\/items\/\d{4}\/\d{2}\.json#L[1-9]\d*$/.test(registry)
    ) && /^(?:catalog-anilist-|ANILIST-)[1-9]\d*$/.test(row.siteId)
    const legacy = review.legacyBindings.get(row.sourceWorkId)
    if (!workId || row.siteId !== siteId || !Number.isSafeInteger(row.subject) || row.subject <= 0 ||
        !Number.isSafeInteger(row.person) || row.person <= 0 || (registry && !isCatalogRegistry) || (!isCatalogRegistry && subjectId !== siteId && legacy?.siteId !== subjectId)) {
      throw new Error(`Unbound catalog staff credit for ${row.sourceWorkId}`)
    }
    const sourceUrls = [`https://bgm.tv/subject/${row.subject}/persons`, `https://bgm.tv/person/${row.person}`]
    if (registry) sourceUrls.push(registry)
    const links = review.creditsByWork.get(workId) || []
    const roster = review.corrections.get(workId)?.edition?.credits
    const published = roster?.find(credit => credit.creatorId === row.creatorId && credit.creditKind === row.kind &&
      (credit.role === row.role || credit.replacesCatalogRole === row.role))
    if (published) {
      const edge = links.find(item => item.bindingBasis === 'publisher_edition' &&
        item.creatorId === published.creatorId && item.role === published.role)
      if (!edge) throw new Error(`Missing edition roster credit for ${workId}`)
      edge.sourceUrls = [...new Set([...edge.sourceUrls, ...sourceUrls])]
      continue
    }
    links.push({ workId, sourceWorkId: row.sourceWorkId, creatorId: row.creatorId, creditKind: row.kind, name: row.name, displayName: row.name,
      role: row.role, bindingBasis: 'bangumi_staff', sourceUrls })
    review.creditsByWork.set(workId, links)
  }
  const licensedEditions: { credits: AnimationCredit[] } = JSON.parse(readFileSync(join(root, 'licensed-animation-credits.json'), 'utf8'))
  for (const row of licensedEditions.credits) {
    const workId = works.get(row.sourceWorkId)?.workId
    const production = new URL(row.productionUrl)
    if (!workId || identities.get(row.sourceWorkId) !== row.siteId || !/^(?:catalog-anilist-|ANILIST-)[1-9]\d*$/.test(row.siteId) ||
        !/^https:\/\/www\.b-ch\.com\/titles\/[1-9]\d*\/$/.test(row.programUrl) ||
        production.protocol !== 'https:' || production.hostname === 'www.b-ch.com') {
      throw new Error(`Unbound licensed animation credit for ${row.sourceWorkId}`)
    }
    const links = review.creditsByWork.get(workId) || []
    const sourceUrls = [row.programUrl, row.productionUrl]
    if (row.editionRegistry || row.subject || row.person) {
      if (!Number.isSafeInteger(row.subject) || !row.subject || row.subject < 1 ||
          !Number.isSafeInteger(row.person) || !row.person || row.person < 1 ||
          !/^https:\/\/(?:www\.wikidata\.org\/wiki\/Q[1-9]\d*|github\.com\/bangumi-data\/bangumi-data\/blob\/[0-9a-f]{40}\/data\/items\/\d{4}\/\d{2}\.json#L[1-9]\d*)$/.test(row.editionRegistry || '')) {
        throw new Error(`Invalid licensed staff registry for ${row.sourceWorkId}`)
      }
      sourceUrls.push(`https://bgm.tv/subject/${row.subject}/persons`, `https://bgm.tv/person/${row.person}`, row.editionRegistry!)
    }
    const existing = links.find(item => item.creatorId === row.creatorId && item.creditKind === row.kind && item.role === row.role)
    if (existing) {
      existing.sourceUrls = [...new Set([...existing.sourceUrls, ...sourceUrls])]
    } else {
      links.push({ workId, sourceWorkId: row.sourceWorkId, creatorId: row.creatorId, creditKind: row.kind, name: row.name, displayName: row.name,
        role: row.role, bindingBasis: 'licensed_animation_edition', sourceUrls })
    }
    review.creditsByWork.set(workId, links)
  }
}
