import 'server-only'

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const PUBLIC_GRADES = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const
export const PUBLIC_RATING_STATES = [
  'rated',
  'research_record_only',
  'conflict',
  'blocked',
  'research_required',
  'not_assessed',
] as const

export type PublicGrade = (typeof PUBLIC_GRADES)[number]
export type PublicRatingState = (typeof PUBLIC_RATING_STATES)[number]

export type PublicWorkRating = {
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

export type PublicWorkRecord = {
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
  rating: PublicWorkRating
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

function parseJsonLines(content: string, file: string): PublicWorkRecord[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as PublicWorkRecord
      } catch (error) {
        throw new Error(`${file}:${index + 1} is not valid JSON: ${String(error)}`)
      }
    })
}

function compareForDisplay(left: PublicWorkRecord, right: PublicWorkRecord): number {
  const stateDifference =
    (stateOrder.get(left.rating.state) ?? 99) - (stateOrder.get(right.rating.state) ?? 99)
  if (stateDifference) return stateDifference
  const gradeDifference =
    (gradeOrder.get(left.rating.grade as PublicGrade) ?? 99) -
    (gradeOrder.get(right.rating.grade as PublicGrade) ?? 99)
  if (gradeDifference) return gradeDifference
  return left.ordinal - right.ordinal
}

function loadRelease(): PublicReleaseCache {
  if (globalThis.__baihepaileiPublicRelease) return globalThis.__baihepaileiPublicRelease

  const directory = releaseDirectory()
  const manifest = JSON.parse(
    readFileSync(join(directory, 'manifest.json'), 'utf8'),
  ) as PublicReleaseManifest
  const records = manifest.shards.flatMap((shard) =>
    parseJsonLines(readFileSync(join(directory, shard.file), 'utf8'), shard.file),
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
    records,
    displayRecords: [...records].sort(compareForDisplay),
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

export function getPublicWorkById(workId: string): PublicWorkRecord | null {
  const exactWorkId = String(workId || '').trim()
  if (!exactWorkId || exactWorkId.length > 200) return null
  return loadRelease().byWorkId.get(exactWorkId) || null
}

export function getPublicWorkList(input: {
  query?: string
  grade?: string
  status?: string
  limit?: number
  offset?: number
} = {}) {
  const query = String(input.query || '').trim().toLocaleLowerCase('zh-CN').slice(0, 200)
  const grade = PUBLIC_GRADES.includes(input.grade as PublicGrade) ? input.grade : ''
  const status = PUBLIC_RATING_STATES.includes(input.status as PublicRatingState)
    ? input.status
    : ''
  const limit = normalizeLimit(input.limit)
  const offset = normalizeOffset(input.offset)
  const source = loadRelease().displayRecords
  const matched = source.filter((record) => {
    if (grade && record.rating.grade !== grade) return false
    if (status && record.rating.state !== status) return false
    if (!query) return true
    const haystack = [
      record.title,
      record.workId,
      `work ${record.workId}`,
      record.identity.provider,
      record.identity.siteId,
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
