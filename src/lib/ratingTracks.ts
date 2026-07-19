export type RatingTrack = {
  grade?: string | null
  status?: string | null
  note?: string | null
  sourceSummary?: string | null
  evidenceStatus?: string | null
  sourceLinks?: Array<{ label?: string; url?: string }>
  assessedAt?: string | null
  assessedBy?: string | number | { id?: string | number } | null
}

type WorkRatingInput = {
  rank?: string | null
  reviewStatus?: string | null
  ratingNotice?: string | null
  radarAssessment?: { suggestedGrade?: string | null } | null
  humanAssessment?: RatingTrack | null
}

const grades = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])

export function normalizeRatingGrade(value: unknown) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'AA') return 'S'
  return grades.has(normalized) ? normalized : ''
}

export function humanTrackGrade(input: WorkRatingInput) {
  const explicit = normalizeRatingGrade(input.humanAssessment?.grade)
  if (explicit) return explicit
  if (
    input.reviewStatus === 'reviewed'
    || input.ratingNotice === 'manual_reviewed'
  ) {
    return normalizeRatingGrade(input.rank)
  }
  return ''
}

export function aiTrackGrade(input: WorkRatingInput) {
  return normalizeRatingGrade(input.radarAssessment?.suggestedGrade)
}

export function effectiveWorkGrade(input: WorkRatingInput) {
  return humanTrackGrade(input) || aiTrackGrade(input) || normalizeRatingGrade(input.rank) || 'unknown'
}
