import 'server-only'

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { addPublicMetadata, readPublicMetadata } from '@/lib/publicMetadata'
import { mergeCredits } from '@/lib/publicDescriptiveMerge'
import { readPublicCreatorGraph, withCreatorIds, type CreatorKind, type PublicCreatorGraph } from '@/lib/publicCreatorGraph'

import { isRadarRatingClass, radarClassDefinitions } from '@/lib/radar/ratingPolicy'
import { publicSearchTermsForRatingClass } from '@/lib/radar/publicSearchTerms'
import { publicTagsFor, type PublicTagKey } from '@/lib/radar/publicTags'

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
  sourceUrls?: string[]
  creatorId?: string
  creatorKind?: CreatorKind
  originalName?: string
  originalNames?: string[]
}

export type PublicLocalizedTitle = {
  title: string
  language?: string
  region?: string
  kind?: 'original' | 'official' | 'localized' | 'romanized' | 'alias'
}

export type PublicCover = {
  url: string
  alt?: string
  width?: number
  height?: number
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
  localizedTitles: PublicLocalizedTitle[]
  media: {
    group: PublicMediaGroup
    type: string
    format?: string
  }
  firstPublished?: string
  firstPublishedLabel?: string
  firstPublishedPrecision?: 'day' | 'month' | 'year' | 'unknown'
  cover?: PublicCover
  creators: PublicCredit[]
  organizations: PublicCredit[]
  publicTags: ReturnType<typeof publicTagsFor>
  summary?: {
    kind: 'source_summary' | 'identity_summary'
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
  localizedTitles?: PublicLocalizedTitle[]
  format?: string
  firstPublished?: string
  firstPublishedLabel?: string
  firstPublishedPrecision?: PublicWorkRecord['firstPublishedPrecision']
  cover?: PublicCover
  creators?: PublicCredit[]
  organizations?: PublicCredit[]
  publicTags?: PublicTagKey[]
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

type CatalogEquivalenceGroup = {
  schemaVersion: 'baihepailei-public-catalog-equivalence-v1'
  groupId: string
  decision: 'merge'
  workIds: string[]
  resolvedMedia?: {
    group: PublicMediaGroup
    type: string
  }
}

type CatalogTitleEvidence = {
  schemaVersion: 'baihepailei-public-catalog-title-evidence-v1'
  workId: string
  titles: Array<PublicLocalizedTitle & { source?: string }>
  sources?: PublicWorkSource[]
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

export type PublicCatalogMergeStats = {
  sourceWorks: number
  visibleWorks: number
  mergedAway: number
  multiWorkGroups: number
  largestGroup: number
}

type PublicReleaseCache = {
  creatorGraph?: PublicCreatorGraph
  manifest: PublicReleaseManifest
  enrichmentManifest: PublicEnrichmentManifest
  records: PublicWorkRecord[]
  displayRecords: PublicWorkRecord[]
  byWorkId: Map<string, PublicWorkRecord>
  memberIdsByPrimary: Map<string, string[]>
  mergeStats: PublicCatalogMergeStats
}

declare global {
  var __baihepaileiPublicRelease: PublicReleaseCache | undefined
}

const gradeOrder = new Map(PUBLIC_GRADES.map((grade, index) => [grade, index]))
const stateOrder = new Map(PUBLIC_RATING_STATES.map((state, index) => [state, index]))
const terminalSelectionOrder = new Map<PublicRatingState, number>([
  ['conflict', 0],
  ['blocked', 1],
  ['research_required', 2],
  ['research_record_only', 3],
  ['not_assessed', 4],
  ['rated', 5],
])

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

function normalizeMergeTitle(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function normalizeIdentityMergeTitle(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, '')
}

function mediaMergeBucket(group: PublicMediaGroup): string {
  if (group === 'game' || group === 'visual_novel') return 'game'
  if (group === 'other' || group === 'unknown') return 'unknown'
  return group
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
  const rating = mergeRating(base.rating, detail)
  return {
    schemaVersion: 'baihepailei-public-work-view-v2',
    workId: base.workId,
    title: base.title,
    aliases: asset?.aliases || [],
    localizedTitles: asset?.localizedTitles || [],
    media: { ...(media || { group: 'unknown', type: 'unknown' }), format: asset?.format },
    firstPublished: asset?.firstPublished,
    firstPublishedLabel: asset?.firstPublishedLabel,
    firstPublishedPrecision: asset?.firstPublishedPrecision,
    cover: asset?.cover,
    creators: asset?.creators || [],
    organizations: asset?.organizations || [],
    publicTags: publicTagsFor(asset?.publicTags, rating.classes),
    summary: asset?.summary,
    sources: asset?.sources || [],
    rating,
  }
}

function uniqueStrings(values: string[], excludedTitle?: string): string[] {
  const seen = new Set<string>()
  const excluded = normalizeMergeTitle(excludedTitle || '')
  const result: string[] = []
  for (const raw of values) {
    const value = String(raw || '').trim()
    const key = normalizeMergeTitle(value)
    if (!value || !key || key === excluded || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function uniqueIdentityMergeNames(record: PublicWorkRecord): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of [
    record.title,
    ...record.aliases,
    ...record.localizedTitles.map((title) => title.title),
  ]) {
    const value = String(raw || '').trim()
    const key = normalizeIdentityMergeTitle(value)
    if (!value || key.length < 2 || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function uniqueLocalizedTitles(values: PublicLocalizedTitle[]): PublicLocalizedTitle[] {
  const seen = new Set<string>()
  const result: PublicLocalizedTitle[] = []
  for (const value of values) {
    const title = String(value.title || '').trim()
    const normalized = normalizeMergeTitle(title)
    if (!normalized) continue
    const key = [normalized, value.language || '', value.region || '', value.kind || ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...value, title })
  }
  return result
}

function uniqueCredits(values: PublicCredit[]): PublicCredit[] {
  return mergeCredits(values)
}

function uniqueSources(values: PublicWorkSource[]): PublicWorkSource[] {
  const seen = new Set<string>()
  return values.filter((source) => {
    const key = String(source.url || '').trim() || `${source.title}|${source.tier || ''}`
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function recordRichness(record: PublicWorkRecord): number {
  return (
    (record.rating.state === 'rated' ? 10_000 : record.rating.state === 'not_assessed' ? 0 : 4_000) +
    record.localizedTitles.length * 25 +
    record.aliases.length * 15 +
    record.creators.length * 80 +
    record.organizations.length * 80 +
    record.sources.length * 20 +
    record.publicTags.length * 15 +
    (record.summary?.text.length || 0) +
    (record.cover ? 120 : 0) +
    (record.firstPublished ? 80 : 0) +
    record.rating.classes.length * 80 +
    (record.rating.reasoningSummary?.length || 0)
  )
}

function selectMergedRating(records: PublicWorkRecord[]): PublicWorkRating {
  const rated = records.filter((record) => record.rating.state === 'rated' && record.rating.grade)
  let candidates: PublicWorkRecord[]
  if (rated.length) {
    const worstIndex = Math.max(...rated.map((record) => gradeOrder.get(record.rating.grade as PublicGrade) ?? -1))
    candidates = rated.filter((record) => (gradeOrder.get(record.rating.grade as PublicGrade) ?? -1) === worstIndex)
  } else {
    const bestTerminalRank = Math.min(...records.map((record) => terminalSelectionOrder.get(record.rating.state) ?? 99))
    candidates = records.filter((record) => (terminalSelectionOrder.get(record.rating.state) ?? 99) === bestTerminalRank)
  }

  const selected = [...candidates].sort((left, right) => recordRichness(right) - recordRichness(left))[0] || records[0]
  const selectedGrade = selected.rating.grade
  const sameGrade = selectedGrade
    ? records.filter((record) => record.rating.grade === selectedGrade)
    : candidates
  const classes = [...new Set(sameGrade.flatMap((record) => record.rating.classes))]
    .filter((ratingClass) => {
      if (!isRadarRatingClass(ratingClass)) return false
      return !selectedGrade || radarClassDefinitions[ratingClass].grade === selectedGrade
    })
  const reasoningSummary = [...sameGrade]
    .map((record) => record.rating.reasoningSummary)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length)[0]
  const evidenceUrl = sameGrade.find((record) => record.rating.evidenceUrl)?.rating.evidenceUrl

  return {
    ...selected.rating,
    class: selected.rating.class && classes.includes(selected.rating.class)
      ? selected.rating.class
      : classes[0],
    classes,
    reasoningSummary: reasoningSummary || selected.rating.reasoningSummary,
    evidenceUrl: selected.rating.evidenceUrl || evidenceUrl,
    needsMoreResearch: records.some((record) => record.rating.needsMoreResearch),
    uncertaintyKind: selectedGrade === 'D' && records.some((record) => record.rating.uncertaintyKind)
      ? 'evidence_insufficient'
      : selected.rating.uncertaintyKind,
  }
}

function selectPublishedMetadata(records: PublicWorkRecord[]) {
  const dated = records.filter((record) => record.firstPublished).sort((left, right) =>
    String(left.firstPublished).localeCompare(String(right.firstPublished)),
  )[0]
  return {
    firstPublished: dated?.firstPublished || records.find((record) => record.firstPublished)?.firstPublished,
    firstPublishedLabel: dated?.firstPublishedLabel || records.find((record) => record.firstPublishedLabel)?.firstPublishedLabel,
    firstPublishedPrecision: dated?.firstPublishedPrecision || records.find((record) => record.firstPublishedPrecision)?.firstPublishedPrecision,
  }
}

function mergeRecordGroup(
  records: PublicWorkRecord[],
  ordinals: Map<string, number>,
  titleEvidenceByWorkId: Map<string, CatalogTitleEvidence>,
  resolvedMedia?: CatalogEquivalenceGroup['resolvedMedia'],
): PublicWorkRecord {
  const primary = [...records].sort((left, right) => {
    const richness = recordRichness(right) - recordRichness(left)
    if (richness) return richness
    return (ordinals.get(left.workId) ?? Number.MAX_SAFE_INTEGER) -
      (ordinals.get(right.workId) ?? Number.MAX_SAFE_INTEGER)
  })[0]
  const titleEvidence = records.flatMap((record) => {
    const evidence = titleEvidenceByWorkId.get(record.workId)
    return evidence ? [evidence] : []
  })
  const localizedTitles = uniqueLocalizedTitles([
    ...records.flatMap((record) => record.localizedTitles),
    ...titleEvidence.flatMap((evidence) => evidence.titles.map((title) => ({
      title: title.title,
      language: title.language,
      region: title.region,
      kind: title.kind,
    }))),
  ])
  const aliases = uniqueStrings([
    ...records.flatMap((record) => [record.title, ...record.aliases]),
  ], primary.title)
  const mediaSource = primary.media.group !== 'unknown' && primary.media.group !== 'other'
    ? primary
    : records.find((record) => record.media.group !== 'unknown' && record.media.group !== 'other') || primary
  const summary = [...records]
    .map((record) => record.summary)
    .filter((value): value is NonNullable<PublicWorkRecord['summary']> => Boolean(value))
    .sort((left, right) => right.text.length - left.text.length)[0]
  const cover = primary.cover || records.find((record) => record.cover)?.cover
  const publication = selectPublishedMetadata(records)
  const publicTags = [...new Map(
    records.flatMap((record) => record.publicTags).map((tag) => [tag.key, tag]),
  ).values()]

  return {
    ...primary,
    aliases,
    localizedTitles,
    media: {
      ...(resolvedMedia || mediaSource.media),
      format: primary.media.format || records.find((record) => record.media.format)?.media.format,
    },
    ...publication,
    cover,
    creators: uniqueCredits(records.flatMap((record) => record.creators)),
    organizations: uniqueCredits(records.flatMap((record) => record.organizations)),
    publicTags,
    summary,
    sources: uniqueSources([
      ...records.flatMap((record) => record.sources),
      ...titleEvidence.flatMap((evidence) => evidence.sources || []),
    ]),
    rating: selectMergedRating(records),
  }
}

function deduplicateCatalog(
  records: PublicWorkRecord[],
  baseRecords: BasePublicWorkRecord[],
  ordinals: Map<string, number>,
  equivalenceGroups: CatalogEquivalenceGroup[],
  titleEvidenceByWorkId: Map<string, CatalogTitleEvidence>,
) {
  const parent = records.map((_, index) => index)
  const find = (index: number): number => {
    let cursor = index
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]]
      cursor = parent[cursor]
    }
    return cursor
  }
  const union = (left: number, right: number): number => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return leftRoot
    const root = Math.min(leftRoot, rightRoot)
    parent[Math.max(leftRoot, rightRoot)] = root
    return root
  }

  const identityOwner = new Map<string, number>()
  records.forEach((_, index) => {
    const base = baseRecords[index]
    if (base.identity.state !== 'exact' || !base.identity.provider || !base.identity.siteId) return
    const key = `${base.identity.provider.toLowerCase()}|${base.identity.siteId}`
    const owner = identityOwner.get(key)
    if (owner === undefined) identityOwner.set(key, index)
    else union(owner, index)
  })

  const ambiguousTitleClaims = new Map<string, Map<string, Set<string>>>()
  records.forEach((record, index) => {
    const base = baseRecords[index]
    if (!base.identity.provider || !base.identity.siteId) return
    const provider = base.identity.provider.toLowerCase()
    const bucket = mediaMergeBucket(record.media.group)
    for (const name of uniqueIdentityMergeNames(record)) {
      const normalized = normalizeIdentityMergeTitle(name)
      const key = `${bucket}|${normalized}`
      const providerClaims = ambiguousTitleClaims.get(key) || new Map<string, Set<string>>()
      const siteIds = providerClaims.get(provider) || new Set<string>()
      siteIds.add(base.identity.siteId)
      providerClaims.set(provider, siteIds)
      ambiguousTitleClaims.set(key, providerClaims)
    }
  })
  const ambiguousTitleKeys = new Set(
    [...ambiguousTitleClaims.entries()]
      .filter(([, providerClaims]) => [...providerClaims.values()].some((siteIds) => siteIds.size > 1))
      .map(([key]) => key),
  )

  const identityClaimsByRoot = new Map<number, Map<string, string>>()
  records.forEach((_, index) => {
    const base = baseRecords[index]
    if (!base.identity.provider || !base.identity.siteId) return
    const root = find(index)
    const claims = identityClaimsByRoot.get(root) || new Map<string, string>()
    claims.set(base.identity.provider.toLowerCase(), base.identity.siteId)
    identityClaimsByRoot.set(root, claims)
  })

  const unionTitleSafe = (left: number, right: number): boolean => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return true
    const leftClaims = identityClaimsByRoot.get(leftRoot) || new Map<string, string>()
    const rightClaims = identityClaimsByRoot.get(rightRoot) || new Map<string, string>()
    for (const [provider, siteId] of leftClaims) {
      const otherSiteId = rightClaims.get(provider)
      if (otherSiteId && otherSiteId !== siteId) return false
    }
    const root = union(leftRoot, rightRoot)
    const mergedClaims = new Map<string, string>(leftClaims)
    for (const [provider, siteId] of rightClaims) mergedClaims.set(provider, siteId)
    identityClaimsByRoot.delete(leftRoot)
    identityClaimsByRoot.delete(rightRoot)
    identityClaimsByRoot.set(root, mergedClaims)
    return true
  }

  const indexByWorkId = new Map(records.map((record, index) => [record.workId, index]))
  const resolvedMediaByWorkId = new Map<string, NonNullable<CatalogEquivalenceGroup['resolvedMedia']>>()
  for (const group of equivalenceGroups) {
    if (group.schemaVersion !== 'baihepailei-public-catalog-equivalence-v1' || group.decision !== 'merge') {
      throw new Error(`Invalid catalog-equivalence group ${group.groupId || '(missing group ID)'}`)
    }
    const indices = group.workIds.map((workId) => {
      const index = indexByWorkId.get(workId)
      if (index === undefined) throw new Error(`${group.groupId} references missing Work ${workId}`)
      return index
    })
    if (indices.length < 2 || new Set(indices).size !== indices.length) {
      throw new Error(`${group.groupId} must contain at least two distinct Work IDs`)
    }
    for (const index of indices.slice(1)) {
      if (!unionTitleSafe(indices[0], index)) {
        throw new Error(`${group.groupId} conflicts with a same-provider identity claim`)
      }
    }
    if (group.resolvedMedia) {
      for (const workId of group.workIds) resolvedMediaByWorkId.set(workId, group.resolvedMedia)
    }
  }

  const titleOwner = new Map<string, number>()
  records.forEach((record, index) => {
    const bucket = mediaMergeBucket(record.media.group)
    for (const name of uniqueIdentityMergeNames(record)) {
      const normalized = normalizeIdentityMergeTitle(name)
      const key = `${bucket}|${normalized}`
      if (ambiguousTitleKeys.has(key)) continue
      const owner = titleOwner.get(key)
      if (owner === undefined) titleOwner.set(key, index)
      else unionTitleSafe(owner, index)
    }
  })

  const components = new Map<number, number[]>()
  records.forEach((_, index) => {
    const root = find(index)
    const component = components.get(root) || []
    component.push(index)
    components.set(root, component)
  })

  const mergedRecords: PublicWorkRecord[] = []
  const byWorkId = new Map<string, PublicWorkRecord>()
  const memberIdsByPrimary = new Map<string, string[]>()
  let multiWorkGroups = 0
  let largestGroup = 1
  for (const indices of components.values()) {
    const members = indices.map((index) => records[index])
    const mediaOverrides = [...new Map(
      members
        .map((record) => resolvedMediaByWorkId.get(record.workId))
        .filter((value): value is NonNullable<CatalogEquivalenceGroup['resolvedMedia']> => Boolean(value))
        .map((value) => [`${value.group}|${value.type}`, value]),
    ).values()]
    if (mediaOverrides.length > 1) {
      throw new Error(`Conflicting resolved media for Work IDs ${members.map((record) => record.workId).join(', ')}`)
    }
    const merged = mergeRecordGroup(members, ordinals, titleEvidenceByWorkId, mediaOverrides[0])
    mergedRecords.push(merged)
    const memberIds = members.map((record) => record.workId)
    memberIdsByPrimary.set(merged.workId, memberIds)
    for (const workId of memberIds) byWorkId.set(workId, merged)
    if (members.length > 1) multiWorkGroups += 1
    largestGroup = Math.max(largestGroup, members.length)
  }

  return {
    records: mergedRecords,
    byWorkId,
    memberIdsByPrimary,
    stats: {
      sourceWorks: records.length,
      visibleWorks: mergedRecords.length,
      mergedAway: records.length - mergedRecords.length,
      multiWorkGroups,
      largestGroup,
    } satisfies PublicCatalogMergeStats,
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
  const equivalenceGroups = parseJsonLines<CatalogEquivalenceGroup>(
    readFileSync(join(directory, 'equivalence', 'catalog-equivalence-groups.jsonl'), 'utf8'),
    'equivalence/catalog-equivalence-groups.jsonl',
  )
  const titleEvidence = parseJsonLines<CatalogTitleEvidence>(
    readFileSync(join(directory, 'equivalence', 'catalog-title-evidence.jsonl'), 'utf8'),
    'equivalence/catalog-title-evidence.jsonl',
  )
  const assetByWorkId = new Map(assets.map((asset) => [asset.workId, asset]))
  const detailByWorkId = new Map(details.map((detail) => [detail.workId, detail]))
  const ordinals = new Map(baseRecords.map((record) => [record.workId, record.ordinal]))
  const rawRecords = baseRecords.map((record) =>
    toPublicRecord(
      record,
      mediaByWorkId.get(record.workId),
      assetByWorkId.get(record.workId),
      detailByWorkId.get(record.workId),
    ),
  )
  const rawByWorkId = new Map(rawRecords.map((record) => [record.workId, record]))
  const titleEvidenceByWorkId = new Map(titleEvidence.map((evidence) => [evidence.workId, evidence]))

  if (rawRecords.length !== manifest.counts.catalogWorks) {
    throw new Error(`Public release row-count drift: ${rawRecords.length}`)
  }
  if (rawByWorkId.size !== rawRecords.length) {
    throw new Error('Public release contains duplicate Work IDs')
  }
  if (titleEvidenceByWorkId.size !== titleEvidence.length) {
    throw new Error('Catalog title evidence contains duplicate Work IDs')
  }
  if (titleEvidence.some((evidence) => !rawByWorkId.has(evidence.workId))) {
    throw new Error('Catalog title evidence references a non-public Work ID')
  }

  const merged = deduplicateCatalog(
    rawRecords,
    baseRecords,
    ordinals,
    equivalenceGroups,
    titleEvidenceByWorkId,
  )
  const metadata = readPublicMetadata(directory, new Map(baseRecords.map(record => [record.workId, record.identity.siteId])))
  const records = merged.records.map(record => addPublicMetadata(record,
    (merged.memberIdsByPrimary.get(record.workId) || [record.workId]).map(id => metadata.get(id)!),
  ))
  const enhancedByPrimary = new Map(records.map(record => [record.workId, record]))
  const byWorkId = new Map([...merged.byWorkId].map(([id, record]) => [id, enhancedByPrimary.get(record.workId)!]))
  globalThis.__baihepaileiPublicRelease = {
    manifest,
    enrichmentManifest,
    records,
    displayRecords: [...records].sort((left, right) => compareForDisplay(left, right, ordinals)),
    byWorkId,
    memberIdsByPrimary: merged.memberIdsByPrimary,
    mergeStats: merged.stats,
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

export function getPublicCatalogMergeStats(): PublicCatalogMergeStats {
  return loadRelease().mergeStats
}

export function getPublicWorkById(workId: string): PublicWorkRecord | null {
  const exactWorkId = String(workId || '').trim()
  if (!exactWorkId || exactWorkId.length > 200) return null
  const work = loadRelease().byWorkId.get(exactWorkId)
  return work ? withCreatorIds(work, getCreatorGraph()) : null
}

function getCreatorGraph(): PublicCreatorGraph {
  const cache = loadRelease()
  return cache.creatorGraph ||= readPublicCreatorGraph(releaseDirectory(), cache.records)
}

// Descriptive export stays independent of the graph so a refresh can assign new credits.
export function getPublicCreatorGraphInput(): PublicWorkRecord[] {
  return loadRelease().records
}

export function getPublicCreatorById(creatorId: string) {
  if (!/^\d{7,12}$/.test(creatorId)) return null
  return getCreatorGraph().entities.get(creatorId) || null
}

export function getPublicCreatorWorks(creatorId: string, input: { year?: string; offset?: number; limit?: number } = {}) {
  const all = getCreatorGraph().works.get(creatorId) || []
  const years = [...new Set(all.map(entry => entry.year))]
  const matched = input.year ? all.filter(entry => entry.year === input.year) : all
  const offset = normalizeOffset(input.offset), limit = normalizeLimit(input.limit)
  return { items: matched.slice(offset, offset + limit), total: matched.length, allTotal: all.length, years, offset, limit }
}

export function getPublicCreatorList(input: { kind: CreatorKind; query?: string; offset?: number; limit?: number }) {
  const graph = getCreatorGraph()
  const query = String(input.query || '').normalize('NFKC').toLowerCase().trim().slice(0, 200)
  const matched = [...graph.entities.values()]
    .filter(creator => creator.kind === input.kind && graph.works.has(creator.creatorId) && (!query ||
      creator.creatorId === query || creator.names.some(name => name.normalize('NFKC').toLowerCase().includes(query))))
    .map(creator => ({ ...creator, workCount: graph.works.get(creator.creatorId)!.length }))
    .sort((a, b) => b.workCount - a.workCount || a.name.localeCompare(b.name, 'zh-CN') || Number(a.creatorId) - Number(b.creatorId))
  const offset = normalizeOffset(input.offset), limit = normalizeLimit(input.limit)
  return { items: matched.slice(offset, offset + limit), total: matched.length, offset, limit }
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
  const cache = loadRelease()
  const exactWorkId = query.match(/^(?:work\s*)?(\d+)$/)?.[1]
  const exactRecord = exactWorkId ? cache.byWorkId.get(exactWorkId) : undefined
  const source = exactRecord ? [exactRecord] : cache.displayRecords
  const matched = source.filter((record) => {
    if (grade && record.rating.grade !== grade) return false
    if (status && record.rating.state !== status) return false
    if (media && record.media.group !== media) return false
    if (!query || exactRecord) return true
    const memberIds = cache.memberIdsByPrimary.get(record.workId) || [record.workId]
    const haystack = [
      record.title,
      ...record.aliases,
      ...record.localizedTitles.flatMap((title) => [title.title, title.language || '', title.region || '']),
      ...record.creators.flatMap((credit) => [credit.name, credit.role]),
      ...record.organizations.flatMap((credit) => [credit.name, credit.role]),
      ...record.publicTags.flatMap((tag) => [tag.label, tag.group, tag.description]),
      ...record.rating.classes.flatMap((ratingClass) => {
        if (!isRadarRatingClass(ratingClass)) return []
        const definition = radarClassDefinitions[ratingClass]
        return [
          ratingClass,
          definition.label,
          definition.summary,
          ...publicSearchTermsForRatingClass(ratingClass),
        ]
      }),
      record.media.group,
      record.media.type,
      record.media.format || '',
      ...memberIds.flatMap((workId) => [workId, `work ${workId}`]),
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
