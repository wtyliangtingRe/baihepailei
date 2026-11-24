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
  firstPublished?: string
  printEdition?: NonNullable<PublicWorkRecord['printEditions']>[number]
}
type BangumiCorrection = Pick<RecoveredBangumiWork, 'workId' | 'siteId' | 'catalogTitle' | 'url'> &
  Partial<Pick<RecoveredBangumiWork, 'title' | 'originalTitle' | 'media' | 'editionSource' | 'firstPublished'>> & {
    previousOriginalTitle?: string
    editionSourceLabel?: string
    printEdition?: NonNullable<PublicWorkRecord['printEditions']>[number] & { publisherId?: string }
    previous?: PublicWorkRecord['media']['group']
  }
type EditionCredit = Pick<CreditEdge, 'creatorId' | 'creditKind' | 'name' | 'role'> & { sourceUrl?: string; replacesCatalogRole?: string }
type Correction = {
  catalogTitle?: string
  title?: string
  media?: PublicWorkRecord['media']
  releaseCredits?: EditionCredit[]
  workId: string
  siteId: string | null
  url: string
  label?: string
  firstPublished?: string
  firstPublishedSource?: string
  withdrawnReleaseDate?: string
  format?: string
  wrongUrl?: string
  unrelatedUrls?: string[]
  editionSources?: PublicWorkRecord['sources']
  creditName?: string
  oldRole?: string
  newRole?: string
  placeholder?: string
  removedCreatorId?: string
  summary?: string
  aliases?: string[]
  removedAliases?: string[]
  localizedTitles?: PublicWorkRecord['localizedTitles']
  printEdition?: NonNullable<PublicWorkRecord['printEditions']>[number]
  printEditions?: NonNullable<PublicWorkRecord['printEditions']>
  edition?: {
    isbn: string
    catalogTitle: string
    credits: EditionCredit[]
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
  roleSourceUrl?: string
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
  const legacyBindings = new Map<string, BangumiCorrection>()
  for (const row of read<BangumiCorrection & { catalogSiteId: string }>('legacy-bindings.jsonl')) {
    const match = /^catalog-bangumi-([1-9]\d*)$/.exec(row.siteId)
    if (!match || row.url !== `https://bgm.tv/subject/${match[1]}` || !row.catalogSiteId.startsWith('work:mgv2-') ||
        identities.get(row.workId) !== row.catalogSiteId || !row.originalTitle || !row.catalogTitle || !row.title ||
        legacyBindings.has(row.workId)) throw new Error(`Invalid legacy catalog edition: ${row.workId}`)
    const edition = row.printEdition
    if (edition && (!/^97[89]\d{10}$/.test(edition.isbn) || !edition.title ||
        (edition.url !== `https://www.books.or.jp/book-details/${edition.isbn}` &&
          !(edition.publisher === '一迅社' && edition.isbn.startsWith('97847580') &&
            edition.url === `https://data.ichijinsha.co.jp/detail/${edition.isbn.slice(4, 12)}`)) ||
        (edition.publisherId && !edition.publisher))) throw new Error(`Invalid print edition: ${row.workId}`)
    legacyBindings.set(row.workId, row)
  }
  const recovered = new Map<string, RecoveredBangumiWork>()
  const siteIds = new Set<string>()
  for (const row of read<RecoveredBangumiWork>('recovered-bangumi.jsonl')) {
    const match = /^catalog-bangumi-([1-9]\d*)$/.exec(row.siteId)
    if (!match || row.url !== `https://bgm.tv/subject/${match[1]}` || !identities.has(row.workId) ||
        identities.get(row.workId) || !row.originalTitle || !row.title || !row.media.format ||
        (row.firstPublished && (!/^\d{4}-\d{2}-\d{2}$/.test(row.firstPublished) || !row.editionSource?.startsWith('https://'))) ||
        recovered.has(row.workId) || siteIds.has(row.siteId)) throw new Error(`Invalid recovered identity: ${row.workId}`)
    const edition = row.printEdition
    if (edition && (!/^97[89]\d{10}$/.test(edition.isbn) || edition.isbn !== row.isbn || !edition.title ||
        !edition.url.startsWith('https://') || edition.url !== row.editionSource)) {
      throw new Error(`Unbound recovered print edition: ${row.workId}`)
    }
    recovered.set(row.workId, row)
    siteIds.add(row.siteId)
  }
  const bangumiCorrections = new Map<string, BangumiCorrection>()
  for (const row of read<BangumiCorrection>('bangumi-corrections.jsonl')) {
    const match = /^catalog-bangumi-([1-9]\d*)$/.exec(row.siteId)
    if (!match || row.url !== `https://bgm.tv/subject/${match[1]}` || identities.get(row.workId) !== row.siteId ||
        !row.catalogTitle || (!row.media && !row.title) || (!!row.media !== !!row.previous) ||
        (!!row.title !== !!row.originalTitle) || bangumiCorrections.has(row.workId)) {
      throw new Error(`Invalid Bangumi catalog correction: ${row.workId}`)
    }
    bangumiCorrections.set(row.workId, row)
  }
  const entities = read<PublicCreator>('entities.jsonl')
  const corrections = new Map(read<Correction>('corrections.jsonl').map(row => {
    if (identities.get(row.workId) !== row.siteId || (row.siteId === null && !row.edition)) {
      throw new Error(`Correction identity drift: ${row.workId}`)
    }
    if (row.title && (!row.catalogTitle ||
        !row.editionSources?.some(source => source.url === row.url && source.tier === 'official'))) {
      throw new Error(`Unbound title correction: ${row.workId}`)
    }
    if (row.withdrawnReleaseDate && (row.firstPublished ||
        !row.editionSources?.some(source => source.url === row.url && source.tier === 'official'))) {
      throw new Error(`Unbound release delay: ${row.workId}`)
    }
    const printEditions = row.printEditions ?? (row.printEdition ? [row.printEdition] : [])
    for (const print of printEditions) {
      if (!/^97[89]\d{10}$/.test(print.isbn) || !print.title ||
          !row.editionSources?.some(source => source.url === print.url && source.tier === 'official')) {
        throw new Error(`Unbound print edition: ${row.workId}`)
      }
    }
    return [row.workId, { ...row, printEditions }]
  }))
  const creditsByWork = new Map<string, CreditEdge[]>()
  for (const row of read<ReviewedCredit>('credits.jsonl')) {
    if (identities.get(row.sourceWorkId) !== `catalog-anilist-${row.anilistId}` ||
        canonicalIds?.get(row.sourceWorkId) !== row.workId ||
        !/^Q[1-9]\d*$/.test(row.wikidataWork) || !/^Q[1-9]\d*$/.test(row.wikidataCreator)) {
      throw new Error(`Unbound Wikidata credit: ${row.sourceWorkId}`)
    }
    const edges = creditsByWork.get(row.workId) || []
    edges.push({ workId: row.workId, sourceWorkId: row.sourceWorkId, creatorId: row.creatorId, creditKind: row.creditKind,
      role: row.role, name: row.name, displayName: row.name, bindingBasis: 'wikidata',
      sourceUrls: [`https://www.wikidata.org/wiki/${row.wikidataWork}`, ...(row.roleSourceUrl ? [row.roleSourceUrl] : [])] })
    creditsByWork.set(row.workId, edges)
  }
  for (const fix of corrections.values()) {
    const edition = fix.edition
    const credits = edition?.credits || fix.releaseCredits
    if (!credits) continue
    if (canonicalIds?.get(fix.workId) !== fix.workId || (edition && (!/^97[89]\d{10}$/.test(edition.isbn) || !edition.catalogTitle)) ||
        (!edition && (!fix.siteId || !fix.catalogTitle))) {
      throw new Error(`Unbound publisher credit: ${fix.workId}`)
    }
    const edges = creditsByWork.get(fix.workId) || []
    for (const { creatorId, creditKind, name, role, sourceUrl } of credits) {
      edges.push({ creatorId, creditKind, name, role, workId: fix.workId, displayName: name,
        bindingBasis: edition ? 'publisher_edition' : 'publisher_release', sourceUrls: [sourceUrl || fix.url] })
    }
    creditsByWork.set(fix.workId, edges)
  }
  const removedCreatorIds = new Set([...corrections.values()].flatMap(row => row.removedCreatorId ? [row.removedCreatorId] : []))
  return { groups, entities, creditsByWork, corrections, removedCreatorIds, recovered, bangumiCorrections, legacyBindings, creatorAliases: new Map<string, string>() }
}

export type IdentityReview = ReturnType<typeof readIdentityReview>

export function addPrintPublisherCredits(review: NonNullable<IdentityReview>, works: Map<string, { workId: string }>) {
  for (const row of review.legacyBindings.values()) {
    const edition = row.printEdition
    if (!edition?.publisherId || !edition.publisher) continue
    const workId = works.get(row.workId)?.workId
    if (!workId) throw new Error(`Missing print edition work: ${row.workId}`)
    const edges = review.creditsByWork.get(workId) || []
    edges.push({ workId, sourceWorkId: row.workId, creatorId: edition.publisherId, name: edition.publisher, displayName: edition.publisher,
      creditKind: 'organization', role: '出版社', bindingBasis: 'publisher_edition', sourceUrls: [edition.url, row.url] })
    review.creditsByWork.set(workId, edges)
  }
}

export function applyBangumiMetadata(work: PublicWorkRecord, row: BangumiCorrection): PublicWorkRecord {
  const edition = row.printEdition
  const title = row.title && work.workId === row.workId ? row.title : work.title
  const clean = (name: string) => !/[\u0080-\u009f\ufffd]/u.test(name)
  const previousOriginal = row.previousOriginalTitle || row.catalogTitle
  const localizedTitles = work.localizedTitles.filter(item => clean(item.title)).map(item =>
    row.originalTitle && row.originalTitle !== previousOriginal && item.title === previousOriginal && item.kind === 'original'
      ? { ...item, kind: 'alias' as const } : item)
  const translated = row.title && row.title !== row.originalTitle ? [{ title: row.title, kind: 'localized' as const }] : []
  const originalName = row.originalTitle
  const knownLanguage = localizedTitles.find(item => item.title === originalName && item.language)?.language
  const scriptLanguage = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(originalName || '') ? 'ja' :
    /\p{Script=Hangul}/u.test(originalName || '') ? 'ko' : undefined
  const original = originalName ? [{ title: originalName, language: knownLanguage || scriptLanguage, kind: 'original' as const }] : []
  const aliases = row.title && row.originalTitle ? [work.title, row.title, row.originalTitle] : []
  if (row.previousOriginalTitle) aliases.push(row.previousOriginalTitle)
  const media = row.media || work.media
  let summary = work.summary
  if (summary?.kind === 'identity_summary' && work.workId === row.workId && row.title) {
    const text = summary.text.replace(row.catalogTitle, title)
    summary = { ...summary, text: clean(text) && text.includes(title) && !text.includes('类型待补')
      ? text : `《${title}》为${media.format || '作品'}。`, sourceUrl: row.url }
  }
  return {
    ...work, title, media, summary,
    ...(row.firstPublished && work.workId === row.workId && {
      firstPublished: row.firstPublished, firstPublishedLabel: row.firstPublished, firstPublishedPrecision: 'day' as const,
    }),
    ...(edition && { printEditions: [
      ...(work.printEditions || []).filter(item => item.isbn !== edition.isbn),
      { isbn: edition.isbn, title: edition.title, url: edition.url,
        publisher: edition.publisher, onSale: edition.onSale, issued: edition.issued },
    ] }),
    aliases: [...new Set([...work.aliases, ...aliases].filter(name => name !== title && clean(name)))],
    localizedTitles: mergeLocalizedTitles([...localizedTitles, ...original, ...translated]),
    sources: mergeSources([...work.sources, { title: 'Bangumi 作品条目', url: row.url },
      ...(edition ? [{ title: `出版书目 · ISBN ${edition.isbn}`, url: edition.url, tier: 'official' as const }] : []),
      ...(row.editionSource ? [{ title: row.editionSourceLabel ||
        (row.editionSource.startsWith('https://ndlsearch.ndl.go.jp/') ? '国立国会图书馆书目' : '出版社书目'), url: row.editionSource }] : [])]),
    catalogIdentifiers: [...(work.catalogIdentifiers || []).filter(item => item.siteId !== row.siteId),
      { provider: 'bangumi-subject', siteId: row.siteId, url: row.url }],
  }
}

export function correctCredit<T extends PublicCredit>(workId: string, credit: T, review: IdentityReview): T {
  const fix = review?.corrections.get(workId)
  if (!fix?.newRole || credit.name !== fix.creditName || credit.role !== fix.oldRole) return credit
  const correctUrl = (url: string) => url === fix.wrongUrl ? fix.url : url
  return { ...credit, role: fix.newRole,
    ...(credit.sourceUrl && { sourceUrl: correctUrl(credit.sourceUrl) }),
    sourceUrls: [...new Set([...(credit.sourceUrls || []).map(correctUrl), fix.url])] }
}

function editionLinkKey(value: string): string {
  const steam = /^https?:\/\/store\.steampowered\.com\/app\/(\d+)(?:[/?#]|$)/i.exec(value)
  return steam ? `steam:${steam[1]}` : value
}

export function applyReviewedMetadata(work: PublicWorkRecord, review: IdentityReview, members = [work.workId]): PublicWorkRecord {
  if (!review) return work
  const fix = review.corrections.get(work.workId)
  const printEditions = fix?.printEditions || []
  const edges = members.flatMap(id => review.creditsByWork.get(id) || [])
  const correctedUrls = new Map<string, string>()
  const unrelated = new Set<string>()
  const removedAliases = new Set<string>()
  const editionSources: PublicWorkRecord['sources'] = []
  for (const id of members) {
    const correction = review.corrections.get(id)
    for (const name of correction?.removedAliases || []) removedAliases.add(name)
    for (const url of correction?.unrelatedUrls || []) unrelated.add(editionLinkKey(url))
    editionSources.push(...correction?.editionSources || [])
    if (correction?.wrongUrl) correctedUrls.set(correction.wrongUrl, correction.url)
  }
  if (!fix && !edges.length && !correctedUrls.size && !editionSources.length && !unrelated.size) return work
  const editionTitle = fix?.edition?.catalogTitle || fix?.catalogTitle
  if (editionTitle && work.title !== editionTitle) throw new Error(`Edition title drift: ${work.workId}`)
  if (fix?.withdrawnReleaseDate && work.firstPublished !== fix.withdrawnReleaseDate) {
    throw new Error(`Withdrawn release date drift: ${work.workId}`)
  }
  const credits = (kind: CreatorKind) => edges.filter(edge => edge.creditKind === kind)
    .map(edge => ({ name: edge.name, role: edge.role, sourceUrl: edge.sourceUrls[0], sourceUrls: edge.sourceUrls }))
  if (unrelated.size) {
    const citations = [work.rating.evidenceUrl, ...(work.rating.evidenceSources || []).map(source => source.url),
      ...(work.rating.sourceFindings || []).flatMap(finding => finding.urls), work.summary?.sourceUrl]
    if (citations.some(value => value && unrelated.has(editionLinkKey(value)))) {
      throw new Error(`Evidence from another edition on ${work.workId}`)
    }
  }
  const correctedSources = work.sources.filter(source => !unrelated.has(editionLinkKey(source.url))).map(source =>
    correctedUrls.has(source.url) ? { ...source, url: correctedUrls.get(source.url)! } : source)
  correctedSources.push(...editionSources)
  if (fix?.label) correctedSources.push({ title: '版本与收录范围', url: fix.url })
  if (fix?.edition) correctedSources.push({ title: `出版社书目 · ISBN ${fix.edition.isbn}`, url: fix.url })
  else if (fix?.firstPublished) {
    const dateSource = fix.firstPublishedSource || fix.url
    if (!editionSources.some(source => source.url === dateSource)) {
      correctedSources.push({ title: '首发日期依据', url: dateSource })
    }
  }
  const keepAlias = (name: string) => !removedAliases.has(name) && name !== fix?.placeholder
  return {
    ...work,
    ...(fix?.title && { title: fix.title }),
    sources: mergeSources(correctedSources),
    ...(fix?.media && { media: fix.media }),
    ...(fix?.firstPublished && {
      firstPublished: fix.firstPublished, firstPublishedLabel: fix.firstPublished,
      firstPublishedPrecision: 'day' as const,
    }),
    ...(fix?.withdrawnReleaseDate && {
      firstPublished: undefined, firstPublishedLabel: '播出延期，新日期待定',
      firstPublishedPrecision: undefined,
    }),
    ...(printEditions.length > 0 && { printEditions: [
      ...(work.printEditions || []).filter(edition => !printEditions.some(print => print.isbn === edition.isbn)),
      ...printEditions,
    ] }),
    ...((fix?.title || fix?.placeholder || fix?.aliases || removedAliases.size) && {
      aliases: [...new Set([
        ...work.aliases.filter(alias => keepAlias(alias) && alias !== fix?.title),
        ...(fix?.title ? [work.title] : []), ...(fix?.aliases || []),
      ])],
    }),
    ...((fix?.placeholder || fix?.localizedTitles || removedAliases.size) && {
      localizedTitles: mergeLocalizedTitles([
        ...work.localizedTitles.filter(item => keepAlias(item.title)), ...(fix?.localizedTitles || []),
      ]),
    }),
    ...(fix?.summary && { summary: { kind: 'source_summary' as const, text: fix.summary, sourceUrl: fix.url } }),
    ...(fix?.label && {
      title: `${fix.title || work.title}（${fix.label}）`,
      aliases: [...new Set([work.title, ...work.aliases.filter(keepAlias), ...(fix.aliases || [])])],
      media: { ...work.media, format: fix.format },
    }),
    ...(work.rating.evidenceUrl && correctedUrls.has(work.rating.evidenceUrl) && {
      rating: { ...work.rating, evidenceUrl: correctedUrls.get(work.rating.evidenceUrl) },
    }),
    creators: mergeCredits([
      ...work.creators.filter(credit => credit.name !== fix?.placeholder)
        .map(credit => correctCredit(work.workId, credit, review)), ...credits('person'),
    ]),
    organizations: mergeCredits([...work.organizations.filter(credit => credit.name !== fix?.placeholder), ...credits('organization')]),
  }
}
