import configPromise from '@payload-config'
import { getPayload } from 'payload'

import type { RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'

import type { RadarResearchPreview } from './detail-index'

type ValueRow = {
  value?: string | null
}

type PublicTagHint = {
  value?: string | null
}

type PublicEvidence = {
  sourceRef?: string | null
  tier?: string | null
  role?: string | null
  exactIdentityBound?: boolean | null
}

type PublicRecord = {
  publicationKey?: string | null
  publicState?: string | null
  researchStatus?: string | null
  evidence?: PublicEvidence[] | null
  recordStatus?: string | null
}

type PublicRating = {
  id: string | number
  publicationKey?: string | null
  coreGrade?: string | null
  bestGrade?: string | null
  likelyGrade?: string | null
  worstGrade?: string | null
  confidence?: string | null
  matchedClasses?: ValueRow[] | null
  factRefs?: ValueRow[] | null
  evidenceRefs?: ValueRow[] | null
  reasoningSummary?: string | null
  unresolvedDimensions?: ValueRow[] | null
  classificationRule?: string | null
  publicTagHints?: PublicTagHint[] | null
  humanReview?: {
    status?: string | null
    blocksAnalysis?: boolean | null
    blocksPublication?: boolean | null
  } | null
  sourcePolicyVersion?: string | null
  importedAt?: string | null
  recordStatus?: string | null
}

export type RadarPublicRatingBridge = {
  publicationKey: string
  ratingId: string | number
  radarAssessment: RadarAssessmentMetrics
  researchPreview: RadarResearchPreview
}

type BridgeableWorkItem = {
  radarAssessment?: RadarAssessmentMetrics
  researchPreview?: RadarResearchPreview
}

function clean(value: unknown) {
  return String(value || '').trim()
}

function normalizedGrade(value: unknown) {
  const grade = clean(value).toUpperCase()

  if (
    !['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'].includes(
      grade,
    )
  ) {
    return ''
  }

  return grade
}

function rowValues(rows?: ValueRow[] | null) {
  return (rows || [])
    .map((row) => clean(row?.value))
    .filter(Boolean)
}

function unique(values: string[]) {
  return [
    ...new Set(
      values
        .map(clean)
        .filter(Boolean),
    ),
  ]
}

function relevantEvidence(
  rating: PublicRating,
  record?: PublicRecord,
) {
  const evidence = (record?.evidence || []).filter(
    (item) => item?.exactIdentityBound !== false,
  )

  const refs = new Set(rowValues(rating.evidenceRefs))

  if (refs.size === 0) return evidence

  return evidence.filter((item) =>
    refs.has(clean(item?.sourceRef)),
  )
}

function sourceReferenceCount(
  rating: PublicRating,
  record?: PublicRecord,
) {
  const evidence = relevantEvidence(rating, record)

  if (evidence.length > 0) {
    return unique(
      evidence.map((item) => clean(item?.sourceRef)),
    ).length
  }

  return unique(rowValues(rating.evidenceRefs)).length
}

function evidenceStatus(
  rating: PublicRating,
  record?: PublicRecord,
) {
  if (!record) return 'unknown'

  const publicState = clean(record.publicState)
  const researchStatus = clean(record.researchStatus)

  if (
    publicState === 'needs_more_research'
    || researchStatus === 'needs_more_research'
  ) {
    return 'insufficient_evidence'
  }

  const evidence = relevantEvidence(rating, record)

  if (
    evidence.some((item) => clean(item?.tier) === 'A')
  ) {
    return 'primary_material_confirmed'
  }

  const secondaryCount = evidence.filter((item) =>
    ['B', 'C'].includes(clean(item?.tier)),
  ).length

  if (secondaryCount >= 2) {
    return 'multiple_secondary_supported'
  }

  if (secondaryCount === 1) {
    return 'single_secondary_supported'
  }

  return evidence.length > 0
    ? 'insufficient_evidence'
    : 'unknown'
}

function bridgeResearchStatus(
  record: PublicRecord | undefined,
  unresolvedCount: number,
) {
  if (!record) {
    return unresolvedCount > 0 ? 'partial' : 'unknown'
  }

  const publicState = clean(record.publicState)
  const researchStatus = clean(record.researchStatus)

  if (
    publicState === 'needs_more_research'
    || researchStatus === 'needs_more_research'
  ) {
    return 'needs_more_research'
  }

  if (
    publicState === 'partial'
    || researchStatus === 'partially_verified'
    || unresolvedCount > 0
  ) {
    return 'partial'
  }

  if (
    publicState === 'verified'
    || researchStatus === 'ready_for_publication'
  ) {
    return 'resolved'
  }

  return 'unknown'
}

function mergeResearchPreview(
  current?: RadarResearchPreview,
  incoming?: RadarResearchPreview,
): RadarResearchPreview | undefined {
  if (!current) return incoming
  if (!incoming) return current

  const currentSourceCount =
    typeof current.sourceCount === 'number'
      ? current.sourceCount
      : null

  const incomingSourceCount =
    typeof incoming.sourceCount === 'number'
      ? incoming.sourceCount
      : null

  const currentUnresolved =
    typeof current.unresolvedQuestionCount === 'number'
      ? current.unresolvedQuestionCount
      : null

  const incomingUnresolved =
    typeof incoming.unresolvedQuestionCount === 'number'
      ? incoming.unresolvedQuestionCount
      : null

  return {
    ...current,
    researchStatus:
      incoming.researchStatus || current.researchStatus,
    riskSignals: unique([
      ...(current.riskSignals || []),
      ...(incoming.riskSignals || []),
    ]),
    likelyGrade:
      incoming.likelyGrade || current.likelyGrade,
    bestGrade:
      incoming.bestGrade || current.bestGrade,
    worstGrade:
      incoming.worstGrade || current.worstGrade,
    sourceSummary:
      incoming.sourceSummary || current.sourceSummary,
    sourceCount:
      currentSourceCount === null
      && incomingSourceCount === null
        ? undefined
        : Math.max(
            currentSourceCount || 0,
            incomingSourceCount || 0,
          ),
    unresolvedQuestionCount:
      currentUnresolved === null
      && incomingUnresolved === null
        ? undefined
        : Math.max(
            currentUnresolved || 0,
            incomingUnresolved || 0,
          ),
    confidencePercent:
      typeof current.confidencePercent === 'number'
        ? current.confidencePercent
        : undefined,
    recommendedNextAction:
      incoming.recommendedNextAction
      || current.recommendedNextAction,
    recommendedNextQueue:
      incoming.recommendedNextQueue
      || current.recommendedNextQueue,
    importedAt:
      incoming.importedAt || current.importedAt,
  }
}

export function mapPublicRatingToWorksAI(
  rating: PublicRating,
  record?: PublicRecord,
): RadarPublicRatingBridge | null {
  const publicationKey = clean(rating.publicationKey)

  if (!publicationKey.startsWith('work:')) {
    return null
  }

  const usableRecord =
    clean(record?.publicationKey) === publicationKey
      ? record
      : undefined

  const coreGrade =
    normalizedGrade(rating.coreGrade)
    || normalizedGrade(rating.likelyGrade)

  if (!coreGrade) return null

  const matchedClasses = unique([
    clean(rating.classificationRule),
    ...rowValues(rating.matchedClasses),
  ])

  const unresolved = unique(
    rowValues(rating.unresolvedDimensions),
  )

  const sourceCount = sourceReferenceCount(
    rating,
    usableRecord,
  )
  const sourceSummary = clean(rating.reasoningSummary)
  const policyVersion = clean(rating.sourcePolicyVersion)
  const assessedAt = clean(rating.importedAt)

  const humanReviewStatus = clean(
    rating.humanReview?.status,
  )

  const requiresHumanReview =
    humanReviewStatus !== 'reviewed'
    || rating.humanReview?.blocksAnalysis === true
    || rating.humanReview?.blocksPublication === true

  const radarAssessment: RadarAssessmentMetrics = {
    evidenceStatus: evidenceStatus(
      rating,
      usableRecord,
    ),
    sourceSummary,
    sourceCount,
    policyVersion,
    suggestedGrade: coreGrade,
    decisiveRuleCode:
      clean(rating.classificationRule)
      || matchedClasses[0],
    decisiveRuleReason: sourceSummary,
    matchedRules: matchedClasses.map((code) => ({
      code,
      grade: coreGrade,
    })),
    contradictions: [],
    requiresHumanReview,
    assessedAt,
  }

  const riskSignals = unique([
    ...matchedClasses,
    ...(rating.publicTagHints || [])
      .map((hint) => clean(hint?.value))
      .filter(Boolean),
  ])

  const researchStatus = bridgeResearchStatus(
    usableRecord,
    unresolved.length,
  )

  const researchPreview: RadarResearchPreview = {
    researchStatus,
    riskSignals,
    likelyGrade:
      normalizedGrade(rating.likelyGrade)
      || coreGrade,
    bestGrade:
      normalizedGrade(rating.bestGrade)
      || coreGrade,
    worstGrade:
      normalizedGrade(rating.worstGrade)
      || coreGrade,
    sourceSummary,
    sourceCount,
    unresolvedQuestionCount: unresolved.length,
    recommendedNextAction:
      researchStatus === 'needs_more_research'
        ? '继续补充研究资料'
        : requiresHumanReview
          ? '等待人工复核'
          : '机器评级已通过人工复核',
    importedAt: assessedAt,
  }

  return {
    publicationKey,
    ratingId: rating.id,
    radarAssessment,
    researchPreview,
  }
}

export function applyPublicRatingBridge<
  T extends BridgeableWorkItem,
>(
  item: T,
  bridge: RadarPublicRatingBridge | null,
): T {
  if (!bridge) return item

  const hasCanonicalWorksAssessment = Boolean(
    clean(item.radarAssessment?.assessedAt),
  )

  return {
    ...item,
    radarAssessment: hasCanonicalWorksAssessment
      ? item.radarAssessment
      : bridge.radarAssessment,
    researchPreview: mergeResearchPreview(
      item.researchPreview,
      bridge.researchPreview,
    ),
  } as T
}

export async function readPublicRatingBridge(
  workId?: string | number,
): Promise<RadarPublicRatingBridge | null> {
  const normalizedWorkId = clean(workId)

  if (!normalizedWorkId) return null

  try {
    const payload = await getPayload({
      config: configPromise,
    })

    const publicationKey = `work:${normalizedWorkId}`
    const where = {
      and: [
        {
          publicationKey: {
            equals: publicationKey,
          },
        },
        {
          recordStatus: {
            equals: 'current',
          },
        },
      ],
    }

    const [ratingResult, recordResult] = await Promise.all([
      payload.find({
        collection: 'radar-public-ratings',
        depth: 0,
        limit: 1,
        page: 1,
        pagination: true,
        overrideAccess: true,
        where,
      }),
      payload.find({
        collection: 'radar-public-records',
        depth: 0,
        limit: 1,
        page: 1,
        pagination: true,
        overrideAccess: true,
        where,
      }),
    ])

    const rating =
      ratingResult.docs[0] as unknown as PublicRating | undefined
    const record =
      recordResult.docs[0] as unknown as PublicRecord | undefined

    if (!rating) return null

    return mapPublicRatingToWorksAI(rating, record)
  } catch {
    // Missing local schema or a temporarily unavailable projection
    // must not make the canonical work detail page unavailable.
    return null
  }
}
