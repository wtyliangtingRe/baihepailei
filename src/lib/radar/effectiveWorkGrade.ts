export type WorkGradeSource = 'human' | 'ai' | 'ai_legacy' | 'unassessed'

export type WorkGradeInput = {
  rank?: string | null
  reviewStatus?: string | null
  ratingNotice?: string | null
  humanAssessment?: { grade?: string | null; status?: string | null } | null
  radarAssessment?: {
    suggestedGrade?: string | null
    assessedAt?: string | null
  } | null
  researchPreview?: {
    likelyGrade?: string | null
  } | null
}

export type EffectiveWorkGrade = {
  grade: string
  source: WorkGradeSource
  humanReviewed: boolean
}

const supportedGrades = new Set(['AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])

export function normalizeWorkGrade(value: unknown) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'AA') return 'AA'
  if (supportedGrades.has(normalized)) return normalized
  return 'unknown'
}

export function isHumanReviewedWork(item: WorkGradeInput) {
  const humanStatus = String(item.humanAssessment?.status || '').trim()
  return (Boolean(String(item.humanAssessment?.grade || '').trim()) && humanStatus !== 'pending')
    || item.reviewStatus === 'reviewed'
    || item.ratingNotice === 'manual_reviewed'
}

export function effectiveWorkGrade(item: WorkGradeInput): EffectiveWorkGrade {
  const humanReviewed = isHumanReviewedWork(item)
  const storedGrade = normalizeWorkGrade(item.rank)
  const explicitHumanGrade = String(item.humanAssessment?.grade || '').trim()
  const humanStatus = String(item.humanAssessment?.status || '').trim()

  // A pending human form is not an opinion yet. Only a recorded or disputed
  // human track can become the catalog preference.
  if (explicitHumanGrade && humanStatus !== 'pending') {
    return { grade: normalizeWorkGrade(explicitHumanGrade), source: 'human', humanReviewed: true }
  }

  // Legacy reviewed records remain compatible until their humanAssessment is backfilled.
  if (humanReviewed) return { grade: storedGrade, source: 'human', humanReviewed: true }

  const suggestedGrade = normalizeWorkGrade(
    item.radarAssessment?.suggestedGrade || item.researchPreview?.likelyGrade,
  )
  if (suggestedGrade !== 'unknown') {
    return { grade: suggestedGrade, source: 'ai', humanReviewed: false }
  }

  // Before formal human confirmation, historical rank values are recommendations,
  // not official ratings. Keep them visible as AI / legacy suggestions.
  if (storedGrade !== 'unknown') {
    return { grade: storedGrade, source: 'ai_legacy', humanReviewed: false }
  }

  return { grade: 'unknown', source: 'unassessed', humanReviewed: false }
}

export function effectiveWorkGradeLabel(source: WorkGradeSource) {
  if (source === 'human') return '人工参考'
  if (source === 'ai') return 'AI 建议'
  if (source === 'ai_legacy') return 'AI / 历史建议'
  return '尚未评级'
}
