import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveReview, type SourceReview } from './sourceReview'
import { publicTagsFor } from './radar/publicTags'
import type { PublicGrade, PublicWorkRecord } from './publicRelease'
import type { CreatorKind, CreditEdge, PublicCreator } from './publicCreatorGraph'

type Edition = Pick<PublicWorkRecord, 'title' | 'aliases' | 'localizedTitles' | 'media' | 'summary' | 'sources'> & {
  provider: string
  url: string
  firstPublication?: { date: string; sourceUrl: string }
  printEdition?: NonNullable<PublicWorkRecord['printEditions']>[number]
  printEditions?: NonNullable<PublicWorkRecord['printEditions']>
  credits: { creatorId: string; kind: CreatorKind; name: string; role: string; sourceUrl: string }[]
  review: SourceReview
}

type RecentEntry = { workId: string; releasedOn: string; scope: string; title?: string; edition?: Edition }

function isPublicationDate(value: string) {
  const parsed = new Date(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
}

export function readRecentWorks(directory: string, grades: readonly PublicGrade[], works: Map<string, PublicWorkRecord>,
  recordedSiteIds: Iterable<string | null>) {
  const file = join(directory, '..', 'identity-20261121', 'recent-works.json')
  const data: { schemaVersion: string; assessedOn: string; entries: RecentEntry[]; entities: (PublicCreator & { canonicalCreatorId?: string })[] } =
    JSON.parse(readFileSync(file, 'utf8'))
  if (data.schemaVersion !== 'baihepailei-recent-works-v1') throw new Error('Unrecognized recent works release')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.assessedOn)) throw new Error('Invalid recent assessment date')
  const existingSiteIds = new Set(recordedSiteIds)
  const displayedIds = new Set<string>()
  const additions: PublicWorkRecord[] = []
  const redirects = new Map(data.entities.filter(entity => entity.canonicalCreatorId)
    .map(entity => [entity.creatorId, entity.canonicalCreatorId!]))
  const credits = new Map<string, CreditEdge[]>()
  const featured: (Omit<RecentEntry, 'edition'> & { title: string })[] = []
  const order = [...data.entries].sort((a, b) => b.releasedOn.localeCompare(a.releasedOn) || a.workId.localeCompare(b.workId))
  for (const { workId, releasedOn, scope, title: releaseTitle, edition } of order) {
    if (!isPublicationDate(releasedOn) || releasedOn > data.assessedOn) {
      throw new Error(`Invalid recent release date for ${workId}`)
    }
    const existing = works.get(workId)
    const displayId = existing?.workId || workId
    const displayedTitle = releaseTitle?.trim() || existing?.title || edition?.title
    if (!displayedTitle) throw new Error(`Missing recent work title for ${workId}`)
    if (displayedIds.has(displayId)) throw new Error(`Repeated recent work ${displayId}`)
    displayedIds.add(displayId)
    featured.push({ workId: displayId, releasedOn, scope, title: displayedTitle })
    if (!edition) {
      if (!existing?.rating.gradeReviewed) throw new Error(`Recent catalog work ${workId} has no confirmed review`)
      continue
    }
    const { review, title, provider, url, firstPublication, ...metadata } = edition
    const printEditions = edition.printEditions ?? (edition.printEdition ? [edition.printEdition] : [])
    const { siteId } = review
    if (existing || !/^\d{5,9}$/.test(workId) || review.workId !== workId || !siteId?.trim() ||
        existingSiteIds.has(siteId) || !title.trim() || !provider.trim() || review.edition || review.attributionOnly ||
        !metadata.sources.some(source => source.url === url) ||
        printEditions.some(print => !/^97[89]\d{10}$/.test(print.isbn) ||
          [...print.isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 !== 0 ||
          !metadata.sources.some(source => source.url === print.url))) throw new Error(`Invalid new work identity ${workId}`)
    if (firstPublication && (!isPublicationDate(firstPublication.date) || firstPublication.date > releasedOn ||
        !metadata.sources.some(source => source.url === firstPublication.sourceUrl && source.tier === 'official'))) {
      throw new Error(`Invalid first publication for ${workId}`)
    }
    existingSiteIds.add(siteId)
    const rating = resolveReview(review, { state: 'not_assessed', classes: [] }, grades)
    for (const source of [...metadata.sources, { url: metadata.summary?.sourceUrl || url }]) {
      const parsed = new URL(source.url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`Invalid source for ${workId}`)
    }
    const edges = metadata.credits.map(credit => {
      if (!credit.name.trim() || !credit.role.trim() || !metadata.sources.some(source => source.url === credit.sourceUrl))
        throw new Error(`Unbound release credit for ${workId}`)
      return { workId, creatorId: redirects.get(credit.creatorId) || credit.creatorId, creditKind: credit.kind, name: credit.name,
        displayName: credit.name, role: credit.role, sourceUrls: [credit.sourceUrl], bindingBasis: 'reviewed_release_credit' }
    })
    credits.set(workId, edges)
    function creditRows(kind: CreatorKind) {
      return edges.filter(edge => edge.creditKind === kind).map(edge =>
        ({ name: edge.name, role: edge.role, sourceUrl: edge.sourceUrls[0] }))
    }
    const firstPublished = firstPublication?.date ?? releasedOn
    additions.push({
      schemaVersion: 'baihepailei-public-work-view-v2',
      workId, title, aliases: metadata.aliases, localizedTitles: metadata.localizedTitles, media: metadata.media,
      summary: metadata.summary, sources: metadata.sources, firstPublished, firstPublishedLabel: firstPublished,
      firstPublishedPrecision: 'day', ...(printEditions.length > 0 && { printEditions }),
      creators: creditRows('person'), organizations: creditRows('organization'),
      rating: { ...rating, gradeReviewed: true }, publicTags: publicTagsFor([], review.findings.flatMap(finding => finding.classes)),
      catalogIdentifiers: [{ provider, siteId, url }],
    })
  }
  return { additions, credits, entities: data.entities, redirects, featured }
}
