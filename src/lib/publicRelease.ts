import 'server-only'

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { isRadarRatingClass } from '@/lib/radar/ratingPolicy'

export const PUBLIC_GRADES = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const
export const PUBLIC_RATING_STATES = [
  'rated',
  'research_record_only',
  'conflict',
  'blocked',
  'research_required',
  'not_assessed',
] as const
export const PUBLIC_MEDIA_GROUPS = ['anime', 'manga', 'novel', 'visual_novel', 'game', 'other', 'unknown'] as const

export type PublicGrade = (typeof PUBLIC_GRADES)[number]
export type PublicRatingState = (typeof PUBLIC_RATING_STATES)[number]
export type PublicMediaGroup = (typeof PUBLIC_MEDIA_GROUPS)[number]

export type PublicCredit = {
  name: string
  role: string
  sourceUrl?: string
}

export type PublicWorkSource = {
  title: string
  url: string
  tier?: string
}

export type PublicWorkRating = {
  state: PublicRatingState
  grade?: PublicGrade
  bestGrade?: PublicGrade
  likelyGrade?: PublicGrade
  worstGrade?: PublicGrade
  class?: string
  classes: string[]
  mode?: string
  confidence?: string
  needsMoreResearch?: boolean
  reasoningSummary?: string
  evidenceUrl?: string
  uncertaintyKind?: 'evidence_insufficient'
}

export type PublicWorkRecord = {
  schemaVersion: 'baihepailei-public-work-view-v2'
  workId: string
  title: string
  aliases: string[]
  media: {
    group: PublicMediaGroup
    type: string
  }
  firstPublished?: string
  creators: PublicCredit[]
  organizations: PublicCredit[]
  summary?: {
    kind: 'source_summary'
    text: string
    sourceUrl?: string
  }
  sources: PublicWorkSource[]
  rating: PublicWorkRating
}

type BasePublicWorkRecord = {
  schemaVersion: 'baihepailei-public-work-v1'
  workId: string
  ordinal: number
  title: string
  identity: {
    state: 'exact' | 'partial' | 'repair_required'
    provider: string
    siteId: string
    coverage: string
  }
  audited: boolean
  rating: {
    state: PublicRatingState
    grade?: PublicGrade
    bestGrade?: PublicGrade
    likelyGrade?: PublicGrade
    worstGrade?: PublicGrade
    class?: string
    mode?: string
    confidence?: string
    needsMoreResearch?: boolean
    reasoningSummary?: string
    reasonCode?: string
    source?: string
  }
}

type MediaEnrichment = {
  schemaVersion: 'baihepailei-public-media-enrichment-v1'
  rows: number
  groups: Array<{
    mediaGroup: string
    mediaType: string
    workIds: string[]
  }>
}

type WorkAssetEnrichment = {
  schemaVersion: 'baihepailei-public-work-asset-v1'
  workId: string
  aliases?: string[]
  firstPublished?: string
  creators?: PublicCredit[]
  organizations?: PublicCredit[]
  summary?: PublicWorkRecord['summary']
  sources?: PublicWorkSource[]
}

type RatingDetailEnrichment = {
  schemaVersion: 'baihepailei-public-rating-detail-v1'
  workId: string
  grade: PublicGrade
  mode?: string
  bestGrade?: PublicGrade
  likelyGrade?: PublicGrade
  worstGrade?: PublicGrade
  classes?: string[]
  reasoningSummary?: string
  evidenceUrl?: string
}

export type PublicEnrichmentManifest = {
  schemaVersion: 'baihepailei-public-enrichment-manifest-v1'
  generatedAt: string
  bindingPolicy: string
  inheritedRatingsAllowed: boolean
  sources: {
    media: {
      blobSha: string
      rows: number
      file: string
      bytes: number
      sha256: string
    }
    workAssets: {
      blobSha: string
      rows: number
      summaries: number
      creatorCreditWorks: number
      organizationCreditWorks: number
      firstPublishedWorks: number
      file: string
      bytes: number
      sha256: string
    }
    ratingDetails: {
      frozenAssessmentRows: number
      authoredV24Rows: number
      uniqueRows: number
      authoredAuthorityBlobSha: string
      file: string
      bytes: number
      sha256: string
    }
  }
  displayRules: Record<string, boolean>
}

