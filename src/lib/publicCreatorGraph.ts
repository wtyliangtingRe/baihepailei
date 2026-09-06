import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { PublicCredit, PublicWorkRecord } from './publicRelease'
import { descriptiveKey, mergeCredits } from './publicDescriptiveMerge'

export type CreatorKind = 'person' | 'organization'
export type PublicCreator = {
  creatorId: string
  kind: CreatorKind
  name: string
  names: string[]
  identityBasis: 'external_id' | 'name_only' | 'unresolved_name'
}
type CreditEdge = {
  creatorId: string
  workId: string
  name: string
  role: string
  displayName: string
  creditKind: CreatorKind
  sourceUrls: string[]
  bindingBasis: string
}
export type CreatorWork = { work: PublicWorkRecord; roles: string[]; names: string[]; year: string }
export type PublicCreatorGraph = {
  entities: Map<string, PublicCreator>
  byCredit: Map<string, CreditEdge[]>
  works: Map<string, CreatorWork[]>
}
export const CREATOR_GRAPH_DIRECTORY = 'creators-20260906-v01'

const creditKey = (workId: string, kind: CreatorKind, name: string, role: string) =>
  JSON.stringify([workId, kind, descriptiveKey(name), descriptiveKey(role)])

export function publicationYear(work: PublicWorkRecord): string {
  return work.firstPublished?.match(/^(\d{4})(?:-|$)/)?.[1] || 'unknown'
}

export function readPublicCreatorGraph(directory: string, records: PublicWorkRecord[]): PublicCreatorGraph {
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
  const nodes = readRows<PublicCreator>('entities.jsonl.gz')
  const entities = new Map<string, PublicCreator>()
  for (const node of nodes) {
    if (!/^\d{7,12}$/.test(node.creatorId) || entities.has(node.creatorId) ||
        !['person', 'organization'].includes(node.kind) || !node.name.trim()) {
      throw new Error('Invalid or repeated CreatorId')
    }
    // Internal identity keys and provider IDs are not exposed by the public reader.
    entities.set(node.creatorId, { creatorId: node.creatorId, kind: node.kind,
      name: node.name, names: node.names, identityBasis: node.identityBasis })
  }
  const byWorkId = new Map(records.map(work => [work.workId, work]))
  const byCredit = new Map<string, CreditEdge[]>()
  const perCreator = new Map<string, Map<string, CreatorWork>>()
  const seen = new Set<string>()
  const creditFiles = manifest.files.filter((row: { file: string }) => /^credits-\d{4}\.jsonl\.gz$/.test(row.file))
  if (!creditFiles.length) throw new Error('Missing creator credit shards')
  for (const edge of creditFiles.flatMap((row: { file: string }) => readRows<CreditEdge>(row.file)) as CreditEdge[]) {
    const creator = entities.get(edge.creatorId)
    const work = byWorkId.get(edge.workId)
    if (!creator || !work) throw new Error(`Creator edge references a missing public node: ${edge.workId}`)
    if (!['person', 'organization'].includes(edge.creditKind)) throw new Error('Invalid credit kind')
    const credits = edge.creditKind === 'person' ? work.creators : work.organizations
    if (!credits.some(credit => descriptiveKey(credit.name) === descriptiveKey(edge.name) &&
        descriptiveKey(credit.role) === descriptiveKey(edge.role))) throw new Error('Creator credit drift')
    const unique = JSON.stringify([edge.workId, edge.creatorId, edge.name, edge.displayName, edge.role])
    if (seen.has(unique)) throw new Error('Repeated creator credit edge')
    seen.add(unique)
    const key = creditKey(work.workId, edge.creditKind, edge.name, edge.role)
    byCredit.set(key, [...(byCredit.get(key) || []), edge])
    const works = perCreator.get(creator.creatorId) || new Map<string, CreatorWork>()
    const entry = works.get(work.workId) || { work, roles: [], names: [], year: publicationYear(work) }
    if (!entry.roles.includes(edge.role)) entry.roles.push(edge.role)
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
  return { entities, byCredit, works }
}

export function withCreatorIds(work: PublicWorkRecord, graph: PublicCreatorGraph): PublicWorkRecord {
  function attach(credits: PublicCredit[], kind: CreatorKind): PublicCredit[] {
    return mergeCredits(credits.flatMap(credit => (graph.byCredit.get(creditKey(work.workId, kind, credit.name, credit.role)) || [])
      .map(edge => ({ ...credit, name: edge.displayName, originalName: credit.name, originalNames: [credit.name],
        creatorId: edge.creatorId, creatorKind: graph.entities.get(edge.creatorId)!.kind,
        sourceUrls: [...new Set([...(credit.sourceUrls || []), ...edge.sourceUrls, ...(credit.sourceUrl ? [credit.sourceUrl] : [])])] }))))
  }
  return { ...work, creators: attach(work.creators, 'person'), organizations: attach(work.organizations, 'organization') }
}
