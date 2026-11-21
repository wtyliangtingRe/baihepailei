import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CatalogEquivalenceGroup, PublicCredit, PublicWorkRecord } from './publicRelease'
import type { CreatorKind, PublicCreator, CreditEdge } from './publicCreatorGraph'
import { mergeCredits, mergeLocalizedTitles, mergeSources } from './publicDescriptiveMerge'

type ReviewedGroup = CatalogEquivalenceGroup & { primaryWorkId: string }
export type RecoveredBangumiWork = {
  workId: string
  siteId: string
  catalogTitle: string
  title: string
  originalTitle: string
  media: PublicWorkRecord['media']
  url: string
  isbn?: string
  editionSource?: string
}
type Correction = {
  workId: string
  siteId: string | null
  url: string
  label?: string
  firstPublished?: string
  format?: string
  wrongUrl?: string
  creditName?: string
  oldRole?: string
  newRole?: string
  placeholder?: string
  removedCreatorId?: string
  summary?: string
  aliases?: string[]
  edition?: {
    isbn: string
    catalogTitle: string
    credits: (Pick<CreditEdge, 'creatorId' | 'creditKind' | 'name' | 'role'> & { sourceUrl?: string })[]
  }
}
type ReviewedCredit = {
  sourceWorkId: string
  workId: string
  anilistId: string
  wikidataWork: string
  wikidataCreator: string
  name: string
  creatorId: string
  creditKind: CreatorKind
  role: string
}

export function readIdentityReview(directory: string, identities: Map<string, string | null | undefined>,
  canonicalIds: Map<string, string> | undefined) {
  if (process.env.BAIHEPAILEI_RELEASE_DIR?.trim()) return undefined
  const root = join(directory, '..', 'identity-20261121')
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 'baihepailei-public-identity-review-v1') throw new Error('Invalid identity review')
  function read<T>(file: string): T[] {
    const descriptor = manifest.files.find((entry: { file: string }) => entry.file === file)
    const bytes = readFileSync(join(root, file))
    if (createHash('sha256').update(bytes).digest('hex') !== descriptor?.sha256) {
      throw new Error(`Identity review integrity mismatch: ${file}`)
    }
    const rows = bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line))
    if (rows.length !== descriptor.rows) throw new Error(`Identity review count mismatch: ${file}`)
    return rows
  }
  const groups = read<ReviewedGroup>('groups.jsonl')
  const recovered = new Map<string, RecoveredBangumiWork>()
  const siteIds = new Set<string>()
  for (const row of read<RecoveredBangumiWork>('recovered-bangumi.jsonl')) {
    const match = /^catalog-bangumi-([1-9]\d*)$/.exec(row.siteId)
    if (!match || row.url !== `https://bgm.tv/subject/${match[1]}` || !identities.has(row.workId) ||
        identities.get(row.workId) || !row.originalTitle || !row.title || !row.media.format ||
        recovered.has(row.workId) || siteIds.has(row.siteId)) throw new Error(`Invalid recovered identity: ${row.workId}`)
    recovered.set(row.workId, row)
    siteIds.add(row.siteId)
  }
  const entities = read<PublicCreator>('entities.jsonl')
  const corrections = new Map(read<Correction>('corrections.jsonl').map(row => {
    if (identities.get(row.workId) !== row.siteId || (row.siteId === null && !row.edition)) {
      throw new Error(`Correction identity drift: ${row.workId}`)
    }
    return [row.workId, row]
  }))
  const creditsByWork = new Map<string, CreditEdge[]>()
  for (const row of read<ReviewedCredit>('credits.jsonl')) {
    if (identities.get(row.sourceWorkId) !== `catalog-anilist-${row.anilistId}` ||
        canonicalIds?.get(row.sourceWorkId) !== row.workId ||
        !/^Q[1-9]\d*$/.test(row.wikidataWork) || !/^Q[1-9]\d*$/.test(row.wikidataCreator)) {
      throw new Error(`Unbound Wikidata credit: ${row.sourceWorkId}`)
    }
    const edges = creditsByWork.get(row.workId) || []
    edges.push({ workId: row.workId, creatorId: row.creatorId, creditKind: row.creditKind,
      role: row.role, name: row.name, displayName: row.name, bindingBasis: 'wikidata',
      sourceUrls: [`https://www.wikidata.org/wiki/${row.wikidataWork}`] })
    creditsByWork.set(row.workId, edges)
  }
  for (const fix of corrections.values()) {
    const edition = fix.edition
    if (!edition) continue
    if (!/^97[89]\d{10}$/.test(edition.isbn) || !edition.catalogTitle || canonicalIds?.get(fix.workId) !== fix.workId) {
      throw new Error(`Unbound publisher credit: ${fix.workId}`)
    }
    const edges = creditsByWork.get(fix.workId) || []
    for (const { sourceUrl, ...credit } of edition.credits) {
      edges.push({ ...credit, workId: fix.workId, displayName: credit.name,
        bindingBasis: 'publisher_edition', sourceUrls: [sourceUrl || fix.url] })
    }
    creditsByWork.set(fix.workId, edges)
  }
  const removedCreatorIds = new Set([...corrections.values()].flatMap(row => row.removedCreatorId ? [row.removedCreatorId] : []))
  return { groups, entities, creditsByWork, corrections, removedCreatorIds, recovered }
}

