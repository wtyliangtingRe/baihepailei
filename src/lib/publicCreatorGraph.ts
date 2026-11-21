import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { PublicCredit, PublicWorkRecord } from './publicRelease'
import { descriptiveKey, mergeCredits } from './publicDescriptiveMerge'
import { correctCredit, type IdentityReview } from './publicIdentityReview'
import { readAnimationCreditNames } from './publicAnimationCreditNames'
import { catalogStaffRedirects } from './publicCatalogStaffIdentities'
import { readHistoricalOrganizations } from './publicHistoricalOrganizations'

export type CreatorKind = 'person' | 'organization'
export type PublicCreator = {
  creatorId: string
  kind: CreatorKind
  name: string
  names: string[]
  identityBasis: 'external_id' | 'name_only' | 'unresolved_name'
}
export type CreditEdge = {
  sourceWorkId?: string
  creatorId: string
  workId: string
  name: string
  role: string
  displayName: string
  creditKind: CreatorKind
  sourceUrls: string[]
  bindingBasis: string
  scope?: string
}
export type CreatorWork = { work: PublicWorkRecord; roles: string[]; names: string[]; year: string; roleScopes?: Record<string, string[]> }
export type PublicCreatorGraph = {
  entities: Map<string, PublicCreator>
  redirects: Map<string, string>
  byCredit: Map<string, CreditEdge[]>
  works: Map<string, CreatorWork[]>
}
export const CREATOR_GRAPH_DIRECTORY = 'creators-20260906-v01'

const creditKey = (workId: string, kind: CreatorKind, name: string, role: string) =>
  JSON.stringify([workId, kind, descriptiveKey(name), descriptiveKey(role)])

export function publicationYear(work: PublicWorkRecord): string {
  return work.firstPublished?.match(/^(\d{4})(?:-|$)/)?.[1] || 'unknown'
}

