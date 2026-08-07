import configPromise from '@payload-config'
import { getPayload, type Where } from 'payload'

import type { RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'
import {
  normalizeRadarConclusion,
  type RadarConclusionMode,
  type RadarPublicTagContract,
} from '@/lib/radar/conclusionNormalizer.mjs'

import type { RadarResearchPreview } from './detail-index'

type ValueRow = {
  value?: string | null
}

type PublicTagHint = {
  key?: string | null
  group?: string | null
  value?: string | null
  warningTemplateId?: string | null
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
  pageNotice?: string | null
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
  confidencePercent?: number | null
  evidenceCoveragePercent?: number | null
  metricsPolicyVersion?: string | null
  sourceMetricsPolicyVersion?: string | null
  relationshipEvidenceState?: string | null
  metricsSourceReleaseId?: string | null
  metricsCalculationBasisSha256?: string | null
  requiresMetricReview?: boolean | null
  matchedClasses?: ValueRow[] | null
  factRefs?: ValueRow[] | null
  evidenceRefs?: ValueRow[] | null
  reasoningSummary?: string | null
  unresolvedDimensions?: ValueRow[] | null
  classificationRule?: string | null
  publicTagHints?: PublicTagHint[] | null
  publicWarningTemplateIds?: ValueRow[] | null
  humanReview?: {
    status?: string | null
    blocksAnalysis?: boolean | null
    blocksPublication?: boolean | null
  } | null
  sourcePolicyVersion?: string | null
  importedAt?: string | null
  recordStatus?: string | null
}

type ExtendedResearchPreview = RadarResearchPreview & {
  conclusionMode?: RadarConclusionMode
  fixedGrade?: string
  evidenceCoveragePercent?: number
  unresolvedQuestions?: string[]
  requiresHumanReview?: boolean
  validationIssues?: string[]
  warningTemplateId?: string
  publicTags?: RadarPublicTagContract[]
}

export type RadarPublicRatingBridge = {
  publicationKey: string
  ratingId: string | number
  radarAssessment: RadarAssessmentMetrics
  researchPreview: ExtendedResearchPreview
}

type BridgeableWorkItem = {
  radarAssessment?: RadarAssessmentMetrics
  researchPreview?: ExtendedResearchPreview
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

function normalizedPercent(value: unknown) {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 0
    || value > 100
  ) {
    return undefined
  }

  return value
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
  current?: ExtendedResearchPreview,
  incoming?: ExtendedResearchPreview,
): ExtendedResearchPreview | undefined {
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
    conclusionMode:
      incoming.conclusionMode || current.conclusionMode,
    fixedGrade:
      incoming.fixedGrade || current.fixedGrade,
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
    unresolvedQuestions: unique([
      ...(current.unresolvedQuestions || []),
      ...(incoming.unresolvedQuestions || []),
    ]),
    confidencePercent:
      typeof current.confidencePercent === 'number'
        ? current.confidencePercent
        : incoming.confidencePercent,
    evidenceCoveragePercent:
      typeof current.evidenceCoveragePercent === 'number'
        ? current.evidenceCoveragePercent
        : incoming.evidenceCoveragePercent,
    recommendedNextAction:
      incoming.recommendedNextAction
      || current.recommendedNextAction,
    recommendedNextQueue:
      incoming.recommendedNextQueue
      || current.recommendedNextQueue,
    requiresHumanReview:
      current.requiresHumanReview === true
      || incoming.requiresHumanReview === true,
    validationIssues: unique([
      ...(current.validationIssues || []),
      ...(incoming.validationIssues || []),
    ]),
    warningTemplateId:
      incoming.warningTemplateId || current.warningTemplateId,
    publicTags:
      incoming.publicTags?.length
        ? incoming.publicTags
        : current.publicTags,
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
  const policyVersion =
    clean(rating.metricsPolicyVersion)
    || clean(rating.sourcePolicyVersion)
  const assessedAt = clean(rating.importedAt)

  const humanReviewStatus = clean(
    rating.humanReview?.status,
  )

  const requiresHumanReview =
    humanReviewStatus !== 'reviewed'
    || rating.humanReview?.blocksAnalysis === true
    || rating.humanReview?.blocksPublication === true

  const bridgedEvidenceStatus = evidenceStatus(
    rating,
    usableRecord,
  )
  const researchStatus = bridgeResearchStatus(
    usableRecord,
    unresolved.length,
  )
  const recommendedNextQueue =
    researchStatus === 'needs_more_research'
      ? 'more_research'
      : ''

  const conclusion = normalizeRadarConclusion({
    coreGrade: rating.coreGrade,
    bestGrade: rating.bestGrade,
    likelyGrade: rating.likelyGrade,
    worstGrade: rating.worstGrade,
    classificationRule: rating.classificationRule,
    matchedClasses,
    unresolvedDimensions: unresolved,
    requiresHumanReview,
    recommendedNextQueue,
    evidenceStatus: bridgedEvidenceStatus,
    publicState: usableRecord?.publicState,
    researchStatus: usableRecord?.researchStatus,
    pageNotice: usableRecord?.pageNotice,
    publicTagHints: rating.publicTagHints,
    publicWarningTemplateIds:
      rating.publicWarningTemplateIds,
  })

  const ruleGrade =
    normalizedGrade(rating.coreGrade)
    || conclusion.likelyGrade
    || conclusion.fixedGrade

  const radarAssessment: RadarAssessmentMetrics = {
    evidenceStatus: bridgedEvidenceStatus,
    confidencePercent: normalizedPercent(
      rating.confidencePercent,
    ),
    evidenceCoveragePercent: normalizedPercent(
      rating.evidenceCoveragePercent,
    ),
    sourceSummary,
    sourceCount,
    policyVersion,
    conclusionMode: conclusion.conclusionMode,
    suggestedGrade:
      conclusion.fixedGrade || undefined,
    fixedGrade:
      conclusion.fixedGrade || undefined,
    bestGrade:
      conclusion.bestGrade || undefined,
    likelyGrade:
      conclusion.likelyGrade || undefined,
    worstGrade:
      conclusion.worstGrade || undefined,
    decisiveRuleCode:
      clean(rating.classificationRule)
      || matchedClasses[0],
    decisiveRuleReason: sourceSummary,
    matchedRules: matchedClasses.map((code) => ({
      code,
      grade: ruleGrade || undefined,
    })),
    contradictions: [],
    unresolvedDimensions: unresolved,
    validationIssues: conclusion.validationIssues,
    requiresHumanReview,
    recommendedNextQueue,
    warningTemplateId: conclusion.warningTemplateId,
    publicTags: conclusion.publicTags,
    assessedAt,
  }

  const riskSignals = unique([
    ...matchedClasses,
    ...(rating.publicTagHints || [])
      .map((hint) => clean(hint?.value))
      .filter(Boolean),
  ])

  const researchPreview: ExtendedResearchPreview = {
    conclusionMode: conclusion.conclusionMode,
    fixedGrade:
      conclusion.fixedGrade || undefined,
    researchStatus,
    riskSignals,
    likelyGrade:
      conclusion.likelyGrade
      || conclusion.fixedGrade
      || undefined,
    bestGrade:
      conclusion.bestGrade
      || conclusion.fixedGrade
      || undefined,
    worstGrade:
      conclusion.worstGrade
      || conclusion.fixedGrade
      || undefined,
    sourceSummary,
    sourceCount,
    unresolvedQuestionCount: unresolved.length,
    unresolvedQuestions: unresolved,
    confidencePercent: normalizedPercent(
      rating.confidencePercent,
    ),
    evidenceCoveragePercent: normalizedPercent(
      rating.evidenceCoveragePercent,
    ),
    requiresHumanReview,
    validationIssues: conclusion.validationIssues,
    warningTemplateId: conclusion.warningTemplateId,
    publicTags: conclusion.publicTags,
    recommendedNextAction:
      researchStatus === 'needs_more_research'
        ? '继续补充研究资料'
        : requiresHumanReview
          ? '等待人工复核'
          : '机器评级已通过人工复核',
    recommendedNextQueue,
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

  const currentAssessment = item.radarAssessment
  const bridgedAssessment = bridge.radarAssessment

  const mergedAssessment = hasCanonicalWorksAssessment
    ? {
        ...bridgedAssessment,
        ...currentAssessment,
        confidencePercent:
          normalizedPercent(
            currentAssessment?.confidencePercent,
          )
          ?? bridgedAssessment.confidencePercent,
        evidenceCoveragePercent:
          normalizedPercent(
            currentAssessment?.evidenceCoveragePercent,
          )
          ?? bridgedAssessment.evidenceCoveragePercent,
      }
    : bridgedAssessment

  return {
    ...item,
    radarAssessment: mergedAssessment,
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
    const where: Where = {
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
