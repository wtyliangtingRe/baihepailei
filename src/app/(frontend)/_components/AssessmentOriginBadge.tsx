import type { RadarAssessmentMetrics } from '@/lib/radar/assessmentPresentation'

type AssessmentOriginItem = {
  collection?: string
  ratingNotice?: string
  reviewStatus?: string
  radarAssessment?: RadarAssessmentMetrics
}

export function assessmentOriginLabel(item: AssessmentOriginItem) {
  if (item.collection !== 'works') return ''

  const isHumanReviewed = item.ratingNotice === 'manual_reviewed' || item.reviewStatus === 'reviewed'
  const isAIAssessed = item.ratingNotice === 'ai_synthesized_pending_review'
    || Boolean(item.radarAssessment?.assessedAt || item.radarAssessment?.suggestedGrade)

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
