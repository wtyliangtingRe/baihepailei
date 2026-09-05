import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { PublicCredit, PublicLocalizedTitle, PublicWorkRecord, PublicWorkSource } from './publicRelease'

export const METADATA_DIRECTORY = 'metadata-20260905-v01'
export type PublicMetadata = {
  schemaVersion: 'baihepailei-public-metadata-v1'
  workId: string
  siteId?: string
  aliases: string[]
  localizedTitles: PublicLocalizedTitle[]
  creators: PublicCredit[]
  organizations: PublicCredit[]
  sources: PublicWorkSource[]
  format?: string
  firstPublished?: string
  firstPublishedLabel?: string
  firstPublishedPrecision?: PublicWorkRecord['firstPublishedPrecision']
  summary?: PublicWorkRecord['summary']
}

export function readPublicMetadata(directory: string, identities: Map<string, string | null>) {
  const root = join(directory, METADATA_DIRECTORY)
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 'baihepailei-public-metadata-manifest-v1' ||
      manifest.applicationOrder !== 'after_identity_deduplication' || manifest.mayChangeRatings !== false) {
    throw new Error('Unrecognized descriptive metadata release')
  }
  const rows: PublicMetadata[] = manifest.shards.flatMap((shard: { file: string }) => {
    if (!/^metadata-\d{4}\.jsonl\.gz$/.test(shard.file)) throw new Error('Invalid metadata shard path')
    return gunzipSync(readFileSync(join(root, shard.file)), { maxOutputLength:10_000_000 })
      .toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  })
  const byId = new Map(rows.map(row => [row.workId, row]))
  if (rows.length !== identities.size || rows.length !== byId.size) throw new Error('Metadata coverage drift')
  for (const row of rows) {
    if (row.schemaVersion !== 'baihepailei-public-metadata-v1' || !identities.has(row.workId) ||
        (identities.get(row.workId) || '') !== (row.siteId || '')) throw new Error(`Metadata identity mismatch: ${row.workId}`)
  }
  return byId
}

const normalized = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
function unique<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map(row => [key(row), row])).values()]
}

// Call only AFTER canonical IDs, merge groups and ratings have been selected.
// Descriptive aliases must never become new automatic identity-merge keys.
export function addPublicMetadata(record: PublicWorkRecord, members: PublicMetadata[]): PublicWorkRecord {
  const ordered = [...members].sort((a, b) => Number(b.workId === record.workId) - Number(a.workId === record.workId))
  const titles = unique(ordered.flatMap(row => row.localizedTitles), row => normalized(row.title))
  const titleKeys = new Set(titles.map(row => normalized(row.title)))
  const localizedTitles = [...titles, ...record.localizedTitles.filter(row => !titleKeys.has(normalized(row.title)))]
  const aliases = unique([...record.aliases, ...ordered.flatMap(row => row.aliases)], normalized)
    .filter(title => normalized(title) !== normalized(record.title))
  const summaries = ordered.flatMap(row => row.summary ? [row.summary] : [])
  const summary = summaries.find(row => row.kind === 'source_summary') || summaries[0]
  const dated = ordered.find(row => row.firstPublished)
  return {
    ...record,
    aliases,
    localizedTitles,
    media: { ...record.media, format: ordered.find(row => row.format)?.format || record.media.format },
    firstPublished: record.firstPublished || dated?.firstPublished,
    firstPublishedLabel: record.firstPublishedLabel || dated?.firstPublishedLabel,
    firstPublishedPrecision: record.firstPublishedPrecision || dated?.firstPublishedPrecision,
    creators: unique([...record.creators, ...ordered.flatMap(row => row.creators)], row => `${normalized(row.name)}|${normalized(row.role)}`),
    organizations: unique([...record.organizations, ...ordered.flatMap(row => row.organizations)], row => `${normalized(row.name)}|${normalized(row.role)}`),
    sources: unique([...record.sources, ...ordered.flatMap(row => row.sources)], row => row.url),
    // Builder includes existing verified summaries and refuses placeholder prose.
    summary,
  }
}