export type PublicReleaseManifest = {
  schemaVersion: 'baihepailei-public-release-manifest-v1'
  releaseId: string
  generatedAt: string
  publicationPolicy: {
    currentDurableDataOnly: boolean
    waitForAdditionalData: boolean
    preserveFrozenHistory: boolean
    forceGradesForNonratingTerminalStates: boolean
    dUnclear: string
    catalogExclusions: Array<{ rows: number; reason: string }>
  }
  counts: {
    catalogWorks: number
    publicIdentityBindings: number
    partialIdentityBindings: number
    identityRepairRequired: number
    auditedWorks: number
    ratedWorks: number
    nonratingTerminalWorks: number
    notAssessedWorks: number
    ratingsNeedingMoreResearch: number
    dUnclearRatings: number
  }
  ratingStatusCounts: Record<PublicRatingState, number>
  nonratingTerminalBreakdown: Record<string, number>
  gradeCounts: Record<PublicGrade, number>
  invariants: Record<string, string | number | boolean>
  shards: Array<{ file: string; rows: number; bytes: number; sha256: string }>
}

type PublicReleaseCache = {
  manifest: PublicReleaseManifest
  enrichmentManifest: PublicEnrichmentManifest
  records: PublicWorkRecord[]
  displayRecords: PublicWorkRecord[]
  byWorkId: Map<string, PublicWorkRecord>
}

declare global {
  var __baihepaileiPublicRelease: PublicReleaseCache | undefined
}

const gradeOrder = new Map(PUBLIC_GRADES.map((grade, index) => [grade, index]))
const stateOrder = new Map(PUBLIC_RATING_STATES.map((state, index) => [state, index]))

function releaseDirectory(): string {
  const configured = String(process.env.BAIHEPAILEI_RELEASE_DIR || '').trim()
  return configured ? resolve(configured) : join(process.cwd(), 'data', 'public-release', 'v1')
}

function parseJsonLines<T>(content: string, file: string): T[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as T
      } catch (error) {
        throw new Error(`${file}:${index + 1} is not valid JSON: ${String(error)}`)
      }
    })
}

function normalizeMediaGroup(value: string): PublicMediaGroup {
  if (value === 'anime' || value === 'manga' || value === 'novel' || value === 'game' || value === 'other') {
    return value
  }
  if (value === 'visual_novel') return 'visual_novel'
  return 'unknown'
}

function mergeRating(
  base: BasePublicWorkRecord['rating'],
  detail: RatingDetailEnrichment | undefined,
): PublicWorkRating {
  const matchingDetail = detail?.grade === base.grade ? detail : undefined
  const baseClass = base.class && isRadarRatingClass(base.class) ? base.class : undefined
  const classes = [...new Set([
    ...(baseClass ? [baseClass] : []),
    ...(matchingDetail?.classes || []).filter(isRadarRatingClass),
  ])]

  return {
    state: base.state,
    grade: base.grade,
    bestGrade: base.bestGrade || matchingDetail?.bestGrade,
    likelyGrade: base.likelyGrade || matchingDetail?.likelyGrade,
    worstGrade: base.worstGrade || matchingDetail?.worstGrade,
    class: baseClass || classes[0],
    classes,
    mode: base.mode || matchingDetail?.mode,
    confidence: base.confidence,
    needsMoreResearch: base.needsMoreResearch,
    reasoningSummary: base.reasoningSummary || matchingDetail?.reasoningSummary,
    evidenceUrl: matchingDetail?.evidenceUrl,
    uncertaintyKind: base.class === 'D-UNCLEAR' ? 'evidence_insufficient' : undefined,
  }
}

function toPublicRecord(
  base: BasePublicWorkRecord,
  media: PublicWorkRecord['media'] | undefined,
  asset: WorkAssetEnrichment | undefined,
  detail: RatingDetailEnrichment | undefined,
): PublicWorkRecord {
  return {
    schemaVersion: 'baihepailei-public-work-view-v2',
    workId: base.workId,
    title: base.title,
    aliases: asset?.aliases || [],
    media: media || { group: 'unknown', type: 'unknown' },
    firstPublished: asset?.firstPublished,
    creators: asset?.creators || [],
    organizations: asset?.organizations || [],
    summary: asset?.summary,
    sources: asset?.sources || [],
    rating: mergeRating(base.rating, detail),
  }
}

function compareForDisplay(
  left: PublicWorkRecord,
  right: PublicWorkRecord,
  ordinals: Map<string, number>,
): number {
  const stateDifference =
    (stateOrder.get(left.rating.state) ?? 99) - (stateOrder.get(right.rating.state) ?? 99)
  if (stateDifference) return stateDifference
  const gradeDifference =
    (gradeOrder.get(left.rating.grade as PublicGrade) ?? 99) -
    (gradeOrder.get(right.rating.grade as PublicGrade) ?? 99)
  if (gradeDifference) return gradeDifference
  return (ordinals.get(left.workId) ?? 0) - (ordinals.get(right.workId) ?? 0)
}