export type IdentityReview = ReturnType<typeof readIdentityReview>

export function applyRecoveredBangumi(work: PublicWorkRecord, row: RecoveredBangumiWork): PublicWorkRecord {
  const title = work.workId === row.workId ? row.title : work.title
  const usable = (name: string) => !/[\u0080-\u009f\ufffd]/u.test(name)
  const localizedTitles = work.localizedTitles.filter(item => usable(item.title))
  return {
    ...work,
    title,
    media: row.media,
    aliases: [...new Set([...work.aliases, work.title, row.title, row.originalTitle].filter(name => name !== title && usable(name)))],
    localizedTitles: mergeLocalizedTitles([...localizedTitles, { title: row.originalTitle, kind: 'original' },
      ...(row.title === row.originalTitle ? [] : [{ title: row.title, kind: 'localized' as const }])]),
    sources: mergeSources([...work.sources, { title: 'Bangumi 作品条目', url: row.url },
      ...(row.editionSource ? [{ title: '国立国会图书馆书目', url: row.editionSource }] : [])]),
    catalogIdentifiers: [...(work.catalogIdentifiers || []), { provider: 'bangumi-subject', siteId: row.siteId, url: row.url }],
    ...(work.summary?.kind === 'identity_summary' && work.workId === row.workId && {
      summary: { kind: 'identity_summary' as const, text: `《${title}》为${row.media.format}。`, sourceUrl: row.url },
    }),
  }
}

export function correctCredit<T extends PublicCredit>(workId: string, credit: T, review: IdentityReview): T {
  const fix = review?.corrections.get(workId)
  if (!fix?.newRole || credit.name !== fix.creditName || credit.role !== fix.oldRole) return credit
  return { ...credit, role: fix.newRole, sourceUrls: [...new Set([...(credit.sourceUrls || []), fix.url])] }
}

export function applyReviewedMetadata(work: PublicWorkRecord, review: IdentityReview): PublicWorkRecord {
  const fix = review?.corrections.get(work.workId)
  const edges = review?.creditsByWork.get(work.workId)
  if (!fix && !edges) return work
  if (fix?.edition && work.title !== fix.edition.catalogTitle) throw new Error(`Edition title drift: ${work.workId}`)
  const credits = (kind: CreatorKind) => (edges || []).filter(edge => edge.creditKind === kind)
    .map(edge => ({ name: edge.name, role: edge.role, sourceUrl: edge.sourceUrls[0] }))
  const correctedSources = work.sources.map(source =>
    fix?.wrongUrl && source.url === fix.wrongUrl ? { ...source, url: fix.url } : source)
  if (fix?.label) correctedSources.push({ title: '版本与收录范围', url: fix.url })
  if (fix?.edition) correctedSources.push({ title: `出版社书目 · ISBN ${fix.edition.isbn}`, url: fix.url })
  else if (fix?.firstPublished) correctedSources.push({ title: '出版社书目与发售日期', url: fix.url })
  return {
    ...work,
    sources: mergeSources(correctedSources),
    ...(fix?.firstPublished && {
      firstPublished: fix.firstPublished, firstPublishedLabel: fix.firstPublished,
      firstPublishedPrecision: 'day' as const,
    }),
    ...(fix?.placeholder && {
      aliases: [...new Set([...work.aliases.filter(alias => alias !== fix.placeholder), ...(fix.aliases || [])])],
      localizedTitles: work.localizedTitles.filter(item => item.title !== fix.placeholder),
    }),
    ...(fix?.summary && { summary: { kind: 'source_summary' as const, text: fix.summary, sourceUrl: fix.url } }),
    ...(fix?.label && {
      title: `${work.title}（${fix.label}）`,
      aliases: [...new Set([work.title, ...work.aliases])],
      media: { ...work.media, format: fix.format },
    }),
    ...(fix?.wrongUrl && {
      rating: work.rating.evidenceUrl === fix.wrongUrl ? { ...work.rating, evidenceUrl: fix.url } : work.rating,
    }),
    creators: mergeCredits([...work.creators.map(credit => correctCredit(work.workId, credit, review)), ...credits('person')]),
    organizations: mergeCredits([...work.organizations.filter(credit => credit.name !== fix?.placeholder), ...credits('organization')]),
  }
}
