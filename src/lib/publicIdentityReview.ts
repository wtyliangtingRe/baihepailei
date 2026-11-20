import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CatalogEquivalenceGroup, PublicCredit, PublicWorkRecord } from './publicRelease'
import type { CreatorKind, PublicCreator, CreditEdge } from './publicCreatorGraph'
import { mergeCredits, mergeSources } from './publicDescriptiveMerge'

type ReviewedGroup = CatalogEquivalenceGroup & { primaryWorkId: string }
type Correction = {
  workId: string
  siteId: string
  url: string
  label?: string
  format?: string
  wrongUrl?: string
  creditName?: string
  oldRole?: string
  newRole?: string
  placeholder?: string
  removedCreatorId?: string
  summary?: string
  aliases?: string[]
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
  const entities = read<PublicCreator>('entities.jsonl')
  const corrections = new Map(read<Correction>('corrections.jsonl').map(row => {
    if (identities.get(row.workId) !== row.siteId) throw new Error(`Correction identity drift: ${row.workId}`)
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
  const removedCreatorIds = new Set([...corrections.values()].flatMap(row => row.removedCreatorId ? [row.removedCreatorId] : []))
  return { groups, entities, creditsByWork, corrections, removedCreatorIds }
}

export type IdentityReview = ReturnType<typeof readIdentityReview>

export function correctCredit<T extends PublicCredit>(workId: string, credit: T, review: IdentityReview): T {
  const fix = review?.corrections.get(workId)
  if (!fix?.newRole || credit.name !== fix.creditName || credit.role !== fix.oldRole) return credit
  return { ...credit, role: fix.newRole, sourceUrls: [...new Set([...(credit.sourceUrls || []), fix.url])] }
}

export function applyReviewedMetadata(work: PublicWorkRecord, review: IdentityReview): PublicWorkRecord {
  const fix = review?.corrections.get(work.workId)
  const edges = review?.creditsByWork.get(work.workId)
  if (!fix && !edges) return work
  const credits = (kind: CreatorKind) => (edges || []).filter(edge => edge.creditKind === kind)
    .map(edge => ({ name: edge.name, role: edge.role, sourceUrl: edge.sourceUrls[0] }))
  return {
    ...work,
    ...(fix?.placeholder && {
      aliases: [...new Set([...work.aliases.filter(alias => alias !== fix.placeholder), ...(fix.aliases || [])])],
      localizedTitles: work.localizedTitles.filter(item => item.title !== fix.placeholder),
    }),
    ...(fix?.summary && { summary: { kind: 'source_summary' as const, text: fix.summary, sourceUrl: fix.url } }),
    ...(fix?.label && {
      title: `${work.title}（${fix.label}）`,
      aliases: [...new Set([work.title, ...work.aliases])],
      media: { ...work.media, format: fix.format },
      sources: mergeSources([...work.sources, { title: '版本与收录范围', url: fix.url }]),
    }),
    ...(fix?.wrongUrl && {
      sources: mergeSources(work.sources.map(source => source.url === fix.wrongUrl ? { ...source, url: fix.url } : source)),
      rating: work.rating.evidenceUrl === fix.wrongUrl ? { ...work.rating, evidenceUrl: fix.url } : work.rating,
    }),
    creators: mergeCredits([...work.creators.map(credit => correctCredit(work.workId, credit, review)), ...credits('person')]),
    organizations: mergeCredits([...work.organizations.filter(credit => credit.name !== fix?.placeholder), ...credits('organization')]),
  }
}