export function readPublicCreatorGraph(directory: string, records: PublicWorkRecord[], review?: IdentityReview): PublicCreatorGraph {
  const root = join(directory, CREATOR_GRAPH_DIRECTORY)
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 'baihepailei-public-creator-graph-v1' ||
      manifest.policy?.mayChangeRatings !== false || manifest.policy?.appendOnlyIds !== true) {
    throw new Error('Unrecognized creator graph release')
  }
  function readRows<T>(file: string): T[] {
    const descriptor = manifest.files.find((row: { file: string }) => row.file === file)
    if (!descriptor) throw new Error(`Missing creator graph descriptor: ${file}`)
    const bytes = readFileSync(join(root, file))
    if (bytes.length !== descriptor.bytes || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
      throw new Error(`Creator graph integrity mismatch: ${file}`)
    }
    const rows = gunzipSync(bytes, { maxOutputLength: 50_000_000 }).toString('utf8')
      .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    if (rows.length !== descriptor.rows) throw new Error(`Creator graph count mismatch: ${file}`)
    return rows
  }
  const creditNames = readAnimationCreditNames(directory, Boolean(review))
  const historicalOrganizations = readHistoricalOrganizations(directory, Boolean(review))
  const nodes = [...readRows<PublicCreator>('entities.jsonl.gz'), ...(review?.entities || [])]
  const entities = new Map<string, PublicCreator>()
  for (const node of nodes) {
    if (review?.removedCreatorIds.has(node.creatorId) || creditNames.redirects.has(node.creatorId)) continue
    if (!/^\d{7,12}$/.test(node.creatorId) || entities.has(node.creatorId) ||
        !['person', 'organization'].includes(node.kind) || !node.name.trim()) {
      throw new Error('Invalid or repeated CreatorId')
    }
    // Internal identity keys and provider IDs are not exposed by the public reader.
    entities.set(node.creatorId, { creatorId: node.creatorId, kind: node.kind,
      name: node.name, names: node.names, identityBasis: node.identityBasis })
  }
  const byWorkId = new Map(records.map(work => [work.workId, work]))
  const reviewedPrimary = new Map((review?.groups || []).flatMap(group =>
    group.workIds.map(id => [id, group.primaryWorkId] as const)))
  const byCredit = new Map<string, CreditEdge[]>()
  const perCreator = new Map<string, Map<string, CreatorWork>>()
  const seen = new Set<string>()
  const creditFiles = manifest.files.filter((row: { file: string }) => /^credits-\d{4}\.jsonl\.gz$/.test(row.file))
  if (!creditFiles.length) throw new Error('Missing creator credit shards')
  const edges: CreditEdge[] = creditFiles.flatMap((row: { file: string }) => readRows<CreditEdge>(row.file)
    .flatMap(edge => creditNames.resolve(edge, entities)).map(historicalOrganizations.correctCatalog))
  creditNames.assertComplete()
  historicalOrganizations.assertCatalogComplete()
  for (const reviewed of review?.creditsByWork.values() || []) edges.push(...reviewed)
  for (const original of edges) {
    if (review?.removedCreatorIds.has(original.creatorId)) continue
    const corrected = correctCredit(original.workId, original, review)
    const primary = reviewedPrimary.get(original.workId)
    const edge = primary ? { ...corrected, workId: primary } : corrected
    const creator = entities.get(edge.creatorId)
    const work = byWorkId.get(edge.workId)
    if (!creator || !work) throw new Error(`Creator edge references a missing public node: ${edge.workId}`)
    if (!['person', 'organization'].includes(edge.creditKind)) throw new Error('Invalid credit kind')
    const credits = edge.creditKind === 'person' ? work.creators : work.organizations
    if (!credits.some(credit => descriptiveKey(credit.name) === descriptiveKey(edge.name) &&
        descriptiveKey(credit.role) === descriptiveKey(edge.role))) throw new Error(`Creator credit drift for ${original.workId} → ${edge.workId}: ${edge.name} (${edge.role}, ${edge.bindingBasis})`)
    const unique = JSON.stringify([original.sourceWorkId || original.workId, edge.bindingBasis, edge.creatorId, edge.name, edge.displayName, edge.role, edge.scope])
    if (seen.has(unique)) throw new Error(`Repeated creator credit for ${edge.workId}: ${edge.name} (${edge.role}, ${edge.bindingBasis})`)
    seen.add(unique)
    const key = creditKey(work.workId, edge.creditKind, edge.name, edge.role)
    byCredit.set(key, [...(byCredit.get(key) || []), edge])
    const works = perCreator.get(creator.creatorId) || new Map<string, CreatorWork>()
    const entry: CreatorWork = works.get(work.workId) || { work, roles: [], names: [], year: publicationYear(work) }
    if (!entry.roles.includes(edge.role)) entry.roles.push(edge.role)
    if (edge.scope) {
      const scopes = entry.roleScopes ||= {}
      const values = scopes[edge.role] ||= []
      if (!values.includes(edge.scope)) values.push(edge.scope)
    }
    if (!entry.names.includes(edge.displayName)) entry.names.push(edge.displayName)
    works.set(work.workId, entry)
    perCreator.set(creator.creatorId, works)
  }
  for (const work of records) {
    for (const [kind, credits] of [['person', work.creators], ['organization', work.organizations]] as const) {
      for (const credit of credits) {
        if (!byCredit.has(creditKey(work.workId, kind, credit.name, credit.role))) {
          throw new Error(`Missing CreatorId for Work ${work.workId}: ${credit.name}`)
        }
      }
    }
  }
  const works = new Map([...perCreator].map(([id, rows]) => [id, [...rows.values()].sort((a, b) => {
    if (a.year !== b.year) {
      if (a.year === 'unknown') return 1
      if (b.year === 'unknown') return -1
      return b.year.localeCompare(a.year)
    }
    return (b.work.firstPublished || '').localeCompare(a.work.firstPublished || '') ||
      a.work.title.localeCompare(b.work.title, 'zh-CN') || Number(a.work.workId) - Number(b.work.workId)
  })]))
  const redirects = new Map([...creditNames.redirects, ...historicalOrganizations.redirects, ...(review ? catalogStaffRedirects(directory) : [])])
  return { entities, byCredit, works, redirects }
}

export function withCreatorIds(work: PublicWorkRecord, graph: PublicCreatorGraph): PublicWorkRecord {
  function attach(credits: PublicCredit[], kind: CreatorKind): PublicCredit[] {
    return mergeCredits(credits.flatMap(credit => (graph.byCredit.get(creditKey(work.workId, kind, credit.name, credit.role)) || [])
      .map(edge => {
        const creator = graph.entities.get(edge.creatorId)!
        const sameSpelling = edge.displayName.replace(/\s/gu, '') === creator.name.replace(/\s/gu, '')
        const name = edge.bindingBasis === 'licensed_animation_edition' && sameSpelling ? creator.name : edge.displayName
        return { ...credit, name, originalName: credit.name, originalNames: [credit.name],
          creatorId: edge.creatorId, creatorKind: creator.kind, scope: edge.scope,
          sourceUrls: [...new Set([...(credit.sourceUrls || []), ...edge.sourceUrls, ...(credit.sourceUrl ? [credit.sourceUrl] : [])])] }
      })))
  }
  return { ...work, creators: attach(work.creators, 'person'), organizations: attach(work.organizations, 'organization') }
}
