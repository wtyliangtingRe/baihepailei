import type { RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'
import type { RadarResearchPreview } from '../_lib/detail-index'

type AssessmentOriginItem = {
  collection?: string
  ratingNotice?: string
  reviewStatus?: string
  reviewOrigin?: string
  radarAssessment?: RadarAssessmentMetrics
  researchPreview?: RadarResearchPreview
}

export function assessmentOriginLabel(item: AssessmentOriginItem) {
  if (item.collection !== 'works') {
    const isHumanReviewed = item.reviewOrigin === 'human_reviewed' || item.reviewStatus === 'reviewed'
    const isAIAssessed = item.reviewOrigin === 'ai_assessed'
    if (isAIAssessed && isHumanReviewed) return 'AI 辅助 · 人工已复核'
    if (isHumanReviewed) return '人工已复核'
    if (isAIAssessed) return 'AI 已评估 · 待人工复核'
    return ''
  }

  const isHumanReviewed = item.ratingNotice === 'manual_reviewed' || item.reviewStatus === 'reviewed'
  const isAIAssessed = item.ratingNotice === 'ai_synthesized_pending_review'
    || Boolean(item.radarAssessment?.assessedAt || item.radarAssessment?.suggestedGrade || item.researchPreview)

  if (isAIAssessed && isHumanReviewed) return 'AI 辅助 · 人工已复核'
  if (isHumanReviewed) return '人工已复核'
  if (isAIAssessed) return 'AI 已评估 · 待人工复核'
  return ''
}

export default function AssessmentOriginBadge({ item }: { item: AssessmentOriginItem }) {
  const label = assessmentOriginLabel(item)
  if (!label) return null
  return <span className="assessment-origin-badge">{label}</span>
}
