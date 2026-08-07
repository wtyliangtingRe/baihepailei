export type RadarConclusionMode = 'fixed_grade' | 'bounded_range' | 'labels_only' | 'unscanned' | 'blocked'
export type RadarPublicTagContract = { key: string; group: string; value: string; warningTemplateId: string }
export type RadarPublicTagInput = { key?: string | null; group?: string | null; value?: string | null; warningTemplateId?: string | null }
export type RadarConclusionInput = Record<string, unknown> & {
  suggestedGrade?: string | null
  coreGrade?: string | null
  fixedGrade?: string | null
  bestGrade?: string | null
  likelyGrade?: string | null
  worstGrade?: string | null
  proposedBestGrade?: string | null
  proposedLikelyGrade?: string | null
  proposedWorstGrade?: string | null
  classificationRule?: string | null
  matchedClasses?: Array<string | { value?: string | null }> | null
  riskSignals?: Array<string | { value?: string | null }> | null
  unresolvedDimensions?: Array<string | { value?: string | null }> | null
  unresolvedQuestions?: Array<string | { value?: string | null }> | null
  publicTags?: RadarPublicTagInput[] | null
  publicTagHints?: RadarPublicTagInput[] | null
  publicWarningTemplateIds?: Array<string | { value?: string | null }> | null
  requiresHumanReview?: boolean | null
  recommendedNextQueue?: string | null
  evidenceStatus?: string | null
  researchStatus?: string | null
  publicState?: string | null
  recordShape?: string | null
  blocked?: boolean | null
  insufficientCoverage?: boolean | null
  coverageState?: string | null
  databaseStatus?: string | null
  ratingNotice?: string | null
  warningTemplateId?: string | null
  pageNotice?: string | null
}
export type RadarNormalizedConclusion = {
  conclusionMode: RadarConclusionMode
  fixedGrade: string
  suggestedGrade: string
  bestGrade: string
  likelyGrade: string
  worstGrade: string
  title: string
  display: string
  likelyLabel: string
  classificationLabels: string[]
  riskSignals: string[]
  unresolvedDimensions: string[]
  validationIssues: string[]
  requiresHumanReview: boolean
  pendingReasons: string[]
  needsPendingTag: boolean
  databaseStatus: string
  warningTemplateId: string
  publicTags: RadarPublicTagContract[]
}
export const RADAR_GRADE_ORDER: readonly string[]
export const RADAR_AI_PENDING_DATABASE_STATUS: 'ai_synthesized_pending_review'
export const RADAR_AI_PENDING_WARNING_TEMPLATE_ID: 'ai-synthesized-pending-review'
export const ACCELERATED_RADAR_AI_REVIEW_TAG: Readonly<RadarPublicTagContract>
export function normalizeRadarGrade(value: unknown): string
export function normalizeRadarDatabaseStatus(value: unknown): string
export function normalizeRadarWarningTemplateId(value: unknown): string
export function isLegalRadarRange(bestGrade: unknown, likelyGrade: unknown, worstGrade: unknown): boolean
export function normalizeRadarConclusion(input?: RadarConclusionInput): RadarNormalizedConclusion
