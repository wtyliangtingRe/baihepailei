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

function sourceReferenceCount(rating: PublicRating) {
  const evidenceRefs = unique(
    rowValues(rating.evidenceRefs),
  )

  if (evidenceRefs.length > 0) {
    return evidenceRefs.length
  }

  return unique(rowValues(rating.factRefs)).length
}

function evidenceStatus(sourceCount: number) {
  if (sourceCount >= 2) {
    return 'multiple_secondary_supported'
  }

  if (sourceCount === 1) {
    return 'single_secondary_supported'
  }

  return 'insufficient_evidence'
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
): RadarPublicRatingBridge | null {
  const publicationKey = clean(rating.publicationKey)

  if (!publicationKey.startsWith('work:')) {
    return null
  }

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

  const sourceCount = sourceReferenceCount(rating)
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
    evidenceStatus: evidenceStatus(sourceCount),
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

  const researchPreview: RadarResearchPreview = {
    researchStatus:
      unresolved.length > 0 ? 'partial' : 'resolved',
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
      requiresHumanReview
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

    const result = await payload.find({
      collection: 'radar-public-ratings',
      depth: 0,
      limit: 1,
      page: 1,
      pagination: true,
      overrideAccess: true,
      where: {
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
      },
    })

    const rating =
      result.docs[0] as unknown as PublicRating | undefined

    if (!rating) return null

    return mapPublicRatingToWorksAI(rating)
  } catch {
    // Missing local schema or a temporarily unavailable projection
    // must not make the canonical work detail page unavailable.
    return null
  }
}
