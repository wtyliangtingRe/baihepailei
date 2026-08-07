import type { RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'
import {
  selectRadarAuthority,
  type RadarAuthority,
  type RadarGradeState,
} from '@/lib/radar/readStandardization'
import type {
  RadarConclusionMode,
  RadarPublicTagContract,
} from '@/lib/radar/conclusionNormalizer.mjs'

import {
  readRadarSnapshotForWork,
  type RadarSourceDocument,
} from './radar-read-repository'
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

type ExtendedResearchPreview = RadarResearchPreview & {
  evidenceCoveragePercent?: number
  unresolvedQuestions?: string[]
  requiresHumanReview?: boolean
  validationIssues?: string[]
}

export type RadarPublicRatingBridge = {
  authority: RadarAuthority
  pending: boolean
  publicationKey?: string
  ratingId?: string | number
  radarAssessment?: RadarAssessmentMetrics
  researchPreview?: ExtendedResearchPreview
  ratingNotice?: string
  evidenceStrength?: string
}

type BridgeableWorkItem = {
  radarAssessment?: RadarAssessmentMetrics
  researchPreview?: ExtendedResearchPreview
  ratingNotice?: string
  evidenceStrength?: string
}

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function normalizedPercent(value: unknown) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > 100
  ) {
    return undefined
  }

  return Math.round(value)
}

function normalizedNonNegativeNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.round(value)
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function rowValues(value: unknown) {
  return arrayOf(value)
    .map((row) => clean((row as ValueRow)?.value ?? row))
    .filter(Boolean)
}