function loadRelease(): PublicReleaseCache {
  if (globalThis.__baihepaileiPublicRelease) return globalThis.__baihepaileiPublicRelease

  const directory = releaseDirectory()
  const manifest = JSON.parse(
    readFileSync(join(directory, 'manifest.json'), 'utf8'),
  ) as PublicReleaseManifest
  const enrichmentManifest = JSON.parse(
    readFileSync(join(directory, 'enrichment-manifest.json'), 'utf8'),
  ) as PublicEnrichmentManifest
  const baseRecords = manifest.shards.flatMap((shard) =>
    parseJsonLines<BasePublicWorkRecord>(
      readFileSync(join(directory, shard.file), 'utf8'),
      shard.file,
    ),
  )

  const mediaDocument = JSON.parse(
    readFileSync(join(directory, 'enrichment-media.json'), 'utf8'),
  ) as MediaEnrichment
  const mediaByWorkId = new Map<string, PublicWorkRecord['media']>()
  for (const group of mediaDocument.groups) {
    for (const workId of group.workIds) {
      mediaByWorkId.set(workId, {
        group: normalizeMediaGroup(group.mediaGroup === 'game' && group.mediaType === 'visual_novel'
          ? 'visual_novel'
          : group.mediaGroup),
        type: group.mediaType,
      })
    }
  }

  const assets = parseJsonLines<WorkAssetEnrichment>(
    readFileSync(join(directory, 'enrichment-work-assets.jsonl'), 'utf8'),
    'enrichment-work-assets.jsonl',
  )
  const details = parseJsonLines<RatingDetailEnrichment>(
    readFileSync(join(directory, 'enrichment-rating-details.jsonl'), 'utf8'),
    'enrichment-rating-details.jsonl',
  )
  const assetByWorkId = new Map(assets.map((asset) => [asset.workId, asset]))
  const detailByWorkId = new Map(details.map((detail) => [detail.workId, detail]))
  const ordinals = new Map(baseRecords.map((record) => [record.workId, record.ordinal]))
  const records = baseRecords.map((record) =>
    toPublicRecord(
      record,
      mediaByWorkId.get(record.workId),
      assetByWorkId.get(record.workId),
      detailByWorkId.get(record.workId),
    ),
  )
  const byWorkId = new Map(records.map((record) => [record.workId, record]))

  if (records.length !== manifest.counts.catalogWorks) {
    throw new Error(`Public release row-count drift: ${records.length}`)
  }
  if (byWorkId.size !== records.length) {
    throw new Error('Public release contains duplicate Work IDs')
  }

  globalThis.__baihepaileiPublicRelease = {
    manifest,
    enrichmentManifest,
    records,
    displayRecords: [...records].sort((left, right) => compareForDisplay(left, right, ordinals)),
    byWorkId,
  }
  return globalThis.__baihepaileiPublicRelease
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return 30
  return Math.min(Number(value), 100)
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return 0
  return Math.min(Number(value), 1_000_000)
}

export function getPublicReleaseManifest(): PublicReleaseManifest {
  return loadRelease().manifest
}

export function getPublicEnrichmentManifest(): PublicEnrichmentManifest {
  return loadRelease().enrichmentManifest
}

export function getPublicWorkById(workId: string): PublicWorkRecord | null {
  const exactWorkId = String(workId || '').trim()
  if (!exactWorkId || exactWorkId.length > 200) return null
  return loadRelease().byWorkId.get(exactWorkId) || null
}

export function getPublicWorkList(input: {
  query?: string
  grade?: string
  status?: string
  media?: string
  limit?: number
  offset?: number
} = {}) {
  const query = String(input.query || '').trim().toLocaleLowerCase('zh-CN').slice(0, 200)
  const grade = PUBLIC_GRADES.includes(input.grade as PublicGrade) ? input.grade : ''
  const status = PUBLIC_RATING_STATES.includes(input.status as PublicRatingState)
    ? input.status
    : ''
  const media = PUBLIC_MEDIA_GROUPS.includes(input.media as PublicMediaGroup) ? input.media : ''
  const limit = normalizeLimit(input.limit)
  const offset = normalizeOffset(input.offset)
  const source = loadRelease().displayRecords
  const matched = source.filter((record) => {
    if (grade && record.rating.grade !== grade) return false
    if (status && record.rating.state !== status) return false
    if (media && record.media.group !== media) return false
    if (!query) return true
    const haystack = [
      record.title,
      ...record.aliases,
      ...record.creators.flatMap((credit) => [credit.name, credit.role]),
      ...record.organizations.flatMap((credit) => [credit.name, credit.role]),
      record.media.group,
      record.media.type,
      record.workId,
      `work ${record.workId}`,
    ].join('\n').toLocaleLowerCase('zh-CN')
    return haystack.includes(query)
  })
  return {
    items: matched.slice(offset, offset + limit),
    total: matched.length,
    limit,
    offset,
  }
}