function unique(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function publicTags(value: unknown): RadarPublicTagContract[] {
  return arrayOf(value)
    .map((raw) => raw as PublicTagHint)
    .map((tag) => ({
      key: clean(tag.key),
      group: clean(tag.group),
      value: clean(tag.value),
      warningTemplateId: clean(tag.warningTemplateId),
    }))
    .filter((tag) => tag.key || tag.group || tag.value)
}

function relevantEvidence(
  rating: RadarSourceDocument,
  record?: RadarSourceDocument | null,
) {
  const evidence = arrayOf(record?.evidence)
    .map((item) => item as PublicEvidence)
    .filter((item) => item?.exactIdentityBound !== false)

  const refs = new Set(rowValues(rating.evidenceRefs))
  if (refs.size === 0) return evidence

  return evidence.filter((item) => refs.has(clean(item?.sourceRef)))
}

function sourceReferenceCount(
  rating: RadarSourceDocument,
  record?: RadarSourceDocument | null,
) {
  const evidence = relevantEvidence(rating, record)
  if (evidence.length > 0) {
    return unique(evidence.map((item) => clean(item?.sourceRef))).length
  }
  return unique(rowValues(rating.evidenceRefs)).length
}

function evidenceStatus(
  rating: RadarSourceDocument,
  record?: RadarSourceDocument | null,
) {
  const publicState = clean(record?.publicState)
  const researchStatus = clean(record?.researchStatus)

  if (publicState === 'needs_more_research' || researchStatus === 'needs_more_research') {
    return 'insufficient_evidence'
  }

  const evidence = relevantEvidence(rating, record)
  if (evidence.some((item) => clean(item?.tier) === 'A')) {
    return 'primary_material_confirmed'
  }

  const secondaryCount = evidence.filter((item) =>
    ['B', 'C'].includes(clean(item?.tier)),
  ).length

  if (secondaryCount >= 2) return 'multiple_secondary_supported'
  if (secondaryCount === 1) return 'single_secondary_supported'
  return evidence.length > 0 ? 'insufficient_evidence' : 'unknown'
}

function normalizedMode(state: RadarGradeState): RadarConclusionMode {
  if (!state.valid) return 'labels_only'
  return state.mode === 'legacy' ? 'labels_only' : state.mode
}

function withAuthorityGradeState(
  base: RadarAssessmentMetrics,
  state: RadarGradeState,
): RadarAssessmentMetrics {
  const mode = normalizedMode(state)
  const fixed = mode === 'fixed_grade' ? state.grade || undefined : undefined
  const validationIssues = unique([
    ...(base.validationIssues || []),
    !state.valid ? clean(state.reason) : '',
  ])

  return {
    ...base,
    conclusionMode: mode,
    suggestedGrade: fixed,
    fixedGrade: fixed,
    bestGrade: fixed || (mode === 'bounded_range' ? state.range?.bestGrade : undefined),
    likelyGrade: fixed || (mode === 'bounded_range' ? state.range?.likelyGrade : undefined),
    worstGrade: fixed || (mode === 'bounded_range' ? state.range?.worstGrade : undefined),
    validationIssues,
    requiresHumanReview:
      base.requiresHumanReview === true
      || !state.valid,
  }
}

function publishedAssessment(
  rating: RadarSourceDocument,
  record: RadarSourceDocument | null,
  state: RadarGradeState,
): RadarAssessmentMetrics {
  const matchedClasses = unique([
    clean(rating.classificationRule),
    ...rowValues(rating.matchedClasses),
  ])
  const unresolved = unique(rowValues(rating.unresolvedDimensions))
  const humanReview = objectOf(rating.humanReview)
  const humanReviewStatus = clean(humanReview.status)
  const requiresHumanReview =
    humanReviewStatus === 'disputed'
    || humanReview.blocksAnalysis === true
    || humanReview.blocksPublication === true

  const base: RadarAssessmentMetrics = {
    confidencePercent: normalizedPercent(rating.confidencePercent),
    evidenceCoveragePercent: normalizedPercent(rating.evidenceCoveragePercent),
    evidenceStatus: evidenceStatus(rating, record),
    sourceSummary: clean(rating.reasoningSummary),
    sourceCount: sourceReferenceCount(rating, record),
    policyVersion:
      clean(rating.metricsPolicyVersion)
      || clean(rating.sourceMetricsPolicyVersion)
      || clean(rating.sourcePolicyVersion),
    decisiveRuleCode:
      clean(rating.classificationRule)
      || matchedClasses[0],
    decisiveRuleReason: clean(rating.reasoningSummary),
    matchedRules: matchedClasses.map((code) => ({
      code,
      grade: undefined,
    })),
    contradictions: [],
    unresolvedDimensions: unresolved,
    requiresHumanReview,
    recommendedNextQueue:
      clean(record?.publicState) === 'needs_more_research'
      || clean(record?.researchStatus) === 'needs_more_research'
        ? 'more_research'
        : undefined,
    warningTemplateId: rowValues(rating.publicWarningTemplateIds)[0],
    publicTags: publicTags(rating.publicTagHints),
    assessedAt: clean(rating.importedAt),
  }

  return withAuthorityGradeState(base, state)
}

function candidateAssessment(
  candidate: RadarSourceDocument,
  state: RadarGradeState,
): RadarAssessmentMetrics {
  const raw = objectOf(candidate.radarAssessment)
  const matchedRules = arrayOf(raw.matchedRules)
    .map((item) => objectOf(item))
    .map((rule) => ({
      code: clean(rule.code),
      grade: clean(rule.grade),
      confidencePercent: normalizedPercent(rule.confidencePercent),
      reason: clean(rule.reason),
    }))
    .filter((rule) => rule.code || rule.reason)

  const base: RadarAssessmentMetrics = {
    confidencePercent: normalizedPercent(raw.confidencePercent),
    evidenceCoveragePercent: normalizedPercent(raw.evidenceCoveragePercent),
    evidenceStatus: clean(raw.evidenceStatus) || 'unknown',
    sourceSummary: clean(raw.sourceSummary),
    sourceCount: normalizedNonNegativeNumber(raw.sourceCount),
    policyVersion: clean(raw.policyVersion),
    decisiveRuleCode: clean(raw.decisiveRuleCode),
    decisiveRuleReason: clean(raw.decisiveRuleReason),
    matchedRules,
    contradictions: rowValues(raw.contradictions),
    unresolvedDimensions: rowValues(raw.unresolvedDimensions),
    requiresHumanReview: raw.requiresHumanReview === true,
    assessedAt: clean(raw.assessedAt) || clean(candidate.publishedAt),
  }

  return withAuthorityGradeState(base, state)
}

function researchPreview(
  research?: RadarSourceDocument | null,
): ExtendedResearchPreview | undefined {
  if (!research) return undefined

  const unresolvedQuestions = unique(rowValues(research.unresolvedQuestions))
  const sources = arrayOf(research.sources)
    .map((item) => objectOf(item))
    .filter((item) => clean(item.url))

  return {
    researchStatus: clean(research.researchStatus),
    yuriRelevance: clean(research.yuriRelevance),
    riskSignals: unique(arrayOf(research.riskSignals).map(clean)),
    likelyGrade: clean(research.proposedLikelyGrade).toUpperCase() || undefined,
    bestGrade: clean(research.proposedBestGrade).toUpperCase() || undefined,
    worstGrade: clean(research.proposedWorstGrade).toUpperCase() || undefined,
    sourceSummary: clean(research.sourceSummary),
    sourceCount: sources.length,
    unresolvedQuestionCount: unresolvedQuestions.length,
    unresolvedQuestions,
    confidencePercent: normalizedPercent(research.confidencePercent),
    recommendedNextAction: clean(research.recommendedNextAction),
    recommendedNextQueue: clean(research.recommendedNextQueue),
    requiresHumanReview: research.requiresHumanReview === true,
    importedAt: clean(research.importedAt),
  }
}

function publishedNotice(rating: RadarSourceDocument) {
  const humanReview = objectOf(rating.humanReview)
  return clean(humanReview.status) === 'disputed'
    || humanReview.blocksAnalysis === true
    || humanReview.blocksPublication === true
    ? 'ai_synthesized_pending_review'
    : 'none'
}

export function applyPublicRatingBridge<
  T extends BridgeableWorkItem,
>(
  item: T,
  bridge: RadarPublicRatingBridge | null,
): T {
  if (!bridge) return item

  return {
    ...item,
    radarAuthority: bridge.authority,
    radarAuthorityPending: bridge.pending,
    radarAssessment:
      bridge.authority === 'research'
        ? undefined
        : bridge.radarAssessment,
    // Once the exact repository is available, never mix an older workId-only
    // static Research preview back into the exact runtime lineage.
    researchPreview: bridge.researchPreview,
    ratingNotice: bridge.ratingNotice || item.ratingNotice,
    evidenceStrength: bridge.evidenceStrength || item.evidenceStrength,
  } as T
}

export async function readPublicRatingBridge(
  workId?: string | number,
): Promise<RadarPublicRatingBridge | null> {
  const snapshot = await readRadarSnapshotForWork(workId)
  if (!snapshot) return null

  const selection = selectRadarAuthority(snapshot)
  const exactResearchPreview = researchPreview(
    snapshot.sourceDocuments.research.latest,
  )

  if (selection.authority === 'published') {
    const rating = snapshot.sourceDocuments.published.rating
    const record = snapshot.sourceDocuments.published.record
    if (!rating) return null

    return {
      authority: selection.authority,
      pending: selection.pending,
      publicationKey: clean(rating.publicationKey),
      ratingId: rating.id,
      radarAssessment: publishedAssessment(
        rating,
        record,
        selection.gradeState,
      ),
      researchPreview: exactResearchPreview,
      ratingNotice: publishedNotice(rating),
    }
  }

  if (selection.authority === 'candidate') {
    const candidate = snapshot.sourceDocuments.candidate
    if (!candidate) return null

    return {
      authority: selection.authority,
      pending: true,
      publicationKey: clean(candidate.publicationKey),
      ratingId: candidate.id,
      radarAssessment: candidateAssessment(
        candidate,
        selection.gradeState,
      ),
      researchPreview: exactResearchPreview,
      ratingNotice:
        clean(candidate.ratingNotice)
        || 'ai_synthesized_pending_review',
      evidenceStrength: clean(candidate.evidenceStrength),
    }
  }

  if (selection.authority === 'research') {
    return {
      authority: 'research',
      pending: false,
      researchPreview: exactResearchPreview,
      ratingNotice: 'insufficient_information',
      evidenceStrength: 'unassessed',
    }
  }

  // Human authority is rendered from Works independently. Legacy/unassessed
  // fall back to the existing static compatibility projection when no exact
  // Radar lineage is available.
  return null
}
